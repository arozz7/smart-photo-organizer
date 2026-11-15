import path from 'node:path';
import { uniqueFileName } from './uniqueFileName';

export type CopyResult = 'copied' | 'exists';

export interface AlbumExportResult {
    successCount: number;
    failCount: number;
}

export interface AlbumExportDeps {
    /** Stored paths of the photos that exist in the library for these ids. */
    getPhotos(ids: readonly number[]): { id: number; filePath: string }[];
    makeDirectory(directory: string): Promise<void>;
    /** Copies a file but never replaces an existing one: returns 'exists' instead. Rejects on any other error. */
    copyWithoutOverwrite(source: string, destination: string): Promise<CopyResult>;
}

/** Most file-name collisions tried for one photo before giving up on it. */
const MAX_NAME_COLLISIONS = 1000;

/**
 * Set Builder "Export Album": copies the chosen photos into a folder. A photo is never overwritten:
 * when a name is taken (an earlier export, or another photo with the same file name) the copy gets
 * a counter, e.g. `IMG_0001 (2).jpg`. The library files themselves are only read.
 */
export class AlbumExportService {
    constructor(private readonly deps: AlbumExportDeps) {}

    async export(photoIds: readonly number[], targetDirectory: string): Promise<AlbumExportResult> {
        const photos = this.deps.getPhotos(photoIds);
        if (photos.length === 0) return { successCount: 0, failCount: 0 };

        await this.deps.makeDirectory(targetDirectory);

        let successCount = 0;
        let failCount = 0;
        for (const photo of photos) {
            if (await this.copyOne(photo.filePath, targetDirectory)) successCount++;
            else failCount++;
        }
        return { successCount, failCount };
    }

    private async copyOne(source: string, targetDirectory: string): Promise<boolean> {
        const fileName = path.basename(source);
        try {
            for (let attempt = 0; attempt <= MAX_NAME_COLLISIONS; attempt++) {
                const destination = path.join(targetDirectory, uniqueFileName(fileName, attempt));
                if (await this.deps.copyWithoutOverwrite(source, destination) === 'copied') return true;
            }
            return false;
        } catch {
            return false;
        }
    }
}
