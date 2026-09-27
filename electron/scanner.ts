import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ExifTool } from 'exiftool-vendored';
import logger from './logger';
import { getDB } from './db';
import { PhotoService } from './core/services/PhotoService';
import { ConfigService } from './core/services/ConfigService';
import { collectImageFiles } from './scanning/collectImageFiles';
import { processFile, type ProcessOptions, type ScannedPhoto } from './scanning/processFile';
import { ScanStatements } from './scanning/ScanStatements';
import { mapWithConcurrency } from './utils/mapWithConcurrency';

export interface ScanOptions extends ProcessOptions {
    /** Files processed at once (previews, metadata and hashing overlap; DB writes stay synchronous). Defaults to the scanner setting. */
    concurrency?: number;
}

// Helper to get ExifTool from service
export async function getExifTool(): Promise<ExifTool | null> {
    return PhotoService.getExifTool();
}

// Helper to extract preview (delegated to PhotoService)
export async function extractPreview(filePath: string, previewDir: string, forceRescan: boolean = false): Promise<string | null> {
    // Enable Throw on Error to capture corruption details
    return PhotoService.extractPreview(filePath, previewDir, forceRescan, true);
}

/**
 * Processes `files` with bounded concurrency. Results keep input order; files that could not be
 * stored (or failed unexpectedly) are dropped so one bad file never aborts the scan.
 */
async function processAll(
    files: string[],
    libraryPath: string,
    options: ScanOptions,
    onSettled: (photo: ScannedPhoto | null) => void,
): Promise<ScannedPhoto[]> {
    const previewDir = path.join(libraryPath, 'previews');
    await fs.mkdir(previewDir, { recursive: true });

    const statements = new ScanStatements(getDB());
    const results = await mapWithConcurrency(
        files,
        options.concurrency ?? ConfigService.getScannerSettings().concurrency,
        async (file): Promise<ScannedPhoto | null> => {
            try {
                return await processFile(file, previewDir, statements, options);
            } catch (e) {
                logger.error(`Failed to process file: ${file}`, e);
                return null;
            }
        },
        (_index, photo) => onSettled(photo),
    );

    return results.filter((photo): photo is ScannedPhoto => photo !== null);
}

export async function scanFiles(filePaths: string[], libraryPath: string, onProgress?: (count: number) => void, options: ScanOptions = {}) {
    logger.info(`Scanning ${filePaths.length} specific files...`);

    // Only files that still exist are processed
    const existing: string[] = [];
    for (const filePath of filePaths) {
        try {
            await fs.access(filePath);
            existing.push(filePath);
        } catch (e) {
            logger.error(`Failed to process specific file: ${filePath}`, e);
        }
    }

    let count = 0;
    const photos = await processAll(existing, libraryPath, options, photo => {
        if (!photo) return;
        count++;
        if (onProgress && count % 5 === 0) onProgress(count);
    });

    if (onProgress) onProgress(count);
    return photos;
}

export async function scanDirectory(dirPath: string, libraryPath: string, onProgress?: (count: number) => void, options: ScanOptions = {}) {
    const { files, totalFiles, skipped } = await collectImageFiles(dirPath);

    let count = 0;
    const photos = await processAll(files, libraryPath, options, photo => {
        if (!photo) return;
        count++;
        if (onProgress && (count % 10 === 0 || photo.needsUpdate)) onProgress(count);
    });

    logger.info(`[Scanner] Scanning Finished. Details: Total=${totalFiles}, New=${count}, Returned=${photos.length}, Skipped=${JSON.stringify(skipped)}`);
    return photos;
}
