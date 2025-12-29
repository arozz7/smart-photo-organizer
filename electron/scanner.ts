import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ExifTool } from 'exiftool-vendored';
import logger from './logger';
import { getDB } from './db';

// Helper to get ExifTool from service
export async function getExifTool(): Promise<ExifTool | null> {
    const { PhotoService } = await import('./services/photoService');
    return PhotoService.getExifTool();
}

const SUPPORTED_EXTS = ['.jpg', '.jpeg', '.png', '.arw', '.cr2', '.nef', '.dng', '.orf', '.rw2', '.tif', '.tiff'];

// Helper to extract preview (delegated to PhotoService)
export async function extractPreview(filePath: string, previewDir: string, forceRescan: boolean = false): Promise<string | null> {
    const { PhotoService } = await import('./services/photoService');
    return PhotoService.extractPreview(filePath, previewDir, forceRescan);
}

// Shared processing logic for a single file
async function processFile(fullPath: string, previewDir: string, db: any, options: { forceRescan?: boolean } = {}) {
    const { forceRescan } = options;
    if (fullPath.includes('_DSC7405')) {
        logger.info(`[TRACE] Processing _DSC7405. ForceRescan: ${forceRescan}`);
    }
    const ext = path.extname(fullPath).toLowerCase();

    if (!SUPPORTED_EXTS.includes(ext)) return null;

    const selectStmt = db.prepare('SELECT * FROM photos WHERE file_path = ?');
    const insertStmt = db.prepare(`
        INSERT INTO photos (file_path, preview_cache_path, created_at, metadata_json) 
        VALUES (@file_path, @preview_cache_path, @created_at, @metadata_json)
        ON CONFLICT(file_path) DO NOTHING
    `);

    let photo = selectStmt.get(fullPath);
    let needsUpdate = false;
    let isNew = false;

    if (photo) {
        if (forceRescan) {
            isNew = true;
            needsUpdate = true;
        }

        const isRaw = !['.jpg', '.jpeg', '.png'].includes(ext);
        let previewMissing = false;

        if (isRaw) {
            if (photo.preview_cache_path) {
                try {
                    await fs.access(photo.preview_cache_path);
                    // DEBUG: Check stats
                    const stats = await fs.stat(photo.preview_cache_path);
                    if (stats.size === 0) {
                        logger.warn(`[Scanner] Preview exists but is 0 bytes: ${photo.preview_cache_path}`);
                        previewMissing = true;
                    } else {
                        logger.info(`[Scanner] Preview verified for ${path.basename(fullPath)} matches ${photo.preview_cache_path}`);
                    }
                } catch (accessErr) {
                    logger.warn(`[Scanner] Preview missing (access failed) for ${fullPath} at ${photo.preview_cache_path}`);
                    previewMissing = true;
                }
            } else {
                logger.warn(`[Scanner] Preview path null in DB for ${fullPath}`);
                previewMissing = true;
            }

            if (previewMissing || forceRescan) {
                const tool = await getExifTool();
                if (tool) {
                    logger.info(`[Scanner] Starting RAW extraction for ${path.basename(fullPath)}`);
                    const previewPath = await extractPreview(fullPath, previewDir, forceRescan);
                    if (previewPath) {
                        db.prepare('UPDATE photos SET preview_cache_path = ? WHERE id = ?').run(previewPath, photo.id);
                        photo.preview_cache_path = previewPath;
                        needsUpdate = true;
                    }
                }
            }
        } else {
            // Standard Image (JPG/PNG) - Verify existence too
            if (photo.preview_cache_path) {
                try {
                    await fs.access(photo.preview_cache_path);
                    const stats = await fs.stat(photo.preview_cache_path);
                    if (stats.size === 0) previewMissing = true;
                } catch {
                    previewMissing = true;
                }
            } else {
                previewMissing = true;
            }

            if (previewMissing || forceRescan) {
                const previewPath = await extractPreview(fullPath, previewDir, forceRescan);
                if (previewPath) {
                    db.prepare('UPDATE photos SET preview_cache_path = ? WHERE id = ?').run(previewPath, photo.id);
                    photo.preview_cache_path = previewPath;
                    needsUpdate = true;
                }
            }
        }

        if (!photo.metadata_json || photo.metadata_json === '{}' || forceRescan) {
            try {
                const tool = await getExifTool();
                if (tool) {
                    const metadata = await tool.read(fullPath);
                    db.prepare('UPDATE photos SET metadata_json = ? WHERE id = ?').run(JSON.stringify(metadata), photo.id);
                    photo.metadata_json = JSON.stringify(metadata);
                    needsUpdate = true;
                }
            } catch (e) {
                logger.error(`Failed to backfill metadata for ${fullPath}`, e);
            }
        }
    }

    if (!photo) {
        logger.info(`[Scanner] New photo found: ${path.basename(fullPath)}`);
        const previewPath = await extractPreview(fullPath, previewDir, forceRescan);

        try {
            let metadata = {};
            try {
                const tool = await getExifTool();
                if (tool) {
                    metadata = await tool.read(fullPath);
                }
            } catch (e) {
                logger.error(`Failed to read metadata for ${fullPath}`, e);
            }

            insertStmt.run({
                file_path: fullPath,
                preview_cache_path: previewPath,
                created_at: new Date().toISOString(),
                metadata_json: JSON.stringify(metadata)
            });
            photo = selectStmt.get(fullPath);
            isNew = true;
        } catch (e) {
            logger.error('Insert failed', e);
        }
    }

    if (photo) {
        photo.isNew = isNew;
        photo.needsUpdate = needsUpdate; // Internal use
        return photo;
    }
    return null;
}

