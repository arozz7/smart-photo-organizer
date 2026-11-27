import { ipcMain } from 'electron';
import { z } from 'zod';
import logger from '../logger';
import { getDoubtfulFaceService } from '../core/services/DoubtfulFaceDeps';
import { MAX_ALLOWED_SCORE, MAX_IDS_PER_ACTION, MAX_PAGE_SIZE, MIN_ALLOWED_SCORE } from '../core/services/DoubtfulFaceService';

export const setMinScoreSchema = z.object({ score: z.number().int().min(MIN_ALLOWED_SCORE).max(MAX_ALLOWED_SCORE) }).strict();
export const listSchema = z.object({
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE),
    personId: z.number().int().positive().nullable().optional(),
}).strict();
export const faceIdsSchema = z.object({
    faceIds: z.array(z.number().int().positive()).max(MAX_IDS_PER_ACTION),
}).strict();

const INVALID = { success: false, error: 'Invalid request' };

/** The Doubtful faces list (faces assigned to people that the vision check says show no clear face): `doubtful:*`. */
export function registerDoubtfulHandlers() {
    const fail = (channel: string, error: unknown) => {
        logger.error(`[IPC] ${channel} failed: ${String(error)}`);
        return { success: false, error: String(error) };
    };

    ipcMain.handle('doubtful:getOverview', async () => {
        try {
            return { success: true, overview: getDoubtfulFaceService().getOverview() };
        } catch (error) {
            return fail('doubtful:getOverview', error);
        }
    });

    ipcMain.handle('doubtful:setMinScore', async (_event, payload: unknown) => {
        const parsed = setMinScoreSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            const service = getDoubtfulFaceService();
            if (!service.setMinScore(parsed.data.score)) return { success: false, error: `The cut-off must be a whole number from ${MIN_ALLOWED_SCORE} to ${MAX_ALLOWED_SCORE}` };
            return { success: true, overview: service.getOverview() };
        } catch (error) {
            return fail('doubtful:setMinScore', error);
        }
    });

    ipcMain.handle('doubtful:list', async (_event, payload: unknown) => {
        const parsed = listSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            return { success: true, faces: getDoubtfulFaceService().list(parsed.data.offset, parsed.data.limit, parsed.data.personId ?? null) };
        } catch (error) {
            return fail('doubtful:list', error);
        }
    });

    ipcMain.handle('doubtful:ignore', async (_event, payload: unknown) => {
        const parsed = faceIdsSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            const { changedIds } = await getDoubtfulFaceService().ignore(parsed.data.faceIds);
            logger.info({ count: changedIds.length }, '[Doubtful] Ignored doubtful faces');
            return { success: true, changedIds };
        } catch (error) {
            return fail('doubtful:ignore', error);
        }
    });

    ipcMain.handle('doubtful:unassign', async (_event, payload: unknown) => {
        const parsed = faceIdsSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            const { changedIds } = await getDoubtfulFaceService().unassign(parsed.data.faceIds);
            logger.info({ count: changedIds.length }, '[Doubtful] Moved doubtful faces back to suggestions');
            return { success: true, changedIds };
        } catch (error) {
            return fail('doubtful:unassign', error);
        }
    });

    ipcMain.handle('doubtful:keep', async (_event, payload: unknown) => {
        const parsed = faceIdsSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            return { success: true, ...(await getDoubtfulFaceService().keep(parsed.data.faceIds)) };
        } catch (error) {
            return fail('doubtful:keep', error);
        }
    });

    ipcMain.handle('doubtful:undo', async (_event, payload: unknown) => {
        const parsed = faceIdsSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            return { success: true, ...(await getDoubtfulFaceService().undo(parsed.data.faceIds)) };
        } catch (error) {
            return fail('doubtful:undo', error);
        }
    });
}
