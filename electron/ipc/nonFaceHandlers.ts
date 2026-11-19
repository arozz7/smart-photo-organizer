import { ipcMain } from 'electron';
import { z } from 'zod';
import logger from '../logger';
import { getNonFaceService } from '../core/services/NonFaceDeps';
import { MAX_IDS_PER_ACTION, MAX_PAGE_SIZE, MAX_CUTOFF, MIN_CUTOFF } from '../core/services/NonFaceSuggestionService';

export const setCutoffSchema = z.object({ cutoff: z.number().finite() }).strict();
export const listSchema = z.object({
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE),
}).strict();
export const faceIdsSchema = z.object({
    faceIds: z.array(z.number().int().positive()).max(MAX_IDS_PER_ACTION),
}).strict();

/** The "Not a face (suggested)" list in Edge Cases (docs/plans/non-face-and-picture-faces-plan.md, Phase B). */
export function registerNonFaceHandlers() {
    ipcMain.handle('nonface:getOverview', async () => {
        try {
            return { success: true, overview: getNonFaceService().getOverview() };
        } catch (error) {
            logger.error(`[IPC] nonface:getOverview failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('nonface:setCutoff', async (_event, payload: unknown) => {
        const parsed = setCutoffSchema.safeParse(payload);
        if (!parsed.success) return { success: false, error: 'Invalid request' };
        try {
            const service = getNonFaceService();
            if (!service.setCutoff(parsed.data.cutoff)) return { success: false, error: `The cut-off must be between ${MIN_CUTOFF} and ${MAX_CUTOFF}` };
            return { success: true, overview: service.getOverview() };
        } catch (error) {
            logger.error(`[IPC] nonface:setCutoff failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('nonface:list', async (_event, payload: unknown) => {
        const parsed = listSchema.safeParse(payload);
        if (!parsed.success) return { success: false, error: 'Invalid request' };
        try {
            return { success: true, faces: getNonFaceService().list(parsed.data.offset, parsed.data.limit) };
        } catch (error) {
            logger.error(`[IPC] nonface:list failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('nonface:ignore', async (_event, payload: unknown) => {
        const parsed = faceIdsSchema.safeParse(payload);
        if (!parsed.success) return { success: false, error: 'Invalid request' };
        try {
            const { ignoredIds } = getNonFaceService().ignore(parsed.data.faceIds);
            logger.info({ count: ignoredIds.length }, '[NonFace] Ignored suggested faces');
            return { success: true, ignoredIds };
        } catch (error) {
            logger.error(`[IPC] nonface:ignore failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('nonface:keep', async (_event, payload: unknown) => {
        const parsed = faceIdsSchema.safeParse(payload);
        if (!parsed.success) return { success: false, error: 'Invalid request' };
        try {
            return { success: true, ...getNonFaceService().keep(parsed.data.faceIds) };
        } catch (error) {
            logger.error(`[IPC] nonface:keep failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('nonface:undo', async (_event, payload: unknown) => {
        const parsed = faceIdsSchema.safeParse(payload);
        if (!parsed.success) return { success: false, error: 'Invalid request' };
        try {
            return { success: true, ...getNonFaceService().undo(parsed.data.faceIds) };
        } catch (error) {
            logger.error(`[IPC] nonface:undo failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });
}
