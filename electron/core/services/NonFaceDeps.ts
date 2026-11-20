import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { FlagRepository } from '../../data/repositories/FlagRepository';
import { RankedNonFaceRepository } from '../../data/repositories/RankedNonFaceRepository';
import { VisibilityRepository } from '../../data/repositories/VisibilityRepository';
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
        idsToHide: cutoff => FlagRepository.idsToHideBelow(cutoff),
        ranked: {
            countAtLeast: minLogits => RankedNonFaceRepository.countAtLeast(minLogits),
            idsToHide: minLogit => RankedNonFaceRepository.idsToHideAtLeast(minLogit),
            list: (minLogit, offset, limit) => RankedNonFaceRepository.list(minLogit, offset, limit),
            ignore: (ids, minLogit, at) => RankedNonFaceRepository.ignore(ids, minLogit, at),
            keep: (ids, minLogit, at) => RankedNonFaceRepository.keep(ids, minLogit, at),
        },
        visibilityCounts: () => VisibilityRepository.counts(),
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
