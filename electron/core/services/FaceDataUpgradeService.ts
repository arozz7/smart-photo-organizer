import { getDB } from '../../db';
import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { PythonAIProvider } from '../../infrastructure/PythonAIProvider';
import logger from '../../logger';
import { BrowserWindow } from 'electron';
import { IService } from '../../core/interfaces/IService';

/**
 * Service managing background face data upgrade (Phase 5 Backfill + Phase 2.3 Embeddings).
 * 
 * Responsibilities:
 * 1. Iterates through faces missing pose data or descriptor_v2.
 * 2. Calls Python AI to extract data.
 * 3. Updates face records.
 * 4. Persists state across app restarts.
 */
export class FaceDataUpgradeService implements IService {
    private isRunning = false;
    private shouldStop = false;
    private isPaused = false;
    private aiProvider: PythonAIProvider;
    private batchSize = 10; // Smaller batches for more frequent yields
    private loopIntervalMs = 5000;
    private busyIntervalMs = 3000; // 3 second pause between batches

    // Checkpointing keys
    private static readonly STATE_KEY_ACTIVE = 'face_upgrade_active';
    private static readonly STATE_KEY_TOTAL = 'face_upgrade_total';
    private static readonly STATE_KEY_PROCESSED = 'face_upgrade_processed';

    private stopPromise: Promise<void> | null = null;
    private resolveStop: (() => void) | null = null;

    constructor(aiProvider: PythonAIProvider) {
        this.aiProvider = aiProvider;
    }

