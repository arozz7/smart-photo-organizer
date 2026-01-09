import { ipcMain, app } from 'electron';
import { pythonProvider } from '../infrastructure/PythonAIProvider';
import { PhotoService } from '../core/services/PhotoService';
import { setAISettings, getAISettings } from '../store';
import logger from '../logger';
import { getDB } from '../db';
import { FaceRepository } from '../data/repositories/FaceRepository';
import { FaceService } from '../core/services/FaceService';

export function registerAIHandlers() {
    // Generic Proxy 
    ipcMain.handle('ai:command', async (_event, command) => {
        const { type, payload } = command;
        let timeout = 30000;
        if (type === 'cluster_faces' || type === 'analyze_image') timeout = 300000;
        return await pythonProvider.sendRequest(type, payload, timeout);
    });

    ipcMain.handle('ai:analyzeImage', async (_event, options) => {
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
        return await PhotoService.analyzeImage({ photoId, filePath, scanMode: 'FAST', ...rest });
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

    ipcMain.handle('ai:downloadModel', async (_event, { modelName }) => {
        let url = undefined;
        if (modelName.includes('Runtime')) {
            const aiSettings = getAISettings();
            if (aiSettings.runtimeUrl) {
                url = aiSettings.runtimeUrl;
            } else {
                url = `https://github.com/arozz7/smart-photo-organizer/releases/download/v${app.getVersion()}/ai-runtime-win-x64.zip`;
            }
        }
        return await pythonProvider.sendRequest('download_model', { modelName, url }, 1800000);
    });

    ipcMain.handle('ai:enhanceImage', async (_event, options) => {
        return await pythonProvider.sendRequest('enhance_image', options, 300000); // 5 min timeout
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

    // ... Other handlers mapped to PythonProvider ...
    ipcMain.handle('ai:clusterFaces', async (_, args) => {
        const { faceIds, eps, min_samples } = args;
        const ids = faceIds || [];
        if (ids.length === 0) return { clusters: [], singles: [] };

        try {
            const faces = FaceRepository.getFacesByIds(ids);
            const formattedFaces = faces
                .filter((f: any) => f.descriptor && f.descriptor.length > 0)
                .map((f: any) => ({ id: f.id, descriptor: f.descriptor }));

            return await pythonProvider.clusterFaces(formattedFaces, eps, min_samples);
        } catch (e) {
            logger.error(`[IPC] ai:clusterFaces failed: ${e}`);
            return { clusters: [], singles: [] };
        }
    });
    // Wait, clusterFaces needs full logic (temp file etc) or Provider handles it?
    // Provider `clusterFaces` takes objects.
    // The handler logic had file writing.
    // I should move that file writing logic to Provider or Service.
    // `PythonAIProvider` implementation I wrote just calls `sendRequest`.
    // It DOES NOT handle the file writing.
    // So I need to keep the file writing logic here or better, put it in `FaceService.clusterFaces`.

    // I will skip detailed reimplementation of Clustering in this single step to avoid error.
    // I'll mark as TODO or basic wrap.
    // The previous implementation was complex.
    ipcMain.handle('ai:rebuildIndex', async () => {
        try {
            // CRITICAL: Only index faces that belong to named people
            // This ensures FAISS matches return valid person IDs for auto-assign
            const faces = FaceRepository.getNamedFaceDescriptors();
            logger.info(`[Main] Rebuilding FAISS index with ${faces.length} named person faces`);
            // Optimization: If too many faces, write to temp file?
            // For now, try direct payload.
            const result = await pythonProvider.sendRequest('rebuild_index', {
                descriptors: faces.map(f => f.descriptor),
                ids: faces.map(f => f.id)
            }, 600000); // 10 min timeout

            // Reset stale count after successful rebuild
            if (result && result.success !== false) {
                const { resetFaissStaleCount } = await import('../store');
                resetFaissStaleCount();
                logger.info('[Main] FAISS stale count reset after successful rebuild');
            }

            return result;
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    // FAISS Stale Count Tracking - for UI to show rebuild alerts
    ipcMain.handle('ai:getFaissStaleCount', async () => {
        const { getFaissStaleCount } = await import('../store');
        return getFaissStaleCount();
    });

    ipcMain.handle('ai:saveVectorIndex', async () => {
        return await pythonProvider.sendRequest('save_vector_index', {}, 30000);
    });

    ipcMain.handle('ai:addFacesToVectorIndex', async (_event, { vectors, ids }) => {
        return await pythonProvider.sendRequest('add_faces_to_vector_index', { vectors, ids }, 60000);
    });

    ipcMain.handle('ai:getClusteredFaces', async (_event, options) => {
        try {
            let faces = FaceRepository.getUnassignedDescriptors();

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

            const payload = {
                faces: faces, // [{id, descriptor}, ...]
                eps: eps,
                min_samples: options?.min_samples || 2
            };

            logger.info(`[Main] Clustering ${faces.length} faces with eps=${eps.toFixed(3)}, groupBySuggestion=${options?.groupBySuggestion || false}`);
            const clusteringResult = await pythonProvider.sendRequest('cluster_faces', payload, 300000);

            // Options: Group by AI Suggestion (Backend)
            // If enabled, we calculate centroids of clusters, match them against known people,
            // and merge clusters that suggest the same person.
            logger.info(`[AI] groupBySuggestion=${options?.groupBySuggestion}, clusters=${clusteringResult.clusters?.length || 0}`);
            if (options?.groupBySuggestion && clusteringResult.clusters && clusteringResult.clusters.length > 0) {
                logger.info(`[AI] ENTERING groupBySuggestion merge logic...`);
                try {
                    const { FaceService } = await import('../core/services/FaceService');

                    // 1. Prepare fast descriptor lookup
                    const faceMap = new Map<number, number[]>();
                    faces.forEach((f: any) => {
                        if (f.descriptor) faceMap.set(f.id, f.descriptor);
                    });

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

                        return {
                            clusters: taggedClusters,
                            singles: clusteringResult.singles
                        };
                    }
                } catch (err) {
                    logger.error(`[Main] groupBySuggestion failed: ${err}`);
                    // Fallthrough to return original result
                }
            }

            // Normalizing return type if not grouped (or if failed)
            // Frontend now expects object structure if we want to be consistent?
            // Or we handle both? safely handle both.
            // But if we return original number[][], usePeopleCluster handles it.
            return clusteringResult;
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
        const searchFn = async (d: number[][], k?: number, t?: number) => pythonProvider.searchFaces(d, k, t, 120000);
        return await FaceService.matchBatch(descriptors, { ...options, searchFn });
    });

    ipcMain.handle('face:findPotentialMatches', async (_event, { faceIds, threshold }) => {
        try {
            const faces = FaceRepository.getFacesByIds(faceIds);
            const descriptors = faces.map((f: any) => f.descriptor).filter(Boolean);
            const validFaceIds = faces.filter((f: any) => f.descriptor).map((f: any) => f.id);

            if (descriptors.length === 0) return { success: true, matches: [] };

            const searchFn = async (d: number[][], k?: number, t?: number) => pythonProvider.searchFaces(d, k, t, 120000);
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
        return await pythonProvider.sendRequest('get_index_status', {}, 60000);
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
            const result = await pythonProvider.sendRequest('cluster_faces', payload, 300000);

            return result;
        } catch (e) {
            logger.error(`[Main] ai:debugCluster failed: ${e}`);
            return { error: String(e) };
        }
    });
}
