/**
 * Characterization tests for FaceService.processAnalysisResult against a real in-memory library.
 * They pin what the scan does with a photo's detections today (insert, update, reject, prune) so the method can be
 * split into smaller pieces without changing behavior.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyLegacyBaseline } from '../../../../electron/data/migrations/legacyBaseline';

let testDb: Database.Database;
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => 'C:\\tmp') } }));
vi.mock('../../../../electron/db', () => ({ getDB: () => testDb }));
vi.mock('../../../../electron/store', () => ({
    getAISettings: vi.fn(() => ({ autoAssignThreshold: 0.7, reviewThreshold: 0.9 })),
    ConfigService: {
        getAdvancedFaceSettings: vi.fn(() => ({ scoreThresholdReject: 0.4, scoreThresholdAccept: 0.7, dedupIoUThresh: 0.55 })),
    },
}));

import { FaceService } from '../../../../electron/core/services/FaceService';
import { ConfigService } from '../../../../electron/store';

const PHOTO = 1;
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

interface Detection { box: ReturnType<typeof box>; score?: number; descriptor?: number[] }
interface Existing {
    id: number; box: ReturnType<typeof box>; score?: number; confirmed?: number; ignored?: number;
    person?: number | null; entity?: string; source?: string;
}

function seedExisting(faces: Existing[]) {
    const insert = testDb.prepare(`INSERT INTO faces (id, photo_id, box_json, descriptor, person_id, is_ignored, is_confirmed, score, entity_type, assignment_source, confidence_tier)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown')`);
    for (const f of faces) {
        if (f.person) testDb.prepare(`INSERT OR IGNORE INTO people (id, name) VALUES (?, 'Person ' || ?)`).run(f.person, f.person);
        insert.run(f.id, PHOTO, JSON.stringify(f.box), Buffer.from(new Float32Array([0.5, 0.5]).buffer), f.person ?? null, f.ignored ?? 0,
            f.confirmed ?? 0, f.score ?? 0.9, f.entity ?? 'human', f.source ?? 'ai_scan');
    }
}

/** Runs one scan of the photo; `matches` has one entry per detection that has a descriptor (null = no person nearby). */
async function scan(detections: Detection[], matches: ({ personId: number; distance: number } | null)[] = []) {
    vi.spyOn(FaceService, 'matchBatch').mockResolvedValue(matches.map(m => (m ? { personId: m.personId, personName: 'P', similarity: 0.9, distance: m.distance, matchType: 'faiss' as const } : null)));
    const faces = detections.map(d => ({ descriptor: [0.1, 0.2, 0.3], blurScore: 100, ...d }));
    await FaceService.processAnalysisResult(PHOTO, faces as never, 4000, 3000, { searchFaces: vi.fn() });
}

const rows = () => testDb.prepare('SELECT * FROM faces WHERE photo_id = ? ORDER BY id').all(PHOTO) as Record<string, unknown>[];
const ids = () => rows().map(r => r.id);

