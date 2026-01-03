/**
 * FaceService Unit Tests
 * 
 * Tests the FaceService class by mocking its repository and service dependencies.
 * Covers hybrid face matching (Centroids + FAISS) and auto-assignment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 1. Create stable mocks for nested objects
const mockPrepare = {
    run: vi.fn(() => ({ lastInsertRowid: 1 })),
    all: vi.fn(() => []),
    get: vi.fn(() => ({}))
};

const mockDBInstance = {
    prepare: vi.fn(() => mockPrepare),
    transaction: vi.fn((fn) => () => fn()) // Note: returns a function that calls fn
};

// 2. Mock modules
vi.mock('../../../../electron/data/repositories/FaceRepository', () => ({
    FaceRepository: {
        getFacesForClustering: vi.fn(),
        updateFacePerson: vi.fn(),
        getFacesByPhoto: vi.fn()
    }
}));

vi.mock('../../../../electron/data/repositories/PersonRepository', () => ({
    PersonRepository: {
        getPeopleWithDescriptors: vi.fn()
    }
}));

vi.mock('../../../../electron/core/services/PersonService', () => ({
    PersonService: {
        recalculatePersonMean: vi.fn()
    }
}));

vi.mock('../../../../electron/logger', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

vi.mock('../../../../electron/db', () => ({
    getDB: vi.fn(() => mockDBInstance)
}));

vi.mock('../../../../electron/store', () => ({
    getAISettings: vi.fn(() => ({ faceSimilarityThreshold: 0.65 }))
}));

import { FaceService } from '../../../../electron/core/services/FaceService';
import { FaceRepository } from '../../../../electron/data/repositories/FaceRepository';
import { PersonRepository } from '../../../../electron/data/repositories/PersonRepository';
import { PersonService } from '../../../../electron/core/services/PersonService';
import { getDB } from '../../../../electron/db';

describe('FaceService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // Helper to create a normalized descriptor
    const createNormalized = (vals: number[]) => {
        const mag = Math.sqrt(vals.reduce((a, b) => a + b * b, 0));
        return vals.map(v => v / mag);
    };

    // ==========================================
    // matchFace
    // ==========================================
    describe('matchFace', () => {
        it('should return null if descriptor is invalid', async () => {
            const result = await FaceService.matchFace(null);
            expect(result).toBeNull();
        });

        it('should match against centroids first', async () => {
            // Arrange
            const descriptor = createNormalized([1.0, 0.0]);
            const candidates = [
                { id: 1, name: 'Alice', mean: createNormalized([0.99, 0.01]) } // Very close
            ];
            vi.mocked(PersonRepository.getPeopleWithDescriptors).mockReturnValue(candidates);

            // Act
            const result = await FaceService.matchFace(descriptor);

            // Assert
            expect(result).not.toBeNull();
            expect(result!.personId).toBe(1);
            expect(result!.matchType).toBe('centroid');
            expect(result!.similarity).toBeGreaterThan(0.9);
        });

        it('should fallback to FAISS (searchFn) if centroid match fails', async () => {
            // Arrange
            const descriptor = createNormalized([1, 0]);
            vi.mocked(PersonRepository.getPeopleWithDescriptors).mockReturnValue([]);

            const searchFn = vi.fn().mockResolvedValue([
                [{ id: 100, distance: 0.1 }] // Face ID 100
            ]);

            vi.mocked(mockPrepare.all).mockReturnValue([{ person_id: 2, name: 'Bob' }]);

            // Act
            const result = await FaceService.matchFace(descriptor, { searchFn });

            // Assert
            expect(result).not.toBeNull();
            expect(result!.personId).toBe(2);
            expect(result!.matchType).toBe('faiss');
            expect(searchFn).toHaveBeenCalled();
            expect(mockDBInstance.prepare).toHaveBeenCalledWith(expect.stringContaining('FROM faces f'));
        });

        it('should return null if neither centroid nor FAISS matches', async () => {
            // Arrange
            vi.mocked(PersonRepository.getPeopleWithDescriptors).mockReturnValue([]);
            const searchFn = vi.fn().mockResolvedValue([[]]);

            // Act
            const result = await FaceService.matchFace([1, 0], { searchFn });

            // Assert
            expect(result).toBeNull();
        });
    });

    // ==========================================
    // matchBatch
    // ==========================================
    describe('matchBatch', () => {
        it('should return results for multiple descriptors using combined strategy', async () => {
            // Arrange
            const descriptors = [createNormalized([1, 0]), createNormalized([0, 1])];

            // Descriptor 0 will match Alice via centroid
            vi.mocked(PersonRepository.getPeopleWithDescriptors).mockReturnValue([
                { id: 1, name: 'Alice', mean: createNormalized([0.99, 0.01]) }
            ]);

            // Descriptor 1 will fall through to FAISS
            const searchFn = vi.fn().mockImplementation(async (pendingDescs) => {
                // Should only be called for the second descriptor
                expect(pendingDescs).toHaveLength(1);
                return [[{ id: 101, distance: 0.1 }]];
            });

            vi.mocked(mockPrepare.all).mockImplementation((...args) => {
                const faceIds = args;
                if (faceIds.includes(101)) {
                    return [{ id: 101, person_id: 3, name: 'Charlie' }];
                }
                return [];
            });

            // Act
            const results = await FaceService.matchBatch(descriptors, { searchFn });

            // Assert
            expect(results).toHaveLength(2);
            expect(results[0]!.personName).toBe('Alice');
            expect(results[0]!.matchType).toBe('centroid');
            expect(results[1]!.personName).toBe('Charlie');
            expect(results[1]!.matchType).toBe('faiss');
        });
    });

    // ==========================================
    // autoAssignFaces
    // ==========================================
    describe('autoAssignFaces', () => {
        it('should assign identifiable faces and recurse', async () => {
            // Arrange
            const faceDescriptor = createNormalized([1, 0]);
            const faces = [
                { id: 50, descriptor: faceDescriptor }
            ];
            vi.mocked(FaceRepository.getFacesForClustering)
                .mockReturnValueOnce(faces) // First pass
                .mockReturnValue([]);       // Second pass (stop)

            // Mock matchBatch to return a match for the first face
            vi.spyOn(FaceService, 'matchBatch').mockResolvedValue([
                { personId: 5, personName: 'Alice', similarity: 0.9, distance: 0.1, matchType: 'centroid' }
            ]);

            // Act
            const result = await FaceService.autoAssignFaces([50]);

            // Assert
            expect(result.success).toBe(true);
            expect(result.count).toBe(1);
            expect(FaceRepository.updateFacePerson).toHaveBeenCalledWith([50], 5);
            expect(PersonService.recalculatePersonMean).toHaveBeenCalledWith(5);
        });
    });

    // ==========================================
    // processAnalysisResult
    // ==========================================
    describe('processAnalysisResult', () => {
        it('should insert new faces and trigger auto-assign', async () => {
            // Arrange
            const photoId = 10;
            const detectedFaces = [
                { box: { x: 0, y: 0, width: 10, height: 10 }, descriptor: [1.0], blurScore: 50 }
            ];
            vi.mocked(FaceRepository.getFacesByPhoto).mockReturnValue([]);

            const aiProvider = {
                addToIndex: vi.fn(),
                searchFaces: vi.fn().mockResolvedValue([[]])
            };

            // Act
            await FaceService.processAnalysisResult(photoId, detectedFaces, 100, 100, aiProvider);

            // Assert
            expect(mockDBInstance.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO faces'));
            expect(aiProvider.addToIndex).toHaveBeenCalled();
        });

        it('should update existing faces if IoU is high', async () => {
            // Arrange
            const photoId = 10;
            const existingFaces = [
                { id: 500, box: { x: 1, y: 1, width: 10, height: 10 } }
            ];
            const detectedFaces = [
                { box: { x: 1, y: 1, width: 10, height: 10 }, descriptor: [1.0], blurScore: 50 }
            ];
            vi.mocked(FaceRepository.getFacesByPhoto).mockReturnValue(existingFaces);

            // Act
            await FaceService.processAnalysisResult(photoId, detectedFaces, 100, 100, null);

            // Assert
            expect(mockDBInstance.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE faces SET descriptor'));
        });
    });
});
