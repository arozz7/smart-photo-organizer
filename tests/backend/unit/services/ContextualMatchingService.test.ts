import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyLegacyBaseline } from '../../../../electron/data/migrations/legacyBaseline';

let testDb: Database.Database;
vi.mock('../../../../electron/db', () => ({ getDB: () => testDb }));
vi.mock('../../../../electron/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { ContextualMatchingService } from '../../../../electron/core/services/ContextualMatchingService';

/**
 * The service used to assign names unseen. It is switched to "no writes" until the reviewed-suggestions list replaces it
 * (docs/plans/contextual-suggestions-plan.md, Phase G0). The data below is the case the OLD code would have assigned
 * (a high-tier sharp frontal anchor one minute away, dates in the format datetime() produces), so a pass here proves
 * the guard, not the old bugs.
 */
describe('ContextualMatchingService (no writes until reviewed suggestions exist)', () => {
    let anchorPhoto: number;
    let targetPhoto: number;
    let targetFace: number;

    beforeEach(() => {
        testDb = new Database(':memory:');
        applyLegacyBaseline(testDb);
        testDb.prepare(`INSERT INTO people (id, name) VALUES (1, 'Mom')`).run();
        const addPhoto = testDb.prepare(
            `INSERT INTO photos (file_path, preview_cache_path, width, height, date_taken, gps_lat, gps_lon) VALUES (?, 'p.jpg', 4000, 3000, ?, ?, ?)`
        );
        anchorPhoto = Number(addPhoto.run('a.jpg', '2024-01-01 12:00:00', 10, 10).lastInsertRowid);
        targetPhoto = Number(addPhoto.run('b.jpg', '2024-01-01 12:01:00', 10, 10).lastInsertRowid);
        const addFace = testDb.prepare(
            `INSERT INTO faces (photo_id, box_json, person_id, confidence_tier, blur_score, pose_yaw, is_ignored, descriptor)
             VALUES (?, '{"x":1,"y":1,"width":10,"height":10}', ?, ?, ?, ?, 0, x'00')`
        );
        addFace.run(anchorPhoto, 1, 'high', 120, 5);
        targetFace = Number(addFace.run(targetPhoto, null, 'unknown', 120, 70).lastInsertRowid);
    });

    afterEach(() => testDb.close());

    const target = () =>
        testDb.prepare('SELECT person_id, assignment_source, confidence_tier FROM faces WHERE id = ?').get(targetFace) as
            { person_id: number | null; assignment_source: string | null; confidence_tier: string | null };

    it('batch pass assigns nothing and says why', () => {
        const result = ContextualMatchingService.batchPropagateForLibrary();

        expect(result).toMatchObject({ success: true, propagated: 0, skipped: 0, disabled: true });
        expect(result.message).toMatch(/nothing was assigned/i);
        expect(target().person_id).toBeNull();
    });

    it('temporal pass assigns nothing', () => {
        const result = ContextualMatchingService.propagateTemporalLabels(targetPhoto);

        expect(result).toMatchObject({ success: true, propagated: 0, disabled: true });
        expect(target()).toEqual({ person_id: null, assignment_source: 'manual', confidence_tier: 'unknown' });
    });

    it('spatial pass assigns nothing', () => {
        const result = ContextualMatchingService.propagateSpatialLabels(targetPhoto);

        expect(result).toMatchObject({ success: true, propagated: 0, disabled: true });
        expect(target().person_id).toBeNull();
    });
});
