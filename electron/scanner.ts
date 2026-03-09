import { promises as fs, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ExifTool } from 'exiftool-vendored';
import logger from './logger';
import { getDB, parseExifDate } from './db';

import { PhotoService } from './core/services/PhotoService';

/** Compute SHA-256 hash of a file, returned as hex string. */
async function computeSHA256(filePath: string): Promise<string | null> {
    try {
        return await new Promise((resolve, reject) => {
            const hash = createHash('sha256');
            const stream = createReadStream(filePath);
            stream.on('data', chunk => hash.update(chunk));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
        });
    } catch (e) {
        logger.warn(`[Scanner] SHA-256 failed for ${path.basename(filePath)}:`, e);
        return null;
    }
}

// Helper to get ExifTool from service
export async function getExifTool(): Promise<ExifTool | null> {
    return PhotoService.getExifTool();
}

const SUPPORTED_EXTS = ['.jpg', '.jpeg', '.png', '.jfif', '.arw', '.cr2', '.nef', '.dng', '.orf', '.rw2', '.tif', '.tiff'];

// Helper to extract preview (delegated to PhotoService)
export async function extractPreview(filePath: string, previewDir: string, forceRescan: boolean = false): Promise<string | null> {
    // Enable Throw on Error to capture corruption details
    return PhotoService.extractPreview(filePath, previewDir, forceRescan, true);
}

