import './setup-env'; // Must be first
import { app, BrowserWindow } from 'electron'
import { registerImageProtocol } from './services/imageProtocol';
import { pythonProvider } from './infrastructure/PythonAIProvider';
import { registerAIHandlers } from './ipc/aiHandlers';
import { registerDBHandlers } from './ipc/dbHandlers';
import { registerSettingsHandlers } from './ipc/settingsHandlers';
import { registerFileHandlers } from './ipc/fileHandlers';
import { registerAppHandlers } from './ipc/appHandlers';
import { initDB } from './db'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { getLibraryPath } from './store';
import * as fs from 'node:fs/promises';
import logger from './logger';
import { WindowManager } from './windows/windowManager';

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIBRARY_PATH = getLibraryPath();
logger.info(`[Main] Library Path: ${LIBRARY_PATH}`);

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    WindowManager.createMainWindow()
  }
})

app.whenReady().then(async () => {
  try {
    await fs.mkdir(LIBRARY_PATH, { recursive: true });
  } catch (e) {
    logger.error(`[Main] Failed to create library path: ${LIBRARY_PATH}`, e);
  }

  WindowManager.createSplashWindow();

  // Initialize DB
  try {
    await initDB(LIBRARY_PATH, (status: string) => {
      WindowManager.updateSplashStatus(status);
    })
  } catch (e) {
    logger.error("DB Init Failed", e);
  }

  // Start Services
  // Old: startPythonBackend();
  pythonProvider.start();

  registerAIHandlers();
  registerDBHandlers();
  registerSettingsHandlers();
  registerFileHandlers();
  registerAppHandlers(() => WindowManager.getMainWindow());

  // Pass mainWindow reference to Provider when available
  // We can hook into WindowManager or set it when created.
  // Ideally WindowManager sets it. 
  // For now, we can poll or use the getter in a loop? 
  // Better: We just pass the getter? PythonProvider needs actual instance for send.
  // WindowManager.createMainWindow() returns it.

  // Register Protocol using Provider
  registerImageProtocol(async (filePath, width, box, orientation) => {
    try {
      const res = await pythonProvider.generateThumbnail(filePath, { width: width || 300, box, orientation: orientation || 1 });
      if (res.success && res.data) {
        return Buffer.from(res.data, 'base64');
      }
    } catch (e) {
      logger.error(`[Main] Python thumbnail error: ${e}`);
    }
    return null;
  });

  const win = await WindowManager.createMainWindow();
  if (win) pythonProvider.setMainWindow(win);

});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});
