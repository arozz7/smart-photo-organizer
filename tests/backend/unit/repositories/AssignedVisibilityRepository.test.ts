import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyLegacyBaseline } from '../../../../electron/data/migrations/legacyBaseline';
import { faceFlagsMigration } from '../../../../electron/data/migrations/003_faceFlags';

let testDb: Database.Database;
vi.mock('../../../../electron/db', () => ({ getDB: () => testDb }));

import { AssignedVisibilityRepository } from '../../../../electron/data/repositories/AssignedVisibilityRepository';
import { VisibilityRepository, VISIBILITY_MODEL } from '../../../../electron/data/repositories/VisibilityRepository';

const AT = '2026-11-27T10:00:00Z';
const BOX = JSON.stringify({ x: 10, y: 20, width: 30, height: 40 });

interface FaceSeed { id: number; detector?: number; person?: number | null; ignored?: number; entity?: string | null; descriptor?: boolean }

function seed(faces: FaceSeed[]) {
    testDb.prepare(`INSERT OR IGNORE INTO photos (id, file_path, preview_cache_path, width, height) VALUES (1, 'a.jpg', 'a_preview.jpg', 4000, 3000)`).run();
    const insert = testDb.prepare(`INSERT INTO faces (id, photo_id, box_json, score, person_id, is_ignored, entity_type, descriptor) VALUES (?, 1, ?, ?, ?, ?, ?, ?)`);
    for (const f of faces) {
        const person = f.person === undefined ? 1 : f.person;
        if (person) testDb.prepare('INSERT OR IGNORE INTO people (id, name) VALUES (?, ?)').run(person, `Person ${person}`);
        insert.run(f.id, BOX, f.detector ?? 0.9, person, f.ignored ?? 0, f.entity === undefined ? 'human' : f.entity, f.descriptor === false ? null : Buffer.alloc(8));
    }
}

const dueIds = (limit = 50) => AssignedVisibilityRepository.loadDue(limit).map(face => face.id);

describe('AssignedVisibilityRepository', () => {
    beforeEach(() => {
        testDb = new Database(':memory:');
        applyLegacyBaseline(testDb);
        faceFlagsMigration.up(testDb);
    });
    afterEach(() => testDb.close());

    describe('loadDue (assigned faces the model has not looked at yet)', () => {
        it('takes assigned faces whatever their detector score, and leaves unassigned faces to the other check', () => {
            seed([{ id: 1, detector: 0.99 }, { id: 2, detector: 0.3 }, { id: 3, person: null }]);

            expect(dueIds().sort()).toEqual([1, 2]);
        });

        it('starts with the person who has the most faces, then the lowest detector score', () => {
            seed([
                { id: 1, person: 5, detector: 0.9 },
                { id: 2, person: 7, detector: 0.95 },
                { id: 3, person: 7, detector: 0.8 },
                { id: 4, person: 7, detector: 0.9 },
            ]);

            expect(dueIds()).toEqual([3, 4, 2, 1]);
        });

        it('leaves out ignored faces, non-human faces and faces without a descriptor', () => {
            seed([{ id: 1 }, { id: 2, ignored: 1 }, { id: 3, entity: 'pet' }, { id: 4, descriptor: false }]);

            expect(dueIds()).toEqual([1]);
        });

        it('leaves out a face the user kept as a real face', () => {
            seed([{ id: 1 }, { id: 2 }]);
            testDb.prepare(`INSERT INTO face_flags (face_id, kind, score, model, status, created_at) VALUES (2, 'non_face', NULL, NULL, 'dismissed', ?)`).run(AT);

            expect(dueIds()).toEqual([1]);
        });

        it('leaves out a face the current model scored (or failed on) and offers one that an older model scored', () => {
            seed([{ id: 1 }, { id: 2 }, { id: 3 }]);
            AssignedVisibilityRepository.save([{ faceId: 1, score: 2 }, { faceId: 2, score: null }], VISIBILITY_MODEL, AT);
            AssignedVisibilityRepository.save([{ faceId: 3, score: 2 }], 'old-model', AT);

            expect(dueIds()).toEqual([3]);
        });

        it('limits the batch and carries what the engine needs', () => {
            seed([{ id: 1 }, { id: 2 }, { id: 3 }]);

            const due = AssignedVisibilityRepository.loadDue(2);

            expect(due).toHaveLength(2);
            expect(due[0]).toMatchObject({ box: { x: 10, y: 20, width: 30, height: 40 }, photoWidth: 4000, previewPath: 'a_preview.jpg', filePath: 'a.jpg' });
        });
    });

    describe('save', () => {
        it('stores a score in the same place as the other visibility check, so a score is never asked for twice', () => {
            seed([{ id: 1 }]);

            AssignedVisibilityRepository.save([{ faceId: 1, score: 1.5 }], VISIBILITY_MODEL, AT);

            expect(testDb.prepare(`SELECT score, model FROM face_flags WHERE face_id = 1 AND kind = 'face_visibility'`).get()).toEqual({ score: 1.5, model: VISIBILITY_MODEL });
        });

        it('knows nothing about faces another list is checking: unassigned faces are not counted here', () => {
            seed([{ id: 1 }, { id: 2, person: null }]);
            VisibilityRepository.save([{ faceId: 2, score: 1 }], VISIBILITY_MODEL, AT);

            expect(AssignedVisibilityRepository.counts()).toEqual({ candidates: 1, scored: 0, failed: 0 });
        });
    });

    describe('counts', () => {
        it('counts the candidates, how many have a score and how many failed', () => {
            seed([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
            AssignedVisibilityRepository.save([{ faceId: 1, score: 2 }, { faceId: 2, score: -1 }, { faceId: 3, score: null }], VISIBILITY_MODEL, AT);

            expect(AssignedVisibilityRepository.counts()).toEqual({ candidates: 4, scored: 2, failed: 1 });
        });

        it('is zero for an empty library', () => {
            expect(AssignedVisibilityRepository.counts()).toEqual({ candidates: 0, scored: 0, failed: 0 });
        });
    });
});
