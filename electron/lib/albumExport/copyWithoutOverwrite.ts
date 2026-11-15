import { constants } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import type { CopyResult } from '../../core/services/albumExport/AlbumExportService';

/** Copies a file, failing (without touching anything) when the destination already exists. */
export async function copyWithoutOverwrite(source: string, destination: string): Promise<CopyResult> {
    try {
        await copyFile(source, destination, constants.COPYFILE_EXCL);
        return 'copied';
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
        throw error;
    }
}
