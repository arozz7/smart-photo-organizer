/**
 * Photo Adjustment IPC handlers — Phase 117.
 *
 * Channel: ai:segment:adjust
 *
 * Validates the payload and forwards it to the Python backend's
 * `segment_adjust` command. Returns the adjusted image as a base64 PNG.
 */

import { ipcMain } from 'electron';
import { z } from 'zod';
import { pythonProvider } from '../infrastructure/PythonAIProvider';
import logger from '../logger';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const AdjustmentParamsSchema = z.object({
    temperature:  z.number().min(-1).max(1).optional(),
    black_point:  z.number().int().min(0).max(200).optional(),
    white_point:  z.number().int().min(55).max(255).optional(),
    brightness:   z.number().min(0).max(2).optional(),
    contrast:     z.number().min(0).max(2).optional(),
    shadows:      z.number().min(-1).max(1).optional(),
    highlights:   z.number().min(-1).max(1).optional(),
});

const AdjustPayloadSchema = z.object({
    image_b64:      z.string().min(1, 'image_b64 is required'),
    scope:          z.enum(['global', 'segment']).default('global'),
    mask_b64:       z.string().optional(),
    invert_mask:    z.boolean().default(false),
    feather_radius: z.number().int().min(0).max(50).default(0),
    params:         AdjustmentParamsSchema.optional(),
});

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerAdjustmentHandlers(): void {
    ipcMain.handle('ai:segment:adjust', async (_, rawPayload: unknown) => {
        const parsed = AdjustPayloadSchema.safeParse(rawPayload ?? {});

        if (!parsed.success) {
            const firstIssue = parsed.error.issues[0];
            const field = firstIssue?.path.join('.') ?? 'payload';
            const msg = `Invalid ${field}: ${firstIssue?.message ?? 'validation failed'}`;
            logger.error({ issues: parsed.error.issues }, 'ai:segment:adjust validation error');
            return { success: false, error: msg };
        }

        const payload = parsed.data;

        if (payload.scope === 'segment' && !payload.mask_b64) {
            return { success: false, error: 'mask_b64 is required when scope is segment' };
        }

        try {
            const res = await pythonProvider.sendRequest('segment_adjust', payload);

            if (!res?.success) {
                logger.error({ error: res?.error }, 'ai:segment:adjust python error');
                return { success: false, error: res?.error ?? 'Adjustment failed' };
            }

            logger.info({ scope: payload.scope }, 'ai:segment:adjust complete');
            return { success: true, result_b64: res.result_b64 };
        } catch (e: any) {
            logger.error({ error: e }, 'ai:segment:adjust IPC error');
            return { success: false, error: e?.message ?? 'Adjustment failed' };
        }
    });
}
