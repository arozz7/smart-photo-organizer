import './setup-env'; // Must be first
import { app, BrowserWindow } from 'electron'
import { registerImageProtocol } from './services/imageProtocol';
import { pythonProvider } from './infrastructure/PythonAIProvider';
import { registerAIHandlers } from './ipc/aiHandlers';
import { registerDBHandlers } from './ipc/dbHandlers';
import { registerSettingsHandlers } from './ipc/settingsHandlers';
import { registerFileHandlers } from './ipc/fileHandlers';
import { registerAppHandlers } from './ipc/appHandlers';
import { registerDashboardHandlers } from './ipc/dashboardHandlers';
import { registerCollageHandlers } from './ipc/collageHandlers';
import { registerPrsHandlers } from './ipc/prsHandlers';
import { registerCompositeHandlers } from './ipc/compositeHandlers';
import { registerAdjustmentHandlers } from './ipc/adjustmentHandlers';
import { scanQueue } from './scanQueue';
import { initDB } from './db'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { getLibraryPath } from './store';
import * as fs from 'node:fs/promises';
import logger from './logger';
import { WindowManager } from './windows/windowManager';
import { BackgroundBucketingService } from './core/services/BackgroundBucketingService';
import { BackgroundVerificationService } from './core/services/BackgroundVerificationService';
import { BackgroundPropagationService } from './core/services/BackgroundPropagationService';
import { BackgroundDuplicateCheckerService } from './core/services/BackgroundDuplicateCheckerService';
import { AppStateRepository } from './data/repositories/AppStateRepository';
import { BucketRepository } from './data/repositories/BucketRepository';
import { ServiceManager } from './core/services/ServiceManager';

// Global service references for shutdown
let bucketingService: BackgroundBucketingService | null = null;
let verificationService: BackgroundVerificationService | null = null;
let isQuitting = false;

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

app.on('before-quit', async (event) => {
  if (isQuitting) return;

  event.preventDefault();
  isQuitting = true;
  logger.info('[Main] Graceful shutdown started...');

  try {
    AppStateRepository.requestShutdown();
    await ServiceManager.getInstance().stopAll();
  } catch (e) {
    logger.error('[Main] Error stopping services:', e);
  }

  AppStateRepository.recordCleanShutdown();
  logger.info('[Main] Graceful shutdown complete.');
  app.quit();
});

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

    // Recovery / Cleanup (B4)
    try {
      AppStateRepository.clearShutdownRequest();
      const cleaned = BucketRepository.deleteOrphanBuckets();
      if (cleaned > 0) logger.info(`[Main] Cleaned up ${cleaned} orphan buckets.`);
    } catch (err) {
      logger.error('[Main] Recovery cleanup failed:', err);
    }
  } catch (e) {
    logger.error("DB Init Failed", e);
  }

  // Start Services
  // Old: startPythonBackend();
  pythonProvider.start();

  // Start Background Bucketing Service (Phase B3)
  bucketingService = new BackgroundBucketingService(pythonProvider);
  bucketingService.start();

  // Start Background Verification Service (Phase 56)
  verificationService = new BackgroundVerificationService();
  verificationService.start();

  // Start Background Propagation Service (Phase 105-6)
  const propagationService = new BackgroundPropagationService();
  propagationService.start();

  // Start Background Duplicate Checker Service (Phase 107)
  const duplicateCheckerService = new BackgroundDuplicateCheckerService(pythonProvider);
  duplicateCheckerService.start();

  // Register Services
  const serviceManager = ServiceManager.getInstance();
  serviceManager.register('PythonAIProvider', pythonProvider);
  serviceManager.register('BackgroundBucketingService', bucketingService);
  serviceManager.register('BackgroundVerificationService', verificationService);
  serviceManager.register('BackgroundPropagationService', propagationService);
  serviceManager.register('BackgroundDuplicateCheckerService', duplicateCheckerService);
  serviceManager.register('ScanQueue', scanQueue);

  registerAIHandlers();
  registerDBHandlers();
  registerSettingsHandlers();
  registerFileHandlers();
  registerAppHandlers(() => WindowManager.getMainWindow());
  registerDashboardHandlers();
  registerCollageHandlers();
  registerPrsHandlers();
  registerCompositeHandlers();
  registerAdjustmentHandlers();

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
