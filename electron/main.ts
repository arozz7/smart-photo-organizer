import { app, BrowserWindow, ipcMain, protocol, net, dialog, shell } from 'electron'
import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url'
import { initDB, getDB, closeDB } from './db'
import { scanDirectory } from './scanner'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  getLibraryPath, setLibraryPath,
  getAISettings, setAISettings,
  getWindowBounds, setWindowBounds
} from './store';
import * as fs from 'node:fs/promises';
import Store from 'electron-store';
import logger from './logger';

const store = new Store();

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const LIBRARY_PATH = getLibraryPath();
logger.info(`[Main] Library Path: ${LIBRARY_PATH}`);

// Base64 for 1x1 transparent PNG
const TRANSPARENT_1X1_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let splash: BrowserWindow | null = null
let pythonProcess: ChildProcess | null = null;
const scanPromises = new Map<number, { resolve: (v: any) => void, reject: (err: any) => void }>();

function startPythonBackend() {
  let pythonPath: string;
  let args: string[];

  if (app.isPackaged) {
    // In production, use the bundled executable
    // Note: 'python-bin' is the folder name in extraResources
    pythonPath = path.join(process.resourcesPath, 'python-bin', 'smart-photo-ai', 'smart-photo-ai.exe');
    args = [];
    logger.info(`[Main] Starting Bundled Python Backend (Prod): ${pythonPath}`);
  } else {
    // In development, use the venv
    pythonPath = path.join(process.env.APP_ROOT, 'src', 'python', '.venv', 'Scripts', 'python.exe');
    const scriptPath = path.join(process.env.APP_ROOT, 'src', 'python', 'main.py');
    args = [scriptPath];
    logger.info(`[Main] Starting Python Backend (Dev): ${pythonPath} ${scriptPath}`);
  }

  pythonProcess = spawn(pythonPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      IS_DEV: app.isPackaged ? 'false' : 'true',
      HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
      LIBRARY_PATH: LIBRARY_PATH,
      LOG_PATH: path.join(app.getPath('userData'), 'logs'),
      PYTORCH_CUDA_ALLOC_CONF: 'expandable_segments:True'
    }
  });

  if (pythonProcess.stdout) {
    // Send initial config after small delay to ensure process is ready?
    // Or simply rely on init. 
    setTimeout(() => syncInitialSettings(), 2000);

    const reader = createInterface({ input: pythonProcess.stdout });
    reader.on('line', async (line) => {
      try {
        const message = JSON.parse(line);
        logger.info('[Python]', message);
        if (win && (message.type === 'scan_result' || message.type === 'tags_result' || message.type === 'analysis_result')) {
          win.webContents.send('ai:scan-result', message);

          // Log to History
          const isSuccess = (message.type === 'scan_result' && message.success) ||
            (message.type === 'analysis_result' && !message.error);

          if (isSuccess) {
            try {
              const { getDB } = await import('./db');
              const db = getDB();
              // Check if history already exists for this scan? Ideally unique scan ID?
              // Just log it.
              // message: { type, photoId, faces: [], metrics: { load, scan, total }, ... }
              const metrics = message.metrics || {};
              const faceCount = message.faces ? message.faces.length : 0;

              db.prepare(`
                  INSERT INTO scan_history (photo_id, file_path, scan_ms, tag_ms, face_count, status, timestamp)
                  VALUES (?, (SELECT file_path FROM photos WHERE id = ?), ?, ?, ?, 'success', ?)
                `).run(
                message.photoId,
                message.photoId,
                Math.round(metrics.scan || 0),
                Math.round(metrics.tag || 0), // tag_ms
                faceCount,
                Date.now()
              );
            } catch (e) {
              logger.error("[Main] Failed to log scan history:", e);
            }
          }
        }

        if (message.type === 'cluster_result') {
          console.log(`[Main] Received Cluster Result for ${message.photoId}. Clusters: ${message.clusters?.length}`);
        }


        // Shared Promise Resolution
        const resId = message.reqId || message.photoId || (message.payload && message.payload.reqId);

        if (win && (message.type === 'download_progress' || message.type === 'download_result')) {
          win.webContents.send('ai:model-progress', message);
        }

        if (resId && scanPromises.has(resId)) {
          const promise = scanPromises.get(resId);
          if (message.error) {
            promise?.reject(message.error);
          } else {
            promise?.resolve(message);
          }
          scanPromises.delete(resId);
        }

        // Special case for Logging errors (only for scans/tags?)
        if ((message.type === 'scan_result' || message.type === 'tags_result') && message.error && message.photoId) {
          try {
            const { getDB } = await import('./db'); // Dynamic import to avoid circular dep issues if any
            const db = getDB();
            const logError = db.prepare('INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, (SELECT file_path FROM photos WHERE id = ?), ?, ?)');
            const stage = message.type === 'scan_result' ? 'Face Scan' : 'Smart Tags';
            logError.run(message.photoId, message.photoId, message.error, stage);
            logger.info(`[Main] Logged scan error for ${message.photoId}`);
          } catch (err) {
            logger.error("[Main] Failed to log auto-error:", err);
          }
        }
      } catch (e) {
        logger.info('[Python Raw]', line);
      }
    });
  }

  if (pythonProcess.stderr) {
    pythonProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('exception')) {
        logger.error(`[Python Error]: ${msg}`);
      } else {
        logger.info(`[Python Log]: ${msg}`);
      }
    });
  }

  pythonProcess.on('close', (code) => {
    logger.info(`[Main] Python process exited with code ${code}`);
    pythonProcess = null;
  });
}

function sendToPython(command: any) {
  if (pythonProcess && pythonProcess.stdin) {
    pythonProcess.stdin.write(JSON.stringify(command) + '\n');
  } else {
    logger.error('[Main] Python process not running. Queuing or dropping command.', command.type);
  }
}

// Ensure settings sync on startup
function syncInitialSettings() {
  if (pythonProcess && pythonProcess.stdin) {
    const aiSettings = getAISettings();
    const configCmd = { type: 'update_config', payload: { config: aiSettings } };
    pythonProcess.stdin.write(JSON.stringify(configCmd) + '\n');
  }
}


