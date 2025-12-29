import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ExifTool } from 'exiftool-vendored';
import sharp from 'sharp';
import logger from '../logger';
import { sendRequestToPython } from './pythonService';
import { getLibraryPath } from '../store';

// Singleton path for now, maybe move to config?
// const SUPPORTED_EXTS = ['.jpg', '.jpeg', '.png', '.arw', '.cr2', '.nef', '.dng', '.orf', '.rw2', '.tif', '.tiff'];

export class PhotoService {
    private static _exiftool: ExifTool | null = null;
    private static _exiftoolInitPromise: Promise<ExifTool | null> | null = null;

    static async getExifTool(): Promise<ExifTool | null> {
        if (this._exiftool) return this._exiftool;
        if (this._exiftoolInitPromise) return this._exiftoolInitPromise;

        this._exiftoolInitPromise = (async () => {
            try {
                logger.info('Initializing ExifTool in PhotoService...');
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
                this._exiftool = tool;
                return tool;
            } catch (err) {
                logger.error('FAILED to initialize ExifTool. RAW support will be disabled.', err);
                return null;
            }
        })();

        return this._exiftoolInitPromise;
    }

    static async extractPreview(filePath: string, previewDir: string, forceRescan: boolean = false): Promise<string | null> {
        // Use hash of NORMALIZED filePath to ensure consistency (Forward Slashes)
        const normalizedPath = filePath.replace(/\\/g, '/');
        const fileName = path.basename(filePath);
        const hash = createHash('md5').update(normalizedPath).digest('hex');
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
                const tool = await this.getExifTool();
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
                        const tool = await this.getExifTool();
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

                            // Verify write
                            try {
                                const stats = await fs.stat(previewPath);
                                if (stats.size === 0) throw new Error("Zero byte preview file");
                                logger.info(`Valid preview generated at ${previewPath} (${stats.size} bytes)`);
                            } catch (verifyErr) {
                                logger.error(`Preview verification failed for ${previewPath}`, verifyErr);
                                throw verifyErr; // Trigger fallback
                            }

                            try { await fs.unlink(tempPreviewPath); } catch { /* ignore */ }
                            logger.info(`Extracted and normalized preview for ${fileName}`);
                            extracted = true;
                        }
                    } catch (e: any) {
                        logger.warn(`ExifTool preview extraction failed for ${fileName}: ${e.message || JSON.stringify(e)}`);
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
                    // Try regular Sharp extraction first
                    const pipeline = sharp(filePath);
                    if (shouldRotate) pipeline.rotate(rotationDegrees);

                    await pipeline
                        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
                        .jpeg({ quality: 80 })
                        .toFile(previewPath);
                    return previewPath;
                } catch (e) {
                    // Fallback: If generic sharp failed (e.g. corrupt JPG info),
                    // Try basic copy if small enough, or just fail cleanly
                    logger.error(`Failed to generate preview for image ${fileName}`, e);

                    // Final ditch: Try strict validation off?
                    try {
                        await sharp(filePath, { failOnError: false })
                            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
                            .jpeg({ quality: 80 })
                            .toFile(previewPath);
                        logger.info(`Generated preview (failOnError: false) for ${fileName}`);
                        return previewPath;
                    } catch (e2) {
                        logger.error(`Hard fail preview ${fileName}`, e2);
                    }
                }
            }

        } catch (e) {
            logger.error(`Failed to extract/generate preview for ${filePath}`, e);
        }
        return null;
    }

    static async rotatePhoto(photoId: number, filePath: string, rotationDegrees: number): Promise<{ success: boolean; width?: number; height?: number; error?: string }> {
        const previewsDir = path.join(getLibraryPath(), 'previews');
        await fs.mkdir(previewsDir, { recursive: true });

        const ext = path.extname(filePath).toLowerCase();
        const isRaw = ['.arw', '.cr2', '.nef', '.dng', '.orf', '.rw2', '.raf', '.pef', '.srw'].includes(ext);

        try {
            if (isRaw) {
                const tool = await this.getExifTool();
                if (!tool) throw new Error("ExifTool not available for RAW");

                // 1. Get current orientation
                const tags = await tool.read(filePath, ['Orientation']);
                const current = (tags?.Orientation as number) || 1;

                // 2. Calculate New Orientation
                const delta = Number(rotationDegrees);

                // Map Integer (1,3,6,8) -> Degrees (0, 180, 90, 270)
                const mapValToDeg: Record<number, number> = { 1: 0, 3: 180, 6: 90, 8: 270 };
                const mapDegToVal: Record<number, number> = { 0: 1, 180: 3, 90: 6, 270: 8 };

                const currentDeg = mapValToDeg[current] !== undefined ? mapValToDeg[current] : 0;
                let newDeg = (currentDeg + delta) % 360;
                if (newDeg < 0) newDeg += 360;

                const newVal = mapDegToVal[newDeg] || 1;

                logger.info(`[Rotate] RAW provided. Current: ${current} (${currentDeg}°). New: ${newVal} (${newDeg}°).`);

                // 3. Write New Orientation
                await tool.write(filePath, { Orientation: newVal as any }, ['-overwrite_original', '-n']);

                // 4. Regenerate Preview
                const previewPath = await this.extractPreview(filePath, previewsDir, true);
                if (!previewPath) throw new Error("Failed to regenerate preview after rotation");

                const meta = await sharp(previewPath).metadata();
                return { success: true, width: meta.width, height: meta.height };
            } else {
                // Standard Image -> Python (Pillow)
                const result: any = await sendRequestToPython('rotate_image', {
                    photoId,
                    filePath,
                    previewStorageDir: previewsDir,
                    rotation: rotationDegrees
                }, 30000);

                return result;
            }
        } catch (e: any) {
            logger.error(`Rotation failed: ${e}`);
            return { success: false, error: String(e) };
        }
    }
}
