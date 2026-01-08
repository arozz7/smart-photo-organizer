import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import logger from '../logger';
import { IAIProvider } from '../core/interfaces/IAIProvider';
import { FaceService } from '../core/services/FaceService';
import { PhotoRepository } from '../data/repositories/PhotoRepository';
import { getAISettings, getLibraryPath } from '../store'; // ConfigService later

export class PythonAIProvider implements IAIProvider {
    private process: ChildProcess | null = null;
    private mainWindow: BrowserWindow | null = null;
    private scanPromises = new Map<number, { resolve: (v: any) => void, reject: (err: any) => void }>();

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
                if (msg.toLowerCase().includes('error')) logger.error(`[Python Error] ${msg}`);
                else logger.info(`[Python Log] ${msg}`);
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
                await FaceService.processAnalysisResult(message.photoId, message.faces, message.width, message.height, this);
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

        // 2. Notify UI
        if (this.mainWindow && ['scan_result', 'tags_result', 'analysis_result'].includes(message.type)) {
            this.mainWindow.webContents.send('ai:scan-result', message);
        }
        if (this.mainWindow && ['download_progress', 'download_result'].includes(message.type)) {
            this.mainWindow.webContents.send('ai:model-progress', message);
        }
    }

    stop() {
        if (this.process) {
            logger.info('[PythonAIProvider] Stopping Python Backend...');
            this.process.kill();
            this.process = null;
        }
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

    sendRequest(type: string, payload: any, timeoutMs = 30000): Promise<any> {
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
        return this.sendRequest('analyze_image', { filePath, ...options });
    }

    async clusterFaces(faces: { id: number; descriptor: number[]; }[], eps?: number, minSamples?: number, timeoutMs = 300000): Promise<any> {
        return this.sendRequest('cluster_faces', { faces, eps, minSamples }, timeoutMs);
    }

    async searchFaces(descriptors: number[][], k?: number, threshold?: number, timeoutMs = 60000): Promise<{ id: number; distance: number; }[][]> {
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
        return this.sendRequest('get_system_status', options, 5000);
    }

    // Custom helper
    addToIndex(faces: { id: number, descriptor: number[] }[]) {
        this.sendCommand('add_faces_to_vector_index', { faces });
    }
}

export const pythonProvider = new PythonAIProvider();
