import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyLegacyBaseline } from '../../../../electron/data/migrations/legacyBaseline';
import { faceFlagsMigration } from '../../../../electron/data/migrations/003_faceFlags';
import { pictureLogMigration } from '../../../../electron/data/migrations/005_pictureLog';

let testDb: Database.Database;
vi.mock('../../../../electron/db', () => ({ getDB: () => testDb }));

import { PictureRepository } from '../../../../electron/data/repositories/PictureRepository';
import { PictureListRepository } from '../../../../electron/data/repositories/PictureListRepository';
import { PICTURE_MODEL } from '../../../../electron/core/services/pictureModel';

const AT = '2026-11-21T10:00:00Z';
const BOX = JSON.stringify({ x: 10, y: 20, width: 30, height: 40 });
const MIN = -2; // a model answer: faces scoring at least this are suggestions

interface FaceSeed {
    id: number;
    q1?: number | null;           // the model's answer; leave out for a face not checked yet
    person?: number | null;
    confirmed?: number;
    source?: string | null;
    distance?: number | null;
    ignored?: number;
    entity?: string | null;
    yaw?: number | null;
}

function seed(faces: FaceSeed[]) {
    testDb.prepare(`INSERT OR IGNORE INTO photos (id, file_path, preview_cache_path, width, height) VALUES (1, 'a.jpg', 'a_preview.jpg', 4000, 3000)`).run();
    const insert = testDb.prepare(
        `INSERT INTO faces (id, photo_id, box_json, score, face_quality, blur_score, pose_yaw, person_id, is_confirmed, assignment_source, match_distance, is_ignored, entity_type, descriptor, needs_bucketing)
         VALUES (?, 1, ?, 0.9, 0.6, 100, ?, ?, ?, ?, ?, ?, ?, x'00', 0)`
    );
    for (const f of faces) {
        if (f.person) testDb.prepare('INSERT OR IGNORE INTO people (id, name) VALUES (?, ?)').run(f.person, `Person ${f.person}`);
        insert.run(f.id, BOX, f.yaw === undefined ? 5 : f.yaw, f.person ?? null, f.confirmed ?? 0, f.source === undefined ? 'ai_scan' : f.source, f.distance ?? null, f.ignored ?? 0, f.entity === undefined ? 'human' : f.entity);
        if (f.q1 !== undefined) PictureRepository.save([{ faceId: f.id, score: f.q1 }], PICTURE_MODEL, AT);
    }
}

const face = (id: number) =>
    testDb.prepare('SELECT person_id, is_confirmed, assignment_source, match_distance, is_ignored, ignore_source, needs_bucketing FROM faces WHERE id = ?').get(id) as {
        person_id: number | null; is_confirmed: number; assignment_source: string | null; match_distance: number | null; is_ignored: number; ignore_source: string | null; needs_bucketing: number;
    };
const log = () => testDb.prepare('SELECT face_id, action, former_person_id, former_confirmed, former_source, former_distance FROM picture_log ORDER BY face_id').all();

