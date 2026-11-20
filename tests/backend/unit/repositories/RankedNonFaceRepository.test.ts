import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyLegacyBaseline } from '../../../../electron/data/migrations/legacyBaseline';
import { faceFlagsMigration } from '../../../../electron/data/migrations/003_faceFlags';

let testDb: Database.Database;
vi.mock('../../../../electron/db', () => ({ getDB: () => testDb }));

import { RankedNonFaceRepository } from '../../../../electron/data/repositories/RankedNonFaceRepository';
import { VisibilityRepository } from '../../../../electron/data/repositories/VisibilityRepository';
import { FlagRepository } from '../../../../electron/data/repositories/FlagRepository';
import { VISIBILITY_MODEL, rankingLogit, logitForLikelihood } from '../../../../electron/core/services/visibilityModel';

const AT = '2026-11-19T10:00:00Z';
const BOX = JSON.stringify({ x: 10, y: 20, width: 30, height: 40 });

interface FaceSeed {
    id: number;
    detector?: number;
    /** The model's score; leave out for a face the model has not looked at. */
    model?: number | null;
    yaw?: number | null;
    person?: number | null;
    ignored?: number;
    entity?: string | null;
}

function seed(faces: FaceSeed[]) {
    testDb.prepare(`INSERT OR IGNORE INTO photos (id, file_path, preview_cache_path, width, height) VALUES (1, 'a.jpg', 'a_preview.jpg', 4000, 3000)`).run();
    const insert = testDb.prepare(
        `INSERT INTO faces (id, photo_id, box_json, score, face_quality, blur_score, pose_yaw, pose_pitch, person_id, is_ignored, entity_type, descriptor)
         VALUES (?, 1, ?, ?, 0.6, 100, ?, 5, ?, ?, ?, x'00')`
    );
    for (const f of faces) {
        if (f.person) testDb.prepare(`INSERT OR IGNORE INTO people (id, name) VALUES (?, 'P')`).run(f.person);
        insert.run(f.id, BOX, f.detector ?? 0.4, f.yaw === undefined ? 10 : f.yaw, f.person ?? null, f.ignored ?? 0, f.entity === undefined ? 'human' : f.entity);
        if (f.model !== undefined) VisibilityRepository.save([{ faceId: f.id, score: f.model }], VISIBILITY_MODEL, AT);
    }
}

const MIN = logitForLikelihood(70);

