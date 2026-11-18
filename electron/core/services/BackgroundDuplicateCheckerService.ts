import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { IService } from '../interfaces/IService';
import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { PhotoRepository } from '../../data/repositories/PhotoRepository';
import { DuplicateGroupRepository } from '../../data/repositories/DuplicateGroupRepository';
import { PythonAIProvider } from '../../infrastructure/PythonAIProvider';
import logger from '../../logger';

/**
 * Idle-time background service that detects duplicate photos.
 *
 * Two passes per cycle:
 *   1. Exact pass  — groups photos with the same SHA-256 hash (SQL only).
 *   2. Near pass   — groups photos whose pHash Hamming distance ≤ threshold
 *                    (delegated to Python group_near_duplicates).
 *
 * Runs after a startup delay only if a full check has never completed on this library, and again whenever new
 * hashes were computed (new photos) or the user asks for it (the `duplicate_check_dirty` app-state flag).
 * It does not repeat at every launch: the near pass compares every pair of photos.
 */
export class BackgroundDuplicateCheckerService implements IService {
    private isRunning = false;
    private shouldStop = false;
    private stopResolve: (() => void) | null = null;
    private stopPromise: Promise<void> | null = null;

    private readonly startupDelayMs = 30_000;   // 30 s after app start
    private readonly idleIntervalMs = 60_000;   // re-check every 60 s when idle
    private readonly backfillIntervalMs = 3_000; // pause between backfill batches
    private readonly sha256BatchSize = 100;      // SHA-256 is fast — large batches OK
    private readonly phashBatchSize = 20;        // pHash calls Python — keep batches small
    private readonly nearDuplicateThreshold = 10; // Hamming distance (0–64)
    private readonly nearPassTimeoutMs = 300_000;   // Python handles one request at a time; allow for large libraries
    private readonly failedCheckRetryDelayMs = 30 * 60_000; // wait this long before retrying a failed check

    /** Do not start another duplicate check before this time (set after a failed one). */
    private retryNotBeforeMs = 0;

    constructor(private readonly aiProvider: PythonAIProvider) {}

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.shouldStop = false;
        this.stopPromise = new Promise(resolve => { this.stopResolve = resolve; });

