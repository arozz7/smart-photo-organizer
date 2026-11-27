import './setup-env'; // Must be first
import { app, BrowserWindow, crashReporter } from 'electron'
import { registerImageProtocol } from './services/imageProtocol';
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import { startCrashDumps } from './lib/crashDumps';
import { EventLoopLagMonitor } from './utils/EventLoopLagMonitor';
import { imageJobs, SHARP_THREADS_PER_JOB } from './services/image/ImageJobTracker';
import { pythonProvider } from './infrastructure/PythonAIProvider';
import { registerAIHandlers } from './ipc/aiHandlers';
import { registerDBHandlers } from './ipc/dbHandlers';
import { registerSettingsHandlers } from './ipc/settingsHandlers';
import { registerFileHandlers } from './ipc/fileHandlers';
import { registerAppHandlers } from './ipc/appHandlers';
import { registerDashboardHandlers } from './ipc/dashboardHandlers';
import { registerCollageHandlers } from './ipc/collageHandlers';
import { registerPrsHandlers } from './ipc/prsHandlers';
import { registerSendToHandlers } from './ipc/sendToHandlers';
import { registerAlbumHandlers } from './ipc/albumHandlers';
import { registerParkedFaceHandlers } from './ipc/parkedFaceHandlers';
import { registerRematchHandlers } from './ipc/rematchHandlers';
import { registerNonFaceHandlers } from './ipc/nonFaceHandlers';
import { registerProfileHandlers } from './ipc/profileHandlers';
import { registerFaceVisibilityHandlers } from './ipc/faceVisibilityHandlers';
import { getFaceVisibilityService } from './core/services/FaceVisibilityDeps';
import { registerPictureHandlers } from './ipc/pictureHandlers';
import { registerPictureCheckHandlers } from './ipc/pictureCheckHandlers';
import { getPictureCheckService } from './core/services/PictureCheckDeps';
import { getAssignedVisibilityService } from './core/services/AssignedVisibilityDeps';
import { registerAssignedCheckHandlers } from './ipc/assignedCheckHandlers';
import { registerDoubtfulHandlers } from './ipc/doubtfulHandlers';
import { getRematchService } from './core/services/RematchDeps';
import { registerCompositeHandlers } from './ipc/compositeHandlers';
import { registerAdjustmentHandlers } from './ipc/adjustmentHandlers';
import { scanQueue } from './scanQueue';
import { initDB } from './db'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { getLibraryPath, getAISettings } from './store';
import { backgroundIdleGraceMs } from './core/services/backgroundPolicy';
import * as fs from 'node:fs/promises';
import logger from './logger';
import { WindowManager } from './windows/windowManager';
import { BackgroundBucketingService } from './core/services/BackgroundBucketingService';
import { BackgroundVerificationService } from './core/services/BackgroundVerificationService';
import { BackgroundPropagationService } from './core/services/BackgroundPropagationService';
import { BackgroundDuplicateCheckerService } from './core/services/BackgroundDuplicateCheckerService';
import { BackgroundFileIdentityService } from './core/services/BackgroundFileIdentityService';
import { BackgroundCaptionService } from './core/services/BackgroundCaptionService';
import { BackgroundFaissSyncService } from './core/services/BackgroundFaissSyncService';
import { createFaissSyncDeps } from './core/services/FaissIndexService';
import { AppStateRepository } from './data/repositories/AppStateRepository';
import { BucketRepository } from './data/repositories/BucketRepository';
import { ServiceManager } from './core/services/ServiceManager';
import { MigrationError } from './data/migrations/types';
import { notifyDowngrade, reportMigrationFailureAndQuit } from './windows/migrationDialogs';

// Global service references for shutdown
let bucketingService: BackgroundBucketingService | null = null;
let verificationService: BackgroundVerificationService | null = null;
let isQuitting = false;

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIBRARY_PATH = getLibraryPath();
logger.info(`[Main] Library Path: ${LIBRARY_PATH}`);

// Native image crashes (0.8.11, 0.8.13: inside the sharp module) leave no JavaScript error: keep local crash dumps, remember which
// files were being processed, and limit the native parallelism (ImageJobTracker).
sharp.concurrency(SHARP_THREADS_PER_JOB);
const crashDumpsDir = app.getPath('crashDumps');
startCrashDumps({
  crashReporter,
  logger,
  dumpsDir: crashDumpsDir,
  listDumps: () => {
    try { return readdirSync(path.join(crashDumpsDir, 'completed')).filter(name => name.endsWith('.dmp')); } catch { return []; }
  },
});
const unfinishedImageJobs = imageJobs.attachStateFile(path.join(app.getPath('userData'), 'logs', 'image-jobs.json'));
if (unfinishedImageJobs.length > 0) {
  logger.warn(`[Main] The last session ended while these image jobs were running: ${unfinishedImageJobs.map(job => `${job.op} ${job.file}`).join(' | ')}`);
}

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
  imageJobs.markCleanShutdown();
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

