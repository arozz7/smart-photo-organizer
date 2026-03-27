import { ipcMain, app } from 'electron';
import { pythonProvider } from '../infrastructure/PythonAIProvider';
import { PhotoService } from '../core/services/PhotoService';
import { setAISettings, getAISettings } from '../store';
import logger from '../logger';
import { getDB, getDBLock } from '../db';
import { FaceRepository } from '../data/repositories/FaceRepository';
import { FaceService } from '../core/services/FaceService';
import { ConfigService } from '../core/services/ConfigService';

const REVIEW_NEEDED_MIN_COHESION = 0.40;

/**
 * Compute centroid L2 magnitude for a cluster of face IDs (cohesion metric, range 0–1).
 * - Cohesive group (same person, normalized descriptors aligned): magnitude ≈ 1.0
 * - Heterogeneous garbage cluster (random objects): magnitude ≈ 0.0 (vectors cancel)
 */
function computeClusterCohesion(clusterIds: number[], faceMap: Map<number, number[]>): number {
    const sampleIds = clusterIds.slice(0, 20);
    const descriptors = sampleIds.map(id => faceMap.get(id)).filter((d): d is number[] => !!d);
    if (descriptors.length === 0) return 0;
    const dims = descriptors[0].length;
    const centroid = new Array(dims).fill(0);
    descriptors.forEach(d => { for (let i = 0; i < dims; i++) centroid[i] += d[i]; });
    for (let i = 0; i < dims; i++) centroid[i] /= descriptors.length;
    let magnitude = 0;
    for (let i = 0; i < dims; i++) magnitude += centroid[i] * centroid[i];
    return Math.sqrt(magnitude);
}