function createSplashWindow() {
  splash = new BrowserWindow({
    width: 500,
    height: 300,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  splash.loadFile(path.join(process.env.VITE_PUBLIC, 'splash.html'));
  splash.on('closed', () => (splash = null));
}

async function createWindow() {
  const savedBounds = getWindowBounds();
  const defaults: { width: number; height: number; x?: number; y?: number } = { width: 1200, height: 800 };

  // Validate bounds
  let bounds = defaults;
  if (savedBounds && savedBounds.width && savedBounds.height) {
    // Check if the saved bounds are still actionable (on a screen)
    const { screen } = await import('electron');
    const display = screen.getDisplayMatching({
      x: savedBounds.x || 0,
      y: savedBounds.y || 0,
      width: savedBounds.width,
      height: savedBounds.height
    });

    // Simple check: does the display bounds intersection overlap significantly?
    // For now we just check if we got a valid display.
    if (display) {
      if (savedBounds.x !== undefined && savedBounds.y !== undefined) {
        bounds = { ...defaults, ...savedBounds };
      } else {
        bounds = { ...defaults, width: savedBounds.width, height: savedBounds.height };
      }
    }
  }

  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'icon.png'),
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    show: false, // Hide initially
    backgroundColor: '#111827', // Set dark background
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: false,
    },
  })

  // Save bounds on resize/move
  const saveBounds = () => {
    if (!win) return;
    const { x, y, width, height } = win.getBounds();
    setWindowBounds({ x, y, width, height });
  };

  win.on('resized', saveBounds);
  win.on('moved', saveBounds);
  win.on('close', saveBounds);

  // Remove the file menu
  win.setMenu(null);

  win.once('ready-to-show', () => {
    win?.show();
    if (splash) {
      splash.close();
    }
  });

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  // Force DevTools for debugging blank screen
  win.webContents.openDevTools();

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  // Ensure Library Directory Exists
  try {
    await fs.mkdir(LIBRARY_PATH, { recursive: true });
  } catch (e) {
    logger.error(`[Main] Failed to create library path: ${LIBRARY_PATH}`, e);
  }

  createSplashWindow()

  // Initialize DB (Async with Progress)
  try {
    await initDB(LIBRARY_PATH, (status: string) => {
      if (splash) {
        const safeStatus = status.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
        splash.webContents.executeJavaScript(`
              var el = document.getElementById('status');
              if(el) el.innerText = '${safeStatus}';
          `).catch(() => { });
      }
    })
  } catch (e) {
    logger.error("DB Init Failed", e);
  }

  startPythonBackend()



  protocol.handle('local-resource', async (request) => {
    let decodedPath = '';
    try {
      // 1. Strip protocol
      const rawPath = request.url.replace(/^local-resource:\/\//, '');

      // 2. Decode the path (converts %3A to :, %5C to \, %3F to ?)
      decodedPath = decodeURIComponent(rawPath);

      // 3. Strip query string (now it will be a literal '?')
      const queryIndex = decodedPath.indexOf('?');
      if (queryIndex !== -1) {
        decodedPath = decodedPath.substring(0, queryIndex);
      }

      // 4. Strip trailing slash (Windows cleanup)
      if (decodedPath.endsWith('/') || decodedPath.endsWith('\\')) {
        decodedPath = decodedPath.slice(0, -1);
      }

      // 5. Check if file exists (Optional safety for debugging)
      // try {
      //   await fs.access(decodedPath);
      // } catch {
      //   console.warn(`[Protocol] File not found: ${decodedPath}`);
      //   return new Response('Not Found', { status: 404 });
      // }

      return await net.fetch(pathToFileURL(decodedPath).toString());
    } catch (e: any) {
      const msg = e.message || String(e);

      // Check for silent 404 request (from FaceThumbnail)
      const isSilent404 = request.url.includes('silent_404=true');

      // Suppress noisy logs for expected missing files (fallback handles this)
      if (msg.includes('ERR_FILE_NOT_FOUND') || msg.includes('ENOENT')) {
        if (isSilent404) {
          logger.info(`[Protocol] Silent fallback served (1x1 PNG): ${decodedPath}`);
          return new Response(TRANSPARENT_1X1_PNG, {
            status: 200,
            headers: {
              'Content-Type': 'image/png',
              'Cache-Control': 'no-cache'
            }
          });
        }
        logger.info(`[Protocol] File missing (using fallback): ${request.url}`);
      } else {
        logger.error(`[Protocol] Failed to handle request: ${request.url}`, e);
      }
      return new Response('Not Found', { status: 404 });
    }
  })

  createWindow()

  ipcMain.handle('app:focusWindow', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      return true;
    }
    return false;
  });

  ipcMain.handle('scan-directory', async (event, dirPath) => {
    return await scanDirectory(dirPath, LIBRARY_PATH, (count) => {
      event.sender.send('scan-progress', count)
    })
  })

  ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    if (canceled) {
      return null
    } else {
      return filePaths[0]
    }
  })

  ipcMain.handle('read-file-buffer', async (_, filePath: string) => {
    const fs = await import('node:fs/promises');
    try {
      const buffer = await fs.readFile(filePath);
      return buffer;
    } catch (error) {
      logger.error('Failed to read file:', filePath, error);
      throw error;
    }
  })

  // Handle Settings
  ipcMain.handle('ai:getSettings', () => {
    return getAISettings();
  });

  ipcMain.handle('db:getMetricsHistory', async () => {
    const { getMetricsHistory } = await import('./db');
    return getMetricsHistory();
  });

  ipcMain.handle('ai:saveSettings', (_event, settings) => {
    setAISettings(settings);
    // Propagate to Python
    if (pythonProcess && pythonProcess.stdin) {
      const cmd = { type: 'update_config', payload: { config: settings } };
      pythonProcess.stdin.write(JSON.stringify(cmd) + '\n');
    }
    return true;
  });

  ipcMain.handle('ai:downloadModel', async (_event, { modelName }) => {
    logger.info(`[Main] Requesting model download: ${modelName}`);
    return new Promise((resolve, reject) => {
      const requestId = Math.floor(Math.random() * 1000000);
      scanPromises.set(requestId, {
        resolve: (res: any) => resolve(res),
        reject
      });

      sendToPython({
        type: 'download_model',
        payload: {
          reqId: requestId,
          modelName
        }
      });

      // Long timeout for downloads (30 minutes)
      setTimeout(() => {
        if (scanPromises.has(requestId)) {
          scanPromises.delete(requestId);
          reject('Model download timed out');
        }
      }, 1800000);
    });
  });

  ipcMain.handle('ai:getSystemStatus', async () => {
    return new Promise((resolve, reject) => {
      const requestId = Math.floor(Math.random() * 1000000);
      scanPromises.set(requestId, {
        resolve: (res: any) => resolve(res.status || {}),
        reject
      });

      sendToPython({
        type: 'get_system_status',
        payload: { reqId: requestId }
      });

      setTimeout(() => {
        if (scanPromises.has(requestId)) {
          scanPromises.delete(requestId);
          reject('Get system status timed out');
        }
      }, 10000);
    });
  });

  // Handle Face Blur

  ipcMain.handle('face:getBlurry', async (_event, { personId, threshold, scope }) => {
    const db = getDB();

    // Determine the query based on scope or personId
    // scope: 'person' | 'unnamed' | 'all'

    let query = '';
    const params = [];

    if (personId) {
      // Specific person
      query = `SELECT f.id, f.photo_id, f.blur_score, f.box_json, p.file_path, p.preview_cache_path, p.metadata_json, pp.name as person_name 
               FROM faces f 
               JOIN photos p ON f.photo_id = p.id
               LEFT JOIN people pp ON f.person_id = pp.id
               WHERE f.person_id = ? AND f.blur_score < ?`;
      params.push(personId);
    } else if (scope === 'all') {
      // All faces (global cleanup)
      query = `SELECT f.id, f.photo_id, f.blur_score, f.box_json, p.file_path, p.preview_cache_path, p.metadata_json, pp.name as person_name
               FROM faces f 
               JOIN photos p ON f.photo_id = p.id
               LEFT JOIN people pp ON f.person_id = pp.id
               WHERE f.blur_score < ?`;
    } else {
      // Default: Unnamed only
      query = `SELECT f.id, f.photo_id, f.blur_score, f.box_json, p.file_path, p.preview_cache_path, p.metadata_json 
               FROM faces f 
               JOIN photos p ON f.photo_id = p.id
               WHERE f.person_id IS NULL AND f.blur_score < ?`;
    }

    const thresh = threshold || 20.0;
    params.push(thresh);

    const stmt = db.prepare(query);

    // Default threshold if not provided
    const rows = stmt.all(...params);
    return rows.map((r: any) => {
      let original_width = null;
      if (r.metadata_json) {
        try {
          const meta = JSON.parse(r.metadata_json);
          // ExifTool usually provides 'ImageWidth'. Sometimes 'SourceImageWidth' or just 'Width'.
          original_width = meta.ImageWidth || meta.SourceImageWidth || meta.ExifImageWidth;
        } catch (e) {
          // ignore parse error
        }
      }
      return {
        ...r,
        box: JSON.parse(r.box_json),
        original_width
      };
    });
  });

  ipcMain.handle('debug:getBlurStats', async () => {
    const db = getDB();
    try {
      const stats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          COUNT(blur_score) as scored_count,
          MIN(blur_score) as min_score,
          MAX(blur_score) as max_score,
          (SELECT COUNT(*) FROM faces WHERE blur_score IS NULL) as null_count
        FROM faces
      `).get();
      return { success: true, stats };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('db:getPhotosMissingBlurScores', async () => {
    const db = getDB();
    try {
      const stmt = db.prepare('SELECT DISTINCT photo_id FROM faces WHERE blur_score IS NULL');
      const rows = stmt.all();
      return { success: true, photoIds: rows.map((r: any) => r.photo_id) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  // --- IPC Handlers: Settings / Previews ---
  ipcMain.handle('settings:getPreviewStats', async () => {
    try {
      const previewDir = path.join(getLibraryPath(), 'previews');
      try {
        await fs.access(previewDir);
      } catch {
        return { success: true, count: 0, size: 0 };
      }

      let count = 0;
      let size = 0;
      const files = await fs.readdir(previewDir);

      for (const file of files) {
        if (file.startsWith('.')) continue;
        try {
          const stats = await fs.stat(path.join(previewDir, file));
          if (stats.isFile()) {
            count++;
            size += stats.size;
          }
        } catch (e) { /* ignore */ }
      }
      return { success: true, count, size };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('settings:cleanupPreviews', async (_event, { days }) => {
    try {
      const previewDir = path.join(getLibraryPath(), 'previews');
      try { await fs.access(previewDir); } catch { return { success: true, deletedCount: 0, deletedSize: 0 }; }

      const now = Date.now();
      const maxAge = days * 24 * 60 * 60 * 1000;
      let deletedCount = 0;
      let deletedSize = 0;

      const files = await fs.readdir(previewDir);
      for (const file of files) {
        if (file.startsWith('.')) continue;
        const filePath = path.join(previewDir, file);
        try {
          const stats = await fs.stat(filePath);
          if (now - stats.mtimeMs > maxAge) {
            await fs.unlink(filePath);
            deletedCount++;
            deletedSize += stats.size;
          }
        } catch (e) { /* ignore */ }
      }
      return { success: true, deletedCount, deletedSize };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });


  ipcMain.handle('face:deleteFaces', async (_event, faceIds) => {
    const db = getDB();
    const deleteParams = faceIds.map(() => '?').join(',');
    const stmt = db.prepare(`DELETE FROM faces WHERE id IN (${deleteParams})`);
    stmt.run(...faceIds);
    return true;
  });

  ipcMain.handle('ai:getClusteredFaces', async () => {
    const { getUnclusteredFaces } = await import('./db');
    const dbRes = getUnclusteredFaces();

    if (!dbRes.success || !dbRes.faces || dbRes.faces.length === 0) {
      return { clusters: [], singles: [], blurry: [] };
    }

    // Separate Clean vs Blurry
    const BLUR_THRESHOLD = 25; // TODO: Get from settings?
    const cleanFaces = dbRes.faces.filter((f: any) => (f.blur_score || 0) >= BLUR_THRESHOLD);
    const blurryFaces = dbRes.faces.filter((f: any) => (f.blur_score || 0) < BLUR_THRESHOLD);

    // If no clean faces, return early
    if (cleanFaces.length === 0) {
      return { clusters: [], singles: [], blurry: blurryFaces.map((f: any) => { const { descriptor, ...rest } = f; return rest; }) };
    }

    // Send to Python
    return new Promise((resolve, reject) => {
      const requestId = Math.floor(Math.random() * 1000000);
      scanPromises.set(requestId, {
        resolve: (res: any) => {
          // res: { clusters: [[id, ...], ...], singles: [id, ...] }

          if (!res.clusters && !res.singles) {
            resolve({ clusters: [], singles: [], blurry: [] });
            return;
          }

          const faceMap = new Map();
          dbRes.faces.forEach((f: any) => faceMap.set(f.id, f));

          // Remove descriptor from UI payload
          const cleanFace = (id: number) => {
            const f = faceMap.get(id);
            if (!f) return null;
            const { descriptor, ...rest } = f;
            return rest;
          };

          const clusters = (res.clusters || []).map((clusterIds: number[]) => {
            const faces = clusterIds.map(cleanFace).filter(Boolean);
            return { faces };
          }).filter((c: any) => c.faces.length > 0);

          const singles = (res.singles || []).map(cleanFace).filter(Boolean);
          const blurry = blurryFaces.map((f: any) => { const { descriptor, ...rest } = f; return rest; });

          resolve({ clusters, singles, blurry });
        },
        reject
      });

      // Send minimal data to Python (descriptors of CLEAN faces only)
      const pythonPayload = cleanFaces.map((f: any) => ({ id: f.id, descriptor: f.descriptor }));

      // Use Temp File for Large Payloads to avoid STDIN buffer limits
      const tempFile = path.join(app.getPath('temp'), `cluster_payload_${requestId}.json`);

      fs.writeFile(tempFile, JSON.stringify({ faces: pythonPayload }))
        .then(() => {
          sendToPython({
            type: 'cluster_faces',
            payload: {
              dataPath: tempFile,
              reqId: requestId
            }
          });
        })
        .catch(err => {
          console.error('[Clustering] Failed to start cluster job:', err);
          reject(err);
        });

      setTimeout(() => {
        if (scanPromises.has(requestId)) {
          scanPromises.delete(requestId);
          reject('Clustering timed out');
        }
      }, 60000);
    });
  });




  ipcMain.handle('ai:rotateImage', async (_, { photoId, rotation }) => {
    const db = getDB();
    logger.info(`[Main] Requesting Rotation for ${photoId} (${rotation} deg)`);

    try {
      const stmt = db.prepare('SELECT file_path FROM photos WHERE id = ?');
      const photo = stmt.get(photoId) as { file_path: string };

      if (photo && photo.file_path) {
        const previewsDir = path.join(LIBRARY_PATH, 'previews');
        await fs.mkdir(previewsDir, { recursive: true });

        sendToPython({
          type: 'rotate_image',
          payload: {
            photoId,
            filePath: photo.file_path,
            previewStorageDir: previewsDir,
            rotation
          }
        });

        // Wait for result
        const result: any = await new Promise((resolve, reject) => {
          scanPromises.set(photoId, { resolve, reject });

          setTimeout(() => {
            if (scanPromises.has(photoId)) {
              scanPromises.delete(photoId);
              reject('Rotation timed out');
            }
          }, 30000);
        });

        if (result.success) {
          // Update DB with new dims and preview path
          const previewPath = path.join(previewsDir, `preview_${photoId}.jpg`);
          db.prepare('UPDATE photos SET width = ?, height = ?, preview_cache_path = ? WHERE id = ?')
            .run(result.width, result.height, previewPath, photoId);

          // Update Face Coordinates via Re-Scan (with ID Preservation)
          try {
            const faces = db.prepare('SELECT id, box_json, person_id FROM faces WHERE photo_id = ?').all(photoId) as { id: number, box_json: string, person_id: number | null }[];
            logger.info(`[Rotate] Found ${faces.length} faces for photo ${photoId} to preserve IDs.`);

            if (faces.length > 0) {
              // 1. Transform Old Faces (so we can match them to new scan results)
              const rot = Number(rotation);
              // Logic: 90 -> CCW Transform (as verified by user screenshots)
              const transform = (x: number, y: number) => {
                if (rot === 90 || rot === -270) return [y, srcW - x];
                if (rot === 180 || rot === -180) return [srcW - x, srcH - y];
                if (rot === 270 || rot === -90) return [srcH - y, x];
                return [x, y];
              };
              const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));

              // Use original image dims for transformation logic source
              // Wait, srcW/srcH were calculated based on rotation result.
              // If rot=90, Result is (H, W). Source was (W, H).
              // So if result.width is the NEW width, then srcW (old width) was result.height.
              let srcW = 0, srcH = 0;
              const absRot = Math.abs(rotation) % 360;
              if (absRot === 90 || absRot === 270) {
                srcW = result.height;
                srcH = result.width;
              } else {
                srcW = result.width;
                srcH = result.height;
              }

              const transformedOldFaces = faces.map(face => {
                try {
                  const box = JSON.parse(face.box_json);
                  let x1, y1, x2, y2;

                  if (Array.isArray(box) && box.length === 4) { [x1, y1, x2, y2] = box; }
                  else if (box && typeof box.x === 'number') { x1 = box.x; y1 = box.y; x2 = box.x + box.width; y2 = box.y + box.height; }
                  else return null;

                  const p1 = transform(x1, y1);
                  const p2 = transform(x2, y2);

                  // New Box in New Coordinates
                  const nx1 = clamp(Math.min(p1[0], p2[0]), result.width);
                  const ny1 = clamp(Math.min(p1[1], p2[1]), result.height);
                  const nx2 = clamp(Math.max(p1[0], p2[0]), result.width);
                  const ny2 = clamp(Math.max(p1[1], p2[1]), result.height);

                  return {
                    id: face.id, // Keep the face ID
                    person_id: face.person_id,
                    box: { x: nx1, y: ny1, width: nx2 - nx1, height: ny2 - ny1 }
                  };
                } catch (e) { return null; }
              }).filter(f => f !== null);

              // 2. Trigger Re-Scan
              logger.info(`[Rotate] Triggering Re-Scan for ${photoId}...`);
              const scanReqId = Date.now() + Math.random();
              sendToPython({
                type: 'analyze_image',
                payload: { photoId, filePath: photo.file_path, scanMode: 'BALANCED', enableVLM: false, reqId: scanReqId }
              });

              // 3. Wait for Scan Result
              const scanResult: any = await new Promise((resolve, reject) => {
                scanPromises.set(scanReqId, { resolve, reject });
                setTimeout(() => { if (scanPromises.has(scanReqId)) { scanPromises.delete(scanReqId); reject('Timeout'); } }, 300000); // 5 minutes
              });

              if (scanResult.success && scanResult.faces) {
                // 4. Overwrite Faces
                db.prepare('DELETE FROM faces WHERE photo_id = ?').run(photoId);
                const insert = db.prepare('INSERT INTO faces (photo_id, box_json, descriptor, score, blur_score, person_id) VALUES (?, ?, ?, ?, ?, ?)');

                let migratedCount = 0;
                const usedOldFaceIds = new Set<number>();

                // Sort new faces by size (largest first) to prioritize main subjects? Or just iterate.
                // Better: find global best matches. 
                // Simple Greedy: For each new face, find best match. If matched, mark old used.
                // But wait, order matters. Ideally compute all distances then pair up.
                // Let's stick to Greedy with tighter threshold and distinctness.

                for (const newFace of scanResult.faces) {
                  let matchedPid: number | null = null;
                  let bestDist = Infinity;
                  let bestOldFaceIndex = -1;

                  if (transformedOldFaces.length > 0) {
                    const cx = newFace.box.x + newFace.box.width / 2;
                    const cy = newFace.box.y + newFace.box.height / 2;

                    transformedOldFaces.forEach((old) => {
                      if (!old || old.person_id === null || usedOldFaceIds.has(old.id)) return;

                      const ocx = old.box.x + old.box.width / 2;
                      const ocy = old.box.y + old.box.height / 2;
                      const dist = Math.sqrt(Math.pow(cx - ocx, 2) + Math.pow(cy - ocy, 2));

                      // Stricter Threshold: 8% of min dimension
                      const threshold = Math.min(result.width, result.height) * 0.08;

                      if (dist < bestDist && dist < threshold) {
                        bestDist = dist;
                        matchedPid = old.person_id;
                        bestOldFaceIndex = old.id; // Use ID to track usage
                      }
                    });
                  }

                  if (matchedPid !== null && bestOldFaceIndex !== -1) {
                    usedOldFaceIds.add(bestOldFaceIndex);
                    migratedCount++;
                  }

                  insert.run(photoId, JSON.stringify(newFace.box), newFace.descriptor ? Buffer.from(newFace.descriptor) : null, newFace.score, newFace.blur_score, matchedPid);
                }
                logger.info(`[Rotate] Re-scan complete. ${scanResult.faces.length} faces found. Migrated IDs: ${migratedCount}`);
              }
            } else {
              // No faces existed, just run a scan? Or do nothing?
              // User might want new faces found even if none existed.
              // But usually we only care if faces were there.
            }
          } catch (e) {
            logger.error('Failed to update face coordinates (Re-Scan) after rotation:', e);
          }
        }

        return result;
      }
    } catch (e) {
      logger.error('[Main] Failed to rotate:', e);
      return { success: false, error: e };
    }
  });

  ipcMain.handle('ai:generateTags', async (_, { photoId }) => {
    const db = getDB();
    logger.info(`[Main] Requesting Tags (VLM) for ${photoId}`);

    try {
      const stmt = db.prepare('SELECT file_path FROM photos WHERE id = ?');
      const photo = stmt.get(photoId) as { file_path: string };

      if (photo && photo.file_path) {
        sendToPython({ type: 'generate_tags', payload: { photoId, filePath: photo.file_path } });
        return { success: true };
      } else {
        return { success: false, error: 'Photo not found' };
      }
    } catch (e) {
      logger.error('[Main] Failed to lookup photo for VLM:', e);
      return { success: false, error: e };
    }
  });






  // Unified Analysis (Scan + Tag)
  ipcMain.handle('ai:analyzeImage', async (_, { photoId, scanMode, enableVLM }) => {
    const db = getDB();
    logger.info(`[Main] Requesting Analysis for ${photoId} (Mode: ${scanMode}, VLM: ${enableVLM})`);

    try {
      const stmt = db.prepare('SELECT file_path FROM photos WHERE id = ?');
      const photo = stmt.get(photoId) as { file_path: string };

      if (photo && photo.file_path) {
        sendToPython({
          type: 'analyze_image',
          payload: {
            photoId,
            filePath: photo.file_path,
            scanMode,
            enableVLM
          }
        });

        // Wait for result
        return new Promise((resolve, reject) => {
          scanPromises.set(photoId, { resolve, reject });
          setTimeout(() => {
            if (scanPromises.has(photoId)) {
              scanPromises.delete(photoId);
              reject('Analysis timed out');
            }
          }, 300000);
        });

      } else {
        return { success: false, error: 'Photo not found' };
      }
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('ai:addFacesToVectorIndex', async (_, { vectors, ids }) => {
    return new Promise((resolve, reject) => {
      const reqId = Math.floor(Math.random() * 1000000);
      scanPromises.set(reqId, { resolve: (r: any) => resolve(r), reject });

      sendToPython({
        type: 'add_to_index',
        payload: { vectors, ids, reqId }
      });

      setTimeout(() => {
        if (scanPromises.has(reqId)) { scanPromises.delete(reqId); reject('Add to index timed out'); }
      }, 10000);
    });
  });

  ipcMain.handle('ai:saveVectorIndex', async () => {
    // Create a fire-and-forget or wait? Wait is checking confirmation.
    return new Promise((resolve, reject) => {
      const reqId = Math.floor(Math.random() * 1000000);
      scanPromises.set(reqId, { resolve: (r: any) => resolve(r), reject });
      sendToPython({ type: 'save_index', payload: { reqId } });
      setTimeout(() => {
        if (scanPromises.has(reqId)) { scanPromises.delete(reqId); reject('Save index timed out'); }
      }, 15000);
    });
  });

  // AI Enhancement
  ipcMain.handle('ai:enhanceImage', async (_, { photoId, task, modelName }) => {
    const db = getDB();
    logger.info(`[Main] Enhance Request: ${photoId} [${task}]`);

    try {
      const stmt = db.prepare('SELECT file_path FROM photos WHERE id = ?');
      const photo = stmt.get(photoId) as { file_path: string };

      if (!photo || !photo.file_path) return { success: false, error: 'Photo not found' };

      const ext = path.extname(photo.file_path);
      const name = path.basename(photo.file_path, ext);
      const suffix = task === 'upscale' ? '_upscaled' : '_restored';
      // Save next to original for now, or in a specific 'enhanced' folder?
      // Let's save next to original but verify write permissions? 
      // Safest is same directory.
      const outPath = path.join(path.dirname(photo.file_path), `${name}${suffix}.jpg`); // Force JPG output?

      return new Promise((resolve, reject) => {
        const requestId = Math.floor(Math.random() * 1000000);
        scanPromises.set(requestId, {
          resolve: (res: any) => {
            if (res.success) resolve({ success: true, outPath: res.outPath });
            else resolve({ success: false, error: res.error });
          },
          reject
        });

        sendToPython({
          type: 'enhance_image',
          payload: {
            reqId: requestId, // We piggyback on generic promise handler
            filePath: photo.file_path,
            outPath,
            task,
            modelName
          }
        });

        setTimeout(() => {
          if (scanPromises.has(requestId)) {
            scanPromises.delete(requestId);
            reject('Enhancement timed out');
          }
        }, 600000); // 10 min timeout
      });

    } catch (e) {
      logger.error('Enhance failed:', e);
      return { success: false, error: String(e) };
    }
  })

  ipcMain.handle('ai:rebuildIndex', async () => {
    const db = getDB();
    logger.info('[Main] Rebuilding Vector Index...');
    try {
      // Get all faces that have a descriptor
      const rows = db.prepare('SELECT id, descriptor FROM faces WHERE descriptor IS NOT NULL').all();
      const descriptors = rows.map((r: any) => {
        if (!r.descriptor) return [];
        return Array.from(new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4));
      });
      const ids = rows.map((r: any) => r.id);

      if (descriptors.length === 0) {
        return { success: true, count: 0 };
      }

      return new Promise((resolve, reject) => {
        const requestId = Math.floor(Math.random() * 1000000);
        scanPromises.set(requestId, {
          resolve: (res: any) => resolve({ success: true, count: res.count }),
          reject
        });

        sendToPython({
          type: 'rebuild_index',
          payload: {
            reqId: requestId,
            descriptors,
            ids
          }
        });
      });
    } catch (e) {
      logger.error('Failed to rebuild index:', e);
      return { success: false, error: String(e) };
    }
  });

  // Generic AI Command Handler (Request-Response)
  ipcMain.handle('ai:command', async (_, command) => {
    try {
      // If the command expects a response, we need to track it.
      // We'll use a random requestId/photoId to track the promise.
      const requestId = Math.floor(Math.random() * 10000000);

      // Inject requestId into payload so Python can echo it back if needed
      // Most of our generic commands might not need photoId, but our promise map is keyed by photoId (number).
      // We will assume 'payload' exists or create it.
      if (!command.payload) command.payload = {};

      // If the command is 'get_system_status' or similar that doesn't inherently have an ID, we assign one.
      // We need to modify Python to respect/echo this ID if we want to use the same map.
      // Actually, let's check Python's get_system_status. It returns { type: 'system_status_result', ... }
      // It DOES NOT currently return an ID. We need to fix that or handle non-ID messages.

      // WAIT: Python's 'handle_command' just returns the result dictionary.
      // AND 'main.py' loop prints the result.
      // 'electron/main.ts' reader loop (line 69) parses it.

      // The current reader loop (line 83) relies on `message.photoId`.
      // If Python returns a result WITHOUT photoId, the promise won't be resolved!

      // STRATEGY: 
      // 1. We must send a unique ID to Python.
      // 2. Python must echo it back.
      // 3. Update 'main.py' to echo 'id' from command to response? 
      //    OR just update specific commands in Python to accept/return an ID.

      // FOR NOW: Let's focus on 'get_system_status'. 
      // Python's `handle_command` returns the dict directly.
      // We can wrap the `handle_command` call in `main.py` to inject the ID back?
      // Or just update `get_system_status` in `main.py` to accept and return an ID.

      // Let's rely on a temporary specific fix for now and plan a better ID system later.
      // Update `electron/main.ts` to expect `ai:command` but we likely need to patch Python again 
      // if we want to wait for response using the existing `scanPromises` map.

      // ALTERNATIVE: Use a separate promise mechanism for system status?
      // No, let's reuse.

      // Let's modify the command payload to include 'reqId'.
      command.payload.reqId = requestId;

      return new Promise((resolve, reject) => {
        scanPromises.set(requestId, { resolve, reject });

        // We also need to update the reader loop to look for 'reqId' if 'photoId' is missing.
        sendToPython(command);

        setTimeout(() => {
          if (scanPromises.has(requestId)) {
            scanPromises.delete(requestId);
            reject('Command timed out');
          }
        }, 30000);
      });
    } catch (e) {
      logger.error('AI Command Failed:', e);
      return { error: e };
    }
  });

  ipcMain.handle('ai:clusterFaces', async (_, { faceIds, eps, min_samples } = {}) => {
    const db = getDB();
    try {
      let rows;
      if (faceIds && faceIds.length > 0) {
        // Specific faces
        const placeholders = faceIds.map(() => '?').join(',');
        const stmt = db.prepare(`SELECT id, descriptor FROM faces WHERE id IN (${placeholders})`);
        rows = stmt.all(...faceIds);
      } else {
        // All unnamed, non-ignored faces (Unknowns ALWAYS have descriptors)
        const stmt = db.prepare('SELECT id, descriptor FROM faces WHERE person_id IS NULL AND is_ignored = 0 AND descriptor IS NOT NULL');
        rows = stmt.all();
      }

      const descriptors = rows.map((r: any) => {
        if (!r.descriptor) return [];
        return Array.from(new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4));
      });
      const ids = rows.map((r: any) => r.id);

      if (descriptors.length === 0) return { success: true, clusters: [] };

      // Call Python
      return new Promise((resolve, reject) => {
        // We need a way to get the response back. 
        // Since sendToPython is fire-and-forget for async commands usually handled by event listeners...
        // But here we want a direct response.
        // The current 'sendToPython' / 'reader.on' architecture in startPythonBackend handles 'scan_result' and 'tags_result' via events.
        // We need to extend it to handle 'cluster_result'.
        // OR: We can use a request/response ID map if we want to be fancy.

        // Wait! The reader loop (line 69) currently sends 'ai:scan-result' to window.
        // It also checks `scanPromises` map! 
        // So if I pass a specific ID, I can piggyback on that system.
        // But `cluster_faces` isn't photo-specific. 
        // I'll generate a random request ID.

        const requestId = Math.floor(Math.random() * 1000000);

        // Register promise
        scanPromises.set(requestId, { resolve: (res: any) => resolve({ success: true, clusters: res.clusters }), reject });

        sendToPython({
          type: 'cluster_faces',
          payload: {
            photoId: requestId, // Abuse photoId as requestId
            descriptors,
            ids,
            eps,
            min_samples
          }
        });

        setTimeout(() => {
          if (scanPromises.has(requestId)) {
            scanPromises.delete(requestId);
            reject('Clustering timed out');
          }
        }, 300000);
      });

    } catch (e) {
      logger.error('Failed to cluster faces:', e);
      return { success: false, error: e };
    }
  })

  ipcMain.handle('db:addTags', async (_, { photoId, tags }: { photoId: number, tags: string[] }) => {
    // We need to import db helper here or move it to a shared place.
    // For now we can import getDB from ./db
    const db = getDB();

    const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
    const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?');
    const linkTag = db.prepare(`
      INSERT INTO photo_tags (photo_id, tag_id, source) 
      VALUES (@photoId, @tagId, 'AI') 
      ON CONFLICT(photo_id, tag_id) DO NOTHING
    `);

    const transaction = db.transaction((photoId: number, tags: string[]) => {
      for (const tag of tags) {
        insertTag.run(tag);
        const tagRecord = getTagId.get(tag) as { id: number };
        if (tagRecord) {
          linkTag.run({ photoId, tagId: tagRecord.id });
        }
      }
    });

    try {
      transaction(photoId, tags);
      return { success: true };
    } catch (error) {
      logger.error('Failed to add tags:', error);
      return { success: false, error };
    }
  })

  ipcMain.handle('db:getTags', async (_, photoId: number) => {
    const db = getDB();
    const stmt = db.prepare(`
      SELECT t.name FROM tags t
      JOIN photo_tags pt ON pt.tag_id = t.id
      WHERE pt.photo_id = ?
    `);
    try {
      const tags = stmt.all(photoId);
      return tags.map((t: any) => t.name);
    } catch (error) {
      logger.error('Failed to get tags:', error);
      return [];
    }
  })

  ipcMain.handle('db:clearAITags', async (_event) => {
    const db = getDB();
    try {
      db.exec(`
        DELETE FROM photo_tags WHERE source = 'AI';
        DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM photo_tags);
      `);
      logger.info('Cleared all AI tags.');
      return { success: true };
    } catch (error) {
      logger.error('Failed to clear AI tags:', error);
      return { success: false, error };
    }
  })

  ipcMain.handle('db:getPhoto', async (_, photoId: number) => {
    const db = getDB();
    try {
      const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId);
      return photo || null;
    } catch (error) {
      logger.error('Failed to get photo:', error);
      return null;
    }
  })

  ipcMain.handle('db:getPhotos', async (_, { limit = 50, offset = 0, filter = {} } = {}) => {
    const db = getDB();
    try {
      // console.log(`[Main] db:getPhotos request: limit=${limit}, offset=${offset}, filter=`, filter);
      let query = 'SELECT p.* FROM photos p';
      const params: any[] = [];
      const conditions: string[] = [];

      // Filter: Untagged (No AI tags)
      if (filter.untagged) {
        conditions.push(`p.id NOT IN (SELECT photo_id FROM photo_tags)`);
      }

      // Filter: Folder path
      if (filter.folder) {
        conditions.push(`p.file_path LIKE ?`);
        params.push(`${filter.folder}%`);
      }

      // Filter: Tags (Advanced Logic)
      if (filter.tags && Array.isArray(filter.tags) && filter.tags.length > 0) {
        const matchAll = filter.tagsMatchAll; // boolean
        if (matchAll) {
          // Must have ALL usage tags
          // Subquery: Get photo_ids that have all these tags
          const placeholders = filter.tags.map(() => '?').join(',');
          conditions.push(`p.id IN (
             SELECT pt.photo_id FROM photo_tags pt
             JOIN tags t ON pt.tag_id = t.id
             WHERE t.name IN (${placeholders})
             GROUP BY pt.photo_id
             HAVING COUNT(DISTINCT t.name) = ?
           )`);
          params.push(...filter.tags);
          params.push(filter.tags.length);
        } else {
          // Match ANY
          const placeholders = filter.tags.map(() => '?').join(',');
          conditions.push(`p.id IN (
             SELECT pt.photo_id FROM photo_tags pt
             JOIN tags t ON pt.tag_id = t.id
             WHERE t.name IN (${placeholders})
           )`);
          params.push(...filter.tags);
        }
      } else if (filter.tag) {
        // Legacy single tag support (keep for compatibility if needed, or map to array)
        conditions.push(`p.id IN (
          SELECT pt.photo_id FROM photo_tags pt
          JOIN tags t ON pt.tag_id = t.id
          WHERE t.name = ?
        )`);
        params.push(filter.tag);
      }


      // Filter: Text Search (Semantic/Tag Search)
      if (filter.search) {
        const searchTerm = `%${filter.search}%`;
        conditions.push(`p.id IN (
            SELECT pt.photo_id FROM photo_tags pt
            JOIN tags t ON pt.tag_id = t.id
            WHERE t.name LIKE ?
        )`);
        params.push(searchTerm);
      }

      // Filter: Specific People (Array of IDs)
      if (filter.people && Array.isArray(filter.people) && filter.people.length > 0) {
        const matchAll = filter.peopleMatchAll;
        const placeholders = filter.people.map(() => '?').join(',');

        if (matchAll) {
          conditions.push(`p.id IN (
              SELECT f.photo_id FROM faces f
              WHERE f.person_id IN (${placeholders})
              GROUP BY f.photo_id
              HAVING COUNT(DISTINCT f.person_id) = ?
            )`);
          params.push(...filter.people);
          params.push(filter.people.length);
        } else {
          conditions.push(`p.id IN (
              SELECT f.photo_id FROM faces f
              WHERE f.person_id IN (${placeholders})
            )`);
          params.push(...filter.people);
        }
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const stmt = db.prepare(query);
      const photos = stmt.all(...params);
      // console.log(`[Main] db:getPhotos returned ${photos.length} photos.`);
      return photos;
    } catch (error) {
      console.error('Failed to get photos:', error);
      return [];
    }
  })

  ipcMain.handle('os:createAlbum', async (_, { photoIds, targetDir }) => {
    const db = getDB();
    console.log(`[Main] Creating album with ${photoIds?.length} photos in ${targetDir}`);

    if (!photoIds || !photoIds.length || !targetDir) {
      return { success: false, error: 'Invalid arguments' };
    }

    try {
      // Get file paths
      const placeholders = photoIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT file_path FROM photos WHERE id IN (${placeholders})`).all(...photoIds);

      let successCount = 0;
      let failCount = 0;

      await fs.mkdir(targetDir, { recursive: true });

      for (const row of rows) {
        const src = (row as any).file_path;
        const fileName = path.basename(src);
        // TODO: duplicate name handling? For now, let's keep it simple or maybe prefix if exists.
        // Let's just overwrite for now or use standard copy.
        const dest = path.join(targetDir, fileName);

        try {
          await fs.copyFile(src, dest);
          successCount++;
        } catch (e) {
          console.error(`Failed to copy ${src} to ${dest}`, e);
          failCount++;
        }
      }
      return { success: true, successCount, failCount };

    } catch (error) {
      console.error('Create Album failed', error);
      return { success: false, error };
    }
  });

  ipcMain.handle('db:getPhotosForRescan', async (_, { filter = {} } = {}) => {
    const db = getDB();
    try {
      let query = 'SELECT p.id, p.file_path, p.preview_cache_path FROM photos p';
      const params: any[] = [];
      const conditions: string[] = [];

      // Filter: Untagged (No AI tags)
      if (filter.untagged) {
        conditions.push(`p.id NOT IN (SELECT photo_id FROM photo_tags)`);
      }

      // Filter: Folder path
      if (filter.folder) {
        conditions.push(`p.file_path LIKE ?`);
        params.push(`${filter.folder}%`);
      }

      // Filter: Tags (Advanced Logic)
      if (filter.tags && Array.isArray(filter.tags) && filter.tags.length > 0) {
        const matchAll = filter.tagsMatchAll; // boolean
        if (matchAll) {
          const placeholders = filter.tags.map(() => '?').join(',');
          conditions.push(`p.id IN (
             SELECT pt.photo_id FROM photo_tags pt
             JOIN tags t ON pt.tag_id = t.id
             WHERE t.name IN (${placeholders})
             GROUP BY pt.photo_id
             HAVING COUNT(DISTINCT t.name) = ?
           )`);
          params.push(...filter.tags);
          params.push(filter.tags.length);
        } else {
          const placeholders = filter.tags.map(() => '?').join(',');
          conditions.push(`p.id IN (
             SELECT pt.photo_id FROM photo_tags pt
             JOIN tags t ON pt.tag_id = t.id
             WHERE t.name IN (${placeholders})
           )`);
          params.push(...filter.tags);
        }
      } else if (filter.tag) {
        conditions.push(`p.id IN (
          SELECT pt.photo_id FROM photo_tags pt
          JOIN tags t ON pt.tag_id = t.id
          WHERE t.name = ?
        )`);
        params.push(filter.tag);
      }

      // Filter: Text Search (Semantic/Tag Search)
      if (filter.search) {
        const searchTerm = `%${filter.search}%`;
        conditions.push(`p.id IN (
            SELECT pt.photo_id FROM photo_tags pt
            JOIN tags t ON pt.tag_id = t.id
            WHERE t.name LIKE ?
        )`);
        params.push(searchTerm);
      }

      // Filter: Specific People (Array of IDs)
      if (filter.people && Array.isArray(filter.people) && filter.people.length > 0) {
        const matchAll = filter.peopleMatchAll;
        const placeholders = filter.people.map(() => '?').join(',');

        if (matchAll) {
          conditions.push(`p.id IN (
              SELECT f.photo_id FROM faces f
              WHERE f.person_id IN (${placeholders})
              GROUP BY f.photo_id
              HAVING COUNT(DISTINCT f.person_id) = ?
            )`);
          params.push(...filter.people);
          params.push(filter.people.length);
        } else {
          conditions.push(`p.id IN (
              SELECT f.photo_id FROM faces f
              WHERE f.person_id IN (${placeholders})
            )`);
          params.push(...filter.people);
        }
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY created_at DESC';

      const stmt = db.prepare(query);
      return stmt.all(...params);
    } catch (error) {
      console.error('Failed to get photos for rescan:', error);
      return [];
    }
  })

  // Replaces db:storeFace with a smart merge strategy
  ipcMain.handle('db:getAllTags', async () => {
    const db = getDB();
    try {
      // Get tags with counts
      const stmt = db.prepare(`
        SELECT t.name, COUNT(pt.photo_id) as count
        FROM tags t
        JOIN photo_tags pt ON t.id = pt.tag_id
        GROUP BY t.id
        ORDER BY count DESC
      `);
      return stmt.all();
    } catch (error) {
      console.error('Failed to get all tags:', error);
      return [];
    }
  })

  ipcMain.handle('db:removeTag', async (_, { photoId, tag }) => {
    const db = getDB();
    try {
      const stmt = db.prepare(`
        DELETE FROM photo_tags 
        WHERE photo_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)
      `);
      stmt.run(photoId, tag);
      return { success: true };
    } catch (error) {
      console.error('Failed to remove tag:', error);
      return { success: false, error };
    }
  })

  ipcMain.handle('db:renamePerson', async (_, { personId, newName }) => {
    const db = getDB();
    const cleanName = newName.trim();
    if (!cleanName) return { success: false, error: 'Name cannot be empty' };

    try {
      // Check if target name exists
      const targetPerson = db.prepare('SELECT id FROM people WHERE name = ? COLLATE NOCASE').get(cleanName) as { id: number } | undefined;

      if (targetPerson) {
        if (targetPerson.id === personId) {
          return { success: true }; // No change
        }

        // MERGE STRATEGY
        console.log(`[Main] Merging person ${personId} into ${targetPerson.id} (${cleanName})`);

        db.transaction(() => {
          // 1. Move all faces to target person
          db.prepare('UPDATE faces SET person_id = ? WHERE person_id = ?').run(targetPerson.id, personId);

          // 2. Delete source person
          db.prepare('DELETE FROM people WHERE id = ?').run(personId);
        })();

        return { success: true, merged: true, targetId: targetPerson.id };

      } else {
        // RENAME STRATEGY
        console.log(`[Main] Renaming person ${personId} to ${cleanName}`);
        db.prepare('UPDATE people SET name = ? WHERE id = ?').run(cleanName, personId);
        return { success: true, merged: false };
      }

    } catch (e) {
      console.error('Failed to rename person:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('db:updateFaces', async (_, { photoId, faces, previewPath, width, height, globalBlurScore }) => {
    const db = getDB();

    try {
      const getOldFaces = db.prepare('SELECT id, box_json, person_id FROM faces WHERE photo_id = ?');
      // Update: Handle descriptor as BLOB, add is_reference
      const updateFace = db.prepare('UPDATE faces SET box_json = ?, descriptor = ?, blur_score = ?, is_reference = ? WHERE id = ?');
      const insertFace = db.prepare('INSERT INTO faces (photo_id, box_json, descriptor, person_id, blur_score, is_reference) VALUES (?, ?, ?, ?, ?, ?)');

      const deleteFace = db.prepare('DELETE FROM faces WHERE id = ?');
      const getAllKnownPeople = db.prepare('SELECT id, descriptor_mean_json FROM people WHERE descriptor_mean_json IS NOT NULL');
      // Fallback for people without mean yet
      const getAllKnownFaces = db.prepare('SELECT person_id, descriptor FROM faces WHERE person_id IS NOT NULL AND descriptor IS NOT NULL');

      // Helpers for Reference Management
      const getPersonRefCount = db.prepare('SELECT count(*) as count FROM faces WHERE person_id = ? AND is_reference = 1');
      const getWorstReference = db.prepare('SELECT id, blur_score FROM faces WHERE person_id = ? AND is_reference = 1 ORDER BY blur_score ASC LIMIT 1');
      const downgradeReference = db.prepare('UPDATE faces SET is_reference = 0, descriptor = NULL WHERE id = ?');

      const updatePhotoPreview = db.prepare('UPDATE photos SET preview_cache_path = ? WHERE id = ?');
      const updatePhotoDims = db.prepare('UPDATE photos SET width = ?, height = ? WHERE id = ?');
      const updatePhotoBlur = db.prepare('UPDATE photos SET blur_score = ? WHERE id = ?');

      const insertedIds: number[] = [];
      const transaction = db.transaction(() => {
        if (previewPath) {
          updatePhotoPreview.run(previewPath, photoId);
        }
        if (width && height) {
          updatePhotoDims.run(width, height, photoId);
        }
        if (globalBlurScore !== undefined && globalBlurScore !== null) {
          updatePhotoBlur.run(globalBlurScore, photoId);
        }

        const oldFaces = getOldFaces.all(photoId);
        const usedOldFaceIds = new Set<number>();
        const peopleToUpdate = new Set<number>();


        // 1. Process New Faces
        for (const newFace of faces) {
          const newBox = newFace.box;
          let bestMatchId = null;
          let maxIoU = 0;

          // Find best matching old face
          for (const oldFace of oldFaces) {
            // @ts-ignore
            if (usedOldFaceIds.has(oldFace.id)) continue;

            // @ts-ignore
            const oldBox = JSON.parse(oldFace.box_json);

            // Calculate IoU
            const xA = Math.max(newBox.x, oldBox.x);
            const yA = Math.max(newBox.y, oldBox.y);
            const xB = Math.min(newBox.x + newFace.box.width, oldBox.x + oldBox.width);
            const yB = Math.min(newBox.y + newFace.box.height, oldBox.y + oldBox.height);

            const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
            if (interArea > 0) {
              const boxAArea = newBox.width * newBox.height;
              const boxBArea = oldBox.width * oldBox.height;
              const iou = interArea / (boxAArea + boxBArea - interArea);

              if (iou > 0.25 && iou > maxIoU) {
                maxIoU = iou;
                // @ts-ignore
                bestMatchId = oldFace.id;
              }
            }
          }

          // Prepare Descriptor Buffer
          const descArr = new Float32Array(newFace.descriptor);
          const descBuf = Buffer.from(descArr.buffer);

          if (bestMatchId) {
            // UPDATE existing face (keep person_id)
            // @ts-ignore
            const oldFace = oldFaces.find(f => f.id === bestMatchId);
            const personId = (oldFace as any).person_id;

            let isRef = 0;
            let finalDesc: Buffer | null = descBuf;

            if (personId) {
              // Check Ref Logic
              const countObj = getPersonRefCount.get(personId) as { count: number };
              if (countObj.count < 100) {
                isRef = 1;
              } else {
                const worst = getWorstReference.get(personId) as { id: number, blur_score: number };
                if (worst && (newFace.blur_score || 0) > (worst.blur_score || 0)) {
                  // Upgrade new, Downgrade old
                  downgradeReference.run(worst.id);
                  isRef = 1;
                } else {
                  // Prune this new one
                  isRef = 0;
                  finalDesc = null;
                }
              }
              peopleToUpdate.add(personId);
            } else {
              // Unknown faces ALWAYS keep vector and are NOT references (until named)
              // Actually, Unknowns implicitly need vector for clustering.
              // We'll treat them as is_reference=0 but Descriptor PRESENT.
              isRef = 0;
              finalDesc = descBuf;
            }

            updateFace.run(JSON.stringify(newBox), finalDesc, newFace.blur_score || null, isRef, bestMatchId);
            usedOldFaceIds.add(bestMatchId);
            insertedIds.push(bestMatchId as number);

          } else {
            // INSERT new face (Auto-recognize)
            let matchedPersonId = null;
            let bestDistance = 0.45; // Cosine Distance Threshold

            // A. Try matching against People Means
            const knownPeople = getAllKnownPeople.all();
            for (const person of knownPeople) {
              // @ts-ignore
              const meanDesc = JSON.parse(person.descriptor_mean_json);

              let dot = 0, mag1 = 0, mag2 = 0;
              if (newFace.descriptor.length !== meanDesc.length) continue;

              for (let i = 0; i < newFace.descriptor.length; i++) {
                dot += newFace.descriptor[i] * meanDesc[i];
                mag1 += newFace.descriptor[i] ** 2;
                mag2 += meanDesc[i] ** 2;
              }
              const magnitude = Math.sqrt(mag1) * Math.sqrt(mag2);
              const dist = magnitude === 0 ? 1.0 : 1.0 - (dot / magnitude);

              if (dist < bestDistance) {
                bestDistance = dist;
                // @ts-ignore
                matchedPersonId = person.id;
              }
            }

            // B. Fallback: Match against known face VECTORS (if valid)
            if (!matchedPersonId) {
              const knownFaces = getAllKnownFaces.all();
              for (const known of knownFaces) {
                // @ts-ignore
                // Reader BLOB to Float32Array
                const knownBuf = known.descriptor;
                if (!knownBuf) continue;

                // Assuming stored as bytes of float32
                const knownArr = new Float32Array(knownBuf.buffer, knownBuf.byteOffset, knownBuf.byteLength / 4);

                let dot = 0, mag1 = 0, mag2 = 0;
                // newFace.descriptor is array
                if (newFace.descriptor.length !== knownArr.length) continue;

                for (let i = 0; i < newFace.descriptor.length; i++) {
                  dot += newFace.descriptor[i] * knownArr[i];
                  mag1 += newFace.descriptor[i] ** 2;
                  mag2 += knownArr[i] ** 2;
                }
                const magnitude = Math.sqrt(mag1) * Math.sqrt(mag2);
                const dist = magnitude === 0 ? 1.0 : 1.0 - (dot / magnitude);

                if (dist < bestDistance) {
                  bestDistance = dist;
                  // @ts-ignore
                  matchedPersonId = known.person_id;
                }
              }
            }

            // Logic for Saving
            let isRef = 0;
            let finalDesc: Buffer | null = descBuf;

            if (matchedPersonId) {
              const countObj = getPersonRefCount.get(matchedPersonId) as { count: number };
              if (countObj.count < 100) {
                isRef = 1;
              } else {
                const worst = getWorstReference.get(matchedPersonId) as { id: number, blur_score: number };
                if (worst && (newFace.blur_score || 0) > (worst.blur_score || 0)) {
                  downgradeReference.run(worst.id);
                  isRef = 1;
                } else {
                  isRef = 0;
                  finalDesc = null;
                }
              }
              peopleToUpdate.add(matchedPersonId);
            }

            const result = insertFace.run(photoId, JSON.stringify(newBox), finalDesc, matchedPersonId, newFace.blur_score || null, isRef);
            insertedIds.push(Number(result.lastInsertRowid));
          }
        }

        // 2. Delete Unmatched Old Faces
        for (const oldFace of oldFaces) {
          // @ts-ignore
          if (!usedOldFaceIds.has(oldFace.id)) {
            // @ts-ignore
            deleteFace.run(oldFace.id);
            // @ts-ignore
            if (oldFace.person_id) peopleToUpdate.add(oldFace.person_id);
          }
        }

        // 3. Update Means
        // 3. Update Means
        for (const pid of peopleToUpdate) {
          scheduleMeanRecalc(db, pid);
        }
      });

      transaction();
      return { success: true, count: faces.length, ids: insertedIds };
    } catch (error) {
      console.error('Failed to update faces:', error);
      return { success: false, error: String(error) };
    }
  })

  ipcMain.handle('db:getFaces', async (_, photoId: number) => {
    const db = getDB();
    try {
      const stmt = db.prepare(`
        SELECT f.*, p.name as person_name 
        FROM faces f
        LEFT JOIN people p ON f.person_id = p.id
        WHERE f.photo_id = ?
      `);
      const faces = stmt.all(photoId);
      return faces.map((f: any) => ({
        ...f,
        box: JSON.parse(f.box_json),
        descriptor: f.descriptor ? Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4)) : null,
        is_reference: !!f.is_reference
      }));
    } catch (error) {
      console.error('Failed to get faces:', error);
      return [];
    }
  })

  ipcMain.handle('db:getPeople', async () => {
    const db = getDB();
    try {
      const stmt = db.prepare(`
        WITH BestFaces AS (
          SELECT 
            person_id,
            id as face_id,
            photo_id,
            box_json,
            blur_score,
            ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY blur_score DESC) as rn
          FROM faces 
          WHERE person_id IS NOT NULL
        ),
        PersonCounts AS (
            SELECT person_id, COUNT(*) as face_count 
            FROM faces 
            WHERE person_id IS NOT NULL 
            GROUP BY person_id
        )
        SELECT 
          p.*, 
          COALESCE(pc.face_count, 0) as face_count,
          COALESCE(ph.preview_cache_path, ph.file_path) as cover_path,
          bf.box_json as cover_box,
          ph.width as cover_width,
          ph.height as cover_height
        FROM people p
        LEFT JOIN PersonCounts pc ON p.id = pc.person_id
        LEFT JOIN BestFaces bf ON p.id = bf.person_id AND bf.rn = 1
        LEFT JOIN photos ph ON bf.photo_id = ph.id
        ORDER BY face_count DESC
      `);
      return stmt.all();
    } catch (error) {
      console.error('Failed to get people', error);
      return [];
    }
  })

  ipcMain.handle('db:getAllFaces', async (_, { limit = 100, offset = 0, filter = {} } = {}) => {
    const db = getDB();
    try {
      let query = `
        SELECT f.*, p.file_path, p.preview_cache_path, p.width, p.height 
        FROM faces f
        JOIN photos p ON f.photo_id = p.id
      `;
      const params: any[] = [];
      const conditions: string[] = [];

      // Filter: Unnamed (no person_id)
      if (filter.unnamed) {
        conditions.push('f.person_id IS NULL');
      }

      // Filter: Specific Person
      if (filter.personId) {
        conditions.push('f.person_id = ?');
        params.push(filter.personId);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      // Default: Hide ignored faces unless specified (future proofing)
      if (!query.includes('is_ignored')) {
        query += conditions.length > 0 ? ' AND is_ignored = 0' : ' WHERE is_ignored = 0';
      }

      query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const stmt = db.prepare(query);
      const faces = stmt.all(...params);
      return faces.map((f: any) => ({
        ...f,
        box: JSON.parse(f.box_json),
        descriptor: f.descriptor ? Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4)) : null,
        is_reference: !!f.is_reference
      }));
    } catch (error) {
      console.error('Failed to get all faces:', error);
      return [];
    }
  })

  ipcMain.handle('db:assignPerson', async (_, { faceId, personName }) => {
    const db = getDB();

    // Normalize Name: Title Case (e.g. "john doe" -> "John Doe")
    const normalizedName = personName
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, (c: string) => c.toUpperCase());

    const insertPerson = db.prepare('INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
    const getPerson = db.prepare('SELECT id FROM people WHERE name = ?');
    const getOldPersonId = db.prepare('SELECT person_id FROM faces WHERE id = ?');
    const updateFace = db.prepare('UPDATE faces SET person_id = ? WHERE id = ?');

    const transaction = db.transaction(() => {
      // Check old person (if any) to update their mean later
      const oldFace = getOldPersonId.get(faceId) as { person_id: number };
      const oldPersonId = oldFace ? oldFace.person_id : null;

      insertPerson.run(normalizedName);
      const person = getPerson.get(normalizedName) as { id: number };
      updateFace.run(person.id, faceId);



      scheduleMeanRecalc(db, person.id);
      if (oldPersonId) {
        scheduleMeanRecalc(db, oldPersonId);
      }

      return person;
    });

    try {
      const result = transaction();
      return { success: true, person: result };
    } catch (e) {
      console.error('Failed to assign person:', e);
      return { success: false, error: e };
    }
  })

  ipcMain.handle('db:getLibraryStats', async () => {
    const db = getDB();
    const path = await import('node:path');

    try {
      // Register DIRNAME function if not exists (safe to retry)
      try {
        db.function('DIRNAME', (p: string) => path.dirname(p));
        // Also need extension extractor
        db.function('EXTNAME', (p: string) => path.extname(p).toLowerCase());
      } catch (e) {/* ignore */ }

      const totalPhotosObj = db.prepare('SELECT COUNT(*) as count FROM photos').get() as { count: number };
      const totalPhotos = totalPhotosObj.count;

      // File Types
      const fileTypes = db.prepare(`
              SELECT EXTNAME(file_path) as type, COUNT(*) as count 
              FROM photos 
              GROUP BY type 
              ORDER BY count DESC
          `).all();

      // Folders (reuse logic but return list)
      const folders = db.prepare(`
              SELECT DISTINCT DIRNAME(file_path) as folder, COUNT(*) as count 
              FROM photos 
              GROUP BY folder 
              ORDER BY count DESC
          `).all();

      return { success: true, stats: { totalPhotos, fileTypes, folders } };
    } catch (e) {
      console.error("Failed to get library stats:", e);
      return { success: false, error: e };
    }
  })

  ipcMain.handle('db:deleteFaces', async (_, faceIds: number[]) => {
    const db = getDB();
    try {
      if (!faceIds || faceIds.length === 0) return { success: true };
      const placeholders = faceIds.map(() => '?').join(',');

      const getPersonIds = db.prepare(`SELECT DISTINCT person_id FROM faces WHERE id IN (${placeholders}) AND person_id IS NOT NULL`);
      const personsToUpdate = getPersonIds.all(...faceIds).map((p: any) => p.person_id);

      const stmt = db.prepare(`DELETE FROM faces WHERE id IN (${placeholders})`);

      const transaction = db.transaction(() => {
        stmt.run(...faceIds);
        for (const pid of personsToUpdate) {
          recalculatePersonMean(db, pid);
        }
      });
      transaction();
      return { success: true };
    } catch (error) {
      logger.error('Failed to delete faces:', error);
      return { success: false, error };
    }
  })

  ipcMain.handle('db:reassignFaces', async (_, { faceIds, personName }: { faceIds: number[], personName: string }) => {
    const db = getDB();

    // Reuse logic: Find or Create person, then update faces
    const insertPerson = db.prepare('INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
    // ... rest of implementation ...
    // Note: The file cut off here in previous view, so I will append the new handlers at the end of the file or after a known block.
    // Actually, I should probably read the end of the file first to be safe, but I can append to the `ipcMain` block if I find a good anchor.
    // I will use the last known handler `db:deleteFaces` as anchor.

    const getPerson = db.prepare('SELECT id FROM people WHERE name = ?');

    // Check if we need to insert person first
    if (personName) {
      insertPerson.run(personName);
    }
    const person = getPerson.get(personName) as { id: number };

    if (!person) {
      return { success: false, error: 'Target person could not be created' };
    }

    try {
      if (!faceIds || faceIds.length === 0) return { success: true };
      const placeholders = faceIds.map(() => '?').join(',');

      // Get all affected ORIGINAL people
      const getOldPersonIds = db.prepare(`SELECT DISTINCT person_id FROM faces WHERE id IN (${placeholders}) AND person_id IS NOT NULL`);
      const oldPersonIds = getOldPersonIds.all(...faceIds).map((p: any) => p.person_id);

      const updateFaces = db.prepare(`UPDATE faces SET person_id = ? WHERE id IN (${placeholders})`);

      const transaction = db.transaction(() => {
        updateFaces.run(person.id, ...faceIds);

        // Recalculate new person mean
        recalculatePersonMean(db, person.id);

        // Recalculate old people means
        for (const oldPid of oldPersonIds) {
          recalculatePersonMean(db, oldPid);
        }
      });

      transaction();
      return { success: true, person };
    } catch (e) {
      console.error('Failed to reassign faces:', e);
      return { success: false, error: e };
    }
  })

  // --- Scan Error Tracking ---

  ipcMain.handle('db:getScanErrors', async () => {
    const db = getDB();
    try {
      const stmt = db.prepare('SELECT * FROM scan_errors ORDER BY timestamp DESC');
      return stmt.all();
    } catch (e) {
      console.error('Failed to get scan errors:', e);
      return [];
    }
  })

  ipcMain.handle('db:clearScanErrors', async () => {
    const db = getDB();
    try {
      db.exec('DELETE FROM scan_errors');
      return { success: true };
    } catch (e) {
      return { success: false, error: e };
    }
  })

  ipcMain.handle('db:retryScanErrors', async () => {
    // Return list of photos to retry
    const db = getDB();
    try {
      const stmt = db.prepare('SELECT photo_id FROM scan_errors');
      const rows = stmt.all();
      // We also delete them from errors so they can be retried fresh? 
      // Or keep them until success? 
      // Standard pattern: retry, if fail again, it logs again.
      db.exec('DELETE FROM scan_errors');

      // Get full photo objects for these IDs
      if (rows.length === 0) return [];
      const ids = rows.map((r: any) => r.photo_id);
      const placeholders = ids.map(() => '?').join(',');
      const photosStmt = db.prepare(`SELECT * FROM photos WHERE id IN (${placeholders})`);
      return photosStmt.all(...ids);

    } catch (e) {
      console.error('Failed to prepare retry:', e);
      return [];
    }
  })

})