    /**
     * Yield to BOTH Node event loop AND Chromium message loop.
     * setImmediate only yields to libuv, but setTimeout(>0) yields to Chromium too.
     */
    private async yield(): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, 10));
    }

    isActive(): boolean {
        const db = getDB();
        const result = db.prepare('SELECT value FROM app_state WHERE key = ?').get(FaceDataUpgradeService.STATE_KEY_ACTIVE) as { value: string } | undefined;
        return result?.value === '1';
    }

    resumeIfNeeded(): boolean {
        if (this.isActive() && !this.isRunning) {
            logger.info('[FaceDataUpgradeService] Detected interrupted session, auto-resuming...');
            this.start();
            return true;
        }
        return false;
    }

    getProgress(): { processed: number; total: number; percentage: number; isRunning: boolean; isPaused: boolean } {
        const db = getDB();
        const processed = parseInt(
            (db.prepare('SELECT value FROM app_state WHERE key = ?').get(FaceDataUpgradeService.STATE_KEY_PROCESSED) as { value: string })?.value || '0'
        );
        const total = parseInt(
            (db.prepare('SELECT value FROM app_state WHERE key = ?').get(FaceDataUpgradeService.STATE_KEY_TOTAL) as { value: string })?.value || '0'
        );
        return {
            processed,
            total,
            percentage: total > 0 ? Math.round((processed / total) * 100) : 0,
            isRunning: this.isRunning,
            isPaused: this.isPaused
        };
    }

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

        // OPTIMIZATION: Create partial index to speed up finding candidates
        // This prevents O(N) table scans when skipping already processed faces.
        // We run this every start to ensure the index exists (idempotent).
        try {
            db.prepare(`
                CREATE INDEX IF NOT EXISTS idx_faces_upgrade_v2 
                ON faces(photo_id) 
                WHERE descriptor_v2 IS NULL
    `).run();
        } catch (err) {
            logger.warn('[FaceDataUpgradeService] Setup index failed (non-fatal):', err);
        }

        if (!this.isActive()) {

            // const status = FaceRepository.getFaceDataHealth();
            // We want to process faces missing pose OR descriptorV2
            // For simplicity, we'll iterate through faces needing BACKFILL
            // But we need a simpler metric for "Total" work.
            // Let's count eligible faces that have null fields.
            const totalWork = this.getFacesNeedingUpgradeCount();



            db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(FaceDataUpgradeService.STATE_KEY_ACTIVE, '1');
            db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(FaceDataUpgradeService.STATE_KEY_TOTAL, String(totalWork));
            db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(FaceDataUpgradeService.STATE_KEY_PROCESSED, '0');
            logger.info(`[FaceDataUpgradeService] Starting fresh with ~${totalWork} faces to check.`);
        } else {
            logger.info(`[FaceDataUpgradeService] Resuming...`);
        }

        this.loop();
        logger.info('[FaceDataUpgradeService] Started.');
    }

    async stop(): Promise<void> {
        if (!this.isRunning) return;
        this.shouldStop = true;
        logger.info('[FaceDataUpgradeService] Stop requested.');
        if (this.stopPromise) return this.stopPromise;
    }

    pause() {
        this.isPaused = true;
        this.emitProgress(true); // Immediate update
        logger.info('[FaceDataUpgradeService] Paused.');
    }

    resume() {
        this.isPaused = false;
        this.emitProgress(true);
        logger.info('[FaceDataUpgradeService] Resumed.');
    }

    cancel() {
        this.shouldStop = true;
        const db = getDB();
        db.prepare('DELETE FROM app_state WHERE key IN (?, ?, ?)').run(
            FaceDataUpgradeService.STATE_KEY_ACTIVE,
            FaceDataUpgradeService.STATE_KEY_TOTAL,
            FaceDataUpgradeService.STATE_KEY_PROCESSED
        );
        this.emitProgress();
        logger.info('[FaceDataUpgradeService] Cancelled and state reset.');
    }

    private async loop() {
        while (!this.shouldStop) {
            try {
                if (AppStateRepository.isShutdownRequested()) break;

                if (this.isPaused) {
                    await this.sleep(this.loopIntervalMs);
                    continue;
                }

                if (AppStateRepository.isScanActive() || AppStateRepository.isAIProcessingActive()) {
                    await this.sleep(this.loopIntervalMs);
                    continue;
                }

                const processedCount = await this.processNextBatch();

                // Update and emit progress
                this.updateProcessedCount(processedCount);
                this.emitProgress();

                if (processedCount === 0) {
                    // Double check if truly done
                    const remaining = this.getFacesNeedingUpgradeCount();
                    logger.info(`[FaceDataUpgradeService] Processed 0. Remaining work: ${remaining} `);

                    if (remaining === 0) {
                        await this.onComplete();
                        break;
                    } else {
                        // Maybe temporary no work?
                        logger.info('[FaceDataUpgradeService] Faces need upgrade but batch query returned 0. Sleeping...');
                        await this.sleep(this.loopIntervalMs);
                    }
                }

                await this.sleep(this.busyIntervalMs);

            } catch (error) {
                logger.error('[FaceDataUpgradeService] Error in loop:', error);
                await this.sleep(this.loopIntervalMs);
            }
        }

        this.isRunning = false;
        if (this.resolveStop) this.resolveStop();
        this.emitProgress(); // Final update
        logger.info('[FaceDataUpgradeService] Stopped (Loop Exit).');
    }

    private async processNextBatch(): Promise<number> {
        const faces = this.getFacesNeedingUpgrade(this.batchSize);
        if (faces.length === 0) return 0;

        let successCount = 0;
        const updates: { id: number, data: any }[] = [];

        for (let i = 0; i < faces.length; i++) {
            if (this.shouldStop || this.isPaused) break;

            // Yield EVERY face to ensure UI stays responsive
            if (i > 0) await this.yield();

            const face = faces[i];
            try {
                const box = JSON.parse(face.box_json);
                const orientation = (face as any).orientation || 1;

                const result = await this.aiProvider.sendRequest('extract_face_pose', {
                    filePath: face.file_path,
                    box,
                    orientation,
                    faceId: face.id
                });

                if (result.success) {
                    const descriptorV2Buffer = result.descriptorV2
                        ? Buffer.from(new Float32Array(result.descriptorV2).buffer)
                        : Buffer.alloc(0); // Mark as processed even if failed (empty blob)

                    updates.push({
                        id: face.id,
                        data: {
                            pose_yaw: result.poseYaw ?? 0,
                            pose_pitch: result.posePitch ?? 0,
                            pose_roll: result.poseRoll ?? 0,
                            face_quality: result.faceQuality ?? 0.5,
                            descriptor_v2: descriptorV2Buffer
                        }
                    });
                    successCount++;
                } else {
                    // Mark as processed with empty blob to avoid retrying
                    updates.push({
                        id: face.id,
                        data: {
                            pose_yaw: 0,
                            pose_pitch: 0,
                            pose_roll: 0,
                            face_quality: 0,
                            descriptor_v2: Buffer.alloc(0)
                        }
                    });
                    successCount++;
                }
            } catch (err) {
                logger.error(`[FaceDataUpgradeService] Failed face ${face.id}: `, err);
            }
        }

        // Apply all updates in a single transaction
        if (updates.length > 0) {
            this.commitBatchUpdates(updates);
        }

        return successCount;
    }

    private commitBatchUpdates(updates: { id: number, data: any }[]) {
        try {
            const db = getDB();
            const updateStmt = db.prepare(`
                UPDATE faces SET
pose_yaw = @pose_yaw,
    pose_pitch = @pose_pitch,
    pose_roll = @pose_roll,
    face_quality = @face_quality,
    descriptor_v2 = @descriptor_v2
                WHERE id = @id
    `);

            const tx = db.transaction((items: any[]) => {
                for (const item of items) {
                    updateStmt.run({ ...item.data, id: item.id });
                }
            });

            tx(updates);
        } catch (error) {
            logger.error('[FaceDataUpgradeService] Batch commit failed:', error);
        }
    }

    private updateProcessedCount(count: number) {
        if (count === 0) return;
        const db = getDB();
        const currentProcessed = parseInt(
            (db.prepare('SELECT value FROM app_state WHERE key = ?').get(FaceDataUpgradeService.STATE_KEY_PROCESSED) as { value: string })?.value || '0'
        );
        db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(
            FaceDataUpgradeService.STATE_KEY_PROCESSED,
            String(currentProcessed + count)
        );
    }

    private async onComplete() {
        logger.info('[FaceDataUpgradeService] Upgrade complete.');
        this.cancel(); // Clears state

        // Emit global complete event
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('face-upgrade-complete');
        });
    }

    private lastEmitTime = 0;

    private emitProgress(force = false) {
        const now = Date.now();
        // Throttle updates to max 1 per second unless forced
        if (!force && now - this.lastEmitTime < 1000) {
            return;
        }
        this.lastEmitTime = now;

        const progress = this.getProgress();
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('face-upgrade-progress', progress);
        });
    }

    private getFacesNeedingUpgradeCount(): number {
        const db = getDB();
        // Eligible faces that are missing pose OR descriptor_v2
        const result = db.prepare(`
            SELECT COUNT(*) as count FROM faces 
            WHERE descriptor IS NOT NULL
AND(is_ignored = 0 OR is_ignored IS NULL)
AND(blur_score IS NULL OR blur_score >= 10)
AND(pose_yaw IS NULL OR descriptor_v2 IS NULL)
    `).get() as { count: number };
        return result?.count || 0;
    }

    private getFacesNeedingUpgrade(limit: number): any[] {
        const db = getDB();
        return db.prepare(`
            SELECT f.id, f.box_json, p.file_path
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.descriptor IS NOT NULL
AND(f.is_ignored = 0 OR f.is_ignored IS NULL)
AND(f.blur_score IS NULL OR f.blur_score >= 10)
AND(f.pose_yaw IS NULL OR descriptor_v2 IS NULL)
            ORDER BY f.photo_id
LIMIT ?
    `).all(limit);
    }

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