        logger.info(`[BackgroundDuplicateCheckerService] Delaying startup by ${this.startupDelayMs}ms...`);
        setTimeout(() => {
            if (!this.shouldStop) this.loop();
        }, this.startupDelayMs);
    }

    async stop(): Promise<void> {
        if (!this.isRunning) return;
        this.shouldStop = true;
        logger.info('[BackgroundDuplicateCheckerService] Stop requested.');
        if (this.stopPromise) return this.stopPromise;
    }

    private async loop() {
        // A library that has never finished a full check gets one (this also covers libraries whose near
        // pass only ever timed out). Otherwise only new hashes or an explicit request trigger a check.
        if (!AppStateRepository.hasCompletedDuplicateCheck()) {
            AppStateRepository.markDuplicateCheckDirty();
        }

        while (!this.shouldStop) {
            try {
                if (AppStateRepository.isShutdownRequested()) break;

                // Yield to scans and AI processing
                if (AppStateRepository.isScanActive() || AppStateRepository.isAIProcessingActive()) {
                    await this.sleep(this.idleIntervalMs);
                    continue;
                }

                // --- Hash backfill pass (runs continuously until complete) ---
                const sha256Done = await this.runSha256BackfillBatch();
                if (sha256Done > 0) {
                    // More SHA-256 work remains — short pause then loop back
                    await this.sleep(this.backfillIntervalMs);
                    continue;
                }

                const phashDone = await this.runPhashBackfillBatch();
                if (phashDone > 0) {
                    // More pHash work remains — short pause then loop back
                    await this.sleep(this.backfillIntervalMs);
                    continue;
                }

                // --- Duplicate detection (only when signalled) ---
                if (!AppStateRepository.isDuplicateCheckDirty() || Date.now() < this.retryNotBeforeMs) {
                    await this.sleep(this.idleIntervalMs);
                    continue;
                }

                AppStateRepository.clearDuplicateCheckDirty();
                logger.info('[BackgroundDuplicateCheckerService] Running duplicate check...');

                await this.runExactPass();
                await this.sleep(2000);
                if (this.shouldStop) break;

                const nearPassOk = await this.runNearPass();
                if (nearPassOk) {
                    AppStateRepository.markDuplicateCheckCompleted();
                    logger.info('[BackgroundDuplicateCheckerService] Duplicate check complete.');
                } else {
                    // Keep it pending, but not before a long pause: a failing check must not block the AI
                    // backend again every minute.
                    AppStateRepository.markDuplicateCheckDirty();
                    this.retryNotBeforeMs = Date.now() + this.failedCheckRetryDelayMs;
                    logger.warn('[BackgroundDuplicateCheckerService] Duplicate check did not finish; will retry later.');
                }
                await this.sleep(this.idleIntervalMs);

            } catch (error) {
                logger.error('[BackgroundDuplicateCheckerService] Error in loop:', error);
                await this.sleep(this.idleIntervalMs);
            }
        }

        this.isRunning = false;
        if (this.stopResolve) this.stopResolve();
        logger.info('[BackgroundDuplicateCheckerService] Stopped.');
    }

    /**
     * SHA-256 backfill: process one batch of photos missing a hash.
     * Returns the number of photos processed (0 = backfill complete).
     */
    private async runSha256BackfillBatch(): Promise<number> {
        const photos = PhotoRepository.getPhotosNeedingSha256(this.sha256BatchSize);
        if (photos.length === 0) return 0;

        logger.info(`[BackgroundDuplicateCheckerService] SHA-256 backfill: processing ${photos.length} photos…`);

        let anyHashed = false;
        for (const photo of photos) {
            if (this.shouldStop) break;
            try {
                const hash = await this.hashFile(photo.file_path);
                if (hash) {
                    PhotoRepository.updatePhotoSha256(photo.id, hash);
                    anyHashed = true;
                } else {
                    // Unreadable/corrupt file — record once so it stops being
                    // retried on every backfill cycle (see getPhotosNeedingSha256).
                    logger.warn(`[BackgroundDuplicateCheckerService] SHA-256 failed for photo ${photo.id}: file unreadable`);
                    PhotoRepository.recordScanError(photo.id, photo.file_path, 'File unreadable for SHA-256 hashing', 'SHA256 Hash');
                }
            } catch (e) {
                logger.warn(`[BackgroundDuplicateCheckerService] SHA-256 failed for photo ${photo.id}:`, e);
                PhotoRepository.recordScanError(photo.id, photo.file_path, String(e), 'SHA256 Hash');
            }
        }
        if (anyHashed) AppStateRepository.markDuplicateCheckDirty(); // new hashes: duplicates may have appeared

        return photos.length;
    }

    /**
     * pHash backfill: process one batch of photos missing a pHash via Python.
     * Returns the number of photos processed (0 = backfill complete).
     */
    private async runPhashBackfillBatch(): Promise<number> {
        const photos = PhotoRepository.getPhotosNeedingPhash(this.phashBatchSize);
        if (photos.length === 0) return 0;

        logger.info(`[BackgroundDuplicateCheckerService] pHash backfill: processing ${photos.length} photos…`);

        try {
            const result = await this.aiProvider.sendRequest(
                'compute_phash_batch',
                { entries: photos },
                120_000
            );
            const results: { id: number; phash: string }[] = result?.results ?? [];
            const succeededIds = new Set(results.map(r => r.id));
            for (const r of results) {
                PhotoRepository.updatePhotoPhash(r.id, r.phash);
            }
            if (results.length > 0) AppStateRepository.markDuplicateCheckDirty(); // new hashes: duplicates may have appeared
            logger.info(`[BackgroundDuplicateCheckerService] pHash backfill: ${results.length}/${photos.length} succeeded.`);

            // Anything requested but not returned failed (usually an unreadable/
            // corrupt file) — record once so it stops being retried every cycle.
            for (const photo of photos) {
                if (!succeededIds.has(photo.id)) {
                    PhotoRepository.recordScanError(photo.id, photo.file_path, 'File unreadable for pHash computation', 'pHash');
                }
            }
        } catch (e) {
            logger.error('[BackgroundDuplicateCheckerService] pHash backfill Python call failed:', e);
        }

        return photos.length;
    }

    /** Compute SHA-256 of a file via streaming read. */
    private hashFile(filePath: string): Promise<string | null> {
        return new Promise(resolve => {
            try {
                const hash = createHash('sha256');
                const stream = createReadStream(filePath);
                stream.on('data', chunk => hash.update(chunk));
                stream.on('end', () => resolve(hash.digest('hex')));
                stream.on('error', () => resolve(null));
            } catch {
                resolve(null);
            }
        });
    }

    /**
     * Exact pass: find photos sharing the same SHA-256 hash and group them.
     */
    private async runExactPass() {
        const groups = PhotoRepository.findExactDuplicateGroups();
        logger.info(`[BackgroundDuplicateCheckerService] Exact pass: found ${groups.length} hash groups.`);

        for (const g of groups) {
            if (this.shouldStop) break;

            const photoIds = g.photo_ids.split(',').map(Number);

            // Skip if these photos are already in the same group
            const existingGroupId = DuplicateGroupRepository.findExistingGroup(photoIds);
            if (existingGroupId !== null) continue;

            // Create a new group and link all photos
            const groupId = DuplicateGroupRepository.createGroup('exact');
            PhotoRepository.setDuplicateGroup(photoIds, groupId);
            logger.info(`[BackgroundDuplicateCheckerService] Created exact group ${groupId} with ${photoIds.length} photos.`);
        }
    }

    /**
     * Near pass: fetch all pHashes, delegate Hamming clustering to Python,
     * then create groups for clusters of ≥ 2 un-grouped photos.
     */
    private async runNearPass(): Promise<boolean> {
        const entries = PhotoRepository.getPhotosWithPhash();
        if (entries.length < 2) return true;

        logger.info(`[BackgroundDuplicateCheckerService] Near pass: clustering ${entries.length} pHashes (threshold=${this.nearDuplicateThreshold})...`);

        let result: any;
        try {
            result = await this.aiProvider.sendRequest(
                'group_near_duplicates',
                { entries, threshold: this.nearDuplicateThreshold },
                this.nearPassTimeoutMs
            );
        } catch (e) {
            logger.error('[BackgroundDuplicateCheckerService] Near-duplicate Python call failed:', e);
            return false;
        }

        const clusters: number[][] = result?.groups ?? [];
        logger.info(`[BackgroundDuplicateCheckerService] Near pass: ${clusters.length} clusters returned.`);

        for (const cluster of clusters) {
            if (this.shouldStop) break;
            if (cluster.length < 2) continue;

            // Only consider photos that are not already in an exact-duplicate group
            const ungrouped = cluster.filter(id => {
                const photo = PhotoRepository.getPhotoById(id) as any;
                return photo && photo.duplicate_group_id === null;
            });

            if (ungrouped.length < 2) continue;

            const existingGroupId = DuplicateGroupRepository.findExistingGroup(ungrouped);
            if (existingGroupId !== null) continue;

            const groupId = DuplicateGroupRepository.createGroup('near');
            PhotoRepository.setDuplicateGroup(ungrouped, groupId);
            logger.info(`[BackgroundDuplicateCheckerService] Created near group ${groupId} with ${ungrouped.length} photos.`);
        }
        return !this.shouldStop; // stopped part-way: not complete, so it runs again next time
    }

    private sleep(ms: number) {
        return new Promise<void>(resolve => setTimeout(resolve, ms));
    }
}
