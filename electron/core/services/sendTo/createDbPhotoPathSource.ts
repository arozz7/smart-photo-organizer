import { PhotoRepository } from '../../../data/repositories/PhotoRepository';
import { PhotoPathRepository } from '../../../data/repositories/PhotoPathRepository';
import { SmartAlbumRepository } from '../../../data/repositories/SmartAlbumRepository';
import type { CompoundFilter } from '../../../types/filterTypes';
import { DbPhotoPathSource, type PhotoPage } from './PhotoPathSource';

const ALBUM_PAGE_SIZE = 500;
/** Sorted by path so paging with an offset is stable (paths are unique). */
const STABLE_SORT = 'name_asc';

/** Wires the path source to the real library database. */
export function createDbPhotoPathSource(): DbPhotoPathSource {
    return new DbPhotoPathSource({
        getRowsByIds: ids => PhotoPathRepository.getByIds(ids),
        getAlbum: id => SmartAlbumRepository.getById(id),
        getSimplePage: (filter, offset, limit) =>
            PhotoRepository.getPhotos(1, limit, STABLE_SORT, filter as Record<string, unknown>, offset) as PhotoPage,
        getCompoundPage: (filter, offset, limit) =>
            PhotoRepository.getPhotosByCompoundFilter(filter as CompoundFilter, 1, limit, STABLE_SORT, offset) as PhotoPage,
        pageSize: ALBUM_PAGE_SIZE,
    });
}