// Shared processing logic for a single file
async function processFile(fullPath: string, previewDir: string, db: any, options: { forceRescan?: boolean } = {}) {
    const { forceRescan } = options;
    const ext = path.extname(fullPath).toLowerCase();

    if (!SUPPORTED_EXTS.includes(ext)) return null;

    const selectStmt = db.prepare('SELECT * FROM photos WHERE file_path = ?');
    const insertStmt = db.prepare(`
        INSERT INTO photos (file_path, preview_cache_path, created_at, date_taken, metadata_json, width, height)
        VALUES (@file_path, @preview_cache_path, @created_at, @date_taken, @metadata_json, @width, @height)
        ON CONFLICT(file_path) DO NOTHING
    `);

    // Check if error already logged? (Optional: prevent duplicate error logs? Unique constrain on photo_id?)
    // scan_errors has ID pk.

    let photo = selectStmt.get(fullPath);
    let needsUpdate = false;
    let isNew = false;

    if (photo) {
        if (forceRescan) {
            isNew = true;
            needsUpdate = true;
        }

        const isRaw = !['.jpg', '.jpeg', '.png', '.jfif'].includes(ext);
        let previewMissing = false;

        if (isRaw) {
            if (photo.preview_cache_path) {
                try {
                    await fs.access(photo.preview_cache_path);
                    const stats = await fs.stat(photo.preview_cache_path);
                    if (stats.size === 0) {
                        logger.debug(`[Scanner] Preview exists but is 0 bytes: ${photo.preview_cache_path}`);
                        previewMissing = true;
                    }
                } catch (accessErr) {
                    logger.debug(`[Scanner] Preview missing (access failed) for ${fullPath} at ${photo.preview_cache_path}`);
                    previewMissing = true;
                }
            } else {
                previewMissing = true;
            }

            if (previewMissing || forceRescan) {
                const tool = await getExifTool();
                if (tool) {
                    try {
                        const previewPath = await extractPreview(fullPath, previewDir, forceRescan);
                        if (previewPath) {
                            db.prepare('UPDATE photos SET preview_cache_path = ? WHERE id = ?').run(previewPath, photo.id);
                            photo.preview_cache_path = previewPath;
                            needsUpdate = true;
                            // Clear previous errors if successful
                            db.prepare('DELETE FROM scan_errors WHERE photo_id = ?').run(photo.id);
                        }
                    } catch (e: any) {
                        logger.error(`[Scanner] Preview generation failed for ${path.basename(fullPath)}`, e);
                        db.prepare('INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, ?, ?, ?)').run(photo.id, fullPath, e.message || String(e), 'Preview Generation');
                    }
                }
            }
        } else {
            // Standard Image (JPG/PNG)
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
                try {
                    const previewPath = await extractPreview(fullPath, previewDir, forceRescan);
                    if (previewPath) {
                        db.prepare('UPDATE photos SET preview_cache_path = ? WHERE id = ?').run(previewPath, photo.id);
                        photo.preview_cache_path = previewPath;
                        needsUpdate = true;
                        db.prepare('DELETE FROM scan_errors WHERE photo_id = ?').run(photo.id);
                    }
                } catch (e: any) {
                    logger.error(`[Scanner] Preview generation failed for ${path.basename(fullPath)}`, e);
                    db.prepare('INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, ?, ?, ?)').run(photo.id, fullPath, e.message || String(e), 'Preview Generation');
                }
            }
        }

        if (!photo.metadata_json || photo.metadata_json === '{}' || forceRescan) {
            try {
                const tool = await getExifTool();
                if (tool) {
                    const metadata = await tool.read(fullPath);
                    let width = (metadata as any)?.ImageWidth || (metadata as any)?.SourceImageWidth || (metadata as any)?.ExifImageWidth || null;
                    let height = (metadata as any)?.ImageHeight || (metadata as any)?.SourceImageHeight || (metadata as any)?.ExifImageHeight || null;

                    // SWAP Dimensions for Rotated Images (RAW/Phone)
                    // Orientation: 6 (Rot 90), 8 (Rot 270), 5 (Transponse), 7 (Transverse)
                    const orientation = (metadata as any)?.Orientation;
                    const isRotated = orientation === 6 || orientation === 8 || orientation === 5 || orientation === 7 ||
                        orientation === 'Rotate 90 CW' || orientation === 'Rotate 270 CW';

                    if (isRotated && width && height) {
                        logger.info(`[Scanner] Detected Rotation for ${path.basename(fullPath)}: ${orientation}. Swapping ${width}x${height} -> ${height}x${width}`);
                        const temp = width;
                        width = height;
                        height = temp;
                    } else {
                        logger.debug(`[Scanner] No Rotation detected for ${path.basename(fullPath)}: ${orientation} (W:${width}, H:${height})`);
                    }

                    db.prepare('UPDATE photos SET metadata_json = ?, width = ?, height = ? WHERE id = ?').run(JSON.stringify(metadata), width, height, photo.id);
                    photo.metadata_json = JSON.stringify(metadata);
                    photo.width = width;
                    photo.height = height;
                    needsUpdate = true;
                }
            } catch (e) {
                logger.error(`Failed to backfill metadata for ${fullPath}`, e);
            }
        }
    }

    if (!photo) {
        logger.debug(`[Scanner] New photo found: ${path.basename(fullPath)}`);
        let previewPath = null;
        let previewError = null;

        try {
            previewPath = await extractPreview(fullPath, previewDir, forceRescan);
        } catch (e: any) {
            // Capture error but continue to insert photo so we can log the error
            previewError = e;
            logger.error(`[Scanner] Initial preview failed for ${path.basename(fullPath)}`, e);
        }

        try {
            let metadata = {};
            let width = null;
            let height = null;

            try {
                const tool = await getExifTool();
                if (tool) {
                    metadata = await tool.read(fullPath);
                    width = (metadata as any)?.ImageWidth || (metadata as any)?.SourceImageWidth || (metadata as any)?.ExifImageWidth || null;
                    height = (metadata as any)?.ImageHeight || (metadata as any)?.SourceImageHeight || (metadata as any)?.ExifImageHeight || null;

                    // SWAP Dimensions for Rotated Images
                    const orientation = (metadata as any)?.Orientation;
                    const isRotated = orientation === 6 || orientation === 8 || orientation === 5 || orientation === 7 ||
                        orientation === 'Rotate 90 CW' || orientation === 'Rotate 270 CW';

                    if (isRotated && width && height) {
                        const temp = width;
                        width = height;
                        height = temp;
                        logger.debug(`[Scanner] Swapped dimensions for ${path.basename(fullPath)} (Orientation: ${orientation})`);
                    }
                }
            } catch (e) {
                logger.error(`Failed to read metadata for ${fullPath}`, e);
            }

            // Resolve date_taken: EXIF → file birthtime → now
            const exifDateRaw = (metadata as any).DateTimeOriginal
                || (metadata as any).CreateDate
                || (metadata as any).MediaCreateDate;
            let dateTaken = parseExifDate(exifDateRaw);
            if (!dateTaken) {
                try {
                    dateTaken = statSync(fullPath).birthtime.toISOString();
                } catch (_) {
                    dateTaken = new Date().toISOString();
                }
            }

            const sha256Hash = await computeSHA256(fullPath);

            const info = insertStmt.run({
                file_path: fullPath,
                preview_cache_path: previewPath, // Might be null
                created_at: new Date().toISOString(),
                date_taken: dateTaken,
                metadata_json: JSON.stringify(metadata),
                width,
                height
            });

            const newPhotoId = info.lastInsertRowid;

            if (sha256Hash) {
                db.prepare('UPDATE photos SET sha256_hash = ? WHERE id = ?').run(sha256Hash, newPhotoId);
            }

            photo = selectStmt.get(fullPath); // Retrieve full object
            isNew = true;

            // Log error if one occurred
            if (previewError) {
                db.prepare('INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, ?, ?, ?)').run(newPhotoId, fullPath, previewError.message || String(previewError), 'Initial Scan');
            }

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
    // logger.info(`[Scanner] Scanning directory: ${currentPath}`);

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
    logger.info(`[Scanner] Scanning Finished. Details: Total=${totalFiles}, New=${count}, Returned=${photos.length}, Skipped=${JSON.stringify(skippedStats)}`);
    return photos;
}
