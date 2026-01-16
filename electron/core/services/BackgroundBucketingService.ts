import { getDB } from '../../db';
import { getAISettings } from '../../store';
import { FaceRepository } from '../../data/repositories/FaceRepository';
import { PersonRepository } from '../../data/repositories/PersonRepository';
import { AppStateRepository } from '../../data/repositories/AppStateRepository';
import { BucketRepository } from '../../data/repositories/BucketRepository';
import { FaceService } from './FaceService';
import { PythonAIProvider } from '../../infrastructure/PythonAIProvider';
import logger from '../../logger';

import { IService } from '../../core/interfaces/IService';

/**
 * Service managing background face bucketing process.
 * 
 * Responsibilities:
 * 1. Monitors `needs_bucketing` queue.
 * 2. Processes faces in batches (Pass 1: Suggestions, Pass 2: Discovery).
 * 3. Respects scanning state (pauses during active scans).
 * 4. Manages lifecycle flags and checkpoints.
 */
export class BackgroundBucketingService implements IService {
    private isRunning = false;
    private shouldStop = false;
    private aiProvider: PythonAIProvider;
    // Smaller batch size to allow more frequent yields
    private batchSize = 50;
    private loopIntervalMs = 5000;  // Check interval when idle
    private busyIntervalMs = 2000;  // Longer pause between batches to avoid blocking
    private startupDelayMs = 10000; // Wait 10 seconds after app start before processing

    /**
     * Yield to event loop to allow IPC handlers to process.
     * This prevents the background service from blocking UI operations.
     */
    private yield(): Promise<void> {
        return new Promise(resolve => setImmediate(resolve));
    }

    constructor(aiProvider: PythonAIProvider) {
        this.aiProvider = aiProvider;
    }

    /**
     * Start the service loop.
     */
    private stopPromise: Promise<void> | null = null;
    private resolveStop: (() => void) | null = null;

    /**
     * Start the service loop.
     */
    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.shouldStop = false;

        // Reset stop promise
        this.stopPromise = new Promise(resolve => {
            this.resolveStop = resolve;
        });

