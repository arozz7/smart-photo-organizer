import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import logger from '../logger';
import { IService } from '../core/interfaces/IService';
import { IAIProvider } from '../core/interfaces/IAIProvider';
import { FaceService } from '../core/services/FaceService';
import { PhotoRepository } from '../data/repositories/PhotoRepository';
import { ConfigService } from '../core/services/ConfigService';
import { getAISettings, getLibraryPath } from '../store'; // ConfigService later

export class PythonAIProvider implements IAIProvider, IService {
    private process: ChildProcess | null = null;
    private mainWindow: BrowserWindow | null = null;
    private scanPromises = new Map<number, { resolve: (v: any) => void, reject: (err: any) => void }>();
    private isShuttingDown = false;

    // [Phase 65] HTTP fallback for standalone backend mode
    private httpFallbackEnabled = false;
    private apiBaseUrl = 'http://localhost:3001';
    private standaloneCheckDone = false;

    constructor() { }

    setMainWindow(win: BrowserWindow) {
        this.mainWindow = win;
    }

    async start() {
        let pythonPath: string;
        let args: string[];

        // This relies on getLibraryPath logic which was in store.ts. 
        // We will assume it's passed or available. 
        // For now importing store.
        const LIBRARY_PATH = getLibraryPath();

        if (app.isPackaged) {
            pythonPath = path.join(process.resourcesPath, 'python-bin', 'smart-photo-ai', 'smart-photo-ai.exe');
            args = [];
        } else {
            pythonPath = path.join(process.env.APP_ROOT!, 'src', 'python', '.venv', 'Scripts', 'python.exe');
            const scriptPath = path.join(process.env.APP_ROOT!, 'src', 'python', 'main.py');
            args = [scriptPath];
        }

        logger.info(`[PythonAIProvider] Starting Python Backend: ${pythonPath}`);

        this.process = spawn(pythonPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                API_MODE: undefined, // [Phase 65] Ensure IPC mode, not HTTP
                IS_DEV: app.isPackaged ? 'false' : 'true',
                HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
                LIBRARY_PATH: LIBRARY_PATH,
                LOG_PATH: path.join(app.getPath('userData'), 'logs'),
                PYTORCH_CUDA_ALLOC_CONF: 'expandable_segments:True'
            }
        });

        this.setupListeners();

        // Initial Config
        setTimeout(() => this.syncSettings(), 2000);
    }

    private setupListeners() {
        if (!this.process) return;

        if (this.process.stdout) {
            const reader = createInterface({ input: this.process.stdout });
            reader.on('line', async (line) => {
                try {
                    const message = JSON.parse(line);
                    this.handleMessage(message);
                } catch (e) {
                    logger.info('[Python Raw]', line);
                }
            });
        }

        if (this.process.stderr) {
            this.process.stderr.on('data', (data) => {
                const msg = data.toString();
                if (msg.toLowerCase().includes('error')) {
                    logger.error(`[Python Error] ${msg}`);
                } else {
                    // Filter noisy logs
                    if (msg.includes('Applied providers:')) {
                        logger.debug(`[Python Debug] ${msg}`);
                        // Extract just the providers list for INFO
                        const providersMatch = msg.match(/Applied providers: (\[.*?\])/);
                        if (providersMatch) {
                            logger.info(`[Python Log] Applied providers: ${providersMatch[1]}`);
                        } else {
                            logger.info(`[Python Log] Applied providers (details in debug)`);
                        }
                    } else if (msg.includes('model ignore:')) {
                        logger.debug(`[Python Debug] ${msg}`);
                        // Summarize
                        const parts = msg.split('model ignore:');
                        const details = parts[1] || '';
                        // Try to get model name/path
                        logger.info(`[Python Log] Model ignored: ${details.trim().split(' ')[0]}...`);
                    } else if (msg.includes('find model:')) {
                        logger.debug(`[Python Debug] ${msg}`);
                        const parts = msg.split('find model:');
                        const details = parts[1] || '';
                        logger.info(`[Python Log] Found model: ${details.trim().split(' ')[0]}...`);
                    } else {
                        logger.info(`[Python Log] ${msg}`);
                    }
                }
            });
        }

        this.process.on('close', (code) => {
            logger.warn(`Python process exited with code ${code}`);
            this.process = null;
        });
    }

    private async handleMessage(message: any) {
        // 1. Resolve Promises
        const resId = message.reqId || message.photoId || (message.payload && message.payload.reqId);
        if (resId && this.scanPromises.has(resId)) {
            const p = this.scanPromises.get(resId);
            if (message.error) p?.reject(message.error);
            else p?.resolve(message);
            this.scanPromises.delete(resId);
        }

        // 3. Process Logic (Delegated to Services)
        if (message.type === 'analysis_result') {
            if (!message.error && message.faces && message.faces.length > 0) {
                // Extract session data for Phase P2
                const sessionFolder = message.filePath ? path.dirname(message.filePath) : undefined;
                // Try to extract date from photo metadata if available
                let sessionDate: string | undefined;
                try {
                    const photo = PhotoRepository.getPhotoById(message.photoId);
                    if (photo?.metadata_json) {
                        const meta = JSON.parse(photo.metadata_json);
                        // Common EXIF date fields
                        sessionDate = meta.DateTimeOriginal || meta.CreateDate || meta.MediaCreateDate;
                        // Convert to ISO date string if present
                        if (sessionDate && typeof sessionDate === 'string') {
                            sessionDate = sessionDate.split(' ')[0].replace(/:/g, '-');
                        }
                    }
                } catch (e) { /* ignore metadata parse errors */ }

                await FaceService.processAnalysisResult(
                    message.photoId,
                    message.faces,
                    message.width,
                    message.height,
                    this,
                    { sessionFolder, sessionDate }
                );
            }

            // Save global blur score, description, and pHash to photos table
            try {
                const photoUpdates: { blur_score?: number; description?: string; phash?: string } = {};
                if (message.globalBlurScore !== undefined && message.globalBlurScore !== null) {
                    photoUpdates.blur_score = message.globalBlurScore;
                }
                if (message.description) {
                    photoUpdates.description = message.description;
                }
                if (message.phash) {
                    photoUpdates.phash = message.phash;
                }
                if (Object.keys(photoUpdates).length > 0) {
                    PhotoRepository.updatePhoto(message.photoId, photoUpdates);
                }
            } catch (e) {
                logger.error('[Main] Failed to save photo blur_score/description/phash:', e);
            }

            // Record Scan History for Metrics
            try {
                const metrics = message.metrics || {};
                logger.info(`[Metrics] Recording history for photo ${message.photoId}`);
                PhotoRepository.recordScanHistory({
                    photoId: message.photoId,
                    filePath: message.filePath || '',
                    scanMs: metrics.scan || metrics.total || 0,
                    tagMs: metrics.tag || 0,
                    faceCount: (message.faces ? message.faces.length : 0),
                    scanMode: message.payload?.scanMode || 'FAST',
                    status: message.error ? 'error' : 'success',
                    error: message.error
                });
            } catch (e) {
                logger.error('[Main] Failed to record scan history:', e);
            }
        }


        // Check shutdown state before attempting to send to UI
        if (this.isShuttingDown || !this.mainWindow || this.mainWindow.isDestroyed()) {
            return;
        }

        // 2. Notify UI
        if (this.mainWindow && ['scan_result', 'tags_result', 'analysis_result'].includes(message.type)) {
            this.mainWindow.webContents.send('ai:scan-result', message);
        }
        if (this.mainWindow && ['download_progress', 'download_result'].includes(message.type)) {
            this.mainWindow.webContents.send('ai:model-progress', message);
        }
    }

    stop() {
        this.isShuttingDown = true;
        if (this.process) {
            logger.info('[PythonAIProvider] Stopping Python Backend...');
            this.process.kill();
            this.process = null;
        }
        this.mainWindow = null;

        // Reject any pending promises
        this.scanPromises.forEach(p => p.reject(new Error('Shutdown')));
        this.scanPromises.clear();
    }

    syncSettings() {
        const aiSettings = getAISettings();
        const vlmEnabled = aiSettings.aiProfile === 'high';
        this.sendCommand('update_config', { config: { ...aiSettings, vlmEnabled } });
    }

    sendCommand(type: string, payload: any) {
        if (this.process && this.process.stdin) {
            this.process.stdin.write(JSON.stringify({ type, payload }) + '\n');
        }
    }

    // [Phase 65] Check if standalone backend is running (HTTP mode)
    async checkStandaloneBackend(): Promise<boolean> {
        if (this.standaloneCheckDone) return this.httpFallbackEnabled;

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000);

            const response = await fetch(`${this.apiBaseUrl}/api/v1/health`, {
                method: 'GET',
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (response.ok) {
                logger.info('[PythonAIProvider] Standalone backend detected at ' + this.apiBaseUrl);
                this.httpFallbackEnabled = true;
            }
        } catch {
            // Standalone not available - use IPC mode
            this.httpFallbackEnabled = false;
        }

        this.standaloneCheckDone = true;
        return this.httpFallbackEnabled;
    }

    // [Phase 65] Send HTTP request to standalone backend
    private async sendHttpRequest(type: string, payload: any, timeoutMs: number): Promise<any> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            // Map command types to API endpoints
            let endpoint = '/api/v1/command';
            let method = 'POST';
            let body: string | undefined = JSON.stringify({ type, ...payload });

            // Debug-specific endpoints
            if (type === 'analyze_image') {
                endpoint = '/api/v1/debug/detect-faces';
                body = JSON.stringify({ imagePath: payload.filePath, ...payload });
            } else if (type === 'get_system_status') {
                endpoint = '/api/v1/status';
                method = 'GET';
                body = undefined;
            } else if (type === 'health_check') {
                endpoint = '/api/v1/health';
                method = 'GET';
                body = undefined;
            } else if (type === 'update_config') {
                endpoint = '/api/v1/debug/config';
                body = JSON.stringify(payload.config || payload);
            }

            const response = await fetch(`${this.apiBaseUrl}${endpoint}`, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body,
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } finally {
            clearTimeout(timeout);
        }
    }

    sendRequest(type: string, payload: any, timeoutMs = 120000): Promise<any> {
        // [Phase 65] Use HTTP if standalone backend is running
        if (this.httpFallbackEnabled) {
            return this.sendHttpRequest(type, payload, timeoutMs);
        }

        // Default: IPC mode
        return new Promise((resolve, reject) => {
            const requestId = Math.floor(Math.random() * 1000000);
            this.scanPromises.set(requestId, { resolve, reject });
            this.sendCommand(type, { ...payload, reqId: requestId });
            setTimeout(() => {
                if (this.scanPromises.has(requestId)) {
                    this.scanPromises.delete(requestId);
                    reject('Timeout');
                }
            }, timeoutMs);
        });
    }

    // IAIProvider Implementation
    async analyzeImage(filePath: string, options?: any): Promise<any> {
        const settings = ConfigService.getSettings();
        // Inject advanced settings
        const payload = {
            filePath,
            config: settings.advancedFace,
            ...options
        };
        return this.sendRequest('analyze_image', payload);
    }

    async clusterFaces(
        faces: { id: number; descriptor: number[]; pose_yaw?: number | null }[],
        eps?: number,
        minSamples?: number,
        anchorOnlyFrontal = false,
        timeoutMs = 900000
    ): Promise<any> {
        return this.sendRequest('cluster_faces', { faces, eps, minSamples, anchor_only_frontal: anchorOnlyFrontal }, timeoutMs);
    }

    async searchFaces(descriptors: number[][], k?: number, threshold?: number, timeoutMs = 300000): Promise<{ id: number; distance: number; }[][]> {
        const res = await this.sendRequest('batch_search_index', { descriptors, k, threshold }, timeoutMs);
        if (res.error) throw new Error(res.error);
        return res.results;
    }

    async generateThumbnail(filePath: string, options?: any): Promise<any> {
        return this.sendRequest('generate_thumbnail', { filePath, ...options });
    }

    async rotateImage(_filePath: string, _rotation: number): Promise<any> {
        return Promise.resolve();
    }

    async checkStatus(options: any = {}): Promise<any> {
        return this.sendRequest('get_system_status', options, 15000);
    }

    // Custom helper
    addToIndex(faces: { id: number, descriptor: number[] }[]) {
        this.sendCommand('add_faces_to_vector_index', { faces });
    }

    /**
     * Extract age and pose from a face crop for age/pose backfill.
     * Used by BackgroundAgeRescanService.
     */
    async extractAgeFromFace(faceData: {
        faceId: number;
        photoId: number;
        filePath: string;
        previewPath: string | null;
        box: string;
    }): Promise<{
        age: number | null;
        gender: string | null;
        poseYaw: number | null;
        posePitch: number | null;
        poseRoll: number | null;
        descriptorV2: number[] | null;
        failureReason: string | null
    }> {
        try {
            const result = await this.sendRequest('extract_age', {
                faceId: faceData.faceId,
                photoId: faceData.photoId,
                filePath: faceData.filePath,
                previewPath: faceData.previewPath,
                box: faceData.box
            }, 30000);

            if (result.error) {
                throw new Error(result.error);
            }

            return {
                age: result.age ?? null,
                gender: result.gender ?? null,
                poseYaw: result.poseYaw ?? null,
                posePitch: result.posePitch ?? null,
                poseRoll: result.poseRoll ?? null,
                descriptorV2: result.descriptorV2 ?? null,
                failureReason: result.failureReason ?? null
            };
        } catch (e) {
            // Don't log error for expected shutdown
            const msg = e instanceof Error ? e.message : String(e);
            if (!msg.includes('Shutdown')) {
                logger.error(`[PythonAIProvider] extractAgeFromFace failed:`, e);
            }
            return { age: null, gender: null, poseYaw: null, posePitch: null, poseRoll: null, descriptorV2: null, failureReason: `exception:${msg.slice(0, 50)}` };
        }
    }

    /**
     * Verify if a detected region is actually a human face using VLM.
     * Used by BackgroundVerificationService (Phase 56).
     */
    async verifyFace(imagePath: string, box: { x1: number; y1: number; x2: number; y2: number }): Promise<{
        is_face: boolean | null;
        confidence: number;
        reason?: string;
        suggested_metadata?: { gender?: string; age?: number };
        error?: string;
    }> {
        try {
            const result = await this.sendRequest('verify_face', {
                imagePath,
                box
            }, 120000);

            if (result.error) {
                return {
                    is_face: null,
                    confidence: 0,
                    error: result.error
                };
            }

            return {
                is_face: result.is_face ?? null,
                confidence: result.confidence ?? 0,
                reason: result.reason,
                suggested_metadata: result.suggested_metadata,
                error: result.error
            };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (!msg.includes('Shutdown')) {
                logger.error(`[PythonAIProvider] verifyFace failed:`, e);
            }
            return {
                is_face: null,
                confidence: 0,
                error: `exception:${msg.slice(0, 50)}`
            };
        }
    }

    /**
     * [Phase 58] Re-run face detection on a specific region to count/split faces.
     * Used when aspect ratio filter flags a potential multi-face box.
     */
    async detectFacesInRegion(
        filePath: string,
        box: { x: number; y: number; width: number; height: number },
        options: {
            orientation?: number;
            detThreshold?: number;
            detSize?: [number, number];
        } = {}
    ): Promise<{
        faceCount: number;
        faces: Array<{
            box: { x: number; y: number; width: number; height: number };
            score: number;
            embedding: number[] | null;
        }>;
        error?: string;
    }> {
        try {
            const { orientation = 1, detThreshold = 0.5, detSize } = options;

            const result = await this.sendRequest('detect_faces_in_region', {
                filePath,
                box,
                orientation,
                detThreshold,
                detSize
            }, 30000);

            if (result.error) {
                return {
                    faceCount: 0,
                    faces: [],
                    error: result.error
                };
            }

            return {
                faceCount: result.faceCount ?? 0,
                faces: result.faces ?? [],
                error: result.error
            };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (!msg.includes('Shutdown')) {
                logger.error(`[PythonAIProvider] detectFacesInRegion failed:`, e);
            }
            return {
                faceCount: 0,
                faces: [],
                error: `exception:${msg.slice(0, 50)}`
            };
        }
    }
}

export const pythonProvider = new PythonAIProvider();
