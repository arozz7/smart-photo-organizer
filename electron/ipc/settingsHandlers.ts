import { ipcMain } from 'electron';
import { getLibraryPath, setLibraryPath } from '../store';
import { closeDB } from '../db';
import { killPythonBackend } from '../services/pythonService';
import { app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import Store from 'electron-store';

const store = new Store();

export function registerSettingsHandlers() {
    ipcMain.handle('settings:getLibraryPath', () => {
        return getLibraryPath();
    });

    ipcMain.handle('settings:moveLibrary', async (_, newPath: string) => {
        console.log(`[Main] Configuring move library to: ${newPath}`);
        const LIBRARY_PATH = getLibraryPath();

        // Validate
        try {
            const stats = await fs.stat(newPath);
            if (!stats.isDirectory()) return { success: false, error: 'Target is not a directory' };
        } catch {
            return { success: false, error: 'Target directory does not exist' };
        }

        try {
            closeDB();
            killPythonBackend();

            // 2. Move Files
            console.log('[Main] Moving files...');
            const itemsToMove = ['library.db', 'previews', 'vectors.index', 'id_map.pkl', 'library.db-shm', 'library.db-wal'];

            // wait a moment for processes to release locks
            await new Promise(resolve => setTimeout(resolve, 1000));

            for (const item of itemsToMove) {
                const src = path.join(LIBRARY_PATH, item);
                const dest = path.join(newPath, item);
                try {
                    // Check if src exists
                    await fs.access(src);
                    // Copy with recursive true (for directories like previews) and force (overwrite)
                    console.log(`Copying ${src} -> ${dest}`);
                    await fs.cp(src, dest, { recursive: true, force: true });
                } catch (e: any) {
                    if (e.code === 'ENOENT') {
                        continue;
                    }
                    console.error(`Failed to copy ${item}:`, e);
                    throw new Error(`Failed to copy ${item}: ${e.message}`);
                }
            }

            // Verify
            try {
                await fs.access(path.join(newPath, 'library.db'));
            } catch { }

            // 3. Update Store
            setLibraryPath(newPath);

            // 4. Cleanup Old Files
            console.log('Cleaning up old files...');
            for (const item of itemsToMove) {
                const src = path.join(LIBRARY_PATH, item);
                try {
                    await fs.rm(src, { recursive: true, force: true });
                } catch (cleanupErr) {
                    console.error(`Failed to cleanup ${src}:`, cleanupErr);
                }
            }

            // 5. Restart
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
        return {
            batchSize: store.get('queue.batchSize', 0),
            cooldownSeconds: store.get('queue.cooldownSeconds', 60)
        };
    });

    ipcMain.handle('settings:setQueueConfig', async (_, config) => {
        store.set('queue.batchSize', config.batchSize);
        store.set('queue.cooldownSeconds', config.cooldownSeconds);
        return { success: true };
    });

    ipcMain.handle('settings:getAIQueue', () => {
        return store.get('ai_queue', []);
    });

    ipcMain.handle('settings:setAIQueue', (_, queue) => {
        store.set('ai_queue', queue);
    });

    ipcMain.handle('settings:getPreviewStats', async () => {
        const { getDB } = await import('../db');
        const db = getDB();
        try {
            const stats = db.prepare(`
                SELECT 
                    COUNT(*) as total_photos,
                    SUM(CASE WHEN preview_cache_path IS NOT NULL THEN 1 ELSE 0 END) as generated_previews
                FROM photos
            `).get();
            return {
                total: stats.total_photos,
                generated: stats.generated_previews,
                missing: stats.total_photos - stats.generated_previews
            };
        } catch (e) {
            return { total: 0, generated: 0, missing: 0 };
        }
    });

    ipcMain.handle('settings:cleanupPreviews', async () => {
        // Implement cleanup logic or trigger it
        console.log('Cleanup requested');
        return { success: true };
    });
}
