import { ipcMain, shell } from 'electron';
import { PhotoRepository } from '../data/repositories/PhotoRepository';
import { DuplicateGroupRepository } from '../data/repositories/DuplicateGroupRepository';
import { FaceRepository } from '../data/repositories/FaceRepository';
import { PersonRepository } from '../data/repositories/PersonRepository';
import { BucketRepository } from '../data/repositories/BucketRepository';
import { AppStateRepository } from '../data/repositories/AppStateRepository';
import { SmartAlbumRepository } from '../data/repositories/SmartAlbumRepository';
import { PersonService } from '../core/services/PersonService';
import { FaceService } from '../core/services/FaceService';
import { FaceAnalysisService } from '../core/services/FaceAnalysisService';
import { pythonProvider } from '../infrastructure/PythonAIProvider';
import { getDB } from '../db';
import { ConfigService } from '../core/services/ConfigService';
import { ContextualMatchingService } from '../core/services/ContextualMatchingService';

export function registerDBHandlers() {
    // --- METRICS & STATS ---

    ipcMain.handle('db:getLibraryStats', async () => {
        try {
            return { success: true, stats: PhotoRepository.getLibraryStats() };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    // Generic SQL query handler (use sparingly, prefer specific handlers)
    ipcMain.handle('db:query', async (_, { sql, params = [] }) => {
        try {
            const db = getDB();
            const result = db.prepare(sql).all(...params);
            return result;
        } catch (e) {
            console.error('[Main] db:query failed:', e);
            return [];
        }
    });


    // --- SCAN ERRORS ---
    ipcMain.handle('db:getScanErrors', async () => {
        try {
            return await PhotoRepository.getScanErrors();
        } catch (e) { return []; }
    });

    ipcMain.handle('db:deleteScanError', async (_, { id, deleteFile }) => PhotoRepository.deleteScanErrorAndFile(id, deleteFile));

    ipcMain.handle('db:clearScanErrors', async () => {
        try {
            PhotoRepository.clearScanErrors();
            return { success: true };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    // --- TAGS ---
    ipcMain.handle('db:cleanupTags', async () => {
        console.log('[Main] db:cleanupTags called');
        const res = PhotoRepository.cleanupTags();
        console.log('[Main] db:cleanupTags result:', res);
        return res;
    });

    ipcMain.handle('db:clearAITags', async () => {
        console.log('[Main] db:clearAITags called');
        return PhotoRepository.clearAITags();
    });

    ipcMain.handle('db:factoryReset', async () => {
        console.log('[Main] db:factoryReset called');
        const res = PhotoRepository.factoryReset();

        // Also reset FAISS Index
        try {
            await pythonProvider.sendRequest('rebuild_index', { descriptors: [], ids: [] });
            console.log('[Main] FAISS Index cleared.');
        } catch (err) {
            console.error('[Main] Failed to clear FAISS index:', err);
        }

        // Clear AI Queue from Persistent Store
        try {
            ConfigService.updateSettings({ ai_queue: [] });
            console.log('[Main] AI Processing Queue cleared.');
        } catch (err) {
            console.error('[Main] Failed to clear AI Queue:', err);
        }

        // Trigger a reload or cleanup of other services if needed
        return res;
    });

    ipcMain.handle('db:getAllTags', async () => PhotoRepository.getAllTags());
    ipcMain.handle('db:getTags', async (_, photoId) => PhotoRepository.getTagsForPhoto(photoId));
    ipcMain.handle('db:removeTag', async (_, { photoId, tag }) => {
        PhotoRepository.removeTag(photoId, tag);
        return { success: true };
    });
    ipcMain.handle('db:addTags', async (_, { photoId, tags }) => {
        PhotoRepository.addTags(photoId, tags);
        return { success: true };
    });

    // --- PHOTOS ---
    ipcMain.handle('db:getPhotos', async (_, args) => {
        try {
            return PhotoRepository.getPhotos(args.page, args.limit, args.sort, args.filter, args.offset);
        } catch (e) { return { photos: [], total: 0, error: String(e) }; }
    });

    ipcMain.handle('db:getPhoto', async (_, id) => {
        try {
            return PhotoRepository.getPhotoById(id);
        } catch (e) { return null }
    });

    ipcMain.handle('db:getFolders', async () => {
        try {
            return PhotoRepository.getFolders();
        } catch (e) { return []; }
    });

    ipcMain.handle('db:getUnprocessedItems', async () => {
        try {
            return PhotoRepository.getUnprocessedPhotos();
        } catch (e) { return []; }
    });

    ipcMain.handle('db:getPhotosMissingBlurScores', async () => {
        try {
            const db = getDB();
            // Only select photos that have been scanned at least once (present in scan_history OR has faces)
            // This prevents picking up purely "new" photos that are waiting in the queue.
            const query = `
                SELECT id FROM photos
                WHERE blur_score IS NULL
                AND (
                    id IN (SELECT photo_id FROM scan_history)
                    OR
                    id IN (SELECT photo_id FROM faces)
                )
            `;
            const rows = db.prepare(query).all() as { id: number }[];
            return { success: true, photoIds: rows.map(r => r.id) };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    // --- FACES ---
    ipcMain.handle('db:getFaces', async (_, photoId) => FaceRepository.getFacesByPhoto(photoId));

    ipcMain.handle('db:getFacesByIds', async (_, ids) => FaceRepository.getFacesByIds(ids));

    ipcMain.handle('db:getAllFaces', async (_, args) => {
        return FaceRepository.getAllFaces(args.limit, args.offset, args.filter, args.includeDescriptors);
    });

    // Updated to track FAISS staleness when ignoring named faces
    ipcMain.handle('db:ignoreFace', async (_, faceId) => {
        const db = getDB();
        // Check if face was assigned to a person (FAISS index impact)
        // We select person_id before it gets nulled by FaceRepository.ignoreFace
        const face = db.prepare('SELECT person_id FROM faces WHERE id = ?').get(faceId) as { person_id: number | null };
        const wasNamed = face && face.person_id !== null;

        await FaceRepository.ignoreFaces([faceId]);

        if (wasNamed) {
            const { incrementFaissStaleCount } = await import('../store');
            incrementFaissStaleCount(1);
        }

        return { success: true };
    });

    ipcMain.handle('db:ignoreFaces', async (_, faceIds) => {
        if (!faceIds || faceIds.length === 0) return { success: true };

        const db = getDB();
        const placeholders = faceIds.map(() => '?').join(',');

        // Count how many are assigned to a person
        const result = db.prepare(`SELECT COUNT(*) as count FROM faces WHERE id IN (${placeholders}) AND person_id IS NOT NULL`).get(...faceIds) as { count: number };
        const staleCount = result.count || 0;

        await FaceRepository.ignoreFaces(faceIds);

        if (staleCount > 0) {
            const { incrementFaissStaleCount } = await import('../store');
            incrementFaissStaleCount(staleCount);
        }

        return { success: true };
    });

    ipcMain.handle('db:getIgnoredFaces', async (_, args) => {
        return FaceRepository.getIgnoredFaces(args?.page || 1, args?.limit || 50, args?.order || 'asc');
    });

    ipcMain.handle('db:restoreFaces', async (_, { faceIds, personId }) => {
        FaceRepository.restoreFaces(faceIds, personId);
        if (personId) {
            await PersonService.recalculatePersonMean(personId);
        }
        return { success: true };
    });

    ipcMain.handle('db:restoreFace', async (_, id) => {
        FaceRepository.restoreFaces([id]);
        return { success: true };
    });

    ipcMain.handle('db:removeDuplicateFaces', async () => {
        // return FaceService.removeDuplicateFaces(); // Need to implement
        return { success: false, error: 'Not implemented' };
    });

    ipcMain.handle('db:autoAssignFaces', async (_, args) => {
        const searchFn = async (descriptors: number[][], k?: number, th?: number) => {
            return pythonProvider.searchFaces(descriptors, k, th);
        };
        // Read from aiSettings (where SettingsModal saves the values)
        // @ts-ignore
        const aiSettings = ConfigService.getAISettings();
        const threshold = aiSettings.autoAssignThreshold || 0.7; // Default 0.7 if not set
        // @ts-ignore
        return FaceService.autoAssignFaces(args.faceIds, threshold, searchFn);
    });

    ipcMain.handle('db:updateFaces', async (_, _args) => {
        // return FaceService.updateFaces(args); // Need to implement
        return { success: false, error: 'Not implemented' };
    });

    ipcMain.handle('db:deleteFaces', async (_, faceIds) => {
        // Check how many faces have person_id (are in FAISS index)
        const db = getDB();
        const placeholders = faceIds.map(() => '?').join(',');
        const namedFaces = db.prepare(`SELECT COUNT(*) as count FROM faces WHERE id IN (${placeholders}) AND person_id IS NOT NULL`).get(...faceIds) as { count: number };

        FaceRepository.deleteFaces(faceIds);

        // Increment FAISS stale count for faces that were in the index
        if (namedFaces.count > 0) {
            const { incrementFaissStaleCount } = await import('../store');
            incrementFaissStaleCount(namedFaces.count);
        }

        return { success: true };
    });

    ipcMain.handle('db:recalculatePersonModel', async (_, personId) => {
        return await PersonService.recalculatePersonMean(personId);
    });

    ipcMain.handle('db:unassignFaces', async (_, faceIds) => {
        // Check how many faces have person_id (are in FAISS index)
        const db = getDB();
        const placeholders = faceIds.map(() => '?').join(',');
        const namedFaces = db.prepare(`SELECT COUNT(*) as count FROM faces WHERE id IN (${placeholders}) AND person_id IS NOT NULL`).get(...faceIds) as { count: number };

        await PersonService.unassignFaces(faceIds);

        // Increment FAISS stale count for faces that were in the index
        if (namedFaces.count > 0) {
            const { incrementFaissStaleCount } = await import('../store');
            incrementFaissStaleCount(namedFaces.count);
        }

        return { success: true };
    });

    ipcMain.handle('db:generateEras', async (_, args) => {
        try {
            const { personId, config } = args;
            return await PersonService.generateEras(personId, config);
        } catch (e) {
            console.error('[Main] db:generateEras failed:', e);
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:getEras', async (_, personId) => {
        return PersonRepository.getEras(personId);
    });

    ipcMain.handle('db:deleteEra', async (_, eraId) => {
        PersonRepository.deleteEra(eraId);
        return { success: true };
    });

    ipcMain.handle('db:renameEra', async (_, { eraId, newName }) => {
        PersonRepository.renameEra(eraId, newName);
        return { success: true };
    });

    ipcMain.handle('db:getPeople', async () => {
        console.log('[IPC] db:getPeople START');
        const start = Date.now();
        const result = PersonRepository.getPeople();
        console.log(`[IPC] db:getPeople END - took ${Date.now() - start}ms`);
        return result;
    });

    ipcMain.handle('db:setPersonCover', async (_, { personId, faceId }) => {
        PersonRepository.setPersonCover(personId, faceId);
        return { success: true };
    });

    ipcMain.handle('db:getPerson', async (_, id) => PersonRepository.getPersonById(id));

    ipcMain.handle('db:assignPerson', async (_, { faceId, personName }) => {
        return await PersonService.assignPerson(faceId, personName);
    });

    ipcMain.handle('db:renamePerson', async (_, { personId, newName }) => {
        return await PersonService.renamePerson(personId, newName);
    });

    ipcMain.handle('db:getPersonMeanDescriptor', async (_, personId) => {
        const person = PersonRepository.getPersonById(personId) as any;
        if (person && person.descriptor_mean_json) {
            try {
                return JSON.parse(person.descriptor_mean_json);
            } catch (e) {
                return null;
            }
        }
        return null;
    });

    ipcMain.handle('db:getPeopleWithDescriptors', async () => {
        let people = PersonRepository.getPeopleWithDescriptors();
        const db = getDB();

        if (people.length === 0) {
            // Check if we have people at all
            const allPeople = PersonRepository.getPeople();
            if (allPeople.length > 0) {
                // Check if we have descriptors at all
                const faceCount = db.prepare('SELECT COUNT(*) as c FROM faces').get() as any;
                const descCount = db.prepare('SELECT COUNT(*) as c FROM faces WHERE descriptor IS NOT NULL').get() as any;

                console.log(`[Main] db:getPeopleWithDescriptors: Found ${allPeople.length} people, 0 with means.`);
                console.log(`[Main] DB Stats: ${faceCount.c} faces, ${descCount.c} have descriptors.`);

                if (descCount.c > 0) {
                    console.log('[Main] Descriptors exist. Triggering auto-recalc of person means...');
                    await PersonService.recalculateAllMeans();
                    people = PersonRepository.getPeopleWithDescriptors();
                    console.log(`[Main] Recalc done. New People with Means: ${people.length}`);
                } else {
                    console.warn('[Main] NO DESCRIPTORS in DB. Quick Scan will fail. Deep Scan required.');
                }
            }
        }
        return people;
    });

    ipcMain.handle('db:getPhotosForTargetedScan', async (_, options) => PhotoRepository.getPhotosForTargetedScan(options));

    ipcMain.handle('db:getPhotosForRescan', async (_, options) => PhotoRepository.getPhotosForRescan(options));

    ipcMain.handle('db:retryScanErrors', async () => {
        return PhotoRepository.retryScanErrors();
    });

    ipcMain.handle('db:getFilePaths', async (_, ids) => PhotoRepository.getFilePaths(ids));

    ipcMain.handle('db:getMetricsHistory', async (_, limit) => PhotoRepository.getMetricsHistory(limit));

    // db:reassignFaces (Bulk Assign)
    // db:reassignFaces (Bulk Assign via ID lookup internally?) 
    // Kept for backward compat if needed, but db:moveFacesToPerson is better
    ipcMain.handle('db:reassignFaces', async (_, { faceIds, personName, confirm }) => {
        const normalizedName = personName.trim();
        let person = PersonRepository.getPersonByName(normalizedName);
        if (!person) person = PersonRepository.createPerson(normalizedName);

        // Pass confirm flag to set is_confirmed when accepting suggestions
        FaceRepository.updateFacePerson(faceIds, person.id, confirm ?? null);
        await PersonService.recalculatePersonMean(person.id);
        return { success: true, person };
    });

    // New more robust handler that recalculates source means too


    ipcMain.handle('db:moveFacesToPerson', async (_event, faceIds: number[], targetName: string) => {
        return PersonService.moveFacesToPerson(faceIds, targetName);
    });

    // --- DEBUG ---
    ipcMain.handle('debug:getBlurStats', async () => {
        try {
            const db = getDB();
            const total = db.prepare('SELECT COUNT(*) as count FROM faces').get() as any;
            const scored = db.prepare('SELECT COUNT(*) as count FROM faces WHERE blur_score IS NOT NULL').get() as any;

            return {
                success: true,
                stats: {
                    total: total.count,
                    scored_count: scored.count,
                    null_count: total.count - scored.count
                }
            };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });
    ipcMain.handle('db:getFaceMetadata', async (_event, ids: number[]) => {
        if (!ids || ids.length === 0) return [];
        const db = getDB();
        const placeholders = ids.map(() => '?').join(',');
        // We need: id, person_id, file_path (from photos)
        return db.prepare(`
            SELECT f.id, f.person_id, f.photo_id, p.file_path, p.preview_cache_path
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.id IN (${placeholders})
        `).all(...ids);
    });

    ipcMain.handle('db:associateMatchedFaces', async (_, { personId, faceIds }) => {
        // Simple case: All faceIds -> personId
        FaceRepository.updateFacePerson(faceIds, personId);
        await PersonService.recalculatePersonMean(personId);
        return { success: true };
    });

    ipcMain.handle('db:associateBulkMatchedFaces', async (_, associations: { personId: number, faceId: number }[]) => {
        // Complex case: List of {personId, faceId} pairs
        // Optimisation: Group by personId
        const groups = new Map<number, number[]>();
        for (const { personId, faceId } of associations) {
            if (!groups.has(personId)) groups.set(personId, []);
            groups.get(personId)!.push(faceId);
        }

        for (const [personId, faceIds] of groups.entries()) {
            FaceRepository.updateFacePerson(faceIds, personId);
            await PersonService.recalculatePersonMean(personId);
        }
        return { success: true };
    });

    // --- MISASSIGNED FACE DETECTION (Phase 1) ---
    ipcMain.handle('person:findOutliers', async (_, { personId, threshold, checkConfirmed }) => {
        try {
            const result = FaceAnalysisService.findOutliersForPerson(
                personId,
                threshold ?? 0.6,
                checkConfirmed ?? false
            );
            return { success: true, ...result };
        } catch (error) {
            console.error('[Main] person:findOutliers failed:', error);
            return { success: false, error: String(error) };
        }
    });

    // --- BACKGROUND FACE FILTER (Phase 1) ---
    ipcMain.handle('db:detectBackgroundFaces', async (_, options) => {
        try {
            const settings = ConfigService.getSmartIgnoreSettings();
            const merged = {
                minPhotoAppearances: options?.minPhotoAppearances ?? settings.minPhotoAppearances,
                maxClusterSize: options?.maxClusterSize ?? settings.maxClusterSize,
                centroidDistanceThreshold: options?.centroidDistanceThreshold ?? settings.centroidDistanceThreshold
            };

            // Wrap provider with 5-minute timeout for heavy DBSCAN processing
            const timeoutProvider = {
                sendRequest: (cmd: string, payload: any) => pythonProvider.sendRequest(cmd, payload, 300000) // 5 min
            };

            const result = await FaceAnalysisService.detectBackgroundFaces(merged, timeoutProvider);
            return { success: true, ...result };
        } catch (error) {
            console.error('[Main] db:detectBackgroundFaces failed:', error);
            return { success: false, error: String(error) };
        }
    });

    // --- FACE CONFIRMATION (Centroid Stability Feature) ---
    ipcMain.handle('db:confirmFaces', async (_, faceIds: number[]) => {
        try {
            FaceRepository.setConfirmed(faceIds, true);
            return { success: true, confirmed: faceIds.length };
        } catch (error) {
            console.error('[Main] db:confirmFaces failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('db:unconfirmFaces', async (_, faceIds: number[]) => {
        try {
            FaceRepository.setConfirmed(faceIds, false);
            return { success: true, unconfirmed: faceIds.length };
        } catch (error) {
            console.error('[Main] db:unconfirmFaces failed:', error);
            return { success: false, error: String(error) };
        }
    });

    // --- FACE DATA HEALTH (Unified Status) ---
    ipcMain.handle('db:getFaceDataHealth', async () => {
        try {
            const health = FaceRepository.getFaceDataHealth();
            return {
                success: true,
                ...health,
                // Calculate percentages for UI
                agePercent: health.eligibleTotal > 0 ? Math.round((health.withAge / health.eligibleTotal) * 100) : 100,
                genderPercent: health.eligibleTotal > 0 ? Math.round((health.withGender / health.eligibleTotal) * 100) : 100,
                posePercent: health.eligibleTotal > 0 ? Math.round((health.withPose / health.eligibleTotal) * 100) : 100,
                descriptorV2Percent: health.eligibleTotal > 0 ? Math.round((health.withDescriptorV2 / health.eligibleTotal) * 100) : 100
            };
        } catch (error) {
            console.error('[Main] db:getFaceDataHealth failed:', error);
            return { success: false, error: String(error) };
        }
    });

    // --- POSE DATA BACKFILL (Phase 5) ---
    ipcMain.handle('db:getPoseBackfillStatus', async () => {
        try {
            const status = FaceRepository.getPoseBackfillCount();
            return {
                success: true,
                needsBackfill: status.needsBackfill,
                total: status.total,
                completed: status.total - status.needsBackfill,
                percent: status.total > 0 ? Math.round(((status.total - status.needsBackfill) / status.total) * 100) : 100
            };
        } catch (error) {
            console.error('[Main] db:getPoseBackfillStatus failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('db:processPoseBackfillBatch', async (_, { batchSize = 10 }) => {
        try {
            const faces = FaceRepository.getFacesNeedingPoseBackfill(batchSize);

            if (faces.length === 0) {
                return { success: true, processed: 0, message: 'No faces need backfill' };
            }

            let processed = 0;
            let failed = 0;

            for (const face of faces) {
                try {
                    const box = JSON.parse(face.box_json);
                    const filePath = face.file_path;
                    const orientation = (face as any).orientation || 1;

                    // Call Python to extract pose
                    const result = await pythonProvider.sendRequest('extract_face_pose', {
                        filePath,
                        box,
                        orientation,
                        faceId: face.id
                    });

                    if (result.success) {
                        // Update database with pose data
                        // Update database with pose data - default to 0 if null to mark as processed
                        // Convert descriptor_v2 array to Buffer if present
                        const descriptorV2Buffer = result.descriptorV2
                            ? Buffer.from(new Float32Array(result.descriptorV2).buffer)
                            : null;

                        FaceRepository.updateFacePoseData(face.id, {
                            pose_yaw: result.poseYaw ?? 0,
                            pose_pitch: result.posePitch ?? 0,
                            pose_roll: result.poseRoll ?? 0,
                            face_quality: result.faceQuality ?? 0.5,
                            descriptor_v2: descriptorV2Buffer
                        });
                        processed++;
                    } else {
                        // Mark as processed with null values to avoid retrying failed faces
                        FaceRepository.updateFacePoseData(face.id, {
                            pose_yaw: 0, // Sentinel value indicating "processed but no pose"
                            pose_pitch: null,
                            pose_roll: null,
                            face_quality: null
                        });
                        failed++;
                    }
                } catch (e) {
                    console.error(`[Main] Failed to backfill pose for face ${face.id}:`, e);
                    failed++;
                }
            }

            const status = FaceRepository.getPoseBackfillCount();
            return {
                success: true,
                processed,
                failed,
                remaining: status.needsBackfill,
                percent: status.total > 0 ? Math.round(((status.total - status.needsBackfill) / status.total) * 100) : 100
            };
        } catch (error) {
            console.error('[Main] db:processPoseBackfillBatch failed:', error);
            return { success: false, error: String(error) };
        }
    });

    // --- POSE STATISTICS (Phase 105) ---
    ipcMain.handle('db:getPoseStatistics', async () => {
        try {
            const stats = FaceRepository.getPoseStatistics();
            return { success: true, ...stats };
        } catch (error) {
            console.error('[Main] db:getPoseStatistics failed:', error);
            return { success: false, error: String(error) };
        }
    });

    // --- CONTEXTUAL MATCHING (Phase 105-4) ---
    ipcMain.handle('db:propagateLabelsInSession', async (_event, photoId: number) => {
        try {
            if (typeof photoId !== 'number') throw new Error('photoId must be a number');
            const r1 = ContextualMatchingService.propagateTemporalLabels(photoId);
            const r2 = ContextualMatchingService.propagateSpatialLabels(photoId);
            return {
                success: true,
                propagated: r1.propagated + r2.propagated,
                skipped: r1.skipped + r2.skipped
            };
        } catch (error) {
            console.error('[Main] db:propagateLabelsInSession failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('db:batchPropagateLabels', async () => {
        try {
            const result = ContextualMatchingService.batchPropagateForLibrary();
            return result;
        } catch (error) {
            console.error('[Main] db:batchPropagateLabels failed:', error);
            return { success: false, error: String(error) };
        }
    });

    // --- FACE DATA UPGRADE SERVICE (Phase 5 + Embeddings) ---
    let faceUpgradeService: any = null;

    ipcMain.handle('service:face-upgrade:start', async () => {
        try {
            const { FaceDataUpgradeService } = await import('../core/services/FaceDataUpgradeService');
            if (!faceUpgradeService) {
                faceUpgradeService = new FaceDataUpgradeService(pythonProvider);
            }
            faceUpgradeService.start();
            return { success: true };
        } catch (error) {
            console.error('[Main] service:face-upgrade:start failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('service:face-upgrade:stop', async () => {
        if (faceUpgradeService) {
            await faceUpgradeService.stop();
        }
        return { success: true };
    });

    ipcMain.handle('service:face-upgrade:pause', async () => {
        if (faceUpgradeService) {
            faceUpgradeService.pause();
        }
        return { success: true };
    });

    ipcMain.handle('service:face-upgrade:resume', async () => {
        if (faceUpgradeService) {
            faceUpgradeService.resume();
        }
        return { success: true };
    });

    ipcMain.handle('service:face-upgrade:status', async () => {
        try {
            const { FaceDataUpgradeService } = await import('../core/services/FaceDataUpgradeService');
            if (!faceUpgradeService) {
                faceUpgradeService = new FaceDataUpgradeService(pythonProvider);
            }
            return {
                success: true,
                status: faceUpgradeService.getProgress()
            };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    // --- AGE DATA BACKFILL (Phase 42) ---
    let ageRescanService: any = null;

    ipcMain.handle('db:getAgeBackfillStatus', async () => {
        try {
            const db = getDB();
            // Check if active
            const activeRes = db.prepare('SELECT value FROM app_state WHERE key = ?').get('age_rescan_active') as { value: string } | undefined;
            const isActive = activeRes?.value === '1';

            // Get progress
            const processed = parseInt(
                (db.prepare('SELECT value FROM app_state WHERE key = ?').get('age_rescan_processed') as { value: string })?.value || '0'
            );
            const total = parseInt(
                (db.prepare('SELECT value FROM app_state WHERE key = ?').get('age_rescan_total') as { value: string })?.value || '0'
            );

            // Count faces needing age data (for fresh start scenario)
            const needsAge = db.prepare(`
                SELECT COUNT(*) as count FROM faces 
                WHERE estimated_age IS NULL 
                AND descriptor IS NOT NULL
            `).get() as { count: number };

            return {
                success: true,
                active: isActive,
                processed,
                total: isActive ? total : needsAge.count,
                remaining: isActive ? (total - processed) : needsAge.count,
                percentage: total > 0 ? Math.round((processed / total) * 100) : 0
            };
        } catch (error) {
            console.error('[Main] db:getAgeBackfillStatus failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('db:startAgeBackfill', async () => {
        try {
            // Lazy import to avoid circular dependency
            const { BackgroundAgeRescanService } = await import('../core/services/BackgroundAgeRescanService');

            if (!ageRescanService) {
                ageRescanService = new BackgroundAgeRescanService(pythonProvider);
            }

            if (!ageRescanService.canStart() && !ageRescanService.isActive()) {
                return { success: false, error: 'No faces need age backfill' };
            }

            ageRescanService.start();
            return { success: true, message: 'Age backfill started' };
        } catch (error) {
            console.error('[Main] db:startAgeBackfill failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('db:cancelAgeBackfill', async () => {
        try {
            console.log('[Main] db:cancelAgeBackfill called');

            // Always clear DB state (even if service instance doesn't exist after restart)
            const db = getDB();
            db.prepare('DELETE FROM app_state WHERE key IN (?, ?, ?, ?)').run(
                'age_rescan_active',
                'age_rescan_total',
                'age_rescan_processed',
                'age_rescan_offset'
            );
            console.log('[Main] Age backfill state cleared from DB');

            if (ageRescanService) {
                ageRescanService.cancel();
                ageRescanService = null; // Reset so a fresh start works
                console.log('[Main] Age backfill service cancelled and reset');
            }

            return { success: true, message: 'Age backfill cancelled' };
        } catch (error) {
            console.error('[Main] db:cancelAgeBackfill failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('db:pauseAgeBackfill', async () => {
        try {
            if (ageRescanService) {
                ageRescanService.pause();
            }
            return { success: true, message: 'Age backfill paused' };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('db:resumeAgeBackfill', async () => {
        try {
            if (ageRescanService) {
                ageRescanService.resume();
            }
            return { success: true, message: 'Age backfill resumed' };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    // --- PERSON ALERTS (Drift Detection) ---

    ipcMain.handle('person:getAlerts', async (_, personId: number) => {
        return PersonRepository.getActiveAlerts(personId);
    });

    ipcMain.handle('person:getPeopleWithAlerts', async () => {
        return PersonRepository.getPeopleWithActiveAlerts();
    });

    ipcMain.handle('person:dismissAlert', async (_, alertId: number) => {
        PersonRepository.dismissAlert(alertId);
        return { success: true };
    });

    ipcMain.handle('person:dismissAllAlerts', async (_, personId: number) => {
        PersonRepository.dismissAllAlerts(personId);
        return { success: true };
    });


    // --- BACKGROUND BUCKETING (Phase B6) ---

    // Get Buckets
    ipcMain.handle('db:getSuggestionBuckets', async () => {
        console.log('[IPC] db:getSuggestionBuckets START');
        const start = Date.now();
        try {
            const buckets = BucketRepository.getSuggestionBuckets();
            console.log(`[IPC] db:getSuggestionBuckets END - took ${Date.now() - start}ms, ${buckets.length} buckets`);
            return { success: true, buckets };
        } catch (e) {
            console.log(`[IPC] db:getSuggestionBuckets ERROR - took ${Date.now() - start}ms`);
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:getDiscoveryBuckets', async () => {
        console.log('[IPC] db:getDiscoveryBuckets START');
        const start = Date.now();
        try {
            const buckets = BucketRepository.getDiscoveryBuckets();
            console.log(`[IPC] db:getDiscoveryBuckets END - took ${Date.now() - start}ms, ${buckets.length} buckets`);
            return { success: true, buckets };
        } catch (e) {
            console.log(`[IPC] db:getDiscoveryBuckets ERROR - took ${Date.now() - start}ms`);
            return { success: false, error: String(e) };
        }
    });

    // Re-check Control
    ipcMain.handle('db:startIgnoredRecheck', async () => {
        // Count total ignored faces for progress tracking
        const db = getDB();
        const result = db.prepare('SELECT COUNT(*) as count FROM faces WHERE is_ignored = 1').get() as { count: number };
        const total = result?.count || 0;

        AppStateRepository.setRecheckActive(true);
        AppStateRepository.setRecheckOffset(0);
        AppStateRepository.setRecheckTotal(total);
        console.log(`[BackgroundBucketingService] Starting recheck of ${total} ignored faces`);
        return { success: true, total };
    });

    ipcMain.handle('db:getIgnoredRecheckStatus', async () => {
        try {
            return {
                active: AppStateRepository.isRecheckActive(),
                offset: AppStateRepository.getRecheckOffset(),
                total: AppStateRepository.getRecheckTotal()
            };
        } catch (e) {
            return { active: false, offset: 0, total: 0 };
        }
    });

    ipcMain.handle('db:getBucketingStatus', async () => {
        try {
            const db = getDB();
            // Count remaining faces needing bucketing
            const remaining = db.prepare('SELECT COUNT(*) as count FROM faces WHERE needs_bucketing = 1 AND person_id IS NULL AND is_ignored = 0').get() as { count: number };
            // Get checkpoint offset (faces already processed)
            const offset = AppStateRepository.getBucketingOffset();
            let total = AppStateRepository.getBucketingTotal();
            const isDirty = AppStateRepository.isBucketingDirty();

            // If total is 0 (service hasn't started setting it yet), estimate it so UI shows pending work
            if (total === 0 && remaining.count > 0) {
                total = offset + remaining.count;
            }

            // Sanitize Offset: The infinite loop bug might have inflated the offset.
            // Use (Total - Remaining) as the source of truth for progress if available.
            const effectiveOffset = total > 0 ? Math.max(0, total - remaining.count) : offset;

            // Check if service is paused due to concurrency
            const isPaused = AppStateRepository.isScanActive() || AppStateRepository.isAIProcessingActive();

            return {
                active: (isDirty || remaining.count > 0) && !isPaused, // Only active if pending AND not paused
                offset: effectiveOffset,
                total,
                remaining: remaining.count
            };
        } catch (e) {
            // DB might be closed during move or shutdown
            return { active: false, offset: 0, total: 0, remaining: 0 };
        }
    });



    // Lifecycle Actions
    // Lifecycle Actions
    ipcMain.handle('db:confirmSuggestionBucket', async (_, { bucketId, personId, faceIds, skipRecalc }) => {
        try {
            const db = getDB();
            let targetFaceIds: number[] = [];

            if (faceIds && Array.isArray(faceIds) && faceIds.length > 0) {
                targetFaceIds = faceIds;
            } else {
                const faces = db.prepare('SELECT id FROM faces WHERE bucket_id = ?').all(bucketId) as { id: number }[];
                targetFaceIds = faces.map(f => f.id);
            }

            if (targetFaceIds.length > 0) {
                FaceRepository.updateFacePerson(targetFaceIds, personId, true);
                if (!skipRecalc) {
                    await PersonService.recalculatePersonMean(personId);
                }
            }

            // Cleanup
            if (faceIds && faceIds.length > 0) {
                // Partial confirm: Re-count and check if empty
                BucketRepository.updateFaceCount(bucketId);
                const updatedBucket = BucketRepository.getBucketById(bucketId);
                if (updatedBucket && updatedBucket.face_count === 0) {
                    BucketRepository.deleteBucket(bucketId);
                }
            } else {
                // Full confirm
                BucketRepository.markCompleted(bucketId);
            }

            return { success: true };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:rejectSuggestionBucket', async (_, bucketId) => {
        try {
            const db = getDB();
            db.prepare('UPDATE faces SET bucket_id = NULL WHERE bucket_id = ?').run(bucketId);
            BucketRepository.deleteBucket(bucketId);
            return { success: true };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:assignBucketToPerson', async (_, { bucketId, personId }) => {
        try {
            const db = getDB();
            const faces = db.prepare('SELECT id FROM faces WHERE bucket_id = ?').all(bucketId) as { id: number }[];
            const faceIds = faces.map(f => f.id);

            if (faceIds.length > 0) {
                FaceRepository.updateFacePerson(faceIds, personId, true);
                await PersonService.recalculatePersonMean(personId);
            }
            BucketRepository.markCompleted(bucketId);
            return { success: true };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:nameDiscoveryBucket', async (_, { bucketId, newName }) => {
        try {
            const db = getDB();
            const faces = db.prepare('SELECT id FROM faces WHERE bucket_id = ?').all(bucketId) as { id: number }[];
            const faceIds = faces.map(f => f.id);

            if (faceIds.length > 0) {
                const person = PersonRepository.createPerson(newName);
                FaceRepository.updateFacePerson(faceIds, person.id, true);
                await PersonService.recalculatePersonMean(person.id);
            }
            BucketRepository.markCompleted(bucketId);
            return { success: true };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });


    // Recovered Faces
    ipcMain.handle('db:getRecoveredFaces', async () => {
        try {
            return { success: true, faces: BucketRepository.getRecoveredFaces() };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:recoverFaces', async (_, faceIds) => {
        try {
            BucketRepository.recoverFaces(faceIds);
            return { success: true };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    // --- ADVANCED FILTERING (Phase: v0.6.5) ---

    ipcMain.handle('db:getCameraModels', async () => {
        try {
            return { success: true, models: PhotoRepository.getCameraModels() };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    ipcMain.handle('db:getYears', async () => {
        try {
            return { success: true, years: PhotoRepository.getYears() };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    ipcMain.handle('db:getFileTypes', async () => {
        try {
            return { success: true, fileTypes: PhotoRepository.getFileTypes() };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    ipcMain.handle('db:searchPhotos', async (_, args) => {
        try {
            console.log('[IPC] db:searchPhotos called:', JSON.stringify({ compound: args.compound, filter: args.filter, sort: args.sort }));
            let result;
            if (args.compound) {
                result = PhotoRepository.getPhotosByCompoundFilter(
                    args.filter, args.page, args.limit, args.sort, args.offset
                );
            } else {
                result = PhotoRepository.getPhotos(args.page, args.limit, args.sort, args.filter, args.offset);
            }
            console.log(`[IPC] db:searchPhotos returned ${result.photos?.length} photos, total: ${result.total}`);
            return result;
        } catch (e) {
            console.error('[IPC] db:searchPhotos ERROR:', e);
            return { photos: [], total: 0, error: String(e) };
        }
    });

    // --- SMART ALBUMS ---

    ipcMain.handle('db:createSmartAlbum', async (_, { name, filterJson }) => {
        try {
            const album = SmartAlbumRepository.create(name, filterJson);
            return { success: true, album };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    ipcMain.handle('db:getSmartAlbums', async () => {
        try {
            return { success: true, albums: SmartAlbumRepository.getAll() };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    ipcMain.handle('db:updateSmartAlbum', async (_, { id, name, filterJson }) => {
        try {
            SmartAlbumRepository.update(id, name, filterJson);
            return { success: true };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    ipcMain.handle('db:deleteSmartAlbum', async (_, id) => {
        try {
            SmartAlbumRepository.delete(id);
            return { success: true };
        } catch (e) { return { success: false, error: String(e) }; }
    });

    // Auto-resume age backfill if interrupted session exists (after short delay for services to init)
    setTimeout(async () => {
        try {
            const { BackgroundAgeRescanService } = await import('../core/services/BackgroundAgeRescanService');
            if (!ageRescanService) {
                ageRescanService = new BackgroundAgeRescanService(pythonProvider);
            }
            if (ageRescanService.resumeIfNeeded()) {
                console.log('[Main] Age backfill auto-resumed from interrupted session');
            }
        } catch (e) {
            console.error('[Main] Failed to check age backfill auto-resume:', e);
        }
    }, 10000); // 10 second delay for services to fully initialize

    // --- DUPLICATE DETECTION (Phase 107) ---

    ipcMain.handle('db:getDuplicateGroups', async (_, { status = 'pending', limit = 50, offset = 0 } = {}) => {
        try {
            const groups = DuplicateGroupRepository.getGroupsWithPhotos(status, limit, offset);
            return { success: true, groups };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:getDuplicateStats', async () => {
        try {
            return { success: true, stats: DuplicateGroupRepository.getStats() };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:resolveDuplicateGroup', async (_, { groupId, winnerPhotoId, trashLosers }: { groupId: number; winnerPhotoId: number; trashLosers: boolean }) => {
        try {
            const group = DuplicateGroupRepository.getGroupById(groupId);
            if (!group) return { success: false, error: 'Group not found' };

            DuplicateGroupRepository.resolveGroup(groupId, winnerPhotoId);

            if (trashLosers) {
                const loserIds = PhotoRepository.getPhotosByGroupId(groupId)
                    .map((p: any) => p.id)
                    .filter((id: number) => id !== winnerPhotoId);

                const loserPaths = PhotoRepository.getFilePaths(loserIds);
                for (const filePath of loserPaths) {
                    try {
                        await shell.trashItem(filePath);
                    } catch (trashErr) {
                        console.error(`[Duplicates] Failed to trash ${filePath}:`, trashErr);
                    }
                }

                // Remove trashed photos from the DB
                for (const id of loserIds) {
                    PhotoRepository.deletePhotoById(id);
                }
            }

            // Unlink winner from group (it's the keeper, no longer needs the group tag)
            PhotoRepository.setDuplicateGroup([winnerPhotoId], null);

            return { success: true };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:dismissDuplicateGroup', async (_, { groupId }: { groupId: number }) => {
        try {
            DuplicateGroupRepository.dismissGroup(groupId);
            // Unlink all photos from the dismissed group
            const photos = PhotoRepository.getPhotosByGroupId(groupId) as any[];
            PhotoRepository.setDuplicateGroup(photos.map(p => p.id), null);
            return { success: true };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:triggerDuplicateCheck', async () => {
        try {
            AppStateRepository.markDuplicateCheckDirty();
            return { success: true };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('db:getHashBackfillStats', async () => {
        try {
            return { success: true, ...PhotoRepository.countPhotosNeedingHash() };
        } catch (e) {
            return { success: false, needsSha256: 0, needsPhash: 0, error: String(e) };
        }
    });
}

