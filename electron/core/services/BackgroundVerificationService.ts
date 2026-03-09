import { BrowserWindow } from 'electron';
import logger from '../../logger';
import { IService } from '../interfaces/IService';
import { FaceRepository } from '../../data/repositories/FaceRepository';
import { pythonProvider } from '../../infrastructure/PythonAIProvider';
import { AppStateRepository } from '../../data/repositories/AppStateRepository';

/**
 * Background service that verifies low-confidence face detections using VLM.
 * Processes 'suspect' faces asynchronously to filter out false positives.
 * (Phase 56: Background VLM Verification)
 */
export class BackgroundVerificationService implements IService {
    private isRunning = false;
    private shouldStop = false;
    private lastLogTime = 0;

    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn('[BackgroundVerificationService] Already running');
            return;
        }

        this.isRunning = true;
        this.shouldStop = false;
        logger.info('[BackgroundVerificationService] Starting...');

        this.runLoop();
    }

    stop(): void {
        if (!this.isRunning) return;

        logger.info('[BackgroundVerificationService] Stop requested.');
        this.shouldStop = true;
        this.isRunning = false;
    }

    isServiceRunning(): boolean {
        return this.isRunning;
    }

    private async runLoop(): Promise<void> {
        while (!this.shouldStop) {
            try {
                // Pause if scanning is active
                const isScanning = AppStateRepository.isAIProcessingActive();
                if (isScanning) {
                    await this.sleep(5000);
                    continue;
                }

                // Process suspect faces (primary pipeline)
                await this.processNextBatch();

                // Process orphaned faces (secondary pass — catch false positives that slipped bucketing)
                await this.processOrphanedFaces();

                // Sleep between batches
                await this.sleep(5000);
            } catch (e) {
                logger.error('[BackgroundVerificationService] Loop error:', e);
                await this.sleep(10000); // Longer sleep on error
            }
        }

        logger.info('[BackgroundVerificationService] Stopped.');
    }

    private async processNextBatch(): Promise<void> {
        const BATCH_SIZE = 10;
        const MAX_ATTEMPTS = 3;

        // Fetch suspect faces (ordered by recent photos first)
        const suspects = FaceRepository.getSuspectFaces(BATCH_SIZE);
        const totalSuspect = FaceRepository.countSuspectFaces();

        if (suspects.length === 0) {
            // Log periodically to show service is alive (every ~30 seconds = 6 iterations * 5s sleep)
            if (!this.lastLogTime || Date.now() - this.lastLogTime > 30000) {
                logger.info(`[BackgroundVerificationService] No suspect faces to verify (total pending: ${totalSuspect})`);
                this.lastLogTime = Date.now();
            }
            return;
        }

        logger.info(`[BackgroundVerificationService] Processing ${suspects.length} suspect faces (${totalSuspect} total pending)`);

        for (const face of suspects) {
            if (this.shouldStop) break;

            try {
                // Parse box coordinates
                const box = JSON.parse(face.box_json);
                const boxCoords = {
                    x1: box.x,
                    y1: box.y,
                    x2: box.x + box.width,
                    y2: box.y + box.height
                };

                // [Phase 58 Part 3] Check aspect ratio for potential multi-face boxes
                const aspectRatio = box.width / box.height;
                const isSuspiciousAspectRatio = aspectRatio > 1.5 || aspectRatio < 0.67;

                // Call VLM verification
                const result = await pythonProvider.verifyFace(face.file_path, boxCoords);

                // [Phase 90] VLM as Negative Filter Only
                // VLM can reject (is_face===false) but cannot override detector.
                // If VLM says "Yes" or returns unknown/error, trust the detector's 0.40+ score.

                if (result.is_face === false) {
                    // VLM identified a specific non-face object → reject
                    FaceRepository.ignoreFaces([face.id]);
                    this.notifyPhotoChanged(face.photo_id);
                    logger.info(`[BackgroundVerificationService] Face ${face.id} rejected by VLM (reason: ${result.reason})`);
                } else if (result.is_face === true) {
                    // [Phase 58 Part 3] If VLM confirms face AND (aspect ratio is suspicious OR multi-face detected), check for split
                    // Cast to any to access is_multi_face which might not be in interface yet
                    const isMultiFace = (result.suggested_metadata as any)?.is_multi_face === true;

                    if ((isSuspiciousAspectRatio && aspectRatio > 1.5) || isMultiFace) {
                        logger.info(`[BackgroundVerificationService] Face ${face.id} flagged for split check. Aspect: ${aspectRatio.toFixed(2)}, Multi-Face Trigger: ${isMultiFace}`);

                        let regionResult = await pythonProvider.detectFacesInRegion(
                            face.file_path,
                            box,
                            {
                                orientation: 1,
                                detThreshold: 0.5
                            }
                        );

                        // [Phase 58 Fix] Multi-Scale Split Strategy
                        // If VLM says multi-face but detector found <= 1 face at default (1280) scale,
                        // allow retrying with a smaller scale (640) which handles large/close faces better.
                        if (isMultiFace && (!regionResult.faceCount || regionResult.faceCount <= 1)) {
                            logger.info(`[BackgroundVerificationService] Face ${face.id} multi-face check failed at default scale. Retrying with low-res scale (640)...`);
                            const lowResResult = await pythonProvider.detectFacesInRegion(
                                face.file_path,
                                box,
                                {
                                    orientation: 1,
                                    detThreshold: 0.5,
                                    detSize: [640, 640]
                                }
                            );

                            if (lowResResult.faceCount > (regionResult.faceCount || 0)) {
                                regionResult = lowResResult;
                                logger.info(`[BackgroundVerificationService] Low-res scale successful: Found ${regionResult.faceCount} faces.`);
                            }
                        }

                        if (!regionResult.error && regionResult.faceCount > 1) {
                            // Multi-face box detected! Split it
                            logger.info(`[BackgroundVerificationService] Face ${face.id} contains ${regionResult.faceCount} faces, splitting...`);

                            // Mark original face as rejected (it's a multi-face box)
                            FaceRepository.markFaceAsRejected(face.id);

                            // Create new face records for each detected face
                            await this.createSplitFaces(face, regionResult.faces);

                            this.notifyPhotoChanged(face.photo_id);
                            logger.info(`[BackgroundVerificationService] Successfully split face ${face.id} into ${regionResult.faceCount} individual faces`);
                        } else if (regionResult.error) {
                            logger.warn(`[BackgroundVerificationService] Detector error for face ${face.id}: ${regionResult.error}`);
                            // Fallback: If VLM says "Multi-Face" but Detector says "Error" or "1 Face", what to do?
                            // For now, treat as human if detector fails to split? Or reject?
                            // If VLM is very confident about "Two Men", keeping 1 box is bad.
                            if (isMultiFace) {
                                FaceRepository.markFaceAsRejected(face.id); // Reject the blob
                                logger.info(`[BackgroundVerificationService] Rejected face ${face.id} because VLM detected multiple people but detector failed to split.`);
                            }
                        } else {
                            // Region detector found 0 or 1 face.
                            if (isMultiFace) {
                                // VLM sees 2, Detector sees 1.
                                // FALLBACK: Keep the blob as 'human' (merged face is better than NO face).
                                // We trust VLM that it IS a face, even if it's multiple people.
                                FaceRepository.updateFaceEntityType(face.id, 'human');
                                if (result.suggested_metadata) {
                                    FaceRepository.updateFaceDemographics(face.id, result.suggested_metadata);
                                }
                                this.notifyPhotoChanged(face.photo_id);
                                logger.info(`[BackgroundVerificationService] Split Failed for Face ${face.id}: VLM detected multiple people but detector found only ${regionResult.faceCount}. Keeping original face.`);
                            } else {
                                // Normal aspect ratio case or VLM matched single face
                                FaceRepository.updateFaceEntityType(face.id, 'human');
                                if (result.suggested_metadata) {
                                    FaceRepository.updateFaceDemographics(face.id, result.suggested_metadata);
                                }
                                this.notifyPhotoChanged(face.photo_id);
                                logger.info(`[BackgroundVerificationService] Face ${face.id} verified as human (confidence: ${result.confidence})`);
                            }
                        }
                    } else {
                        // Normal aspect ratio - VLM confirmed face
                        FaceRepository.updateFaceEntityType(face.id, 'human');

                        if (result.suggested_metadata) {
                            FaceRepository.updateFaceDemographics(face.id, result.suggested_metadata);
                            logger.info(`[BackgroundVerificationService] Applied VLM demographics for Face ${face.id}: ${JSON.stringify(result.suggested_metadata)}`);
                        }

                        this.notifyPhotoChanged(face.photo_id);
                        logger.info(`[BackgroundVerificationService] Face ${face.id} verified as human (confidence: ${result.confidence})`);
                    }
                } else {
                    // [Phase 90] VLM returned unknown/error (is_face=null) → accept as human
                    // Detector's 0.40+ score is trusted. VLM only has veto power.
                    FaceRepository.updateFaceEntityType(face.id, 'human');
                    this.notifyPhotoChanged(face.photo_id);
                    logger.info(`[BackgroundVerificationService] Face ${face.id} accepted as human (VLM unknown/error, trusting detector score)`);
                }

                // Yield to event loop between faces
                await this.sleep(100);
            } catch (e) {
                logger.error(`[BackgroundVerificationService] Error processing face ${face.id}:`, e);
                // Increment attempts on exception
                const attempts = FaceRepository.incrementVerificationAttempts(face.id);
                if (attempts >= MAX_ATTEMPTS) {
                    FaceRepository.markFaceAsRejected(face.id);
                    logger.warn(`[BackgroundVerificationService] Face ${face.id} auto-ignored after exception (${attempts} attempts)`);
                }
            }
        }
    }

    /**
     * Phase 104: Re-verify orphaned faces using VLM as a negative filter.
     * Orphans are human-confirmed faces that completed bucketing but were never
     * matched to any person or bucket — potential cartoon/object false positives.
     * Rejects are marked with ignore_source='background_verification'.
     */
    private async processOrphanedFaces(): Promise<void> {
        const BATCH_SIZE = 10;

        const orphans = FaceRepository.getOrphanedFaces(BATCH_SIZE);
        const totalOrphans = FaceRepository.countOrphanedFaces();

        if (orphans.length === 0) {
            return;
        }

        logger.info(`[BackgroundVerificationService] Verifying ${orphans.length} orphaned faces (${totalOrphans} total orphans)`);

        for (const face of orphans) {
            if (this.shouldStop) break;

            try {
                const box = JSON.parse(face.box_json);
                const boxCoords = {
                    x1: box.x,
                    y1: box.y,
                    x2: box.x + box.width,
                    y2: box.y + box.height
                };

                const result = await pythonProvider.verifyFace(face.file_path, boxCoords);

                if (result.is_face === false) {
                    FaceRepository.ignoreFaces([face.id], 'background_verification');
                    this.notifyPhotoChanged(face.photo_id);
                    logger.info(`[BackgroundVerificationService] Orphan face ${face.id} auto-ignored (VLM: ${result.reason})`);
                } else {
                    // Mark as checked so it doesn't re-enter the orphan queue next cycle
                    FaceRepository.incrementVerificationAttempts(face.id);
                    logger.debug(`[BackgroundVerificationService] Orphan face ${face.id} confirmed by VLM, marked as checked`);
                }

                await this.sleep(100);
            } catch (e) {
                logger.error(`[BackgroundVerificationService] Error processing orphan face ${face.id}:`, e);
                // Increment so the face doesn't re-enter the orphan queue on the next cycle
                FaceRepository.incrementVerificationAttempts(face.id);
            }
        }
    }

    /**
     * [Phase 58 Part 3] Create new face records from split multi-face box.
     * Inserts individual faces detected within a multi-face region.
     * [Phase 75 Fix] Now checks for overlap with existing faces to prevent duplicates.
     */
    private async createSplitFaces(
        originalFace: any,
        detectedFaces: Array<{
            box: { x: number; y: number; width: number; height: number };
            score: number;
            embedding: number[] | null;
        }>
    ): Promise<void> {
        const db = (await import('../../db')).getDB();

        // [Phase 75] Get existing faces in this photo to check for duplicates
        const existingFaces = FaceRepository.getFacesByPhoto(originalFace.photo_id);
        type BoxType = { x: number; y: number; width: number; height: number };
        const existingBoxes = existingFaces
            .filter((f: { id: number; is_ignored?: number; box_json: string }) => f.id !== originalFace.id && !f.is_ignored) // Exclude original and ignored faces
            .map((f: { box_json: string }) => {
                try {
                    return JSON.parse(f.box_json) as BoxType;
                } catch {
                    return null;
                }
            })
            .filter((b: BoxType | null): b is BoxType => b !== null);

        const insertStmt = db.prepare(`
            INSERT INTO faces(
                photo_id, person_id, descriptor, box_json, blur_score,
                is_reference, confidence_tier, suggested_person_id, match_distance,
                pose_yaw, pose_pitch, pose_roll, face_quality,
                session_folder, session_date, needs_bucketing,
                assignment_source, is_confirmed, estimated_age, gender,
                entity_type, score, verification_attempts
            )
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let insertedCount = 0;
        let skippedCount = 0;

        for (const detectedFace of detectedFaces) {
            try {
                // [Phase 75] Check if this face overlaps significantly with an existing face
                const newBox = detectedFace.box;
                let isDuplicate = false;

                for (const existingBox of existingBoxes) {
                    // Calculate IoMin (containment metric)
                    const x1 = Math.max(newBox.x, existingBox.x);
                    const y1 = Math.max(newBox.y, existingBox.y);
                    const x2 = Math.min(newBox.x + newBox.width, existingBox.x + existingBox.width);
                    const y2 = Math.min(newBox.y + newBox.height, existingBox.y + existingBox.height);

                    const interArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
                    const newArea = newBox.width * newBox.height;
                    const existingArea = existingBox.width * existingBox.height;
                    const minArea = Math.min(newArea, existingArea);

                    const ioMin = minArea > 0 ? interArea / minArea : 0;

                    // If >50% overlap, it's likely a duplicate of an existing face
                    if (ioMin > 0.5) {
                        logger.info(`[BackgroundVerificationService] Skipping duplicate split face: IoMin=${ioMin.toFixed(2)} with existing face`);
                        isDuplicate = true;
                        break;
                    }
                }

                if (isDuplicate) {
                    skippedCount++;
                    continue;
                }

                // Convert embedding to Buffer if present
                let descriptorBuffer = null;
                if (detectedFace.embedding && detectedFace.embedding.length > 0) {
                    descriptorBuffer = Buffer.from(new Float32Array(detectedFace.embedding).buffer);
                }

                const insertParams = [
                    originalFace.photo_id,
                    null, // person_id (unassigned)
                    descriptorBuffer,
                    JSON.stringify(detectedFace.box),
                    null, // blur_score (will be calculated later if needed)
                    0, // is_reference
                    'unknown', // confidence_tier
                    null, // suggested_person_id
                    null, // match_distance
                    null, // pose_yaw
                    null, // pose_pitch
                    null, // pose_roll
                    null, // face_quality
                    null, // session_folder
                    null, // session_date
                    1, // needs_bucketing (yes, needs clustering)
                    'split_multiface', // assignment_source (Phase 58)
                    0, // is_confirmed
                    null, // estimated_age
                    null, // gender
                    'human', // entity_type (detector confirmed these are faces)
                    detectedFace.score, // detection score
                    0 // verification_attempts
                ];

                insertStmt.run(...insertParams);
                insertedCount++;
                logger.debug(`[BackgroundVerificationService] Created split face from original face ${originalFace.id}`);
            } catch (e) {
                logger.error(`[BackgroundVerificationService] Failed to create split face:`, e);
            }
        }

        if (skippedCount > 0) {
            logger.info(`[BackgroundVerificationService] Split complete: ${insertedCount} new faces created, ${skippedCount} duplicates skipped`);
        }
    }

    /**
     * Notify frontend that a photo's face data has changed.
     * Triggers UI refresh in PhotoDetail view.
     */
    private notifyPhotoChanged(photoId: number) {
        BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
                win.webContents.send('background-verification-result', { photoId });
            }
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
