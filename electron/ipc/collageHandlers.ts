import { ipcMain, dialog } from 'electron';
import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import logger from '../logger';

export function registerCollageHandlers() {
    /**
     * Read a photo file, resize to max 600px wide, return as base64 data URL.
     * This avoids canvas cross-origin tainting from local-resource:// protocol.
     */
    ipcMain.handle('collage:readPhotoBase64', async (_, filePath: string) => {
        try {
            const buffer = await sharp(filePath)
                .resize({ width: 600, withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toBuffer();
            const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
            return { success: true, dataUrl };
        } catch (e) {
            logger.error({ error: e }, 'Failed to read photo for collage');
            return { success: false, error: String(e) };
        }
    });

    /**
     * Export a collage canvas as PNG or JPG to a user-chosen location.
     * Receives the canvas data URL and opens a save dialog.
     */
    ipcMain.handle('collage:exportCollage', async (_, { dataUrl, defaultName }: { dataUrl: string; defaultName: string }) => {
        try {
            const isPng = dataUrl.startsWith('data:image/png');
            const ext = isPng ? 'png' : 'jpg';

            const { canceled, filePath } = await dialog.showSaveDialog({
                defaultPath: defaultName || `collage.${ext}`,
                filters: [
                    { name: 'PNG Image', extensions: ['png'] },
                    { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
                ],
            });

            if (canceled || !filePath) {
                return { success: false, canceled: true };
            }

            // Strip data URL prefix to get raw base64
            const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            await fs.writeFile(filePath, buffer);

            return { success: true, filePath };
        } catch (e) {
            logger.error({ error: e }, 'Failed to export collage');
            return { success: false, error: String(e) };
        }
    });
}
