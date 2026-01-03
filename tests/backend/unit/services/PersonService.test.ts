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
        deletePerson: vi.fn(),
        getPeople: vi.fn(),
        getPersonByName: vi.fn(),
        createPerson: vi.fn(),
        updatePersonName: vi.fn()
    }
}));

vi.mock('../../../../electron/data/repositories/FaceRepository', () => ({
    FaceRepository: {
        getAllFaces: vi.fn(),
        updateFacePerson: vi.fn()
    }
}));

vi.mock('../../../../electron/store', () => ({
    getAISettings: vi.fn(() => ({ faceBlurThreshold: 20 }))
}));

// Mock console.time and console.timeEnd to avoid cluttering test output
vi.spyOn(console, 'time').mockImplementation(() => { });
vi.spyOn(console, 'timeEnd').mockImplementation(() => { });

import { PersonService } from '../../../../electron/core/services/PersonService';
import { PersonRepository } from '../../../../electron/data/repositories/PersonRepository';
import { FaceRepository } from '../../../../electron/data/repositories/FaceRepository';

describe('PersonService', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    // ==========================================
    // recalculatePersonMean
    // ==========================================
    describe('recalculatePersonMean', () => {
        it('should update mean to null if no valid faces are found', async () => {
            // Arrange
            vi.mocked(FaceRepository.getAllFaces).mockReturnValue([]);

            // Act
            await PersonService.recalculatePersonMean(1);

            // Assert
            expect(PersonRepository.updateDescriptorMean).toHaveBeenCalledWith(1, null);
        });

        it('should filter out faces with low blur scores', async () => {
            // Arrange
            const faces = [
                { descriptor: [1, 0], blur_score: 5 },  // Blurry (threshold is 20)
                { descriptor: [0, 1], blur_score: 50 }, // Clear
            ];
            vi.mocked(FaceRepository.getAllFaces).mockReturnValue(faces);

            // Act
            await PersonService.recalculatePersonMean(1);

            // Assert
            // Only the second face should be used, mean of [0, 1] is [0, 1]
            expect(PersonRepository.updateDescriptorMean).toHaveBeenCalledWith(1, JSON.stringify([0, 1]));
        });

        it('should calculate normalized mean of multiple descriptors', async () => {
            // Arrange
            const faces = [
                { descriptor: [1, 0], blur_score: 50 },
                { descriptor: [0, 1], blur_score: 50 },
            ];
            vi.mocked(FaceRepository.getAllFaces).mockReturnValue(faces);

            // Act
            await PersonService.recalculatePersonMean(1);

            // Assert
            // Mean = [0.5, 0.5], Normalized = [0.7071..., 0.7071...]
            const call = vi.mocked(PersonRepository.updateDescriptorMean).mock.calls[0];
            const resultMean = JSON.parse(call[1] as string);
            expect(resultMean[0]).toBeCloseTo(0.7071);
            expect(resultMean[1]).toBeCloseTo(0.7071);
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
            expect(FaceRepository.updateFacePerson).toHaveBeenCalledWith([10, 11], toId);
            expect(PersonRepository.deletePerson).toHaveBeenCalledWith(fromId);
            // Should also trigger recalc for target
            expect(FaceRepository.getAllFaces).toHaveBeenCalledWith(10000, 0, { personId: toId }, true);
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
            vi.mocked(FaceRepository.getAllFaces).mockReturnValue([]);

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
            expect(FaceRepository.updateFacePerson).toHaveBeenCalledWith([100], 5);
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
            expect(FaceRepository.updateFacePerson).toHaveBeenCalledWith([100], 6);
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
            expect(result.success).toBe(true);
            expect(result.merged).toBe(false);
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
            expect(FaceRepository.updateFacePerson).not.toHaveBeenCalled(); // No faces in mock
        });
    });
});
