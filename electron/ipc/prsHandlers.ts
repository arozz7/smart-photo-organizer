import { ipcMain, IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import sharp from 'sharp';
import { readPrsToken } from '../lib/prs/PrsTokenReader';
import { PrsClient } from '../lib/prs/PrsClient';
import { ensurePrsRunning } from '../lib/prs/PrsLauncher';
import { ReferenceRepository } from '../data/repositories/ReferenceRepository';
import { PhotoRepository } from '../data/repositories/PhotoRepository';
import { ConfigService } from '../core/services/ConfigService';
import { scanQueue } from '../scanQueue';
import { pythonProvider } from '../infrastructure/PythonAIProvider';
import logger from '../logger';

/** Lazily create a PrsClient using the current token; returns null if no token found. */
function getClient(): PrsClient | null {
    const token = readPrsToken();
    if (!token) return null;
    return new PrsClient(token);
}

export function registerPrsHandlers(): void {
    /**
     * Check whether PRS is available and healthy.
     * Returns { available: boolean; version?: string }
     */
    ipcMain.handle('prs:checkAvailability', async () => {
        const { prsExecutablePath } = ConfigService.getSettings() as { prsExecutablePath?: string };
        const launchResult = await ensurePrsRunning(prsExecutablePath ?? undefined);
        if (!launchResult.ok) {
            logger.info({ reason: launchResult.reason }, '[prsHandlers] PRS not available');
            return { available: false };
        }
        const token = readPrsToken();
        if (!token) return { available: false };
        return { available: true };
    });

    /**
     * Analyze a file for corruption and return a jobId.
     * Payload: { filePath: string; photoId?: number; sourcePhotoId?: number }
     */
    ipcMain.handle('prs:analyzeFile', async (_event: IpcMainInvokeEvent, payload: unknown) => {
        const { filePath, photoId, sourcePhotoId } = payload as {
            filePath: string;
            photoId?: number;
            sourcePhotoId?: number;
        };

        if (!filePath || typeof filePath !== 'string') {
            return { error: 'filePath is required' };
        }

        const client = getClient();
        if (!client) return { error: 'PRS token not found — is PRS running?' };

        let metadata: Record<string, unknown> | undefined;
        if (photoId != null) {
            try {
                const photo = PhotoRepository.getPhotoById(photoId) as any;
                if (photo?.metadata_json) {
                    metadata = JSON.parse(photo.metadata_json);
                }
            } catch (e) {
                logger.warn({ photoId, error: e }, '[prsHandlers] Failed to load photo metadata');
            }
        }

        return client.analyze({ filePath, metadata, sourcePhotoId });
    });

    /**
     * Poll the status of a PRS job.
     * Payload: { jobId: string }
     */
    ipcMain.handle('prs:pollStatus', async (_event: IpcMainInvokeEvent, payload: unknown) => {
        const { jobId } = payload as { jobId: string };
        if (!jobId || typeof jobId !== 'string') return { error: 'jobId is required' };

        const client = getClient();
        if (!client) return { error: 'PRS token not found' };

        return client.getStatus(jobId);
    });

    /**
     * Submit a repair job for a file using a specific strategy.
     * Payload: { filePath: string; strategy: string; sourcePhotoId?: number; cameraModel?: string; resolution?: string }
     */
    ipcMain.handle('prs:submitRepair', async (_event: IpcMainInvokeEvent, payload: unknown) => {
        const { filePath, strategy, sourcePhotoId, cameraModel, resolution } = payload as {
            filePath: string;
            strategy: string;
            sourcePhotoId?: number;
            cameraModel?: string;
            resolution?: string;
        };

        if (!filePath || typeof filePath !== 'string') return { error: 'filePath is required' };
        if (!strategy || typeof strategy !== 'string') return { error: 'strategy is required' };

        const client = getClient();
        if (!client) return { error: 'PRS token not found' };

        const dir = path.dirname(filePath);
        const ext = path.extname(filePath);
        const basename = path.basename(filePath, ext);
        const outputPath = path.join(dir, `${basename}_repaired${ext}`);

        const candidates = ReferenceRepository.findCandidates({ cameraModel, resolution });
        const candidateReferences = candidates.map(c => c.filePath);

        const repairResult = await client.repair({ filePath, strategy, outputPath, candidateReferences, sourcePhotoId });
        // Return outputPath alongside jobId so the frontend can store it locally;
        // PRS may not echo it back in the status response.
        return { ...repairResult, outputPath };
    });

    /**
     * Verify a repaired file and commit it to the library if verification passes.
     * Payload: { scanErrorId: number; originalPhotoId?: number; repairedFilePath: string }
     */
    ipcMain.handle('prs:completeRepair', async (event: IpcMainInvokeEvent, payload: unknown) => {
        const { scanErrorId, originalPhotoId, repairedFilePath } = payload as {
            scanErrorId: number;
            originalPhotoId?: number;
            repairedFilePath: string;
        };

        if (scanErrorId == null || typeof scanErrorId !== 'number') return { error: 'scanErrorId is required' };
        if (!repairedFilePath || typeof repairedFilePath !== 'string') return { error: 'repairedFilePath is required' };

        // VERIFY STEP 1: Sharp decode
        try {
            await sharp(repairedFilePath).metadata();
        } catch (e) {
            const reason = `Sharp decode failed: ${String(e)}`;
            logger.warn({ scanErrorId, reason }, '[prsHandlers] Repair verification failed (sharp)');
            PhotoRepository.markUnrepairable(scanErrorId, reason);
            return { success: false, unrepairable: true, reason };
        }

        // VERIFY STEP 2: Python AI analysis
        try {
            const aiResult = await pythonProvider.sendRequest('analyze_image', { file_path: repairedFilePath });
            if (!aiResult || aiResult.error) {
                const reason = `AI analysis failed: ${aiResult?.error ?? 'no result'}`;
                logger.warn({ scanErrorId, reason }, '[prsHandlers] Repair verification failed (AI)');
                PhotoRepository.markUnrepairable(scanErrorId, reason);
                return { success: false, unrepairable: true, reason };
            }
        } catch (e) {
            const reason = `AI analysis threw: ${String(e)}`;
            logger.warn({ scanErrorId, reason }, '[prsHandlers] Repair verification failed (AI exception)');
            PhotoRepository.markUnrepairable(scanErrorId, reason);
            return { success: false, unrepairable: true, reason };
        }

        // COMMIT: Remove scan error and stale photo record
        await PhotoRepository.deleteScanErrorAndFile(scanErrorId, false);

        if (originalPhotoId != null) {
            PhotoRepository.deletePhotoById(originalPhotoId);
        }

        // Re-ingest repaired file
        await scanQueue.enqueueFiles([repairedFilePath], {}, event.sender);

        logger.info({ scanErrorId, repairedFilePath }, '[prsHandlers] Repair committed successfully');
        return { success: true };
    });
}
