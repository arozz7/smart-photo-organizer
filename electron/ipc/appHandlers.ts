import { ipcMain, shell, BrowserWindow } from 'electron';
import logger from '../logger';

export function registerAppHandlers(getMainWindow: () => BrowserWindow | null) {
    ipcMain.handle('app:focusWindow', () => {
        const win = getMainWindow();
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
            return true;
        }
        return false;
    });

    ipcMain.handle('os:getLogPath', () => {
        return logger.getLogPath();
    });

    ipcMain.handle('os:showInFolder', (_, path) => {
        shell.showItemInFolder(path);
    });

    ipcMain.handle('os:openFolder', (_, path) => {
        shell.openPath(path);
    });
}
