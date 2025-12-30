import { app, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import logger from '../logger';
import { getLibraryPath, getAISettings } from '../store';
import { getDB, autoAssignFaces } from '../db';

let pythonProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
const scanPromises = new Map<number, { resolve: (v: any) => void, reject: (err: any) => void }>();

export function setMainWindow(win: BrowserWindow) {
    mainWindow = win;
}

export function killPythonBackend() {
    if (pythonProcess) {
        logger.info('[PythonService] Killing Python process...');
        pythonProcess.kill();
        pythonProcess = null;
    }
}

export function sendToPython(command: any) {
    if (pythonProcess && pythonProcess.stdin) {
        pythonProcess.stdin.write(JSON.stringify(command) + '\n');
    } else {
        logger.error('[PythonService] Python process not running. Queuing or dropping command.', command.type);
    }
}

export function sendRequestToPython(type: string, payload: any, timeoutMs: number = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
        const requestId = Math.floor(Math.random() * 1000000);
        scanPromises.set(requestId, {
            resolve,
            reject
        });

        sendToPython({
            type,
            payload: { ...payload, reqId: requestId }
        });

        setTimeout(() => {
            if (scanPromises.has(requestId)) {
                scanPromises.delete(requestId);
                reject(`${type} timed out`);
            }
        }, timeoutMs);
    });
}

export function startPythonBackend() {
    let pythonPath: string;
    let args: string[];
    const LIBRARY_PATH = getLibraryPath();

    if (app.isPackaged) {
        // In production, use the bundled executable
        pythonPath = path.join(process.resourcesPath, 'python-bin', 'smart-photo-ai', 'smart-photo-ai.exe');
        args = [];
        logger.info(`[PythonService] Starting Bundled Python Backend (Prod): ${pythonPath}`);
    } else {
        // In development, use the venv
        // We assume process.env.APP_ROOT is available by the time this is called
        pythonPath = path.join(process.env.APP_ROOT!, 'src', 'python', '.venv', 'Scripts', 'python.exe');
        const scriptPath = path.join(process.env.APP_ROOT!, 'src', 'python', 'main.py');
        args = [scriptPath];
        logger.info(`[PythonService] Starting Python Backend (Dev): ${pythonPath} ${scriptPath}`);
    }

    pythonProcess = spawn(pythonPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
            ...process.env,
            IS_DEV: app.isPackaged ? 'false' : 'true',
            HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
            LIBRARY_PATH: LIBRARY_PATH,
            LOG_PATH: path.join(app.getPath('userData'), 'logs'),
            PYTORCH_CUDA_ALLOC_CONF: 'expandable_segments:True'
        }
    });

    if (pythonProcess.stdout) {
        // Send initial config after small delay to ensure process is ready
        setTimeout(() => syncInitialSettings(), 2000);

        const reader = createInterface({ input: pythonProcess.stdout });
        reader.on('line', async (line) => {
            try {
                const message = JSON.parse(line);

                // Condensed Logging
                if (message.type === 'cluster_result') {
                    // logger.info(`[Python] Cluster Result: ${message.clusters?.length || 0} clusters found.`);
                    // console.log(`[Python] Received Cluster Result for ${message.photoId || 'Batch'}. Clusters: ${message.clusters?.length}`);
                } else if (message.type === 'search_result') {
                    logger.debug(`[Python] Search Result: ${message.matches?.length || 0} matches found.`);
                } else if (message.type === 'scan_result') {
                    const count = message.faces ? message.faces.length : 0;
                    logger.debug(`[Python] Scan Result: ${message.success ? 'Success' : 'Failed'} for ${message.photoId} (${count} faces).`);
                } else if (message.type === 'analysis_result') {
                    const count = message.faces ? message.faces.length : 0;
                    logger.debug(`[Python] Analysis Result: ${message.photoId} (${count} faces).`);
                } else if (message.type === 'tags_result') {
                    const count = message.tags ? message.tags.length : 0;
                    logger.debug(`[Python] Tags Result: ${message.photoId} (${count} tags).`);
                } else if (message.type === 'download_progress') {
                    // Suppress progress logs
                } else if (message.type === 'thumbnail_result') {
                    // Suppress thumbnail binary data logs
                } else {
                    logger.info('[Python]', message);
                }

                if (mainWindow && (message.type === 'scan_result' || message.type === 'tags_result' || message.type === 'analysis_result')) {
                    mainWindow.webContents.send('ai:scan-result', message);

                    // Log to History & DB Logic
                    const isSuccess = (message.type === 'scan_result' && message.success) ||
                        (message.type === 'analysis_result' && !message.error);

                    if (isSuccess) {
                        try {
                            const db = getDB();

                            // Logic: Persist analysis results
                            if (message.type === 'analysis_result' && message.faces && message.faces.length > 0) {
                                await processAnalysisResult(db, message);
                            }

                            // Log Scan History
                            const metrics = message.metrics || {};
                            const faceCount = message.faces ? message.faces.length : 0;

                            db.prepare(`
                                INSERT INTO scan_history (photo_id, file_path, scan_ms, tag_ms, face_count, scan_mode, status, timestamp)
                                VALUES (?, (SELECT file_path FROM photos WHERE id = ?), ?, ?, ?, ?, 'success', ?)
                            `).run(
                                message.photoId,
                                message.photoId,
                                Math.round(metrics.scan || 0),
                                Math.round(metrics.tag || 0),
                                faceCount,
                                message.scanMode || 'FAST',
                                Date.now()
                            );
                        } catch (e) {
                            logger.error("[Main] Failed to log scan history:", e);
                        }
                    }
                }

                // Shared Promise Resolution
                const resId = message.reqId || message.photoId || (message.payload && message.payload.reqId);

                if (mainWindow && (message.type === 'download_progress' || message.type === 'download_result')) {
                    mainWindow.webContents.send('ai:model-progress', message);
                }

                if (resId && scanPromises.has(resId)) {
                    const promise = scanPromises.get(resId);
                    if (message.error) {
                        promise?.reject(message.error);
                    } else {
                        promise?.resolve(message);
                    }
                    scanPromises.delete(resId);
                }

                // Log Errors
                if ((message.type === 'scan_result' || message.type === 'tags_result') && message.error && message.photoId) {
                    try {
                        const db = getDB();
                        const logError = db.prepare('INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, (SELECT file_path FROM photos WHERE id = ?), ?, ?)');
                        const stage = message.type === 'scan_result' ? 'Face Scan' : 'Smart Tags';
                        logError.run(message.photoId, message.photoId, message.error, stage);
                        logger.info(`[Main] Logged scan error for ${message.photoId}`);
                    } catch (err) {
                        logger.error("[Main] Failed to log auto-error:", err);
                    }
                }

            } catch (e) {
                logger.info('[Python Raw]', line);
            }
        });
    }

    if (pythonProcess.stderr) {
        pythonProcess.stderr.on('data', (data) => {
            const msg = data.toString();
            if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('exception')) {
                logger.error(`[Python Error]: ${msg}`);
            } else {
                logger.info(`[Python Log]: ${msg}`);
            }
        });
    }

    pythonProcess.on('close', (code) => {
        logger.info(`[PythonService] Python process exited with code ${code}`);
        pythonProcess = null;
    });
}

