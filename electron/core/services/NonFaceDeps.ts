import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { FlagRepository } from '../../data/repositories/FlagRepository';
import { NonFaceSuggestionService, type NonFaceDeps } from './NonFaceSuggestionService';

/** The real collaborators for NonFaceSuggestionService. */
export function createNonFaceDeps(): NonFaceDeps {
    return {
        countBelow: cutoffs => FlagRepository.countNonFaceBelow(cutoffs),
        list: (cutoff, offset, limit) => FlagRepository.listNonFace(cutoff, offset, limit),
        ignore: (ids, cutoff, at) => FlagRepository.ignoreNonFace(ids, cutoff, at),
        dismiss: (ids, cutoff, at) => FlagRepository.dismissNonFace(ids, cutoff, at),
        restore: ids => FlagRepository.restoreNonFace(ids),
        countIgnored: () => FlagRepository.countIgnoredByNonFace(),
        readFlag: key => AppStateRepository.getFlag(key),
        writeFlag: (key, value) => AppStateRepository.setFlag(key, value),
        now: () => new Date().toISOString(),
    };
}

let service: NonFaceSuggestionService | null = null;

/** The one suggestion service of the app (it keeps no state of its own: the cut-off is saved in app state). */
export function getNonFaceService(): NonFaceSuggestionService {
    if (!service) service = new NonFaceSuggestionService(createNonFaceDeps());
    return service;
}
