import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { AssignedVisibilityRepository } from '../../data/repositories/AssignedVisibilityRepository';
import { DoubtfulFaceRepository } from '../../data/repositories/DoubtfulFaceRepository';
import { PersonService } from './PersonService';
import { DoubtfulFaceService, type DoubtfulFaceDeps } from './DoubtfulFaceService';

/** The real collaborators for DoubtfulFaceService. */
export function createDoubtfulFaceDeps(): DoubtfulFaceDeps {
    return {
        countAtLeast: minScores => DoubtfulFaceRepository.countAtLeast(minScores),
        peopleAtLeast: minScore => DoubtfulFaceRepository.peopleAtLeast(minScore),
        list: (minScore, personId, offset, limit) => DoubtfulFaceRepository.list(minScore, personId, offset, limit),
        ignore: (ids, minScore, at) => DoubtfulFaceRepository.ignore(ids, minScore, at),
        unassign: (ids, minScore, at) => DoubtfulFaceRepository.unassign(ids, minScore, at),
        keep: (ids, minScore, at) => DoubtfulFaceRepository.keep(ids, minScore, at),
        undo: ids => DoubtfulFaceRepository.undo(ids),
        countChanged: () => DoubtfulFaceRepository.countChanged(),
        checkProgress: () => AssignedVisibilityRepository.counts(),
        recalculate: async personId => { await PersonService.recalculatePersonMean(personId); },
        readFlag: key => AppStateRepository.getFlag(key),
        writeFlag: (key, value) => AppStateRepository.setFlag(key, value),
        now: () => new Date().toISOString(),
    };
}

let service: DoubtfulFaceService | null = null;

/** The one doubtful-faces service of the app (it keeps no state of its own: the cut-off is saved in app state). */
export function getDoubtfulFaceService(): DoubtfulFaceService {
    if (!service) service = new DoubtfulFaceService(createDoubtfulFaceDeps());
    return service;
}
