import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyLegacyBaseline } from '../../../../electron/data/migrations/legacyBaseline';
import { faceFlagsMigration } from '../../../../electron/data/migrations/003_faceFlags';

let testDb: Database.Database;
vi.mock('../../../../electron/db', () => ({ getDB: () => testDb }));

import { VisibilityRepository, VISIBILITY_MAX_DETECTOR_SCORE, VISIBILITY_KIND, VISIBILITY_MODEL } from '../../../../electron/data/repositories/VisibilityRepository';
import { FlagRepository } from '../../../../electron/data/repositories/FlagRepository';

interface FaceSeed {
    id: number;
    score?: number | null;
    person?: number | null;
    ignored?: number;
    entity?: string | null;
}

const BOX = JSON.stringify({ x: 10, y: 20, width: 30, height: 40 });
const AT = '2026-11-19T10:00:00Z';

function seed(faces: FaceSeed[], photo: { preview: string | null } = { preview: 'a_preview.jpg' }) {
    testDb.prepare(`INSERT OR IGNORE INTO photos (id, file_path, preview_cache_path, width, height) VALUES (1, 'a.jpg', ?, 4000, 3000)`).run(photo.preview);
    const insert = testDb.prepare(
        `INSERT INTO faces (id, photo_id, box_json, score, person_id, is_ignored, entity_type, descriptor) VALUES (?, 1, ?, ?, ?, ?, ?, x'00')`
    );
    for (const f of faces) {
        if (f.person) testDb.prepare(`INSERT OR IGNORE INTO people (id, name) VALUES (?, 'P')`).run(f.person);
        insert.run(f.id, BOX, f.score === undefined ? 0.5 : f.score, f.person ?? null, f.ignored ?? 0, f.entity === undefined ? 'human' : f.entity);
    }
}

describe('VisibilityRepository', () => {
    beforeEach(async () => {
        testDb = new Database(':memory:');
        await applyLegacyBaseline(testDb);
        faceFlagsMigration.up(testDb);
    });
    afterEach(() => testDb.close());

    describe('which faces need a look from the model', () => {
        it('are the unassigned, not ignored, human faces with a detector score below the limit, most uncertain first', () => {
            seed([
                { id: 1, score: 0.7 },
                { id: 2, score: 0.2 },
                { id: 3, score: VISIBILITY_MAX_DETECTOR_SCORE },
                { id: 4, score: 0.9 },
                { id: 5, score: 0.3, person: 9 },
                { id: 6, score: 0.3, ignored: 1 },
                { id: 7, score: 0.3, entity: 'dog' },
                { id: 8, score: null },
                { id: 9, score: 0.4 },
            ]);

            expect(VisibilityRepository.loadDue(100).map(f => f.id)).toEqual([2, 9, 1]);
        });

        it('gives the box, the photo width and the preview and photo paths', () => {
            seed([{ id: 1 }]);

            expect(VisibilityRepository.loadDue(1)[0]).toEqual({
                id: 1, box: { x: 10, y: 20, width: 30, height: 40 }, photoWidth: 4000, previewPath: 'a_preview.jpg', filePath: 'a.jpg',
            });
        });

        it('leaves out faces that already have a score or a failed attempt, and faces the user kept', () => {
            seed([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
            VisibilityRepository.save([{ faceId: 1, score: 2.5 }, { faceId: 2, score: null }], VISIBILITY_MODEL, AT);
            FlagRepository.dismissNonFace([4], 0.75, AT);

            expect(VisibilityRepository.loadDue(100).map(f => f.id)).toEqual([3]);
        });

        it('offers again a face that only has a score from another version of the model', () => {
            seed([{ id: 1 }, { id: 2 }]);
            VisibilityRepository.save([{ faceId: 1, score: 1 }], 'older-model', AT);
            VisibilityRepository.save([{ faceId: 2, score: 1 }], VISIBILITY_MODEL, AT);

            expect(VisibilityRepository.loadDue(10).map(f => f.id)).toEqual([1]);
        });

        it('pages with the limit', () => {
            seed([{ id: 1, score: 0.1 }, { id: 2, score: 0.2 }, { id: 3, score: 0.3 }]);

            expect(VisibilityRepository.loadDue(2).map(f => f.id)).toEqual([1, 2]);
        });
    });

    describe('saving scores', () => {
        it('stores the score and model once per face and replaces an older one', () => {
            seed([{ id: 1 }]);
            VisibilityRepository.save([{ faceId: 1, score: 1.25 }], 'model-a', AT);
            VisibilityRepository.save([{ faceId: 1, score: -0.5 }], 'model-b', '2026-11-20T10:00:00Z');

            expect(testDb.prepare('SELECT face_id, kind, score, model, status, created_at FROM face_flags').all()).toEqual([
                { face_id: 1, kind: VISIBILITY_KIND, score: -0.5, model: 'model-b', status: 'suggested', created_at: '2026-11-20T10:00:00Z' },
            ]);
        });

        it('stores a face that could not be scored with no score, so it is not tried again', () => {
            seed([{ id: 1 }]);

            VisibilityRepository.save([{ faceId: 1, score: null }], VISIBILITY_MODEL, AT);

            expect(testDb.prepare('SELECT score FROM face_flags WHERE face_id = 1').get()).toEqual({ score: null });
            expect(VisibilityRepository.loadDue(10)).toEqual([]);
        });

        it('does not disturb a face the user kept or ignored through the list', () => {
            seed([{ id: 1 }]);
            FlagRepository.dismissNonFace([1], 0.75, AT);

            VisibilityRepository.save([{ faceId: 1, score: 3 }], VISIBILITY_MODEL, AT);

            expect(testDb.prepare('SELECT kind, status FROM face_flags WHERE face_id = 1 ORDER BY kind').all()).toEqual([
                { kind: VISIBILITY_KIND, status: 'suggested' },
                { kind: 'non_face', status: 'dismissed' },
            ]);
        });

        it('stores nothing for an empty list', () => {
            VisibilityRepository.save([], VISIBILITY_MODEL, AT);

            expect(testDb.prepare('SELECT COUNT(*) AS c FROM face_flags').get()).toEqual({ c: 0 });
        });
    });

    describe('counts', () => {
        it('counts the faces that need a look, how many have a score and how many failed', () => {
            seed([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5, score: 0.95 }]);
            VisibilityRepository.save([{ faceId: 1, score: 1 }, { faceId: 2, score: null }], VISIBILITY_MODEL, AT);

            expect(VisibilityRepository.counts()).toEqual({ candidates: 4, scored: 1, failed: 1 });
        });

        it('does not count scores of faces that have since been named or ignored', () => {
            seed([{ id: 1 }, { id: 2 }]);
            VisibilityRepository.save([{ faceId: 1, score: 1 }, { faceId: 2, score: 1 }], VISIBILITY_MODEL, AT);
            testDb.prepare('UPDATE faces SET is_ignored = 1 WHERE id = 1').run();

            expect(VisibilityRepository.counts()).toEqual({ candidates: 1, scored: 1, failed: 0 });
        });

        it('does not count scores from another version of the model', () => {
            seed([{ id: 1 }, { id: 2 }]);
            VisibilityRepository.save([{ faceId: 1, score: 1 }], 'older-model', AT);
            VisibilityRepository.save([{ faceId: 2, score: 1 }], VISIBILITY_MODEL, AT);

            expect(VisibilityRepository.counts()).toEqual({ candidates: 2, scored: 1, failed: 0 });
        });

        it('is all zeros for an empty library', () => {
            expect(VisibilityRepository.counts()).toEqual({ candidates: 0, scored: 0, failed: 0 });
        });
    });
});
