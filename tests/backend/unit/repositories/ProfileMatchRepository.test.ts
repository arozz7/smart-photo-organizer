import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyLegacyBaseline } from '../../../../electron/data/migrations/legacyBaseline';
import { faceFlagsMigration } from '../../../../electron/data/migrations/003_faceFlags';
import { profileSuggestionLogMigration } from '../../../../electron/data/migrations/004_profileSuggestionLog';

let testDb: Database.Database;
vi.mock('../../../../electron/db', () => ({ getDB: () => testDb }));

import { ProfileMatchRepository, PROFILE_SOURCE } from '../../../../electron/data/repositories/ProfileMatchRepository';

const AT = '2026-11-19T10:00:00Z';
const BOX = JSON.stringify({ x: 10, y: 20, width: 30, height: 40 });
const DESCRIPTOR = Buffer.alloc(2048, 1);

interface FaceSeed {
    id: number;
    photo?: number;
    person?: number | null;
    confirmed?: number;
    ignored?: number;
    yaw?: number | null;
    entity?: string | null;
    descriptor?: Buffer | null;
    source?: string | null;
}

function seed(faces: FaceSeed[]) {
    for (const photo of new Set(faces.map(f => f.photo ?? 1))) {
        testDb.prepare('INSERT OR IGNORE INTO photos (id, file_path, preview_cache_path, width, height) VALUES (?, ?, ?, 4000, 3000)').run(photo, `p${photo}`, `p${photo}_preview.jpg`);
    }
    const insert = testDb.prepare(
        `INSERT INTO faces (id, photo_id, box_json, score, face_quality, blur_score, pose_yaw, person_id, is_confirmed, is_ignored, entity_type, descriptor, assignment_source)
         VALUES (?, ?, ?, 0.9, 0.6, 120, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const f of faces) {
        if (f.person) testDb.prepare('INSERT OR IGNORE INTO people (id, name) VALUES (?, ?)').run(f.person, `Person ${f.person}`);
        insert.run(
            f.id, f.photo ?? 1, BOX, f.yaw === undefined ? 60 : f.yaw, f.person ?? null, f.confirmed ?? 0, f.ignored ?? 0,
            f.entity === undefined ? 'human' : f.entity, f.descriptor === undefined ? DESCRIPTOR : f.descriptor, f.source === undefined ? 'ai_scan' : f.source
        );
    }
}

const face = (id: number) =>
    testDb.prepare('SELECT person_id, is_confirmed, is_ignored, assignment_source, match_distance, bucket_id, needs_bucketing FROM faces WHERE id = ?').get(id) as {
        person_id: number | null; is_confirmed: number; is_ignored: number; assignment_source: string | null; match_distance: number | null; bucket_id: number | null; needs_bucketing: number;
    };
const log = () => testDb.prepare('SELECT face_id, person_id, status FROM profile_suggestion_log ORDER BY face_id, person_id').all();

describe('ProfileMatchRepository', () => {
    beforeEach(() => {
        testDb = new Database(':memory:');
        applyLegacyBaseline(testDb);
        faceFlagsMigration.up(testDb);
        profileSuggestionLogMigration.up(testDb);
    });
    afterEach(() => testDb.close());

    describe('loadExamples', () => {
        it('returns confirmed, turned, human faces of named people with a full descriptor', () => {
            seed([
                { id: 1, person: 10, confirmed: 1, yaw: 60 },
                { id: 2, person: 10, confirmed: 1, yaw: -45 },
                { id: 3, person: 10, confirmed: 0, yaw: 60 },
                { id: 4, person: 10, confirmed: 1, yaw: 20 },
                { id: 5, person: 10, confirmed: 1, yaw: null },
                { id: 6, person: 10, confirmed: 1, yaw: 60, ignored: 1 },
                { id: 7, person: 10, confirmed: 1, yaw: 60, entity: 'pet' },
                { id: 8, person: 10, confirmed: 1, yaw: 60, descriptor: Buffer.alloc(100) },
                { id: 9, person: null, confirmed: 1, yaw: 60 },
            ]);

            const examples = ProfileMatchRepository.loadExamples(40);

            expect(examples.map(e => e.faceId).sort()).toEqual([1, 2]);
            expect(examples[0]).toMatchObject({ personId: 10, photoId: 1 });
            expect(examples[0].descriptor.byteLength).toBe(2048);
        });
    });

    describe('candidates', () => {
        const pool = (): FaceSeed[] => [
            { id: 1, yaw: 60 },
            { id: 2, yaw: -50 },
            { id: 3, yaw: 20 },
            { id: 4, yaw: null },
            { id: 5, yaw: 60, ignored: 1 },
            { id: 6, yaw: 60, person: 10, confirmed: 1 },
            { id: 7, yaw: 60, entity: 'pet' },
            { id: 8, yaw: 60, descriptor: null },
            { id: 9, yaw: 80 },
        ];

        it('are unassigned, not ignored, human, turned and have a descriptor', () => {
            seed(pool());

            expect(ProfileMatchRepository.countCandidates(40)).toBe(3);
            expect(ProfileMatchRepository.loadCandidates(0, 100, 40).map(c => c.id)).toEqual([1, 2, 9]);
        });

        it('page by id', () => {
            seed(pool());

            expect(ProfileMatchRepository.loadCandidates(0, 2, 40).map(c => c.id)).toEqual([1, 2]);
            expect(ProfileMatchRepository.loadCandidates(2, 2, 40).map(c => c.id)).toEqual([9]);
        });

        it('still include a face the user kept in the Not a Face? list (it is a real face)', () => {
            seed([{ id: 1, yaw: 60 }]);
            testDb.prepare(`INSERT INTO face_flags (face_id, kind, status, created_at) VALUES (1, 'non_face', 'dismissed', ?)`).run(AT);

            expect(ProfileMatchRepository.countCandidates(40)).toBe(1);
        });
    });

    describe('personsInPhotos', () => {
        it('lists every person with a face in each photo, confirmed or not, and leaves out ignored faces', () => {
            seed([
                { id: 1, photo: 1, person: 10, confirmed: 1 },
                { id: 2, photo: 1, person: 11, confirmed: 0 },
                { id: 3, photo: 1, person: 12, confirmed: 1, ignored: 1 },
                { id: 4, photo: 2, person: 10, confirmed: 1 },
                { id: 5, photo: 3 },
            ]);

            const byPhoto = ProfileMatchRepository.personsInPhotos([1, 2, 3]);

            expect([...(byPhoto.get(1) ?? [])].sort()).toEqual([10, 11]);
            expect([...(byPhoto.get(2) ?? [])]).toEqual([10]);
            expect(byPhoto.get(3)).toBeUndefined();
        });
    });

    describe('assign', () => {
        it('gives the face to the person as confirmed, tagged and logged, and takes it out of any bucket', () => {
            seed([{ id: 1 }]);
            testDb.prepare('UPDATE faces SET bucket_id = 5, needs_bucketing = 1 WHERE id = 1').run();
            testDb.prepare(`INSERT OR IGNORE INTO people (id, name) VALUES (10, 'P')`).run();

            const done = ProfileMatchRepository.assign([{ faceId: 1, personId: 10, distance: 0.91 }], AT);

            expect(done).toEqual([{ faceId: 1, personId: 10 }]);
            expect(face(1)).toMatchObject({ person_id: 10, is_confirmed: 1, assignment_source: PROFILE_SOURCE, match_distance: 0.91, bucket_id: null, needs_bucketing: 0 });
            expect(log()).toEqual([{ face_id: 1, person_id: 10, status: 'assigned' }]);
        });

        it('leaves a face alone that was assigned or ignored since the list was made', () => {
            seed([{ id: 1, person: 11, confirmed: 1 }, { id: 2, ignored: 1 }, { id: 3 }]);
            testDb.prepare(`INSERT OR IGNORE INTO people (id, name) VALUES (10, 'P')`).run();

            const done = ProfileMatchRepository.assign(
                [{ faceId: 1, personId: 10, distance: 0.9 }, { faceId: 2, personId: 10, distance: 0.9 }, { faceId: 3, personId: 10, distance: 0.9 }], AT
            );

            expect(done).toEqual([{ faceId: 3, personId: 10 }]);
            expect(face(1).person_id).toBe(11);
            expect(face(2)).toMatchObject({ person_id: null, is_ignored: 1 });
            expect(log()).toEqual([{ face_id: 3, person_id: 10, status: 'assigned' }]);
        });

        it('replaces an earlier "not this person" for the same pair', () => {
            seed([{ id: 1 }]);
            testDb.prepare(`INSERT OR IGNORE INTO people (id, name) VALUES (10, 'P')`).run();
            ProfileMatchRepository.dismiss([{ faceId: 1, personId: 10, distance: 0.95 }], AT);

            ProfileMatchRepository.assign([{ faceId: 1, personId: 10, distance: 0.95 }], AT);

            expect(log()).toEqual([{ face_id: 1, person_id: 10, status: 'assigned' }]);
        });
    });

    describe('dismiss', () => {
        it('remembers the pair, so the same person is not suggested for that face again, but another person may be', () => {
            seed([{ id: 1 }, { id: 2 }]);

            ProfileMatchRepository.dismiss([{ faceId: 1, personId: 10, distance: 0.9 }, { faceId: 2, personId: 11, distance: 0.8 }], AT);

            expect(ProfileMatchRepository.dismissedPairs([1, 2, 3])).toEqual(new Set(['1:10', '2:11']));
            expect(face(1).person_id).toBeNull();
        });
    });

    describe('undo', () => {
        beforeEach(() => {
            seed([{ id: 1 }, { id: 2 }, { id: 3 }]);
            testDb.prepare(`INSERT OR IGNORE INTO people (id, name) VALUES (10, 'P'), (11, 'Q')`).run();
            ProfileMatchRepository.assign([{ faceId: 1, personId: 10, distance: 0.9 }, { faceId: 2, personId: 10, distance: 0.9 }, { faceId: 3, personId: 10, distance: 0.9 }], AT);
        });

        it('returns the faces this list assigned to unassigned, queued for grouping, and forgets them', () => {
            const restored = ProfileMatchRepository.undo([1, 2]);

            expect(restored).toEqual([{ faceId: 1, personId: 10 }, { faceId: 2, personId: 10 }]);
            expect(face(1)).toMatchObject({ person_id: null, is_confirmed: 0, match_distance: null, assignment_source: 'ai_scan', needs_bucketing: 1 });
            expect(face(3).person_id).toBe(10);
            expect(log()).toEqual([{ face_id: 3, person_id: 10, status: 'assigned' }]);
        });

        it('puts the face back where Review Needed looks (unassigned, not ignored)', () => {
            ProfileMatchRepository.undo([1]);

            const row = testDb.prepare('SELECT id FROM faces WHERE person_id IS NULL AND is_ignored = 0 AND id = 1').get();
            expect(row).toEqual({ id: 1 });
            expect(ProfileMatchRepository.countCandidates(40)).toBe(1);
        });

        it('leaves a face the user moved to another person since', () => {
            testDb.prepare(`UPDATE faces SET person_id = 11, assignment_source = 'manual' WHERE id = 2`).run();

            const restored = ProfileMatchRepository.undo([1, 2]);

            expect(restored).toEqual([{ faceId: 1, personId: 10 }]);
            expect(face(2).person_id).toBe(11);
        });

        it('does nothing for a face that this list did not assign', () => {
            seed([{ id: 9, person: 10, confirmed: 1 }]);

            expect(ProfileMatchRepository.undo([9])).toEqual([]);
            expect(face(9).person_id).toBe(10);
        });
    });

    describe('display data', () => {
        it('returns what the page shows for faces and for people', () => {
            seed([{ id: 1, yaw: 55, person: 10 }]);

            const [tile] = ProfileMatchRepository.faceTiles([1]);

            expect(tile).toMatchObject({ faceId: 1, photoId: 1, yaw: 55, quality: 0.6, blur: 120, box: { x: 10, y: 20, width: 30, height: 40 }, filePath: 'p1', previewPath: 'p1_preview.jpg', photoWidth: 4000, photoHeight: 3000 });
            expect(ProfileMatchRepository.personNames([10])).toEqual(new Map([[10, 'Person 10']]));
        });

        it('picks a sharp frontal face of a person to show beside the turned examples', () => {
            seed([
                { id: 1, person: 10, confirmed: 1, yaw: 5, photo: 1 },
                { id: 2, person: 10, confirmed: 1, yaw: 10, photo: 2 },
                { id: 3, person: 10, confirmed: 1, yaw: 70, photo: 3 },
                { id: 4, person: 10, confirmed: 0, yaw: 0, photo: 4 },
            ]);
            testDb.prepare('UPDATE faces SET blur_score = 300 WHERE id = 2').run();

            expect(ProfileMatchRepository.frontalReference(10, 99)).toBe(2);
            expect(ProfileMatchRepository.frontalReference(10, 2)).toBe(1);
            expect(ProfileMatchRepository.frontalReference(11, 99)).toBeNull();
        });
    });
});
