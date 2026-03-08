/**
 * PersonService Unit Tests
 * 
 * Tests the PersonService class by mocking its repository dependencies.
 * Following testing-master.md guidelines: Test Behavior, Not Implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 1. Mock dependencies before importing the service
vi.mock('../../../../electron/data/repositories/PersonRepository', () => ({
    PersonRepository: {
        updateDescriptorMean: vi.fn(),
        updatePoseCentroids: vi.fn(),
        deletePerson: vi.fn(),
        getPeople: vi.fn(),
        getPersonByName: vi.fn(),
        createPerson: vi.fn(),
        updatePersonName: vi.fn(),
        getPerson: vi.fn(),
        addHistorySnapshot: vi.fn(),
        refreshPersonCover: vi.fn(),
        addAlert: vi.fn()
    }
}));

vi.mock('../../../../electron/data/repositories/FaceRepository', () => ({
    FaceRepository: {
        getAllFaces: vi.fn(),
        updateFacePerson: vi.fn(),
        getConfirmedFaces: vi.fn()
    }
}));

vi.mock('../../../../electron/logger', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
    }
}));

vi.mock('../../../../electron/core/services/FaceAnalysisService', () => ({
    FaceAnalysisService: {
        consensusVoting: vi.fn(),
        getQualityAdjustedThreshold: vi.fn()
    }
}));

vi.mock('../../../../electron/store', () => ({
    getAISettings: vi.fn(() => ({ faceBlurThreshold: 20 }))
}));

// Mock DB to avoid real connection attempts (fixes timeout)
vi.mock('../../../../electron/db', () => ({
    getDB: vi.fn(() => ({
        transaction: vi.fn((fn) => () => fn())
    }))
}));

// Mock console.time and console.timeEnd to avoid cluttering test output
vi.spyOn(console, 'time').mockImplementation(() => { });
vi.spyOn(console, 'timeEnd').mockImplementation(() => { });

import { PersonService } from '../../../../electron/core/services/PersonService';
import { PersonRepository } from '../../../../electron/data/repositories/PersonRepository';
import { FaceRepository } from '../../../../electron/data/repositories/FaceRepository';
import { getDB } from '../../../../electron/db';

describe('PersonService', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    beforeEach(() => {
        // Default mock: return empty array for confirmed faces to prevent undefined crashes
        vi.mocked(FaceRepository.getConfirmedFaces).mockReturnValue([]);
    });

    // ==========================================
    // recalculatePersonMean
    // ==========================================
    describe('recalculatePersonMean', () => {
        it('should update mean to null if no valid faces are found', async () => {
            // Arrange
            vi.mocked(FaceRepository.getConfirmedFaces).mockReturnValue([]);

            // Act
            await PersonService.recalculatePersonMean(1);

            // Assert
            expect(PersonRepository.updateDescriptorMean).toHaveBeenCalledWith(1, null);
        });

        it('should filter out faces with low blur scores', async () => {
            // Arrange
            const faces = [
                { id: 1, descriptor: [1, 0, 0], blur_score: 5, photo_id: 1, box_json: '{}', file_path: 'a.jpg' },  // Blurry (threshold is 20)
                { id: 2, descriptor: [0, 1, 0], blur_score: 50, photo_id: 2, box_json: '{}', file_path: 'b.jpg' }, // Clear
            ];
            vi.mocked(FaceRepository.getConfirmedFaces).mockReturnValue(faces as any);

            // Act
            await PersonService.recalculatePersonMean(1);

            // Assert
            // Only the second face should be used, mean of [0, 1, 0] is [0, 1, 0]
            expect(PersonRepository.updateDescriptorMean).toHaveBeenCalledWith(1, JSON.stringify([0, 1, 0]));
        });

        it('should calculate normalized mean of multiple descriptors', async () => {
            // Arrange
            const faces = [
                { id: 1, descriptor: [1, 0, 0], blur_score: 50, photo_id: 1, box_json: '{}', file_path: 'a.jpg' },
                { id: 2, descriptor: [0, 1, 0], blur_score: 50, photo_id: 2, box_json: '{}', file_path: 'b.jpg' },
            ];
            vi.mocked(FaceRepository.getConfirmedFaces).mockReturnValue(faces as any);

            // Act
            await PersonService.recalculatePersonMean(1);

            // Assert
            // Mean = [0.5, 0.5, 0], Normalized = [0.7071..., 0.7071..., 0]
            const call = vi.mocked(PersonRepository.updateDescriptorMean).mock.calls[0];
            const resultMean = JSON.parse(call[1] as string);
            expect(resultMean[0]).toBeCloseTo(0.7071);
            expect(resultMean[1]).toBeCloseTo(0.7071);
        });

        it('should use ONLY confirmed faces for mean calculation (Phase 0.5)', async () => {
            // Arrange
            // getAllFaces should NOT be used for centroid
            vi.mocked(FaceRepository.getAllFaces).mockReturnValue([]);

            const confirmedFaces = [
                { id: 1, descriptor: [1, 0, 0], blur_score: 50, photo_id: 1, box_json: '{}', file_path: 'a.jpg' },
                { id: 2, descriptor: [0, 1, 0], blur_score: 50, photo_id: 2, box_json: '{}', file_path: 'b.jpg' },
            ];
            vi.mocked(FaceRepository.getConfirmedFaces).mockReturnValue(confirmedFaces as any);

            // Act
            await PersonService.recalculatePersonMean(1);

            // Assert
            expect(FaceRepository.getConfirmedFaces).toHaveBeenCalledWith(1);
            // Should normalize mean of [1,0,0] and [0,1,0] -> [0.707, 0.707, 0]
            expect(PersonRepository.updateDescriptorMean).toHaveBeenCalledWith(1, expect.stringContaining('0.707'));
        });
    });

    // ==========================================
    // mergePeople
    // ==========================================
    describe('mergePeople', () => {
        it('should move faces and delete old person', async () => {
            // Arrange
            const fromId = 1;
            const toId = 2;
            vi.mocked(FaceRepository.getAllFaces).mockReturnValue([{ id: 10 }, { id: 11 }]);

            // Act
            await PersonService.mergePeople(fromId, toId);

            // Assert
            expect(FaceRepository.updateFacePerson).toHaveBeenCalledWith([10, 11], toId, true);
            expect(PersonRepository.deletePerson).toHaveBeenCalledWith(fromId);
            // Should also trigger recalc for target (using Phase 3 logic: getConfirmedFaces)
            expect(FaceRepository.getConfirmedFaces).toHaveBeenCalledWith(toId);
        });

        it('should do nothing if fromId and toId are same', async () => {
            // Act
            await PersonService.mergePeople(1, 1);

            // Assert
            expect(FaceRepository.updateFacePerson).not.toHaveBeenCalled();
            expect(PersonRepository.deletePerson).not.toHaveBeenCalled();
        });
    });

    // ==========================================
    // recalculateAllMeans
    // ==========================================
    describe('recalculateAllMeans', () => {
        it('should iterate through all people and recalc', async () => {
            // Arrange
            vi.mocked(PersonRepository.getPeople).mockReturnValue([{ id: 1 }, { id: 2 }]);
            // getAllFaces/getConfirmedFaces will be called
            vi.mocked(FaceRepository.getConfirmedFaces).mockReturnValue([]);

            // Act
            const result = await PersonService.recalculateAllMeans();

            // Assert
            expect(result.count).toBe(2);
            expect(PersonRepository.updateDescriptorMean).toHaveBeenCalledTimes(2);
            expect(PersonRepository.updateDescriptorMean).toHaveBeenCalledWith(1, null);
            expect(PersonRepository.updateDescriptorMean).toHaveBeenCalledWith(2, null);
        });
    });

    // ==========================================
    // assignPerson
    // ==========================================
    describe('assignPerson', () => {
        it('should use existing person if found', async () => {
            // Arrange
            const person = { id: 5, name: 'Alice' };
            vi.mocked(PersonRepository.getPersonByName).mockReturnValue(person);

            // Act
            const result = await PersonService.assignPerson(100, 'Alice');

            // Assert
            expect(PersonRepository.createPerson).not.toHaveBeenCalled();
            expect(FaceRepository.updateFacePerson).toHaveBeenCalledWith([100], 5, true);
            expect(result.person).toEqual(person);
        });

        it('should create new person if not found', async () => {
            // Arrange
            const person = { id: 6, name: 'Bob' };
            vi.mocked(PersonRepository.getPersonByName).mockReturnValue(undefined);
            vi.mocked(PersonRepository.createPerson).mockReturnValue(person);

            // Act
            await PersonService.assignPerson(100, 'Bob');

            // Assert
            expect(PersonRepository.createPerson).toHaveBeenCalledWith('Bob');
            expect(FaceRepository.updateFacePerson).toHaveBeenCalledWith([100], 6, true);
        });
    });

    // ==========================================
    // renamePerson
    // ==========================================
    describe('renamePerson', () => {
        it('should update name if no name conflict', async () => {
            // Arrange
            vi.mocked(PersonRepository.getPersonByName).mockReturnValue(undefined);

            // Act
            const result = await PersonService.renamePerson(1, 'New Name');

            // Assert
            expect(PersonRepository.updatePersonName).toHaveBeenCalledWith(1, 'New Name');
            expect((result as any).success).toBe(true);
            expect((result as any).merged).toBe(false);
        });

        it('should merge if name conflict exists', async () => {
            // Arrange
            const existing = { id: 2, name: 'Target' };
            vi.mocked(PersonRepository.getPersonByName).mockReturnValue(existing);
            vi.mocked(FaceRepository.getAllFaces).mockReturnValue([]);

            // Act
            await PersonService.renamePerson(1, 'Target');

            // Assert
            expect(PersonRepository.deletePerson).toHaveBeenCalledWith(1);
            expect(FaceRepository.updateFacePerson).not.toHaveBeenCalled(); // No faces in mock (getAllFaces not called, getConfirmedFaces not called except inside recalc)
        });
    });
});
