import { ipcMain } from 'electron';
import { z } from 'zod';
import logger from '../logger';
import { getParkedFaceSummaryService } from '../core/services/ParkedFaceSummaryDeps';

const requestSchema = z.object({ refresh: z.boolean().optional(), cachedOnly: z.boolean().optional() }).strict();

export function registerParkedFaceHandlers() {
    // Read-only: how many unassigned faces are worth reviewing and how many are parked (docs/plans/review-queue-parking-plan.md).
    ipcMain.handle('db:getParkedSummary', async (_event, payload: unknown) => {
        const parsed = requestSchema.safeParse(payload ?? {});
        if (!parsed.success) return { success: false, error: 'Invalid request' };

        try {
            const result = await getParkedFaceSummaryService().getSummary(parsed.data);
            return { success: result.status !== 'failed', ...result };
        } catch (error) {
            logger.error(`[IPC] db:getParkedSummary failed: ${String(error)}`);
            return { success: false, error: String(error) };
        }
    });
}
