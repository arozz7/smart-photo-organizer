import { app, BrowserWindow, ipcMain, protocol, net, dialog } from 'electron'
import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url'
import { initDB } from './db'
import { scanDirectory } from './scanner'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  getLibraryPath, setLibraryPath,
  getAISettings, setAISettings
} from './store';
import * as fs from 'node:fs/promises';
import Store from 'electron-store';

const store = new Store();

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const LIBRARY_PATH = getLibraryPath();
console.log(`[Main] Library Path: ${LIBRARY_PATH}`);

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
  const pythonPath = path.join(process.env.APP_ROOT, 'src', 'python', '.venv', 'Scripts', 'python.exe');
  const scriptPath = path.join(process.env.APP_ROOT, 'src', 'python', 'main.py');

  console.log(`[Main] Starting Python Backend: ${pythonPath} ${scriptPath}`);

  pythonProcess = spawn(pythonPath, [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
      LIBRARY_PATH: LIBRARY_PATH
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
        console.log('[Python]', message);
        // Forward relevant messages to renderer if needed
        if (win && (message.type === 'scan_result' || message.type === 'tags_result')) {
          win.webContents.send('ai:scan-result', message);

          // Log errors if present
          if (message.error && message.photoId) {
            // We can't easily import db here due to scope, but we can do a quick check or just rely on Renderer to handle it?
            // Actually, Renderer receives it, so Renderer can call db:logScanError. 
            // BUT, if Renderer is backgrounded or busy, might be better here.
            // Let's rely on Renderer for now as it orchestrates the queue, OR simpler:
            // Let's make a dedicated helper to log it here if we want to be robust. 
            // For now, I'll stick to the plan: "Main: When Python returns an error... call db:logScanError"
            // Since I can't easily access 'db' instance here without importing, and 'db' is initialized later...
            // Wait, `initDB` is exported. `getDB` is exported.
            try {
              const { getDB } = await import('./db'); // Dynamic import to avoid circular dep issues if any
              const db = getDB();
              const logError = db.prepare('INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, (SELECT file_path FROM photos WHERE id = ?), ?, ?)');
              const stage = message.type === 'scan_result' ? 'Face Scan' : 'Smart Tags';
              logError.run(message.photoId, message.photoId, message.error, stage);
              console.log(`[Main] Logged scan error for ${message.photoId}`);
            } catch (err) {
              // DB might not be ready or other issue
              console.error("[Main] Failed to log auto-error:", err);
            }
          }

          if (scanPromises.has(message.photoId)) {
            const promise = scanPromises.get(message.photoId);
            if (message.error) {
              promise?.reject(message.error);
            } else {
              promise?.resolve(message);
            }
            scanPromises.delete(message.photoId);
          }
        }
      } catch (e) {
        console.log('[Python Raw]', line);
      }
    });
  }

  if (pythonProcess.stderr) {
    pythonProcess.stderr.on('data', (data) => {
      console.error(`[Python API Error]: ${data}`);
    });
  }

  pythonProcess.on('close', (code) => {
    console.log(`[Main] Python process exited with code ${code}`);
    pythonProcess = null;
  });
}

