import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyLegacyBaseline } from '../../../../electron/data/migrations/legacyBaseline';
import { faceFlagsMigration } from '../../../../electron/data/migrations/003_faceFlags';
import { doubtfulLogMigration } from '../../../../electron/data/migrations/008_doubtfulLog';

let testDb: Database.Database;
vi.mock('../../../../electron/db', () => ({ getDB: () => testDb }));

import { DoubtfulFaceRepository } from '../../../../electron/data/repositories/DoubtfulFaceRepository';
import { VisibilityRepository, VISIBILITY_MODEL } from '../../../../electron/data/repositories/VisibilityRepository';

const AT = '2026-11-27T10:00:00Z';
const BOX = JSON.stringify({ x: 10, y: 20, width: 30, height: 40 });

interface FaceSeed {
    id: number; person?: number | null; score?: number | null; confirmed?: number; source?: string; distance?: number | null;
    ignored?: number; tier?: string; suggested?: number | null;
}

/** Seeds faces; `score` is the model's answer (higher = no clear face), null leaves the face unscored. */
function seed(faces: FaceSeed[]) {
    testDb.prepare(`INSERT OR IGNORE INTO photos (id, file_path, preview_cache_path, width, height) VALUES (1, 'a.jpg', 'a_preview.jpg', 4000, 3000)`).run();
    const insert = testDb.prepare(`INSERT INTO faces (id, photo_id, box_json, score, person_id, is_confirmed, assignment_source, match_distance, is_ignored, confidence_tier, suggested_person_id, descriptor, entity_type)
                                   VALUES (?, 1, ?, 0.9, ?, ?, ?, ?, ?, ?, ?, ?, 'human')`);
    for (const f of faces) {
        const person = f.person === undefined ? 1 : f.person;
        if (person) testDb.prepare('INSERT OR IGNORE INTO people (id, name) VALUES (?, ?)').run(person, `Person ${person}`);
        if (f.suggested) testDb.prepare('INSERT OR IGNORE INTO people (id, name) VALUES (?, ?)').run(f.suggested, `Person ${f.suggested}`);
        insert.run(f.id, BOX, person, f.confirmed ?? 0, f.source ?? 'ai_scan', f.distance ?? null, f.ignored ?? 0, f.tier ?? 'high', f.suggested ?? null, Buffer.alloc(8));
        if (f.score !== null && f.score !== undefined) VisibilityRepository.save([{ faceId: f.id, score: f.score }], VISIBILITY_MODEL, AT);
    }
}

const listIds = (min = 0, person: number | null = null) => DoubtfulFaceRepository.list(min, person, 0, 100).map(t => t.faceId);
const face = (id: number) => testDb.prepare('SELECT * FROM faces WHERE id = ?').get(id) as Record<string, unknown>;

