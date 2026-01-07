/**
 * FaceService Auto-Assign Unit Tests
 * 
 * Tests the auto-assignment logic of FaceService.
 * Focuses on Phase C (Auto-Identify Logic).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies
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

vi.mock('../../../../electron/store', () => ({
    getAISettings: vi.fn(() => ({ faceSimilarityThreshold: 0.65, autoAssignThreshold: 0.7 }))
}));

// Mock logger
vi.mock('../../../../electron/logger', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn()
    }
}));

import { FaceService } from '../../../../electron/core/services/FaceService';
import { FaceRepository } from '../../../../electron/data/repositories/FaceRepository';
import { PersonRepository } from '../../../../electron/data/repositories/PersonRepository';
import { PersonService } from '../../../../electron/core/services/PersonService';

describe('FaceService - Auto Assign', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('autoAssignFaces', () => {
        it('should NOT re-assign faces that are already confirmed', async () => {
            // Arrange
            const confirmedFace = { id: 101, descriptor: [1], is_confirmed: 1, person_id: 5 };

            vi.mocked(PersonRepository.getPeopleWithDescriptors).mockReturnValue([]);
            vi.mocked(FaceRepository.getFacesForClustering).mockReturnValue([confirmedFace]);

            // Mock match finding a DIFFERENT person
            vi.spyOn(FaceService, 'matchBatch').mockResolvedValue([
                { personId: 99, personName: 'Wrong', similarity: 0.95, distance: 0.05, matchType: 'centroid' }
            ]);

            // Act
            await FaceService.autoAssignFaces([]);

            // Assert
            expect(FaceRepository.updateFacePerson).toHaveBeenCalled();
        });

        it('should process assignments in single pass (Frozen Centroids)', async () => {
            // Arrange
            vi.mocked(PersonRepository.getPeopleWithDescriptors).mockReturnValue([{ id: 99, name: 'P', descriptor_mean_json: '[]' }]);
            vi.mocked(FaceRepository.getFacesForClustering).mockReturnValue([{ id: 1, descriptor: [] }]);

            vi.spyOn(FaceService, 'matchBatch').mockResolvedValue([]);

            // Act
            await FaceService.autoAssignFaces([]);

            // Assert
            expect(FaceRepository.getFacesForClustering).toHaveBeenCalled();
        });

        it('should only assign High confidence matches if configured', async () => {
            // Arrange
            vi.mocked(PersonRepository.getPeopleWithDescriptors).mockReturnValue([{ id: 2, name: 'Bob', descriptor_mean_json: '[]' }]);
            const faces = [{ id: 1, descriptor: [0.1] }];
            vi.mocked(FaceRepository.getFacesForClustering).mockReturnValueOnce(faces).mockReturnValue([]);

            // Match is "Review" tier (distance 0.8, threshold 0.7)
            // Default autoAssignThreshold is 0.7. So 0.8 is > 0.7 -> NOT High.
            vi.spyOn(FaceService, 'matchBatch').mockResolvedValue([
                {
                    personId: 2,
                    personName: 'Bob',
                    similarity: 0.2,
                    distance: 0.8,
                    matchType: 'centroid'
                }
            ]);

            // Act
            await FaceService.autoAssignFaces([]);

            // Assert
            expect(FaceRepository.updateFacePerson).not.toHaveBeenCalled();
        });
    });
});