function sendToPython(command: any) {
  if (pythonProcess && pythonProcess.stdin) {
    pythonProcess.stdin.write(JSON.stringify(command) + '\n');
  } else {
    console.error('[Main] Python process not running. Queuing or dropping command.', command.type);
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

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'icon.png'),
    width: 1200,
    height: 800,
    show: false, // Hide initially
    backgroundColor: '#111827', // Set dark background
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: false,
    },
  })

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
    console.error(`[Main] Failed to create library path: ${LIBRARY_PATH}`, e);
  }

  initDB(LIBRARY_PATH)
  startPythonBackend()

  protocol.handle('local-resource', (request) => {
    const filePath = request.url.replace('local-resource://', '')
    const decodedPath = decodeURIComponent(filePath)
    return net.fetch(pathToFileURL(decodedPath).toString())
  })

  createSplashWindow()
  createWindow()

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
      console.error('Failed to read file:', filePath, error);
      throw error;
    }
  })

  // Handle Settings
  ipcMain.handle('ai:getSettings', () => {
    return getAISettings();
  });

  ipcMain.handle('ai:saveSettings', (event, settings) => {
    setAISettings(settings);
    // Propagate to Python
    if (pythonProcess && pythonProcess.stdin) {
      const cmd = { type: 'update_config', payload: { config: settings } };
      pythonProcess.stdin.write(JSON.stringify(cmd) + '\n');
    }
    return true;
  });

  // Handle Face Blur
  // Handle Face Blur
  ipcMain.handle('face:getBlurry', async (event, { personId, threshold, scope }) => {
    const { getDB } = await import('./db');
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
    const { getDB } = await import('./db');
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
    const { getDB } = await import('./db');
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
        } catch (e) { }
      }
      return { success: true, count, size };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('settings:cleanupPreviews', async (event, { days }) => {
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
        } catch (e) { }
      }
      return { success: true, deletedCount, deletedSize };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });


  ipcMain.handle('face:deleteFaces', async (event, faceIds) => {
    const { getDB } = await import('./db');
    const db = getDB();
    const deleteParams = faceIds.map(() => '?').join(',');
    const stmt = db.prepare(`DELETE FROM faces WHERE id IN (${deleteParams})`);
    stmt.run(...faceIds);
    return true;
  });

  ipcMain.handle('ai:scanImage', async (_, { photoId }) => {
    const { getDB } = await import('./db');
    const db = getDB();
    console.log(`[Main] Requesting AI scan for ${photoId}`);

    try {
      const stmt = db.prepare('SELECT file_path FROM photos WHERE id = ?');
      const photo = stmt.get(photoId) as { file_path: string };

      if (photo && photo.file_path) {
        const previewsDir = path.join(LIBRARY_PATH, 'previews');
        // const fs = await import('node:fs/promises'); // Already imported at top
        await fs.mkdir(previewsDir, { recursive: true });

        sendToPython({
          type: 'scan_image',
          payload: {
            photoId,
            filePath: photo.file_path,
            previewStorageDir: previewsDir
          }
        });

        // Wait for result
        return new Promise((resolve, reject) => {
          scanPromises.set(photoId, { resolve, reject });

          // Timeout safety (30s)
          setTimeout(() => {
            if (scanPromises.has(photoId)) {
              scanPromises.delete(photoId);
              reject('Scan timed out');
            }
          }, 30000);
        });
      } else {
        console.error('[Main] Photo not found or no path:', photoId);
        return { success: false, error: 'Photo not found' };
      }
    } catch (e) {
      console.error('[Main] Failed to lookup photo for AI:', e);
      return { success: false, error: e };
    }
  })

  ipcMain.handle('ai:generateTags', async (_, { photoId }) => {
    const { getDB } = await import('./db');
    const db = getDB();
    console.log(`[Main] Requesting Tags (VLM) for ${photoId}`);

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
      console.error('[Main] Failed to lookup photo for VLM:', e);
      return { success: false, error: e };
    }
  })

  ipcMain.handle('db:addTags', async (_, { photoId, tags }: { photoId: number, tags: string[] }) => {
    // We need to import db helper here or move it to a shared place.
    // For now we can import getDB from ./db
    const { getDB } = await import('./db');
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
      console.error('Failed to add tags:', error);
      return { success: false, error };
    }
  })

  ipcMain.handle('db:getTags', async (_, photoId: number) => {
    const { getDB } = await import('./db');
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
      console.error('Failed to get tags:', error);
      return [];
    }
  })

  ipcMain.handle('db:clearAITags', async () => {
    const { getDB } = await import('./db');
    const db = getDB();
    try {
      db.exec(`
        DELETE FROM photo_tags WHERE source = 'AI';
        DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM photo_tags);
      `);
      console.log('Cleared all AI tags.');
      return { success: true };
    } catch (error) {
      console.error('Failed to clear AI tags:', error);
      return { success: false, error };
    }
  })

  ipcMain.handle('db:getPhotos', async (_, { limit = 50, offset = 0, filter = {} } = {}) => {
    const { getDB } = await import('./db');
    const db = getDB();
    try {
      console.log(`[Main] db:getPhotos request: limit=${limit}, offset=${offset}, filter=`, filter);
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

      // Filter: Specific Tag
      if (filter.tag) {
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
        // Find photos that contain ANY of the selected people
        // (Use separate logic if you want ALL, but ANY is standard for filters)
        const placeholders = filter.people.map(() => '?').join(',');
        conditions.push(`p.id IN (
          SELECT f.photo_id FROM faces f
          WHERE f.person_id IN (${placeholders})
        )`);
        params.push(...filter.people);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const stmt = db.prepare(query);
      const photos = stmt.all(...params);
      console.log(`[Main] db:getPhotos returned ${photos.length} photos.`);
      return photos;
    } catch (error) {
      console.error('Failed to get photos:', error);
      return [];
    }
  })

  ipcMain.handle('db:getPhotosForRescan', async (_, { filter = {} } = {}) => {
    const { getDB } = await import('./db');
    const db = getDB();
    try {
      let query = 'SELECT p.id, p.file_path, p.preview_cache_path FROM photos p';
      const params: any[] = [];
      const conditions: string[] = [];

      if (filter.untagged) {
        conditions.push(`p.id NOT IN (SELECT photo_id FROM photo_tags)`);
      }

      if (filter.folder) {
        conditions.push(`p.file_path LIKE ?`);
        params.push(`${filter.folder}%`);
      }

      if (filter.tag) {
        conditions.push(`p.id IN (
          SELECT pt.photo_id FROM photo_tags pt
          JOIN tags t ON pt.tag_id = t.id
          WHERE t.name = ?
        )`);
        params.push(filter.tag);
      }

      // Filter: Specific People (Array of IDs)
      if (filter.people && Array.isArray(filter.people) && filter.people.length > 0) {
        const placeholders = filter.people.map(() => '?').join(',');
        conditions.push(`p.id IN (
          SELECT f.photo_id FROM faces f
          WHERE f.person_id IN (${placeholders})
        )`);
        params.push(...filter.people);
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
    const { getDB } = await import('./db');
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
    const { getDB } = await import('./db');
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

  ipcMain.handle('db:updateFaces', async (_, { photoId, faces, previewPath, width, height, globalBlurScore }) => {
    const { getDB } = await import('./db');
    const db = getDB();

    try {
      const getOldFaces = db.prepare('SELECT id, box_json, person_id FROM faces WHERE photo_id = ?');
      const updateFace = db.prepare('UPDATE faces SET box_json = ?, descriptor_json = ?, blur_score = ? WHERE id = ?');
      const insertFace = db.prepare('INSERT INTO faces (photo_id, box_json, descriptor_json, person_id, blur_score) VALUES (?, ?, ?, ?, ?)');
      const deleteFace = db.prepare('DELETE FROM faces WHERE id = ?');
      const getAllKnownPeople = db.prepare('SELECT id, descriptor_mean_json FROM people WHERE descriptor_mean_json IS NOT NULL');
      // Fallback for people without mean yet
      const getAllKnownFaces = db.prepare('SELECT person_id, descriptor_json FROM faces WHERE person_id IS NOT NULL');

      const updatePhotoPreview = db.prepare('UPDATE photos SET preview_cache_path = ? WHERE id = ?');
      const updatePhotoDims = db.prepare('UPDATE photos SET width = ?, height = ? WHERE id = ?');
      const updatePhotoBlur = db.prepare('UPDATE photos SET blur_score = ? WHERE id = ?');

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

              // Lower IoU threshold to 0.25 to account for different cropping styles between old/new models
              if (iou > 0.25 && iou > maxIoU) {
                maxIoU = iou;
                // @ts-ignore
                bestMatchId = oldFace.id;
              }
            }
          }

          if (bestMatchId) {
            // UPDATE existing face (keep person_id)
            updateFace.run(JSON.stringify(newBox), JSON.stringify(newFace.descriptor), newFace.blur_score || null, bestMatchId);
            usedOldFaceIds.add(bestMatchId);
            // We should update the person's mean if we updated their descriptor? 
            // Yes, checking if they have a person_id
            // @ts-ignore
            const oldFace = oldFaces.find(f => f.id === bestMatchId);
            // @ts-ignore
            if (oldFace && oldFace.person_id) peopleToUpdate.add(oldFace.person_id);

          } else {
            // INSERT new face (Auto-recognize)
            let matchedPersonId = null;
            let bestDistance = 0.6; // Cosine Distance Threshold (Relaxed from 0.4)

            // A. Try matching against People Means (Fast & Robust)
            const knownPeople = getAllKnownPeople.all();
            for (const person of knownPeople) {
              // @ts-ignore
              const meanDesc = JSON.parse(person.descriptor_mean_json);

              let dot = 0, mag1 = 0, mag2 = 0;
              // vector length check
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

            // B. Fallback: If no match found yet, try matching against ALL faces 
            // (for people who don't have a mean yet, e.g. imported before migration)
            if (!matchedPersonId) {
              const knownFaces = getAllKnownFaces.all();
              for (const known of knownFaces) {
                // @ts-ignore
                const knownDesc = JSON.parse(known.descriptor_json);
                let dot = 0, mag1 = 0, mag2 = 0;
                if (newFace.descriptor.length !== knownDesc.length) continue;

                for (let i = 0; i < newFace.descriptor.length; i++) {
                  dot += newFace.descriptor[i] * knownDesc[i];
                  mag1 += newFace.descriptor[i] ** 2;
                  mag2 += knownDesc[i] ** 2;
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

            insertFace.run(photoId, JSON.stringify(newBox), JSON.stringify(newFace.descriptor), matchedPersonId, newFace.blur_score || null);
            if (matchedPersonId) peopleToUpdate.add(matchedPersonId);
          }
        }

        // 2. Delete Unmatched Old Faces (Ghost faces removal)
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
        for (const pid of peopleToUpdate) {
          recalculatePersonMean(db, pid);
        }
      });

      transaction();
      return { success: true };
    } catch (error) {
      console.error('Failed to update faces:', error);
      return { success: false, error };
    }
  })

  ipcMain.handle('db:getFaces', async (_, photoId: number) => {
    const { getDB } = await import('./db');
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
        descriptor: JSON.parse(f.descriptor_json)
      }));
    } catch (error) {
      console.error('Failed to get faces:', error);
      return [];
    }
  })

  ipcMain.handle('db:getPeople', async () => {
    const { getDB } = await import('./db');
    const db = getDB();
    try {
      const stmt = db.prepare(`
        SELECT p.*, COUNT(f.id) as face_count,
        (SELECT COALESCE(ph.preview_cache_path, ph.file_path) FROM faces f2 JOIN photos ph ON f2.photo_id = ph.id WHERE f2.person_id = p.id LIMIT 1) as cover_path,
        (SELECT f2.box_json FROM faces f2 WHERE f2.person_id = p.id LIMIT 1) as cover_box,
        (SELECT ph.width FROM faces f2 JOIN photos ph ON f2.photo_id = ph.id WHERE f2.person_id = p.id LIMIT 1) as cover_width,
        (SELECT ph.height FROM faces f2 JOIN photos ph ON f2.photo_id = ph.id WHERE f2.person_id = p.id LIMIT 1) as cover_height
        FROM people p
        LEFT JOIN faces f ON f.person_id = p.id
        GROUP BY p.id
        ORDER BY face_count DESC
      `);
      return stmt.all();
    } catch (error) {
      console.error('Failed to get people', error);
      return [];
    }
  })

  ipcMain.handle('db:getAllFaces', async (_, { limit = 100, offset = 0, filter = {} } = {}) => {
    const { getDB } = await import('./db');
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
        descriptor: JSON.parse(f.descriptor_json)
      }));
    } catch (error) {
      console.error('Failed to get all faces:', error);
      return [];
    }
  })

  ipcMain.handle('db:assignPerson', async (_, { faceId, personName }) => {
    const { getDB } = await import('./db');
    const db = getDB();

    const insertPerson = db.prepare('INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
    const getPerson = db.prepare('SELECT id FROM people WHERE name = ?');
    const getOldPersonId = db.prepare('SELECT person_id FROM faces WHERE id = ?');
    const updateFace = db.prepare('UPDATE faces SET person_id = ? WHERE id = ?');

    const transaction = db.transaction(() => {
      // Check old person (if any) to update their mean later
      const oldFace = getOldPersonId.get(faceId) as { person_id: number };
      const oldPersonId = oldFace ? oldFace.person_id : null;

      insertPerson.run(personName);
      const person = getPerson.get(personName) as { id: number };
      updateFace.run(person.id, faceId);

      recalculatePersonMean(db, person.id);
      if (oldPersonId) {
        recalculatePersonMean(db, oldPersonId);
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
    const { getDB } = await import('./db');
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
    const { getDB } = await import('./db');
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
      console.error('Failed to delete faces:', error);
      return { success: false, error };
    }
  })

  ipcMain.handle('db:reassignFaces', async (_, { faceIds, personName }: { faceIds: number[], personName: string }) => {
    const { getDB } = await import('./db');
    const db = getDB();

    // Reuse logic: Find or Create person, then update faces
    const insertPerson = db.prepare('INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
    // ... rest of implementation ...
    // Note: The file cut off here in previous view, so I will append the new handlers at the end of the file or after a known block.
    // Actually, I should probably read the end of the file first to be safe, but I can append to the `ipcMain` block if I find a good anchor.
    // I'll use the last known handler `db:reassignFaces` as anchor? No, that was cut off.
    // I will use `ipcMain.handle('db:deleteFaces'` as anchor.

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
    const { getDB } = await import('./db');
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
    const { getDB } = await import('./db');
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
    const { getDB } = await import('./db');
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

  // Helper for recalculating mean (duplicate logic but useful)
  const recalculatePersonMean = (db: any, personId: number) => {
    try {
      const faces = db.prepare('SELECT descriptor_json FROM faces WHERE person_id = ? AND is_ignored = 0').all(personId);
      if (faces.length === 0) {
        // No faces left? Nullify mean? Keep it? Nullify.
        db.prepare('UPDATE people SET descriptor_mean_json = NULL WHERE id = ?').run(personId);
        return;
      }

      const descriptors = faces.map((f: any) => JSON.parse(f.descriptor_json));
      if (descriptors.length === 0) return;

      const dim = descriptors[0].length;
      const mean = new Array(dim).fill(0);

      for (const desc of descriptors) {
        for (let i = 0; i < dim; i++) {
          mean[i] += desc[i];
        }
      }

      for (let i = 0; i < dim; i++) {
        mean[i] /= descriptors.length;
      }

      db.prepare('UPDATE people SET descriptor_mean_json = ? WHERE id = ?').run(JSON.stringify(mean), personId);

    } catch (e) {
      console.error('Mean recalc failed', e);
    }
  }

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

  const { closeDB } = await import('./db');

  try {
    // 1. Close Database
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
  const { getDB } = await import('./db');
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
  const { getDB } = await import('./db');
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
  const { getDB } = await import('./db');
  const db = getDB();
  try {
    // Get person_id before ignoring
    const getFace = db.prepare('SELECT person_id FROM faces WHERE id = ?');
    const face = getFace.get(faceId) as { person_id: number };

    const stmt = db.prepare('UPDATE faces SET is_ignored = 1 WHERE id = ?');

    const transaction = db.transaction(() => {
      stmt.run(faceId);
      if (face && face.person_id) {
        recalculatePersonMean(db, face.person_id);
      }
    });
    transaction();
    return { success: true };
  } catch (e) {
    return { success: false, error: e };
  }
})

ipcMain.handle('db:ignoreFaces', async (_, faceIds: number[]) => {
  const { getDB } = await import('./db');
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
        recalculatePersonMean(db, pid);
      }
    });
    transaction();
    return { success: true };
  } catch (e) {
    console.error('Failed to ignore faces:', e);
    return { success: false, error: e };
  }
})

// Helper to recalculate mean
const recalculatePersonMean = (db: any, personId: number) => {
  // Re-calculate mean for this person, excluding ignored faces
  const allDescriptors = db.prepare('SELECT descriptor_json FROM faces WHERE person_id = ? AND is_ignored = 0').all(personId);

  if (allDescriptors.length === 0) {
    // Even if 0 faces, we should probably clear the mean or leave it? 
    // If no faces, mean is undefined. Set to NULL.
    db.prepare('UPDATE people SET descriptor_mean_json = NULL WHERE id = ?').run(personId);
    return;
  }

  const vectors = allDescriptors.map((d: any) => JSON.parse(d.descriptor_json));
  if (vectors.length === 0) return;

  const dim = vectors[0].length;
  const mean = new Array(dim).fill(0);

  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      mean[i] += vec[i];
    }
  }

  for (let i = 0; i < dim; i++) {
    mean[i] /= vectors.length;
  }

  db.prepare('UPDATE people SET descriptor_mean_json = ? WHERE id = ?').run(JSON.stringify(mean), personId);
};

ipcMain.handle('db:removeDuplicateFaces', async () => {
  const { getDB } = await import('./db');
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
  const { getDB } = await import('./db');
  const db = getDB();
  try {
    // Get all unassigned and not ignored faces efficiently
    const stmt = db.prepare(`
        SELECT id, descriptor_json, photo_id 
        FROM faces 
        WHERE person_id IS NULL AND is_ignored = 0
      `);
    const rows = stmt.all();
    return rows.map((r: any) => ({
      id: r.id,
      photoId: r.photo_id,
      descriptor: JSON.parse(r.descriptor_json)
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
  const { getDB } = await import('./db');
  const db = getDB();
  try {
    // Find photos that have NO AI tags. This assumes every processed photo gets at least one tag or a marker.
    const stmt = db.prepare(`
            SELECT id, file_path FROM photos 
            WHERE id NOT IN (SELECT photo_id FROM photo_tags WHERE source = 'AI')
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



