import { ipcMain } from 'electron';
import { getLibraryPath, setLibraryPath } from '../store';
import { closeDB } from '../db';
import { pythonProvider } from '../infrastructure/PythonAIProvider';
import { app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { ConfigService } from '../core/services/ConfigService';

export function registerSettingsHandlers() {
    ipcMain.handle('settings:getLibraryPath', () => {
        return getLibraryPath();
    });

    ipcMain.handle('settings:moveLibrary', async (_, newPath: string) => {
        console.log(`[Main] Configuring move library to: ${newPath}`);
        const LIBRARY_PATH = getLibraryPath();

        try {
            const stats = await fs.stat(newPath);
            if (!stats.isDirectory()) return { success: false, error: 'Target is not a directory' };
        } catch {
            return { success: false, error: 'Target directory does not exist' };
        }

        try {
            closeDB();
            // Kill via Provider
            pythonProvider.stop();

            console.log('[Main] Moving files...');
            const itemsToMove = ['library.db', 'previews', 'vectors.index', 'id_map.pkl', 'library.db-shm', 'library.db-wal'];

            await new Promise(resolve => setTimeout(resolve, 1000));

            for (const item of itemsToMove) {
                const src = path.join(LIBRARY_PATH, item);
                const dest = path.join(newPath, item);
                try {
                    await fs.access(src);
                    console.log(`Copying ${src} -> ${dest}`);
                    await fs.cp(src, dest, { recursive: true, force: true });
                } catch (e: any) {
                    if (e.code === 'ENOENT') continue;
                    throw new Error(`Failed to copy ${item}: ${e.message}`);
                }
            }

            setLibraryPath(newPath);

            console.log('Cleaning up old files...');
            for (const item of itemsToMove) {
                const src = path.join(LIBRARY_PATH, item);
                try { await fs.rm(src, { recursive: true, force: true }); }
                catch (e) { console.error(`Failed to cleanup ${src}:`, e); }
            }

            console.log('[Main] Restarting application...');
            app.relaunch();
            app.exit(0);

            return { success: true };
        } catch (e) {
            console.error('[Main] Move failed:', e);
            return { success: false, error: e };
        }
    });

    ipcMain.handle('settings:getQueueConfig', async () => {
        const s = ConfigService.getSettings().queue;
        return {
            batchSize: s.batchSize || 0,
            cooldownSeconds: s.cooldownSeconds || 60
        };
    });

    ipcMain.handle('settings:setQueueConfig', async (_, config) => {
        ConfigService.updateQueueConfig({
            batchSize: config.batchSize,
            cooldownSeconds: config.cooldownSeconds
        });
        return { success: true };
    });

    ipcMain.handle('settings:getAIQueue', () => {
        return ConfigService.getSettings().ai_queue || [];
    });

    ipcMain.handle('settings:setAIQueue', (_, queue) => {
        ConfigService.updateSettings({ ai_queue: queue });
    });

    ipcMain.handle('settings:getPreviewStats', async () => {
        const LIBRARY_PATH = getLibraryPath();
        const previewDir = path.join(LIBRARY_PATH, 'previews');

        let count = 0;
        let size = 0;

        try {
            await fs.access(previewDir);
            const files = await fs.readdir(previewDir);
            for (const file of files) {
                if (file.endsWith('.jpg') || file.endsWith('.jpeg')) {
                    try {
                        const s = await fs.stat(path.join(previewDir, file));
                        count++;
                        size += s.size;
                    } catch { }
                }
            }
            return { success: true, count, size };
        } catch {
            return { success: true, count: 0, size: 0 };
        }
    });

    ipcMain.handle('settings:cleanupPreviews', async (_, { days }) => {
        const LIBRARY_PATH = getLibraryPath();
        const previewDir = path.join(LIBRARY_PATH, 'previews');
        let deletedCount = 0;
        let deletedSize = 0;
        const now = Date.now();
        const maxAge = (days || 0) * 24 * 60 * 60 * 1000;

        try {
            const files = await fs.readdir(previewDir);
            for (const file of files) {
                const filePath = path.join(previewDir, file);
                try {
                    const stats = await fs.stat(filePath);
                    const age = now - stats.mtime.getTime();

                    if (days === 0 || age > maxAge) {
                        await fs.unlink(filePath);
                        deletedCount++;
                        deletedSize += stats.size;
                    }
                } catch { }
            }
            return { success: true, deletedCount, deletedSize };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('settings:getSmartIgnoreSettings', () => {
        return ConfigService.getSmartIgnoreSettings();
    });

    ipcMain.handle('settings:updateSmartIgnoreSettings', (_, settings) => {
        ConfigService.updateSmartIgnoreSettings(settings);
        return { success: true };
    });
}
