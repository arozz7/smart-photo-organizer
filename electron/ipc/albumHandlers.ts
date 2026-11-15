import { ipcMain } from 'electron';
import { mkdir } from 'node:fs/promises';
import { AlbumExportService } from '../core/services/albumExport/AlbumExportService';
import { parseAlbumExportRequest } from '../core/services/albumExport/albumExportRequest';
import { PhotoPathRepository } from '../data/repositories/PhotoPathRepository';
import { copyWithoutOverwrite } from '../lib/albumExport/copyWithoutOverwrite';
import logger from '../logger';

/** Set Builder "Export Album" IPC. Thin: validate, delegate to AlbumExportService, return the counts. */
export function registerAlbumHandlers(): void {
    const service = new AlbumExportService({
        getPhotos: ids => PhotoPathRepository.getByIds(ids).map(({ id, file_path }) => ({ id, filePath: file_path })),
        makeDirectory: async directory => { await mkdir(directory, { recursive: true }); },
        copyWithoutOverwrite,
    });

    ipcMain.handle('os:createAlbum', async (_event, payload: unknown) => {
        const request = parseAlbumExportRequest(payload);
        if (!request) return { success: false, error: 'Invalid arguments' };

        try {
            const result = await service.export(request.photoIds, request.targetDir);
            logger.info({ requested: request.photoIds.length, ...result }, 'Album export finished');
            return { success: true, ...result };
        } catch (error) {
            logger.error({ error }, 'Album export failed');
            return { success: false, error: String(error) };
        }
    });
}
