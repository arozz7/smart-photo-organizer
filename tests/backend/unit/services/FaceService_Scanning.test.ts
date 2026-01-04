
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks
const mockRun = vi.fn().mockReturnValue({ lastInsertRowid: 1 });
const mockAll = vi.fn().mockReturnValue([]);
const mockGet = vi.fn().mockReturnValue(null);
const mockPrepare = {
    run: mockRun,
    all: mockAll,
    get: mockGet
};
const mockDBInstance = {
    prepare: vi.fn(() => mockPrepare),
    transaction: vi.fn((fn) => () => fn())
};

vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => 'C:\\tmp')
    }
}));

vi.mock('../../../../electron/data/repositories/FaceRepository', () => ({
    FaceRepository: {
        getFacesByPhoto: vi.fn().mockReturnValue([]),
        getFacesByIds: vi.fn().mockReturnValue([]) // Add this if needed
    }
}));

vi.mock('../../../../electron/db', () => ({
    getDB: vi.fn(() => mockDBInstance)
}));

vi.mock('../../../../electron/store', () => ({
    getAISettings: vi.fn(() => ({ faceSimilarityThreshold: 0.65 }))
}));

// We need to mock FaceService methods if we want to spy on them, 
// but we want to test processAnalysisResult logic which calls matchBatch.
// mocking matchBatch might be easier to control results.
// But we want to ensure processAnalysisResult uses the result of matchBatch correctly.

import { FaceService } from '../../../../electron/core/services/FaceService';

describe('FaceService Scanning Verification', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should persist "review" confidence tier when distance is 0.8', async () => {
        // Arrange
        const photoId = 123;
        const faces = [{
            box: { x: 0, y: 0, width: 100, height: 100 },
            descriptor: Array(128).fill(0.1),
            blurScore: 100
        }];

        // Mock matchBatch to return a "Review" tier match
        // distance 0.5 is between 0.4 and 0.6
        vi.spyOn(FaceService, 'matchBatch').mockResolvedValue([
            {
                personId: 10,
                personName: 'Test Person',
                similarity: 0.55,
                distance: 0.8,
                matchType: 'faiss'
            }
        ]);

        const mockAiProvider = { addToIndex: vi.fn(), searchFaces: vi.fn() };
        // Act
        await FaceService.processAnalysisResult(photoId, faces, 1000, 1000, mockAiProvider as any);

        // Assert
        // Check "INSERT INTO faces" args
        const calls = mockRun.mock.calls;
        const insertCall = calls.find(args => args.length > 5); // Insert has ~8 args

        expect(insertCall).toBeDefined();
        // The query params order:
        // photo_id, person_id, descriptor, box, blur, confidence, suggested, distance

        // Index 5 is confidence_tier
        expect(insertCall[5]).toBe('review');
    });

    it('should persist "high" confidence tier when distance is 0.2', async () => {
        // Arrange
        const photoId = 124;
        const faces = [{
            box: { x: 0, y: 0, width: 100, height: 100 },
            descriptor: Array(128).fill(0.1),
            blurScore: 100
        }];

        // Mock matchBatch to return a "High" tier match
        vi.spyOn(FaceService, 'matchBatch').mockResolvedValue([
            {
                personId: 11,
                personName: 'High Confidence Person',
                similarity: 0.9,
                distance: 0.2,
                matchType: 'faiss'
            }
        ]);

        const mockAiProvider = { addToIndex: vi.fn(), searchFaces: vi.fn() };
        // Act
        await FaceService.processAnalysisResult(photoId, faces, 1000, 1000, mockAiProvider as any);

        // Assert
        const calls = mockRun.mock.calls;
        const insertCall = calls.find(args => args.length > 5);

        expect(insertCall).toBeDefined();
        expect(insertCall[5]).toBe('high');
        expect(insertCall[1]).toBe(11); // Person ID should be assigned automatically
    });
});
