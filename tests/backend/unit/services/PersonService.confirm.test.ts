/**
 * Confirming faces recalculates the person's model on its own, without raising a drift alert; a clean misassigned check clears the alerts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../../electron/data/repositories/PersonRepository', () => ({
    PersonRepository: {
        updateDescriptorMean: vi.fn(),
        updatePoseCentroids: vi.fn(),
        getPersonIdsOfFaces: vi.fn(),
        getPerson: vi.fn(),
        addHistorySnapshot: vi.fn(),
        refreshPersonCover: vi.fn(),
        addAlert: vi.fn(),
        dismissAlertsOfType: vi.fn()
    }
}));

vi.mock('../../../../electron/data/repositories/FaceRepository', () => ({
    FaceRepository: {
        setConfirmed: vi.fn(),
        getConfirmedFaces: vi.fn()
    }
}));

vi.mock('../../../../electron/store', () => ({ getAISettings: vi.fn(() => ({ faceBlurThreshold: 20 })) }));

vi.spyOn(console, 'time').mockImplementation(() => { });
vi.spyOn(console, 'timeEnd').mockImplementation(() => { });
vi.spyOn(console, 'log').mockImplementation(() => { });
vi.spyOn(console, 'warn').mockImplementation(() => { });

import { PersonService } from '../../../../electron/core/services/PersonService';
import { PersonRepository } from '../../../../electron/data/repositories/PersonRepository';
import { FaceRepository } from '../../../../electron/data/repositories/FaceRepository';

const face = (id: number, descriptor: number[]) => ({ id, descriptor, blur_score: null, pose_yaw: null });

/** The old model sits far from the confirmed faces, which is what a child growing into a teenager looks like. */
function personWithFarOldModel() {
    vi.mocked(PersonRepository.getPerson).mockReturnValue({ id: 7, name: 'Sam', descriptor_mean_json: JSON.stringify([5, 5, 5]) } as never);
    vi.mocked(FaceRepository.getConfirmedFaces).mockReturnValue([face(1, [0, 0, 0]), face(2, [0, 0, 0])] as never);
}

describe('PersonService.setFacesConfirmed', () => {
    beforeEach(() => vi.clearAllMocks());

    it('confirms the faces and recalculates the model of each person they belong to', async () => {
        vi.mocked(PersonRepository.getPersonIdsOfFaces).mockReturnValue([7, 8]);
        personWithFarOldModel();

        const result = await PersonService.setFacesConfirmed([1, 2], true);

        expect(FaceRepository.setConfirmed).toHaveBeenCalledWith([1, 2], true);
        expect(PersonRepository.updateDescriptorMean).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ people: 2 });
    });

    it('does not raise a drift alert, because the model moved on the user\'s own say-so', async () => {
        vi.mocked(PersonRepository.getPersonIdsOfFaces).mockReturnValue([7]);
        personWithFarOldModel();

        await PersonService.setFacesConfirmed([1, 2], true);

        expect(PersonRepository.addAlert).not.toHaveBeenCalled();
    });

    it('still raises a drift alert for an ordinary recalculation', async () => {
        personWithFarOldModel();

        const result = await PersonService.recalculatePersonMean(7);

        expect(PersonRepository.addAlert).toHaveBeenCalled();
        expect(result?.drift).toBe(true);
    });

    it('recalculates nobody when the faces belong to no one', async () => {
        vi.mocked(PersonRepository.getPersonIdsOfFaces).mockReturnValue([]);

        const result = await PersonService.setFacesConfirmed([9], true);

        expect(PersonRepository.updateDescriptorMean).not.toHaveBeenCalled();
        expect(result).toEqual({ people: 0 });
    });
});

describe('PersonService.resolveDriftAlerts', () => {
    beforeEach(() => vi.clearAllMocks());

    it('dismisses the drift alerts when the check found nothing', () => {
        const cleared = PersonService.resolveDriftAlerts(7, { centroidValid: true, outliers: [] });

        expect(PersonRepository.dismissAlertsOfType).toHaveBeenCalledWith(7, 'drift_detected');
        expect(cleared).toBe(true);
    });

    it('keeps the alerts when the check found faces to review', () => {
        const cleared = PersonService.resolveDriftAlerts(7, { centroidValid: true, outliers: [{ faceId: 1 }] });

        expect(PersonRepository.dismissAlertsOfType).not.toHaveBeenCalled();
        expect(cleared).toBe(false);
    });

    it('keeps the alerts when there was no model to check against', () => {
        const cleared = PersonService.resolveDriftAlerts(7, { centroidValid: false, outliers: [] });

        expect(PersonRepository.dismissAlertsOfType).not.toHaveBeenCalled();
        expect(cleared).toBe(false);
    });
});
