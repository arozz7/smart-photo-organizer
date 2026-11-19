import { ipcMain } from 'electron';
import { z } from 'zod';
import logger from '../logger';
import { getRematchService } from '../core/services/RematchDeps';
import { MAX_DISTANCE, MIN_DISTANCE } from '../core/services/RematchService';

const setAutoSchema = z.object({ enabled: z.boolean() }).strict();
/** A number pins the distance; null goes back to following the Auto-Assign setting. */
const setDistanceSchema = z.object({ distance: z.number().finite().nullable() }).strict();

/** Settings card for the background re-match of unassigned faces (docs/plans/review-queue-parking-plan.md, Phase 2). */
export function registerRematchHandlers() {
    ipcMain.handle('rematch:getStatus', async () => {
        try {
            return { success: true, status: getRematchService().getStatus() };
        } catch (error) {
            logger.error(`[IPC] rematch:getStatus failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('rematch:run', async () => {
        try {
            const result = getRematchService().startRun();
            return { success: result.started, ...result, status: getRematchService().getStatus() };
        } catch (error) {
            logger.error(`[IPC] rematch:run failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('rematch:undo', async () => {
        try {
            const undone = getRematchService().undo();
            return { success: true, undone, status: getRematchService().getStatus() };
        } catch (error) {
            logger.error(`[IPC] rematch:undo failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('rematch:setDistance', async (_event, payload: unknown) => {
        const parsed = setDistanceSchema.safeParse(payload);
        if (!parsed.success) return { success: false, error: 'Invalid request' };
        try {
            const accepted = getRematchService().setDistance(parsed.data.distance);
            if (!accepted) return { success: false, error: `The distance must be between ${MIN_DISTANCE} and ${MAX_DISTANCE}` };
            return { success: true, status: getRematchService().getStatus() };
        } catch (error) {
            logger.error(`[IPC] rematch:setDistance failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('rematch:setAuto', async (_event, payload: unknown) => {
        const parsed = setAutoSchema.safeParse(payload);
        if (!parsed.success) return { success: false, error: 'Invalid request' };
        try {
            getRematchService().setAutoEnabled(parsed.data.enabled);
            return { success: true, status: getRematchService().getStatus() };
        } catch (error) {
            logger.error(`[IPC] rematch:setAuto failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });
}
