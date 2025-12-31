import { ipcMain, app } from 'electron';
import { sendRequestToPython, sendToPython } from '../services/pythonService';
import { setAISettings, getAISettings, getLibraryPath } from '../store';
import logger from '../logger';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { getDB } from '../db';

export function registerAIHandlers() {
    // Generic Proxy for Legacy/Dynamic Commands
    ipcMain.handle('ai:command', async (_event, command) => {
        const { type, payload } = command;
        // Default timeout 30s, extend for certain types if needed
        let timeout = 30000;
        if (type === 'cluster_faces' || type === 'analyze_image') timeout = 300000; // 5 min
        return await sendRequestToPython(type, payload, timeout);
    });

    ipcMain.handle('ai:analyzeImage', async (_event, options) => {
        // options: { photoId, filePath, scanMode, enableVLM, debug }
        let { photoId, filePath, ...rest } = options;
        const { getDB } = await import('../db');
        const db = getDB();

        // Ensure filePath exists
        if (!filePath && photoId) {
            const { getDB } = await import('../db'); // Lazy import to avoid circular dep if needed
            const db = getDB();
            try {
                const photo = db.prepare('SELECT file_path FROM photos WHERE id = ?').get(photoId);
                if (photo && photo.file_path) {
                    filePath = photo.file_path;
                } else {
                    return { success: false, error: 'Photo not found or file path is missing' };
                }
            } catch (e) {
                return { success: false, error: `DB Lookup Failed: ${String(e)} ` };
            }
        }

        if (!filePath) {
            return { success: false, error: 'Missing filePath for analysis' };
        }

        // Debug Settings Propagation
        if (rest.enableVLM !== undefined) {
            logger.info(`[Main] Analyze Request for ${photoId} - VLM: ${rest.enableVLM}`);
        }

        // Fetch Metadata to get Orientation
        let orientation = 1;
        try {
            const getMeta = db.prepare('SELECT metadata_json FROM photos WHERE id = ?');
            const row = getMeta.get(photoId) as { metadata_json: string };
            if (row && row.metadata_json) {
                const meta = JSON.parse(row.metadata_json);
                orientation = meta.Orientation || meta.ExifImageOrientation || 1;
            }
        } catch (ignored) { }

        logger.info(`[Main] Analyze Request for ${photoId} - VLM: ${rest.enableVLM}, Orientation: ${orientation}`);

        return await sendRequestToPython('analyze_image', { photoId, filePath, orientation, ...rest }, 300000);
    });

    ipcMain.handle('ai:generateTags', async (_event, { photoId }) => {
        const { getDB } = await import('../db');
        const db = getDB();
        try {
            const photo = db.prepare('SELECT file_path FROM photos WHERE id = ?').get(photoId) as { file_path: string };
            if (photo && photo.file_path) {
                const result = await sendRequestToPython('generate_tags', { photoId, filePath: photo.file_path }, 60000);

                // Save results to DB
                if (result && !result.error && (result.description || result.tags)) {
                    const updates = [];
                    // 1. Save Description
                    if (result.description) {
                        try {
                            db.prepare('UPDATE photos SET description = ? WHERE id = ?').run(result.description, photoId);
                            updates.push("Description saved");
                        } catch (err: any) {
                            // Ignore if column missing (migration should have run, but safe fallback)
                            logger.warn("Could not save description:", err.message);
                        }
                    }

                    // 2. Save Tags
                    if (result.tags && Array.isArray(result.tags)) {
                        const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
                        const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?');
                        const linkTag = db.prepare('INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, source) VALUES (?, ?, ?)');

                        const trx = db.transaction(() => {
                            for (const tag of result.tags) {
                                const cleanTag = tag.toLowerCase().trim();
                                if (!cleanTag) continue;

                                insertTag.run(cleanTag);
                                const row = getTagId.get(cleanTag) as { id: number };
                                if (row) {
                                    linkTag.run(photoId, row.id, 'ai');
                                }
                            }
                        });
                        trx();
                        updates.push(`Tags saved: ${result.tags.length}`);
                    }
                    result.dbStatus = updates.join(", ");
                }
                return result;
            }
            return { success: false, error: 'Photo not found' };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    // Handle Settings
    ipcMain.handle('ai:getSettings', () => {
        return getAISettings();
    });

    ipcMain.handle('ai:saveSettings', (_event, settings) => {
        setAISettings(settings);
        // Propagate to Python
        sendToPython({ type: 'update_config', payload: { config: settings } });
        return true;
    });

    ipcMain.handle('ai:downloadModel', async (_event, { modelName }) => {
        logger.info(`[Main] Requesting model download: ${modelName} `);
        return await sendRequestToPython('download_model', { modelName }, 1800000);
    });

    ipcMain.handle('ai:getSystemStatus', async () => {
        const res: any = await sendRequestToPython('get_system_status', {}, 30000);
        return res.status || {};
    });

    // Face Quality / AI Queries
    ipcMain.handle('face:getBlurry', async (_event, { personId, threshold, scope, limit = 1000, offset = 0 }) => {
        const db = getDB();

        // Determine the query based on scope or personId
        // scope: 'person' | 'unnamed' | 'all'

        let query = '';
        let countQuery = '';
        const params = [];
        const countParams = [];

        if (personId) {
            // Specific person
            query = `SELECT f.id, f.photo_id, f.blur_score, f.box_json, p.file_path, p.preview_cache_path, p.metadata_json, p.width, p.height, pp.name as person_name 
               FROM faces f 
               JOIN photos p ON f.photo_id = p.id
               LEFT JOIN people pp ON f.person_id = pp.id
               WHERE f.person_id = ? AND f.blur_score < ? AND(f.is_ignored = 0 OR f.is_ignored IS NULL)`;
            countQuery = `SELECT COUNT(*) as count FROM faces f WHERE f.person_id = ? AND f.blur_score < ? AND(f.is_ignored = 0 OR f.is_ignored IS NULL)`;
            params.push(personId);
            countParams.push(personId);
        } else if (scope === 'all') {
            // All faces (global cleanup)
            query = `SELECT f.id, f.photo_id, f.blur_score, f.box_json, p.file_path, p.preview_cache_path, p.metadata_json, p.width, p.height, pp.name as person_name
               FROM faces f 
               JOIN photos p ON f.photo_id = p.id
               LEFT JOIN people pp ON f.person_id = pp.id
               WHERE f.blur_score < ? AND(f.is_ignored = 0 OR f.is_ignored IS NULL)`;
            countQuery = `SELECT COUNT(*) as count FROM faces f WHERE f.blur_score < ? AND(f.is_ignored = 0 OR f.is_ignored IS NULL)`;
        } else {
            // Default: Unnamed only
            query = `SELECT f.id, f.photo_id, f.blur_score, f.box_json, p.file_path, p.preview_cache_path, p.metadata_json, p.width, p.height 
               FROM faces f 
               JOIN photos p ON f.photo_id = p.id
               WHERE f.person_id IS NULL AND f.blur_score < ? AND(f.is_ignored = 0 OR f.is_ignored IS NULL)`;
            countQuery = `SELECT COUNT(*) as count FROM faces f WHERE f.person_id IS NULL AND f.blur_score < ? AND(f.is_ignored = 0 OR f.is_ignored IS NULL)`;
        }

        const thresh = threshold || 20.0;
        params.push(thresh);
        countParams.push(thresh);

        // Apply Pagination
        query += ' LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const stmt = db.prepare(query);
        const countStmt = db.prepare(countQuery);

        try {
            const rows = stmt.all(...params);
            const totalRes = countStmt.get(...countParams) as { count: number };
            const total = totalRes ? totalRes.count : 0;

            const faces = rows.map((r: any) => {
                let original_width = r.width;
                let original_height = r.height;

                // Fallback to metadata if columns NULL (legacy support)
                if ((!original_width || !original_height) && r.metadata_json) {
                    try {
                        const meta = JSON.parse(r.metadata_json);
                        original_width = original_width || meta.ImageWidth || meta.SourceImageWidth || meta.ExifImageWidth;
                        original_height = original_height || meta.ImageHeight || meta.SourceImageHeight || meta.ExifImageHeight;
                    } catch (e) {
                        // ignore parse error
                    }
                }
                return {
                    ...r,
                    box: JSON.parse(r.box_json),
                    original_width,
                    original_height
                };
            });

            return { faces, total };

        } catch (e) {
            console.error("Failed to get blurry faces:", e);
            return { faces: [], total: 0, error: String(e) };
        }
    });

    ipcMain.handle('face:findPotentialMatches', async (_event, { faceIds, threshold }) => {
        try {
            const { findPotentialMatches } = await import('../db');

            // Inject FAISS Search
            const searchFn = async (descriptors: number[][], k?: number, threshold?: number) => {
                const res = await sendRequestToPython('batch_search_index', {
                    descriptors,
                    k: k || 10,
                    threshold: threshold || 0.6
                }, 60000);
                if (res.error) throw new Error(res.error);
                return res.results;
            };

            return await findPotentialMatches(faceIds, threshold, searchFn);
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('debug:getBlurStats', async () => {
        const db = getDB();
        try {
            const stats = db.prepare(`
        SELECT
COUNT(*) as total,
    COUNT(blur_score) as scored_count,
    MIN(blur_score) as min_score,
    MAX(blur_score) as max_score,
    (SELECT COUNT(*) FROM faces WHERE blur_score IS NULL) as null_count
        FROM faces
    `).get();
            return { success: true, stats };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('ai:clusterFaces', async (_event, { faceIds, eps, min_samples }) => {
        try {
            const db = getDB();
            const crypto = await import('node:crypto');
            logger.info(`[IPC] Requesting clustering for ${faceIds?.length} specific faces...`);

            if (!faceIds || faceIds.length === 0) {
                return { clusters: [], singles: [] };
            }

            // 1. Fetch RAW descriptors for specific IDs
            const placeholders = faceIds.map(() => '?').join(',');
            const faces = db.prepare(`
                SELECT id, descriptor
                FROM faces
                WHERE id IN (${placeholders})
                AND descriptor IS NOT NULL
            `).all(...faceIds);

            if (faces.length === 0) {
                return { clusters: [], singles: [] };
            }

            const formattedFaces = faces.map((f: any) => ({
                id: f.id,
                descriptor: Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4))
            }));

            // 2. Write to Temp File
            const reqId = crypto.randomUUID();
            const tempFile = path.join(app.getPath('temp'), `cluster_payload_${reqId}.json`);

            const fileHandle = await fs.open(tempFile, 'w');
            try {
                await fileHandle.write('{"faces":[');
                for (let i = 0; i < formattedFaces.length; i++) {
                    if (i > 0) await fileHandle.write(',');
                    await fileHandle.write(JSON.stringify(formattedFaces[i]));
                }
                await fileHandle.write(']}');
            } finally {
                await fileHandle.close();
            }

            logger.info(`[IPC] Descriptors written to ${tempFile}. Invoking Python...`);

            // 3. Call Python
            const res: any = await sendRequestToPython('cluster_faces', {
                reqId,
                dataPath: tempFile,
                eps: eps || 0.6,
                min_samples: min_samples || 2
            }, 300000);

            // Clean up
            try { await fs.unlink(tempFile); } catch { }

            if (res.error) throw new Error(res.error);
            return res;

        } catch (e) {
            logger.error('Targeted Clustering Failed:', e);
            return { error: String(e), clusters: [], singles: [] };
        }
    });

    ipcMain.handle('ai:getClusteredFaces', async () => {
        try {
            const { getFacesForClustering } = await import('../db');
            const crypto = await import('node:crypto');
            logger.info('[IPC] Starting Full Face Clustering...');

            // 1. Fetch RAW descriptors
            const dbRes = getFacesForClustering();
            if (!dbRes.success || !dbRes.faces) {
                throw new Error(dbRes.error || 'Failed to fetch faces from DB');
            }

            const faces = dbRes.faces;
            logger.info(`[IPC] Fetched ${faces.length} faces for clustering.`);

            if (faces.length === 0) {
                return { clusters: [], singles: [] };
            }

            // 2. Write to Temp File
            const reqId = crypto.randomUUID();
            const tempFile = path.join(app.getPath('temp'), `cluster_payload_${reqId}.json`);

            // Manual JSON construction
            const fileHandle = await fs.open(tempFile, 'w');
            try {
                await fileHandle.write('{"faces":[');
                for (let i = 0; i < faces.length; i++) {
                    if (i > 0) await fileHandle.write(',');
                    await fileHandle.write(JSON.stringify(faces[i]));
                }
                await fileHandle.write(']}');
            } finally {
                await fileHandle.close();
            }

            logger.info(`[IPC] Descriptors written to ${tempFile}. Invoking Python...`);

            // 3. Call Python
            const settings = getAISettings();
            const threshold = settings.faceSimilarityThreshold || 0.65;
            // Convert Similarity (1/(1+d)) back to Distance (d = 1/minSim - 1)
            // Example: 0.65 -> 1/0.65 - 1 = 0.538 (Close to previous default 0.55)
            // Example: 0.80 -> 1/0.8 - 1 = 0.25 (Very Strict)
            const calculatedEps = (1 / Math.max(0.1, threshold)) - 1;

            const res: any = await sendRequestToPython('cluster_faces', {
                reqId,
                dataPath: tempFile,
                eps: calculatedEps,
                min_samples: 2
            }, 300000);

            // Clean up temp file
            try {
                await fs.unlink(tempFile);
            } catch (e) {
                logger.warn(`[IPC] Failed to delete temp file ${tempFile} `, e);
            }

            if (res.error) {
                throw new Error(res.error);
            }

            return res;

        } catch (e) {
            logger.error('Clustering Failed:', e);
            return { error: String(e), clusters: [], singles: [] };
        }
    });

    ipcMain.handle('ai:saveVectorIndex', async () => {
        logger.info('[IPC] Requesting Vector Index Save...');
        return await sendRequestToPython('save_vector_index', {}, 60000);
    });

    ipcMain.handle('ai:rebuildIndex', async () => {
        const { getDB } = await import('../db');
        const db = getDB();
        const crypto = await import('node:crypto');

        logger.info('[IPC] Requesting Vector Index Rebuild...');

        try {
            // 1. Fetch All Valid Descriptors
            const faces = db.prepare('SELECT id, descriptor FROM faces WHERE descriptor IS NOT NULL').all();
            logger.info(`[IPC] Fetched ${faces.length} faces for Index Rebuild.`);

            if (faces.length === 0) {
                return await sendRequestToPython('rebuild_index', { descriptors: [], ids: [] }, 60000);
            }

            // 2. Format
            const formattedFaces = faces.map((f: any) => ({
                id: f.id,
                descriptor: Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4))
            }));

            // 3. Write to Temp File
            const reqId = crypto.randomUUID();
            const tempFile = path.join(app.getPath('temp'), `rebuild_index_${reqId}.json`);

            const fileHandle = await fs.open(tempFile, 'w');
            try {
                // Determine format based on what Python expects. Python's new logic handles "faces" list or "descriptors"/"ids" lists.
                // "faces" list is more memory efficient to write streamingly if needed, but here we mapped it already.
                // Let's write { faces: [...] }
                await fileHandle.write('{"faces":[');
                for (let i = 0; i < formattedFaces.length; i++) {
                    if (i > 0) await fileHandle.write(',');
                    await fileHandle.write(JSON.stringify(formattedFaces[i]));
                }
                await fileHandle.write(']}');
            } finally {
                await fileHandle.close();
            }

            logger.info(`[IPC] Rebuild Payload written to ${tempFile} (${faces.length} faces). Invoking Python...`);

            // 4. Send Command
            const res: any = await sendRequestToPython('rebuild_index', {
                dataPath: tempFile,
                count: faces.length
            }, 300000); // 5 min timeout

            // Clean up
            try { await fs.unlink(tempFile); } catch { }

            return res;

        } catch (e) {
            logger.error("Failed to rebuild index:", e);
            return { success: false, error: String(e) };
        }
    });

    ipcMain.handle('ai:addFacesToVectorIndex', async (_event, { faces }) => {
        // faces: array of { id, descriptor (array) }
        return await sendRequestToPython('add_faces_to_vector_index', { faces }, 30000);
    });

    ipcMain.handle('ai:rotateImage', async (_, { photoId, rotation }) => {
        const db = getDB();
        logger.info(`[Main] Requesting Rotation for ${photoId}(${rotation} deg)`);

        try {
            const stmt = db.prepare('SELECT file_path FROM photos WHERE id = ?');
            const photo = stmt.get(photoId) as { file_path: string };

            if (photo && photo.file_path) {
                const { PhotoService } = await import('../services/photoService');
                const result = await PhotoService.rotatePhoto(photoId, photo.file_path, rotation);

                if (result.success) {
                    // PhotoService.rotatePhoto handles preview generation.
                    // We need to derive the preview path to update the DB.
                    // It uses a stable hash for naming.
                    const crypto = await import('node:crypto');
                    const normalizedPath = photo.file_path.replace(/\\/g, '/');
                    const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');
                    const previewPath = path.join(getLibraryPath(), 'previews', `${hash}.jpg`);

                    db.prepare('UPDATE photos SET width = ?, height = ?, preview_cache_path = ? WHERE id = ?')
                        .run(result.width, result.height, previewPath, photoId);

                    try {
                        const faces = db.prepare('SELECT id, box_json, person_id FROM faces WHERE photo_id = ?').all(photoId) as { id: number, box_json: string, person_id: number | null }[];

                        if (faces.length > 0) {
                            const rot = Number(rotation);
                            const transform = (x: number, y: number) => {
                                let srcW = 0, srcH = 0;
                                const absRot = Math.abs(rotation) % 360;
                                if (absRot === 90 || absRot === 270) {
                                    srcW = result.height || 0;
                                    srcH = result.width || 0;
                                } else {
                                    srcW = result.width || 0;
                                    srcH = result.height || 0;
                                }

                                if (rot === 90 || rot === -270) return [y, srcW - x];
                                if (rot === 180 || rot === -180) return [srcW - x, srcH - y];
                                if (rot === 270 || rot === -90) return [srcH - y, x];
                                return [x, y];
                            };
                            const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));

                            const transformedOldFaces = faces.map(face => {
                                try {
                                    const box = JSON.parse(face.box_json);
                                    let x1, y1, x2, y2;
                                    if (Array.isArray(box) && box.length === 4) { [x1, y1, x2, y2] = box; }
                                    else if (box && typeof box.x === 'number') { x1 = box.x; y1 = box.y; x2 = box.x + box.width; y2 = box.y + box.height; }
                                    else return null;

                                    const p1 = transform(x1, y1);
                                    const p2 = transform(x2, y2);

                                    const nx1 = clamp(Math.min(p1[0], p2[0]), result.width || 0);
                                    const ny1 = clamp(Math.min(p1[1], p2[1]), result.height || 0);
                                    const nx2 = clamp(Math.max(p1[0], p2[0]), result.width || 0);
                                    const ny2 = clamp(Math.max(p1[1], p2[1]), result.height || 0);

                                    return {
                                        id: face.id,
                                        person_id: face.person_id,
                                        box: { x: nx1, y: ny1, width: nx2 - nx1, height: ny2 - ny1 }
                                    };
                                } catch (e) { return null; }
                            }).filter(f => f !== null);

                            const scanResult: any = await sendRequestToPython('analyze_image', {
                                photoId,
                                filePath: photo.file_path,
                                scanMode: 'BALANCED',
                                enableVLM: false
                            }, 300000);

                            if (scanResult.success && scanResult.faces) {
                                db.prepare('DELETE FROM faces WHERE photo_id = ?').run(photoId);
                                const insert = db.prepare('INSERT INTO faces (photo_id, box_json, descriptor, score, blur_score, person_id) VALUES (?, ?, ?, ?, ?, ?)');

                                const usedOldFaceIds = new Set<number>();

                                for (const newFace of scanResult.faces) {
                                    let matchedPid: number | null = null;
                                    let bestDist = Infinity;

                                    if (transformedOldFaces.length > 0) {
                                        const cx = newFace.box.x + newFace.box.width / 2;
                                        const cy = newFace.box.y + newFace.box.height / 2;

                                        transformedOldFaces.forEach((old) => {
                                            if (!old || old.person_id === null || usedOldFaceIds.has(old.id)) return;
                                            const ocx = old.box.x + old.box.width / 2;
                                            const ocy = old.box.y + old.box.height / 2;
                                            const dist = Math.sqrt(Math.pow(cx - ocx, 2) + Math.pow(cy - ocy, 2));
                                            const threshold = Math.min(result.width || 0, result.height || 0) * 0.08;

                                            if (dist < bestDist && dist < threshold) {
                                                bestDist = dist;
                                                matchedPid = old.person_id;
                                                usedOldFaceIds.add(old.id)
                                            }
                                        });
                                    }

                                    const descArr = new Float32Array(newFace.descriptor);
                                    const descBuf = Buffer.from(descArr.buffer);
                                    insert.run(photoId, JSON.stringify(newFace.box), descBuf, newFace.score, newFace.blur_score, matchedPid);
                                }
                            }
                        }
                    } catch (e) {
                        logger.warn('[Rotate] Face preservation failed:', e);
                    }
                }
                return result;
            }
            return { success: false, error: 'Photo not found' };
        } catch (e) {
            logger.error('Rotation Failed:', e);
            return { success: false, error: String(e) };
        }
    });
}