describe('PictureListRepository', () => {
    beforeEach(() => {
        testDb = new Database(':memory:');
        applyLegacyBaseline(testDb);
        faceFlagsMigration.up(testDb);
        pictureLogMigration.up(testDb);
    });
    afterEach(() => testDb.close());

    describe('which faces are suggested', () => {
        const pool = (): FaceSeed[] => [
            { id: 1, q1: -1 },
            { id: 2, q1: -1.5 },
            { id: 3, q1: -3 },                      // below the cut-off
            { id: 4 },                              // not checked yet
            { id: 5, q1: null },                    // failed
            { id: 6, q1: -1, ignored: 1 },
            { id: 7, q1: -1, entity: 'pet' },
            { id: 8, q1: -1.2, person: 10, confirmed: 1, source: 'ai_scan', distance: 0.4 },
            { id: 9, q1: -3, person: 10 },
        ];

        it('lists the unassigned faces at or above the cut-off, most picture-like first', () => {
            seed(pool());

            expect(PictureListRepository.list('unassigned', MIN, 0, 50).map(tile => tile.faceId)).toEqual([1, 2]);
        });

        it('lists the assigned faces separately, with the person and how the face was assigned', () => {
            seed(pool());

            const [tile] = PictureListRepository.list('assigned', MIN, 0, 50);

            expect(tile).toMatchObject({ faceId: 8, personId: 10, personName: 'Person 10', source: 'ai_scan', confirmed: true, score: -1.2, box: { x: 10, y: 20, width: 30, height: 40 }, filePath: 'a.jpg', previewPath: 'a_preview.jpg' });
        });

        it('pages the list', () => {
            seed([{ id: 1, q1: -1 }, { id: 2, q1: -1.1 }, { id: 3, q1: -1.2 }]);

            expect(PictureListRepository.list('unassigned', MIN, 0, 2).map(t => t.faceId)).toEqual([1, 2]);
            expect(PictureListRepository.list('unassigned', MIN, 2, 2).map(t => t.faceId)).toEqual([3]);
        });

        it('counts both lists for several cut-offs in one go', () => {
            seed(pool());

            expect(PictureListRepository.countAtLeast([-1.1, -2, -4])).toEqual([
                { minQ1: -1.1, unassigned: 1, assigned: 0 },
                { minQ1: -2, unassigned: 2, assigned: 1 },
                { minQ1: -4, unassigned: 3, assigned: 2 },
            ]);
        });

        it('does not count or list a face the user already ignored or kept as a picture', () => {
            seed([{ id: 1, q1: -1 }, { id: 2, q1: -1 }, { id: 3, q1: -1 }]);
            PictureListRepository.ignore([1], MIN, AT);
            PictureListRepository.keep([2], MIN, AT);

            expect(PictureListRepository.list('unassigned', MIN, 0, 50).map(t => t.faceId)).toEqual([3]);
            expect(PictureListRepository.countAtLeast([MIN])[0].unassigned).toBe(1);
        });
    });

    describe('idsToHide (the faces Review Needed leaves out)', () => {
        it('is the unassigned list at the cut-off, and never an assigned face', () => {
            seed([{ id: 1, q1: -1 }, { id: 2, q1: -3 }, { id: 3, q1: -1, person: 10 }]);

            expect(PictureListRepository.idsToHide(MIN)).toEqual([1]);
        });

        it('lets a face go back to Review Needed once the user kept it', () => {
            seed([{ id: 1, q1: -1 }]);
            PictureListRepository.keep([1], MIN, AT);

            expect(PictureListRepository.idsToHide(MIN)).toEqual([]);
        });
    });

    describe('ignore', () => {
        it('ignores an unassigned picture as the user (like any ignore) and notes it for Undo', () => {
            seed([{ id: 1, q1: -1 }]);

            const done = PictureListRepository.ignore([1], MIN, AT);

            expect(done).toEqual([{ faceId: 1, formerPersonId: null }]);
            expect(face(1)).toMatchObject({ is_ignored: 1, ignore_source: 'user', person_id: null });
            expect(log()).toEqual([{ face_id: 1, action: 'ignored', former_person_id: null, former_confirmed: 0, former_source: 'ai_scan', former_distance: null }]);
        });

        it('takes a picture out of the person it was assigned to, remembering exactly how it was assigned', () => {
            seed([{ id: 1, q1: -1, person: 10, confirmed: 1, source: 'auto_rematch', distance: 0.31 }]);

            const done = PictureListRepository.ignore([1], MIN, AT);

            expect(done).toEqual([{ faceId: 1, formerPersonId: 10 }]);
            expect(face(1)).toMatchObject({ person_id: null, is_ignored: 1, is_confirmed: 0 });
            expect(log()).toEqual([{ face_id: 1, action: 'ignored', former_person_id: 10, former_confirmed: 1, former_source: 'auto_rematch', former_distance: 0.31 }]);
        });

        it('leaves alone a face that is no longer a suggestion (below the cut-off, changed meanwhile)', () => {
            seed([{ id: 1, q1: -3 }, { id: 2, q1: -1, ignored: 1 }, { id: 3, q1: -1 }]);

            expect(PictureListRepository.ignore([1, 2, 3], MIN, AT).map(d => d.faceId)).toEqual([3]);
            expect(face(1).is_ignored).toBe(0);
        });
    });

    describe('keep', () => {
        it('records the face as a real face for the list, changes nothing else, and counts what it recorded', () => {
            seed([{ id: 1, q1: -1, person: 10, confirmed: 1 }, { id: 2, q1: -3 }]);

            expect(PictureListRepository.keep([1, 2], MIN, AT)).toBe(1);

            expect(face(1)).toMatchObject({ person_id: 10, is_confirmed: 1, is_ignored: 0 });
            expect(log()).toEqual([{ face_id: 1, action: 'kept', former_person_id: 10, former_confirmed: 1, former_source: 'ai_scan', former_distance: null }]);
        });
    });

    describe('undo', () => {
        it('gives an assigned picture back to its person exactly as it was', () => {
            seed([{ id: 1, q1: -1, person: 10, confirmed: 1, source: 'auto_rematch', distance: 0.31 }]);
            PictureListRepository.ignore([1], MIN, AT);

            const restored = PictureListRepository.undo([1]);

            expect(restored).toEqual([{ faceId: 1, personId: 10 }]);
            expect(face(1)).toEqual({ person_id: 10, is_confirmed: 1, assignment_source: 'auto_rematch', match_distance: 0.31, is_ignored: 0, ignore_source: null, needs_bucketing: 0 });
            expect(log()).toEqual([]);
        });

        it('returns an unassigned picture to Review Needed and queues it for grouping', () => {
            seed([{ id: 1, q1: -1 }]);
            PictureListRepository.ignore([1], MIN, AT);

            const restored = PictureListRepository.undo([1]);

            expect(restored).toEqual([{ faceId: 1, personId: null }]);
            expect(face(1)).toMatchObject({ is_ignored: 0, person_id: null, needs_bucketing: 1 });
            expect(testDb.prepare('SELECT id FROM faces WHERE person_id IS NULL AND is_ignored = 0 AND id = 1').get()).toEqual({ id: 1 });
        });

        it('leaves a face the user assigned to someone else, or ignored in another way, since', () => {
            seed([{ id: 1, q1: -1, person: 10 }, { id: 2, q1: -1 }]);
            PictureListRepository.ignore([1, 2], MIN, AT);
            testDb.prepare(`INSERT OR IGNORE INTO people (id, name) VALUES (11, 'Other')`).run();
            testDb.prepare(`UPDATE faces SET is_ignored = 0, ignore_source = NULL, person_id = 11, assignment_source = 'manual' WHERE id = 1`).run();

            expect(PictureListRepository.undo([1, 2])).toEqual([{ faceId: 2, personId: null }]);
            expect(face(1).person_id).toBe(11);
        });

        it('does nothing for a face this list did not ignore', () => {
            seed([{ id: 1, q1: -1, ignored: 1 }]);

            expect(PictureListRepository.undo([1])).toEqual([]);
            expect(face(1).is_ignored).toBe(1);
        });
    });

    it('counts the faces this list ignored that are still ignored', () => {
        seed([{ id: 1, q1: -1 }, { id: 2, q1: -1 }]);
        PictureListRepository.ignore([1, 2], MIN, AT);
        PictureListRepository.undo([2]);

        expect(PictureListRepository.countIgnored()).toBe(1);
    });
});
