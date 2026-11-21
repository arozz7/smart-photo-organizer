import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { NamedFaceFingerprintRepository } from '../../data/repositories/NamedFaceFingerprintRepository';
import { ProfileMatchRepository } from '../../data/repositories/ProfileMatchRepository';
import { PersonService } from './PersonService';
import { ProfileMatchService, type ProfileMatchDeps } from './ProfileMatchService';

/** The real collaborators for ProfileMatchService. */
export function createProfileMatchDeps(): ProfileMatchDeps {
    return {
        loadExamples: minYaw => ProfileMatchRepository.loadExamples(minYaw),
        countCandidates: minYaw => ProfileMatchRepository.countCandidates(minYaw),
        loadCandidates: (afterId, limit, minYaw) => ProfileMatchRepository.loadCandidates(afterId, limit, minYaw),
        personsInPhotos: photoIds => ProfileMatchRepository.personsInPhotos(photoIds),
        dismissedPairs: faceIds => ProfileMatchRepository.dismissedPairs(faceIds),
        assign: (items, at) => ProfileMatchRepository.assign(items, at),
        dismiss: (items, at) => ProfileMatchRepository.dismiss(items, at),
        undo: faceIds => ProfileMatchRepository.undo(faceIds),
        countAssigned: () => ProfileMatchRepository.countAssigned(),
        faceTiles: faceIds => ProfileMatchRepository.faceTiles(faceIds),
        personNames: personIds => ProfileMatchRepository.personNames(personIds),
        frontalReference: (personId, excludePhotoId) => ProfileMatchRepository.frontalReference(personId, excludePhotoId),
        recalculate: async personId => { await PersonService.recalculatePersonMean(personId); },
        fingerprint: () => JSON.stringify(NamedFaceFingerprintRepository.get()),
        readFlag: key => AppStateRepository.getFlag(key),
        writeFlag: (key, value) => AppStateRepository.setFlag(key, value),
        yieldToEventLoop: () => new Promise<void>(resolve => setImmediate(resolve)),
        now: () => new Date().toISOString(),
    };
}

let service: ProfileMatchService | null = null;

/** The one service of the app: it keeps the search result in memory, so it must be shared. */
export function getProfileMatchService(): ProfileMatchService {
    if (!service) service = new ProfileMatchService(createProfileMatchDeps());
    return service;
}
