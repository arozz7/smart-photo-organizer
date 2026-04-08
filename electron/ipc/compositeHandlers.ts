/**
 * Composite IPC handlers — Phase 116: Creative Compositing Workspace.
 *
 * Channel: ai:compose:layers
 *
 * Forwards the layer stack to the Python backend's `compose` command and
 * returns the flattened RGBA PNG as a base64 string.
 */

import { ipcMain } from 'electron';
import { pythonProvider } from '../infrastructure/PythonAIProvider';
import logger from '../logger';

export function registerCompositeHandlers(): void {
    ipcMain.handle(
        'ai:compose:layers',
        async (
            _,
            payload: {
                layers: unknown[];
                width: number;
                height: number;
            },
        ) => {
            const { layers = [], width, height } = payload ?? {};

            if (!Array.isArray(layers) || layers.length === 0) {
                return { success: false, error: 'layers must be a non-empty array' };
            }

            try {
                const res = await pythonProvider.sendRequest('compose', {
                    layers,
                    width,
                    height,
                });

                if (!res?.success) {
                    logger.error({ error: res?.error }, 'ai:compose:layers python error');
                    return { success: false, error: res?.error ?? 'Composition failed' };
                }

                logger.info({ layer_count: layers.length, width, height }, 'ai:compose:layers complete');
                return { success: true, result_b64: res.result_b64 };
            } catch (e: any) {
                logger.error({ error: e }, 'ai:compose:layers IPC error');
                return { success: false, error: e?.message ?? 'Composition failed' };
            }
        },
    );
}