describe('FaceService.processAnalysisResult (characterization)', () => {
    beforeEach(() => {
        testDb = new Database(':memory:');
        applyLegacyBaseline(testDb);
        testDb.prepare(`INSERT INTO photos (id, file_path, preview_cache_path, width, height) VALUES (?, 'a.jpg', 'a_preview.jpg', 1, 1)`).run(PHOTO);
    });
    afterEach(() => { testDb.close(); vi.restoreAllMocks(); });

    describe('a new detection', () => {
        it('is inserted as a human face when the detector is sure, queued for grouping', async () => {
            await scan([{ box: box(100, 100, 200, 220), score: 0.9 }], [null]);

            expect(rows()).toHaveLength(1);
            expect(rows()[0]).toMatchObject({ entity_type: 'human', person_id: null, needs_bucketing: 1, verification_attempts: 0 });
        });

        it('is inserted as a suspect when the score is between the reject and accept lines', async () => {
            await scan([{ box: box(100, 100, 200, 220), score: 0.55 }], [null]);

            expect(rows()[0]).toMatchObject({ entity_type: 'suspect' });
        });

        it('is rejected when the score is below the reject line and the box is small', async () => {
            await scan([{ box: box(100, 100, 200, 220), score: 0.3 }], [null]);

            expect(rows()).toHaveLength(0);
        });

        it('is kept as a suspect when it is a large face with a low score (the low-score exception)', async () => {
            await scan([{ box: box(100, 100, 400, 420), score: 0.3 }], [null]);

            expect(rows()).toHaveLength(1);
            expect(rows()[0]).toMatchObject({ entity_type: 'suspect' });
        });

        it('follows the large-face setting: with the width raised to 500, a 400px low-score box is rejected', async () => {
            vi.mocked(ConfigService.getAdvancedFaceSettings).mockReturnValueOnce({ scoreThresholdReject: 0.4, scoreThresholdAccept: 0.7, dedupIoUThresh: 0.55, largeFaceThreshold: 500 } as never);

            await scan([{ box: box(100, 100, 400, 420), score: 0.3 }], [null]);

            expect(rows()).toHaveLength(0);
        });

        it('is rejected when it is large but the score is under 0.15', async () => {
            await scan([{ box: box(100, 100, 400, 420), score: 0.12 }], [null]);

            expect(rows()).toHaveLength(0);
        });

        it('is skipped when it sits inside a face the user or the vision check threw out (rejection memory)', async () => {
            seedExisting([{ id: 10, box: box(0, 0, 200, 200), ignored: 1, confirmed: 1 }]);

            await scan([{ box: box(20, 20, 100, 100), score: 0.9 }], [null]);

            expect(ids()).toEqual([10]);
        });

        // Current behavior, pinned before the refactor: the comment on the rejection memory says ignored faces must not be
        // deleted, but an unconfirmed ignored face that no new detection matches is removed by the orphan cleanup at the end of the scan.
        it('currently removes an unconfirmed ignored face that no detection matches, even though it still blocks the new detection', async () => {
            seedExisting([{ id: 10, box: box(0, 0, 200, 200), ignored: 1 }]);

            await scan([{ box: box(20, 20, 100, 100), score: 0.9 }], [null]);

            expect(rows()).toHaveLength(0);
        });
    });

    describe('a scan of a photo that already has faces', () => {
        it('updates the face under the same box instead of adding a second one, and keeps its person', async () => {
            seedExisting([{ id: 10, box: box(100, 100, 200, 220), person: 4, confirmed: 1, source: 'manual' }]);

            await scan([{ box: box(102, 101, 200, 220), score: 0.9 }], [null]);

            expect(ids()).toEqual([10]);
            expect(rows()[0]).toMatchObject({ person_id: 4, is_confirmed: 1, assignment_source: 'manual' });
        });

        it('gives an unassigned face its person when a close match is found for a sure detection', async () => {
            seedExisting([{ id: 10, box: box(100, 100, 200, 220) }]);
            testDb.prepare(`INSERT INTO people (id, name) VALUES (7, 'Person 7')`).run();

            await scan([{ box: box(100, 100, 200, 220), score: 0.9 }], [{ personId: 7, distance: 0.2 }]);

            expect(rows()[0]).toMatchObject({ person_id: 7, confidence_tier: 'high', suggested_person_id: 7 });
        });

        it('adds a detection as a new face when another detection already took the existing one (clash)', async () => {
            seedExisting([{ id: 10, box: box(100, 100, 200, 220) }]);

            await scan([{ box: box(100, 100, 200, 220), score: 0.9 }, { box: box(105, 105, 200, 220), score: 0.8 }], [null, null]);

            expect(rows()).toHaveLength(2);
            expect(ids()[0]).toBe(10);
        });

        it('removes an unconfirmed face the new scan no longer finds', async () => {
            seedExisting([{ id: 10, box: box(1500, 1500, 200, 220) }]);

            await scan([{ box: box(100, 100, 200, 220), score: 0.9 }], [null]);

            expect(ids()).not.toContain(10);
            expect(rows()).toHaveLength(1);
        });

        it('keeps a confirmed face the new scan no longer finds', async () => {
            seedExisting([{ id: 10, box: box(1500, 1500, 200, 220), person: 4, confirmed: 1 }]);

            await scan([{ box: box(100, 100, 200, 220), score: 0.9 }], [null]);

            expect(ids()).toContain(10);
        });
    });

    describe('overlapping faces already stored for the photo', () => {
        it('deletes the lower-scoring one of two unconfirmed faces on top of each other', async () => {
            seedExisting([{ id: 10, box: box(100, 100, 200, 220), score: 0.6 }, { id: 11, box: box(102, 102, 200, 220), score: 0.9 }]);

            await scan([{ box: box(102, 102, 200, 220), score: 0.9 }], [null]);

            expect(ids()).toEqual([11]);
        });

        it('keeps the confirmed one when it is the lower-scoring of the two', async () => {
            seedExisting([{ id: 10, box: box(100, 100, 200, 220), score: 0.6, confirmed: 1, person: 4 }, { id: 11, box: box(102, 102, 200, 220), score: 0.9 }]);

            await scan([{ box: box(100, 100, 200, 220), score: 0.6 }], [null]);

            expect(ids()).toEqual([10]);
        });
    });

    it('stores the photo size it was given', async () => {
        await scan([], []);

        expect(testDb.prepare('SELECT width, height FROM photos WHERE id = ?').get(PHOTO)).toEqual({ width: 4000, height: 3000 });
    });
});
