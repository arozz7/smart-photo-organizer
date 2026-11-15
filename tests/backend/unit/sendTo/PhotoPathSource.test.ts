import { describe, it, expect, vi } from 'vitest';
import { DbPhotoPathSource, type PhotoPathSourceDeps } from '../../../../electron/core/services/sendTo/PhotoPathSource';

interface FakePhoto { id: number; file_path: string; missing_since: string | null }

const photo = (id: number, missingSince: string | null = null): FakePhoto => ({ id, file_path: `C:\\Photos\\p${id}.jpg`, missing_since: missingSince });

/** Serves `all` in pages, the way the real paged queries do. */
const makePager = (all: FakePhoto[]) =>
    vi.fn((_filter: unknown, offset: number, limit: number) => ({ photos: all.slice(offset, offset + limit), total: all.length }));

const makeDeps = (overrides: Partial<PhotoPathSourceDeps> = {}): PhotoPathSourceDeps => ({
    getRowsByIds: () => [],
    getAlbum: () => undefined,
    getSimplePage: makePager([]),
    getCompoundPage: makePager([]),
    pageSize: 2,
    ...overrides,
});

describe('DbPhotoPathSource.pathsForPhotoIds', () => {
    it('maps stored rows to path rows, keeping the requested order', () => {
        const source = new DbPhotoPathSource(makeDeps({ getRowsByIds: () => [photo(2), photo(1, '2026-11-01')] }));

        expect(source.pathsForPhotoIds([2, 1])).toEqual([
            { id: 2, filePath: 'C:\\Photos\\p2.jpg', missingSince: null },
            { id: 1, filePath: 'C:\\Photos\\p1.jpg', missingSince: '2026-11-01' },
        ]);
    });
});

describe('DbPhotoPathSource.pathsForSmartAlbum', () => {
    const album = (filter: unknown, compound = false) => ({ id: 1, name: 'A', created_at: '', filter_json: JSON.stringify({ compound, filter }) });

    it('returns null when the album does not exist', () => {
        expect(new DbPhotoPathSource(makeDeps()).pathsForSmartAlbum(9)).toBeNull();
    });

    it('returns null when the stored filter cannot be read', () => {
        const source = new DbPhotoPathSource(makeDeps({ getAlbum: () => ({ id: 1, name: 'A', created_at: '', filter_json: '{not json' }) }));

        expect(source.pathsForSmartAlbum(1)).toBeNull();
    });

    it('collects every page of a simple filter until the total is reached', () => {
        const all = [photo(1), photo(2), photo(3), photo(4), photo(5)];
        const getSimplePage = makePager(all);
        const source = new DbPhotoPathSource(makeDeps({ getAlbum: () => album({ folder: 'C:\\Photos' }), getSimplePage }));

        const rows = source.pathsForSmartAlbum(1);

        expect(rows?.map(r => r.id)).toEqual([1, 2, 3, 4, 5]);
        expect(getSimplePage).toHaveBeenCalledWith({ folder: 'C:\\Photos' }, 0, 2);
        expect(getSimplePage).toHaveBeenCalledWith({ folder: 'C:\\Photos' }, 4, 2);
    });

    it('uses the compound query for a compound album', () => {
        const getCompoundPage = makePager([photo(1)]);
        const getSimplePage = makePager([]);
        const source = new DbPhotoPathSource(makeDeps({ getAlbum: () => album({ logic: 'AND', groups: [] }, true), getCompoundPage, getSimplePage }));

        const rows = source.pathsForSmartAlbum(1);

        expect(rows?.map(r => r.id)).toEqual([1]);
        expect(getSimplePage).not.toHaveBeenCalled();
    });

    it('stops when a page comes back empty even if the total says more (no endless loop)', () => {
        const getSimplePage = vi.fn()
            .mockReturnValueOnce({ photos: [photo(1), photo(2)], total: 10 })
            .mockReturnValue({ photos: [], total: 10 });
        const source = new DbPhotoPathSource(makeDeps({ getAlbum: () => album({}), getSimplePage }));

        const rows = source.pathsForSmartAlbum(1);

        expect(rows).toHaveLength(2);
        expect(getSimplePage).toHaveBeenCalledTimes(2);
    });
});
