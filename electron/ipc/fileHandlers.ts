import { ipcMain, dialog, OpenDialogOptions } from 'electron';
import { scanQueue } from '../scanQueue'; // Use Queue
import logger from '../logger';
import fs from 'node:fs';
import { ConfigService } from '../core/services/ConfigService';
import { folderToRemember, startFolderFor, type PickerKind } from '../core/services/pickerFolders';

/** Electron 43+ no longer remembers the last folder, so the app keeps it in config.json. */
function savedStartFolder(kind: PickerKind): string | undefined {
    return startFolderFor(kind, ConfigService.getSettings().lastPickerFolders, fs.existsSync);
}

function rememberFolder(kind: PickerKind, selectedPath: string): void {
    const saved = ConfigService.getSettings().lastPickerFolders;
    ConfigService.updateSettings({
        lastPickerFolders: { ...saved, [kind]: folderToRemember(kind, selectedPath) },
    });
}

export function registerFileHandlers() {
    ipcMain.handle('scan-directory', async (event, dirPath, options = {}) => {
        return await scanQueue.enqueueDirectory(dirPath, options, event.sender);
    });

    ipcMain.handle('scan-files', async (event, filePaths: string[], options = {}) => {
        return await scanQueue.enqueueFiles(filePaths, options, event.sender);
    });

    ipcMain.handle('dialog:openDirectory', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            defaultPath: savedStartFolder('directory'),
        })
        if (canceled) {
            return null
        } else {
            rememberFolder('directory', filePaths[0]);
            return filePaths[0]
        }
    });

    ipcMain.handle('dialog:openFile', async (_, options: Partial<OpenDialogOptions> = {}) => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            defaultPath: savedStartFolder('file'),
            ...options,
        });
        if (canceled) return null;
        rememberFolder('file', filePaths[0]);
        return filePaths[0];
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
