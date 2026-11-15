import { describe, it, expect } from 'vitest';
import { AlbumExportService, type CopyResult } from '../../../../electron/core/services/albumExport/AlbumExportService';

/** In-memory destination folder: remembers what was copied and refuses to overwrite. */
const makeDestination = (existing: string[] = []) => {
    const files = new Map<string, string>(existing.map(name => [name, 'pre-existing']));
    const made: string[] = [];
    return {
        files,
        made,
        fs: {
            makeDirectory: async (dir: string) => { made.push(dir); },
            copyWithoutOverwrite: async (source: string, destination: string): Promise<CopyResult> => {
                if (source.includes('broken')) throw new Error('unreadable');
                if (files.has(destination)) return 'exists';
                files.set(destination, source);
                return 'copied';
            },
        },
    };
};

const rowsFor = (...paths: string[]) => paths.map((filePath, index) => ({ id: index + 1, filePath }));

const TARGET = 'E:\\Export';

describe('AlbumExportService', () => {
    it('copies every photo into the folder under its own name and reports the count', async () => {
        const { fs, files, made } = makeDestination();
        const service = new AlbumExportService({ ...fs, getPhotos: () => rowsFor('C:\\A\\one.jpg', 'C:\\A\\two.jpg') });

        const result = await service.export([1, 2], TARGET);

        expect(result).toEqual({ successCount: 2, failCount: 0 });
        expect([...files.keys()].sort()).toEqual(['E:\\Export\\one.jpg', 'E:\\Export\\two.jpg']);
        expect(made).toEqual([TARGET]);
    });

    it('keeps both photos when two have the same file name', async () => {
        const { fs, files } = makeDestination();
        const service = new AlbumExportService({ ...fs, getPhotos: () => rowsFor('C:\\Trip\\IMG_1.jpg', 'C:\\Party\\IMG_1.jpg') });

        const result = await service.export([1, 2], TARGET);

        expect(result.successCount).toBe(2);
        expect(files.get('E:\\Export\\IMG_1.jpg')).toBe('C:\\Trip\\IMG_1.jpg');
        expect(files.get('E:\\Export\\IMG_1 (2).jpg')).toBe('C:\\Party\\IMG_1.jpg');
    });

    it('never overwrites a file that is already in the folder', async () => {
        const { fs, files } = makeDestination(['E:\\Export\\one.jpg']);
        const service = new AlbumExportService({ ...fs, getPhotos: () => rowsFor('C:\\A\\one.jpg') });

        await service.export([1], TARGET);

        expect(files.get('E:\\Export\\one.jpg')).toBe('pre-existing');
        expect(files.get('E:\\Export\\one (2).jpg')).toBe('C:\\A\\one.jpg');
    });

    it('counts a photo that cannot be copied and carries on with the rest', async () => {
        const { fs, files } = makeDestination();
        const service = new AlbumExportService({ ...fs, getPhotos: () => rowsFor('C:\\A\\broken.jpg', 'C:\\A\\fine.jpg') });

        const result = await service.export([1, 2], TARGET);

        expect(result).toEqual({ successCount: 1, failCount: 1 });
        expect([...files.keys()]).toEqual(['E:\\Export\\fine.jpg']);
    });

    it('gives up on a name after many collisions instead of looping forever', async () => {
        const taken = ['E:\\Export\\one.jpg', ...Array.from({ length: 1000 }, (_, i) => `E:\\Export\\one (${i + 2}).jpg`)];
        const { fs } = makeDestination(taken);
        const service = new AlbumExportService({ ...fs, getPhotos: () => rowsFor('C:\\A\\one.jpg') });

        const result = await service.export([1], TARGET);

        expect(result).toEqual({ successCount: 0, failCount: 1 });
    });

    it('does nothing for an empty selection', async () => {
        const { fs, made } = makeDestination();
        const service = new AlbumExportService({ ...fs, getPhotos: () => [] });

        const result = await service.export([], TARGET);

        expect(result).toEqual({ successCount: 0, failCount: 0 });
        expect(made).toEqual([]);
    });
});
