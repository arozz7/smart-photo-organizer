/**
 * FaceService.matchFace: the match distance setting is an ordinary (square-rooted) L2 distance, lower = stricter.
 * The FAISS index reports SQUARED L2 distances, so the fallback search must be given the squared threshold and
 * its distances must be square-rooted back before they are reported.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPrepare = {
    run: vi.fn(),
    all: vi.fn((..._args: unknown[]): unknown[] => []),
    get: vi.fn()
};
const mockDBInstance = { prepare: vi.fn(() => mockPrepare), transaction: vi.fn((fn) => () => fn()) };

vi.mock('../../../../electron/data/repositories/FaceRepository', () => ({ FaceRepository: {} }));
vi.mock('../../../../electron/data/repositories/PersonRepository', () => ({
    PersonRepository: { getPeopleWithDescriptors: vi.fn(() => []) }
}));
vi.mock('../../../../electron/core/services/PersonService', () => ({ PersonService: {} }));
vi.mock('../../../../electron/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));
vi.mock('../../../../electron/db', () => ({ getDB: vi.fn(() => mockDBInstance) }));
vi.mock('../../../../electron/store', () => ({
    getAISettings: vi.fn(() => ({ faceSimilarityThreshold: 0.65 })),
    ConfigService: { getAdvancedFaceSettings: vi.fn(() => ({})) }
}));

import { FaceService } from '../../../../electron/core/services/FaceService';

describe('FaceService.matchFace FAISS fallback units', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPrepare.all.mockReturnValue([{ person_id: 2, name: 'Bob' }]);
    });

    it('asks the index for squared distances up to the squared setting', async () => {
        const searchFn = vi.fn().mockResolvedValue([[]]);

        await FaceService.matchFace([1, 0], { searchFn });

        expect(searchFn.mock.calls[0][2]).toBeCloseTo(0.65 * 0.65, 6);
    });

    it('uses the threshold given in the options, not the setting', async () => {
        const searchFn = vi.fn().mockResolvedValue([[]]);

        await FaceService.matchFace([1, 0], { searchFn, threshold: 0.5 });

        expect(searchFn.mock.calls[0][2]).toBeCloseTo(0.25, 6);
    });

    it('reports the FAISS distance as an ordinary L2 distance', async () => {
        const searchFn = vi.fn().mockResolvedValue([[{ id: 100, distance: 0.25 }]]);

        const result = await FaceService.matchFace([1, 0], { searchFn });

        expect(result?.matchType).toBe('faiss');
        expect(result?.distance).toBeCloseTo(0.5, 6);
        expect(result?.similarity).toBeCloseTo(1 / 1.5, 6);
    });
});
