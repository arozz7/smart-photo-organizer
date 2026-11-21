import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyLegacyBaseline } from '../../../../electron/data/migrations/legacyBaseline';
import { faceFlagsMigration } from '../../../../electron/data/migrations/003_faceFlags';
import { pictureLogMigration } from '../../../../electron/data/migrations/005_pictureLog';

let testDb: Database.Database;
vi.mock('../../../../electron/db', () => ({ getDB: () => testDb }));

import { PictureRepository, PICTURE_KIND } from '../../../../electron/data/repositories/PictureRepository';
import { PICTURE_MODEL } from '../../../../electron/core/services/pictureModel';

const AT = '2026-11-21T10:00:00Z';
const BOX = JSON.stringify({ x: 10, y: 20, width: 30, height: 40 });

interface FaceSeed { id: number; detector?: number; person?: number | null; ignored?: number; entity?: string | null; descriptor?: boolean }

function seed(faces: FaceSeed[]) {
    testDb.prepare(`INSERT OR IGNORE INTO photos (id, file_path, preview_cache_path, width, height) VALUES (1, 'a.jpg', 'a_preview.jpg', 4000, 3000)`).run();
    const insert = testDb.prepare(
        `INSERT INTO faces (id, photo_id, box_json, score, person_id, is_ignored, entity_type, descriptor) VALUES (?, 1, ?, ?, ?, ?, ?, ${'?'})`
    );
    for (const f of faces) {
        if (f.person) testDb.prepare('INSERT OR IGNORE INTO people (id, name) VALUES (?, ?)').run(f.person, `Person ${f.person}`);
        insert.run(f.id, BOX, f.detector ?? 0.9, f.person ?? null, f.ignored ?? 0, f.entity === undefined ? 'human' : f.entity, f.descriptor === false ? null : Buffer.alloc(8));
    }
}

describe('PictureRepository', () => {
    beforeEach(() => {
        testDb = new Database(':memory:');
        applyLegacyBaseline(testDb);
        faceFlagsMigration.up(testDb);
        pictureLogMigration.up(testDb);
    });
    afterEach(() => testDb.close());

    describe('loadDue (the faces the model has not looked at yet)', () => {
        it('puts the faces already assigned to people first, then the unassigned ones with the highest detector score first', () => {
            seed([
                { id: 1, detector: 0.95 },
                { id: 2, detector: 0.99 },
                { id: 3, detector: 0.5, person: 7 },
                { id: 4, detector: 0.97, person: 7 },
                { id: 5, detector: 0.6 },
            ]);

            expect(PictureRepository.loadDue(10).map(face => face.id)).toEqual([4, 3, 2, 1, 5]);
        });

        it('leaves out ignored faces, non-human faces and faces without a descriptor', () => {
            seed([{ id: 1 }, { id: 2, ignored: 1 }, { id: 3, entity: 'pet' }, { id: 4, descriptor: false }]);

            expect(PictureRepository.loadDue(10).map(face => face.id)).toEqual([1]);
        });

        it('leaves out a face the current model scored (or failed on) and offers one that an older model scored', () => {
            seed([{ id: 1 }, { id: 2 }, { id: 3 }]);
            PictureRepository.save([{ faceId: 1, score: -3 }, { faceId: 2, score: null }], PICTURE_MODEL, AT);
            PictureRepository.save([{ faceId: 3, score: -3 }], 'smolvlm2-picture-q1-v0-old', AT);

            expect(PictureRepository.loadDue(10).map(face => face.id)).toEqual([3]);
        });

        it('limits the batch and carries what the engine needs', () => {
            seed([{ id: 1 }, { id: 2 }, { id: 3 }]);

            const due = PictureRepository.loadDue(2);

            expect(due).toHaveLength(2);
            expect(due[0]).toMatchObject({ box: { x: 10, y: 20, width: 30, height: 40 }, photoWidth: 4000, previewPath: 'a_preview.jpg', filePath: 'a.jpg' });
        });
    });

    describe('save', () => {
        it('stores one score per face under the picture kind and the model name, and replaces an older one', () => {
            seed([{ id: 1 }]);

            PictureRepository.save([{ faceId: 1, score: -2.5 }], PICTURE_MODEL, AT);
            PictureRepository.save([{ faceId: 1, score: -1.5 }], PICTURE_MODEL, AT);

            expect(testDb.prepare('SELECT kind, score, model, status FROM face_flags WHERE face_id = 1').all()).toEqual([
                { kind: PICTURE_KIND, score: -1.5, model: PICTURE_MODEL, status: 'suggested' },
            ]);
        });

        it('does not touch the model-check score of the same face (a different kind)', () => {
            seed([{ id: 1 }]);
            testDb.prepare(`INSERT INTO face_flags (face_id, kind, score, model, status, created_at) VALUES (1, 'face_visibility', 2, 'm', 'suggested', ?)`).run(AT);

            PictureRepository.save([{ faceId: 1, score: -2.5 }], PICTURE_MODEL, AT);

            expect(testDb.prepare('SELECT kind FROM face_flags WHERE face_id = 1 ORDER BY kind').all()).toEqual([{ kind: 'face_visibility' }, { kind: 'picture' }]);
        });
    });

    describe('counts', () => {
        it('counts every face to check, how many are done or failed, and the same for the assigned faces', () => {
            seed([{ id: 1 }, { id: 2 }, { id: 3, person: 7 }, { id: 4, person: 7 }, { id: 5, ignored: 1 }]);
            PictureRepository.save([{ faceId: 1, score: -3 }, { faceId: 3, score: -3 }, { faceId: 2, score: null }], PICTURE_MODEL, AT);

            expect(PictureRepository.counts()).toEqual({ candidates: 4, scored: 2, failed: 1, assignedCandidates: 2, assignedChecked: 1 });
        });
    });
});