ipcMain.handle('settings:getLibraryPath', () => {
  return LIBRARY_PATH;
});

ipcMain.handle('settings:moveLibrary', async (_, newPath: string) => {
  console.log(`[Main] Configuring move library to: ${newPath}`);

  // Validate
  try {
    const stats = await fs.stat(newPath);
    if (!stats.isDirectory()) return { success: false, error: 'Target is not a directory' };
  } catch {
    // Try creating? Or require existence? Let's require user to pick a valid folder.
    return { success: false, error: 'Target directory does not exist' };
  }

  try {
    closeDB();
    if (pythonProcess) pythonProcess.kill();

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
          // Source doesn't exist, skip
          continue;
        }
        // Critical error
        console.error(`Failed to copy ${item}:`, e);
        throw new Error(`Failed to copy ${item}: ${e.message}`);
      }
    }

    // Verify that critical files arrived?
    try {
      await fs.access(path.join(newPath, 'library.db'));
    } catch {
      // If library.db was skipped (e.g. didn't exist in old location), that's fine?
      // But if it existed and failed to copy, we threw above.
    }

    // 3. Update Store
    setLibraryPath(newPath);

    // 4. Cleanup Old Files (Optional, maybe keep as backup for now? Or user expects move?)
    // Use "Move" semantics, so delete old.
    console.log('Cleaning up old files...');
    for (const item of itemsToMove) {
      const src = path.join(LIBRARY_PATH, item);
      try {
        await fs.rm(src, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error(`Failed to cleanup ${src}:`, cleanupErr);
        // Non-critical
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

ipcMain.handle('db:unassignFaces', async (_, faceIds: number[]) => {
  const db = getDB();
  try {
    if (!faceIds || faceIds.length === 0) return { success: true };
    const placeholders = faceIds.map(() => '?').join(',');
    const stmt = db.prepare(`UPDATE faces SET person_id = NULL WHERE id IN (${placeholders})`);
    stmt.run(...faceIds);
    return { success: true };
  } catch (e) {
    console.error('Failed to unassign faces:', e);
    return { success: false, error: e };
  }
})

ipcMain.handle('db:getPerson', async (_, personId: number) => {
  const db = getDB();
  try {
    const stmt = db.prepare('SELECT * FROM people WHERE id = ?');
    const person = stmt.get(personId);
    return person || null;
  } catch (e) {
    console.error('Failed to get person:', e);
    return null;
  }
})

ipcMain.handle('db:getFolders', async () => {
  const { getDB } = await import('./db');
  const path = await import('node:path');
  const db = getDB();

  try {
    db.function('DIRNAME', (p: string) => path.dirname(p));
  } catch (e) {
    // Ignore if already registered
  }

  try {
    // Get unique folder paths
    const stmt = db.prepare(`
        SELECT DISTINCT DIRNAME(file_path) as folder, COUNT(*) as count 
        FROM photos 
        GROUP BY folder 
        ORDER BY count DESC
      `);
    return stmt.all();
  } catch (error) {
    console.error('Failed to get folders:', error);
    return [];
  }
})
ipcMain.handle('db:ignoreFace', async (_, faceId) => {
  const db = getDB();
  try {
    // Get person_id before ignoring
    const getFace = db.prepare('SELECT person_id FROM faces WHERE id = ?');
    const face = getFace.get(faceId) as { person_id: number };

    const stmt = db.prepare('UPDATE faces SET is_ignored = 1 WHERE id = ?');

    const transaction = db.transaction(() => {
      stmt.run(faceId);

      if (face && face.person_id) {
        scheduleMeanRecalc(db, face.person_id);
      }
    });
    transaction();
    return { success: true };
  } catch (e) {
    return { success: false, error: e };
  }
})

ipcMain.handle('db:ignoreFaces', async (_, faceIds: number[]) => {
  const db = getDB();
  try {
    if (!faceIds || faceIds.length === 0) return { success: true };
    const placeholders = faceIds.map(() => '?').join(',');
    const stmt = db.prepare(`UPDATE faces SET is_ignored = 1 WHERE id IN (${placeholders})`);
    const getPersonIds = db.prepare(`SELECT DISTINCT person_id FROM faces WHERE id IN (${placeholders}) AND person_id IS NOT NULL`);

    const personsToUpdate = getPersonIds.all(...faceIds).map((p: any) => p.person_id);

    const transaction = db.transaction(() => {
      stmt.run(...faceIds);

      for (const pid of personsToUpdate) {
        scheduleMeanRecalc(db, pid);
      }
    });
    transaction();
    return { success: true };
  } catch (e) {
    console.error('Failed to ignore faces:', e);
    return { success: false, error: e };
  }
})

// Helper to separate Mean Calculation from critical path
const pendingMeanRecalcs = new Map<number, NodeJS.Timeout>();

const scheduleMeanRecalc = (db: any, personId: number) => {
  if (pendingMeanRecalcs.has(personId)) {
    clearTimeout(pendingMeanRecalcs.get(personId)!);
  }

  const timeout = setTimeout(() => {
    pendingMeanRecalcs.delete(personId);
    try {
      console.log(`[Main] Running scheduled mean recalc for person ${personId}`);
      recalculatePersonMean(db, personId);
    } catch (e) {
      console.error(`[Main] Scheduled mean recalc failed for ${personId}`, e);
    }
  }, 2000); // 2 second debounce

  pendingMeanRecalcs.set(personId, timeout);
};

// Helper to recalculate mean
const recalculatePersonMean = (db: any, personId: number) => {
  // Re-calculate mean for this person, excluding ignored faces
  // descriptor_json column is dropped after migration, so we only use descriptor (BLOB)
  const allDescriptors = db.prepare('SELECT descriptor FROM faces WHERE person_id = ? AND is_ignored = 0').all(personId);

  if (allDescriptors.length === 0) {
    db.prepare('UPDATE people SET descriptor_mean_json = NULL WHERE id = ?').run(personId);
    return;
  }

  const vectors: number[][] = [];
  for (const row of allDescriptors) {
    if (row.descriptor) {
      vectors.push(Array.from(new Float32Array(row.descriptor.buffer, row.descriptor.byteOffset, row.descriptor.byteLength / 4)));
    }
  }

  if (vectors.length === 0) return;

  const dim = vectors[0].length;
  const mean = new Array(dim).fill(0);

  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      mean[i] += vec[i];
    }
  }

  let mag = 0;
  for (let i = 0; i < dim; i++) {
    mean[i] /= vectors.length;
    mag += mean[i] ** 2;
  }

  // L2 Normalize
  mag = Math.sqrt(mag);
  if (mag > 0) {
    for (let i = 0; i < dim; i++) {
      mean[i] /= mag;
    }
  }

  db.prepare('UPDATE people SET descriptor_mean_json = ? WHERE id = ?').run(JSON.stringify(mean), personId);
};

ipcMain.handle('db:removeDuplicateFaces', async () => {
  const db = getDB();
  try {
    // 1. Get photos with multiple faces
    const photosWithMultipleFaces = db.prepare(`
        SELECT photo_id, COUNT(*) as count 
        FROM faces 
        GROUP BY photo_id 
        HAVING count > 1
      `).all();

    let removedCount = 0;

    const deleteStmt = db.prepare('DELETE FROM faces WHERE id = ?');

    for (const p of photosWithMultipleFaces) {
      const photoId = p.photo_id;
      const faces = db.prepare('SELECT * FROM faces WHERE photo_id = ? ORDER BY id ASC').all(photoId);

      const facesToKeep: any[] = [];

      for (const face of faces) {
        const box = JSON.parse(face.box_json);
        let isDuplicate = false;

        // Check against kept faces
        for (const keptFace of facesToKeep) {
          const keptBox = JSON.parse(keptFace.box_json);

          // Calculate IoU
          const xA = Math.max(box.x, keptBox.x);
          const yA = Math.max(box.y, keptBox.y);
          const xB = Math.min(box.x + box.width, keptBox.x + keptBox.width);
          const yB = Math.min(box.y + box.height, keptBox.y + keptBox.height);

          const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
          if (interArea > 0) {
            const boxAArea = box.width * box.height;
            const boxBArea = keptBox.width * keptBox.height;
            const iou = interArea / (boxAArea + boxBArea - interArea);

            if (iou > 0.5) {
              isDuplicate = true;
              if (face.person_id && !keptFace.person_id) {
                // Logic to swap could go here, but simple first-pass is sufficient 
                // as sortedFaces handles priority
              }
              break;
            }
          }
        }

        if (!isDuplicate) {
          facesToKeep.push(face);
        }
      }

      // Refined Sorting Approach:
      // Sort faces so that "Defined Person" comes before "Unnamed".
      // Then iterate and checking duplicates will naturally keep the named ones.

      const sortedFaces = faces.sort((a: any, b: any) => {
        // If a has person and b doesn't, a comes first
        if (a.person_id && !b.person_id) return -1;
        if (!a.person_id && b.person_id) return 1;
        // Otherwise sort by ID (oldest first)
        return a.id - b.id;
      });

      const uniqueFaces: any[] = [];

      for (const face of sortedFaces) {
        const box = JSON.parse(face.box_json);
        let duplicate = false;

        for (const unique of uniqueFaces) {
          const uniqueBox = JSON.parse(unique.box_json);
          // IoU
          const xA = Math.max(box.x, uniqueBox.x);
          const yA = Math.max(box.y, uniqueBox.y);
          const xB = Math.min(box.x + box.width, uniqueBox.x + uniqueBox.width);
          const yB = Math.min(box.y + box.height, uniqueBox.y + uniqueBox.height);
          const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
          if (interArea > 0) {
            const boxAArea = box.width * box.height;
            const boxBArea = uniqueBox.width * uniqueBox.height;
            const iou = interArea / (boxAArea + boxBArea - interArea);
            if (iou > 0.5) {
              duplicate = true;
              break;
            }
          }
        }

        if (!duplicate) {
          uniqueFaces.push(face);
        } else {
          // Delete this face
          deleteStmt.run(face.id);
          removedCount++;
        }
      }
    }

    console.log(`Deduplication complete. Removed ${removedCount} faces.`);
    return { success: true, removedCount };
  } catch (e) {
    console.error('Failed to remove duplicates:', e);
    return { success: false, error: e };
  }
})

ipcMain.handle('db:getAllUnassignedFaceDescriptors', async () => {
  const db = getDB();
  try {
    // Get all unassigned and not ignored faces efficiently
    const stmt = db.prepare(`
        SELECT id, descriptor, photo_id 
        FROM faces 
        WHERE person_id IS NULL AND is_ignored = 0
      `);
    const rows = stmt.all();
    return rows.map((r: any) => ({
      id: r.id,
      photoId: r.photo_id,
      descriptor: r.descriptor ? Array.from(new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4)) : null
    }));
  } catch (e) {
    console.error('Failed to get unassigned descriptors:', e);
    return [];
  }
})

