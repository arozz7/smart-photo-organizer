import { ipcMain } from 'electron';
import { z } from 'zod';
import logger from '../logger';
import { getPictureSuggestionService } from '../core/services/PictureDeps';
import { MAX_IDS_PER_ACTION, MAX_PAGE_SIZE, PICTURE_LISTS } from '../core/services/PictureSuggestionService';
import { MAX_LIKELIHOOD, MIN_LIKELIHOOD } from '../core/services/visibilityModel';

export const setListSchema = z.object({ list: z.enum(PICTURE_LISTS) }).strict();
export const setLikelihoodSchema = z.object({ percent: z.number().int().min(MIN_LIKELIHOOD).max(MAX_LIKELIHOOD) }).strict();
export const setHideSchema = z.object({ hide: z.boolean() }).strict();
export const listSchema = z.object({
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE),
}).strict();
export const faceIdsSchema = z.object({
    faceIds: z.array(z.number().int().positive()).max(MAX_IDS_PER_ACTION),
}).strict();

const INVALID = { success: false, error: 'Invalid request' };

/** The Pictures? lists in Edge Cases (docs/plans/pictures-suggestions-plan.md, Phase C): `picture:*`. */
export function registerPictureHandlers() {
    const fail = (channel: string, error: unknown) => {
        logger.error(`[IPC] ${channel} failed: ${String(error)}`);
        return { success: false, error: String(error) };
    };

    ipcMain.handle('picture:getOverview', async () => {
        try {
            return { success: true, overview: getPictureSuggestionService().getOverview() };
        } catch (error) {
            return fail('picture:getOverview', error);
        }
    });

    ipcMain.handle('picture:setList', async (_event, payload: unknown) => {
        const parsed = setListSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            const service = getPictureSuggestionService();
            if (!service.setList(parsed.data.list)) return { success: false, error: 'That list does not exist' };
            return { success: true, overview: service.getOverview() };
        } catch (error) {
            return fail('picture:setList', error);
        }
    });

    ipcMain.handle('picture:setLikelihood', async (_event, payload: unknown) => {
        const parsed = setLikelihoodSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            const service = getPictureSuggestionService();
            if (!service.setMinLikelihood(parsed.data.percent)) return { success: false, error: `The likelihood must be between ${MIN_LIKELIHOOD} and ${MAX_LIKELIHOOD} percent` };
            return { success: true, overview: service.getOverview() };
        } catch (error) {
            return fail('picture:setLikelihood', error);
        }
    });

    ipcMain.handle('picture:setHide', async (_event, payload: unknown) => {
        const parsed = setHideSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            const service = getPictureSuggestionService();
            service.setHideFromReview(parsed.data.hide);
            return { success: true, overview: service.getOverview() };
        } catch (error) {
            return fail('picture:setHide', error);
        }
    });

    ipcMain.handle('picture:list', async (_event, payload: unknown) => {
        const parsed = listSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            return { success: true, faces: getPictureSuggestionService().list(parsed.data.offset, parsed.data.limit) };
        } catch (error) {
            return fail('picture:list', error);
        }
    });

    ipcMain.handle('picture:ignore', async (_event, payload: unknown) => {
        const parsed = faceIdsSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            const { ignoredIds } = await getPictureSuggestionService().ignore(parsed.data.faceIds);
            logger.info({ count: ignoredIds.length }, '[Pictures] Ignored suggested pictures');
            return { success: true, ignoredIds };
        } catch (error) {
            return fail('picture:ignore', error);
        }
    });

    ipcMain.handle('picture:keep', async (_event, payload: unknown) => {
        const parsed = faceIdsSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            return { success: true, ...(await getPictureSuggestionService().keep(parsed.data.faceIds)) };
        } catch (error) {
            return fail('picture:keep', error);
        }
    });

    ipcMain.handle('picture:undo', async (_event, payload: unknown) => {
        const parsed = faceIdsSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            return { success: true, ...(await getPictureSuggestionService().undo(parsed.data.faceIds)) };
        } catch (error) {
            return fail('picture:undo', error);
        }
    });
}
