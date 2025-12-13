import { app, BrowserWindow, ipcMain, protocol, net, dialog } from 'electron'
import { pathToFileURL } from 'node:url'
import { initDB } from './db'
import { scanDirectory } from './scanner'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: false,
    },
  })

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

app.whenReady().then(() => {
  initDB()

  protocol.handle('local-resource', (request) => {
    const filePath = request.url.replace('local-resource://', '')
    const decodedPath = decodeURIComponent(filePath)
    return net.fetch(pathToFileURL(decodedPath).toString())
  })

  createWindow()

  ipcMain.handle('scan-directory', async (event, dirPath) => {
    return await scanDirectory(dirPath, (count) => {
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

  ipcMain.handle('db:updateFaces', async (_, { photoId, faces }) => {
    const { getDB } = await import('./db');
    const db = getDB();

    try {
      const getOldFaces = db.prepare('SELECT id, box_json, person_id FROM faces WHERE photo_id = ?');
      const updateFace = db.prepare('UPDATE faces SET box_json = ?, descriptor_json = ? WHERE id = ?');
      const insertFace = db.prepare('INSERT INTO faces (photo_id, box_json, descriptor_json, person_id) VALUES (?, ?, ?, ?)');
      const deleteFace = db.prepare('DELETE FROM faces WHERE id = ?');
      const getAllKnownFaces = db.prepare('SELECT person_id, descriptor_json FROM faces WHERE person_id IS NOT NULL');

      const transaction = db.transaction(() => {
        const oldFaces = getOldFaces.all(photoId);
        const usedOldFaceIds = new Set<number>();

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

              if (iou > 0.5 && iou > maxIoU) {
                maxIoU = iou;
                // @ts-ignore
                bestMatchId = oldFace.id;
              }
            }
          }

          if (bestMatchId) {
            // UPDATE existing face (keep person_id)
            updateFace.run(JSON.stringify(newBox), JSON.stringify(newFace.descriptor), bestMatchId);
            usedOldFaceIds.add(bestMatchId);
          } else {
            // INSERT new face (Auto-recognize if possible)
            let matchedPersonId = null;
            const knownFaces = getAllKnownFaces.all();
            let bestDistance = 0.4; // Cosine Distance Threshold

            for (const known of knownFaces) {
              // @ts-ignore
              const knownDesc = JSON.parse(known.descriptor_json);

              // Cosine Distance
              let dot = 0, mag1 = 0, mag2 = 0;
              if (newFace.descriptor.length === knownDesc.length) {
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

            insertFace.run(photoId, JSON.stringify(newBox), JSON.stringify(newFace.descriptor), matchedPersonId);
          }
        }

        // 2. Delete Unmatched Old Faces (Ghost faces removal)
        for (const oldFace of oldFaces) {
          // @ts-ignore
          if (!usedOldFaceIds.has(oldFace.id)) {
            // @ts-ignore
            deleteFace.run(oldFace.id);
          }
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
    const updateFace = db.prepare('UPDATE faces SET person_id = ? WHERE id = ?');

    const transaction = db.transaction(() => {
      insertPerson.run(personName);
      const person = getPerson.get(personName) as { id: number };
      updateFace.run(person.id, faceId);
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

  ipcMain.handle('db:reassignFaces', async (_, { faceIds, personName }: { faceIds: number[], personName: string }) => {
    const { getDB } = await import('./db');
    const db = getDB();

    // Reuse logic: Find or Create person, then update faces
    const insertPerson = db.prepare('INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
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
      const stmt = db.prepare(`UPDATE faces SET person_id = ? WHERE id IN (${placeholders})`);
      stmt.run(person.id, ...faceIds);
      return { success: true, personId: person.id };
    } catch (e) {
      console.error('Failed to reassign faces:', e);
      return { success: false, error: e };
    }
  })

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
      const stmt = db.prepare('UPDATE faces SET is_ignored = 1 WHERE id = ?');
      stmt.run(faceId);
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
      stmt.run(...faceIds);
      return { success: true };
    } catch (e) {
      console.error('Failed to ignore faces:', e);
      return { success: false, error: e };
    }
  })

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
})

