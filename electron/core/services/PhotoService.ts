import { FaceService } from './FaceService';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ExifTool } from 'exiftool-vendored';
import sharp from 'sharp';
import logger from '../../logger';
import { pythonProvider } from '../../infrastructure/PythonAIProvider';
import { getLibraryPath } from '../../store'; // Config later
import { FaceRepository } from '../../data/repositories/FaceRepository';
import { PhotoRepository } from '../../data/repositories/PhotoRepository';
// import { getDB } from '../../db'; // Transaction usage

export class PhotoService {
    private static _exiftool: ExifTool | null = null;
    private static _exiftoolInitPromise: Promise<ExifTool | null> | null = null;
    private static _scanningPhotos: Set<number> = new Set(); // Guard against concurrent scans


    static async getExifTool(): Promise<ExifTool | null> {
        if (this._exiftool) return this._exiftool;
        if (this._exiftoolInitPromise) return this._exiftoolInitPromise;

        this._exiftoolInitPromise = (async () => {
            try {
                logger.info('Initializing ExifTool in PhotoService...');
                const tool = new ExifTool({ taskTimeoutMillis: 5000, maxProcs: 1 });
                await tool.version();
                this._exiftool = tool;
                return tool;
            } catch (err) {
                logger.error('FAILED to initialize ExifTool.', err);
                return null;
            }
        })();
        return this._exiftoolInitPromise;
    }

