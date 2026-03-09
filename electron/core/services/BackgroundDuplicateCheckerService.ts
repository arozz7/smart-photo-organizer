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
 * Runs once per app session after a startup delay, then again whenever new
 * photos are scanned (triggered by the `duplicateCheckDirty` app-state flag).
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
        // Seed the dirty flag so the first run always executes
        AppStateRepository.markDuplicateCheckDirty();

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
                if (!AppStateRepository.isDuplicateCheckDirty()) {
                    await this.sleep(this.idleIntervalMs);
                    continue;
                }

                AppStateRepository.clearDuplicateCheckDirty();
                logger.info('[BackgroundDuplicateCheckerService] Running duplicate check...');

                await this.runExactPass();
                await this.sleep(2000);
                if (this.shouldStop) break;

                await this.runNearPass();

                logger.info('[BackgroundDuplicateCheckerService] Duplicate check complete.');
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

        for (const photo of photos) {
            if (this.shouldStop) break;
            try {
                const hash = await this.hashFile(photo.file_path);
                if (hash) PhotoRepository.updatePhotoSha256(photo.id, hash);
            } catch (e) {
                logger.warn(`[BackgroundDuplicateCheckerService] SHA-256 failed for photo ${photo.id}:`, e);
            }
        }

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
            for (const r of results) {
                PhotoRepository.updatePhotoPhash(r.id, r.phash);
            }
            logger.info(`[BackgroundDuplicateCheckerService] pHash backfill: ${results.length}/${photos.length} succeeded.`);
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
    private async runNearPass() {
        const entries = PhotoRepository.getPhotosWithPhash();
        if (entries.length < 2) return;

        logger.info(`[BackgroundDuplicateCheckerService] Near pass: clustering ${entries.length} pHashes (threshold=${this.nearDuplicateThreshold})...`);

        let result: any;
        try {
            result = await this.aiProvider.sendRequest(
                'group_near_duplicates',
                { entries, threshold: this.nearDuplicateThreshold },
                60_000
            );
        } catch (e) {
            logger.error('[BackgroundDuplicateCheckerService] Near-duplicate Python call failed:', e);
            return;
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
    }

    private sleep(ms: number) {
        return new Promise<void>(resolve => setTimeout(resolve, ms));
    }
}