function syncInitialSettings() {
    if (pythonProcess && pythonProcess.stdin) {
        const aiSettings = getAISettings();
        // Determine VLM status based on profile
        const vlmEnabled = aiSettings.aiProfile === 'high';

        // Pass explicit vlmEnabled flag in config payload
        const configPayload = { ...aiSettings, vlmEnabled };

        const configCmd = { type: 'update_config', payload: { config: configPayload } };
        pythonProcess.stdin.write(JSON.stringify(configCmd) + '\n');
        logger.info(`[PythonService] Sent initial config (VLM: ${vlmEnabled})`);
    }
}

// Extracted Helper for DB Logic
async function processAnalysisResult(db: any, message: any) {
    const existingFaces = db.prepare('SELECT id, box_json, person_id FROM faces WHERE photo_id = ?').all(message.photoId);
    const updateFaceStmt = db.prepare('UPDATE faces SET descriptor = ?, box_json = ?, blur_score = ? WHERE id = ?');
    const insertFace = db.prepare(`
        INSERT INTO faces (photo_id, person_id, descriptor, box_json, blur_score, is_reference)
        VALUES (?, ?, ?, ?, ?, 0)
    `);

    const insertedIds: number[] = [];
    const runTransaction = db.transaction(() => {
        for (const face of message.faces) {
            let descriptorBuffer = null;
            if (face.descriptor && Array.isArray(face.descriptor)) {
                descriptorBuffer = Buffer.from(new Float32Array(face.descriptor).buffer);
            }

            // Smart Merge
            let bestMatch = null;
            let maxIoU = 0;

            for (const oldFace of existingFaces) {
                try {
                    const oldBox = JSON.parse(oldFace.box_json);
                    const interX1 = Math.max(face.box.x, oldBox.x);
                    const interY1 = Math.max(face.box.y, oldBox.y);
                    const interX2 = Math.min(face.box.x + face.box.width, oldBox.x + oldBox.width);
                    const interY2 = Math.min(face.box.y + face.box.height, oldBox.y + oldBox.height);

                    const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1);
                    const unionArea = (face.box.width * face.box.height) + (oldBox.width * oldBox.height) - interArea;

                    const iou = unionArea > 0 ? interArea / unionArea : 0;
                    if (iou > 0.5 && iou > maxIoU) {
                        maxIoU = iou;
                        bestMatch = oldFace;
                    }
                } catch (e) { }
            }

            if (bestMatch) {
                updateFaceStmt.run(descriptorBuffer, JSON.stringify(face.box), face.blurScore, bestMatch.id);
                insertedIds.push(bestMatch.id);
            } else {
                const info = insertFace.run(
                    message.photoId,
                    null,
                    descriptorBuffer,
                    JSON.stringify(face.box),
                    face.blurScore
                );
                if (info.changes > 0) {
                    insertedIds.push(Number(info.lastInsertRowid));
                }
            }
        }
    });
    runTransaction();
    logger.info(`[PythonService] Processed ${message.faces.length} faces. (Updated/Inserted: ${insertedIds.length})`);

    // Auto-Match
    if (insertedIds.length > 0) {
        try {
            const settings = getAISettings();
            const threshold = settings.faceSimilarityThreshold || 0.65;
            const matchRes = await autoAssignFaces(insertedIds, threshold);

            if (matchRes.success && (matchRes.count || 0) > 0) {
                logger.info(`[AutoMatch] Automatically assigned ${matchRes.count} faces for photo ${message.photoId} (Threshold: ${threshold})`);
            } else {
                logger.info(`[AutoMatch] No matches found for photo ${message.photoId} at threshold ${threshold}`);
            }
        } catch (amErr) {
            logger.error(`[AutoMatch] Failed for photo ${message.photoId}:`, amErr);
        }
    }
}
