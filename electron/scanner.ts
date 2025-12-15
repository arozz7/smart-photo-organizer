import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ExifTool } from 'exiftool-vendored';
import { getDB } from './db';
import sharp from 'sharp';

// Lazy load ExifTool
let _exiftool: ExifTool | null = null;
let _exiftoolInitPromise: Promise<ExifTool | null> | null = null;

async function getExifTool(): Promise<ExifTool | null> {
    if (_exiftool) return _exiftool;
    if (_exiftoolInitPromise) return _exiftoolInitPromise;

    _exiftoolInitPromise = (async () => {
        try {
            console.log('Initializing ExifTool...');
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
            console.log(`ExifTool started successfully. Version: ${version}`);
            _exiftool = tool;
            return tool;
        } catch (err) {
            console.error('FAILED to initialize ExifTool. RAW support will be disabled.', err);
            return null;
        }
    })();

    return _exiftoolInitPromise;
}

const SUPPORTED_EXTS = ['.jpg', '.jpeg', '.png', '.arw', '.cr2', '.nef', '.dng', '.orf', '.rw2', '.tif', '.tiff'];

export async function scanDirectory(dirPath: string, libraryPath: string, onProgress?: (count: number) => void) {
    const db = getDB();
    const photos: any[] = [];
    let count = 0;

    // Ensure preview directory exists
    const previewDir = path.join(libraryPath, 'previews');
    await fs.mkdir(previewDir, { recursive: true });

    const insertStmt = db.prepare(`
    INSERT INTO photos (file_path, preview_cache_path, created_at, metadata_json) 
    VALUES (@file_path, @preview_cache_path, @created_at, @metadata_json)
    ON CONFLICT(file_path) DO NOTHING
  `);

    const selectStmt = db.prepare('SELECT * FROM photos WHERE file_path = ?');



    // Helper to extract preview
    async function extractPreview(filePath: string): Promise<string | null> {
        // Use hash of filePath to ensure uniqueness across folders
        const fileName = path.basename(filePath);
        const hash = createHash('md5').update(filePath).digest('hex');
        const previewName = `${hash}.jpg`;
        const previewPath = path.join(previewDir, previewName);

        try {
            // Check if already exists
            try {
                await fs.access(previewPath);
                return previewPath;
            } catch {
                // Determine if RAW or TIF
                const ext = path.extname(filePath).toLowerCase();
                const isRaw = !['.jpg', '.jpeg', '.png'].includes(ext);

                if (isRaw) {
                    // Try ExifTool first for RAWs (fast extraction of embedded preview)
                    // But for TIFs, ExifTool often fails if no embedded preview, so we might skip to Sharp or try/catch
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

                                // Check if file was created
                                await fs.access(tempPreviewPath);

                                // Normalize with Sharp (Auto-rotate and resize)
                                await sharp(tempPreviewPath)
                                    .rotate()
                                    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
                                    .jpeg({ quality: 80 })
                                    .toFile(previewPath);

                                // Cleanup temp file
                                try { await fs.unlink(tempPreviewPath); } catch { }

                                console.log(`Extracted and normalized preview for ${fileName}`);
                                extracted = true;
                            }
                        } catch (e) {
                            // Clean up temp if it exists
                            try { await fs.unlink(`${previewPath}.tmp`); } catch { }
                            // console.log(`ExifTool extraction failed for ${fileName}, trying Sharp fallback...`, e);
                        }
                    }

                    if (!extracted) {
                        try {
                            console.log(`Generating preview with Sharp for ${fileName}...`);
                            await sharp(filePath)
                                .rotate() // Auto-rotate based on EXIF
                                .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }) // Reasonable preview size
                                .jpeg({ quality: 80 })
                                .toFile(previewPath);
                            console.log(`Generated preview with Sharp for ${fileName}`);
                            extracted = true;
                        } catch (sharpErr) {
                            console.error(`Sharp conversion failed for ${fileName}:`, sharpErr);
                        }
                    }

                    if (extracted) return previewPath;
                }
            }
        } catch (e) {
            console.error(`Failed to extract/generate preview for ${filePath}`, e);
        }
        return null;
    }


    let totalFiles = 0;
    const skippedStats: Record<string, number> = {};

    async function scan(currentPath: string) {
        try {
            console.log(`Scanning directory: ${currentPath}`);
            const entries = await fs.readdir(currentPath, { withFileTypes: true });
            console.log(`Found ${entries.length} entries in ${currentPath}`);

            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);

                if (entry.isDirectory()) {
                    if (!entry.name.startsWith('.')) {
                        await scan(fullPath);
                    }
                } else if (entry.isFile()) {
                    totalFiles++;
                    const ext = path.extname(entry.name).toLowerCase();
                    if (SUPPORTED_EXTS.includes(ext)) {
                        // ... process photo ...
                        let photo = selectStmt.get(fullPath);
                        let needsUpdate = false;

                        // Check if we need to generate a preview for an existing photo (e.g. previous run failed)
                        // Check if we need to generate a preview for an existing photo (e.g. previous run failed)
                        if (photo) {
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

                                if (previewMissing) {
                                    // Optimization: Only try if ExifTool is actually working
                                    const tool = await getExifTool();
                                    if (tool) {
                                        // console.log(`Retry preview extraction for ${path.basename(fullPath)}`);
                                        const previewPath = await extractPreview(fullPath);
                                        if (previewPath) {
                                            // Update DB
                                            db.prepare('UPDATE photos SET preview_cache_path = ? WHERE id = ?').run(previewPath, photo.id);
                                            photo.preview_cache_path = previewPath; // Update local obj for UI
                                            needsUpdate = true;
                                        }
                                    }
                                }
                            }

                            // Check if metadata is missing for existing photo
                            if (!photo.metadata_json || photo.metadata_json === '{}') {
                                try {
                                    const tool = await getExifTool();
                                    if (tool) {
                                        // console.log(`Backfilling metadata for ${path.basename(fullPath)}`);
                                        const metadata = await tool.read(fullPath);
                                        db.prepare('UPDATE photos SET metadata_json = ? WHERE id = ?').run(JSON.stringify(metadata), photo.id);
                                        photo.metadata_json = JSON.stringify(metadata); // Update local obj
                                        needsUpdate = true;
                                    }
                                } catch (e) {
                                    console.error(`Failed to backfill metadata for ${fullPath}`, e);
                                }
                            }
                        }

                        if (!photo) {
                            // New file found
                            console.log(`[Scanner] New photo found: ${entry.name}`);
                            const previewPath = await extractPreview(fullPath);

                            try {
                                // Extract metadata
                                let metadata = {};
                                try {
                                    const tool = await getExifTool();
                                    if (tool) {
                                        metadata = await tool.read(fullPath);
                                    }
                                } catch (e) {
                                    console.error(`Failed to read metadata for ${fullPath}`, e);
                                }

                                insertStmt.run({
                                    file_path: fullPath,
                                    preview_cache_path: previewPath,
                                    created_at: new Date().toISOString(),
                                    metadata_json: JSON.stringify(metadata)
                                });
                                photo = selectStmt.get(fullPath); // Re-fetch the newly inserted photo
                            } catch (e) {
                                console.error('Insert failed', e);
                            }
                        }

                        if (photo) { // Only add to photos array and update progress if a photo object exists
                            photos.push(photo);
                            count++;
                            if (count % 10 === 0 || needsUpdate) {
                                if (onProgress) onProgress(count);
                                await new Promise(resolve => setTimeout(resolve, 0));
                            }
                        }
                    } else {
                        skippedStats[ext] = (skippedStats[ext] || 0) + 1;
                    }
                }
            }
        } catch (err) {
            console.error(`Error scanning ${currentPath}:`, err);
        }
    }

    await scan(dirPath);
    console.log(`[Scanner] Total files: ${totalFiles}, Processed: ${count}, Returned: ${photos.length}`);
    console.log(`[Scanner] Skipped Extensions:`, skippedStats);
    return photos;
}
