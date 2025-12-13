import { app, BrowserWindow, protocol, net, ipcMain, dialog } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import path from "node:path";
import { promises } from "node:fs";
import { ExifTool } from "exiftool-vendored";
import sharp from "sharp";
import { createRequire } from "node:module";
let db;
function initDB() {
  const dbPath = path.join(app.getPath("userData"), "library.db");
  console.log("Initializing Database at:", dbPath);
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT UNIQUE NOT NULL,
      file_hash TEXT,
      preview_cache_path TEXT,
      created_at DATETIME,
      width INTEGER,
      height INTEGER,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS photo_tags (
      photo_id INTEGER,
      tag_id INTEGER,
      source TEXT,
      PRIMARY KEY (photo_id, tag_id),
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS faces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id INTEGER,
      box_json TEXT,
      descriptor_json TEXT,
      person_id INTEGER,
      is_ignored BOOLEAN DEFAULT 0,
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL
    );
  `);
  try {
    db.exec("ALTER TABLE faces ADD COLUMN is_ignored BOOLEAN DEFAULT 0");
  } catch (e) {
  }
  console.log("Database schema ensured.");
}
function getDB() {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}
const db$1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  getDB,
  initDB
}, Symbol.toStringTag, { value: "Module" }));
let _exiftool = null;
let _exiftoolInitPromise = null;
async function getExifTool() {
  if (_exiftool) return _exiftool;
  if (_exiftoolInitPromise) return _exiftoolInitPromise;
  _exiftoolInitPromise = (async () => {
    try {
      console.log("Initializing ExifTool...");
      const tool = new ExifTool({
        taskTimeoutMillis: 5e3,
        maxProcs: 1
      });
      const initCheck = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("ExifTool startup timed out")), 3e4);
        tool.version().then((v) => {
          clearTimeout(timer);
          resolve(v);
        }).catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
      });
      const version = await initCheck;
      console.log(`ExifTool started successfully. Version: ${version}`);
      _exiftool = tool;
      return tool;
    } catch (err) {
      console.error("FAILED to initialize ExifTool. RAW support will be disabled.", err);
      return null;
    }
  })();
  return _exiftoolInitPromise;
}
const SUPPORTED_EXTS = [".jpg", ".jpeg", ".png", ".arw", ".cr2", ".nef", ".dng", ".orf", ".rw2", ".tif", ".tiff"];
async function scanDirectory(dirPath, onProgress) {
  const db2 = getDB();
  const photos = [];
  let count = 0;
  const previewDir = path.join(app.getPath("userData"), "previews");
  await promises.mkdir(previewDir, { recursive: true });
  const insertStmt = db2.prepare(`
    INSERT INTO photos (file_path, preview_cache_path, created_at, metadata_json) 
    VALUES (@file_path, @preview_cache_path, @created_at, @metadata_json)
    ON CONFLICT(file_path) DO NOTHING
  `);
  const selectStmt = db2.prepare("SELECT * FROM photos WHERE file_path = ?");
  async function extractPreview(filePath) {
    const fileName = path.basename(filePath);
    const previewName = `${fileName}.jpg`;
    const previewPath = path.join(previewDir, previewName);
    try {
      try {
        await promises.access(previewPath);
        return previewPath;
      } catch {
        const ext = path.extname(filePath).toLowerCase();
        const isRaw = ![".jpg", ".jpeg", ".png"].includes(ext);
        if (isRaw) {
          let extracted = false;
          if (![".tif", ".tiff"].includes(ext)) {
            try {
              const tool = await getExifTool();
              if (tool) {
                const timeoutPromise = new Promise(
                  (_, reject) => setTimeout(() => reject(new Error("Preview extraction timed out")), 15e3)
                );
                await Promise.race([
                  tool.extractPreview(filePath, previewPath),
                  timeoutPromise
                ]);
                await promises.access(previewPath);
                console.log(`Extracted preview for ${fileName}`);
                extracted = true;
              }
            } catch (e) {
            }
          }
          if (!extracted) {
            try {
              console.log(`Generating preview with Sharp for ${fileName}...`);
              await sharp(filePath).rotate().resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(previewPath);
              console.log(`Generated preview with Sharp for ${fileName}`);
              extracted = true;
            } catch (sharpErr) {
              console.error(`Sharp conversion failed for ${fileName}:`, sharpErr);
            }
          }
          if (extracted) return previewPath;
        }
      }
    } catch (e) {
      console.error(`Failed to extract/generate preview for ${filePath}`, e);
    }
    return null;
  }
  let totalFiles = 0;
  const skippedStats = {};
  async function scan(currentPath) {
    try {
      console.log(`Scanning directory: ${currentPath}`);
      const entries = await promises.readdir(currentPath, { withFileTypes: true });
      console.log(`Found ${entries.length} entries in ${currentPath}`);
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".")) {
            await scan(fullPath);
          }
        } else if (entry.isFile()) {
          totalFiles++;
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTS.includes(ext)) {
            let photo = selectStmt.get(fullPath);
            let needsUpdate = false;
            if (photo) {
              const isRaw = ![".jpg", ".jpeg", ".png"].includes(ext);
              if (isRaw && !photo.preview_cache_path) {
                const tool = await getExifTool();
                if (tool) {
                  const previewPath = await extractPreview(fullPath);
                  if (previewPath) {
                    db2.prepare("UPDATE photos SET preview_cache_path = ? WHERE id = ?").run(previewPath, photo.id);
                    photo.preview_cache_path = previewPath;
                    needsUpdate = true;
                  }
                }
              }
              if (!photo.metadata_json || photo.metadata_json === "{}") {
                try {
                  const tool = await getExifTool();
                  if (tool) {
                    const metadata = await tool.read(fullPath);
                    db2.prepare("UPDATE photos SET metadata_json = ? WHERE id = ?").run(JSON.stringify(metadata), photo.id);
                    photo.metadata_json = JSON.stringify(metadata);
                    needsUpdate = true;
                  }
                } catch (e) {
                  console.error(`Failed to backfill metadata for ${fullPath}`, e);
                }
              }
            }
            if (!photo) {
              console.log(`[Scanner] New photo found: ${entry.name}`);
              const previewPath = await extractPreview(fullPath);
              try {
                let metadata = {};
                try {
                  const tool = await getExifTool();
                  if (tool) {
                    metadata = await tool.read(fullPath);
                  }
                } catch (e) {
                  console.error(`Failed to read metadata for ${fullPath}`, e);
                }
                insertStmt.run({
                  file_path: fullPath,
                  preview_cache_path: previewPath,
                  created_at: (/* @__PURE__ */ new Date()).toISOString(),
                  metadata_json: JSON.stringify(metadata)
                });
                photo = selectStmt.get(fullPath);
              } catch (e) {
                console.error("Insert failed", e);
              }
            }
            if (photo) {
              photos.push(photo);
              count++;
              if (count % 10 === 0 || needsUpdate) {
                if (onProgress) onProgress(count);
                await new Promise((resolve) => setTimeout(resolve, 0));
              }
            }
          } else {
            skippedStats[ext] = (skippedStats[ext] || 0) + 1;
          }
        }
      }
    } catch (err) {
      console.error(`Error scanning ${currentPath}:`, err);
    }
  }
  await scan(dirPath);
  console.log(`[Scanner] Total files: ${totalFiles}, Processed: ${count}, Returned: ${photos.length}`);
  console.log(`[Scanner] Skipped Extensions:`, skippedStats);
  return photos;
}
createRequire(import.meta.url);
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = path.dirname(__filename$1);
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      webSecurity: false
    }
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.whenReady().then(() => {
  initDB();
  protocol.handle("local-resource", (request) => {
    const filePath = request.url.replace("local-resource://", "");
    const decodedPath = decodeURIComponent(filePath);
    return net.fetch(pathToFileURL(decodedPath).toString());
  });
  createWindow();
  ipcMain.handle("scan-directory", async (event, dirPath) => {
    return await scanDirectory(dirPath, (count) => {
      event.sender.send("scan-progress", count);
    });
  });
  ipcMain.handle("dialog:openDirectory", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openDirectory"]
    });
    if (canceled) {
      return null;
    } else {
      return filePaths[0];
    }
  });
  ipcMain.handle("read-file-buffer", async (_, filePath) => {
    const fs = await import("node:fs/promises");
    try {
      const buffer = await fs.readFile(filePath);
      return buffer;
    } catch (error) {
      console.error("Failed to read file:", filePath, error);
      throw error;
    }
  });
  ipcMain.handle("db:addTags", async (_, { photoId, tags }) => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    const insertTag = db2.prepare("INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING");
    const getTagId = db2.prepare("SELECT id FROM tags WHERE name = ?");
    const linkTag = db2.prepare(`
      INSERT INTO photo_tags (photo_id, tag_id, source) 
      VALUES (@photoId, @tagId, 'AI') 
      ON CONFLICT(photo_id, tag_id) DO NOTHING
    `);
    const transaction = db2.transaction((photoId2, tags2) => {
      for (const tag of tags2) {
        insertTag.run(tag);
        const tagRecord = getTagId.get(tag);
        if (tagRecord) {
          linkTag.run({ photoId: photoId2, tagId: tagRecord.id });
        }
      }
    });
    try {
      transaction(photoId, tags);
      return { success: true };
    } catch (error) {
      console.error("Failed to add tags:", error);
      return { success: false, error };
    }
  });
  ipcMain.handle("db:getTags", async (_, photoId) => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    const stmt = db2.prepare(`
      SELECT t.name FROM tags t
      JOIN photo_tags pt ON pt.tag_id = t.id
      WHERE pt.photo_id = ?
    `);
    try {
      const tags = stmt.all(photoId);
      return tags.map((t) => t.name);
    } catch (error) {
      console.error("Failed to get tags:", error);
      return [];
    }
  });
  ipcMain.handle("db:clearAITags", async () => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    try {
      db2.exec(`
        DELETE FROM photo_tags WHERE source = 'AI';
        DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM photo_tags);
      `);
      console.log("Cleared all AI tags.");
      return { success: true };
    } catch (error) {
      console.error("Failed to clear AI tags:", error);
      return { success: false, error };
    }
  });
  ipcMain.handle("db:getPhotos", async (_, { limit = 50, offset = 0, filter = {} } = {}) => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    try {
      console.log(`[Main] db:getPhotos request: limit=${limit}, offset=${offset}, filter=`, filter);
      let query = "SELECT p.* FROM photos p";
      const params = [];
      const conditions = [];
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
      if (filter.people && Array.isArray(filter.people) && filter.people.length > 0) {
        const placeholders = filter.people.map(() => "?").join(",");
        conditions.push(`p.id IN (
          SELECT f.photo_id FROM faces f
          WHERE f.person_id IN (${placeholders})
        )`);
        params.push(...filter.people);
      }
      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }
      query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);
      const stmt = db2.prepare(query);
      const photos = stmt.all(...params);
      console.log(`[Main] db:getPhotos returned ${photos.length} photos.`);
      return photos;
    } catch (error) {
      console.error("Failed to get photos:", error);
      return [];
    }
  });
  ipcMain.handle("db:getPhotosForRescan", async (_, { filter = {} } = {}) => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    try {
      let query = "SELECT p.id, p.file_path, p.preview_cache_path FROM photos p";
      const params = [];
      const conditions = [];
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
      if (filter.people && Array.isArray(filter.people) && filter.people.length > 0) {
        const placeholders = filter.people.map(() => "?").join(",");
        conditions.push(`p.id IN (
          SELECT f.photo_id FROM faces f
          WHERE f.person_id IN (${placeholders})
        )`);
        params.push(...filter.people);
      }
      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }
      query += " ORDER BY created_at DESC";
      const stmt = db2.prepare(query);
      return stmt.all(...params);
    } catch (error) {
      console.error("Failed to get photos for rescan:", error);
      return [];
    }
  });
  ipcMain.handle("db:getAllTags", async () => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    try {
      const stmt = db2.prepare(`
        SELECT t.name, COUNT(pt.photo_id) as count
        FROM tags t
        JOIN photo_tags pt ON t.id = pt.tag_id
        GROUP BY t.id
        ORDER BY count DESC
      `);
      return stmt.all();
    } catch (error) {
      console.error("Failed to get all tags:", error);
      return [];
    }
  });
  ipcMain.handle("db:removeTag", async (_, { photoId, tag }) => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    try {
      const stmt = db2.prepare(`
        DELETE FROM photo_tags 
        WHERE photo_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)
      `);
      stmt.run(photoId, tag);
      return { success: true };
    } catch (error) {
      console.error("Failed to remove tag:", error);
      return { success: false, error };
    }
  });
  ipcMain.handle("db:updateFaces", async (_, { photoId, faces }) => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    try {
      const getOldFaces = db2.prepare("SELECT id, box_json, person_id FROM faces WHERE photo_id = ?");
      const updateFace = db2.prepare("UPDATE faces SET box_json = ?, descriptor_json = ? WHERE id = ?");
      const insertFace = db2.prepare("INSERT INTO faces (photo_id, box_json, descriptor_json, person_id) VALUES (?, ?, ?, ?)");
      const deleteFace = db2.prepare("DELETE FROM faces WHERE id = ?");
      const getAllKnownFaces = db2.prepare("SELECT person_id, descriptor_json FROM faces WHERE person_id IS NOT NULL");
      const transaction = db2.transaction(() => {
        const oldFaces = getOldFaces.all(photoId);
        const usedOldFaceIds = /* @__PURE__ */ new Set();
        for (const newFace of faces) {
          const newBox = newFace.box;
          let bestMatchId = null;
          let maxIoU = 0;
          for (const oldFace of oldFaces) {
            if (usedOldFaceIds.has(oldFace.id)) continue;
            const oldBox = JSON.parse(oldFace.box_json);
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
                bestMatchId = oldFace.id;
              }
            }
          }
          if (bestMatchId) {
            updateFace.run(JSON.stringify(newBox), JSON.stringify(newFace.descriptor), bestMatchId);
            usedOldFaceIds.add(bestMatchId);
          } else {
            let matchedPersonId = null;
            const knownFaces = getAllKnownFaces.all();
            let bestDistance = 0.4;
            for (const known of knownFaces) {
              const knownDesc = JSON.parse(known.descriptor_json);
              let dot = 0, mag1 = 0, mag2 = 0;
              if (newFace.descriptor.length === knownDesc.length) {
                for (let i = 0; i < newFace.descriptor.length; i++) {
                  dot += newFace.descriptor[i] * knownDesc[i];
                  mag1 += newFace.descriptor[i] ** 2;
                  mag2 += knownDesc[i] ** 2;
                }
                const magnitude = Math.sqrt(mag1) * Math.sqrt(mag2);
                const dist = magnitude === 0 ? 1 : 1 - dot / magnitude;
                if (dist < bestDistance) {
                  bestDistance = dist;
                  matchedPersonId = known.person_id;
                }
              }
            }
            insertFace.run(photoId, JSON.stringify(newBox), JSON.stringify(newFace.descriptor), matchedPersonId);
          }
        }
        for (const oldFace of oldFaces) {
          if (!usedOldFaceIds.has(oldFace.id)) {
            deleteFace.run(oldFace.id);
          }
        }
      });
      transaction();
      return { success: true };
    } catch (error) {
      console.error("Failed to update faces:", error);
      return { success: false, error };
    }
  });
  ipcMain.handle("db:getFaces", async (_, photoId) => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    try {
      const stmt = db2.prepare(`
        SELECT f.*, p.name as person_name 
        FROM faces f
        LEFT JOIN people p ON f.person_id = p.id
        WHERE f.photo_id = ?
      `);
      const faces = stmt.all(photoId);
      return faces.map((f) => ({
        ...f,
        box: JSON.parse(f.box_json),
        descriptor: JSON.parse(f.descriptor_json)
      }));
    } catch (error) {
      console.error("Failed to get faces:", error);
      return [];
    }
  });
  ipcMain.handle("db:getPeople", async () => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    try {
      const stmt = db2.prepare(`
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
      console.error("Failed to get people", error);
      return [];
    }
  });
  ipcMain.handle("db:getAllFaces", async (_, { limit = 100, offset = 0, filter = {} } = {}) => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    try {
      let query = `
        SELECT f.*, p.file_path, p.preview_cache_path, p.width, p.height 
        FROM faces f
        JOIN photos p ON f.photo_id = p.id
      `;
      const params = [];
      const conditions = [];
      if (filter.unnamed) {
        conditions.push("f.person_id IS NULL");
      }
      if (filter.personId) {
        conditions.push("f.person_id = ?");
        params.push(filter.personId);
      }
      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }
      if (!query.includes("is_ignored")) {
        query += conditions.length > 0 ? " AND is_ignored = 0" : " WHERE is_ignored = 0";
      }
      query += " ORDER BY p.created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);
      const stmt = db2.prepare(query);
      const faces = stmt.all(...params);
      return faces.map((f) => ({
        ...f,
        box: JSON.parse(f.box_json),
        descriptor: JSON.parse(f.descriptor_json)
      }));
    } catch (error) {
      console.error("Failed to get all faces:", error);
      return [];
    }
  });
  ipcMain.handle("db:assignPerson", async (_, { faceId, personName }) => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    const insertPerson = db2.prepare("INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING");
    const getPerson = db2.prepare("SELECT id FROM people WHERE name = ?");
    const updateFace = db2.prepare("UPDATE faces SET person_id = ? WHERE id = ?");
    const transaction = db2.transaction(() => {
      insertPerson.run(personName);
      const person = getPerson.get(personName);
      updateFace.run(person.id, faceId);
      return person;
    });
    try {
      const result = transaction();
      return { success: true, person: result };
    } catch (e) {
      console.error("Failed to assign person:", e);
      return { success: false, error: e };
    }
  });
  ipcMain.handle("db:reassignFaces", async (_, { faceIds, personName }) => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    const insertPerson = db2.prepare("INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING");
    const getPerson = db2.prepare("SELECT id FROM people WHERE name = ?");
    if (personName) {
      insertPerson.run(personName);
    }
    const person = getPerson.get(personName);
    if (!person) {
      return { success: false, error: "Target person could not be created" };
    }
    try {
      if (!faceIds || faceIds.length === 0) return { success: true };
      const placeholders = faceIds.map(() => "?").join(",");
      const stmt = db2.prepare(`UPDATE faces SET person_id = ? WHERE id IN (${placeholders})`);
      stmt.run(person.id, ...faceIds);
      return { success: true, personId: person.id };
    } catch (e) {
      console.error("Failed to reassign faces:", e);
      return { success: false, error: e };
    }
  });
  ipcMain.handle("db:unassignFaces", async (_, faceIds) => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    try {
      if (!faceIds || faceIds.length === 0) return { success: true };
      const placeholders = faceIds.map(() => "?").join(",");
      const stmt = db2.prepare(`UPDATE faces SET person_id = NULL WHERE id IN (${placeholders})`);
      stmt.run(...faceIds);
      return { success: true };
    } catch (e) {
      console.error("Failed to unassign faces:", e);
      return { success: false, error: e };
    }
  });
  ipcMain.handle("db:getPerson", async (_, personId) => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    try {
      const stmt = db2.prepare("SELECT * FROM people WHERE id = ?");
      const person = stmt.get(personId);
      return person || null;
    } catch (e) {
      console.error("Failed to get person:", e);
      return null;
    }
  });
  ipcMain.handle("db:getFolders", async () => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const path2 = await import("node:path");
    const db2 = getDB2();
    try {
      db2.function("DIRNAME", (p) => path2.dirname(p));
    } catch (e) {
    }
    try {
      const stmt = db2.prepare(`
        SELECT DISTINCT DIRNAME(file_path) as folder, COUNT(*) as count 
        FROM photos 
        GROUP BY folder 
        ORDER BY count DESC
      `);
      return stmt.all();
    } catch (error) {
      console.error("Failed to get folders:", error);
      return [];
    }
  });
  ipcMain.handle("db:ignoreFace", async (_, faceId) => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    try {
      const stmt = db2.prepare("UPDATE faces SET is_ignored = 1 WHERE id = ?");
      stmt.run(faceId);
      return { success: true };
    } catch (e) {
      return { success: false, error: e };
    }
  });
  ipcMain.handle("db:ignoreFaces", async (_, faceIds) => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    try {
      if (!faceIds || faceIds.length === 0) return { success: true };
      const placeholders = faceIds.map(() => "?").join(",");
      const stmt = db2.prepare(`UPDATE faces SET is_ignored = 1 WHERE id IN (${placeholders})`);
      stmt.run(...faceIds);
      return { success: true };
    } catch (e) {
      console.error("Failed to ignore faces:", e);
      return { success: false, error: e };
    }
  });
  ipcMain.handle("db:removeDuplicateFaces", async () => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    try {
      const photosWithMultipleFaces = db2.prepare(`
        SELECT photo_id, COUNT(*) as count 
        FROM faces 
        GROUP BY photo_id 
        HAVING count > 1
      `).all();
      let removedCount = 0;
      const deleteStmt = db2.prepare("DELETE FROM faces WHERE id = ?");
      for (const p of photosWithMultipleFaces) {
        const photoId = p.photo_id;
        const faces = db2.prepare("SELECT * FROM faces WHERE photo_id = ? ORDER BY id ASC").all(photoId);
        const facesToKeep = [];
        for (const face of faces) {
          const box = JSON.parse(face.box_json);
          let isDuplicate = false;
          for (const keptFace of facesToKeep) {
            const keptBox = JSON.parse(keptFace.box_json);
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
                }
                break;
              }
            }
          }
          if (!isDuplicate) {
            facesToKeep.push(face);
          }
        }
        const sortedFaces = faces.sort((a, b) => {
          if (a.person_id && !b.person_id) return -1;
          if (!a.person_id && b.person_id) return 1;
          return a.id - b.id;
        });
        const uniqueFaces = [];
        for (const face of sortedFaces) {
          const box = JSON.parse(face.box_json);
          let duplicate = false;
          for (const unique of uniqueFaces) {
            const uniqueBox = JSON.parse(unique.box_json);
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
            deleteStmt.run(face.id);
            removedCount++;
          }
        }
      }
      console.log(`Deduplication complete. Removed ${removedCount} faces.`);
      return { success: true, removedCount };
    } catch (e) {
      console.error("Failed to remove duplicates:", e);
      return { success: false, error: e };
    }
  });
  ipcMain.handle("db:getAllUnassignedFaceDescriptors", async () => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const db2 = getDB2();
    try {
      const stmt = db2.prepare(`
        SELECT id, descriptor_json, photo_id 
        FROM faces 
        WHERE person_id IS NULL AND is_ignored = 0
      `);
      const rows = stmt.all();
      return rows.map((r) => ({
        id: r.id,
        photoId: r.photo_id,
        descriptor: JSON.parse(r.descriptor_json)
      }));
    } catch (e) {
      console.error("Failed to get unassigned descriptors:", e);
      return [];
    }
  });
  ipcMain.handle("db:factoryReset", async () => {
    const { getDB: getDB2 } = await Promise.resolve().then(() => db$1);
    const fs = await import("node:fs/promises");
    const path2 = await import("node:path");
    const db2 = getDB2();
    try {
      console.log("Commencing Factory Reset...");
      db2.exec(`
            DELETE FROM photo_tags;
            DELETE FROM faces;
            DELETE FROM people;
            DELETE FROM tags;
            DELETE FROM photos;
            DELETE FROM sqlite_sequence; -- Reset autoincrement
            VACUUM;
        `);
      console.log("Database tables cleared.");
      const userDataPath = app.getPath("userData");
      const previewDir = path2.join(userDataPath, "previews");
      try {
        await fs.rm(previewDir, { recursive: true, force: true });
        await fs.mkdir(previewDir, { recursive: true });
        console.log("Preview directory cleared.");
      } catch (err) {
        console.error("Error clearing preview directory (non-fatal):", err);
      }
      return { success: true };
    } catch (e) {
      console.error("Factory Reset Failed:", e);
      return { success: false, error: e };
    }
  });
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
