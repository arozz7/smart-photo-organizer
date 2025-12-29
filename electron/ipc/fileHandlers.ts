import { ipcMain, dialog } from 'electron';
import { scanDirectory, scanFiles } from '../scanner';
import { getLibraryPath } from '../store';
import logger from '../logger';

export function registerFileHandlers() {
    ipcMain.handle('scan-directory', async (event, dirPath, options = {}) => {
        return await scanDirectory(dirPath, getLibraryPath(), (count) => {
            event.sender.send('scan-progress', count)
        }, options)
    });

    ipcMain.handle('scan-files', async (event, filePaths: string[], options = {}) => {
        return await scanFiles(filePaths, getLibraryPath(), (count) => {
            event.sender.send('scan-progress', count)
        }, options)
    });

    ipcMain.handle('dialog:openDirectory', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory'],
        })
        if (canceled) {
            return null
        } else {
            return filePaths[0]
        }
    });

    ipcMain.handle('read-file-buffer', async (_, filePath: string) => {
        const fs = await import('node:fs/promises');
        try {
            const buffer = await fs.readFile(filePath);
            return buffer;
        } catch (error) {
            logger.error('Failed to read file:', filePath, error);
            throw error;
        }
    });
}
