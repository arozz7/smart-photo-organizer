import { ipcMain } from 'electron';
import { z } from 'zod';
import logger from '../logger';
import { getProfileMatchService } from '../core/services/ProfileMatchDeps';
import {
    MAX_DISTANCE, MAX_PAGE_SIZE, MAX_PAIRS_PER_ACTION, MAX_YAW_ALLOWED, MIN_DISTANCE, MIN_YAW_ALLOWED,
} from '../core/services/ProfileMatchService';

export const setDistanceSchema = z.object({ distance: z.number().finite() }).strict();
export const setMinYawSchema = z.object({ degrees: z.number().finite() }).strict();
export const listSchema = z.object({
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE),
    personId: z.number().int().positive().optional(),
}).strict();
export const pairsSchema = z.object({
    pairs: z.array(z.object({ faceId: z.number().int().positive(), personId: z.number().int().positive() }).strict()).max(MAX_PAIRS_PER_ACTION),
}).strict();
export const faceIdsSchema = z.object({
    faceIds: z.array(z.number().int().positive()).max(MAX_PAIRS_PER_ACTION),
}).strict();

const INVALID = { success: false, error: 'Invalid request' };

/** The "Turned faces" list in Edge Cases (docs/plans/profile-suggestions-plan.md, Phase F1). */
export function registerProfileHandlers() {
    const fail = (channel: string, error: unknown) => {
        logger.error(`[IPC] ${channel} failed: ${String(error)}`);
        return { success: false, error: String(error) };
    };

    ipcMain.handle('profile:getOverview', async () => {
        try {
            return { success: true, overview: getProfileMatchService().getOverview() };
        } catch (error) {
            return fail('profile:getOverview', error);
        }
    });

    ipcMain.handle('profile:refresh', async () => {
        try {
            const service = getProfileMatchService();
            service.refresh();
            return { success: true, overview: service.getOverview() };
        } catch (error) {
            return fail('profile:refresh', error);
        }
    });

    ipcMain.handle('profile:setDistance', async (_event, payload: unknown) => {
        const parsed = setDistanceSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            const service = getProfileMatchService();
            if (!service.setDistance(parsed.data.distance)) return { success: false, error: `The distance must be between ${MIN_DISTANCE} and ${MAX_DISTANCE}` };
            return { success: true, overview: service.getOverview() };
        } catch (error) {
            return fail('profile:setDistance', error);
        }
    });

    ipcMain.handle('profile:setMinYaw', async (_event, payload: unknown) => {
        const parsed = setMinYawSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            const service = getProfileMatchService();
            if (!service.setMinYaw(parsed.data.degrees)) return { success: false, error: `The angle must be between ${MIN_YAW_ALLOWED} and ${MAX_YAW_ALLOWED} degrees` };
            return { success: true, overview: service.getOverview() };
        } catch (error) {
            return fail('profile:setMinYaw', error);
        }
    });

    ipcMain.handle('profile:list', async (_event, payload: unknown) => {
        const parsed = listSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            return { success: true, rows: getProfileMatchService().list(parsed.data.offset, parsed.data.limit, parsed.data.personId) };
        } catch (error) {
            return fail('profile:list', error);
        }
    });

    ipcMain.handle('profile:assign', async (_event, payload: unknown) => {
        const parsed = pairsSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            const result = await getProfileMatchService().assign(parsed.data.pairs);
            logger.info({ count: result.assigned.length }, '[ProfileMatch] Assigned suggested faces');
            return { success: true, ...result };
        } catch (error) {
            return fail('profile:assign', error);
        }
    });

    ipcMain.handle('profile:dismiss', async (_event, payload: unknown) => {
        const parsed = pairsSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            return { success: true, ...(await getProfileMatchService().dismiss(parsed.data.pairs)) };
        } catch (error) {
            return fail('profile:dismiss', error);
        }
    });

    ipcMain.handle('profile:undo', async (_event, payload: unknown) => {
        const parsed = faceIdsSchema.safeParse(payload);
        if (!parsed.success) return INVALID;
        try {
            return { success: true, ...(await getProfileMatchService().undo(parsed.data.faceIds)) };
        } catch (error) {
            return fail('profile:undo', error);
        }
    });
}
