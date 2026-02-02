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

                // Process next batch
                await this.processNextBatch();

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

                if (result.is_face === true) {
                    // [Phase 58 Part 3] If VLM confirms face AND aspect ratio is suspicious, check for multi-face
                    if (isSuspiciousAspectRatio && aspectRatio > 1.5) {
                        logger.info(`[BackgroundVerificationService] Face ${face.id} has suspicious aspect ratio ${aspectRatio.toFixed(2)}, checking for multiple faces...`);

                        const regionResult = await pythonProvider.detectFacesInRegion(
                            face.file_path,
                            box,
                            1, // orientation (default to normal, face records don't store orientation)
                            0.5 // detection threshold
                        );

                        if (!regionResult.error && regionResult.faceCount > 1) {
                            // Multi-face box detected! Split it
                            logger.info(`[BackgroundVerificationService] Face ${face.id} contains ${regionResult.faceCount} faces, splitting...`);

                            // Mark original face as rejected (it's a multi-face box)
                            FaceRepository.markFaceAsRejected(face.id);

                            // Create new face records for each detected face
                            await this.createSplitFaces(face, regionResult.faces);

                            logger.info(`[BackgroundVerificationService] Successfully split face ${face.id} into ${regionResult.faceCount} individual faces`);
                        } else if (regionResult.error) {
                            logger.warn(`[BackgroundVerificationService] Detector error for face ${face.id}: ${regionResult.error}`);
                            // Check score before promoting
                            if (face.score && face.score < 0.35) {
                                // VLM confirmed it's a face, but detector score is extremely low
                                // Likely a high-confidence VLM hallucination (e.g. a hand)
                                FaceRepository.deleteFaces([face.id]);
                                logger.info(`[BackgroundVerificationService] Face ${face.id} deleted as likely false positive (score: ${face.score.toFixed(3)})`);
                            } else {
                                FaceRepository.updateFaceEntityType(face.id, 'human');
                            }
                        } else {
                            // Only 1 face detected, just wide box - check score before promoting
                            if (face.score && face.score < 0.35) {
                                // VLM confirmed it's a face, but score is too low
                                FaceRepository.deleteFaces([face.id]);
                                logger.info(`[BackgroundVerificationService] Face ${face.id} deleted as likely false positive (score: ${face.score.toFixed(3)})`);
                            } else {
                                FaceRepository.updateFaceEntityType(face.id, 'human');
                                logger.info(`[BackgroundVerificationService] Face ${face.id} verified as single face (wide box, confidence: ${result.confidence})`);
                            }
                        }
                    } else {
                        // Normal aspect ratio - check score before promoting
                        if (face.score && face.score < 0.35) {
                            // VLM confirmed it's a face, but score is too low
                            FaceRepository.deleteFaces([face.id]);
                            logger.info(`[BackgroundVerificationService] Face ${face.id} deleted as likely false positive (score: ${face.score.toFixed(3)})`);
                        } else {
                            FaceRepository.updateFaceEntityType(face.id, 'human');
                            logger.info(`[BackgroundVerificationService] Face ${face.id} verified as human (confidence: ${result.confidence})`);
                        }
                    }
                } else if (result.is_face === false) {
                    // Reject as false positive - DELETE from DB to remove box from UI
                    FaceRepository.deleteFaces([face.id]);
                    logger.info(`[BackgroundVerificationService] Face ${face.id} deleted as non-face (reason: ${result.reason})`);
                } else {
                    // VLM error (is_face = null)
                    const attempts = FaceRepository.incrementVerificationAttempts(face.id);
                    logger.warn(`[BackgroundVerificationService] VLM error for face ${face.id} (attempt ${attempts}/${MAX_ATTEMPTS}): ${result.error}`);

                    // Auto-ignore after max attempts
                    if (attempts >= MAX_ATTEMPTS) {
                        FaceRepository.markFaceAsRejected(face.id);
                        logger.warn(`[BackgroundVerificationService] Face ${face.id} auto-ignored after ${MAX_ATTEMPTS} failed attempts`);
                    }
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
     * [Phase 58 Part 3] Create new face records from split multi-face box.
     * Inserts individual faces detected within a multi-face region.
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

        for (const detectedFace of detectedFaces) {
            try {
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
                logger.debug(`[BackgroundVerificationService] Created split face from original face ${originalFace.id}`);
            } catch (e) {
                logger.error(`[BackgroundVerificationService] Failed to create split face:`, e);
            }
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