        // Delay startup to let UI initialize first
        logger.info(`[BackgroundBucketingService] Delaying startup by ${this.startupDelayMs}ms to let UI load...`);
        setTimeout(() => {
            if (!this.shouldStop) {
                this.loop();
            }
        }, this.startupDelayMs);
        logger.info('[BackgroundBucketingService] Started.');
    }

    /**
     * Stop the service gracefully.
     * Returns a promise that resolves when the loop actually exits.
     */
    async stop(): Promise<void> {
        if (!this.isRunning) return;

        this.shouldStop = true;
        logger.info('[BackgroundBucketingService] Stop requested.');

        if (this.stopPromise) {
            return this.stopPromise;
        }
    }

    private async loop() {
        while (!this.shouldStop) {
            try {
                // 1. Check Shutdown Request
                if (AppStateRepository.isShutdownRequested()) {
                    logger.info('[BackgroundBucketingService] Shutdown requested via AppState. Exiting loop.');
                    break;
                }

                // 2. Check Active Scan OR Active AI Queue - yield to intensive operations
                if (AppStateRepository.isScanActive() || AppStateRepository.isAIProcessingActive()) {
                    await this.sleep(this.loopIntervalMs);
                    continue;
                }

                // 3. Check if there's work to do (dirty flag or recheck mode)
                const isRecheckMode = AppStateRepository.isRecheckActive();
                let isDirty = AppStateRepository.isBucketingDirty();
                let hasPending = false;

                // If not strictly dirty, check if we actually have pending items (failsafe)
                if (!isRecheckMode && !isDirty) {
                    const pendingCount = FaceRepository.getFacesNeedingBucketingCount();
                    if (pendingCount > 0) {
                        hasPending = true;
                        // Determine if we need to set total (Self-healing for Bucketing)
                        if (AppStateRepository.getBucketingTotal() === 0) {
                            const offset = AppStateRepository.getBucketingOffset();
                            AppStateRepository.setBucketingTotal(offset + pendingCount);
                            logger.info(`[BackgroundBucketingService] Self-healed bucketing total to ${offset + pendingCount}`);
                        }
                    }
                }

                if (!isRecheckMode && !isDirty && !hasPending) {
                    // No work signaled - sleep and wait for trigger
                    await this.sleep(this.loopIntervalMs);
                    continue;
                }

                // 4. Clear dirty flag before processing (prevents redundant cycles)
                if (isDirty) {
                    AppStateRepository.clearBucketingDirty();
                }

                // 5. Process Batch
                let processedCount = 0;

                if (isRecheckMode) {
                    // Self-heal: Ensure total is set (for resuming legacy state)
                    if (AppStateRepository.getRecheckTotal() === 0) {
                        const db = getDB();
                        const res = db.prepare('SELECT COUNT(*) as c FROM faces WHERE is_ignored=1').get() as { c: number };
                        if (res && res.c > 0) {
                            AppStateRepository.setRecheckTotal(res.c);
                            logger.info(`[BackgroundBucketingService] Self-healed recheck total to ${res.c}`);
                        }
                    }
                    processedCount = await this.processRecheckBatch();
                } else {
                    processedCount = await this.processNextBatch();
                }

                // 6. Sleep strategy
                if (processedCount > 0) {
                    // More work may be available - set dirty to continue
                    AppStateRepository.markBucketingDirty();
                    await this.sleep(this.busyIntervalMs);
                } else {
                    // No more faces to process - wait for next trigger
                    await this.sleep(this.loopIntervalMs);
                }

            } catch (error) {
                logger.error('[BackgroundBucketingService] Error in loop:', error);
                await this.sleep(this.loopIntervalMs);
            }
        }
        this.isRunning = false;
        if (this.resolveStop) this.resolveStop();
        logger.info('[BackgroundBucketingService] Stopped.');
    }

    private async processRecheckBatch(): Promise<number> {
        const offset = AppStateRepository.getRecheckOffset();
        const faces = FaceRepository.getIgnoredFacesForBucketing(this.batchSize, offset);

        if (faces.length === 0) {
            logger.info('[BackgroundBucketingService] Ignored Face Re-check complete.');
            AppStateRepository.setRecheckActive(false);
            AppStateRepository.setRecheckOffset(0);
            return 0;
        }

        logger.info(`[BackgroundBucketingService] Re-checking batch of ${faces.length} ignored faces.`);

        // Pass 1: Suggestions only
        const suggestions: { faceId: number, personId: number, distance: number }[] = [];

        // Fetch candidates (could optimize to cache across loops)
        const peopleCandidates = PersonRepository.getPeopleWithDescriptors();
        const settings = getAISettings();
        const threshold = settings.faceSimilarityThreshold ?? 0.65;

        let processedCount = 0;
        for (const face of faces) {
            // Check interrupts
            if (AppStateRepository.isScanActive() || AppStateRepository.isAIProcessingActive()) {
                logger.info('[BackgroundBucketingService] Re-check batch interrupted.');
                break;
            }

            if (!face.descriptor) {
                processedCount++;
                continue;
            }

            const match = FaceService.matchAgainstCentroids(
                Array.from(face.descriptor),
                peopleCandidates,
                threshold,
                face.entity_type || 'human'
            );

            if (match) {
                suggestions.push({
                    faceId: face.id,
                    personId: match.personId,
                    distance: match.distance
                });
            }

            processedCount++;
        }

        if (suggestions.length > 0) {
            // Reuse processSuggestions (creates bucket, assigns face)
            // Existing assignToBucket sets needs_bucketing=0 (harmless) and bucket_id=X.
            // is_ignored remains 1. Safe.
            this.processSuggestions(suggestions);
        }

        // Update offset
        // Note: updateFace changes bucket_id, but NOT is_ignored.
        // So the face still matches "WHERE is_ignored = 1".
        // So simple offset increment works.
        AppStateRepository.setRecheckOffset(offset + processedCount);

        return processedCount;
    }

    private lastBatchIds: string = '';

    private async processNextBatch(): Promise<number> {
        // Fetch queue
        const faces = FaceRepository.getFacesNeedingBucketing(this.batchSize, 0);
        if (faces.length === 0) return 0;

        // Loop Detection: Check if we are processing the exact same batch as last time
        const currentIds = faces.map(f => f.id).sort().join(',');
        if (this.lastBatchIds === currentIds && faces.length > 0) {
            logger.error(`[BackgroundBucketingService] Infinite loop detected. Batch of ${faces.length} faces (IDs: ${faces[0].id}...) processed repeatedly. Aborting to prevent stats corruption.`);
            await this.sleep(this.loopIntervalMs * 2); // Wait longer before retry
            return 0;
        }
        this.lastBatchIds = currentIds;

        logger.info(`[BackgroundBucketingService] Processing batch of ${faces.length} faces.`);

        // Pass 1: Suggestion Bucketing
        // Match against existing named people (Centroids + Eras)
        const suggestions: { faceId: number, personId: number, distance: number }[] = [];
        const remainingFaces: typeof faces = [];

        // Fetch candidates once
        const peopleCandidates = PersonRepository.getPeopleWithDescriptors();
        // Per the plan's Distance Tiers:
        //   < 0.4: Auto-Assign (already done at scan time)
        //   0.4 - 0.8: Suggestion Bucket (Pass 1)
        //   > 0.8: Discovery Clustering (Pass 2)
        const suggestionThreshold = 0.8; // L2 distance - faces beyond this go to DBSCAN

        logger.info(`[BackgroundBucketingService] Pass 1: Matching ${faces.length} faces against ${peopleCandidates.length} named person centroids (threshold=${suggestionThreshold})`);
        // Faces with distance < suggestionThreshold go to Suggestion Buckets
        // Faces with distance >= suggestionThreshold go to Pass 2 (Discovery/DBSCAN)
        // Strict threshold for suggestions? Maybe loosen it for buckets?
        // Plan says: "If distance < threshold, add to Suggestion Bucket"

        let processedCount = 0;
        for (let i = 0; i < faces.length; i++) {
            const face = faces[i];

            // Yield every 10 faces to allow IPC handlers to process
            if (i > 0 && i % 10 === 0) {
                await this.yield();
                // Check interrupts during batch
                if (AppStateRepository.isScanActive() || AppStateRepository.isAIProcessingActive()) {
                    logger.info('[BackgroundBucketingService] Interrupted by active processing. Aborting batch.');
                    break;
                }
            }

            if (!face.descriptor) {
                // If no descriptor, we cannot bucket it. Mark as processed.
                FaceRepository.setNeedsBucketing([face.id], false);
                processedCount++;
                continue;
            }

            // Convert Buffer to number[] - CRITICAL: Must use Float32Array, not just Array.from
            const descriptorArr = Array.from(
                new Float32Array(face.descriptor.buffer, face.descriptor.byteOffset, face.descriptor.byteLength / 4)
            );

            // Re-use FaceService matching logic
            const match = FaceService.matchAgainstCentroids(
                descriptorArr,
                peopleCandidates,
                suggestionThreshold,
                face.entity_type || 'human'
            );

            if (match) {
                suggestions.push({
                    faceId: face.id,
                    personId: match.personId,
                    distance: match.distance
                });
            } else {
                remainingFaces.push(face);
            }

            processedCount++;
        }

        logger.info(`[BackgroundBucketingService] Pass 1 complete: ${suggestions.length} suggestions, ${remainingFaces.length} remaining for Pass 2`);

        // Commit Suggestions
        if (suggestions.length > 0) {
            this.processSuggestions(suggestions);
        }

        // Pass 2: Discovery Bucketing (DBSCAN)
        if (remainingFaces.length > 0) {
            await this.processDiscovery(remainingFaces);
        }

        // Update checkpoint stats
        const currentOffset = AppStateRepository.getBucketingOffset();
        // Only advance by what we actually touched.
        // Since we use offset 0 for fetching, this is just for UI Progress Store.
        AppStateRepository.setBucketingOffset(currentOffset + processedCount);

        return processedCount;
    }

    private processSuggestions(suggestions: { faceId: number, personId: number, distance: number }[]) {
        // Group by personId
        const byPerson = new Map<number, number[]>();
        for (const s of suggestions) {
            if (!byPerson.has(s.personId)) byPerson.set(s.personId, []);
            byPerson.get(s.personId)?.push(s.faceId);
        }

        for (const [personId, faceIds] of byPerson) {
            // Phase 40: Auto-Assign instead of creating Suggestion Buckets
            // This streamlines the workflow by skipping the "Suggestions" tab review.
            // Centroid protection (is_confirmed = 0) ensures these don't pollute the model until verified.
            FaceRepository.assignFacesToPerson(faceIds, personId, {
                assignment_source: 'auto_suggestion',
                is_confirmed: false
            });
            logger.info(`[BackgroundBucketingService] Auto-assigned ${faceIds.length} faces to Person ${personId}`);
        }
    }

    private async processDiscovery(faces: { id: number, descriptor: Buffer | null }[]) {
        // Prepare for DBSCAN - CRITICAL: Must use Float32Array, not just Array.from
        const pyFaces = faces.map(f => ({
            id: f.id,
            descriptor: Array.from(
                new Float32Array(f.descriptor!.buffer, f.descriptor!.byteOffset, f.descriptor!.byteLength / 4)
            )
        }));

        try {
            // Call Python DBSCAN
            // eps is cosine distance, converted to Euclidean in Python: L2 = sqrt(2 * cosine)
            // 0.17 cosine -> ~0.58 Euclidean - targeting just below min observed distance
            // TODO: Implement Pass 1 (Suggestions) to match against named person centroids first
            const eps = 0.17;
            const minSamples = 2; // Low to catch small groups

            const result = await this.aiProvider.clusterFaces(pyFaces, eps, minSamples);

            // Python returns { clusters: [[id1, id2], [id3, id4]], singles: [...] }
            if (!result || !result.clusters || result.clusters.length === 0) {
                logger.warn('[BackgroundBucketingService] Discovery clustering returned no clusters. Marking faces as noise to prevent loop.');
                // Fallback: Mark all as noise (processed)
                const ids = faces.map(f => f.id);
                FaceRepository.setNeedsBucketing(ids, false);
                return;
            }

            const clusterList = result.clusters as number[][];
            const singles = (result.singles || []) as number[];

            logger.info(`[BackgroundBucketingService] Cluster result: ${clusterList.length} clusters, ${singles.length} singles`);

            // Yield before bucket creation to allow IPC handlers
            await this.yield();

            // Create buckets for clusters
            for (let i = 0; i < clusterList.length; i++) {
                const faceIds = clusterList[i];

                // Yield every 10 buckets
                if (i > 0 && i % 10 === 0) {
                    await this.yield();
                }

                const bucketId = BucketRepository.createBucket({
                    bucketType: 'discovery'
                });
                FaceRepository.assignToBucket(faceIds, bucketId);
                BucketRepository.updateFaceCount(bucketId);
            }

            // Mark singles as noise (processed)
            if (singles.length > 0) {
                FaceRepository.setNeedsBucketing(singles, false);
            }

        } catch (error) {
            logger.error('[BackgroundBucketingService] Discovery clustering failed:', error);
            // If failed, we MUST mark them as processed/noise to avoid infinite loop.
            // Or ideally, we retry once? But simpler to just mark as done for now.
            try {
                const ids = faces.map(f => f.id);
                FaceRepository.setNeedsBucketing(ids, false);
            } catch (e) {
                logger.error('[BackgroundBucketingService] Failed to mark failed batch as processed:', e);
            }
        }
    }

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
