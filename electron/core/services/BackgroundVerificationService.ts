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

                // Call VLM verification
                const result = await pythonProvider.verifyFace(face.file_path, boxCoords);

                if (result.is_face === true) {
                    // Promote to 'human'
                    FaceRepository.updateFaceEntityType(face.id, 'human');
                    logger.info(`[BackgroundVerificationService] Face ${face.id} verified as human (confidence: ${result.confidence})`);
                } else if (result.is_face === false) {
                    // Reject as false positive
                    FaceRepository.markFaceAsRejected(face.id);
                    logger.info(`[BackgroundVerificationService] Face ${face.id} rejected as non-face (reason: ${result.reason})`);
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

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