export async function scanFiles(filePaths: string[], libraryPath: string, onProgress?: (count: number) => void, options: { forceRescan?: boolean } = {}) {
    const db = getDB();
    const photos: any[] = [];
    let count = 0;

    // Ensure preview directory exists
    const previewDir = path.join(libraryPath, 'previews');
    await fs.mkdir(previewDir, { recursive: true });

    logger.info(`Scanning ${filePaths.length} specific files...`);
    // TRACE DEBUG
    const traceFile = filePaths.find(p => p.includes('_DSC7405'));
    if (traceFile) {
        logger.info(`[TRACE] Found target file in flush list: ${traceFile}`);
    } else {
        logger.info(`[TRACE] Target file _DSC7405 NOT found in current batch.`);
    }

    for (const filePath of filePaths) {
        try {
            // Verify file exists
            await fs.access(filePath);
            const photo = await processFile(filePath, previewDir, db, options);
            if (photo) {
                photos.push(photo);
                count++;
                if (onProgress && count % 5 === 0) onProgress(count);
            }
        } catch (e) {
            logger.error(`Failed to process specific file: ${filePath}`, e);
        }
    }

    if (onProgress) onProgress(count);
    return photos;
}

export async function scanDirectory(dirPath: string, libraryPath: string, onProgress?: (count: number) => void, options: { forceRescan?: boolean } = {}) {
    const db = getDB();
    const photos: any[] = [];
    let count = 0;
    let totalFiles = 0;
    const skippedStats: Record<string, number> = {};

    // Ensure preview directory exists
    const previewDir = path.join(libraryPath, 'previews');
    await fs.mkdir(previewDir, { recursive: true });

    async function scan(currentPath: string) {
        try {
            logger.info(`Scanning directory: ${currentPath}`);
            const entries = await fs.readdir(currentPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);

                if (entry.isDirectory()) {
                    if (!entry.name.startsWith('.')) {
                        await scan(fullPath);
                    }
                } else if (entry.isFile()) {
                    totalFiles++;
                    const photo = await processFile(fullPath, previewDir, db, options);
                    if (photo) {
                        photos.push(photo);
                        count++;
                        if (count % 10 === 0 || photo.needsUpdate) {
                            if (onProgress) onProgress(count);
                            await new Promise(resolve => setTimeout(resolve, 0));
                        }
                    } else {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (!SUPPORTED_EXTS.includes(ext)) {
                            skippedStats[ext] = (skippedStats[ext] || 0) + 1;
                        }
                    }
                }
            }
        } catch (err) {
            logger.error(`Error scanning ${currentPath}:`, err);
        }
    }

    await scan(dirPath);
    logger.info(`[Scanner] Total files: ${totalFiles}, Processed: ${count}, Returned: ${photos.length}`);
    logger.info(`[Scanner] Skipped Extensions:`, skippedStats);
    return photos;
}
