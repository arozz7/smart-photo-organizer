import { app, BrowserWindow } from 'electron'
import { registerImageProtocol } from './services/imageProtocol';
import { startPythonBackend, killPythonBackend, sendRequestToPython } from './services/pythonService';
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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const LIBRARY_PATH = getLibraryPath();
logger.info(`[Main] Library Path: ${LIBRARY_PATH}`);

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  killPythonBackend();
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

  // Initialize DB (Async with Progress)
  try {
    await initDB(LIBRARY_PATH, (status: string) => {
      WindowManager.updateSplashStatus(status);
    })
  } catch (e) {
    logger.error("DB Init Failed", e);
  }

  // Start Services
  startPythonBackend();
  registerAIHandlers();
  registerDBHandlers();
  registerSettingsHandlers();
  registerFileHandlers();

  // App Handlers need window ref, but now WindowManager holds it.
  // We can pass a getter or just modify AppHandlers to use WindowManager
  // For now, let's pass a function that gets it from WindowManager


  // App Handlers need window ref
  registerAppHandlers(() => WindowManager.getMainWindow());

  registerImageProtocol(async (filePath, width, box, orientation) => {
    try {
      // logger.info(`[Main] Requesting Python thumbnail for: ${filePath}`);
      const res = await sendRequestToPython('generate_thumbnail', { path: filePath, width: width || 300, box: box, orientation: orientation || 1 }, 60000);
      if (res.success && res.data) {
        return Buffer.from(res.data, 'base64');
      }
      if (!res.success) {
        logger.warn(`[Main] Python thumbnail error: ${res.error}`);
      }
    } catch (e) {
      logger.error(`[Main] Python fallback refused: ${e}`);
    }
    return null;
  });

  WindowManager.createMainWindow();

});

// Global Error Handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});
