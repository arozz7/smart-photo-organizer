import { ipcMain } from 'electron';
import { z } from 'zod';
import logger from '../logger';
import { getFaceVisibilityService } from '../core/services/FaceVisibilityDeps';
import { MAX_AWAY_MINUTES, MIN_AWAY_MINUTES, RUN_MODES } from '../core/services/FaceVisibilityService';

export const setModeSchema = z.object({ mode: z.enum(RUN_MODES) }).strict();
export const setAwayMinutesSchema = z.object({ minutes: z.number().int().min(MIN_AWAY_MINUTES).max(MAX_AWAY_MINUTES) }).strict();

/** Settings card for the background "is a clear face visible?" check (docs/plans/non-face-and-picture-faces-plan.md, Phase B part 2). */
export function registerFaceVisibilityHandlers() {
    ipcMain.handle('visibility:getStatus', async () => {
        try {
            return { success: true, status: getFaceVisibilityService().getStatus() };
        } catch (error) {
            logger.error(`[IPC] visibility:getStatus failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('visibility:runNow', async () => {
        try {
            const service = getFaceVisibilityService();
            const result = service.runNow();
            return { success: result.started, ...result, status: service.getStatus() };
        } catch (error) {
            logger.error(`[IPC] visibility:runNow failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('visibility:setMode', async (_event, payload: unknown) => {
        const parsed = setModeSchema.safeParse(payload);
        if (!parsed.success) return { success: false, error: 'Invalid request' };
        try {
            const service = getFaceVisibilityService();
            service.setMode(parsed.data.mode);
            return { success: true, status: service.getStatus() };
        } catch (error) {
            logger.error(`[IPC] visibility:setMode failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('visibility:setAwayMinutes', async (_event, payload: unknown) => {
        const parsed = setAwayMinutesSchema.safeParse(payload);
        if (!parsed.success) return { success: false, error: 'Invalid request' };
        try {
            const service = getFaceVisibilityService();
            service.setAwayMinutes(parsed.data.minutes);
            return { success: true, status: service.getStatus() };
        } catch (error) {
            logger.error(`[IPC] visibility:setAwayMinutes failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });
}
