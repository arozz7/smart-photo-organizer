import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ExifTool } from 'exiftool-vendored';
import { getDB } from './db';
import sharp from 'sharp';
import logger from './logger';

// Lazy load ExifTool
let _exiftool: ExifTool | null = null;
let _exiftoolInitPromise: Promise<ExifTool | null> | null = null;

async function getExifTool(): Promise<ExifTool | null> {
    if (_exiftool) return _exiftool;
    if (_exiftoolInitPromise) return _exiftoolInitPromise;

    _exiftoolInitPromise = (async () => {
        try {
            logger.info('Initializing ExifTool...');
            // Create instance with timeout
            const tool = new ExifTool({
                taskTimeoutMillis: 5000,
                maxProcs: 1
            });

            // Verify it works with a timeout
            const initCheck = new Promise<string>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('ExifTool startup timed out')), 30000);
                tool.version()
                    .then(v => { clearTimeout(timer); resolve(v); })
                    .catch(e => { clearTimeout(timer); reject(e); });
            });

            const version = await initCheck;
            logger.info(`ExifTool started successfully. Version: ${version}`);
            _exiftool = tool;
            return tool;
        } catch (err) {
            logger.error('FAILED to initialize ExifTool. RAW support will be disabled.', err);
            return null;
        }
    })();

    return _exiftoolInitPromise;
}

const SUPPORTED_EXTS = ['.jpg', '.jpeg', '.png', '.arw', '.cr2', '.nef', '.dng', '.orf', '.rw2', '.tif', '.tiff'];

// Helper to extract preview
async function extractPreview(filePath: string, previewDir: string, forceRescan: boolean = false): Promise<string | null> {
    // Use hash of filePath to ensure uniqueness across folders
    const fileName = path.basename(filePath);
    const hash = createHash('md5').update(filePath).digest('hex');
    const previewName = `${hash}.jpg`;
    const previewPath = path.join(previewDir, previewName);

    try {
        // Check if already exists (skip if forceRescan is FALSE)
        if (!forceRescan) {
            try {
                await fs.access(previewPath);
                return previewPath;
            } catch {
                // Start extraction
            }
        }

        // Determine if RAW or TIF
        const ext = path.extname(filePath).toLowerCase();
        const isRaw = !['.jpg', '.jpeg', '.png'].includes(ext);

        let rotationDegrees = 0;
        let shouldRotate = false;

        try {
            const tool = await getExifTool();
            if (tool) {
                const tags = await tool.read(filePath, ['Orientation']);
                if (tags?.Orientation) {
                    const val = tags.Orientation as any;
                    if (val === 1 || val === 'Horizontal (normal)') { rotationDegrees = 0; shouldRotate = false; }
                    else if (val === 3 || val === 'Rotate 180') { rotationDegrees = 180; shouldRotate = true; }
                    else if (val === 6 || val === 'Rotate 90 CW') { rotationDegrees = 90; shouldRotate = true; }
                    else if (val === 8 || val === 'Rotate 270 CW') { rotationDegrees = 270; shouldRotate = true; }
                }
            }
        } catch (e) {
            logger.warn(`Failed to read orientation for ${fileName}, assuming upright.`);
        }


        if (isRaw) {
            let extracted = false;
            if (!['.tif', '.tiff'].includes(ext)) {
                try {
                    const tool = await getExifTool();
                    if (tool) {
                        const tempPreviewPath = `${previewPath}.tmp`;
                        const timeoutPromise = new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Preview extraction timed out')), 15000)
                        );
                        await Promise.race([
                            tool.extractPreview(filePath, tempPreviewPath),
                            timeoutPromise
                        ]);
                        await fs.access(tempPreviewPath);

                        const pipeline = sharp(tempPreviewPath);
                        if (shouldRotate) pipeline.rotate(rotationDegrees);

                        await pipeline
                            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
                            .jpeg({ quality: 80 })
                            .toFile(previewPath);

                        try { await fs.unlink(tempPreviewPath); } catch { /* ignore */ }
                        logger.info(`Extracted and normalized preview for ${fileName}`);
                        extracted = true;
                    }
                } catch (e) {
                    try { await fs.unlink(`${previewPath}.tmp`); } catch { /* ignore */ }
                }
            }

            if (!extracted) {
                try {
                    logger.info(`Generating preview with Sharp for ${fileName}...`);
                    const pipeline = sharp(filePath);
                    if (shouldRotate) pipeline.rotate(rotationDegrees);

                    await pipeline
                        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
                        .jpeg({ quality: 80 })
                        .toFile(previewPath);
                    logger.info(`Generated preview with Sharp for ${fileName}`);
                    extracted = true;
                } catch (sharpErr) {
                    logger.error(`Sharp conversion failed for ${fileName}:`, sharpErr);
                }
            }
            if (extracted) return previewPath;
        } else {
            try {
                const pipeline = sharp(filePath);
                if (shouldRotate) pipeline.rotate(rotationDegrees);

                await pipeline
                    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toFile(previewPath);
                return previewPath;
            } catch (e) {
                logger.error(`Failed to generate preview for image ${fileName}`, e);
            }
        }

    } catch (e) {
        logger.error(`Failed to extract/generate preview for ${filePath}`, e);
    }
    return null;
}

// Shared processing logic for a single file
async function processFile(fullPath: string, previewDir: string, db: any, options: { forceRescan?: boolean } = {}) {
    const { forceRescan } = options;
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
                } catch {
                    previewMissing = true;
                }
            } else {
                previewMissing = true;
            }

            if (previewMissing || forceRescan) {
                const tool = await getExifTool();
                if (tool) {
                    const previewPath = await extractPreview(fullPath, previewDir, forceRescan);
                    if (previewPath) {
                        db.prepare('UPDATE photos SET preview_cache_path = ? WHERE id = ?').run(previewPath, photo.id);
                        photo.preview_cache_path = previewPath;
                        needsUpdate = true;
                    }
                }
            }
        } else {
            if (forceRescan) {
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