    // --- PREVIEW GENERATION ---
    static async extractPreview(filePath: string, previewDir: string, forceRescan = false, throwOnError = false): Promise<string | null> {
        const normalizedPath = filePath.replace(/\\/g, '/');
        const hash = createHash('md5').update(normalizedPath).digest('hex');
        const previewPath = path.join(previewDir, `${hash}.jpg`);

        try {
            if (!forceRescan) {
                try { await fs.access(previewPath); return previewPath; } catch { }
            }

            const ext = path.extname(filePath).toLowerCase();
            const isRaw = !['.jpg', '.jpeg', '.png'].includes(ext);
            let rotationDegrees = 0;
            let shouldRotate = false;

            // Orientation Check
            let orientation = 1;
            try {
                const tool = await this.getExifTool();
                if (tool) {
                    const tags = await tool.read(filePath, ['Orientation']);
                    if (tags?.Orientation) {
                        orientation = tags.Orientation as number; // Keep raw value for Python
                        const val = tags.Orientation as any;
                        if (val === 3 || val.toString().includes('180')) { rotationDegrees = 180; shouldRotate = true; }
                        else if (val === 6 || val.toString().includes('90 CW')) { rotationDegrees = 90; shouldRotate = true; }
                        else if (val === 8 || val.toString().includes('270 CW')) { rotationDegrees = 270; shouldRotate = true; }
                    }
                }
            } catch (e) { }

            let extracted = false;

            // 1. RAW Extraction (ExifTool)
            // [Phase 53] Skip ExifTool extraction for RAWs to force High Quality Python conversion (and correct rotation)
            // ExifTool often extracts small/embedded thumbnails which user reported as "bad quality".
            if (isRaw && !['.tif', '.tiff'].includes(ext) && false) {
                try {
                    const toolResult = await this.getExifTool();
                    if (!toolResult) throw new Error("ExifTool unavailable");
                    const exiftool: ExifTool = toolResult!;

                    const tempPreviewPath = `${previewPath}.tmp`;
                    await exiftool.extractPreview(filePath, tempPreviewPath);
                    if (await fs.stat(tempPreviewPath).catch(() => null)) {
                        const meta = await sharp(tempPreviewPath).metadata();
                        if (meta.width && meta.width > 800) {
                            const pipeline = sharp(tempPreviewPath);
                            if (shouldRotate) pipeline.rotate(rotationDegrees);
                            await pipeline.resize(2560, 2560, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(previewPath);
                            extracted = true;
                        } else {
                            logger.warn(`[PhotoService] ExifTool extracted small preview (${meta.width}x${meta.height}) for ${path.basename(filePath)}. Ignoring.`);
                        }
                    }
                    try { await fs.unlink(tempPreviewPath); } catch { }
                } catch (e) { /* Fallback */ }
            }

            // 2. Sharp
            if (!extracted) {
                try {
                    const pipeline = sharp(filePath);
                    if (shouldRotate) pipeline.rotate(rotationDegrees);
                    await pipeline.resize(2560, 2560, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(previewPath);
                    extracted = true;
                } catch (e) { /* Fallback */ }
            }

            // 3. Python Fallback
            if (!extracted) {
                // Pass Orientation so rawpy logic knows how to rotate
                const res = await pythonProvider.generateThumbnail(filePath, { width: 2560, orientation: orientation });
                if (res.success && res.data) {
                    await fs.writeFile(previewPath, Buffer.from(res.data, 'base64'));
                    extracted = true;
                }
            }

            if (extracted) return previewPath;
            if (throwOnError) throw new Error("Failed to generate preview");

        } catch (e) {
            logger.error(`Preview generation failed key=${filePath}`, e);
            if (throwOnError) throw e;
        }
        return null;
    }

    // --- ROTATION ---
    static async rotatePhoto(photoId: number, filePath: string, rotationDegrees: number) {
        const ext = path.extname(filePath).toLowerCase();
        const isRaw = ['.arw', '.nef', '.cr2', '.dng', '.orf', '.rw2'].includes(ext);
        const previewsDir = path.join(getLibraryPath(), 'previews');
        await fs.mkdir(previewsDir, { recursive: true });

        // Normalize Rotation (to 0, 90, 180, 270)
        // rotationDegrees from UI is usually +/- 90 increments
        // Positive = Clockwise? UI says "Right" -> +90.
        // Python used `angle = -int(rotation_angle)` so Python rotate is CCW by default? 
        // Pillow: rotate(90) is CCW. So -90 is CW.
        // If UI sends +90, Python did `rotate(-90)` (CW). Correct.

        if (isRaw) {
            logger.info(`[PhotoService] Rotating RAW file ${filePath} by ${rotationDegrees} via ExifTool`);
            const tool = await this.getExifTool();
            if (!tool) throw new Error("ExifTool unavailable for RAW rotation");

            // 1. Get Current Orientation
            const tags = await tool.read(filePath, ['Orientation']);
            let currentOrt = (tags?.Orientation as number) || 1; // Default TopLeft
            if (typeof currentOrt !== 'number') currentOrt = 1; // Fallback if string

            // 2. Calculate New Orientation
            // Orientation Values:
            // 1=Horizontal(Normal), 6=Rotate 90 CW, 3=Rotate 180, 8=Rotate 270 CW
            // (Ignoring mirrored states 2,4,5,7 for simplicity unless we want robust support)

            // Map Orientation to Degrees (CW from Normal)
            const ortToDeg: Record<number, number> = { 1: 0, 6: 90, 3: 180, 8: 270 };
            const degToOrt: Record<number, number> = { 0: 1, 90: 6, 180: 3, 270: 8 };

            let currentDeg = ortToDeg[currentOrt] || 0;
            // Add rotation (ensure positive mod 360)
            let newDeg = (currentDeg + rotationDegrees) % 360;
            if (newDeg < 0) newDeg += 360;

            const newOrt = degToOrt[newDeg] || 1;

            logger.info(`[PhotoService] Updating Orientation: ${currentOrt} (${currentDeg}°) + ${rotationDegrees}° -> ${newDeg}° (Ort: ${newOrt})`);

            // 3. Write New Orientation
            // 3. Write New Orientation
            try {
                // Force numeric write and overwrite original
                // '-n' disables print conversion (writes raw number)
                // '-overwrite_original' prevents creating _original backups (which might cause permission issues or clutter)
                await tool.write(filePath, { Orientation: newOrt }, ['-n', '-overwrite_original']);
                logger.info(`[PhotoService] ExifTool write command completed checking verification...`);
            } catch (err: any) {
                logger.error(`[PhotoService] ExifTool write failed for ${filePath}: ${err.message}`);
                throw new Error(`ExifTool write failed: ${err.message}`);
            }

            // [Phase 53] Verify Write Success
            const vTags = await tool.read(filePath, ['Orientation']);
            const vOrt = vTags?.Orientation;
            if (vOrt !== newOrt) {
                logger.warn(`[PhotoService] Rotation Verification Failed! Expected ${newOrt}, got ${vOrt}. ExifTool might rely on backup tags or write failed.`);
            } else {
                logger.info(`[PhotoService] Verified Orientation Updated to ${vOrt}`);
            }

            // 2. Trigger Face Re-Scan
            // The file has physical dimensions of the original sensor (Landscape), but metadata says Portrait.
            // main.py needs 'orientation' to know to rotate the cv2 buffer before detection.
            logger.info(`[PhotoService] Triggering Face Re-Scan (with cleanRescan)...`);

            // Use the shared robust logic in analyzeImage
            await PhotoService.analyzeImage({
                photoId,
                filePath,
                scanMode: 'FAST',
                orientation: newOrt,
                cleanRescan: true // <--- Trigger deduplication & identity transfer
            });

            // 4. Force Regenerate Preview
            // We need to invalidate the cache so the UI sees the change
            // The `extractPreview` method handles rotation based on EXIF, so just calling it is enough
            await this.extractPreview(filePath, previewsDir, true, true);

            return { success: true, rotated: true, method: 'exiftool' };
        } else {
            // Non-RAW: Use Python/Pillow (destructive but fine for JPG/PNG usually, or better for compat)
            logger.info(`[PhotoService] Rotating Standard file ${filePath} by ${rotationDegrees} via Python`);
            return pythonProvider.sendRequest('rotate_image', { photoId, filePath, rotation: rotationDegrees, previewStorageDir: previewsDir });
        }
    }

    // --- AI WRAPPERS ---
    static async generateTags(photoId: number, filePath: string) {
        const result = await pythonProvider.sendRequest('generate_tags', { photoId, filePath }, 60000);

        if (result && !result.error && (result.description || result.tags)) {
            // DB Updates
            // const db = getDB();
            const updates: string[] = [];

            if (result.description) {
                PhotoRepository.updatePhoto(photoId, { description: result.description });
                updates.push("Description saved");
            }
            if (result.tags) {
                PhotoRepository.addTags(photoId, result.tags);
                updates.push(`Tags saved: ${result.tags.length}`);
            }
            result.dbStatus = updates.join(", ");
        }
        return result;
    }

    static async analyzeImage(options: any) {
        const { photoId, filePath, cleanRescan } = options;

        // Guard: Prevent concurrent scans of the same photo
        if (this._scanningPhotos.has(photoId)) {
            logger.warn(`[PhotoService] Photo ${photoId} is already being scanned. Skipping duplicate request.`);
            return { success: false, error: 'Scan already in progress' };
        }

        this._scanningPhotos.add(photoId);
        logger.info(`[PhotoService] Starting scan for Photo ${photoId} (cleanRescan=${cleanRescan})`);

        try {
            let oldFaces: any[] = [];
            if (cleanRescan === true) {
                logger.info(`[PhotoService] cleanRescan=TRUE for Photo ${photoId}. Fetching old faces...`);
                oldFaces = FaceRepository.getFacesByPhoto(photoId);
                logger.info(`[PhotoService] Found ${oldFaces.length} existing faces.`);

                if (oldFaces.length > 0) {
                    const oldIds = oldFaces.map(f => f.id);
                    logger.info(`[PhotoService] Clean Rescan: Removing ${oldIds.length} existing faces before scan: [${oldIds.join(', ')}]`);
                    try {
                        FaceRepository.deleteFaces(oldIds);
                        logger.info(`[PhotoService] Deletion completed.`);
                    } catch (e) {
                        logger.error(`[PhotoService] FAILED to delete faces: ${e}`);
                    }
                } else {
                    logger.info(`[PhotoService] No existing faces to delete.`);
                }
            } else {
                logger.info(`[PhotoService] cleanRescan=FALSE (or undefined) for Photo ${photoId}. Caller Trace:`);
                console.trace(`[PhotoService] Analyze Trigger Trace`);
            }

            // Call Python Provider
            // Note: pythonProvider.analyzeImage sends 'analyze_image' command
            // PythonAIProvider will call FaceService.processAnalysisResult internally
            const result = await pythonProvider.analyzeImage(filePath, options);

            // Identity Transfer logic (only for cleanRescan)
            if (cleanRescan === true && oldFaces.length > 0 && result && result.faces) {
                const newFaces = FaceRepository.getFacesByPhoto(photoId);
                let recoveredCount = 0;

                for (const oldFace of oldFaces) {
                    if (!oldFace.person_id) continue;
                    if (!oldFace.descriptor || oldFace.descriptor.length === 0) continue;

                    let bestMatch = null;
                    let bestDist = 100.0;

                    for (const newFace of newFaces) {
                        if (newFace.person_id) continue;
                        if (!newFace.descriptor || newFace.descriptor.length === 0) continue;

                        const dist = FaceService.calculateL2Distance(oldFace.descriptor, newFace.descriptor);
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestMatch = newFace;
                        }
                    }

                    // Threshold: 0.35 (Same as rotate logic)
                    if (bestMatch && bestDist < 0.35) {
                        logger.info(`[PhotoService] Recovered identity for Person ${oldFace.person_id} (dist: ${bestDist.toFixed(3)})`);
                        FaceRepository.assignFacesToPerson([bestMatch.id], oldFace.person_id, {
                            assignment_source: oldFace.assignment_source || 'manual_recovered',
                            is_confirmed: !!oldFace.is_confirmed
                        });
                        recoveredCount++;
                    }
                }
                logger.info(`[PhotoService] Clean Rescan: Identity Transfer recovered ${recoveredCount} faces.`);
            }

            return result;
        } finally {
            // Always remove from scanning set, even if error occurs
            this._scanningPhotos.delete(photoId);
            logger.info(`[PhotoService] Scan completed for Photo ${photoId}`);
        }
    }
}