export function registerAIHandlers() {
    // Generic Proxy 


    ipcMain.handle('ai:analyzeImage', async (_event, options) => {
        try {
            console.log(`[IPC] ai:analyzeImage options keys: ${Object.keys(options).join(',')}`);
            if (options.cleanRescan) console.log(`[IPC] cleanRescan=TRUE received!`);
            let { photoId, filePath, ...rest } = options;

            if (!filePath && photoId) {
                // const photo = PhotoRepository.getPhotoById(photoId); // Unused
                const db = getDB();
                const row = db.prepare('SELECT file_path FROM photos WHERE id = ?').get(photoId) as any;
                if (row) filePath = row.file_path;
            }

            if (!filePath) return { success: false, error: 'Missing filePath' };

            // Debug & VLM logging
            logger.info(`[Main] Analyze Request ${photoId}`);

            return await PhotoService.analyzeImage({ photoId, filePath, ...rest });
        } catch (e: any) {
            if (e.message === 'Shutdown') return { success: false, error: 'Shutdown' };
            throw e;
        }
    });

    // [Phase 84] Force Rescan
    ipcMain.handle('ai:forceRescan', async (_event, { photoId, filePath }) => {
        try {
            if (!filePath && photoId) {
                const db = getDB();
                const row = db.prepare('SELECT file_path FROM photos WHERE id = ?').get(photoId) as any;
                if (row) filePath = row.file_path;
            }
            if (!filePath) return { success: false, error: 'Missing filePath' };

            return await PhotoService.forceRescan(photoId, filePath);
        } catch (e) {
            logger.error(`[IPC] ai:forceRescan failed: ${e}`);
            return { success: false, error: String(e) };
        }
    });

    // Alias for analyzeImage used by Blur Calculation and older contexts
    ipcMain.handle('ai:scanImage', async (_event, options) => {
        let { photoId, filePath, ...rest } = options;
        if (!filePath && photoId) {
            const db = getDB();
            const row = db.prepare('SELECT file_path FROM photos WHERE id = ?').get(photoId) as any;
            if (row) filePath = row.file_path;
        }
        if (!filePath) return { success: false, error: 'Missing filePath' };

        // Use FAST mode for simple blur score calc if not specified
        // Logic Update: Manual Rescan should clean up potential duplicate faces
        return await PhotoService.analyzeImage({ photoId, filePath, scanMode: 'FAST', cleanRescan: true, ...rest });
    });

    ipcMain.handle('ai:generateTags', async (_event, { photoId }) => {
        const db = getDB();
        const photo = db.prepare('SELECT file_path FROM photos WHERE id = ?').get(photoId) as any;
        if (!photo) return { success: false, error: 'Photo not found' };

        return await PhotoService.generateTags(photoId, photo.file_path);
    });

    ipcMain.handle('ai:getSettings', () => getAISettings());

    ipcMain.handle('ai:saveSettings', (_event, settings) => {
        setAISettings(settings);
        pythonProvider.syncSettings(); // Use new method
        return true;
    });

    ipcMain.handle('ai:getAdvancedSettings', () => ConfigService.getAdvancedFaceSettings());

    ipcMain.handle('ai:saveAdvancedSettings', (_event, settings) => {
        ConfigService.setAdvancedFaceSettings(settings);
        return true;
    });

    ipcMain.handle('ai:rotateImage', async (_event, options) => {
        let { photoId, filePath, rotation } = options;
        if (!filePath && photoId) {
            const db = getDB();
            const row = db.prepare('SELECT file_path FROM photos WHERE id = ?').get(photoId) as any;
            if (row) filePath = row.file_path;
        }
        if (!filePath) return { success: false, error: 'Missing filePath' };

        // Use PhotoService (handles RAW via ExifTool)
        return await PhotoService.rotatePhoto(photoId, filePath, rotation);
    });

    ipcMain.handle('ai:downloadModel', async (_event, { modelName }) => {
        let url = undefined;
        if (modelName.includes('Runtime')) {
            const aiSettings = getAISettings();
            if (aiSettings.runtimeUrl) {
                url = aiSettings.runtimeUrl;
            } else {
                url = `https://github.com/arozz7/smart-photo-organizer/releases/download/v${app.getVersion()}/ai-runtime-win-x64.zip`;
            }
        } else if (modelName === 'sam3' || modelName.startsWith('SAM 3')) {
            // SAM 3 is a gated HuggingFace model — requires prior `huggingface-cli login`.
            // Python handler detects the hf:// prefix and uses huggingface_hub.snapshot_download.
            url = 'hf://facebook/sam3';
        } else if (modelName.startsWith('AdaFace')) {
            url = 'https://huggingface.co/mk-minchul/adaface/resolve/main/adaface_ir50_webface4m.onnx';
        }
        return await pythonProvider.sendRequest('download_model', { modelName, url }, 3600000);
    });

    ipcMain.handle('ai:enhanceImage', async (_event, options) => {
        return await pythonProvider.sendRequest('enhance_image', options, 900000); // 15 min timeout
    });

    ipcMain.handle('ai:getSystemStatus', async () => {
        const aiSettings = getAISettings();
        let runtimeUrl = aiSettings.runtimeUrl;

        if (!runtimeUrl) {
            runtimeUrl = `https://github.com/arozz7/smart-photo-organizer/releases/download/v${app.getVersion()}/ai-runtime-win-x64.zip`;
        }

        const res: any = await pythonProvider.checkStatus({ runtimeUrl });
        return res.status;
    });

    // Face Quality / AI Queries - keeping raw SQL for READ queries is fine? 
    // Or move to FaceRepository.getBlurryFaces(scope)?
    // Reusing the large block from original file for now, but accessing DB via getDB.
    ipcMain.handle('face:getBlurry', async (_event, args) => {
        return FaceRepository.getBlurryFaces(args);
    });

    // Concurrency Control
    ipcMain.handle('ai:setProcessingStatus', async (_event, active: boolean) => {
        const { AppStateRepository } = await import('../data/repositories/AppStateRepository');
        AppStateRepository.setAIProcessingActive(active);
        return true;
    });

    // ... Other handlers mapped to PythonProvider ...
    ipcMain.handle('ai:clusterFaces', async (_, args) => {
        const { faceIds, eps, min_samples, min_cohesion, max_spread } = args;
        const ids = faceIds || [];
        if (ids.length === 0) return { clusters: [], singles: [] };

        try {
            const faces = FaceRepository.getFacesByIds(ids);
            const formattedFaces = faces
                .filter((f: any) => f.descriptor && f.descriptor.length > 0)
                .map((f: any) => ({ id: f.id, descriptor: f.descriptor, pose_yaw: f.pose_yaw ?? null }));

            const { strictFalsePositiveMode } = ConfigService.getAdvancedFaceSettings();
            const payload = {
                faces: formattedFaces,
                eps: eps ?? 0.45,
                min_samples: min_samples ?? 2,
                min_cohesion: min_cohesion ?? 0.0,
                max_spread: max_spread ?? 0.0,
                anchor_only_frontal: strictFalsePositiveMode ?? false
            };
            return await pythonProvider.sendRequest('cluster_faces', payload, 600000);
        } catch (e) {
            logger.error(`[IPC] ai:clusterFaces failed: ${e}`);
            return { clusters: [], singles: [] };
        }
    });

    // Find Ungroupable Faces - identifies faces too far from any named person
    ipcMain.handle('ai:findUngroupableFaces', async (_event, options) => {
        try {
            const { distanceThreshold = 1.0 } = options || {};

            // Get unassigned faces with descriptors
            const faces = FaceRepository.getUnassignedDescriptors();
            if (faces.length === 0) {
                return { success: true, ungroupable_ids: [], groupable_ids: [], stats: { total: 0 } };
            }

            // Get named person centroids (filter out those without descriptors)
            const { PersonRepository } = await import('../data/repositories/PersonRepository');
            const people = PersonRepository.getPeopleWithDescriptors();
            const centroids = people
                .filter((p: any) => p.descriptor_mean_json) // Skip people without descriptor
                .map((p: any) => ({
                    descriptor: JSON.parse(p.descriptor_mean_json),
                    name: p.name,
                    personId: p.id
                }));

            logger.info(`[Main] Finding ungroupable faces: ${faces.length} faces, ${centroids.length} centroids, threshold=${distanceThreshold}`);

            // Call Python (file-based transfer for large payloads to avoid RangeError)
            const LARGE_PAYLOAD_THRESHOLD = 5000;
            const facesPayload = faces.map((f: any) => ({ id: f.id, descriptor: f.descriptor }));
            let result: any;

            if (facesPayload.length > LARGE_PAYLOAD_THRESHOLD) {
                const fsSync = await import('fs');
                const fsPromises = await import('fs/promises');
                const os = await import('os');
                const path = await import('path');

                const dataPath = path.join(os.tmpdir(), `spo_ungroupable_${Date.now()}.json`);
                try {
                    const writeStream = fsSync.createWriteStream(dataPath, { encoding: 'utf-8' });
                    await new Promise<void>((resolve, reject) => {
                        writeStream.on('error', reject);
                        writeStream.write('{"faces":[');
                        for (let i = 0; i < facesPayload.length; i++) {
                            if (i > 0) writeStream.write(',');
                            writeStream.write(JSON.stringify(facesPayload[i]));
                        }
                        writeStream.write('],"centroids":');
                        writeStream.write(JSON.stringify(centroids));
                        writeStream.write('}');
                        writeStream.end(() => resolve());
                    });
                    result = await pythonProvider.sendRequest('find_ungroupable_faces', {
                        dataPath,
                        distanceThreshold
                    }, 600000);
                } finally {
                    try { await fsPromises.unlink(dataPath); } catch { /* ignore */ }
                }
            } else {
                result = await pythonProvider.sendRequest('find_ungroupable_faces', {
                    faces: facesPayload,
                    centroids,
                    distanceThreshold
                }, 600000);
            }

            return result;
        } catch (e) {
            logger.error(`[Main] ai:findUngroupableFaces failed: ${e}`);
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('ai:rebuildIndex', async () => {
        try {
            // CRITICAL: Only index faces that belong to named people
            // This ensures FAISS matches return valid person IDs for auto-assign
            const faces = FaceRepository.getNamedFaceDescriptors();
            logger.info(`[Main] Rebuilding FAISS index with ${faces.length} named person faces`);

            // Use streaming JSON write to avoid RangeError with large arrays
            // JSON.stringify() on 53K+ faces exceeds JavaScript's string length limit
            const fsSync = await import('fs');
            const fs = await import('fs/promises');
            const os = await import('os');
            const path = await import('path');

            const dataPath = path.join(os.tmpdir(), `spo_rebuild_index_${Date.now()}.json`);

            let result: any;
            try {
                // Stream JSON to file - write each face individually to avoid memory limit
                const writeStream = fsSync.createWriteStream(dataPath, { encoding: 'utf-8' });

                await new Promise<void>((resolve, reject) => {
                    writeStream.on('error', reject);

                    writeStream.write('{"faces":[');

                    for (let i = 0; i < faces.length; i++) {
                        const face = faces[i];
                        const faceJson = JSON.stringify({ id: face.id, descriptor: face.descriptor });

                        if (i > 0) writeStream.write(',');
                        writeStream.write(faceJson);
                    }

                    writeStream.write(']}');
                    writeStream.end(() => resolve());
                });

                logger.info(`[Main] Wrote ${faces.length} faces to temp file for rebuild`);
                result = await pythonProvider.sendRequest('rebuild_index', { dataPath }, 600000);
            } finally {
                // Cleanup temp file
                try { await fs.unlink(dataPath); } catch { /* ignore */ }
            }

            // Reset stale count after successful rebuild
            if (result && result.success !== false) {
                const { resetFaissStaleCount } = await import('../store');
                resetFaissStaleCount();
                logger.info('[Main] FAISS stale count reset after successful rebuild');
            }

            return result;
        } catch (e) {
            logger.error(`[Main] FAISS rebuild failed: ${e}`);
            return { success: false, error: String(e) };
        }
    });

    // FAISS Stale Count Tracking - for UI to show rebuild alerts
    ipcMain.handle('ai:getFaissStaleCount', async () => {
        const { getFaissStaleCount } = await import('../store');
        return getFaissStaleCount();
    });

    ipcMain.handle('ai:command', async (_event, command) => {
        try {
            // Check global lock first - if closed, silent failure (expected during move/shutdown)
            if (!getDBLock()) return null;

            const { type, payload } = command;
            let timeout = 120000;
            if (type === 'cluster_faces' || type === 'analyze_image') timeout = 900000;
            return await pythonProvider.sendRequest(type, payload, timeout);
        } catch (e: any) {
            console.warn(`[Main] ai:command failed (likely shutdown): ${e}`);
            if (e.message === 'Shutdown') return null;
            return { success: false, error: "Service unavailable" };
        }
    });

    ipcMain.handle('ai:saveVectorIndex', async () => {
        return await pythonProvider.sendRequest('save_vector_index', {}, 120000);
    });

    ipcMain.handle('ai:addFacesToVectorIndex', async (_event, { vectors, ids }) => {
        return await pythonProvider.sendRequest('add_faces_to_vector_index', { vectors, ids }, 180000);
    });

    ipcMain.handle('ai:getUnassignedCount', async () => {
        // Use getFacesNeedingBucketingCount or similar, or just a direct query for speed
        // Logic should match getUnassignedDescriptors but just COUNT(*)
        const db = getDB();
        const res = db.prepare('SELECT COUNT(*) as count FROM faces WHERE descriptor IS NOT NULL AND person_id IS NULL AND (is_ignored = 0 OR is_ignored IS NULL)').get() as { count: number };
        return res.count;
    });

    ipcMain.handle('ai:getClusteredFaces', async (_event, options) => {
        try {
            let faces = FaceRepository.getUnassignedDescriptors();

            const totalUnassigned = faces.length;

            // Exclude Background Noise if enabled
            if (options?.excludeBackground) {
                try {
                    // Import FaceAnalysisService for background detection
                    const { FaceAnalysisService } = await import('../core/services/FaceAnalysisService');
                    const result = await FaceAnalysisService.detectBackgroundFaces({}, pythonProvider);
                    if (result.candidates && result.candidates.length > 0) {
                        const noiseIds = new Set(result.candidates.map((c: any) => c.faceId));
                        const beforeCount = faces.length;
                        faces = faces.filter((f: any) => !noiseIds.has(f.id));
                        logger.info(`[Main] excludeBackground: Filtered ${beforeCount - faces.length} noise faces, ${faces.length} remaining`);
                    }
                } catch (e) {
                    logger.error(`[Main] excludeBackground filter failed: ${e}`);
                    // Continue with all faces if filter fails
                }
            }

            // Map frontend 'threshold' (similarity) to Python 'eps' (distance)
            // DBSCAN uses distance: eps = 1 - threshold (e.g., 0.65 similarity = 0.35 distance)
            let eps = 0.45; // Default distance threshold
            if (options?.threshold !== undefined) {
                eps = 1 - options.threshold;
            }

            const maxSpread = options?.max_spread ?? 0.75;

            logger.info(`[Main] Clustering ${faces.length} faces with eps=${eps.toFixed(3)}, max_spread=${maxSpread}, groupBySuggestion=${options?.groupBySuggestion || false}`);

            // File-based transfer for large payloads to avoid RangeError: Invalid string length
            const LARGE_CLUSTER_THRESHOLD = 5000;
            let clusteringResult: any;

            if (faces.length > LARGE_CLUSTER_THRESHOLD) {
                const fsSync = await import('fs');
                const fsPromises = await import('fs/promises');
                const os = await import('os');
                const path = await import('path');

                const dataPath = path.join(os.tmpdir(), `spo_cluster_${Date.now()}.json`);
                try {
                    const writeStream = fsSync.createWriteStream(dataPath, { encoding: 'utf-8' });
                    await new Promise<void>((resolve, reject) => {
                        writeStream.on('error', reject);
                        writeStream.write('{"faces":[');
                        for (let i = 0; i < faces.length; i++) {
                            if (i > 0) writeStream.write(',');
                            writeStream.write(JSON.stringify(faces[i]));
                        }
                        writeStream.write(']}');
                        writeStream.end(() => resolve());
                    });
                    clusteringResult = await pythonProvider.sendRequest('cluster_faces', {
                        dataPath,
                        eps,
                        min_samples: options?.min_samples || 2,
                        max_size: 200,
                        min_cohesion: 0.6,
                        max_spread: maxSpread
                    }, 900000);
                } finally {
                    try { await fsPromises.unlink(dataPath); } catch { /* ignore */ }
                }
            } else {
                clusteringResult = await pythonProvider.sendRequest('cluster_faces', {
                    faces,
                    eps,
                    min_samples: options?.min_samples || 2,
                    max_size: 200,
                    min_cohesion: 0.6,
                    max_spread: maxSpread
                }, 900000);
            }

            // Pre-build descriptor lookup used for cohesion filtering in both code paths below
            const faceMap = new Map<number, number[]>();
            faces.forEach((f: any) => {
                if (f.descriptor) faceMap.set(f.id, f.descriptor);
            });

            // Options: Group by AI Suggestion (Backend)
            // If enabled, we calculate centroids of clusters, match them against known people,
            // and merge clusters that suggest the same person.
            logger.info(`[AI] groupBySuggestion=${options?.groupBySuggestion}, clusters=${clusteringResult.clusters?.length || 0}`);
            if (options?.groupBySuggestion && clusteringResult.clusters && clusteringResult.clusters.length > 0) {
                logger.info(`[AI] ENTERING groupBySuggestion merge logic...`);
                try {
                    const { FaceService } = await import('../core/services/FaceService');

                    // 1. Descriptor lookup (faceMap pre-built above for cohesion filtering)

                    // NOTE: We previously tried splitting oversized clusters, but it broke them into
                    // individual faces which is terrible UX (478 single-face groups instead of few large groups).
                    // Now we just use DBSCAN clusters as-is and tag them with suggestions.
                    // The user can review and accept/reject entire clusters at once.
                    const processedClusters = clusteringResult.clusters as number[][];
                    logger.info(`[AI] Processing ${processedClusters.length} DBSCAN clusters for suggestion tagging`);

                    // 2. Calculate centroids for all clusters
                    const clusterCentroids: number[][] = [];
                    const validClusterIndices: number[] = [];

                    processedClusters.forEach((clusterIds: number[], idx: number) => {
                        // Take sample of faces (up to 20 for better stability)
                        const sampleIds = clusterIds.slice(0, 20);
                        const descriptors = sampleIds.map(id => faceMap.get(id)).filter((d): d is number[] => !!d);

                        if (descriptors.length > 0) {
                            // Average descriptor
                            const dims = descriptors[0].length;
                            const centroid = new Array(dims).fill(0);
                            descriptors.forEach(d => {
                                for (let i = 0; i < dims; i++) centroid[i] += d[i];
                            });

                            // Calculate Mean Vector
                            for (let i = 0; i < dims; i++) centroid[i] /= descriptors.length;

                            // Check Cluster Cohesion (L2 Magnitude of Mean Vector)
                            // - Perfect cluster (identical faces) -> Magnitude ~ 1.0
                            // - Random noise (mixed faces) -> Magnitude ~ 0.0
                            let magnitude = 0;
                            for (let i = 0; i < dims; i++) magnitude += centroid[i] * centroid[i];
                            magnitude = Math.sqrt(magnitude);

                            // Threshold: Reject ambiguous/noisy clusters
                            // This prevents "Garbage" clusters (random faces) from matching a person
                            // just because they happen to point slightly in that person's direction.
                            if (magnitude >= 0.6) {
                                clusterCentroids.push(centroid);
                                validClusterIndices.push(idx);
                            } else {
                                logger.debug(`[AI] Skipping ambiguous cluster ${idx} (Size: ${clusterIds.length}, Cohesion: ${magnitude.toFixed(3)})`);
                            }
                        }
                    });

                    // 3. Match centroids against Vector DB
                    logger.info(`[AI] Cohesion filter: ${validClusterIndices.length} of ${processedClusters.length} clusters passed (threshold=0.6)`);

                    if (clusterCentroids.length > 0) {
                        const searchFn = async (d: number[][], k?: number, t?: number) => pythonProvider.searchFaces(d, k, t);
                        // Loosen threshold to 0.50 - cluster centroids are averaged and need looser matching
                        const matches = await FaceService.matchBatch(clusterCentroids, { threshold: 0.50, searchFn });

                        // Count how many matches actually found a person
                        const matchedCount = matches.filter(m => m && m.personId).length;
                        logger.info(`[AI] Match results: ${matchedCount} of ${matches.length} centroids matched to named persons (threshold=0.50)`);
                        // 4. TAG clusters with suggestions - NO MERGING!
                        // Each cluster stays separate to preserve split integrity
                        const taggedClusters: any[] = [];

                        // Tag matched clusters with their suggestions
                        matches.forEach((match, i) => {
                            const originalIdx = validClusterIndices[i];
                            const clusterFaces = processedClusters[originalIdx] as number[];

                            taggedClusters.push({
                                faces: clusterFaces,
                                suggestion: match && match.personId ? {
                                    personId: match.personId,
                                    personName: match.personName || 'Unknown',
                                    similarity: match.similarity
                                } : null,
                                _matchedIdx: originalIdx
                            });
                        });

                        // Add clusters that weren't in validClusterIndices (failed cohesion check)
                        const matchedIndices = new Set(validClusterIndices);
                        processedClusters.forEach((clusterIds: number[], idx: number) => {
                            if (!matchedIndices.has(idx)) {
                                taggedClusters.push({
                                    faces: clusterIds,
                                    suggestion: null,
                                    _matchedIdx: idx
                                });
                            }
                        });

                        // Sort: Group by personId (visual grouping), then by size
                        taggedClusters.sort((a, b) => {
                            // Suggested first
                            if (a.suggestion && !b.suggestion) return -1;
                            if (!a.suggestion && b.suggestion) return 1;
                            // Same person together
                            if (a.suggestion && b.suggestion) {
                                if (a.suggestion.personId !== b.suggestion.personId) {
                                    return a.suggestion.personId - b.suggestion.personId;
                                }
                            }
                            // Larger clusters first within same person
                            return b.faces.length - a.faces.length;
                        });

                        // Count unique suggestions
                        const uniquePersons = new Set(taggedClusters.filter(c => c.suggestion).map(c => c.suggestion.personId));
                        const suggestedCount = taggedClusters.filter(c => c.suggestion).length;
                        logger.info(`[AI] Tagged ${suggestedCount} clusters with ${uniquePersons.size} unique person suggestions (no merging)`);

                        // Apply return-time cohesion filter — demote garbage clusters to singles
                        const demotedGroupIds: number[] = [];
                        const finalTaggedClusters = taggedClusters.filter(cluster => {
                            const cohesion = computeClusterCohesion(cluster.faces, faceMap);
                            if (cohesion < REVIEW_NEEDED_MIN_COHESION) {
                                logger.debug(`[AI] Return-time filter: demoting cluster size=${cluster.faces.length} cohesion=${cohesion.toFixed(3)}`);
                                demotedGroupIds.push(...cluster.faces);
                                return false;
                            }
                            return true;
                        });
                        const filteredGroupSingles = [...(clusteringResult.singles || []), ...demotedGroupIds];

                        return {
                            clusters: finalTaggedClusters,
                            singles: filteredGroupSingles,
                            totalUnassigned
                        };
                    }
                } catch (err) {
                    logger.error(`[Main] groupBySuggestion failed: ${err}`);
                    // Fallthrough to return original result
                }
            }

            // Apply return-time cohesion filter for non-grouped path
            const demotedIds: number[] = [];
            const cohesiveClusters = ((clusteringResult.clusters || []) as number[][]).filter((clusterIds: number[]) => {
                const cohesion = computeClusterCohesion(clusterIds, faceMap);
                if (cohesion < REVIEW_NEEDED_MIN_COHESION) {
                    logger.debug(`[AI] Return-time filter: demoting cluster size=${clusterIds.length} cohesion=${cohesion.toFixed(3)}`);
                    demotedIds.push(...clusterIds);
                    return false;
                }
                return true;
            });
            const updatedSingles = [...(clusteringResult.singles || []), ...demotedIds];

            return {
                ...clusteringResult,
                clusters: cohesiveClusters,
                singles: updatedSingles,
                totalUnassigned
            };
        } catch (e) {
            logger.error(`[Main] ai:getClusteredFaces failed: ${e}`);
            return { clusters: [], singles: [] };
        }
    });

    ipcMain.handle('ai:searchIndex', async (_event, { descriptor, k, threshold }) => {
        return await pythonProvider.sendRequest('search_index', { descriptor, k, threshold });
    });

    ipcMain.handle('ai:matchFace', async (_event, { descriptor, options }) => {
        // Wrap searchFn for the modular Matcher
        const searchFn = async (d: number[][], k?: number, t?: number) => pythonProvider.searchFaces(d, k, t);
        return await FaceService.matchFace(descriptor, { ...options, searchFn });
    });

    ipcMain.handle('ai:matchBatch', async (_event, { descriptors, options }) => {
        const searchFn = async (d: number[][], k?: number, t?: number) => pythonProvider.searchFaces(d, k, t, 300000);
        return await FaceService.matchBatch(descriptors, { ...options, searchFn });
    });

    ipcMain.handle('face:findPotentialMatches', async (_event, { faceIds, threshold }) => {
        try {
            const faces = FaceRepository.getFacesByIds(faceIds);
            const descriptors = faces.map((f: any) => f.descriptor).filter(Boolean);
            const validFaceIds = faces.filter((f: any) => f.descriptor).map((f: any) => f.id);

            if (descriptors.length === 0) return { success: true, matches: [] };

            const searchFn = async (d: number[][], k?: number, t?: number) => pythonProvider.searchFaces(d, k, t, 300000);
            const matches = await FaceService.matchBatch(descriptors, { threshold, searchFn });

            const results = matches.map((m, i) => m ? {
                faceId: validFaceIds[i],
                match: m
            } : null).filter(Boolean);

            return { success: true, matches: results };
        } catch (e) {
            logger.error(`[IPC] face:findPotentialMatches failed: ${e}`);
            return { success: false, error: String(e) };
        }
    });

    // ===== DIAGNOSTIC HANDLERS =====

    // Get FAISS Index Status
    ipcMain.handle('ai:getIndexStatus', async () => {
        return await pythonProvider.sendRequest('get_index_status', {}, 180000);
    });

    // Compare specific faces (cosine similarity)
    ipcMain.handle('ai:compareFaces', async (_event, { faceIds }) => {
        try {
            const faces = FaceRepository.getFacesByIds(faceIds);
            const descriptors = faces.filter((f: any) => f.descriptor).map((f: any) => ({
                id: f.id,
                descriptor: f.descriptor
            }));

            if (descriptors.length < 2) {
                return { success: false, error: 'Need at least 2 faces with descriptors' };
            }

            // Compute pairwise cosine similarities
            const similarities: any[] = [];
            for (let i = 0; i < descriptors.length; i++) {
                for (let j = i + 1; j < descriptors.length; j++) {
                    const a = descriptors[i].descriptor;
                    const b = descriptors[j].descriptor;

                    // Cosine similarity: dot(a,b) / (|a| * |b|)
                    let dot = 0, normA = 0, normB = 0;
                    for (let k = 0; k < a.length; k++) {
                        dot += a[k] * b[k];
                        normA += a[k] * a[k];
                        normB += b[k] * b[k];
                    }
                    const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
                    const distance = 1 - similarity; // Euclidean-like distance for normalized vectors

                    similarities.push({
                        face1: descriptors[i].id,
                        face2: descriptors[j].id,
                        similarity: Math.round(similarity * 10000) / 10000,
                        distance: Math.round(distance * 10000) / 10000
                    });
                }
            }

            // Sort by similarity descending
            similarities.sort((a, b) => b.similarity - a.similarity);

            return { success: true, comparisons: similarities };
        } catch (e) {
            logger.error(`[IPC] ai:compareFaces failed: ${e}`);
            return { success: false, error: String(e) };
        }
    });

    // Debug clustering - run clustering with detailed distance info
    ipcMain.handle('ai:debugCluster', async (_event, options) => {
        try {
            let faces = FaceRepository.getUnassignedDescriptors();

            // Map threshold to eps
            let eps = 0.45;
            if (options?.threshold !== undefined) {
                eps = 1 - options.threshold;
            }

            const payload = {
                faces: faces,
                eps: eps,
                min_samples: options?.min_samples || 2,
                debug: true  // Enable debug mode
            };

            logger.info(`[Main] Debug clustering ${faces.length} faces with eps=${eps.toFixed(3)}`);
            const result = await pythonProvider.sendRequest('cluster_faces', payload, 600000);

            return result;
        } catch (e) {
            logger.error(`[Main] ai:debugCluster failed: ${e}`);
            return { error: String(e) };
        }
    });

    // [Phase 56] VLM Face Verification
    ipcMain.handle('ai:verifyFace', async (_event, { imagePath, box }) => {
        try {
            return await pythonProvider.verifyFace(imagePath, box);
        } catch (e) {
            logger.error(`[IPC] ai:verifyFace failed: ${e}`);
            return { is_face: null, confidence: 0, error: String(e) };
        }
    });

    // [Phase 56] Audit Low Confidence Faces
    ipcMain.handle('face:auditLowConfidence', async () => {
        try {
            const updated = FaceRepository.markLowConfidenceAsSuspect();
            logger.info(`[IPC] face:auditLowConfidence: Marked ${updated} faces as suspect`);
            return { success: true, updated };
        } catch (e) {
            logger.error(`[IPC] face:auditLowConfidence failed: ${e}`);
            return { success: false, error: String(e) };
        }
    });

    // [Phase 56] Get Verification Status
    ipcMain.handle('face:getVerificationStatus', async () => {
        try {
            const pending = FaceRepository.countSuspectFaces();
            const { ServiceManager } = await import('../core/services/ServiceManager');
            const service = ServiceManager.getInstance().get('BackgroundVerificationService') as any;
            const isRunning = service?.isServiceRunning() ?? false;

            return {
                success: true,
                pending,
                isRunning
            };
        } catch (e) {
            logger.error(`[IPC] face:getVerificationStatus failed: ${e}`);
            return { success: false, error: String(e) };
        }
    });

    // ---------------------------------------------------------------
    // SAM 3 Creative Tools — Phase 111
    // ---------------------------------------------------------------

    ipcMain.handle('ai:segment:capabilities', async () => {
        return await pythonProvider.sendRequest('segment_capabilities', {}, 90_000);
    });

    ipcMain.handle('ai:segment:setImage', async (_, { imagePath }: { imagePath: string }) => {
        return await pythonProvider.sendRequest('segment_set_image', { imagePath }, 15_000);
    });

    ipcMain.handle('ai:segment:predict', async (_, payload: {
        session_id: string;
        text?: string;
        box?: number[];
        points?: number[][];
        point_labels?: number[];
    }) => {
        return await pythonProvider.sendRequest('segment_predict', payload, 120_000);
    });

    ipcMain.handle('ai:segment:apply', async (_, payload: {
        session_id: string;
        operation: 'background-remove' | 'isolate' | 'blur' | 'enhance'
                 | 'desaturate-bg' | 'fill-bg'
                 | 'pixelate-bg' | 'spotlight' | 'color-tint';
        mask_b64: string;
        invert_mask?: boolean;
        feather_radius?: number;
        radius?: number;
        color?: string;
        pixel_size?: number;
        brightness?: number;
        tint_opacity?: number;
    }) => {
        return await pythonProvider.sendRequest('segment_apply', payload, 120_000);
    });
}