ipcMain.handle('db:factoryReset', async () => {
  const { getDB } = await import('./db');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const db = getDB();

  try {
    console.log("Commencing Factory Reset...");
    // 1. Clear Tables
    db.exec(`
            DELETE FROM photo_tags;
            DELETE FROM faces;
            DELETE FROM people;
            DELETE FROM tags;
            DELETE FROM photos;
            DELETE FROM sqlite_sequence; -- Reset autoincrement
            VACUUM;
        `);
    console.log("Database tables cleared.");

    // 2. Clear Previews
    // We need to know where the previews are. 
    // In the scanner, we might be storing them in appData/previews or next to files?
    // Let's check where they are stored. 
    // Based on previous reads, they are likely in appData.
    const userDataPath = app.getPath('userData');
    const previewDir = path.join(userDataPath, 'previews');

    try {
      await fs.rm(previewDir, { recursive: true, force: true });
      await fs.mkdir(previewDir, { recursive: true }); // Recreate empty dir
      console.log("Preview directory cleared.");
    } catch (err) {
      console.error("Error clearing preview directory (non-fatal):", err);
    }

    return { success: true };
  } catch (e) {
    console.error("Factory Reset Failed:", e);
    return { success: false, error: e };
  }
})



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

ipcMain.handle('db:getUnprocessedItems', async () => {
  const db = getDB();
  try {
    // Use scan_history as the source of truth for "Processed"
    // This allows resuming scans and ensuring everything gets a history entry.
    const stmt = db.prepare(`
            SELECT id, file_path FROM photos 
            WHERE id NOT IN (SELECT photo_id FROM scan_history WHERE status = 'success')
            ORDER BY created_at DESC
        `);
    const photos = stmt.all();
    console.log(`[Main] Found ${photos.length} unprocessed items.`);
    return photos;
  } catch (error) {
    console.error('Failed to get unprocessed items:', error);
    return [];
  }
})



ipcMain.handle('os:getLogPath', () => {
  return logger.getLogPath();
});

ipcMain.handle('os:showInFolder', (_, path) => {
  shell.showItemInFolder(path);
});

ipcMain.handle('os:openFolder', (_, path) => {
  shell.openPath(path);
});

// Global Error Handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});
