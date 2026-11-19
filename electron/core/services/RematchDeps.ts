import { createHash } from 'node:crypto';
import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { PersonRepository } from '../../data/repositories/PersonRepository';
import { RematchRepository } from '../../data/repositories/RematchRepository';
import { ConfigService } from './ConfigService';
import { FaceService } from './FaceService';
import { collectCentroids } from './parkedFaces';
import { RematchService, type RematchDeps } from './RematchService';

const DESCRIPTOR_DIM = 512;

type Candidates = Parameters<typeof FaceService.matchAgainstCentroids>[1];

/** The real collaborators for RematchService. */
export function createRematchDeps(): RematchDeps {
    return {
        loadPeople: () => PersonRepository.getPeopleWithDescriptors(),
        centroidFingerprint: () =>
            createHash('sha1')
                .update(JSON.stringify(collectCentroids(PersonRepository.getPeopleWithDescriptors(), DESCRIPTOR_DIM)))
                .digest('hex'),
        match: (descriptor, people, threshold) => {
            const found = FaceService.matchAgainstCentroids(descriptor, people as Candidates, threshold, 'human');
            return found ? { personId: found.personId, distance: found.distance } : null;
        },
        countUnassigned: () => RematchRepository.countUnassigned(),
        loadFaces: (afterId, limit) => RematchRepository.getUnassignedFaces(afterId, limit),
        findTriedPairs: faceIds => RematchRepository.findTriedPairs(faceIds),
        saveMatches: matches => RematchRepository.saveMatches(matches, new Date().toISOString()),
        undoUnconfirmed: () => RematchRepository.undoUnconfirmed(),
        countUndoable: () => RematchRepository.countUndoable(),
        isBusy: () =>
            AppStateRepository.isScanActive() || AppStateRepository.isAIProcessingActive() || AppStateRepository.isShutdownRequested(),
        // same fallback the scans use when the setting is absent (FaceService.classifyAndAssign: autoAssignThreshold || 0.7)
        autoAssignDistance: () => ConfigService.getAISettings().autoAssignThreshold || 0.7,
        readFlag: key => AppStateRepository.getFlag(key),
        writeFlag: (key, value) => AppStateRepository.setFlag(key, value),
        now: () => Date.now(),
    };
}

let service: RematchService | null = null;

/** The one re-match service of the app: the background loop and the Settings card share it. */
export function getRematchService(): RematchService {
    if (!service) service = new RematchService(createRematchDeps());
    return service;
}
