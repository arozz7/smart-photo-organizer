import { getDB } from '../../db';
import { PersonRepository } from '../../data/repositories/PersonRepository';
import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { PersonService } from './PersonService';
import { PythonAIProvider } from '../../infrastructure/PythonAIProvider';
import logger from '../../logger';
import { BrowserWindow } from 'electron';

import { IService } from '../../core/interfaces/IService';

/**
 * Service managing background age data backfill for existing faces.
 * 
 * Responsibilities:
 * 1. Iterates through faces missing estimated_age data.
 * 2. Calls Python AI to extract age from face crops.
 * 3. Updates face records with age/gender data.
 * 4. Auto-generates ERAs for named persons after completion.
 * 5. Respects scanning state and supports graceful shutdown.
 */
export class BackgroundAgeRescanService implements IService {
    private isRunning = false;
    private shouldStop = false;
    private isPaused = false;
    private aiProvider: PythonAIProvider;
    private batchSize = 20; // Smaller batch since age extraction is more intensive
    private loopIntervalMs = 3000;
    private busyIntervalMs = 1000;

    // Checkpointing keys
    private static readonly STATE_KEY_ACTIVE = 'age_rescan_active';
    private static readonly STATE_KEY_OFFSET = 'age_rescan_offset';
    private static readonly STATE_KEY_TOTAL = 'age_rescan_total';
    private static readonly STATE_KEY_PROCESSED = 'age_rescan_processed';

    private stopPromise: Promise<void> | null = null;
    private resolveStop: (() => void) | null = null;

    constructor(aiProvider: PythonAIProvider) {
        this.aiProvider = aiProvider;
    }

    /**
     * Yield to event loop to allow IPC handlers to process.
     */
    private yield(): Promise<void> {
        return new Promise(resolve => setImmediate(resolve));
    }

    /**
     * Check if the service can be started (not already running, has work to do).
     */
    canStart(): boolean {
        return !this.isRunning && this.getFacesNeedingAgeCount() > 0;
    }

    /**
     * Check if a rescan is currently active (running or paused).
     */
    isActive(): boolean {
        const db = getDB();
        const result = db.prepare('SELECT value FROM app_state WHERE key = ?').get(BackgroundAgeRescanService.STATE_KEY_ACTIVE) as { value: string } | undefined;
        return result?.value === '1';
    }

    /**
     * Auto-resume if there was an interrupted session.
     * Call this on app startup to continue from checkpoint.
     */
    resumeIfNeeded(): boolean {
        if (this.isActive() && !this.isRunning) {
            logger.info('[BackgroundAgeRescanService] Detected interrupted session, auto-resuming...');
            this.start();
            return true;
        }
        return false;
    }

    /**
     * Get current progress.
     */
    getProgress(): { processed: number; total: number; percentage: number } {
        const db = getDB();
        const processed = parseInt(
            (db.prepare('SELECT value FROM app_state WHERE key = ?').get(BackgroundAgeRescanService.STATE_KEY_PROCESSED) as { value: string })?.value || '0'
        );
        const total = parseInt(
            (db.prepare('SELECT value FROM app_state WHERE key = ?').get(BackgroundAgeRescanService.STATE_KEY_TOTAL) as { value: string })?.value || '0'
        );
        return {
            processed,
            total: Math.max(total, processed),
            percentage: Math.max(total, processed) > 0 ? Math.round((processed / Math.max(total, processed)) * 100) : 0
        };
    }

    /**
     * Start the age rescan service.
     */
    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.shouldStop = false;
        this.isPaused = false;

        this.stopPromise = new Promise(resolve => {
            this.resolveStop = resolve;
        });

        // Initialize state if not resuming
        const db = getDB();
        if (!this.isActive()) {
            const total = this.getFacesNeedingAgeCount();
            db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(BackgroundAgeRescanService.STATE_KEY_ACTIVE, '1');
            db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(BackgroundAgeRescanService.STATE_KEY_TOTAL, String(total));
            db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(BackgroundAgeRescanService.STATE_KEY_PROCESSED, '0');
            db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(BackgroundAgeRescanService.STATE_KEY_OFFSET, '0');
            logger.info(`[BackgroundAgeRescanService] Starting fresh with ${total} faces to process.`);
        } else {
            const progress = this.getProgress();
            logger.info(`[BackgroundAgeRescanService] Resuming: ${progress.processed}/${progress.total} (${progress.percentage}%)`);
        }