// Measures how long the main process is blocked and logs it with what was running (the window stalls during scans; see feat-scan-progress-total.md).
const lagMonitor = new EventLoopLagMonitor({
  activity: () => [scanQueue.busy ? 'scan' : '', imageJobs.inFlight().length > 0 ? `${imageJobs.inFlight().length} image jobs` : ''].filter(Boolean).join(', ') || 'idle',
  report: ({ count, maxMs, totalMs, activity }) => logger.warn(`[Lag] main process blocked ${count} times in 10 s (worst ${maxMs} ms, total ${totalMs} ms) while: ${activity}`),
});

app.whenReady().then(async () => {
  lagMonitor.start();
  try {
    await fs.mkdir(LIBRARY_PATH, { recursive: true });
  } catch (e) {
    logger.error(`[Main] Failed to create library path: ${LIBRARY_PATH}`, e);
  }

  WindowManager.createSplashWindow();

  // Initialize DB
  try {
    const migration = await initDB(LIBRARY_PATH, (status: string) => {
      WindowManager.updateSplashStatus(status);
    })
    if (migration.downgradeDetected) notifyDowngrade(migration);

    // Recovery / Cleanup (B4)
    try {
      AppStateRepository.clearShutdownRequest();
      const cleaned = BucketRepository.deleteOrphanBuckets();
      if (cleaned > 0) logger.info(`[Main] Cleaned up ${cleaned} orphan buckets.`);
    } catch (err) {
      logger.error('[Main] Recovery cleanup failed:', err);
    }
  } catch (e) {
    if (e instanceof MigrationError) {
      // Fail closed: do not start any service on a library whose upgrade failed.
      logger.error("[Main] Library upgrade failed; quitting", e);
      reportMigrationFailureAndQuit(e);
      return;
    }
    logger.error("DB Init Failed", e);
  }

  // Background tasks wait for the face scan unless the user lets them run alongside it
  AppStateRepository.setAIIdleGraceMs(backgroundIdleGraceMs(getAISettings()));

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

  // Start Background File Identity Service (Phase 130): records size / modified time / file id for older photos
  const fileIdentityService = new BackgroundFileIdentityService();
  fileIdentityService.start();
  // Photo descriptions and tags, after the faces and only while nothing else is working
  const captionService = new BackgroundCaptionService();
  captionService.start();

  // Start Background FAISS Sync Service: keeps the face search index in step with the named faces
  const faissSyncService = new BackgroundFaissSyncService(createFaissSyncDeps());
  faissSyncService.start();

  // Start Rematch Service: matches unassigned faces against people named since they were first processed (unconfirmed, undoable)
  const rematchService = getRematchService();
  rematchService.start();

  // Face visibility check: asks the vision model about uncertain faces when the user is away (suggestions only)
  const faceVisibilityService = getFaceVisibilityService();
  faceVisibilityService.start();
  // Picture check: asks the vision model whether faces are real people or only pictures of them, when the user is away (suggestions only)
  const pictureCheckService = getPictureCheckService();
  pictureCheckService.start();
  // Assigned-face check: the same question about faces already assigned to people, the biggest person first (suggestions only)
  const assignedVisibilityService = getAssignedVisibilityService();
  assignedVisibilityService.start();

  // Register Services
  const serviceManager = ServiceManager.getInstance();
  serviceManager.register('PythonAIProvider', pythonProvider);
  serviceManager.register('BackgroundBucketingService', bucketingService);
  serviceManager.register('BackgroundVerificationService', verificationService);
  serviceManager.register('BackgroundPropagationService', propagationService);
  serviceManager.register('BackgroundDuplicateCheckerService', duplicateCheckerService);
  serviceManager.register('BackgroundFileIdentityService', fileIdentityService);
  serviceManager.register('BackgroundCaptionService', captionService);
  serviceManager.register('BackgroundFaissSyncService', faissSyncService);
  serviceManager.register('RematchService', rematchService);
  serviceManager.register('FaceVisibilityService', faceVisibilityService);
  serviceManager.register('PictureCheckService', pictureCheckService);
  serviceManager.register('AssignedVisibilityService', assignedVisibilityService);
  serviceManager.register('ScanQueue', scanQueue);

  registerAIHandlers();
  registerDBHandlers();
  registerSettingsHandlers();
  registerFileHandlers();
  registerAppHandlers(() => WindowManager.getMainWindow());
  registerDashboardHandlers();
  registerCollageHandlers();
  registerPrsHandlers();
  registerSendToHandlers();
  registerAlbumHandlers();
  registerParkedFaceHandlers();
  registerRematchHandlers();
  registerNonFaceHandlers();
  registerProfileHandlers();
  registerFaceVisibilityHandlers();
  registerPictureCheckHandlers();
  registerAssignedCheckHandlers();
  registerDoubtfulHandlers();
  registerPictureHandlers();
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