describe('RankedNonFaceRepository (not a face, by the model and the detector together)', () => {
    beforeEach(async () => {
        testDb = new Database(':memory:');
        await applyLegacyBaseline(testDb);
        faceFlagsMigration.up(testDb);
    });
    afterEach(() => testDb.close());

    describe('which faces are suggested', () => {
        it('lists faces the model has looked at whose likelihood reaches the cut-off, most likely first', () => {
            seed([
                { id: 1, detector: 0.3, model: 3 },
                { id: 2, detector: 0.2, model: 5 },
                { id: 3, detector: 0.7, model: -2 },
                { id: 4, detector: 0.4, model: 4 },
            ]);

            const tiles = RankedNonFaceRepository.list(MIN, 0, 50);

            const logits: Record<number, number> = { 1: rankingLogit(3, 0.3), 2: rankingLogit(5, 0.2), 3: rankingLogit(-2, 0.7), 4: rankingLogit(4, 0.4) };
            const expected = Object.keys(logits).map(Number).filter(id => logits[id] >= MIN).sort((x, y) => logits[y] - logits[x]);
            expect(expected).toContain(2);
            expect(expected).not.toContain(3);
            expect(tiles.map(t => t.faceId)).toEqual(expected);
        });

        it('carries the model score and the likelihood, next to the detector score, pose and quality', () => {
            seed([{ id: 1, detector: 0.2, model: 5, yaw: 50 }]);

            const [tile] = RankedNonFaceRepository.list(MIN, 0, 10);

            expect(tile).toMatchObject({ faceId: 1, score: 0.2, modelScore: 5, yaw: 50, quality: 0.6, filePath: 'a.jpg', box: { x: 10, y: 20, width: 30, height: 40 } });
            expect(tile.logit).toBeCloseTo(rankingLogit(5, 0.2), 9);
        });

        it('leaves out faces the model has not scored, could not score, or scored under another version', () => {
            seed([{ id: 1, detector: 0.2 }, { id: 2, detector: 0.2, model: null }, { id: 3, detector: 0.2 }]);
            VisibilityRepository.save([{ faceId: 3, score: 9 }], 'smolvlm2-older', AT);

            expect(RankedNonFaceRepository.list(MIN, 0, 10)).toEqual([]);
        });

        it('applies the same queue rule as the other list: unassigned, not ignored, human, detector below 0.75, not kept', () => {
            seed([
                { id: 1, detector: 0.2, model: 6 },
                { id: 2, detector: 0.2, model: 6, person: 9 },
                { id: 3, detector: 0.2, model: 6, ignored: 1 },
                { id: 4, detector: 0.2, model: 6, entity: 'dog' },
                { id: 5, detector: 0.8, model: 12 },
                { id: 6, detector: 0.2, model: 6 },
            ]);
            FlagRepository.dismissNonFace([6], 0.75, AT);

            expect(RankedNonFaceRepository.list(MIN, 0, 10).map(t => t.faceId)).toEqual([1]);
        });

        it('never uses pose to rank or leave out faces', () => {
            seed([{ id: 1, detector: 0.2, model: 5, yaw: 85 }, { id: 2, detector: 0.2, model: 5, yaw: null }, { id: 3, detector: 0.2, model: 5, yaw: 0 }]);

            expect(RankedNonFaceRepository.list(MIN, 0, 10).map(t => t.faceId).sort()).toEqual([1, 2, 3]);
            expect(RankedNonFaceRepository.list(MIN, 0, 10).find(t => t.faceId === 2)?.yaw).toBeNull();
        });

        it('pages with offset and limit', () => {
            seed([{ id: 1, detector: 0.2, model: 6 }, { id: 2, detector: 0.2, model: 5.5 }, { id: 3, detector: 0.2, model: 5 }]);

            expect(RankedNonFaceRepository.list(MIN, 1, 1).map(t => t.faceId)).toEqual([2]);
        });
    });

    describe('counts', () => {
        it('counts the suggestions at each cut-off and how many are turned 45 degrees or more', () => {
            seed([
                { id: 1, detector: 0.2, model: 6, yaw: 60 },
                { id: 2, detector: 0.3, model: 3, yaw: 10 },
                { id: 3, detector: 0.6, model: 1, yaw: -50 },
                { id: 4, detector: 0.5, model: 0 },
            ]);
            const cuts = [50, 70, 90].map(logitForLikelihood);

            const counts = RankedNonFaceRepository.countAtLeast(cuts);

            expect(counts.map(c => c.minLogit)).toEqual(cuts);
            expect(counts.map(c => c.total)).toEqual(cuts.map(cut => [rankingLogit(6, 0.2), rankingLogit(3, 0.3), rankingLogit(1, 0.6), rankingLogit(0, 0.5)].filter(l => l >= cut).length));
            const faces = [{ logit: rankingLogit(6, 0.2), yaw: 60 }, { logit: rankingLogit(3, 0.3), yaw: 10 }, { logit: rankingLogit(1, 0.6), yaw: -50 }, { logit: rankingLogit(0, 0.5), yaw: 10 }];
            expect(counts.map(c => c.turned)).toEqual(cuts.map(cut => faces.filter(f => f.logit >= cut && Math.abs(f.yaw) >= 45).length));
            expect(counts[0].turned).toBeGreaterThan(0);
        });

        it('is zero for every cut-off when the model has looked at nothing', () => {
            seed([{ id: 1, detector: 0.2 }]);

            expect(RankedNonFaceRepository.countAtLeast([MIN]).map(c => c.total)).toEqual([0]);
        });

        it('also counts how many of the uncertain faces the model has looked at', () => {
            seed([{ id: 1, detector: 0.2, model: 1 }, { id: 2, detector: 0.2 }, { id: 3, detector: 0.2, model: null }]);

            expect(VisibilityRepository.counts()).toEqual({ candidates: 3, scored: 1, failed: 1 });
        });
    });

    describe('ignoring and keeping', () => {
        it('ignores the suggested faces through the shared path, and the list can undo them', () => {
            seed([{ id: 1, detector: 0.2, model: 6 }, { id: 2, detector: 0.2, model: 6 }]);

            const changed = RankedNonFaceRepository.ignore([1, 2], MIN, AT);

            expect(changed.sort()).toEqual([1, 2]);
            expect(testDb.prepare('SELECT is_ignored, ignore_source FROM faces WHERE id = 1').get()).toEqual({ is_ignored: 1, ignore_source: 'user' });
            expect(FlagRepository.restoreNonFace([1])).toEqual([1]);
        });

        it('leaves alone an id that is no longer a suggestion here: assigned, ignored, kept, below the cut-off, not scored', () => {
            seed([
                { id: 1, detector: 0.2, model: 6, person: 4 },
                { id: 2, detector: 0.2, model: 6, ignored: 1 },
                { id: 3, detector: 0.2, model: 6 },
                { id: 4, detector: 0.7, model: -3 },
                { id: 5, detector: 0.2 },
            ]);
            FlagRepository.dismissNonFace([3], 0.75, AT);

            expect(RankedNonFaceRepository.ignore([1, 2, 3, 4, 5, 99], MIN, AT)).toEqual([]);
            expect(testDb.prepare('SELECT COUNT(*) AS c FROM faces WHERE is_ignored = 1').get()).toEqual({ c: 1 });
        });

        it('keeps the suggested faces so neither list offers them again', () => {
            seed([{ id: 1, detector: 0.2, model: 6 }, { id: 2, detector: 0.3, model: 0 }]);

            expect(RankedNonFaceRepository.keep([1, 2], MIN, AT)).toBe(1);

            expect(RankedNonFaceRepository.list(MIN, 0, 10)).toEqual([]);
            expect(FlagRepository.listNonFace(0.55, 0, 10).map(t => t.faceId)).toEqual([2]);
        });

        it('does nothing for an empty list', () => {
            expect(RankedNonFaceRepository.ignore([], MIN, AT)).toEqual([]);
            expect(RankedNonFaceRepository.keep([], MIN, AT)).toBe(0);
        });
    });
});
