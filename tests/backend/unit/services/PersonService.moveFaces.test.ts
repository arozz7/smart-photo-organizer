
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersonService } from '../../../../electron/core/services/PersonService';
import { PersonRepository } from '../../../../electron/data/repositories/PersonRepository';
import { FaceRepository } from '../../../../electron/data/repositories/FaceRepository';

// Mock dependencies
vi.mock('electron', () => ({
    app: {
        getPath: () => '/tmp'
    }
}));
vi.mock('../../../../electron/data/repositories/PersonRepository');
vi.mock('../../../../electron/data/repositories/FaceRepository');
vi.mock('../../../../electron/store', () => ({
    getAISettings: () => ({ faceBlurThreshold: 20 })
}));

describe('PersonService - Move and Unassign Faces', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('moveFacesToPerson', () => {
        it('should move faces to existing person and recalculate means for both source and target', async () => {
            // Arrange
            const faceIds = [1, 2];
            const targetName = 'Target Person';
            const targetPerson = { id: 200, name: targetName };
            const sourcePersonId = 100;

            // Mock getPersonByName to return existing person
            vi.mocked(PersonRepository.getPersonByName).mockReturnValue(targetPerson as any);

            // Mock getFacesByIds to identify source person
            vi.mocked(FaceRepository.getFacesByIds).mockReturnValue([
                { id: 1, person_id: sourcePersonId } as any,
                { id: 2, person_id: sourcePersonId } as any
            ]);

            // Spy on recalculatePersonMean
            const recalcSpy = vi.spyOn(PersonService, 'recalculatePersonMean').mockResolvedValue(undefined);

            // Act
            const result = await PersonService.moveFacesToPerson(faceIds, targetName);

            // Assert
            // 1. Check person retrieval
            expect(PersonRepository.getPersonByName).toHaveBeenCalledWith(targetName);
            expect(PersonRepository.createPerson).not.toHaveBeenCalled();

            // 2. Check faces updated
            expect(FaceRepository.updateFacePerson).toHaveBeenCalledWith(faceIds, targetPerson.id);

            // 3. Check means recalculated
            expect(recalcSpy).toHaveBeenCalledWith(targetPerson.id); // Target
            expect(recalcSpy).toHaveBeenCalledWith(sourcePersonId); // Source
            expect(recalcSpy).toHaveBeenCalledTimes(2);

            expect(result).toEqual({ success: true, person: targetPerson });
        });

        it('should create new person if target does not exist', async () => {
            // Arrange
            const faceIds = [1];
            const targetName = 'New Person';
            const newPerson = { id: 300, name: targetName };

            vi.mocked(PersonRepository.getPersonByName).mockReturnValue(null);
            vi.mocked(PersonRepository.createPerson).mockReturnValue(newPerson as any);
            vi.mocked(FaceRepository.getFacesByIds).mockReturnValue([
                { id: 1, person_id: 100 } as any
            ]);
            const recalcSpy = vi.spyOn(PersonService, 'recalculatePersonMean').mockResolvedValue(undefined);

            // Act
            await PersonService.moveFacesToPerson(faceIds, targetName);

            // Assert
            expect(PersonRepository.createPerson).toHaveBeenCalledWith(targetName);
            expect(FaceRepository.updateFacePerson).toHaveBeenCalledWith(faceIds, newPerson.id);
            expect(recalcSpy).toHaveBeenCalledWith(newPerson.id);
        });
    });

    describe('unassignFaces', () => {
        it('should unassign faces and recalculate source person means', async () => {
            // Arrange
            const faceIds = [1, 2];
            const sourcePersonId = 100;

            vi.mocked(FaceRepository.getFacesByIds).mockReturnValue([
                { id: 1, person_id: sourcePersonId } as any,
                { id: 2, person_id: sourcePersonId } as any
            ]);

            const recalcSpy = vi.spyOn(PersonService, 'recalculatePersonMean').mockResolvedValue(undefined);

            // Act
            await PersonService.unassignFaces(faceIds);

            // Assert
            expect(FaceRepository.updateFacePerson).toHaveBeenCalledWith(faceIds, null);
            expect(recalcSpy).toHaveBeenCalledWith(sourcePersonId);
            expect(recalcSpy).toHaveBeenCalledTimes(1);
        });
    });
});
