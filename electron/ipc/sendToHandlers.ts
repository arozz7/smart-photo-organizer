import { ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { ConfigService } from '../core/services/ConfigService';
import { ClearFrameTarget } from '../core/services/sendTo/ClearFrameTarget';
import { probeClearFrameInstall, waitForClearFrameWindow } from '../core/services/sendTo/clearFrameInstall';
import { createDbPhotoPathSource } from '../core/services/sendTo/createDbPhotoPathSource';
import { parseSendRequest, parseSendToSettingsUpdate } from '../core/services/sendTo/sendRequestSchema';
import { SendToService, type SendOutcome } from '../core/services/sendTo/SendToService';
import { resolveSendToSettings } from '../core/services/sendTo/sendToSettings';
import { launchDetached } from '../lib/sendTo/launchDetached';
import { listClearFrameWindowTitles } from '../lib/sendTo/listClearFrameWindows';
import logger from '../logger';

const CLEARFRAME_READY_TIMEOUT_MS = 15_000;
const CLEARFRAME_READY_POLL_MS = 250;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const fileExists = (filePath: string) => access(filePath).then(() => true, () => false);
const readSettings = () => resolveSendToSettings(ConfigService.getSettings().sendTo);

function createSendToService(): SendToService {
    const clearFrame = new ClearFrameTarget({
        launch: launchDetached,
        probeInstalledPath: () => probeClearFrameInstall(process.env, existsSync),
        waitUntilReady: () => waitForClearFrameWindow({
            listWindowTitles: listClearFrameWindowTitles,
            now: Date.now,
            sleep,
            timeoutMs: CLEARFRAME_READY_TIMEOUT_MS,
            pollMs: CLEARFRAME_READY_POLL_MS,
        }),
    });

    return new SendToService({
        source: createDbPhotoPathSource(),
        fileExists,
        targets: [clearFrame],
        getSettings: readSettings,
    });
}

/** "Send to..." IPC. Thin: validate the payload, delegate to SendToService, return the outcome. */
export function registerSendToHandlers(): void {
    const service = createSendToService();

    ipcMain.handle('sendTo:getTargets', () => service.listTargets());

    ipcMain.handle('sendTo:send', async (_event, payload: unknown): Promise<SendOutcome> => {
        const request = parseSendRequest(payload);
        if (!request) {
            return { status: 'failed', reason: 'invalid_request', counts: { requested: 0, missing: 0, sent: 0 } };
        }
        try {
            const outcome = await service.send(request);
            // Counts only: file paths are personal data and stay out of the log.
            logger.info({ targetId: request.targetId, status: outcome.status, counts: outcome.counts }, 'Send to finished');
            return outcome;
        } catch (error) {
            logger.error({ error }, 'Send to failed unexpectedly');
            return { status: 'failed', reason: 'launch_failed', counts: { requested: 0, missing: 0, sent: 0 } };
        }
    });

    ipcMain.handle('sendTo:getSettings', () => {
        const { confirmThreshold, clearFrameExecutablePath } = readSettings();
        return { confirmThreshold, clearFrameExecutablePath: clearFrameExecutablePath ?? '' };
    });

    ipcMain.handle('sendTo:updateSettings', (_event, payload: unknown) => {
        const update = parseSendToSettingsUpdate(payload);
        if (!update) return { success: false };
        ConfigService.updateSettings({ sendTo: { ...ConfigService.getSettings().sendTo, ...update } });
        return { success: true };
    });
}