describe('DoubtfulFaceRepository', () => {
    beforeEach(() => {
        testDb = new Database(':memory:');
        applyLegacyBaseline(testDb);
        faceFlagsMigration.up(testDb);
        doubtfulLogMigration.up(testDb);
    });
    afterEach(() => testDb.close());

    describe('list', () => {
        it('shows assigned faces the model scored at or above the cut-off, the most doubtful first', () => {
            seed([{ id: 1, score: 1 }, { id: 2, score: 4 }, { id: 3, score: -2 }, { id: 4, score: 2 }]);

            expect(listIds(0)).toEqual([2, 4, 1]);
        });

        it('leaves out unscored, unassigned, ignored and kept faces', () => {
            seed([{ id: 1, score: 3 }, { id: 2, score: null }, { id: 3, score: 3, person: null }, { id: 4, score: 3, ignored: 1 }, { id: 5, score: 3 }]);
            testDb.prepare(`INSERT INTO face_flags (face_id, kind, score, model, status, created_at) VALUES (5, 'non_face', NULL, NULL, 'dismissed', ?)`).run(AT);

            expect(listIds()).toEqual([1]);
        });

        it('leaves out a score from an older model', () => {
            seed([{ id: 1, score: null }]);
            VisibilityRepository.save([{ faceId: 1, score: 5 }], 'old-model', AT);

            expect(listIds()).toEqual([]);
        });

        it('can be limited to one person, and carries the person and how the face was assigned', () => {
            seed([{ id: 1, score: 3, person: 7, confirmed: 1, source: 'profile_match' }, { id: 2, score: 3, person: 8 }]);

            const tiles = DoubtfulFaceRepository.list(0, 7, 0, 10);

            expect(tiles).toHaveLength(1);
            expect(tiles[0]).toMatchObject({ faceId: 1, personId: 7, personName: 'Person 7', source: 'profile_match', confirmed: true, score: 3 });
        });

        it('pages through the list', () => {
            seed([{ id: 1, score: 4 }, { id: 2, score: 3 }, { id: 3, score: 2 }]);

            expect(DoubtfulFaceRepository.list(0, null, 1, 1).map(t => t.faceId)).toEqual([2]);
        });
    });

    describe('counts', () => {
        it('counts the faces at each cut-off and the faces per person, the biggest first', () => {
            seed([{ id: 1, score: 5, person: 7 }, { id: 2, score: 1, person: 7 }, { id: 3, score: 3, person: 8 }, { id: 4, score: -1, person: 8 }]);

            expect(DoubtfulFaceRepository.countAtLeast([0, 2, 4]).map(c => c.total)).toEqual([3, 2, 1]);
            expect(DoubtfulFaceRepository.peopleAtLeast(0)).toEqual([
                { personId: 7, name: 'Person 7', count: 2 },
                { personId: 8, name: 'Person 8', count: 1 },
            ]);
        });
    });

    describe('ignore ("not a face")', () => {
        it('takes the face out of its person, ignores it, and says which person it came from', () => {
            seed([{ id: 1, score: 3, person: 7, confirmed: 1 }]);

            const done = DoubtfulFaceRepository.ignore([1], 0, AT);

            expect(done).toEqual([{ faceId: 1, formerPersonId: 7 }]);
            expect(face(1)).toMatchObject({ is_ignored: 1, ignore_source: 'user', person_id: null, is_confirmed: 0 });
        });

        it('leaves a face alone that is no longer doubtful (the list was open while something changed)', () => {
            seed([{ id: 1, score: -3 }, { id: 2, score: 3, ignored: 1 }]);

            expect(DoubtfulFaceRepository.ignore([1, 2], 0, AT)).toEqual([]);
            expect(face(1)).toMatchObject({ is_ignored: 0, person_id: 1 });
        });
    });

    describe('unassign ("back to suggestions")', () => {
        it('takes the face out of its person, unconfirmed, with that person as the suggestion', () => {
            seed([{ id: 1, score: 3, person: 7, confirmed: 1, source: 'profile_match', distance: 0.4 }]);

            const done = DoubtfulFaceRepository.unassign([1], 0, AT);

            expect(done).toEqual([{ faceId: 1, formerPersonId: 7 }]);
            expect(face(1)).toMatchObject({ person_id: null, is_confirmed: 0, is_ignored: 0, confidence_tier: 'review', suggested_person_id: 7, assignment_source: 'ai_scan', needs_bucketing: 1 });
        });
    });

    describe('keep ("this is a face")', () => {
        it('records the faces as kept, changes nothing else, and does not offer them again', () => {
            seed([{ id: 1, score: 3 }, { id: 2, score: -3 }]);

            expect(DoubtfulFaceRepository.keep([1, 2], 0, AT)).toBe(1);

            expect(face(1)).toMatchObject({ person_id: 1 });
            expect(listIds(-10)).toEqual([2]);
        });
    });

    describe('undo', () => {
        it('gives an ignored face back exactly as it was', () => {
            seed([{ id: 1, score: 3, person: 7, confirmed: 1, source: 'profile_match', distance: 0.55, tier: 'high', suggested: 7 }]);
            DoubtfulFaceRepository.ignore([1], 0, AT);

            const restored = DoubtfulFaceRepository.undo([1]);

            expect(restored).toEqual([{ faceId: 1, personId: 7 }]);
            expect(face(1)).toMatchObject({ is_ignored: 0, ignore_source: null, person_id: 7, is_confirmed: 1, assignment_source: 'profile_match', match_distance: 0.55, confidence_tier: 'high', suggested_person_id: 7, needs_bucketing: 0 });
            expect(testDb.prepare('SELECT COUNT(*) AS c FROM doubtful_log').get()).toEqual({ c: 0 });
        });

        it('gives an unassigned face back exactly as it was', () => {
            seed([{ id: 1, score: 3, person: 7, confirmed: 1, source: 'ai_scan', distance: null, tier: 'high', suggested: null }]);
            DoubtfulFaceRepository.unassign([1], 0, AT);

            DoubtfulFaceRepository.undo([1]);

            expect(face(1)).toMatchObject({ person_id: 7, is_confirmed: 1, assignment_source: 'ai_scan', confidence_tier: 'high', suggested_person_id: null });
        });

        it('leaves a face alone that the user has assigned or changed since', () => {
            seed([{ id: 1, score: 3, person: 7 }]);
            DoubtfulFaceRepository.unassign([1], 0, AT);
            testDb.prepare(`INSERT INTO people (id, name) VALUES (9, 'Person 9')`).run();
            testDb.prepare('UPDATE faces SET person_id = 9 WHERE id = 1').run();

            expect(DoubtfulFaceRepository.undo([1])).toEqual([]);
            expect(face(1)).toMatchObject({ person_id: 9 });
        });

        it('brings the face back unassigned when its person no longer exists', () => {
            seed([{ id: 1, score: 3, person: 7 }]);
            DoubtfulFaceRepository.ignore([1], 0, AT);
            testDb.prepare('DELETE FROM people WHERE id = 7').run();

            expect(DoubtfulFaceRepository.undo([1])).toEqual([{ faceId: 1, personId: null }]);
            expect(face(1)).toMatchObject({ is_ignored: 0, person_id: null, is_confirmed: 0 });
        });

        it('counts what could still be undone', () => {
            seed([{ id: 1, score: 3 }, { id: 2, score: 3 }]);
            DoubtfulFaceRepository.ignore([1], 0, AT);
            DoubtfulFaceRepository.unassign([2], 0, AT);

            expect(DoubtfulFaceRepository.countChanged()).toBe(2);
            DoubtfulFaceRepository.undo([1]);
            expect(DoubtfulFaceRepository.countChanged()).toBe(1);
        });
    });
});