        this.loop();
        logger.info('[BackgroundAgeRescanService] Started.');
    }

    /**
     * Stop the service gracefully.
     */
    async stop(): Promise<void> {
        if (!this.isRunning) return;

        this.shouldStop = true;
        logger.info('[BackgroundAgeRescanService] Stop requested.');

        if (this.stopPromise) {
            return this.stopPromise;
        }
    }

    /**
     * Pause the service (rescan can be resumed).
     */
    pause() {
        this.isPaused = true;
        logger.info('[BackgroundAgeRescanService] Paused.');
    }

    /**
     * Resume from paused state.
     */
    resume() {
        this.isPaused = false;
        logger.info('[BackgroundAgeRescanService] Resumed.');
    }

    /**
     * Cancel the rescan completely and reset state.
     */
    cancel() {
        this.shouldStop = true;
        const db = getDB();
        db.prepare('DELETE FROM app_state WHERE key IN (?, ?, ?, ?)').run(
            BackgroundAgeRescanService.STATE_KEY_ACTIVE,
            BackgroundAgeRescanService.STATE_KEY_TOTAL,
            BackgroundAgeRescanService.STATE_KEY_PROCESSED,
            BackgroundAgeRescanService.STATE_KEY_OFFSET
        );
        logger.info('[BackgroundAgeRescanService] Cancelled and state reset.');
    }

    private async loop() {
        while (!this.shouldStop) {
            try {
                // 1. Check shutdown request
                if (AppStateRepository.isShutdownRequested()) {
                    logger.info('[BackgroundAgeRescanService] Shutdown requested. Exiting loop.');
                    break;
                }

                // 2. Check if paused
                if (this.isPaused) {
                    await this.sleep(this.loopIntervalMs);
                    continue;
                }

                // 3. Yield to active scans/AI processing
                if (AppStateRepository.isScanActive() || AppStateRepository.isAIProcessingActive()) {
                    await this.sleep(this.loopIntervalMs);
                    continue;
                }

                // 4. Process next batch
                const processedCount = await this.processNextBatch();

                // 5. Update progress and send to UI
                this.emitProgress();

                // 6. Check completion
                if (processedCount === 0) {
                    await this.onComplete();
                    break;
                }

                await this.sleep(this.busyIntervalMs);

            } catch (error) {
                logger.error('[BackgroundAgeRescanService] Error in loop:', error);
                await this.sleep(this.loopIntervalMs);
            }
        }

        this.isRunning = false;
        if (this.resolveStop) this.resolveStop();
        logger.info('[BackgroundAgeRescanService] Stopped.');
    }

    private async processNextBatch(): Promise<number> {
        const faces = this.getFacesNeedingAge(this.batchSize);
        if (faces.length === 0) return 0;

        logger.info(`[BackgroundAgeRescanService] Processing batch of ${faces.length} faces.`);

        let processedCount = 0;

        for (let i = 0; i < faces.length; i++) {
            const face = faces[i];

            // Yield every 5 faces
            if (i > 0 && i % 5 === 0) {
                await this.yield();
                if (this.shouldStop || this.isPaused || AppStateRepository.isScanActive()) {
                    logger.info('[BackgroundAgeRescanService] Batch interrupted.');
                    break;
                }
            }

            try {
                // Call Python to extract age from face
                const result = await this.aiProvider.extractAgeFromFace({
                    faceId: face.id,
                    photoId: face.photo_id,
                    filePath: face.file_path,
                    previewPath: face.preview_cache_path,
                    box: face.box_json
                });

                if (result) {
                    // Update face record
                    // If age is null (failed extraction), set to -1 so we don't retry locally
                    // If successful, set actual age
                    const ageToSet = (result.age !== undefined && result.age !== null) ? Math.round(result.age) : -1;
                    const failureReason = result.failureReason || null;

                    const db = getDB();
                    // Phase 2.1: Also save pose data during age backfill
                    // Phase 2.3: Also save descriptor_v2 (re-embedded from padded crop)
                    const descriptorV2Buffer = result.descriptorV2
                        ? Buffer.from(new Float32Array(result.descriptorV2).buffer)
                        : null;

                    db.prepare(`
                        UPDATE faces 
                        SET estimated_age = ?, gender = ?, age_failure_reason = ?,
                            pose_yaw = COALESCE(pose_yaw, ?),
                            pose_pitch = COALESCE(pose_pitch, ?),
                            pose_roll = COALESCE(pose_roll, ?),
                            descriptor_v2 = COALESCE(descriptor_v2, ?)
                        WHERE id = ?
                    `).run(
                        ageToSet,
                        result.gender || null,
                        failureReason,
                        result.poseYaw ?? null,
                        result.posePitch ?? null,
                        result.poseRoll ?? null,
                        descriptorV2Buffer,
                        face.id
                    );

                    if (ageToSet === -1) {
                        logger.warn(`[BackgroundAgeRescanService] Face ${face.id}: Age extraction failed (reason: ${failureReason || 'unknown'})`);
                    } else {
                        const poseInfo = result.poseYaw !== null ? `, yaw=${result.poseYaw?.toFixed(1)}°` : '';
                        const v2Info = result.descriptorV2 ? ', v2=✓' : '';
                        logger.debug(`[BackgroundAgeRescanService] Face ${face.id}: age=${result.age}, gender=${result.gender}${poseInfo}${v2Info}`);
                    }
                }
            } catch (err) {
                // Don't log error if this is a shutdown - expected behavior
                if (this.shouldStop || AppStateRepository.isShutdownRequested()) {
                    logger.info('[BackgroundAgeRescanService] Shutdown detected, stopping batch gracefully.');
                    break;
                }
                logger.error(`[BackgroundAgeRescanService] Failed to extract age for face ${face.id}:`, err);
            }

            processedCount++;
        }

        // Update checkpoint
        const db = getDB();
        const currentProcessed = parseInt(
            (db.prepare('SELECT value FROM app_state WHERE key = ?').get(BackgroundAgeRescanService.STATE_KEY_PROCESSED) as { value: string })?.value || '0'
        );
        db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(
            BackgroundAgeRescanService.STATE_KEY_PROCESSED,
            String(currentProcessed + processedCount)
        );

        return processedCount;
    }

    private async onComplete() {
        logger.info('[BackgroundAgeRescanService] Age rescan complete. Generating ERAs for named persons...');

        // Get all named persons
        const people = PersonRepository.getPeople();
        let eraCount = 0;

        for (const person of people) {
            try {
                const result = await PersonService.generateEras(person.id);
                if (result.success && (result.count ?? 0) > 0) {
                    eraCount += result.count ?? 0;
                    logger.info(`[BackgroundAgeRescanService] Generated ${result.count} ERAs for ${person.name}`);
                }
            } catch (err) {
                logger.error(`[BackgroundAgeRescanService] ERA generation failed for ${person.name}:`, err);
            }
        }

        logger.info(`[BackgroundAgeRescanService] Completed. Generated ${eraCount} total ERAs for ${people.length} people.`);

        // Clear state
        const db = getDB();
        db.prepare('DELETE FROM app_state WHERE key IN (?, ?, ?, ?)').run(
            BackgroundAgeRescanService.STATE_KEY_ACTIVE,
            BackgroundAgeRescanService.STATE_KEY_TOTAL,
            BackgroundAgeRescanService.STATE_KEY_PROCESSED,
            BackgroundAgeRescanService.STATE_KEY_OFFSET
        );

        // Emit completion to UI
        this.emitComplete(eraCount, people.length);
    }

    private emitProgress() {
        const progress = this.getProgress();
        // Emit to all renderer windows
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('age-rescan-progress', progress);
        });
    }

    private emitComplete(eraCount: number, peopleCount: number) {
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('age-rescan-complete', { eraCount, peopleCount });
        });
    }

    private getFacesNeedingAgeCount(): number {
        const db = getDB();
        const result = db.prepare(`
            SELECT COUNT(*) as count FROM faces 
            WHERE estimated_age IS NULL 
            AND descriptor IS NOT NULL
        `).get() as { count: number };
        return result?.count || 0;
    }

    private getFacesNeedingAge(limit: number): Array<{
        id: number;
        photo_id: number;
        file_path: string;
        preview_cache_path: string | null;
        box_json: string;
    }> {
        const db = getDB();
        return db.prepare(`
            SELECT f.id, f.photo_id, f.box_json, p.file_path, p.preview_cache_path
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.estimated_age IS NULL 
            AND f.descriptor IS NOT NULL
            ORDER BY f.id ASC
            LIMIT ?
        `).all(limit) as Array<{
            id: number;
            photo_id: number;
            file_path: string;
            preview_cache_path: string | null;
            box_json: string;
        }>;
    }

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
