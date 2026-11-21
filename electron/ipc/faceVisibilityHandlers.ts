import { ipcMain } from 'electron';
import { z } from 'zod';
import logger from '../logger';
import { getFaceVisibilityService } from '../core/services/FaceVisibilityDeps';
import { MAX_AWAY_MINUTES, MIN_AWAY_MINUTES, RUN_MODES, type FaceVisibilityService } from '../core/services/FaceVisibilityService';

export const setModeSchema = z.object({ mode: z.enum(RUN_MODES) }).strict();
export const setAwayMinutesSchema = z.object({ minutes: z.number().int().min(MIN_AWAY_MINUTES).max(MAX_AWAY_MINUTES) }).strict();

/**
 * The channels of a background check's Settings card: `<prefix>:getStatus`, `runNow`, `setMode` and `setAwayMinutes`. The face visibility check
 * (prefix `visibility`) and the picture check (prefix `picturecheck`) are the same service with their own settings.
 */
export function registerCheckHandlers(prefix: string, getService: () => FaceVisibilityService) {
    const fail = (channel: string, error: unknown) => {
        logger.error(`[IPC] ${channel} failed: ${String(error)}`);
        return { success: false, error: String(error) };
    };

    ipcMain.handle(`${prefix}:getStatus`, async () => {
        try {
            return { success: true, status: getService().getStatus() };
        } catch (error) {
            return fail(`${prefix}:getStatus`, error);
        }
    });

    ipcMain.handle(`${prefix}:runNow`, async () => {
        try {
            const service = getService();
            const result = service.runNow();
            return { success: result.started, ...result, status: service.getStatus() };
        } catch (error) {
            return fail(`${prefix}:runNow`, error);
        }
    });

    ipcMain.handle(`${prefix}:setMode`, async (_event, payload: unknown) => {
        const parsed = setModeSchema.safeParse(payload);
        if (!parsed.success) return { success: false, error: 'Invalid request' };
        try {
            const service = getService();
            service.setMode(parsed.data.mode);
            return { success: true, status: service.getStatus() };
        } catch (error) {
            return fail(`${prefix}:setMode`, error);
        }
    });

    ipcMain.handle(`${prefix}:setAwayMinutes`, async (_event, payload: unknown) => {
        const parsed = setAwayMinutesSchema.safeParse(payload);
        if (!parsed.success) return { success: false, error: 'Invalid request' };
        try {
            const service = getService();
            service.setAwayMinutes(parsed.data.minutes);
            return { success: true, status: service.getStatus() };
        } catch (error) {
            return fail(`${prefix}:setAwayMinutes`, error);
        }
    });
}

/** Settings card for the background "is a clear face visible?" check (docs/plans/non-face-and-picture-faces-plan.md, Phase B part 2). */
export function registerFaceVisibilityHandlers() {
    registerCheckHandlers('visibility', getFaceVisibilityService);
}
