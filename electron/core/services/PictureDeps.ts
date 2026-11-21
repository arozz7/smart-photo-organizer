import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { PictureListRepository } from '../../data/repositories/PictureListRepository';
import { PictureRepository } from '../../data/repositories/PictureRepository';
import { PersonService } from './PersonService';
import { PictureSuggestionService, type PictureSuggestionDeps } from './PictureSuggestionService';

/** The real collaborators for PictureSuggestionService. */
export function createPictureSuggestionDeps(): PictureSuggestionDeps {
    return {
        countAtLeast: minQ1s => PictureListRepository.countAtLeast(minQ1s),
        list: (which, minQ1, offset, limit) => PictureListRepository.list(which, minQ1, offset, limit),
        idsToHide: minQ1 => PictureListRepository.idsToHide(minQ1),
        ignore: (ids, minQ1, at) => PictureListRepository.ignore(ids, minQ1, at),
        keep: (ids, minQ1, at) => PictureListRepository.keep(ids, minQ1, at),
        undo: ids => PictureListRepository.undo(ids),
        countIgnored: () => PictureListRepository.countIgnored(),
        checkProgress: () => PictureRepository.counts(),
        recalculate: async personId => { await PersonService.recalculatePersonMean(personId); },
        readFlag: key => AppStateRepository.getFlag(key),
        writeFlag: (key, value) => AppStateRepository.setFlag(key, value),
        now: () => new Date().toISOString(),
    };
}

let service: PictureSuggestionService | null = null;

/** The one suggestion service of the app (it keeps no state of its own: the choices are saved in app state). */
export function getPictureSuggestionService(): PictureSuggestionService {
    if (!service) service = new PictureSuggestionService(createPictureSuggestionDeps());
    return service;
}
