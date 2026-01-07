var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { app, net, protocol, ipcMain, dialog, shell, BrowserWindow, screen } from "electron";
import * as path from "node:path";
import path__default from "node:path";
import * as fs from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import * as fs$1 from "node:fs";
import fs__default, { promises } from "node:fs";
import Database from "better-sqlite3";
import sharp from "sharp";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { ExifTool } from "exiftool-vendored";
if (process.env["VITE_DEV_SERVER_URL"]) {
  const appData = app.getPath("appData");
  const devUserData = path__default.join(appData, "smart-photo-organizer-dev");
  app.setPath("userData", devUserData);
  console.log(`[Setup] Dev Mode detected. Redirecting userData to: ${devUserData}`);
}
const logDir = path__default.join(app.getPath("userData"), "logs");
if (!fs__default.existsSync(logDir)) {
  fs__default.mkdirSync(logDir, { recursive: true });
}
const logFile = path__default.join(logDir, "main.log");
const MAX_SIZE = 5 * 1024 * 1024;
let logStream = fs__default.createWriteStream(logFile, { flags: "a" });
function rotateLogIfNeeded() {
  try {
    if (fs__default.existsSync(logFile)) {
      const stats = fs__default.statSync(logFile);
      if (stats.size > MAX_SIZE) {
        logStream.end();
        const oldLog = logFile + ".old";
        if (fs__default.existsSync(oldLog)) fs__default.unlinkSync(oldLog);
        fs__default.renameSync(logFile, oldLog);
        logStream = fs__default.createWriteStream(logFile, { flags: "a" });
      }
    }
  } catch (err) {
    console.error("Failed to rotate logs:", err);
  }
}
function getTimestamp() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function formatMsg(level, ...args) {
  const msg = args.map((arg) => typeof arg === "object" ? JSON.stringify(arg) : String(arg)).join(" ");
  return `[${getTimestamp()}] [${level}] ${msg}
`;
}
const logger = {
  info: (...args) => {
    rotateLogIfNeeded();
    const formatted = formatMsg("INFO", ...args);
    console.log(...args);
    logStream.write(formatted);
  },
  warn: (...args) => {
    rotateLogIfNeeded();
    const formatted = formatMsg("WARN", ...args);
    console.warn(...args);
    logStream.write(formatted);
  },
  error: (...args) => {
    rotateLogIfNeeded();
    const formatted = formatMsg("ERROR", ...args);
    console.error(...args);
    logStream.write(formatted);
  },
  debug: (...args) => {
    if (process.env.DEBUG) {
      rotateLogIfNeeded();
      const formatted = formatMsg("DEBUG", ...args);
      console.log(...args);
      logStream.write(formatted);
    }
  },
  getLogPath: () => logFile
};
const TRANSPARENT_1X1_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
class ImageService {
  constructor(repo, processor, fallbackGenerator) {
    this.repo = repo;
    this.processor = processor;
    this.fallbackGenerator = fallbackGenerator;
  }
  async processRequest(request) {
    let decodedPath = "";
    try {
      const urlObj = new URL(request.url);
      const rawPath = request.url.replace(/^local-resource:\/\//, "");
      decodedPath = decodeURIComponent(rawPath);
      const queryIndex = decodedPath.indexOf("?");
      if (queryIndex !== -1) {
        decodedPath = decodedPath.substring(0, queryIndex);
      }
      if (decodedPath.endsWith("/") || decodedPath.endsWith("\\")) {
        decodedPath = decodedPath.slice(0, -1);
      }
      const width = urlObj.searchParams.get("width") ? parseInt(urlObj.searchParams.get("width")) : void 0;
      const originalWidth = urlObj.searchParams.get("originalWidth") ? parseInt(urlObj.searchParams.get("originalWidth")) : void 0;
      const boxParam = urlObj.searchParams.get("box");
      const hq = urlObj.searchParams.get("hq") === "true";
      const silent_404 = request.url.includes("silent_404=true");
      const photoIdParam = urlObj.searchParams.get("photoId");
      let box;
      if (boxParam) {
        const parts = boxParam.split(",").map(Number);
        if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
          box = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
        }
      }
      const options = {
        width,
        originalWidth,
        box,
        hq,
        silent_404,
        photoId: photoIdParam ? parseInt(photoIdParam) : void 0
      };
      if (width && width > 0 || box) {
        return await this.handleResizeRequest(decodedPath, options);
      }
      return await this.handleDirectRequest(decodedPath, request, options);
    } catch (e) {
      return this.handleGlobalError(e, decodedPath, request);
    }
  }
  async handleResizeRequest(filePath, options) {
    try {
      const { orientation } = await this.repo.getImageMetadata(filePath);
      const ext = path__default.extname(filePath).toLowerCase();
      const isRaw = [".nef", ".arw", ".cr2", ".dng", ".orf", ".rw2"].includes(ext);
      if (isRaw) {
        try {
          const previewResponse = await this.attemptPreviewFallback(filePath, options, "Optimization: Use Preview");
          if (previewResponse) return previewResponse;
        } catch (optErr) {
        }
      }
      const buffer = await this.processor.process(filePath, options, orientation);
      return new Response(buffer, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "max-age=3600"
        }
      });
    } catch (resizeErr) {
      const errMessage = resizeErr.message || String(resizeErr);
      try {
        const previewResponse = await this.attemptPreviewFallback(filePath, options, errMessage);
        if (previewResponse) return previewResponse;
      } catch (fbErr) {
        logger.warn(`[Protocol] Preview fallback failed for ${filePath}: ${fbErr}`);
      }
      const ext = path__default.extname(filePath).toLowerCase();
      const isRaw = [".nef", ".arw", ".cr2", ".dng", ".orf", ".rw2"].includes(ext);
      if (isRaw && this.fallbackGenerator) {
        try {
          const { orientation } = await this.repo.getImageMetadata(filePath);
          const boxStr = options.box ? `${options.box.x},${options.box.y},${options.box.w},${options.box.h}` : void 0;
          const fbWidth = options.width || 300;
          const fbBuffer = await this.fallbackGenerator(filePath, fbWidth, boxStr, orientation);
          if (fbBuffer) {
            return new Response(fbBuffer, {
              headers: {
                "Content-Type": "image/jpeg",
                "X-Generated-By": "Python-Fallback"
              }
            });
          }
        } catch (pyErr) {
          logger.warn(`[Protocol] Python Fallback (Resize) failed: ${pyErr}`);
        }
      }
      if (options.silent_404) {
        return this.serveTransparent();
      }
      if (options.photoId) {
        await this.repo.logError(options.photoId, filePath, errMessage, "Preview Generation");
      } else {
        const id = await this.repo.getPhotoId(filePath);
        if (id) await this.repo.logError(id, filePath, errMessage, "Preview Generation");
      }
      return new Response("Thumbnail Generation Failed", { status: 500 });
    }
  }
  async attemptPreviewFallback(filePath, options, _originalError) {
    const previewPath = await this.repo.getPreviewPath(filePath);
    if (previewPath && !options.hq) {
      try {
        await fs.access(previewPath);
        const buffer = await this.processor.process(previewPath, options, 1);
        return new Response(buffer, { headers: { "Content-Type": "image/jpeg" } });
      } catch (e) {
        if (e.code === "ENOENT" || e.message.includes("ENOENT")) {
          logger.warn(`[Protocol] Stale preview path detected and removed for ${filePath}`);
          await this.repo.clearPreviewPath(filePath);
          return null;
        }
        throw e;
      }
    }
    return null;
  }
  async handleDirectRequest(filePath, _request, _options) {
    const ext = path__default.extname(filePath).toLowerCase();
    const isRaw = [".nef", ".arw", ".cr2", ".dng", ".orf", ".rw2"].includes(ext);
    if (isRaw) {
      try {
        const previewPath = await this.repo.getPreviewPath(filePath);
        if (previewPath) {
          try {
            await fs.access(previewPath);
            const prevBuffer = await fs.readFile(previewPath);
            return new Response(prevBuffer, { headers: { "Content-Type": "image/jpeg" } });
          } catch (e) {
            logger.warn(`[Protocol] RAW Preview found but inaccessible: ${previewPath}`);
          }
        }
        const buffer = await this.processor.convertRaw(filePath);
        return new Response(buffer, { headers: { "Content-Type": "image/jpeg" } });
      } catch (rawErr) {
        logger.error(`[Protocol] Failed to serve RAW file ${filePath}:`, rawErr);
        throw rawErr;
      }
    }
    try {
      await fs.access(filePath);
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch (fsErr) {
      throw fsErr;
    }
  }
  async handleGlobalError(e, decodedPath, request) {
    const msg = e.message || String(e);
    const isSilent404 = request.url.includes("silent_404=true");
    if (msg.includes("ERR_FILE_NOT_FOUND") || msg.includes("ENOENT")) {
      const match = decodedPath.match(/previews[\\\/]([a-f0-9]+)\.jpg/);
      if (match && match[1]) {
        try {
          const srcPath = await this.repo.getFilePathFromPreview(match[1]);
          if (srcPath) {
            const ext = path__default.extname(srcPath).toLowerCase();
            const isRaw = [".nef", ".arw", ".cr2", ".dng", ".orf", ".rw2"].includes(ext);
            if (isRaw) {
              try {
                const buffer = await this.processor.convertRaw(srcPath);
                return new Response(buffer, { headers: { "Content-Type": "image/jpeg" } });
              } catch (rawErr) {
                const buffer = await this.attemptSiblingRecovery(srcPath);
                if (buffer) return new Response(buffer, { headers: { "Content-Type": "image/zip" } });
                if (this.fallbackGenerator) {
                  const urlObj = new URL(request.url);
                  const width = urlObj.searchParams.get("width") ? parseInt(urlObj.searchParams.get("width")) : 300;
                  const fbBuf = await this.fallbackGenerator(srcPath, width);
                  if (fbBuf) return new Response(fbBuf, { headers: { "Content-Type": "image/jpeg", "X-Generated-By": "Python-Fallback" } });
                }
                throw rawErr;
              }
            } else {
              return await net.fetch(pathToFileURL(srcPath).toString());
            }
          }
        } catch (recErr) {
          logger.warn(`[Protocol] Recovery failed: ${recErr}`);
        }
      }
    }
    if (msg.includes("ERR_FILE_NOT_FOUND") || msg.includes("ENOENT")) {
      if (isSilent404) {
        return this.serveTransparent();
      }
    } else {
      logger.error(`[Protocol] Failed to handle request: ${request.url}`, e);
    }
    return new Response("Not Found", { status: 404 });
  }
  serveTransparent() {
    return new Response(TRANSPARENT_1X1_PNG, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache"
      }
    });
  }
  // Helper for Sibling Recovery logic (Lines 456-470)
  async attemptSiblingRecovery(srcPath) {
    const jpgSiblings = [
      srcPath.replace(/\.[^.]+$/, ".JPG"),
      srcPath.replace(/\.[^.]+$/, ".jpg"),
      srcPath + ".JPG",
      srcPath + ".jpg"
    ];
    for (const sib of jpgSiblings) {
      if (sib === srcPath) continue;
      try {
        await fs.access(sib);
        return await net.fetch(pathToFileURL(sib).toString());
      } catch {
      }
    }
    return null;
  }
}
const INSTANCE_ID = Math.random().toString(36).slice(7);
logger.info(`[DB Module] Loading Module Instance: ${INSTANCE_ID}`);
let db;
async function initDB(basePath, onProgress) {
  const dbPath = path__default.join(basePath, "library.db");
  if (onProgress) onProgress("Initializing Database...");
  logger.info(`[DB Module ${INSTANCE_ID}] Initializing Database at:`, dbPath);
  await new Promise((resolve) => setTimeout(resolve, 100));
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
      blur_score REAL,
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
      name TEXT UNIQUE NOT NULL COLLATE NOCASE,
      descriptor_mean_json TEXT
    );

    CREATE TABLE IF NOT EXISTS faces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id INTEGER,
      box_json TEXT,
      descriptor BLOB,
      person_id INTEGER,
      is_ignored BOOLEAN DEFAULT 0,
      is_reference BOOLEAN DEFAULT 0,
      score REAL,
      blur_score REAL,
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS scan_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id INTEGER,
      file_path TEXT,
      error_message TEXT,
      stage TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id INTEGER,
      file_path TEXT,
      scan_ms INTEGER,
      tag_ms INTEGER,
      face_count INTEGER,
      scan_mode TEXT,
      status TEXT,
      error TEXT,
      timestamp INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_faces_person_id ON faces(person_id);
    CREATE INDEX IF NOT EXISTS idx_faces_photo_id ON faces(photo_id);
  `);
  try {
    db.exec("ALTER TABLE faces ADD COLUMN blur_score REAL");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE faces ADD COLUMN is_ignored BOOLEAN DEFAULT 0");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE faces ADD COLUMN score REAL");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE people ADD COLUMN descriptor_mean_json TEXT");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE photos ADD COLUMN blur_score REAL");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE scan_history ADD COLUMN scan_mode TEXT");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE photos ADD COLUMN description TEXT");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE people ADD COLUMN cover_face_id INTEGER");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE faces ADD COLUMN confidence_tier TEXT DEFAULT 'unknown'");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE faces ADD COLUMN suggested_person_id INTEGER");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE faces ADD COLUMN match_distance REAL");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE faces ADD COLUMN pose_yaw REAL");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE faces ADD COLUMN pose_pitch REAL");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE faces ADD COLUMN pose_roll REAL");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE faces ADD COLUMN face_quality REAL");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE faces ADD COLUMN is_confirmed BOOLEAN DEFAULT 0");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE faces ADD COLUMN era_id INTEGER");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE people ADD COLUMN centroid_snapshot_json TEXT");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE people ADD COLUMN last_drift_check INTEGER");
  } catch (e) {
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS person_eras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      era_name TEXT,
      start_year INTEGER,
      end_year INTEGER,
      centroid_json TEXT,
      face_count INTEGER DEFAULT 0,
      is_auto_generated BOOLEAN DEFAULT 1,
      created_at INTEGER,
      descriptor_mean_json TEXT,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_person_eras_person_id ON person_eras(person_id);

    -- Phase D: Centroid Drift Detection
    CREATE TABLE IF NOT EXISTS person_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      descriptor_json TEXT,
      face_count INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reason TEXT,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_person_history_person_id ON person_history(person_id);
  `);
  try {
    try {
      db.exec("ALTER TABLE faces ADD COLUMN descriptor BLOB");
    } catch (e) {
    }
    try {
      db.exec("ALTER TABLE faces ADD COLUMN is_reference BOOLEAN DEFAULT 0");
    } catch (e) {
    }
    let hasJson = { count: 0 };
    try {
      hasJson = db.prepare("SELECT count(*) as count FROM faces WHERE descriptor IS NULL AND (descriptor_json IS NOT NULL AND descriptor_json != 'NULL')").get();
    } catch (e) {
    }
    if (hasJson.count > 0) {
      if (onProgress) onProgress(`Migrating ${hasJson.count} faces...`);
      logger.info(`Starting Smart Face Storage Migration for ${hasJson.count} faces...`);
      const allFaces = db.prepare("SELECT id, descriptor_json, person_id, blur_score FROM faces").all();
      const updateFace = db.prepare("UPDATE faces SET descriptor = ?, is_reference = ? WHERE id = ?");
      if (onProgress) onProgress("Analyzing Face Quality...");
      const personFaces = {};
      const unknownFaces = [];
      for (const face of allFaces) {
        if (!face.person_id) {
          unknownFaces.push(face);
        } else {
          if (!personFaces[face.person_id]) personFaces[face.person_id] = [];
          personFaces[face.person_id].push(face);
        }
      }
      let processedCount = 0;
      const totalCount = hasJson.count;
      const CHUNK_SIZE = 500;
      const report = () => {
        if (onProgress) {
          const pct = Math.round(processedCount / totalCount * 100);
          onProgress(`Migrating Database: ${pct}%`);
        }
      };
      const unknownChunks = [];
      for (let i = 0; i < unknownFaces.length; i += CHUNK_SIZE) {
        unknownChunks.push(unknownFaces.slice(i, i + CHUNK_SIZE));
      }
      for (const chunk of unknownChunks) {
        const transaction = db.transaction(() => {
          for (const face of chunk) {
            if (face.descriptor_json) {
              try {
                const arr = JSON.parse(face.descriptor_json);
                const buf = Buffer.from(new Float32Array(arr).buffer);
                updateFace.run(buf, 0, face.id);
              } catch (e) {
                logger.error(`Failed to migrate face ${face.id}`, e);
              }
            }
          }
        });
        transaction();
        processedCount += chunk.length;
        report();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const personIds = Object.keys(personFaces);
      for (let i = 0; i < personIds.length; i += 50) {
        const pIdsChunk = personIds.slice(i, i + 50);
        const transaction = db.transaction(() => {
          for (const pid of pIdsChunk) {
            const faces = personFaces[parseInt(pid)];
            faces.sort((a, b) => (b.blur_score || 0) - (a.blur_score || 0));
            faces.forEach((face, index) => {
              if (index < 100) {
                if (face.descriptor_json) {
                  try {
                    const arr = JSON.parse(face.descriptor_json);
                    const buf = Buffer.from(new Float32Array(arr).buffer);
                    updateFace.run(buf, 1, face.id);
                  } catch (e) {
                    logger.error(`Failed to migrate reference ${face.id}`, e);
                  }
                }
              } else {
                updateFace.run(null, 0, face.id);
              }
            });
            processedCount += faces.length;
          }
        });
        transaction();
        report();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      logger.info("Smart Face Storage Migration: Data converted.");
      try {
        if (onProgress) onProgress("Optimizing Database (VACUUM)...");
        await new Promise((resolve) => setTimeout(resolve, 100));
        logger.info("Dropping old descriptor_json column...");
        db.exec("ALTER TABLE faces DROP COLUMN descriptor_json");
        db.exec("VACUUM");
      } catch (e) {
        logger.warn("Could not drop descriptor_json column (SQLite version might be old), setting to NULL instead.", e);
        db.exec("UPDATE faces SET descriptor_json = NULL");
        db.exec("VACUUM");
      }
      logger.info("Smart Face Storage Migration: Complete.");
    }
  } catch (e) {
    logger.error("Smart Face Storage Migration Failed:", e);
  }
  try {
    const getCollate = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='people'").get();
    if (getCollate && !getCollate.sql.includes("COLLATE NOCASE")) {
      if (onProgress) onProgress("Upgrading People Table (Uniqueness)...");
      logger.info("Upgrading People Table to enforce case-insensitive uniqueness...");
      const allPeople = db.prepare("SELECT id, name FROM people").all();
      const seen = /* @__PURE__ */ new Map();
      const merges = /* @__PURE__ */ new Map();
      for (const p of allPeople) {
        const lower = p.name.trim().toLowerCase();
        if (seen.has(lower)) {
          merges.set(p.id, seen.get(lower));
        } else {
          seen.set(lower, p.id);
        }
      }
      db.exec("PRAGMA foreign_keys = OFF");
      const transaction = db.transaction(() => {
        const updateFace = db.prepare("UPDATE faces SET person_id = ? WHERE person_id = ?");
        for (const [fromId, toId] of merges.entries()) {
          updateFace.run(toId, fromId);
        }
        db.exec(`
          DROP TABLE IF EXISTS people_new;
          CREATE TABLE people_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL COLLATE NOCASE,
            descriptor_mean_json TEXT
          );
        `);
        const keptIds = [...seen.values()];
        const insertPerson = db.prepare("INSERT INTO people_new (id, name, descriptor_mean_json) SELECT id, name, descriptor_mean_json FROM people WHERE id = ?");
        for (const id of keptIds) {
          insertPerson.run(id);
        }
        db.exec("DROP TABLE people");
        db.exec("ALTER TABLE people_new RENAME TO people");
      });
      transaction();
      db.exec("PRAGMA foreign_keys = ON");
      const localRecalc = (db2, personId) => {
        try {
          const allDescriptors = db2.prepare("SELECT descriptor FROM faces WHERE person_id = ? AND is_ignored = 0 AND (blur_score IS NULL OR blur_score >= 20)").all(personId);
          if (allDescriptors.length === 0) {
            db2.prepare("UPDATE people SET descriptor_mean_json = NULL WHERE id = ?").run(personId);
            return;
          }
          const vectors = [];
          for (const row of allDescriptors) {
            if (row.descriptor) {
              vectors.push(Array.from(new Float32Array(row.descriptor.buffer, row.descriptor.byteOffset, row.descriptor.byteLength / 4)));
            }
          }
          if (vectors.length == 0) return;
          const dim = vectors[0].length;
          const mean = new Array(dim).fill(0);
          for (const v of vectors) for (let i = 0; i < dim; i++) mean[i] += v[i];
          let mag = 0;
          for (let i = 0; i < dim; i++) {
            mean[i] /= vectors.length;
            mag += mean[i] ** 2;
          }
          mag = Math.sqrt(mag);
          if (mag > 0) for (let i = 0; i < dim; i++) mean[i] /= mag;
          db2.prepare("UPDATE people SET descriptor_mean_json = ? WHERE id = ?").run(JSON.stringify(mean), personId);
        } catch (e) {
          console.error("Migration Recalc failed", e);
        }
      };
      const toRecalc = [...new Set(merges.values())];
      for (const pid of toRecalc) {
        localRecalc(db, pid);
      }
      logger.info("People Table Upgrade: Complete.");
    }
  } catch (e) {
    logger.error("Failed to migrate people table:", e);
  }
  try {
    const tag = db.prepare("SELECT id FROM tags WHERE name = ?").get("AI Description");
    if (tag) {
      db.prepare("DELETE FROM photo_tags WHERE tag_id = ?").run(tag.id);
      db.prepare("DELETE FROM tags WHERE id = ?").run(tag.id);
      logger.info('Migration complete: "AI Description" tag removed.');
    }
  } catch (e) {
    logger.error("Migration failed:", e);
  }
  logger.info("Database schema ensured.");
}
function getDB() {
  if (!db) {
    logger.error(`[DB Module ${INSTANCE_ID}] Database not initialized. db is ${db}`);
    throw new Error("Database not initialized");
  }
  return db;
}
function closeDB() {
  if (db) {
    logger.info("Closing Database connection.");
    db.close();
    db = void 0;
  }
}
class SqliteMetadataRepository {
  async getImageMetadata(filePath) {
    let orientation = 1;
    try {
      const db2 = getDB();
      const row = db2.prepare("SELECT metadata_json FROM photos WHERE file_path = ?").get(filePath);
      if (row && row.metadata_json) {
        const meta = JSON.parse(row.metadata_json);
        if (meta.Orientation) orientation = parseInt(meta.Orientation);
        else if (meta.ExifImageOrientation) orientation = parseInt(meta.ExifImageOrientation);
      }
    } catch (dbErr) {
    }
    return { orientation };
  }
  async getPreviewPath(filePath) {
    try {
      const db2 = getDB();
      const row = db2.prepare("SELECT preview_cache_path FROM photos WHERE file_path = ?").get(filePath);
      if (row && row.preview_cache_path) {
        return row.preview_cache_path;
      }
    } catch (err) {
    }
    return null;
  }
  async getFilePathFromPreview(previewPathSubstr) {
    try {
      const db2 = getDB();
      const row = db2.prepare("SELECT file_path FROM photos WHERE preview_cache_path LIKE ?").get(`%${previewPathSubstr}%`);
      if (row && row.file_path) {
        return row.file_path;
      }
    } catch (err) {
    }
    return null;
  }
  async getPhotoId(filePath) {
    try {
      const db2 = getDB();
      const row = db2.prepare("SELECT id FROM photos WHERE file_path = ?").get(filePath);
      return row ? row.id : null;
    } catch (err) {
      return null;
    }
  }
  async clearPreviewPath(filePath) {
    try {
      const db2 = getDB();
      db2.prepare("UPDATE photos SET preview_cache_path = NULL WHERE file_path = ?").run(filePath);
    } catch (err) {
      logger.warn(`[MetadataRepository] Failed to clear preview path for ${filePath}`, err);
    }
  }
  async logError(photoId, filePath, errorMessage, stage) {
    try {
      const db2 = getDB();
      db2.prepare("INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, ?, ?, ?)").run(photoId, filePath, errorMessage, stage);
    } catch (dbErr) {
      logger.error("[MetadataRepository] Failed to log error to DB", dbErr);
    }
  }
}
class SharpImageProcessor {
  async process(filePath, options, dbOrientation = 1) {
    const pipeline = sharp(filePath);
    return this.processPipeline(pipeline, options, dbOrientation, false);
  }
  async processPipeline(pipeline, options, dbOrientation = 1, _isPreview = false) {
    const inputMeta = await pipeline.metadata();
    const inputW = inputMeta.width || 0;
    const inputH = inputMeta.height || 0;
    const inputOri = inputMeta.orientation || 1;
    const isInputLandscape = inputW > inputH;
    const expectsPortrait = dbOrientation === 6 || dbOrientation === 8;
    let dimsSwapped = false;
    if (expectsPortrait && isInputLandscape) {
      if (inputOri >= 5 && inputOri <= 8) {
        pipeline.rotate();
        dimsSwapped = true;
      } else {
        if (dbOrientation === 6) {
          pipeline.rotate(90);
          dimsSwapped = true;
        } else if (dbOrientation === 8) {
          pipeline.rotate(-90);
          dimsSwapped = true;
        }
      }
    } else if (dbOrientation === 3) {
      if (inputOri === 3) pipeline.rotate();
      else pipeline.rotate(180);
    }
    if (options.box) {
      let currentW = inputW;
      let currentH = inputH;
      if (dimsSwapped) {
        [currentW, currentH] = [currentH, currentW];
      }
      if (currentW && currentH) {
        let { x, y, w, h } = options.box;
        if (options.originalWidth && options.originalWidth > 0 && currentW !== options.originalWidth) {
          const scale = currentW / options.originalWidth;
          x = x * scale;
          y = y * scale;
          w = w * scale;
          h = h * scale;
        }
        const safeX = Math.max(0, Math.min(Math.round(x), currentW - 1));
        const safeY = Math.max(0, Math.min(Math.round(y), currentH - 1));
        const safeW = Math.max(1, Math.min(Math.round(w), currentW - safeX));
        const safeH = Math.max(1, Math.min(Math.round(h), currentH - safeY));
        pipeline.extract({ left: safeX, top: safeY, width: safeW, height: safeH });
      }
    }
    if (options.width && options.width > 0) {
      pipeline.resize(options.width, null, { fit: "inside", withoutEnlargement: true });
    }
    return await pipeline.toBuffer();
  }
  async convertRaw(filePath) {
    return await sharp(filePath).rotate().toFormat("jpeg", { quality: 80 }).toBuffer();
  }
}
function registerImageProtocol(fallbackGenerator) {
  const repo = new SqliteMetadataRepository();
  const processor = new SharpImageProcessor();
  const service = new ImageService(repo, processor, fallbackGenerator);
  protocol.handle("local-resource", async (request) => {
    return await service.processRequest(request);
  });
}
class FaceRepository {
  static parseFace(row) {
    let original_width = row.width;
    let original_height = row.height;
    if ((!original_width || !original_height) && row.metadata_json) {
      try {
        const meta = JSON.parse(row.metadata_json);
        original_width = original_width || meta.ImageWidth || meta.SourceImageWidth || meta.ExifImageWidth;
        original_height = original_height || meta.ImageHeight || meta.SourceImageHeight || meta.ExifImageHeight;
      } catch (e) {
      }
    }
    return {
      ...row,
      box: JSON.parse(row.box_json),
      original_width,
      original_height,
      descriptor: row.descriptor ? Array.from(new Float32Array(row.descriptor.buffer, row.descriptor.byteOffset, row.descriptor.byteLength / 4)) : null,
      is_reference: !!row.is_reference,
      confidence_tier: row.confidence_tier || "unknown",
      suggested_person_id: row.suggested_person_id,
      match_distance: row.match_distance
    };
  }
  static getBlurryFaces(options) {
    const db2 = getDB();
    const { personId, scope, limit = 1e3, offset = 0, threshold = 20 } = options;
    let query = `SELECT f.id, f.photo_id, f.blur_score, f.box_json, p.file_path, p.preview_cache_path, p.metadata_json, p.width, p.height, pp.name as person_name 
               FROM faces f 
               JOIN photos p ON f.photo_id = p.id
               LEFT JOIN people pp ON f.person_id = pp.id
               WHERE (f.is_ignored = 0 OR f.is_ignored IS NULL) AND f.blur_score < ?`;
    let countQuery = `SELECT COUNT(*) as count FROM faces f WHERE (f.is_ignored = 0 OR f.is_ignored IS NULL) AND f.blur_score < ?`;
    const params = [threshold];
    if (personId) {
      query += ` AND f.person_id = ?`;
      countQuery += ` AND f.person_id = ?`;
      params.push(personId);
    } else if (scope !== "all") {
      query += ` AND f.person_id IS NULL`;
      countQuery += ` AND f.person_id IS NULL`;
    }
    query += " ORDER BY f.blur_score ASC LIMIT ? OFFSET ?";
    const queryParams = [...params, limit, offset];
    try {
      const rows = db2.prepare(query).all(...queryParams);
      const totalRes = db2.prepare(countQuery).get(...params);
      return {
        faces: rows.map((r) => this.parseFace(r)),
        total: totalRes ? totalRes.count : 0
      };
    } catch (e) {
      throw new Error(`FaceRepository.getBlurryFaces failed: ${String(e)}`);
    }
  }
  static getFacesByIds(ids) {
    const db2 = getDB();
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const query = `
            SELECT f.id, f.photo_id, f.blur_score, f.box_json, f.descriptor, f.confidence_tier, f.suggested_person_id, f.match_distance,
                   p.file_path, p.preview_cache_path, p.metadata_json, p.width, p.height
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.id IN (${placeholders})
        `;
    const rows = db2.prepare(query).all(...ids);
    return rows.map((r) => this.parseFace(r));
  }
  static ignoreFaces(ids) {
    const db2 = getDB();
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    const query = `UPDATE faces SET is_ignored = 1 WHERE id IN (${placeholders})`;
    db2.prepare(query).run(...ids);
  }
  static restoreFaces(ids, personId) {
    const db2 = getDB();
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    let query;
    let params;
    if (personId !== void 0) {
      query = `UPDATE faces SET is_ignored = 0, person_id = ? WHERE id IN (${placeholders})`;
      params = [personId, ...ids];
    } else {
      query = `UPDATE faces SET is_ignored = 0 WHERE id IN (${placeholders})`;
      params = [...ids];
    }
    db2.prepare(query).run(...params);
  }
  static getIgnoredFaces(page = 1, limit = 50) {
    const db2 = getDB();
    const offset = (page - 1) * limit;
    const total = db2.prepare("SELECT COUNT(*) as count FROM faces WHERE is_ignored = 1").get();
    const faces = db2.prepare(`
            SELECT f.id, f.photo_id, f.blur_score, f.box_json, f.is_ignored, f.descriptor,
                   p.file_path, p.preview_cache_path, p.metadata_json, p.width, p.height
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.is_ignored = 1
            LIMIT ? OFFSET ?
        `).all(limit, offset);
    return {
      faces: faces.map((r) => this.parseFace(r)),
      total: total.count
    };
  }
  static getUnclusteredFaces(limit = 500, offset = 0) {
    const db2 = getDB();
    try {
      const faces = db2.prepare(`
                SELECT f.id, f.photo_id, f.blur_score, f.box_json, f.confidence_tier, f.suggested_person_id, f.match_distance, p.file_path, p.preview_cache_path, p.width, p.height
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
                WHERE f.person_id IS NULL 
                  AND f.descriptor IS NOT NULL
                  AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
                  AND (f.blur_score IS NULL OR f.blur_score >= 10)
                ORDER BY f.id ASC
                LIMIT ? OFFSET ?
            `).all(limit, offset);
      const total = db2.prepare(`
                SELECT COUNT(f.id) as count
                FROM faces f
                WHERE f.person_id IS NULL 
                AND f.descriptor IS NOT NULL
                AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
                AND (f.blur_score IS NULL OR f.blur_score >= 10)
            `).get();
      return {
        faces: faces.map((f) => ({
          id: f.id,
          photo_id: f.photo_id,
          blur_score: f.blur_score,
          box: JSON.parse(f.box_json),
          file_path: f.file_path,
          preview_cache_path: f.preview_cache_path,
          width: f.width,
          height: f.height
        })),
        total: total.count
      };
    } catch (e) {
      throw new Error(`FaceRepository.getUnclusteredFaces failed: ${String(e)}`);
    }
  }
  static getFacesForClustering() {
    const db2 = getDB();
    try {
      const faces = db2.prepare(`
                SELECT id, descriptor
                FROM faces 
                WHERE person_id IS NULL 
                  AND descriptor IS NOT NULL
                  AND (is_ignored = 0 OR is_ignored IS NULL)
                  AND (blur_score IS NULL OR blur_score >= 10)
            `).all();
      return faces.map((f) => ({
        id: f.id,
        descriptor: Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4))
      }));
    } catch (e) {
      throw new Error(`FaceRepository.getFacesForClustering failed: ${String(e)}`);
    }
  }
  static getFaceById(faceId) {
    const db2 = getDB();
    try {
      const face = db2.prepare(`SELECT * FROM faces WHERE id = ?`).get(faceId);
      if (!face) return null;
      return {
        ...face,
        box: JSON.parse(face.box_json),
        descriptor: face.descriptor ? Array.from(new Float32Array(face.descriptor.buffer, face.descriptor.byteOffset, face.descriptor.byteLength / 4)) : null,
        is_reference: !!face.is_reference
      };
    } catch (e) {
      console.error("FaceRepository.getFaceById failed:", e);
      return null;
    }
  }
  static getFacesByPhoto(photoId) {
    const db2 = getDB();
    try {
      const stmt = db2.prepare(`
                SELECT f.*, p.name as person_name 
                FROM faces f
                LEFT JOIN people p ON f.person_id = p.id
                WHERE f.photo_id = ? AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
            `);
      const faces = stmt.all(photoId);
      return faces.map((f) => ({
        ...f,
        box: JSON.parse(f.box_json),
        descriptor: f.descriptor ? Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4)) : null,
        is_reference: !!f.is_reference
      }));
    } catch (error) {
      console.error("FaceRepository.getFacesByPhoto failed:", error);
      return [];
    }
  }
  static getAllFaces(limit = 100, offset = 0, filter = {}, includeDescriptors = true) {
    const db2 = getDB();
    try {
      let query = `
                SELECT f.*, p.file_path, p.preview_cache_path, p.width, p.height 
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
            `;
      const params = [];
      const conditions = [];
      if (filter.unnamed) conditions.push("f.person_id IS NULL");
      if (filter.personId) {
        conditions.push("f.person_id = ?");
        params.push(filter.personId);
      }
      if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
      if (!query.includes("is_ignored")) query += conditions.length > 0 ? " AND is_ignored = 0" : " WHERE is_ignored = 0";
      query += " ORDER BY p.created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);
      const faces = db2.prepare(query).all(...params);
      return faces.map((f) => ({
        ...f,
        box: JSON.parse(f.box_json),
        descriptor: includeDescriptors && f.descriptor ? Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4)) : null,
        is_reference: !!f.is_reference
      }));
    } catch (error) {
      throw new Error(`FaceRepository.getAllFaces failed: ${String(error)}`);
    }
  }
  static deleteFaces(faceIds) {
    if (!faceIds || faceIds.length === 0) return;
    const db2 = getDB();
    const placeholders = faceIds.map(() => "?").join(",");
    db2.prepare(`DELETE FROM faces WHERE id IN (${placeholders})`).run(...faceIds);
  }
  static updateFacePerson(faceIds, personId, setConfirmed = null) {
    if (!faceIds || faceIds.length === 0) return;
    const db2 = getDB();
    const placeholders = faceIds.map(() => "?").join(",");
    let query = `UPDATE faces SET person_id = ?`;
    const params = [personId];
    if (setConfirmed !== null) {
      query += `, is_confirmed = ?`;
      params.push(setConfirmed ? 1 : 0);
    } else if (personId === null) {
      query += `, is_confirmed = 0`;
    }
    query += ` WHERE id IN (${placeholders})`;
    params.push(...faceIds);
    db2.prepare(query).run(...params);
  }
  static getAllDescriptors() {
    const db2 = getDB();
    const rows = db2.prepare("SELECT id, descriptor FROM faces WHERE descriptor IS NOT NULL").all();
    return rows.map((r) => ({
      id: r.id,
      descriptor: Array.from(new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4))
    }));
  }
  /**
   * Get descriptors ONLY for faces assigned to named people.
   * CRITICAL: This is what should populate the FAISS index for scan-time matching.
   * Including unnamed faces in FAISS causes false matches.
   */
  static getNamedFaceDescriptors() {
    const db2 = getDB();
    const rows = db2.prepare(`
            SELECT f.id, f.descriptor 
            FROM faces f 
            JOIN people p ON f.person_id = p.id 
            WHERE f.descriptor IS NOT NULL AND f.person_id IS NOT NULL
        `).all();
    return rows.map((r) => ({
      id: r.id,
      descriptor: Array.from(new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4))
    }));
  }
  static getUnassignedDescriptors() {
    const db2 = getDB();
    const rows = db2.prepare("SELECT id, descriptor FROM faces WHERE descriptor IS NOT NULL AND person_id IS NULL AND (is_ignored = 0 OR is_ignored IS NULL)").all();
    return rows.map((r) => ({
      id: r.id,
      descriptor: Array.from(new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4))
    }));
  }
  /**
   * Get faces with their descriptors for a specific person.
   * Used for outlier detection analysis.
   * Includes photo data for direct display without additional lookups.
   */
  static getFacesWithDescriptorsByPerson(personId) {
    const db2 = getDB();
    try {
      const rows = db2.prepare(`
                SELECT 
                    f.id, 
                    f.descriptor, 
                    f.blur_score,
                    f.box_json,
                    f.photo_id,
                    p.file_path,
                    p.preview_cache_path,
                    p.width,
                    p.height
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
                WHERE f.person_id = ?
                  AND f.descriptor IS NOT NULL
                  AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
            `).all(personId);
      return rows;
    } catch (error) {
      throw new Error(`FaceRepository.getFacesWithDescriptorsByPerson failed: ${String(error)}`);
    }
  }
  /**
   * Get unnamed faces with descriptors and photo appearance counts.
   * Used for Background Face Filter to identify noise candidates.
   * Photo count represents how often faces in this photo's cluster appear.
   */
  static getUnnamedFacesForNoiseDetection() {
    const db2 = getDB();
    try {
      const rows = db2.prepare(`
                SELECT 
                    f.id, 
                    f.descriptor, 
                    f.box_json,
                    f.photo_id,
                    p.file_path,
                    p.preview_cache_path,
                    p.width,
                    p.height
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
                WHERE f.person_id IS NULL 
                  AND f.descriptor IS NOT NULL
                  AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
                  AND (f.blur_score IS NULL OR f.blur_score >= 10)
            `).all();
      return rows;
    } catch (error) {
      throw new Error(`FaceRepository.getUnnamedFacesForNoiseDetection failed: ${String(error)}`);
    }
  }
  /**
   * Get faces that need pose data backfill (Phase 5).
   * Returns faces where pose_yaw IS NULL but have descriptors.
   */
  static getFacesNeedingPoseBackfill(limit = 100) {
    const db2 = getDB();
    try {
      const rows = db2.prepare(`
                SELECT 
                    f.id,
                    f.photo_id,
                    f.box_json,
                    p.file_path,
                    p.preview_cache_path,
                    p.metadata_json
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
                WHERE f.pose_yaw IS NULL 
                  AND f.descriptor IS NOT NULL
                  AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
                  AND (f.blur_score IS NULL OR f.blur_score >= 10)
                LIMIT ?
            `).all(limit);
      return rows.map((r) => {
        let orientation = 1;
        try {
          const meta = JSON.parse(r.metadata_json || "{}");
          orientation = meta.Orientation || meta.orientation || 1;
        } catch {
        }
        return {
          ...r,
          orientation
        };
      });
    } catch (error) {
      throw new Error(`FaceRepository.getFacesNeedingPoseBackfill failed: ${String(error)}`);
    }
  }
  /**
   * Get the total count of faces needing pose backfill.
   */
  static getPoseBackfillCount() {
    const db2 = getDB();
    try {
      const needsBackfill = db2.prepare(`
                SELECT COUNT(*) as count FROM faces 
                WHERE pose_yaw IS NULL 
                  AND descriptor IS NOT NULL
                  AND (is_ignored = 0 OR is_ignored IS NULL)
                  AND (blur_score IS NULL OR blur_score >= 10)
            `).get();
      const total = db2.prepare(`
                SELECT COUNT(*) as count FROM faces 
                WHERE descriptor IS NOT NULL
                  AND (is_ignored = 0 OR is_ignored IS NULL)
                  AND (blur_score IS NULL OR blur_score >= 10)
            `).get();
      return {
        needsBackfill: (needsBackfill == null ? void 0 : needsBackfill.count) || 0,
        total: (total == null ? void 0 : total.count) || 0
      };
    } catch (error) {
      throw new Error(`FaceRepository.getPoseBackfillCount failed: ${String(error)}`);
    }
  }
  /**
   * Update pose data for a specific face (Phase 5 backfill).
   */
  static updateFacePoseData(faceId, poseData) {
    const db2 = getDB();
    try {
      db2.prepare(`
                UPDATE faces 
                SET pose_yaw = ?, pose_pitch = ?, pose_roll = ?, face_quality = ?
                WHERE id = ?
            `).run(
        poseData.pose_yaw,
        poseData.pose_pitch,
        poseData.pose_roll,
        poseData.face_quality,
        faceId
      );
    } catch (error) {
      throw new Error(`FaceRepository.updateFacePoseData failed: ${String(error)}`);
    }
  }
  // ============== FACE CONFIRMATION (Centroid Stability Feature) ==============
  /**
   * Mark faces as confirmed (user-verified as correctly assigned).
   * Confirmed faces are excluded from outlier detection.
   */
  static setConfirmed(faceIds, confirmed) {
    if (!faceIds || faceIds.length === 0) return;
    const db2 = getDB();
    const placeholders = faceIds.map(() => "?").join(",");
    db2.prepare(`UPDATE faces SET is_confirmed = ? WHERE id IN (${placeholders})`).run(
      confirmed ? 1 : 0,
      ...faceIds
    );
  }
  /**
   * Get all confirmed faces for a person.
   */
  static getConfirmedFaces(personId) {
    const db2 = getDB();
    try {
      return db2.prepare(`
                SELECT f.id, f.descriptor, f.box_json, f.photo_id, p.file_path
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
                WHERE f.person_id = ?
                  AND f.is_confirmed = 1
                  AND f.descriptor IS NOT NULL
                  AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
            `).all(personId);
    } catch (error) {
      throw new Error(`FaceRepository.getConfirmedFaces failed: ${String(error)}`);
    }
  }
  /**
   * Unassign faces from a person (remove person_id without ignoring).
   * Used for removing misassigned faces.
   */
  static unassignFaces(faceIds) {
    if (!faceIds || faceIds.length === 0) return;
    const db2 = getDB();
    const placeholders = faceIds.map(() => "?").join(",");
    db2.prepare(`UPDATE faces SET person_id = NULL, is_confirmed = 0 WHERE id IN (${placeholders})`).run(
      ...faceIds
    );
  }
  static getConfirmedFacesWithDates(personId) {
    const db2 = getDB();
    try {
      const faces = db2.prepare(`
                SELECT f.id, f.descriptor, p.created_at, p.metadata_json 
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
                WHERE f.person_id = ? 
                AND f.is_confirmed = 1
                AND f.descriptor IS NOT NULL
            `).all(personId);
      return faces.map((f) => ({
        id: f.id,
        descriptor: Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4)),
        created_at: f.created_at,
        metadata_json: f.metadata_json
        // Add metadata
      }));
    } catch (error) {
      console.error("FaceRepository.getConfirmedFacesWithDates failed:", error);
      return [];
    }
  }
  static updateFaceEra(faceId, eraId) {
    const db2 = getDB();
    db2.prepare("UPDATE faces SET era_id = ? WHERE id = ?").run(eraId, faceId);
  }
}
class PersonRepository {
  static getPeople() {
    const db2 = getDB();
    try {
      const stmt = db2.prepare(`
                WITH BestFaces AS (
                    SELECT 
                        person_id,
                        id as face_id,
                        photo_id,
                        box_json,
                        blur_score,
                        ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY blur_score DESC) as rn
                    FROM faces 
                    WHERE person_id IS NOT NULL AND is_ignored = 0
                ),
                PersonCounts AS (
                    SELECT person_id, COUNT(*) as face_count 
                    FROM faces 
                    WHERE person_id IS NOT NULL AND is_ignored = 0
                    GROUP BY person_id
                )
                SELECT 
                    p.*, 
                    COALESCE(pc.face_count, 0) as face_count,
                    COALESCE(fixed_photo.preview_cache_path, fixed_photo.file_path, ph.preview_cache_path, ph.file_path) as cover_path,
                    COALESCE(fixed_face.box_json, bf.box_json) as cover_box,
                    COALESCE(fixed_photo.width, ph.width) as cover_width,
                    COALESCE(fixed_photo.height, ph.height) as cover_height,
                    p.cover_face_id
                FROM people p
                LEFT JOIN PersonCounts pc ON p.id = pc.person_id
                LEFT JOIN BestFaces bf ON p.id = bf.person_id AND bf.rn = 1
                LEFT JOIN photos ph ON bf.photo_id = ph.id
                LEFT JOIN faces fixed_face ON p.cover_face_id = fixed_face.id
                LEFT JOIN photos fixed_photo ON fixed_face.photo_id = fixed_photo.id
                ORDER BY face_count DESC
            `);
      return stmt.all();
    } catch (error) {
      throw new Error(`PersonRepository.getPeople failed: ${String(error)}`);
    }
  }
  static getPeopleWithDescriptors() {
    var _a;
    const db2 = getDB();
    try {
      const people = db2.prepare("SELECT id, name, descriptor_mean_json FROM people WHERE descriptor_mean_json IS NOT NULL").all();
      const eras = db2.prepare("SELECT * FROM person_eras").all();
      const erasMap = /* @__PURE__ */ new Map();
      for (const era of eras) {
        if (!erasMap.has(era.person_id)) erasMap.set(era.person_id, []);
        (_a = erasMap.get(era.person_id)) == null ? void 0 : _a.push({
          centroid: JSON.parse(era.centroid_json),
          name: era.era_name
        });
      }
      return people.map((r) => ({
        id: r.id,
        name: r.name,
        descriptor: JSON.parse(r.descriptor_mean_json),
        eras: erasMap.get(r.id) || []
      }));
    } catch (error) {
      throw new Error(`PersonRepository.getPeopleWithDescriptors failed: ${String(error)}`);
    }
  }
  static getPersonById(personId) {
    const db2 = getDB();
    return db2.prepare("SELECT * FROM people WHERE id = ?").get(personId);
  }
  static getPersonByName(name) {
    const db2 = getDB();
    return db2.prepare("SELECT * FROM people WHERE name = ? COLLATE NOCASE").get(name.trim());
  }
  static createPerson(name) {
    const db2 = getDB();
    const normalizedName = name.trim();
    db2.prepare("INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING").run(normalizedName);
    return this.getPersonByName(normalizedName);
  }
  static updatePersonName(id, name) {
    const db2 = getDB();
    db2.prepare("UPDATE people SET name = ? WHERE id = ?").run(name.trim(), id);
  }
  static updateDescriptorMean(id, meanJson) {
    const db2 = getDB();
    db2.prepare("UPDATE people SET descriptor_mean_json = ? WHERE id = ?").run(meanJson, id);
  }
  static deletePerson(id) {
    const db2 = getDB();
    db2.prepare("DELETE FROM people WHERE id = ?").run(id);
  }
  static setPersonCover(personId, faceId) {
    const db2 = getDB();
    db2.prepare("UPDATE people SET cover_face_id = ? WHERE id = ?").run(faceId, personId);
  }
  /**
   * Get person with their descriptor mean (centroid) for outlier analysis.
   */
  static getPersonWithDescriptor(personId) {
    const db2 = getDB();
    try {
      const row = db2.prepare(
        "SELECT id, name, descriptor_mean_json FROM people WHERE id = ?"
      ).get(personId);
      return row || null;
    } catch (error) {
      throw new Error(`PersonRepository.getPersonWithDescriptor failed: ${String(error)}`);
    }
  }
  static getPerson(personId) {
    return this.getPersonById(personId);
  }
  static addHistorySnapshot(personId, descriptorJson, faceCount, reason) {
    const db2 = getDB();
    db2.prepare("INSERT INTO person_history (person_id, descriptor_json, face_count, reason) VALUES (?, ?, ?, ?)").run(personId, descriptorJson, faceCount, reason);
  }
  // --- Era Methods ---
  static addEra(era) {
    const db2 = getDB();
    const info = db2.prepare(`
            INSERT INTO person_eras (person_id, era_name, start_year, end_year, centroid_json, face_count, is_auto_generated, created_at)
            VALUES (@person_id, @era_name, @start_year, @end_year, @centroid_json, @face_count, @is_auto_generated, strftime('%s','now'))
        `).run({ ...era, is_auto_generated: era.is_auto_generated ? 1 : 0 });
    return info.lastInsertRowid;
  }
  static clearEras(personId) {
    const db2 = getDB();
    db2.prepare("DELETE FROM person_eras WHERE person_id = ?").run(personId);
  }
  static getEras(personId) {
    const db2 = getDB();
    return db2.prepare("SELECT * FROM person_eras WHERE person_id = ? ORDER BY start_year ASC").all(personId);
  }
  static deleteEra(eraId) {
    const db2 = getDB();
    db2.prepare("UPDATE faces SET era_id = NULL WHERE era_id = ?").run(eraId);
    db2.prepare("DELETE FROM person_eras WHERE id = ?").run(eraId);
  }
}
const DEFAULT_CONFIG = {
  libraryPath: "",
  aiSettings: {
    faceSimilarityThreshold: 0.65,
    faceBlurThreshold: 20,
    minFaceSize: 40,
    modelSize: "medium",
    aiProfile: "balanced",
    useGpu: true,
    vlmEnabled: false,
    // Default to off for performance
    runtimeUrl: void 0
  },
  windowBounds: { width: 1200, height: 800, x: 0, y: 0 },
  firstRun: true,
  queue: { batchSize: 0, cooldownSeconds: 60 },
  smartIgnore: {
    minPhotoAppearances: 3,
    maxClusterSize: 2,
    centroidDistanceThreshold: 0.7,
    outlierThreshold: 1.2,
    autoAssignThreshold: 0.4,
    reviewThreshold: 0.6,
    enableAutoTiering: true,
    enableMultiSampleVoting: true,
    maxSamplesPerPerson: 50,
    enableQualityAdjustedThresholds: true,
    lowQualityThresholdBoost: 0.15
  },
  ai_queue: []
};
class ConfigService {
  static load() {
    if (this.config) return;
    try {
      if (fs$1.existsSync(this.configPath)) {
        const raw = fs$1.readFileSync(this.configPath, "utf8");
        const parsed = JSON.parse(raw);
        this.config = { ...DEFAULT_CONFIG, ...parsed };
        this.config.aiSettings = { ...DEFAULT_CONFIG.aiSettings, ...parsed.aiSettings || {} };
        this.config.queue = { ...DEFAULT_CONFIG.queue, ...parsed.queue || {} };
        this.config.smartIgnore = { ...DEFAULT_CONFIG.smartIgnore, ...parsed.smartIgnore || {} };
      } else {
        this.config = { ...DEFAULT_CONFIG };
        this.save();
      }
    } catch (e) {
      console.error("Failed to load config, resetting:", e);
      this.config = { ...DEFAULT_CONFIG };
    }
  }
  static save() {
    try {
      fs$1.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (e) {
      console.error("Failed to save config:", e);
    }
  }
  static getSettings() {
    this.load();
    return this.config;
  }
  static updateSettings(partial) {
    this.load();
    this.config = { ...this.config, ...partial };
    this.save();
  }
  // For specific nested updates
  static updateQueueConfig(cfg) {
    this.load();
    this.config.queue = { ...this.config.queue, ...cfg };
    this.save();
  }
  // Legacy Helpers
  static getAISettings() {
    return this.getSettings().aiSettings;
  }
  static setAISettings(settings) {
    this.load();
    this.config.aiSettings = { ...this.config.aiSettings, ...settings };
    this.save();
  }
  static getLibraryPath() {
    this.load();
    return this.config.libraryPath || path__default.join(app.getPath("userData"), "Library");
  }
  static setLibraryPath(p) {
    this.updateSettings({ libraryPath: p });
  }
  // Smart Ignore Helpers
  static getSmartIgnoreSettings() {
    return this.getSettings().smartIgnore;
  }
  static updateSmartIgnoreSettings(settings) {
    this.load();
    this.config.smartIgnore = { ...this.config.smartIgnore, ...settings };
    this.save();
  }
}
__publicField(ConfigService, "configPath", path__default.join(app.getPath("userData"), "config.json"));
__publicField(ConfigService, "config");
function getAISettings() {
  return ConfigService.getAISettings();
}
function setAISettings(settings) {
  ConfigService.setAISettings(settings);
}
function getLibraryPath() {
  return ConfigService.getLibraryPath();
}
function setLibraryPath(path2) {
  ConfigService.setLibraryPath(path2);
}
function getWindowBounds() {
  return ConfigService.getSettings().windowBounds;
}
function setWindowBounds(bounds) {
  ConfigService.updateSettings({ windowBounds: bounds });
}
class PersonService {
  static async recalculatePersonMean(personId) {
    console.time(`recalculatePersonMean-${personId}`);
    const settings = getAISettings();
    const blurThreshold = settings.faceBlurThreshold ?? 20;
    const faces = FaceRepository.getAllFaces(1e4, 0, { personId }, true);
    const validFaces = faces.filter(
      (f) => f.descriptor && f.descriptor.length > 0 && (f.blur_score === null || f.blur_score >= blurThreshold)
    );
    if (validFaces.length === 0) {
      PersonRepository.updateDescriptorMean(personId, null);
      return;
    }
    let vectors = validFaces.map((f) => f.descriptor);
    const calcMean = (vecs) => {
      const dim = vecs[0].length;
      const mean2 = new Array(dim).fill(0);
      for (const vec of vecs) {
        for (let i = 0; i < dim; i++) mean2[i] += vec[i];
      }
      let mag = 0;
      for (let i = 0; i < dim; i++) {
        mean2[i] /= vecs.length;
        mag += mean2[i] ** 2;
      }
      mag = Math.sqrt(mag);
      if (mag > 0) {
        for (let i = 0; i < dim; i++) mean2[i] /= mag;
      }
      return mean2;
    };
    const l2Dist = (v1, v2) => {
      let sum = 0;
      for (let i = 0; i < v1.length; i++) sum += (v1[i] - v2[i]) ** 2;
      return Math.sqrt(sum);
    };
    let mean = calcMean(vectors);
    if (vectors.length > 5) {
      const dists = vectors.map((v) => l2Dist(v, mean));
      const sumDist = dists.reduce((a, b) => a + b, 0);
      const avgDist = sumDist / dists.length;
      const variance = dists.reduce((a, b) => a + (b - avgDist) ** 2, 0) / dists.length;
      const stdDev = Math.sqrt(variance);
      const dynamicLimit = avgDist + 1.5 * stdDev;
      const hardLimit = 0.65;
      const limit = Math.min(dynamicLimit, hardLimit);
      const cleanVectors = vectors.filter((_, i) => dists[i] <= limit);
      if (cleanVectors.length > 0 && cleanVectors.length < vectors.length) {
        console.log(`[PersonService] Outlier Rejection for Persona ${personId}: Removed ${vectors.length - cleanVectors.length} faces (Limit: ${limit.toFixed(3)})`);
        vectors = cleanVectors;
        mean = calcMean(vectors);
      }
    }
    const DRIFT_THRESHOLD = 0.2;
    let driftDetected = false;
    let diff = 0;
    const oldPerson = PersonRepository.getPerson(personId);
    if (oldPerson && oldPerson.descriptor_mean_json) {
      try {
        const oldMean = JSON.parse(oldPerson.descriptor_mean_json);
        if (Array.isArray(oldMean) && oldMean.length === mean.length) {
          diff = l2Dist(oldMean, mean);
          console.log(`[DriftCheck] Person ${personId} centroid shift: ${diff.toFixed(6)} (Threshold: ${DRIFT_THRESHOLD})`);
          if (diff > DRIFT_THRESHOLD) {
            console.warn(`[DriftAlert] Person ${personId} centroid drifted by ${diff.toFixed(3)} (Threshold: ${DRIFT_THRESHOLD})`);
            driftDetected = true;
          }
        }
      } catch (e) {
      }
    }
    console.timeEnd(`recalculatePersonMean-${personId}`);
    PersonRepository.updateDescriptorMean(personId, JSON.stringify(mean));
    try {
      PersonRepository.addHistorySnapshot(personId, JSON.stringify(mean), vectors.length, driftDetected ? "drift_detected" : "recalc");
    } catch (e) {
      console.warn("Failed to save person history:", e);
    }
    return { success: true, drift: driftDetected, driftDistance: diff };
  }
  static async generateEras(personId, config) {
    const MIN_FACES_PER_ERA = (config == null ? void 0 : config.minFacesForEra) ?? 50;
    const MERGE_THRESHOLD = (config == null ? void 0 : config.eraMergeThreshold) ?? 0.75;
    const faces = FaceRepository.getConfirmedFacesWithDates(personId);
    const parseDate = (f) => {
      try {
        if (f.metadata_json) {
          const meta = JSON.parse(f.metadata_json);
          const dateStr = meta.DateTimeOriginal || meta.CreateDate || meta.DateCreated || meta.DateTimeDigitized;
          if (dateStr && typeof dateStr === "string") {
            const isoLike = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
            const ts = Date.parse(isoLike);
            if (!isNaN(ts)) return ts;
          }
          if (meta.created_at) {
            const ts = Date.parse(meta.created_at);
            if (!isNaN(ts)) return ts;
          }
        }
        if (f.created_at) {
          const ts = new Date(f.created_at).getTime();
          if (!isNaN(ts)) return ts;
        }
      } catch (e) {
      }
      return null;
    };
    const facesWithMeta = faces.map((f) => ({ ...f, timestamp: parseDate(f) }));
    let k = 1;
    if (faces.length >= MIN_FACES_PER_ERA) k = 2;
    if (faces.length >= MIN_FACES_PER_ERA * 5) k = 3;
    let centroids = [];
    for (let i = 0; i < k; i++) {
      const idx = Math.floor(Math.random() * facesWithMeta.length);
      centroids.push(facesWithMeta[idx].descriptor);
    }
    let clusters = Array.from({ length: k }, () => []);
    let changed = true;
    let iter = 0;
    while (changed && iter < 10) {
      changed = false;
      iter++;
      clusters = Array.from({ length: k }, () => []);
      for (const face of facesWithMeta) {
        let minDist = Infinity;
        let clusterIdx = 0;
        for (let i = 0; i < k; i++) {
          const dist = FaceService.calculateL2Distance(face.descriptor, centroids[i]);
          if (dist < minDist) {
            minDist = dist;
            clusterIdx = i;
          }
        }
        clusters[clusterIdx].push(face);
      }
      for (let i = 0; i < k; i++) {
        if (clusters[i].length === 0) continue;
        const newCentroid = this.calculateCentroid(clusters[i].map((f) => f.descriptor));
        const shift = FaceService.calculateL2Distance(centroids[i], newCentroid);
        if (shift > 0.01) changed = true;
        centroids[i] = newCentroid;
      }
    }
    let merged = true;
    while (merged) {
      merged = false;
      const currentCentroids = clusters.map(
        (c) => c.length > 0 ? this.calculateCentroid(c.map((f) => f.descriptor)) : []
      );
      for (let i = 0; i < clusters.length; i++) {
        if (clusters[i].length === 0) continue;
        for (let j = i + 1; j < clusters.length; j++) {
          if (clusters[j].length === 0) continue;
          const dist = FaceService.calculateL2Distance(currentCentroids[i], currentCentroids[j]);
          console.log(`[box] Cluster ${i} vs ${j}: distance ${dist.toFixed(4)} (Threshold: ${MERGE_THRESHOLD})`);
          if (dist < MERGE_THRESHOLD) {
            clusters[i] = [...clusters[i], ...clusters[j]];
            clusters[j] = [];
            merged = true;
            break;
          }
        }
        if (merged) break;
      }
    }
    const validClusters = clusters.filter((c) => c.length >= MIN_FACES_PER_ERA);
    PersonRepository.clearEras(personId);
    let eraCount = 0;
    for (const cluster of validClusters) {
      const mean = this.calculateCentroid(cluster.map((f) => f.descriptor));
      const datedFaces = cluster.filter((f) => f.timestamp !== null).sort((a, b) => a.timestamp - b.timestamp);
      let label = `Visual Era ${eraCount + 1}`;
      let startYear = null;
      let endYear = null;
      if (datedFaces.length > 0) {
        const start = new Date(datedFaces[0].timestamp).getFullYear();
        const end = new Date(datedFaces[datedFaces.length - 1].timestamp).getFullYear();
        if (start === end) label = `${start}`;
        else label = `${start}-${end}`;
        startYear = start;
        endYear = end;
      }
      const eraId = PersonRepository.addEra({
        person_id: personId,
        era_name: label,
        start_year: startYear,
        end_year: endYear,
        centroid_json: JSON.stringify(mean),
        face_count: cluster.length,
        is_auto_generated: true
      });
      for (const f of cluster) {
        FaceRepository.updateFaceEra(f.id, eraId);
      }
      eraCount++;
    }
    console.log(`[PersonService] Generated ${eraCount} visual eras for person ${personId} (K=${k})`);
    return { success: true, count: eraCount };
  }
  // Helper extracted from recalculatePersonMean
  static calculateCentroid(vectors) {
    const dim = vectors[0].length;
    const mean = new Array(dim).fill(0);
    for (const vec of vectors) {
      for (let i = 0; i < dim; i++) mean[i] += vec[i];
    }
    let mag = 0;
    for (let i = 0; i < dim; i++) {
      mean[i] /= vectors.length;
      mag += mean[i] ** 2;
    }
    mag = Math.sqrt(mag);
    if (mag > 0) {
      for (let i = 0; i < dim; i++) mean[i] /= mag;
    }
    return mean;
  }
  static async mergePeople(fromId, toId) {
    if (fromId === toId) return;
    const faces = FaceRepository.getAllFaces(1e4, 0, { personId: fromId }, false);
    const faceIds = faces.map((f) => f.id);
    if (faceIds.length > 0) {
      FaceRepository.updateFacePerson(faceIds, toId, true);
    }
    PersonRepository.deletePerson(fromId);
    await this.recalculatePersonMean(toId);
  }
  static async recalculateAllMeans() {
    const people = PersonRepository.getPeople();
    console.log(`[PersonService] Recalculating means for ${people.length} people...`);
    for (const p of people) {
      await this.recalculatePersonMean(p.id);
    }
    console.log("[PersonService] Recalculation complete.");
    return { success: true, count: people.length };
  }
  static async assignPerson(faceId, personName) {
    const normalizedName = personName.trim();
    let person = PersonRepository.getPersonByName(normalizedName);
    if (!person) {
      person = PersonRepository.createPerson(normalizedName);
    }
    FaceRepository.updateFacePerson([faceId], person.id, true);
    this.recalculatePersonMean(person.id);
    return { success: true, person };
  }
  /**
   * Move faces to a target person by name, handling creation if needed.
   * Recalculates means for both source(s) and target.
   */
  static async moveFacesToPerson(faceIds, targetName) {
    if (faceIds.length === 0) return { success: true };
    const normalizedName = targetName.trim();
    let targetPerson = PersonRepository.getPersonByName(normalizedName);
    if (!targetPerson) {
      targetPerson = PersonRepository.createPerson(normalizedName);
    }
    const faces = FaceRepository.getFacesByIds(faceIds);
    const sourcePersonIds = /* @__PURE__ */ new Set();
    for (const face of faces) {
      if (face.person_id && face.person_id !== targetPerson.id) {
        sourcePersonIds.add(face.person_id);
      }
    }
    FaceRepository.updateFacePerson(faceIds, targetPerson.id);
    await this.recalculatePersonMean(targetPerson.id);
    for (const sourceId of sourcePersonIds) {
      await this.recalculatePersonMean(sourceId);
    }
    return { success: true, person: targetPerson };
  }
  static async renamePerson(personId, newName) {
    const existing = PersonRepository.getPersonByName(newName);
    if (existing && existing.id !== personId) {
      return this.mergePeople(personId, existing.id);
    } else {
      PersonRepository.updatePersonName(personId, newName);
      return { success: true, merged: false };
    }
  }
  static async unassignFaces(faceIds) {
    if (faceIds.length === 0) return;
    const faces = FaceRepository.getFacesByIds(faceIds);
    const sourcePersonIds = /* @__PURE__ */ new Set();
    for (const face of faces) {
      if (face.person_id) {
        sourcePersonIds.add(face.person_id);
      }
    }
    FaceRepository.updateFacePerson(faceIds, null);
    for (const sourceId of sourcePersonIds) {
      await this.recalculatePersonMean(sourceId);
    }
  }
}
class FaceAnalysisService {
  /**
   * L2-normalize a vector (unit length).
   */
  static normalizeVector(vec) {
    let magnitude = 0;
    for (let i = 0; i < vec.length; i++) {
      magnitude += vec[i] * vec[i];
    }
    magnitude = Math.sqrt(magnitude);
    if (magnitude === 0) return vec;
    return vec.map((v) => v / magnitude);
  }
  /**
   * Compute Euclidean distance between two embeddings.
   * Both vectors are L2-normalized before comparison.
   * For normalized vectors: distance = sqrt(2 * (1 - cosine_similarity))
   * Range: 0 (identical) to 2 (opposite)
   * 
   * @param vecA First embedding vector
   * @param vecB Second embedding vector
   * @returns Euclidean distance between the two normalized vectors
   */
  static computeDistance(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
      return Infinity;
    }
    const normA = this.normalizeVector(vecA);
    const normB = this.normalizeVector(vecB);
    let sum = 0;
    for (let i = 0; i < normA.length; i++) {
      const diff = normA[i] - normB[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }
  /**
   * Parse a descriptor from various formats (BLOB, JSON string, or array).
   * 
   * @param raw Raw descriptor data
   * @returns Parsed number array or null if invalid
   */
  static parseDescriptor(raw) {
    if (!raw) return null;
    if (Array.isArray(raw)) {
      return raw;
    }
    if (Buffer.isBuffer(raw)) {
      try {
        const floatArray = new Float32Array(
          raw.buffer,
          raw.byteOffset,
          raw.byteLength / 4
        );
        return Array.from(floatArray);
      } catch {
        return null;
      }
    }
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return null;
  }
  /**
   * Find faces that are potential outliers (misassigned) for a given person.
   * 
   * DETECTION STRATEGY (Priority Order):
   * 1. REFERENCE-BASED (best): If user has confirmed faces, compute their mean
   *    as ground truth and flag faces that are too far from it.
   * 2. IQR FALLBACK: If no confirmed faces, use pairwise clustering IQR method.
   *    Note: IQR fails when contamination >50% (wrong faces become majority).
   * 
   * @param personId The person ID to analyze
   * @param threshold Distance threshold for reference-based (default 0.85)
   * @returns Analysis result with outlier list
   */
  static findOutliersForPerson(personId, threshold = 0.85) {
    const person = PersonRepository.getPersonWithDescriptor(personId);
    if (!person) {
      throw new Error(`Person with ID ${personId} not found`);
    }
    const faces = FaceRepository.getFacesWithDescriptorsByPerson(personId);
    const confirmedFaces = FaceRepository.getConfirmedFaces(personId);
    const confirmedFaceIds = new Set(confirmedFaces.map((f) => f.id));
    if (faces.length < 2) {
      return {
        personId,
        personName: person.name,
        totalFaces: faces.length,
        outliers: [],
        threshold,
        centroidValid: true
      };
    }
    const facesWithParsed = faces.map((f) => ({
      ...f,
      parsedDescriptor: this.parseDescriptor(f.descriptor)
    })).filter((f) => f.parsedDescriptor !== null);
    if (confirmedFaces.length >= 1) {
      console.log(`[FaceAnalysis] Person ${person.name}: Using REFERENCE-BASED detection with ${confirmedFaces.length} confirmed faces`);
      const confirmedDescriptors = confirmedFaces.map((f) => this.parseDescriptor(f.descriptor)).filter((d) => d !== null);
      if (confirmedDescriptors.length === 0) {
        console.log(`[FaceAnalysis] No valid descriptors in confirmed faces, falling back to IQR`);
        return this.findOutliersIQR(personId, person, facesWithParsed, confirmedFaceIds, threshold);
      }
      const refCentroid = new Array(confirmedDescriptors[0].length).fill(0);
      for (const desc of confirmedDescriptors) {
        for (let i = 0; i < desc.length; i++) {
          refCentroid[i] += desc[i] / confirmedDescriptors.length;
        }
      }
      const normalizedRef = this.normalizeVector(refCentroid);
      let maxConfirmedDist = 0;
      for (const desc of confirmedDescriptors) {
        const dist = this.computeDistance(desc, normalizedRef);
        if (dist > maxConfirmedDist) maxConfirmedDist = dist;
      }
      const calculatedThreshold = maxConfirmedDist + 0.25;
      const adaptiveThreshold = Math.min(1, Math.max(0.65, calculatedThreshold));
      console.log(`[FaceAnalysis] Confirmed faces max dist=${maxConfirmedDist.toFixed(3)}, calculated=${calculatedThreshold.toFixed(3)}, used=${adaptiveThreshold.toFixed(3)}`);
      const outliers = [];
      for (const face of facesWithParsed) {
        if (confirmedFaceIds.has(face.id)) continue;
        const distance = this.computeDistance(face.parsedDescriptor, normalizedRef);
        if (distance > adaptiveThreshold) {
          let box = { x: 0, y: 0, width: 100, height: 100 };
          try {
            box = JSON.parse(face.box_json);
          } catch {
          }
          outliers.push({
            faceId: face.id,
            distance,
            blurScore: face.blur_score,
            box,
            photo_id: face.photo_id,
            file_path: face.file_path,
            preview_cache_path: face.preview_cache_path,
            photo_width: face.width,
            photo_height: face.height
          });
        }
      }
      console.log(`[FaceAnalysis] Person ${person.name}: Found ${outliers.length} outliers (REFERENCE method)`);
      outliers.sort((a, b) => b.distance - a.distance);
      return {
        personId,
        personName: person.name,
        totalFaces: faces.length,
        outliers,
        threshold: adaptiveThreshold,
        centroidValid: true
      };
    }
    console.log(`[FaceAnalysis] Person ${person.name}: No confirmed faces, using IQR method (may fail if >50% contaminated)`);
    return this.findOutliersIQR(personId, person, facesWithParsed, confirmedFaceIds, threshold);
  }
  /**
   * IQR-based outlier detection (fallback when no confirmed faces).
   * WARNING: This method fails when contamination exceeds ~50%.
   */
  static findOutliersIQR(personId, person, facesWithParsed, confirmedFaceIds, _threshold) {
    var _a, _b;
    const avgDistances = [];
    for (let i = 0; i < facesWithParsed.length; i++) {
      let totalDist = 0;
      let count = 0;
      for (let j = 0; j < facesWithParsed.length; j++) {
        if (i !== j) {
          const dist = this.computeDistance(
            facesWithParsed[i].parsedDescriptor,
            facesWithParsed[j].parsedDescriptor
          );
          totalDist += dist;
          count++;
        }
      }
      avgDistances.push({
        faceId: facesWithParsed[i].id,
        avgDist: count > 0 ? totalDist / count : 0,
        idx: i
      });
    }
    const sortedDists = [...avgDistances].sort((a, b) => a.avgDist - b.avgDist);
    const q1Idx = Math.floor(sortedDists.length * 0.25);
    const q3Idx = Math.floor(sortedDists.length * 0.75);
    const q1 = ((_a = sortedDists[q1Idx]) == null ? void 0 : _a.avgDist) ?? 0;
    const q3 = ((_b = sortedDists[q3Idx]) == null ? void 0 : _b.avgDist) ?? 0;
    const iqr = q3 - q1;
    const outlierThreshold = q3 + iqr * 1;
    console.log(`[FaceAnalysis] IQR: Q1=${q1.toFixed(3)}, Q3=${q3.toFixed(3)}, IQR=${iqr.toFixed(3)}, threshold=${outlierThreshold.toFixed(3)}`);
    const outliers = [];
    for (const { faceId, avgDist, idx } of avgDistances) {
      if (confirmedFaceIds.has(faceId)) continue;
      if (avgDist > outlierThreshold) {
        const face = facesWithParsed[idx];
        let box = { x: 0, y: 0, width: 100, height: 100 };
        try {
          box = JSON.parse(face.box_json);
        } catch {
        }
        outliers.push({
          faceId: face.id,
          distance: avgDist,
          blurScore: face.blur_score,
          box,
          photo_id: face.photo_id,
          file_path: face.file_path,
          preview_cache_path: face.preview_cache_path,
          photo_width: face.width,
          photo_height: face.height
        });
      }
    }
    console.log(`[FaceAnalysis] Found ${outliers.length} outliers (IQR method)`);
    outliers.sort((a, b) => b.distance - a.distance);
    return {
      personId,
      personName: person.name,
      totalFaces: facesWithParsed.length,
      outliers,
      threshold: outlierThreshold,
      centroidValid: true
    };
  }
  /**
   * Detect background/noise faces for bulk ignore.
   * Sends data to Python backend for DBSCAN clustering and centroid distance calculation.
   * 
   * @param options Threshold overrides from SmartIgnoreSettings
   * @param pythonProvider Python AI provider for backend calls
   */
  static async detectBackgroundFaces(options, pythonProvider2) {
    const unnamedFaces = FaceRepository.getUnnamedFacesForNoiseDetection();
    if (unnamedFaces.length === 0) {
      return {
        candidates: [],
        stats: { totalUnnamed: 0, singlePhotoCount: 0, twoPhotoCount: 0, noiseCount: 0 }
      };
    }
    const people = PersonRepository.getPeopleWithDescriptors();
    const centroids = people.map((p) => ({
      personId: p.id,
      name: p.name,
      descriptor: p.descriptor
    })).filter((c) => c.descriptor.length > 0);
    const facesPayload = unnamedFaces.map((f) => ({
      id: f.id,
      descriptor: this.parseDescriptor(f.descriptor) || [],
      photo_id: f.photo_id,
      box_json: f.box_json,
      file_path: f.file_path,
      preview_cache_path: f.preview_cache_path,
      width: f.width,
      height: f.height
    })).filter((f) => f.descriptor.length > 0);
    console.log(`[FaceAnalysis] detectBackgroundFaces: ${facesPayload.length} faces, ${centroids.length} centroids`);
    const result = await pythonProvider2.sendRequest("detect_background_faces", {
      faces: facesPayload,
      centroids,
      minPhotoAppearances: options.minPhotoAppearances ?? 3,
      maxClusterSize: options.maxClusterSize ?? 2,
      centroidDistanceThreshold: options.centroidDistanceThreshold ?? 0.7
    });
    if (!result.success && result.error) {
      throw new Error(result.error);
    }
    const candidates = (result.candidates || []).map((c) => {
      let box = { x: 0, y: 0, width: 100, height: 100 };
      try {
        if (c.box_json) box = JSON.parse(c.box_json);
      } catch {
      }
      return {
        faceId: c.faceId,
        photoCount: c.photoCount,
        clusterSize: c.clusterSize,
        nearestPersonDistance: c.nearestPersonDistance,
        nearestPersonName: c.nearestPersonName,
        box,
        photo_id: c.photo_id,
        file_path: c.file_path,
        preview_cache_path: c.preview_cache_path,
        photo_width: c.width,
        photo_height: c.height
      };
    });
    return {
      candidates,
      stats: result.stats || { totalUnnamed: 0, singlePhotoCount: 0, twoPhotoCount: 0, noiseCount: 0 }
    };
  }
  /**
   * Quality-adjusted threshold for challenging faces (Phase 5).
   * Low quality faces (side profiles, occlusions) get a more relaxed threshold.
   * 
   * @param baseThreshold - Standard threshold (e.g., 0.6)
   * @param faceQuality - Quality score from 0-1 (from Python backend)
   * @returns Adjusted threshold
   */
  static getQualityAdjustedThreshold(baseThreshold, faceQuality) {
    const adjustment = (0.6 - faceQuality) * 0.25;
    return Math.max(0.3, Math.min(0.9, baseThreshold + adjustment));
  }
  /**
   * Determine the best match from a set of candidates using weighted voting.
   * Weights are inversely proportional to distance.
   */
  static consensusVoting(matches) {
    if (!matches || matches.length === 0) return null;
    const votes = /* @__PURE__ */ new Map();
    for (const m of matches) {
      const entry = votes.get(m.personId) || { count: 0, weight: 0, bestDist: Infinity };
      const w = 1 / (1 + m.distance * m.distance);
      votes.set(m.personId, {
        count: entry.count + 1,
        weight: entry.weight + w,
        bestDist: Math.min(entry.bestDist, m.distance)
      });
    }
    let winnerId = -1;
    let maxWeight = -1;
    for (const [pid, stats] of votes.entries()) {
      const totalScore = stats.weight * (1 + Math.log(stats.count));
      if (totalScore > maxWeight) {
        maxWeight = totalScore;
        winnerId = pid;
      }
    }
    if (winnerId !== -1) {
      const stats = votes.get(winnerId);
      return {
        personId: winnerId,
        confidence: maxWeight,
        // Raw score for now
        distance: stats.bestDist
      };
    }
    return null;
  }
}
class FaceService {
  /**
   * Modular formula for matching a descriptor against the entire library.
   * Uses a Hybrid Strategy: Centroids first, then FAISS fallback.
   */
  static async matchFace(descriptor, options = {}) {
    const settings = getAISettings();
    const threshold = options.threshold ?? settings.faceSimilarityThreshold ?? 0.65;
    let descArray = [];
    if (descriptor instanceof Buffer || descriptor instanceof Uint8Array) {
      descArray = Array.from(new Float32Array(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength / 4));
    } else if (typeof descriptor === "string") {
      descArray = JSON.parse(descriptor);
    } else if (Array.isArray(descriptor)) {
      descArray = descriptor;
    } else {
      return null;
    }
    const candidates = options.candidatePeople ?? PersonRepository.getPeopleWithDescriptors();
    const centroidMatch = this.matchAgainstCentroids(descArray, candidates, threshold);
    if (centroidMatch) return { ...centroidMatch, matchType: "centroid" };
    if (options.searchFn) {
      const distThreshold = 1 / Math.max(0.01, threshold) - 1;
      const faissResults = await options.searchFn([descArray], options.topK ?? 5, distThreshold);
      if (faissResults.length > 0 && faissResults[0].length > 0) {
        const matches = faissResults[0];
        const matchedFaceIds = matches.map((m) => m.id);
        const db2 = getDB();
        const placeholders = matchedFaceIds.map(() => "?").join(",");
        const rows = db2.prepare(`
                    SELECT f.person_id, p.name 
                    FROM faces f 
                    JOIN people p ON f.person_id = p.id 
                    WHERE f.id IN (${placeholders}) AND f.person_id IS NOT NULL 
                    LIMIT 1
                `).all(...matchedFaceIds);
        if (rows.length > 0) {
          const bestMatch = matches[0];
          return {
            personId: rows[0].person_id,
            personName: rows[0].name,
            similarity: 1 / (1 + ((bestMatch == null ? void 0 : bestMatch.distance) ?? 0)),
            distance: (bestMatch == null ? void 0 : bestMatch.distance) ?? 0,
            matchType: "faiss"
          };
        }
      }
    }
    return null;
  }
  /**
   * Efficient batch matching for multiple descriptors.
   */
  static async matchBatch(descriptors, options = {}) {
    const settings = getAISettings();
    const threshold = options.threshold ?? settings.faceSimilarityThreshold ?? 0.65;
    const results = new Array(descriptors.length).fill(null);
    const parsedDescriptors = descriptors.map((d) => {
      if (d instanceof Buffer || d instanceof Uint8Array) {
        return Array.from(new Float32Array(d.buffer, d.byteOffset, d.byteLength / 4));
      }
      if (typeof d === "string") return JSON.parse(d);
      return d;
    });
    const candidates = options.candidatePeople ?? PersonRepository.getPeopleWithDescriptors();
    logger.debug(`[FaceService] matchBatch: Checking ${parsedDescriptors.length} faces against ${candidates.length} candidates.`);
    for (let i = 0; i < parsedDescriptors.length; i++) {
      const match = this.matchAgainstCentroids(parsedDescriptors[i], candidates, threshold);
      if (match) {
        logger.info(`[FaceService] Centroid Match Found: Face ${i} -> ${match.personName} (dist: ${match.distance.toFixed(3)})`);
        results[i] = { ...match, matchType: "centroid" };
      } else {
        const debugBest = this.matchAgainstCentroids(parsedDescriptors[i], candidates, 10);
        if (debugBest) {
          logger.debug(`[FaceService] No match for Face ${i}. Closest candidate: ${debugBest.personName} (dist: ${debugBest.distance.toFixed(3)}) > threshold ${threshold}`);
        } else {
          logger.debug(`[FaceService] No match for Face ${i} and NO candidates found within safety threshold.`);
        }
      }
    }
    const pendingIndices = results.map((r, i) => r === null ? i : -1).filter((i) => i !== -1);
    if (pendingIndices.length > 0 && options.searchFn) {
      const pendingDescriptors = pendingIndices.map((i) => parsedDescriptors[i]);
      const batchFaiss = await options.searchFn(pendingDescriptors, options.topK ?? 5, threshold);
      const allMatchedFaceIds = /* @__PURE__ */ new Set();
      batchFaiss.forEach((mList) => mList.forEach((m) => allMatchedFaceIds.add(m.id)));
      if (allMatchedFaceIds.size > 0) {
        const db2 = getDB();
        const placeholders = Array.from(allMatchedFaceIds).map(() => "?").join(",");
        const rows = db2.prepare(`
                    SELECT f.id, f.person_id, p.name 
                    FROM faces f 
                    JOIN people p ON f.person_id = p.id 
                    WHERE f.id IN (${placeholders}) AND f.person_id IS NOT NULL
                `).all(...Array.from(allMatchedFaceIds));
        const faceToPerson = /* @__PURE__ */ new Map();
        rows.forEach((r) => faceToPerson.set(r.id, { personId: r.person_id, name: r.name }));
        for (let j = 0; j < pendingIndices.length; j++) {
          const originalIdx = pendingIndices[j];
          const matches = batchFaiss[j];
          const candidates2 = [];
          const personNames = /* @__PURE__ */ new Map();
          for (const m of matches) {
            if (faceToPerson.has(m.id)) {
              const p = faceToPerson.get(m.id);
              candidates2.push({ personId: p.personId, distance: m.distance });
              if (!personNames.has(p.personId)) personNames.set(p.personId, p.name);
            }
          }
          const consensus = FaceAnalysisService.consensusVoting(candidates2);
          if (consensus) {
            results[originalIdx] = {
              personId: consensus.personId,
              personName: personNames.get(consensus.personId),
              similarity: 1 / (1 + consensus.distance),
              distance: consensus.distance,
              matchType: "faiss"
            };
          } else if (candidates2.length > 0) {
            const best = candidates2[0];
            results[originalIdx] = {
              personId: best.personId,
              personName: personNames.get(best.personId),
              similarity: 1 / (1 + best.distance),
              distance: best.distance,
              matchType: "faiss"
            };
          }
        }
      }
    }
    return results;
  }
  static matchAgainstCentroids(descriptor, candidates, threshold) {
    if (!descriptor || candidates.length === 0) return null;
    let mag = 0;
    for (const val of descriptor) mag += val * val;
    mag = Math.sqrt(mag);
    const normalized = mag > 0 ? descriptor.map((v) => v / mag) : descriptor;
    let bestMatch = null;
    let minDist = Infinity;
    for (const person of candidates) {
      const globalCentroid = person.descriptor || person.mean;
      if (globalCentroid && globalCentroid.length === normalized.length) {
        const dist = this.calculateL2Distance(normalized, globalCentroid);
        if (dist < minDist) {
          minDist = dist;
          bestMatch = person;
        }
      }
      if (person.eras && person.eras.length > 0) {
        for (const era of person.eras) {
          if (era.centroid && era.centroid.length === normalized.length) {
            const dist = this.calculateL2Distance(normalized, era.centroid);
            if (dist < minDist) {
              minDist = dist;
              bestMatch = person;
            }
          }
        }
      }
    }
    const similarity = 1 / (1 + minDist);
    if (bestMatch && minDist <= threshold) {
      return { personId: bestMatch.id, personName: bestMatch.name, distance: minDist, similarity };
    }
    return null;
  }
  // Public helper for other services
  static calculateL2Distance(v1, v2) {
    let sumSq = 0;
    for (let i = 0; i < v1.length; i++) {
      const diff = v1[i] - v2[i];
      sumSq += diff * diff;
    }
    return Math.sqrt(sumSq);
  }
  /**
   * Auto-assign unassigned faces to named people.
   * 
   * CRITICAL FIXES (v0.5.1):
   * - Freeze centroids at start (no mid-batch recalculation)
   * - Filter by confidence tier (only 'high' by default)
   * - Cap assignments per person (prevent cascade absorption)
   * - Return queued/capped faces for user review
   */
  static async autoAssignFaces(faceIds, thresholdOverride, searchFn, options) {
    const opts = { ...this.AUTO_ASSIGN_DEFAULTS, ...options };
    const settings = getAISettings();
    const HIGH_THRESHOLD = thresholdOverride ?? settings.autoAssignThreshold ?? 0.7;
    const REVIEW_THRESHOLD = settings.reviewThreshold || 0.9;
    try {
      const frozenCentroids = PersonRepository.getPeopleWithDescriptors();
      logger.info(`[AutoAssign] Frozen ${frozenCentroids.length} person centroids for batch operation.`);
      const candidates = FaceRepository.getFacesForClustering();
      const faces = faceIds && faceIds.length > 0 ? candidates.filter((f) => faceIds.includes(f.id)) : candidates;
      if (faces.length === 0) {
        return { success: true, count: 0, assigned: [], queuedForReview: [], capped: [] };
      }
      logger.info(`[AutoAssign] Processing ${faces.length} faces against ${frozenCentroids.length} people...`);
      const matchResults = await this.matchBatch(
        faces.map((f) => f.descriptor),
        {
          threshold: REVIEW_THRESHOLD,
          // Capture all candidates up to review tier
          candidatePeople: frozenCentroids,
          searchFn: opts.useFaissFallback ? searchFn : void 0
        }
      );
      const assigned = [];
      const queuedForReview = [];
      const capped = [];
      const assignmentCounts = /* @__PURE__ */ new Map();
      const affectedPeople = /* @__PURE__ */ new Set();
      for (let i = 0; i < faces.length; i++) {
        const match = matchResults[i];
        if (!match) continue;
        const face = faces[i];
        const dist = match.distance;
        let tier = "unknown";
        if (dist < HIGH_THRESHOLD) {
          tier = "high";
        } else if (dist < REVIEW_THRESHOLD) {
          tier = "review";
        }
        if (!opts.tierFilter.includes(tier)) {
          if (tier === "review") {
            queuedForReview.push({
              faceId: face.id,
              personId: match.personId,
              distance: dist,
              personName: match.personName
            });
          }
          continue;
        }
        const currentCount = assignmentCounts.get(match.personId) ?? 0;
        if (currentCount >= opts.maxAssignmentsPerPerson) {
          capped.push({
            faceId: face.id,
            personId: match.personId,
            reason: `Exceeded ${opts.maxAssignmentsPerPerson} assignments for ${match.personName}`
          });
          continue;
        }
        assigned.push({
          faceId: face.id,
          personId: match.personId,
          similarity: match.similarity,
          tier
        });
        assignmentCounts.set(match.personId, currentCount + 1);
        affectedPeople.add(match.personId);
      }
      if (assigned.length > 0) {
        const groupedByPerson = /* @__PURE__ */ new Map();
        for (const a of assigned) {
          const existing = groupedByPerson.get(a.personId) || [];
          existing.push(a.faceId);
          groupedByPerson.set(a.personId, existing);
        }
        for (const [personId, faceIdList] of groupedByPerson) {
          FaceRepository.updateFacePerson(faceIdList, personId);
        }
      }
      if (!opts.deferRecalculation && affectedPeople.size > 0) {
        logger.info(`[AutoAssign] Recalculating means for ${affectedPeople.size} affected people...`);
        for (const pid of affectedPeople) {
          await PersonService.recalculatePersonMean(pid);
        }
      }
      logger.info(`[AutoAssign] Complete: ${assigned.length} assigned, ${queuedForReview.length} queued for review, ${capped.length} capped`);
      return {
        success: true,
        count: assigned.length,
        assigned,
        queuedForReview,
        capped,
        affectedPeople: Array.from(affectedPeople)
      };
    } catch (e) {
      logger.error("Auto-Assign failed:", e);
      return { success: false, error: String(e) };
    }
  }
  static async processAnalysisResult(photoId, faces, width, height, aiProvider) {
    logger.info(`[FaceService] Processing ${faces.length} faces for photo ${photoId}`);
    const db2 = getDB();
    const existingFaces = FaceRepository.getFacesByPhoto(photoId);
    if (width && height) {
      try {
        db2.prepare("UPDATE photos SET width = ?, height = ? WHERE id = ?").run(width, height, photoId);
      } catch (e) {
      }
    }
    const facesForFaiss = [];
    const descriptorsToMatch = faces.filter((f) => f.descriptor && f.descriptor.length > 0).map((f) => f.descriptor);
    const settings = getAISettings();
    const HIGH_THRESHOLD = settings.autoAssignThreshold || 0.7;
    const REVIEW_THRESHOLD = settings.reviewThreshold || 0.9;
    const SEARCH_CUTOFF = Math.max(REVIEW_THRESHOLD + 0.1, 1);
    let matchResults = [];
    if (descriptorsToMatch.length > 0) {
      matchResults = await this.matchBatch(descriptorsToMatch, {
        threshold: SEARCH_CUTOFF,
        // L2 distance - captures all candidates within review range
        searchFn: aiProvider ? async (d, k, t) => aiProvider.searchFaces(d, k, t) : void 0
      });
      const matchCount = matchResults.filter((m) => m !== null).length;
      const highCount = matchResults.filter((m) => m && m.distance < HIGH_THRESHOLD).length;
      const reviewCount = matchResults.filter((m) => m && m.distance >= HIGH_THRESHOLD && m.distance < REVIEW_THRESHOLD).length;
      logger.info(`[FaceService] Tier Stats: ${descriptorsToMatch.length} descriptors, ${matchCount} matched, ${highCount} high, ${reviewCount} review (thresholds: high<${HIGH_THRESHOLD}, review<${REVIEW_THRESHOLD})`);
    }
    let matchIdx = 0;
    let assignedCount = 0;
    db2.transaction(() => {
      for (const face of faces) {
        let bestMatch = null;
        let maxIoU = 0;
        for (const oldFace of existingFaces) {
          const oldBox = oldFace.box;
          const newBox = face.box;
          const interX1 = Math.max(newBox.x, oldBox.x);
          const interY1 = Math.max(newBox.y, oldBox.y);
          const interX2 = Math.min(newBox.x + newBox.width, oldBox.x + oldBox.width);
          const interY2 = Math.min(newBox.y + newBox.height, oldBox.y + oldBox.height);
          const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1);
          const unionArea = newBox.width * newBox.height + oldBox.width * oldBox.height - interArea;
          const iou = unionArea > 0 ? interArea / unionArea : 0;
          if (iou > 0.5 && iou > maxIoU) {
            maxIoU = iou;
            bestMatch = oldFace;
          }
        }
        let descriptorBuffer = null;
        let matchData = null;
        if (face.descriptor && Array.isArray(face.descriptor)) {
          descriptorBuffer = Buffer.from(new Float32Array(face.descriptor).buffer);
          if (face.descriptor.length > 0) {
            matchData = matchResults[matchIdx++];
            if (matchData) {
              logger.debug(`[FaceService] Scan match for face: dist=${matchData.distance.toFixed(3)}, person=${matchData.personId}`);
            }
          }
        }
        let personId = bestMatch ? bestMatch.person_id : null;
        let suggestedPersonId = bestMatch ? bestMatch.suggested_person_id : null;
        let confidenceTier = bestMatch ? bestMatch.confidence_tier : "unknown";
        let matchDistance = bestMatch ? bestMatch.match_distance : null;
        if (matchData) {
          const dist = matchData.distance;
          matchDistance = dist;
          const fQuality = face.faceQuality ?? 0.5;
          const adjHighThreshold = FaceAnalysisService.getQualityAdjustedThreshold(HIGH_THRESHOLD, fQuality);
          const adjReviewThreshold = FaceAnalysisService.getQualityAdjustedThreshold(REVIEW_THRESHOLD, fQuality);
          if (dist < adjHighThreshold) {
            if (!personId) {
              personId = matchData.personId;
              confidenceTier = "high";
              suggestedPersonId = matchData.personId;
              assignedCount++;
            }
          } else if (dist < adjReviewThreshold) {
            if (!personId) {
              confidenceTier = "review";
              suggestedPersonId = matchData.personId;
              logger.info(`[FaceService] Face classified as REVIEW tier (dist=${matchDistance == null ? void 0 : matchDistance.toFixed(3)} < ${adjReviewThreshold.toFixed(3)}). Suggested: ${matchData.personId}`);
            }
          } else {
            logger.info(`[FaceService] Face classified as UNKNOWN tier (dist=${matchDistance == null ? void 0 : matchDistance.toFixed(3)} >= ${adjReviewThreshold.toFixed(3)})`);
          }
        }
        let finalId = 0;
        if (bestMatch) {
          db2.prepare(`
                        UPDATE faces 
                        SET descriptor = ?, box_json = ?, blur_score = ?, 
                            confidence_tier = ?, suggested_person_id = ?, match_distance = ?,
                            pose_yaw = ?, pose_pitch = ?, pose_roll = ?, face_quality = ?,
                            person_id = COALESCE(person_id, ?) -- Only set if null
                        WHERE id = ?
                    `).run(
            descriptorBuffer,
            JSON.stringify(face.box),
            face.blurScore,
            confidenceTier,
            suggestedPersonId,
            matchDistance,
            face.poseYaw ?? null,
            face.posePitch ?? null,
            face.poseRoll ?? null,
            face.faceQuality ?? null,
            personId,
            // Coalesce fallback
            bestMatch.id
          );
          finalId = bestMatch.id;
        } else {
          const info = db2.prepare(`
                        INSERT INTO faces (
                            photo_id, person_id, descriptor, box_json, blur_score, 
                            is_reference, confidence_tier, suggested_person_id, match_distance,
                            pose_yaw, pose_pitch, pose_roll, face_quality
                        )
                        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
                     `).run(
            photoId,
            personId,
            descriptorBuffer,
            JSON.stringify(face.box),
            face.blurScore,
            confidenceTier,
            suggestedPersonId,
            matchDistance,
            face.poseYaw ?? null,
            face.posePitch ?? null,
            face.poseRoll ?? null,
            face.faceQuality ?? null
          );
          finalId = Number(info.lastInsertRowid);
        }
        if (finalId > 0 && personId && (!bestMatch || bestMatch.person_id !== personId)) ;
        if (finalId > 0 && face.descriptor && face.descriptor.length > 0) {
          facesForFaiss.push({ id: finalId, descriptor: face.descriptor });
        }
      }
    })();
    if (facesForFaiss.length > 0 && aiProvider) {
      aiProvider.addToIndex(facesForFaiss);
    }
    if (assignedCount > 0) logger.info(`[FaceService] Auto-assigned ${assignedCount} faces via scan-time logic.`);
  }
}
/**
 * Options for auto-assign operation.
 */
__publicField(FaceService, "AUTO_ASSIGN_DEFAULTS", {
  maxAssignmentsPerPerson: 50,
  // Cap to prevent single person absorbing wrong faces
  tierFilter: ["high"],
  // Only assign high-confidence by default
  deferRecalculation: false,
  // Recalc at end by default
  useFaissFallback: false
  // Disable FAISS for bulk to prevent voting issues
});
class PhotoRepository {
  static getPhotos(page = 1, limit = 50, sort = "date_desc", filter = {}, offset) {
    const db2 = getDB();
    const calculatedOffset = offset !== void 0 ? offset : (page - 1) * limit;
    let orderBy = "created_at DESC";
    switch (sort) {
      case "date_asc":
        orderBy = "created_at ASC";
        break;
      case "name_asc":
        orderBy = "file_path ASC";
        break;
      case "name_desc":
        orderBy = "file_path DESC";
        break;
    }
    const params = [];
    const conditions = [];
    if (filter.folder) {
      conditions.push("file_path LIKE ?");
      params.push(`${filter.folder}%`);
    }
    if (filter.search) {
      conditions.push("file_path LIKE ?");
      params.push(`%${filter.search}%`);
    }
    if (filter.tag) {
      conditions.push("id IN (SELECT photo_id FROM photo_tags pt JOIN tags t ON pt.tag_id = t.id WHERE t.name = ?)");
      params.push(filter.tag);
    }
    if (filter.people && filter.people.length > 0) {
      const personId = filter.people[0];
      conditions.push("id IN (SELECT photo_id FROM faces WHERE person_id = ?)");
      params.push(personId);
    }
    if (filter.untagged === "untagged") {
      conditions.push("id IN (SELECT photo_id FROM faces WHERE person_id IS NULL)");
    }
    let whereClause = "";
    if (conditions.length > 0) {
      whereClause = " WHERE " + conditions.join(" AND ");
    }
    try {
      const query = `SELECT * FROM photos${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
      const countQuery = `SELECT COUNT(*) as count FROM photos${whereClause}`;
      const photos = db2.prepare(query).all(...params, limit, calculatedOffset);
      const total = db2.prepare(countQuery).get(...params).count;
      return { photos, total };
    } catch (e) {
      throw new Error(`PhotoRepository.getPhotos failed: ${String(e)}`);
    }
  }
  static getLibraryStats() {
    const db2 = getDB();
    try {
      try {
        db2.function("DIRNAME", (p) => path__default.dirname(p));
        db2.function("EXTNAME", (p) => path__default.extname(p).toLowerCase());
      } catch (e) {
      }
      const total = db2.prepare("SELECT COUNT(*) as count FROM photos").get().count;
      const fileTypes = db2.prepare(`
                SELECT EXTNAME(file_path) as type, COUNT(*) as count 
                FROM photos 
                GROUP BY type 
                ORDER BY count DESC
            `).all();
      const folders = db2.prepare(`
                SELECT DISTINCT DIRNAME(file_path) as folder, COUNT(*) as count 
                FROM photos 
                GROUP BY folder 
                ORDER BY count DESC
            `).all();
      return { totalPhotos: total, fileTypes, folders };
    } catch (e) {
      throw new Error(`PhotoRepository.getLibraryStats failed: ${String(e)}`);
    }
  }
  static getUnprocessedPhotos() {
    const db2 = getDB();
    return db2.prepare("SELECT * FROM photos WHERE blur_score IS NULL LIMIT 1000").all();
  }
  static getFolders() {
    const db2 = getDB();
    const rows = db2.prepare("SELECT DISTINCT file_path FROM photos").all();
    const folders = new Set(rows.map((r) => path__default.dirname(r.file_path)));
    return Array.from(folders).sort().map((f) => ({ folder: f }));
  }
  static getPhotoById(id) {
    const db2 = getDB();
    return db2.prepare("SELECT * FROM photos WHERE id = ?").get(id);
  }
  static updatePhoto(id, updates) {
    const db2 = getDB();
    const sets = [];
    const params = [];
    if (updates.description !== void 0) {
      sets.push("description = ?");
      params.push(updates.description);
    }
    if (updates.blur_score !== void 0) {
      sets.push("blur_score = ?");
      params.push(updates.blur_score);
    }
    if (sets.length > 0) {
      params.push(id);
      db2.prepare(`UPDATE photos SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    }
  }
  static getMetricsHistory(limit = 1e3) {
    const db2 = getDB();
    try {
      const history = db2.prepare("SELECT * FROM scan_history ORDER BY timestamp DESC LIMIT ?").all(limit);
      const stats = db2.prepare(`
                SELECT 
                    COUNT(*) as total_scans,
                    SUM(CASE WHEN face_count > 0 THEN 1 ELSE 0 END) as face_scans,
                    SUM(COALESCE(scan_ms, 0) + COALESCE(tag_ms, 0)) as total_processing_time,
                    SUM(COALESCE(face_count, 0)) as total_faces
                FROM scan_history
                WHERE status = 'success'
            `).get();
      const aggregated = {
        total_scans: (stats == null ? void 0 : stats.total_scans) || 0,
        face_scans: (stats == null ? void 0 : stats.face_scans) || 0,
        total_processing_time: (stats == null ? void 0 : stats.total_processing_time) || 0,
        total_faces: (stats == null ? void 0 : stats.total_faces) || 0
      };
      return { success: true, history, stats: aggregated };
    } catch (e) {
      console.error("getMetricsHistory error:", e);
      throw new Error(`PhotoRepository.getMetricsHistory failed: ${String(e)}`);
    }
  }
  static recordScanHistory(data) {
    const db2 = getDB();
    try {
      console.log(`[PhotoRepository] Recording history: Photo=${data.photoId} Status=${data.status} Scan=${data.scanMs}ms`);
      db2.prepare(`
                INSERT INTO scan_history (photo_id, file_path, scan_ms, tag_ms, face_count, scan_mode, status, error, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
        data.photoId,
        data.filePath,
        data.scanMs,
        data.tagMs || 0,
        data.faceCount,
        data.scanMode,
        data.status,
        data.error || null,
        Date.now()
      );
    } catch (e) {
      console.error("Failed to record scan history:", e);
    }
  }
  static getScanErrors() {
    const db2 = getDB();
    return db2.prepare("SELECT * FROM scan_errors ORDER BY timestamp DESC").all();
  }
  static async deleteScanErrorAndFile(id, deleteFile) {
    const db2 = getDB();
    try {
      const errorRecord = db2.prepare("SELECT file_path FROM scan_errors WHERE id = ?").get(id);
      if (deleteFile && errorRecord && errorRecord.file_path) {
        try {
          await promises.unlink(errorRecord.file_path);
        } catch (err) {
          console.error("Failed to delete file:", err);
        }
        db2.prepare("DELETE FROM photos WHERE file_path = ?").run(errorRecord.file_path);
      }
      db2.prepare("DELETE FROM scan_errors WHERE id = ?").run(id);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }
  static retryScanErrors() {
    const db2 = getDB();
    const errors = db2.prepare("SELECT file_path FROM scan_errors").all();
    db2.prepare("DELETE FROM scan_errors").run();
    return errors.map((e) => e.file_path);
  }
  static getFilePaths(ids) {
    if (ids.length === 0) return [];
    const db2 = getDB();
    const placeholders = ids.map(() => "?").join(",");
    const rows = db2.prepare(`SELECT file_path FROM photos WHERE id IN (${placeholders})`).all(...ids);
    return rows.map((r) => r.file_path);
  }
  static getPhotosForTargetedScan(options) {
    const db2 = getDB();
    const params = [];
    const conditions = [];
    if (options.folderPath) {
      conditions.push("file_path LIKE ?");
      params.push(`${options.folderPath}%`);
    }
    if (options.onlyWithFaces) {
      conditions.push("id IN (SELECT DISTINCT photo_id FROM faces)");
    }
    let whereClause = "";
    if (conditions.length > 0) {
      whereClause = " WHERE " + conditions.join(" AND ");
    }
    try {
      const query = `SELECT id FROM photos${whereClause}`;
      const rows = db2.prepare(query).all(...params);
      return rows;
    } catch (e) {
      console.error("getPhotosForTargetedScan Error:", e);
      return [];
    }
  }
  static getPhotosForRescan(options) {
    return this.getPhotos(1, 1e5, "date_desc", options.filter || {}, 0).photos.map((p) => p.id);
  }
  static getAllTags() {
    const db2 = getDB();
    return db2.prepare("SELECT * FROM tags ORDER BY name ASC").all();
  }
  static getTagsForPhoto(photoId) {
    const db2 = getDB();
    const rows = db2.prepare(`
            SELECT t.name 
            FROM tags t
            JOIN photo_tags pt ON t.id = pt.tag_id
            WHERE pt.photo_id = ?
        `).all(photoId);
    return rows.map((r) => r.name);
  }
  static removeTag(photoId, tagName) {
    const db2 = getDB();
    const tag = db2.prepare("SELECT id FROM tags WHERE name = ?").get(tagName);
    if (tag) {
      db2.prepare("DELETE FROM photo_tags WHERE photo_id = ? AND tag_id = ?").run(photoId, tag.id);
    }
  }
  static addTags(photoId, tags) {
    const db2 = getDB();
    const insertTag = db2.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
    const getTagId = db2.prepare("SELECT id FROM tags WHERE name = ?");
    const linkTag = db2.prepare("INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, source) VALUES (?, ?, ?)");
    const transaction = db2.transaction(() => {
      for (const tag of tags) {
        const lower = tag.toLowerCase();
        insertTag.run(lower);
        const tagId = getTagId.get(lower);
        if (tagId) linkTag.run(photoId, tagId.id, "auto");
      }
    });
    transaction();
  }
  static cleanupTags() {
    console.log("[PhotoRepository] Starting cleanupTags...");
    const db2 = getDB();
    let deletedCount = 0;
    let mergedCount = 0;
    const transaction = db2.transaction(() => {
      const allTags = db2.prepare("SELECT id, name FROM tags").all();
      const insertTag = db2.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
      const getTagId = db2.prepare("SELECT id FROM tags WHERE name = ?");
      const linkTag = db2.prepare("INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, source) VALUES (?, ?, ?)");
      const getPhotoIds = db2.prepare("SELECT photo_id FROM photo_tags WHERE tag_id = ?");
      const deleteTag = db2.prepare("DELETE FROM tags WHERE id = ?");
      const deleteLink = db2.prepare("DELETE FROM photo_tags WHERE tag_id = ?");
      for (const tag of allTags) {
        const cleanName = tag.name.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
        const parts = cleanName.split(/\s+/).filter((p) => p.length > 0);
        const needsUpdate = tag.name !== cleanName || parts.length > 1;
        if (needsUpdate) {
          const photoIds = getPhotoIds.all(tag.id);
          if (photoIds.length > 0) {
            for (const part of parts) {
              insertTag.run(part);
              const newTagId = getTagId.get(part);
              for (const p of photoIds) {
                linkTag.run(p.photo_id, newTagId.id, "auto");
              }
            }
            mergedCount += photoIds.length;
          }
          deleteLink.run(tag.id);
          deleteTag.run(tag.id);
          deletedCount++;
        }
      }
      const finalSweep = db2.prepare("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM photo_tags)").run();
      deletedCount += finalSweep.changes;
    });
    try {
      transaction();
      return { success: true, deletedCount, mergedCount };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  static clearAITags() {
    const db2 = getDB();
    try {
      const transaction = db2.transaction(() => {
        db2.prepare("DELETE FROM photo_tags WHERE source = 'auto'").run();
        db2.prepare("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM photo_tags)").run();
      });
      transaction();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  static factoryReset() {
    const db2 = getDB();
    try {
      const transaction = db2.transaction(() => {
        db2.prepare("DELETE FROM photo_tags").run();
        db2.prepare("DELETE FROM faces").run();
        db2.prepare("DELETE FROM people").run();
        db2.prepare("DELETE FROM tags").run();
        db2.prepare("DELETE FROM scan_errors").run();
        db2.prepare("DELETE FROM scan_history").run();
        db2.prepare("DELETE FROM photos").run();
      });
      transaction();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}
class PythonAIProvider {
  constructor() {
    __publicField(this, "process", null);
    __publicField(this, "mainWindow", null);
    __publicField(this, "scanPromises", /* @__PURE__ */ new Map());
  }
  setMainWindow(win) {
    this.mainWindow = win;
  }
  async start() {
    let pythonPath;
    let args;
    const LIBRARY_PATH2 = getLibraryPath();
    if (app.isPackaged) {
      pythonPath = path__default.join(process.resourcesPath, "python-bin", "smart-photo-ai", "smart-photo-ai.exe");
      args = [];
    } else {
      pythonPath = path__default.join(process.env.APP_ROOT, "src", "python", ".venv", "Scripts", "python.exe");
      const scriptPath = path__default.join(process.env.APP_ROOT, "src", "python", "main.py");
      args = [scriptPath];
    }
    logger.info(`[PythonAIProvider] Starting Python Backend: ${pythonPath}`);
    this.process = spawn(pythonPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        IS_DEV: app.isPackaged ? "false" : "true",
        HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
        LIBRARY_PATH: LIBRARY_PATH2,
        LOG_PATH: path__default.join(app.getPath("userData"), "logs"),
        PYTORCH_CUDA_ALLOC_CONF: "expandable_segments:True"
      }
    });
    this.setupListeners();
    setTimeout(() => this.syncSettings(), 2e3);
  }
  setupListeners() {
    if (!this.process) return;
    if (this.process.stdout) {
      const reader = createInterface({ input: this.process.stdout });
      reader.on("line", async (line) => {
        try {
          const message = JSON.parse(line);
          this.handleMessage(message);
        } catch (e) {
          logger.info("[Python Raw]", line);
        }
      });
    }
    if (this.process.stderr) {
      this.process.stderr.on("data", (data) => {
        const msg = data.toString();
        if (msg.toLowerCase().includes("error")) logger.error(`[Python Error] ${msg}`);
        else logger.info(`[Python Log] ${msg}`);
      });
    }
    this.process.on("close", (code) => {
      logger.warn(`Python process exited with code ${code}`);
      this.process = null;
    });
  }
  async handleMessage(message) {
    var _a;
    const resId = message.reqId || message.photoId || message.payload && message.payload.reqId;
    if (resId && this.scanPromises.has(resId)) {
      const p = this.scanPromises.get(resId);
      if (message.error) p == null ? void 0 : p.reject(message.error);
      else p == null ? void 0 : p.resolve(message);
      this.scanPromises.delete(resId);
    }
    if (message.type === "analysis_result") {
      if (!message.error && message.faces && message.faces.length > 0) {
        await FaceService.processAnalysisResult(message.photoId, message.faces, message.width, message.height, this);
      }
      try {
        const metrics = message.metrics || {};
        logger.info(`[Metrics] Recording history for photo ${message.photoId}`);
        PhotoRepository.recordScanHistory({
          photoId: message.photoId,
          filePath: message.filePath || "",
          scanMs: metrics.scan || metrics.total || 0,
          tagMs: metrics.tag || 0,
          faceCount: message.faces ? message.faces.length : 0,
          scanMode: ((_a = message.payload) == null ? void 0 : _a.scanMode) || "FAST",
          status: message.error ? "error" : "success",
          error: message.error
        });
      } catch (e) {
        logger.error("[Main] Failed to record scan history:", e);
      }
    }
    if (this.mainWindow && ["scan_result", "tags_result", "analysis_result"].includes(message.type)) {
      this.mainWindow.webContents.send("ai:scan-result", message);
    }
    if (this.mainWindow && ["download_progress", "download_result"].includes(message.type)) {
      this.mainWindow.webContents.send("ai:model-progress", message);
    }
  }
  stop() {
    if (this.process) {
      logger.info("[PythonAIProvider] Stopping Python Backend...");
      this.process.kill();
      this.process = null;
    }
  }
  syncSettings() {
    const aiSettings = getAISettings();
    const vlmEnabled = aiSettings.aiProfile === "high";
    this.sendCommand("update_config", { config: { ...aiSettings, vlmEnabled } });
  }
  sendCommand(type, payload) {
    if (this.process && this.process.stdin) {
      this.process.stdin.write(JSON.stringify({ type, payload }) + "\n");
    }
  }
  sendRequest(type, payload, timeoutMs = 3e4) {
    return new Promise((resolve, reject) => {
      const requestId = Math.floor(Math.random() * 1e6);
      this.scanPromises.set(requestId, { resolve, reject });
      this.sendCommand(type, { ...payload, reqId: requestId });
      setTimeout(() => {
        if (this.scanPromises.has(requestId)) {
          this.scanPromises.delete(requestId);
          reject("Timeout");
        }
      }, timeoutMs);
    });
  }
  // IAIProvider Implementation
  async analyzeImage(filePath, options) {
    return this.sendRequest("analyze_image", { filePath, ...options });
  }
  async clusterFaces(faces, eps, minSamples) {
    return this.sendRequest("cluster_faces", { faces, eps, minSamples });
  }
  async searchFaces(descriptors, k, threshold) {
    const res = await this.sendRequest("batch_search_index", { descriptors, k, threshold });
    if (res.error) throw new Error(res.error);
    return res.results;
  }
  async generateThumbnail(filePath, options) {
    return this.sendRequest("generate_thumbnail", { filePath, ...options });
  }
  async rotateImage(_filePath, _rotation) {
    return Promise.resolve();
  }
  async checkStatus(options = {}) {
    return this.sendRequest("get_system_status", options, 5e3);
  }
  // Custom helper
  addToIndex(faces) {
    this.sendCommand("add_faces_to_vector_index", { faces });
  }
}
const pythonProvider = new PythonAIProvider();
class PhotoService {
  static async getExifTool() {
    if (this._exiftool) return this._exiftool;
    if (this._exiftoolInitPromise) return this._exiftoolInitPromise;
    this._exiftoolInitPromise = (async () => {
      try {
        logger.info("Initializing ExifTool in PhotoService...");
        const tool = new ExifTool({ taskTimeoutMillis: 5e3, maxProcs: 1 });
        await tool.version();
        this._exiftool = tool;
        return tool;
      } catch (err) {
        logger.error("FAILED to initialize ExifTool.", err);
        return null;
      }
    })();
    return this._exiftoolInitPromise;
  }
  // --- PREVIEW GENERATION ---
  static async extractPreview(filePath, previewDir, forceRescan = false, throwOnError = false) {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const hash = createHash("md5").update(normalizedPath).digest("hex");
    const previewPath = path__default.join(previewDir, `${hash}.jpg`);
    try {
      if (!forceRescan) {
        try {
          await promises.access(previewPath);
          return previewPath;
        } catch {
        }
      }
      const ext = path__default.extname(filePath).toLowerCase();
      const isRaw = ![".jpg", ".jpeg", ".png"].includes(ext);
      let rotationDegrees = 0;
      let shouldRotate = false;
      try {
        const tool = await this.getExifTool();
        if (tool) {
          const tags = await tool.read(filePath, ["Orientation"]);
          if (tags == null ? void 0 : tags.Orientation) {
            const val = tags.Orientation;
            if (val === 3 || val.toString().includes("180")) {
              rotationDegrees = 180;
              shouldRotate = true;
            } else if (val === 6 || val.toString().includes("90 CW")) {
              rotationDegrees = 90;
              shouldRotate = true;
            } else if (val === 8 || val.toString().includes("270 CW")) {
              rotationDegrees = 270;
              shouldRotate = true;
            }
          }
        }
      } catch (e) {
      }
      let extracted = false;
      if (isRaw && ![".tif", ".tiff"].includes(ext)) {
        try {
          const tool = await this.getExifTool();
          if (tool) {
            const tempPreviewPath = `${previewPath}.tmp`;
            await tool.extractPreview(filePath, tempPreviewPath);
            await promises.access(tempPreviewPath);
            const pipeline = sharp(tempPreviewPath);
            if (shouldRotate) pipeline.rotate(rotationDegrees);
            await pipeline.resize(2560, 2560, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(previewPath);
            try {
              await promises.unlink(tempPreviewPath);
            } catch {
            }
            extracted = true;
          }
        } catch (e) {
        }
      }
      if (!extracted) {
        try {
          const pipeline = sharp(filePath);
          if (shouldRotate) pipeline.rotate(rotationDegrees);
          await pipeline.resize(2560, 2560, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(previewPath);
          extracted = true;
        } catch (e) {
        }
      }
      if (!extracted) {
        const res = await pythonProvider.generateThumbnail(filePath, { width: 2560 });
        if (res.success && res.data) {
          await promises.writeFile(previewPath, Buffer.from(res.data, "base64"));
          extracted = true;
        }
      }
      if (extracted) return previewPath;
      if (throwOnError) throw new Error("Failed to generate preview");
    } catch (e) {
      logger.error(`Preview generation failed key=${filePath}`, e);
      if (throwOnError) throw e;
    }
    return null;
  }
  // --- ROTATION ---
  static async rotatePhoto(photoId, filePath, rotationDegrees) {
    const previewsDir = path__default.join(getLibraryPath(), "previews");
    await promises.mkdir(previewsDir, { recursive: true });
    path__default.extname(filePath).toLowerCase();
    return pythonProvider.rotateImage(filePath, rotationDegrees);
  }
  // --- AI WRAPPERS ---
  static async generateTags(photoId, filePath) {
    const result = await pythonProvider.sendRequest("generate_tags", { photoId, filePath }, 6e4);
    if (result && !result.error && (result.description || result.tags)) {
      const updates = [];
      if (result.description) {
        PhotoRepository.updatePhoto(photoId, { description: result.description });
        updates.push("Description saved");
      }
      if (result.tags) {
        PhotoRepository.addTags(photoId, result.tags);
        updates.push(`Tags saved: ${result.tags.length}`);
      }
      result.dbStatus = updates.join(", ");
    }
    return result;
  }
  static async analyzeImage(options) {
    return pythonProvider.analyzeImage(options.filePath, options);
  }
}
__publicField(PhotoService, "_exiftool", null);
__publicField(PhotoService, "_exiftoolInitPromise", null);
function registerAIHandlers() {
  ipcMain.handle("ai:command", async (_event, command) => {
    const { type, payload } = command;
    let timeout = 3e4;
    if (type === "cluster_faces" || type === "analyze_image") timeout = 3e5;
    return await pythonProvider.sendRequest(type, payload, timeout);
  });
  ipcMain.handle("ai:analyzeImage", async (_event, options) => {
    let { photoId, filePath, ...rest } = options;
    if (!filePath && photoId) {
      const db2 = getDB();
      const row = db2.prepare("SELECT file_path FROM photos WHERE id = ?").get(photoId);
      if (row) filePath = row.file_path;
    }
    if (!filePath) return { success: false, error: "Missing filePath" };
    logger.info(`[Main] Analyze Request ${photoId}`);
    return await PhotoService.analyzeImage({ photoId, filePath, ...rest });
  });
  ipcMain.handle("ai:scanImage", async (_event, options) => {
    let { photoId, filePath, ...rest } = options;
    if (!filePath && photoId) {
      const db2 = getDB();
      const row = db2.prepare("SELECT file_path FROM photos WHERE id = ?").get(photoId);
      if (row) filePath = row.file_path;
    }
    if (!filePath) return { success: false, error: "Missing filePath" };
    return await PhotoService.analyzeImage({ photoId, filePath, scanMode: "FAST", ...rest });
  });
  ipcMain.handle("ai:generateTags", async (_event, { photoId }) => {
    const db2 = getDB();
    const photo = db2.prepare("SELECT file_path FROM photos WHERE id = ?").get(photoId);
    if (!photo) return { success: false, error: "Photo not found" };
    return await PhotoService.generateTags(photoId, photo.file_path);
  });
  ipcMain.handle("ai:getSettings", () => getAISettings());
  ipcMain.handle("ai:saveSettings", (_event, settings) => {
    setAISettings(settings);
    pythonProvider.syncSettings();
    return true;
  });
  ipcMain.handle("ai:downloadModel", async (_event, { modelName }) => {
    let url = void 0;
    if (modelName.includes("Runtime")) {
      const aiSettings = getAISettings();
      if (aiSettings.runtimeUrl) {
        url = aiSettings.runtimeUrl;
      } else {
        url = `https://github.com/arozz7/smart-photo-organizer/releases/download/v${app.getVersion()}/ai-runtime-win-x64.zip`;
      }
    }
    return await pythonProvider.sendRequest("download_model", { modelName, url }, 18e5);
  });
  ipcMain.handle("ai:enhanceImage", async (_event, options) => {
    return await pythonProvider.sendRequest("enhance_image", options, 3e5);
  });
  ipcMain.handle("ai:getSystemStatus", async () => {
    const aiSettings = getAISettings();
    let runtimeUrl = aiSettings.runtimeUrl;
    if (!runtimeUrl) {
      runtimeUrl = `https://github.com/arozz7/smart-photo-organizer/releases/download/v${app.getVersion()}/ai-runtime-win-x64.zip`;
    }
    const res = await pythonProvider.checkStatus({ runtimeUrl });
    return res.status;
  });
  ipcMain.handle("face:getBlurry", async (_event, args) => {
    return FaceRepository.getBlurryFaces(args);
  });
  ipcMain.handle("ai:clusterFaces", async (_, args) => {
    const { faceIds, eps, min_samples } = args;
    const ids = faceIds || [];
    if (ids.length === 0) return { clusters: [], singles: [] };
    try {
      const faces = FaceRepository.getFacesByIds(ids);
      const formattedFaces = faces.filter((f) => f.descriptor && f.descriptor.length > 0).map((f) => ({ id: f.id, descriptor: f.descriptor }));
      return await pythonProvider.clusterFaces(formattedFaces, eps, min_samples);
    } catch (e) {
      logger.error(`[IPC] ai:clusterFaces failed: ${e}`);
      return { clusters: [], singles: [] };
    }
  });
  ipcMain.handle("ai:rebuildIndex", async () => {
    try {
      const faces = FaceRepository.getNamedFaceDescriptors();
      logger.info(`[Main] Rebuilding FAISS index with ${faces.length} named person faces`);
      return await pythonProvider.sendRequest("rebuild_index", {
        descriptors: faces.map((f) => f.descriptor),
        ids: faces.map((f) => f.id)
      }, 6e5);
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });
  ipcMain.handle("ai:saveVectorIndex", async () => {
    return await pythonProvider.sendRequest("save_vector_index", {}, 3e4);
  });
  ipcMain.handle("ai:addFacesToVectorIndex", async (_event, { vectors, ids }) => {
    return await pythonProvider.sendRequest("add_faces_to_vector_index", { vectors, ids }, 6e4);
  });
  ipcMain.handle("ai:getClusteredFaces", async (_event, options) => {
    try {
      const faces = FaceRepository.getUnassignedDescriptors();
      const payload = {
        faces,
        // [{id, descriptor}, ...]
        ...options
      };
      return await pythonProvider.sendRequest("cluster_faces", payload, 3e5);
    } catch (e) {
      logger.error(`[Main] ai:getClusteredFaces failed: ${e}`);
      return { clusters: [], singles: [] };
    }
  });
  ipcMain.handle("ai:searchIndex", async (_event, { descriptor, k, threshold }) => {
    return await pythonProvider.sendRequest("search_index", { descriptor, k, threshold });
  });
  ipcMain.handle("ai:matchFace", async (_event, { descriptor, options }) => {
    const searchFn = async (d, k, t) => pythonProvider.searchFaces(d, k, t);
    return await FaceService.matchFace(descriptor, { ...options, searchFn });
  });
  ipcMain.handle("ai:matchBatch", async (_event, { descriptors, options }) => {
    const searchFn = async (d, k, t) => pythonProvider.searchFaces(d, k, t);
    return await FaceService.matchBatch(descriptors, { ...options, searchFn });
  });
  ipcMain.handle("face:findPotentialMatches", async (_event, { faceIds, threshold }) => {
    try {
      const faces = FaceRepository.getFacesByIds(faceIds);
      const descriptors = faces.map((f) => f.descriptor).filter(Boolean);
      const validFaceIds = faces.filter((f) => f.descriptor).map((f) => f.id);
      if (descriptors.length === 0) return { success: true, matches: [] };
      const searchFn = async (d, k, t) => pythonProvider.searchFaces(d, k, t);
      const matches = await FaceService.matchBatch(descriptors, { threshold, searchFn });
      const results = matches.map((m, i) => m ? {
        faceId: validFaceIds[i],
        match: m
      } : null).filter(Boolean);
      return { success: true, matches: results };
    } catch (e) {
      logger.error(`[IPC] face:findPotentialMatches failed: ${e}`);
      return { success: false, error: String(e) };
    }
  });
}
function registerDBHandlers() {
  ipcMain.handle("db:getLibraryStats", async () => {
    try {
      return { success: true, stats: PhotoRepository.getLibraryStats() };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });
  ipcMain.handle("db:getScanErrors", async () => PhotoRepository.getScanErrors());
  ipcMain.handle("db:deleteScanError", async (_, { id, deleteFile }) => PhotoRepository.deleteScanErrorAndFile(id, deleteFile));
  ipcMain.handle("db:clearScanErrors", async () => {
    return { success: false, error: "Not implemented in refactor yet" };
  });
  ipcMain.handle("db:cleanupTags", async () => {
    console.log("[Main] db:cleanupTags called");
    const res = PhotoRepository.cleanupTags();
    console.log("[Main] db:cleanupTags result:", res);
    return res;
  });
  ipcMain.handle("db:clearAITags", async () => {
    console.log("[Main] db:clearAITags called");
    return PhotoRepository.clearAITags();
  });
  ipcMain.handle("db:factoryReset", async () => {
    console.log("[Main] db:factoryReset called");
    const res = PhotoRepository.factoryReset();
    try {
      await pythonProvider.sendRequest("rebuild_index", { descriptors: [], ids: [] });
      console.log("[Main] FAISS Index cleared.");
    } catch (err) {
      console.error("[Main] Failed to clear FAISS index:", err);
    }
    try {
      ConfigService.updateSettings({ ai_queue: [] });
      console.log("[Main] AI Processing Queue cleared.");
    } catch (err) {
      console.error("[Main] Failed to clear AI Queue:", err);
    }
    return res;
  });
  ipcMain.handle("db:getAllTags", async () => PhotoRepository.getAllTags());
  ipcMain.handle("db:getTags", async (_, photoId) => PhotoRepository.getTagsForPhoto(photoId));
  ipcMain.handle("db:removeTag", async (_, { photoId, tag }) => {
    PhotoRepository.removeTag(photoId, tag);
    return { success: true };
  });
  ipcMain.handle("db:addTags", async (_, { photoId, tags }) => {
    PhotoRepository.addTags(photoId, tags);
    return { success: true };
  });
  ipcMain.handle("db:getPhotos", async (_, args) => {
    try {
      return PhotoRepository.getPhotos(args.page, args.limit, args.sort, args.filter, args.offset);
    } catch (e) {
      return { photos: [], total: 0, error: String(e) };
    }
  });
  ipcMain.handle("db:getPhoto", async (_, id) => PhotoRepository.getPhotoById(id));
  ipcMain.handle("db:getFolders", async () => PhotoRepository.getFolders());
  ipcMain.handle("db:getUnprocessedItems", async () => PhotoRepository.getUnprocessedPhotos());
  ipcMain.handle("db:getPhotosMissingBlurScores", async () => {
    try {
      const db2 = getDB();
      const query = `
                SELECT id FROM photos 
                WHERE blur_score IS NULL 
                AND (
                    id IN (SELECT photo_id FROM scan_history)
                    OR
                    id IN (SELECT photo_id FROM faces)
                )
            `;
      const rows = db2.prepare(query).all();
      return { success: true, photoIds: rows.map((r) => r.id) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });
  ipcMain.handle("db:getFaces", async (_, photoId) => FaceRepository.getFacesByPhoto(photoId));
  ipcMain.handle("db:getFacesByIds", async (_, ids) => FaceRepository.getFacesByIds(ids));
  ipcMain.handle("db:getAllFaces", async (_, args) => {
    return FaceRepository.getAllFaces(args.limit, args.offset, args.filter, args.includeDescriptors);
  });
  ipcMain.handle("db:ignoreFaces", async (_, ids) => {
    FaceRepository.ignoreFaces(ids);
    return { success: true };
  });
  ipcMain.handle("db:ignoreFace", async (_, id) => {
    FaceRepository.ignoreFaces([id]);
    return { success: true };
  });
  ipcMain.handle("db:getIgnoredFaces", async (_, args) => {
    return FaceRepository.getIgnoredFaces((args == null ? void 0 : args.page) || 1, (args == null ? void 0 : args.limit) || 50);
  });
  ipcMain.handle("db:restoreFaces", async (_, { faceIds, personId }) => {
    FaceRepository.restoreFaces(faceIds, personId);
    if (personId) {
      await PersonService.recalculatePersonMean(personId);
    }
    return { success: true };
  });
  ipcMain.handle("db:restoreFace", async (_, id) => {
    FaceRepository.restoreFaces([id]);
    return { success: true };
  });
  ipcMain.handle("db:removeDuplicateFaces", async () => {
    return { success: false, error: "Not implemented" };
  });
  ipcMain.handle("db:autoAssignFaces", async (_, args) => {
    const searchFn = async (descriptors, k, th) => {
      return pythonProvider.searchFaces(descriptors, k, th);
    };
    const aiSettings = ConfigService.getAISettings();
    const threshold = aiSettings.autoAssignThreshold || 0.7;
    return FaceService.autoAssignFaces(args.faceIds, threshold, searchFn);
  });
  ipcMain.handle("db:updateFaces", async (_, _args) => {
    return { success: false, error: "Not implemented" };
  });
  ipcMain.handle("db:deleteFaces", async (_, faceIds) => {
    FaceRepository.deleteFaces(faceIds);
    return { success: true };
  });
  ipcMain.handle("db:recalculatePersonModel", async (_, personId) => {
    return await PersonService.recalculatePersonMean(personId);
  });
  ipcMain.handle("db:unassignFaces", async (_, faceIds) => {
    await PersonService.unassignFaces(faceIds);
    return { success: true };
  });
  ipcMain.handle("db:generateEras", async (_, args) => {
    const { personId, config } = args;
    return await PersonService.generateEras(personId, config);
  });
  ipcMain.handle("db:getEras", async (_, personId) => {
    return PersonRepository.getEras(personId);
  });
  ipcMain.handle("db:deleteEra", async (_, eraId) => {
    PersonRepository.deleteEra(eraId);
    return { success: true };
  });
  ipcMain.handle("db:getPeople", async () => PersonRepository.getPeople());
  ipcMain.handle("db:setPersonCover", async (_, { personId, faceId }) => {
    PersonRepository.setPersonCover(personId, faceId);
    return { success: true };
  });
  ipcMain.handle("db:getPerson", async (_, id) => PersonRepository.getPersonById(id));
  ipcMain.handle("db:assignPerson", async (_, { faceId, personName }) => {
    return await PersonService.assignPerson(faceId, personName);
  });
  ipcMain.handle("db:renamePerson", async (_, { personId, newName }) => {
    return await PersonService.renamePerson(personId, newName);
  });
  ipcMain.handle("db:getPersonMeanDescriptor", async (_, personId) => {
    const person = PersonRepository.getPersonById(personId);
    if (person && person.descriptor_mean_json) {
      try {
        return JSON.parse(person.descriptor_mean_json);
      } catch (e) {
        return null;
      }
    }
    return null;
  });
  ipcMain.handle("db:getPeopleWithDescriptors", async () => {
    let people = PersonRepository.getPeopleWithDescriptors();
    const db2 = getDB();
    if (people.length === 0) {
      const allPeople = PersonRepository.getPeople();
      if (allPeople.length > 0) {
        const faceCount = db2.prepare("SELECT COUNT(*) as c FROM faces").get();
        const descCount = db2.prepare("SELECT COUNT(*) as c FROM faces WHERE descriptor IS NOT NULL").get();
        console.log(`[Main] db:getPeopleWithDescriptors: Found ${allPeople.length} people, 0 with means.`);
        console.log(`[Main] DB Stats: ${faceCount.c} faces, ${descCount.c} have descriptors.`);
        if (descCount.c > 0) {
          console.log("[Main] Descriptors exist. Triggering auto-recalc of person means...");
          await PersonService.recalculateAllMeans();
          people = PersonRepository.getPeopleWithDescriptors();
          console.log(`[Main] Recalc done. New People with Means: ${people.length}`);
        } else {
          console.warn("[Main] NO DESCRIPTORS in DB. Quick Scan will fail. Deep Scan required.");
        }
      }
    }
    return people;
  });
  ipcMain.handle("db:getPhotosForTargetedScan", async (_, options) => PhotoRepository.getPhotosForTargetedScan(options));
  ipcMain.handle("db:getPhotosForRescan", async (_, options) => PhotoRepository.getPhotosForRescan(options));
  ipcMain.handle("db:retryScanErrors", async () => {
    return PhotoRepository.retryScanErrors();
  });
  ipcMain.handle("db:getFilePaths", async (_, ids) => PhotoRepository.getFilePaths(ids));
  ipcMain.handle("db:getMetricsHistory", async (_, limit) => PhotoRepository.getMetricsHistory(limit));
  ipcMain.handle("db:reassignFaces", async (_, { faceIds, personName }) => {
    const normalizedName = personName.trim();
    let person = PersonRepository.getPersonByName(normalizedName);
    if (!person) person = PersonRepository.createPerson(normalizedName);
    FaceRepository.updateFacePerson(faceIds, person.id);
    await PersonService.recalculatePersonMean(person.id);
    return { success: true, person };
  });
  ipcMain.handle("db:moveFacesToPerson", async (_event, faceIds, targetName) => {
    return PersonService.moveFacesToPerson(faceIds, targetName);
  });
  ipcMain.handle("debug:getBlurStats", async () => {
    try {
      const db2 = getDB();
      const total = db2.prepare("SELECT COUNT(*) as count FROM faces").get();
      const scored = db2.prepare("SELECT COUNT(*) as count FROM faces WHERE blur_score IS NOT NULL").get();
      return {
        success: true,
        stats: {
          total: total.count,
          scored_count: scored.count,
          null_count: total.count - scored.count
        }
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });
  ipcMain.handle("db:getFaceMetadata", async (_event, ids) => {
    if (!ids || ids.length === 0) return [];
    const db2 = getDB();
    const placeholders = ids.map(() => "?").join(",");
    return db2.prepare(`
            SELECT f.id, f.person_id, f.photo_id, p.file_path, p.preview_cache_path
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.id IN (${placeholders})
        `).all(...ids);
  });
  ipcMain.handle("db:associateMatchedFaces", async (_, { personId, faceIds }) => {
    FaceRepository.updateFacePerson(faceIds, personId);
    await PersonService.recalculatePersonMean(personId);
    return { success: true };
  });
  ipcMain.handle("db:associateBulkMatchedFaces", async (_, associations) => {
    const groups = /* @__PURE__ */ new Map();
    for (const { personId, faceId } of associations) {
      if (!groups.has(personId)) groups.set(personId, []);
      groups.get(personId).push(faceId);
    }
    for (const [personId, faceIds] of groups.entries()) {
      FaceRepository.updateFacePerson(faceIds, personId);
      await PersonService.recalculatePersonMean(personId);
    }
    return { success: true };
  });
  ipcMain.handle("person:findOutliers", async (_, { personId, threshold }) => {
    try {
      const result = FaceAnalysisService.findOutliersForPerson(
        personId,
        threshold ?? 0.6
      );
      return { success: true, ...result };
    } catch (error) {
      console.error("[Main] person:findOutliers failed:", error);
      return { success: false, error: String(error) };
    }
  });
  ipcMain.handle("db:detectBackgroundFaces", async (_, options) => {
    try {
      const settings = ConfigService.getSmartIgnoreSettings();
      const merged = {
        minPhotoAppearances: (options == null ? void 0 : options.minPhotoAppearances) ?? settings.minPhotoAppearances,
        maxClusterSize: (options == null ? void 0 : options.maxClusterSize) ?? settings.maxClusterSize,
        centroidDistanceThreshold: (options == null ? void 0 : options.centroidDistanceThreshold) ?? settings.centroidDistanceThreshold
      };
      const result = await FaceAnalysisService.detectBackgroundFaces(merged, pythonProvider);
      return { success: true, ...result };
    } catch (error) {
      console.error("[Main] db:detectBackgroundFaces failed:", error);
      return { success: false, error: String(error) };
    }
  });
  ipcMain.handle("db:confirmFaces", async (_, faceIds) => {
    try {
      FaceRepository.setConfirmed(faceIds, true);
      return { success: true, confirmed: faceIds.length };
    } catch (error) {
      console.error("[Main] db:confirmFaces failed:", error);
      return { success: false, error: String(error) };
    }
  });
  ipcMain.handle("db:unconfirmFaces", async (_, faceIds) => {
    try {
      FaceRepository.setConfirmed(faceIds, false);
      return { success: true, unconfirmed: faceIds.length };
    } catch (error) {
      console.error("[Main] db:unconfirmFaces failed:", error);
      return { success: false, error: String(error) };
    }
  });
  ipcMain.handle("db:getPoseBackfillStatus", async () => {
    try {
      const status = FaceRepository.getPoseBackfillCount();
      return {
        success: true,
        needsBackfill: status.needsBackfill,
        total: status.total,
        completed: status.total - status.needsBackfill,
        percent: status.total > 0 ? Math.round((status.total - status.needsBackfill) / status.total * 100) : 100
      };
    } catch (error) {
      console.error("[Main] db:getPoseBackfillStatus failed:", error);
      return { success: false, error: String(error) };
    }
  });
  ipcMain.handle("db:processPoseBackfillBatch", async (_, { batchSize = 10 }) => {
    try {
      const faces = FaceRepository.getFacesNeedingPoseBackfill(batchSize);
      if (faces.length === 0) {
        return { success: true, processed: 0, message: "No faces need backfill" };
      }
      let processed = 0;
      let failed = 0;
      for (const face of faces) {
        try {
          const box = JSON.parse(face.box_json);
          const filePath = face.file_path;
          const orientation = face.orientation || 1;
          const result = await pythonProvider.sendRequest("extract_face_pose", {
            filePath,
            box,
            orientation,
            faceId: face.id
          });
          if (result.success) {
            FaceRepository.updateFacePoseData(face.id, {
              pose_yaw: result.poseYaw ?? 0,
              pose_pitch: result.posePitch ?? 0,
              pose_roll: result.poseRoll ?? 0,
              face_quality: result.faceQuality ?? 0.5
            });
            processed++;
          } else {
            FaceRepository.updateFacePoseData(face.id, {
              pose_yaw: 0,
              // Sentinel value indicating "processed but no pose"
              pose_pitch: null,
              pose_roll: null,
              face_quality: null
            });
            failed++;
          }
        } catch (e) {
          console.error(`[Main] Failed to backfill pose for face ${face.id}:`, e);
          failed++;
        }
      }
      const status = FaceRepository.getPoseBackfillCount();
      return {
        success: true,
        processed,
        failed,
        remaining: status.needsBackfill,
        percent: status.total > 0 ? Math.round((status.total - status.needsBackfill) / status.total * 100) : 100
      };
    } catch (error) {
      console.error("[Main] db:processPoseBackfillBatch failed:", error);
      return { success: false, error: String(error) };
    }
  });
}
function registerSettingsHandlers() {
  ipcMain.handle("settings:getLibraryPath", () => {
    return getLibraryPath();
  });
  ipcMain.handle("settings:moveLibrary", async (_, newPath) => {
    console.log(`[Main] Configuring move library to: ${newPath}`);
    const LIBRARY_PATH2 = getLibraryPath();
    try {
      const stats = await fs.stat(newPath);
      if (!stats.isDirectory()) return { success: false, error: "Target is not a directory" };
    } catch {
      return { success: false, error: "Target directory does not exist" };
    }
    try {
      closeDB();
      pythonProvider.stop();
      console.log("[Main] Moving files...");
      const itemsToMove = ["library.db", "previews", "vectors.index", "id_map.pkl", "library.db-shm", "library.db-wal"];
      await new Promise((resolve) => setTimeout(resolve, 1e3));
      for (const item of itemsToMove) {
        const src = path.join(LIBRARY_PATH2, item);
        const dest = path.join(newPath, item);
        try {
          await fs.access(src);
          console.log(`Copying ${src} -> ${dest}`);
          await fs.cp(src, dest, { recursive: true, force: true });
        } catch (e) {
          if (e.code === "ENOENT") continue;
          throw new Error(`Failed to copy ${item}: ${e.message}`);
        }
      }
      setLibraryPath(newPath);
      console.log("Cleaning up old files...");
      for (const item of itemsToMove) {
        const src = path.join(LIBRARY_PATH2, item);
        try {
          await fs.rm(src, { recursive: true, force: true });
        } catch (e) {
          console.error(`Failed to cleanup ${src}:`, e);
        }
      }
      console.log("[Main] Restarting application...");
      app.relaunch();
      app.exit(0);
      return { success: true };
    } catch (e) {
      console.error("[Main] Move failed:", e);
      return { success: false, error: e };
    }
  });
  ipcMain.handle("settings:getQueueConfig", async () => {
    const s = ConfigService.getSettings().queue;
    return {
      batchSize: s.batchSize || 0,
      cooldownSeconds: s.cooldownSeconds || 60
    };
  });
  ipcMain.handle("settings:setQueueConfig", async (_, config) => {
    ConfigService.updateQueueConfig({
      batchSize: config.batchSize,
      cooldownSeconds: config.cooldownSeconds
    });
    return { success: true };
  });
  ipcMain.handle("settings:getAIQueue", () => {
    return ConfigService.getSettings().ai_queue || [];
  });
  ipcMain.handle("settings:setAIQueue", (_, queue) => {
    ConfigService.updateSettings({ ai_queue: queue });
  });
  ipcMain.handle("settings:getPreviewStats", async () => {
    const LIBRARY_PATH2 = getLibraryPath();
    const previewDir = path.join(LIBRARY_PATH2, "previews");
    let count = 0;
    let size = 0;
    try {
      await fs.access(previewDir);
      const files = await fs.readdir(previewDir);
      for (const file of files) {
        if (file.endsWith(".jpg") || file.endsWith(".jpeg")) {
          try {
            const s = await fs.stat(path.join(previewDir, file));
            count++;
            size += s.size;
          } catch {
          }
        }
      }
      return { success: true, count, size };
    } catch {
      return { success: true, count: 0, size: 0 };
    }
  });
  ipcMain.handle("settings:cleanupPreviews", async (_, { days }) => {
    const LIBRARY_PATH2 = getLibraryPath();
    const previewDir = path.join(LIBRARY_PATH2, "previews");
    let deletedCount = 0;
    let deletedSize = 0;
    const now = Date.now();
    const maxAge = (days || 0) * 24 * 60 * 60 * 1e3;
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
        } catch {
        }
      }
      return { success: true, deletedCount, deletedSize };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle("settings:getSmartIgnoreSettings", () => {
    return ConfigService.getSmartIgnoreSettings();
  });
  ipcMain.handle("settings:updateSmartIgnoreSettings", (_, settings) => {
    ConfigService.updateSmartIgnoreSettings(settings);
    return { success: true };
  });
}
async function getExifTool() {
  return PhotoService.getExifTool();
}
const SUPPORTED_EXTS = [".jpg", ".jpeg", ".png", ".arw", ".cr2", ".nef", ".dng", ".orf", ".rw2", ".tif", ".tiff"];
async function extractPreview(filePath, previewDir, forceRescan = false) {
  return PhotoService.extractPreview(filePath, previewDir, forceRescan, true);
}
async function processFile(fullPath, previewDir, db2, options = {}) {
  const { forceRescan } = options;
  const ext = path__default.extname(fullPath).toLowerCase();
  if (!SUPPORTED_EXTS.includes(ext)) return null;
  const selectStmt = db2.prepare("SELECT * FROM photos WHERE file_path = ?");
  const insertStmt = db2.prepare(`
        INSERT INTO photos (file_path, preview_cache_path, created_at, metadata_json, width, height) 
        VALUES (@file_path, @preview_cache_path, @created_at, @metadata_json, @width, @height)
        ON CONFLICT(file_path) DO NOTHING
    `);
  let photo = selectStmt.get(fullPath);
  let needsUpdate = false;
  let isNew = false;
  if (photo) {
    if (forceRescan) {
      isNew = true;
      needsUpdate = true;
    }
    const isRaw = ![".jpg", ".jpeg", ".png"].includes(ext);
    let previewMissing = false;
    if (isRaw) {
      if (photo.preview_cache_path) {
        try {
          await promises.access(photo.preview_cache_path);
          const stats = await promises.stat(photo.preview_cache_path);
          if (stats.size === 0) {
            logger.debug(`[Scanner] Preview exists but is 0 bytes: ${photo.preview_cache_path}`);
            previewMissing = true;
          }
        } catch (accessErr) {
          logger.debug(`[Scanner] Preview missing (access failed) for ${fullPath} at ${photo.preview_cache_path}`);
          previewMissing = true;
        }
      } else {
        previewMissing = true;
      }
      if (previewMissing || forceRescan) {
        const tool = await getExifTool();
        if (tool) {
          try {
            const previewPath = await extractPreview(fullPath, previewDir, forceRescan);
            if (previewPath) {
              db2.prepare("UPDATE photos SET preview_cache_path = ? WHERE id = ?").run(previewPath, photo.id);
              photo.preview_cache_path = previewPath;
              needsUpdate = true;
              db2.prepare("DELETE FROM scan_errors WHERE photo_id = ?").run(photo.id);
            }
          } catch (e) {
            logger.error(`[Scanner] Preview generation failed for ${path__default.basename(fullPath)}`, e);
            db2.prepare("INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, ?, ?, ?)").run(photo.id, fullPath, e.message || String(e), "Preview Generation");
          }
        }
      }
    } else {
      if (photo.preview_cache_path) {
        try {
          await promises.access(photo.preview_cache_path);
          const stats = await promises.stat(photo.preview_cache_path);
          if (stats.size === 0) previewMissing = true;
        } catch {
          previewMissing = true;
        }
      } else {
        previewMissing = true;
      }
      if (previewMissing || forceRescan) {
        try {
          const previewPath = await extractPreview(fullPath, previewDir, forceRescan);
          if (previewPath) {
            db2.prepare("UPDATE photos SET preview_cache_path = ? WHERE id = ?").run(previewPath, photo.id);
            photo.preview_cache_path = previewPath;
            needsUpdate = true;
            db2.prepare("DELETE FROM scan_errors WHERE photo_id = ?").run(photo.id);
          }
        } catch (e) {
          logger.error(`[Scanner] Preview generation failed for ${path__default.basename(fullPath)}`, e);
          db2.prepare("INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, ?, ?, ?)").run(photo.id, fullPath, e.message || String(e), "Preview Generation");
        }
      }
    }
    if (!photo.metadata_json || photo.metadata_json === "{}" || forceRescan) {
      try {
        const tool = await getExifTool();
        if (tool) {
          const metadata = await tool.read(fullPath);
          let width = (metadata == null ? void 0 : metadata.ImageWidth) || (metadata == null ? void 0 : metadata.SourceImageWidth) || (metadata == null ? void 0 : metadata.ExifImageWidth) || null;
          let height = (metadata == null ? void 0 : metadata.ImageHeight) || (metadata == null ? void 0 : metadata.SourceImageHeight) || (metadata == null ? void 0 : metadata.ExifImageHeight) || null;
          const orientation = metadata == null ? void 0 : metadata.Orientation;
          const isRotated = orientation === 6 || orientation === 8 || orientation === 5 || orientation === 7 || orientation === "Rotate 90 CW" || orientation === "Rotate 270 CW";
          if (isRotated && width && height) {
            logger.info(`[Scanner] Detected Rotation for ${path__default.basename(fullPath)}: ${orientation}. Swapping ${width}x${height} -> ${height}x${width}`);
            const temp = width;
            width = height;
            height = temp;
          } else {
            logger.debug(`[Scanner] No Rotation detected for ${path__default.basename(fullPath)}: ${orientation} (W:${width}, H:${height})`);
          }
          db2.prepare("UPDATE photos SET metadata_json = ?, width = ?, height = ? WHERE id = ?").run(JSON.stringify(metadata), width, height, photo.id);
          photo.metadata_json = JSON.stringify(metadata);
          photo.width = width;
          photo.height = height;
          needsUpdate = true;
        }
      } catch (e) {
        logger.error(`Failed to backfill metadata for ${fullPath}`, e);
      }
    }
  }
  if (!photo) {
    logger.debug(`[Scanner] New photo found: ${path__default.basename(fullPath)}`);
    let previewPath = null;
    let previewError = null;
    try {
      previewPath = await extractPreview(fullPath, previewDir, forceRescan);
    } catch (e) {
      previewError = e;
      logger.error(`[Scanner] Initial preview failed for ${path__default.basename(fullPath)}`, e);
    }
    try {
      let metadata = {};
      let width = null;
      let height = null;
      try {
        const tool = await getExifTool();
        if (tool) {
          metadata = await tool.read(fullPath);
          width = (metadata == null ? void 0 : metadata.ImageWidth) || (metadata == null ? void 0 : metadata.SourceImageWidth) || (metadata == null ? void 0 : metadata.ExifImageWidth) || null;
          height = (metadata == null ? void 0 : metadata.ImageHeight) || (metadata == null ? void 0 : metadata.SourceImageHeight) || (metadata == null ? void 0 : metadata.ExifImageHeight) || null;
          const orientation = metadata == null ? void 0 : metadata.Orientation;
          const isRotated = orientation === 6 || orientation === 8 || orientation === 5 || orientation === 7 || orientation === "Rotate 90 CW" || orientation === "Rotate 270 CW";
          if (isRotated && width && height) {
            const temp = width;
            width = height;
            height = temp;
            logger.debug(`[Scanner] Swapped dimensions for ${path__default.basename(fullPath)} (Orientation: ${orientation})`);
          }
        }
      } catch (e) {
        logger.error(`Failed to read metadata for ${fullPath}`, e);
      }
      const info = insertStmt.run({
        file_path: fullPath,
        preview_cache_path: previewPath,
        // Might be null
        created_at: (/* @__PURE__ */ new Date()).toISOString(),
        metadata_json: JSON.stringify(metadata),
        width,
        height
      });
      const newPhotoId = info.lastInsertRowid;
      photo = selectStmt.get(fullPath);
      isNew = true;
      if (previewError) {
        db2.prepare("INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, ?, ?, ?)").run(newPhotoId, fullPath, previewError.message || String(previewError), "Initial Scan");
      }
    } catch (e) {
      logger.error("Insert failed", e);
    }
  }
  if (photo) {
    photo.isNew = isNew;
    photo.needsUpdate = needsUpdate;
    return photo;
  }
  return null;
}
async function scanFiles(filePaths, libraryPath, onProgress, options = {}) {
  const db2 = getDB();
  const photos = [];
  let count = 0;
  const previewDir = path__default.join(libraryPath, "previews");
  await promises.mkdir(previewDir, { recursive: true });
  logger.info(`Scanning ${filePaths.length} specific files...`);
  for (const filePath of filePaths) {
    try {
      await promises.access(filePath);
      const photo = await processFile(filePath, previewDir, db2, options);
      if (photo) {
        photos.push(photo);
        count++;
        if (onProgress && count % 5 === 0) onProgress(count);
      }
    } catch (e) {
      logger.error(`Failed to process specific file: ${filePath}`, e);
    }
  }
  if (onProgress) onProgress(count);
  return photos;
}
async function scanDirectory(dirPath, libraryPath, onProgress, options = {}) {
  const db2 = getDB();
  const photos = [];
  let count = 0;
  let totalFiles = 0;
  const skippedStats = {};
  const previewDir = path__default.join(libraryPath, "previews");
  await promises.mkdir(previewDir, { recursive: true });
  async function scan(currentPath) {
    try {
      logger.info(`Scanning directory: ${currentPath}`);
      const entries = await promises.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path__default.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".")) {
            await scan(fullPath);
          }
        } else if (entry.isFile()) {
          totalFiles++;
          const photo = await processFile(fullPath, previewDir, db2, options);
          if (photo) {
            photos.push(photo);
            count++;
            if (count % 10 === 0 || photo.needsUpdate) {
              if (onProgress) onProgress(count);
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          } else {
            const ext = path__default.extname(entry.name).toLowerCase();
            if (!SUPPORTED_EXTS.includes(ext)) {
              skippedStats[ext] = (skippedStats[ext] || 0) + 1;
            }
          }
        }
      }
    } catch (err) {
      logger.error(`Error scanning ${currentPath}:`, err);
    }
  }
  await scan(dirPath);
  logger.info(`[Scanner] Scanning Finished. Details: Total=${totalFiles}, New=${count}, Returned=${photos.length}, Skipped=${JSON.stringify(skippedStats)}`);
  return photos;
}
class ScanQueue {
  constructor() {
    __publicField(this, "queue", []);
    __publicField(this, "isProcessing", false);
  }
  enqueueDirectory(path2, options, sender) {
    return new Promise((resolve, reject) => {
      this.queue.push({ type: "directory", path: path2, options, resolve, reject, sender });
      this.processNext();
    });
  }
  enqueueFiles(paths, options, sender) {
    return new Promise((resolve, reject) => {
      this.queue.push({ type: "files", paths, options, resolve, reject, sender });
      this.processNext();
    });
  }
  async processNext() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;
    const task = this.queue.shift();
    if (!task) {
      this.isProcessing = false;
      return;
    }
    logger.info(`[ScanQueue] Starting task: ${task.type} - ${task.type === "directory" ? task.path : task.paths.length + " files"}`);
    try {
      const libraryPath = getLibraryPath();
      let result;
      if (task.type === "directory") {
        result = await scanDirectory(task.path, libraryPath, (count) => {
          if (!task.sender.isDestroyed()) {
            task.sender.send("scan-progress", count);
          }
        }, task.options);
      } else {
        result = await scanFiles(task.paths, libraryPath, (count) => {
          if (!task.sender.isDestroyed()) {
            task.sender.send("scan-progress", count);
          }
        }, task.options);
      }
      task.resolve(result);
    } catch (error) {
      logger.error(`[ScanQueue] Task failed:`, error);
      task.reject(error);
    } finally {
      this.isProcessing = false;
      this.processNext();
    }
  }
}
const scanQueue = new ScanQueue();
function registerFileHandlers() {
  ipcMain.handle("scan-directory", async (event, dirPath, options = {}) => {
    return await scanQueue.enqueueDirectory(dirPath, options, event.sender);
  });
  ipcMain.handle("scan-files", async (event, filePaths, options = {}) => {
    return await scanQueue.enqueueFiles(filePaths, options, event.sender);
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
    const fs2 = await import("node:fs/promises");
    try {
      const buffer = await fs2.readFile(filePath);
      return buffer;
    } catch (error) {
      logger.error("Failed to read file:", filePath, error);
      throw error;
    }
  });
}
function registerAppHandlers(getMainWindow) {
  ipcMain.handle("app:focusWindow", () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      return true;
    }
    return false;
  });
  ipcMain.handle("os:getLogPath", () => {
    return logger.getLogPath();
  });
  ipcMain.handle("os:showInFolder", (_, path2) => {
    shell.showItemInFolder(path2);
  });
  ipcMain.handle("os:openFolder", (_, path2) => {
    shell.openPath(path2);
  });
}
const __filename$2 = fileURLToPath(import.meta.url);
const __dirname$2 = path__default.dirname(__filename$2);
const VITE_DEV_SERVER_URL$1 = process.env["VITE_DEV_SERVER_URL"];
const APP_ROOT = process.env.APP_ROOT || path__default.join(__dirname$2, "..");
const RENDERER_DIST$1 = path__default.join(APP_ROOT, "dist");
const VITE_PUBLIC = VITE_DEV_SERVER_URL$1 ? path__default.join(APP_ROOT, "public") : RENDERER_DIST$1;
class WindowManager {
  static async createSplashWindow() {
    this.splash = new BrowserWindow({
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
    const splashFile = path__default.join(VITE_PUBLIC, "splash.html");
    logger.info(`[WindowManager] Loading splash from: ${splashFile}`);
    try {
      await fs.access(splashFile);
      this.splash.loadFile(splashFile);
    } catch (e) {
      logger.error(`[WindowManager] Splash file not found at ${splashFile}:`, e);
      if (VITE_DEV_SERVER_URL$1) {
        this.splash.loadURL(`${VITE_DEV_SERVER_URL$1}/splash.html`);
      }
    }
    this.splash.on("closed", () => this.splash = null);
    logger.info("[WindowManager] Splash window created");
  }
  static updateSplashStatus(status) {
    if (this.splash && !this.splash.isDestroyed()) {
      const safeStatus = status.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"');
      this.splash.webContents.executeJavaScript(`
                  var el = document.getElementById('status');
                  if(el) el.innerText = '${safeStatus}';
              `).catch(() => {
      });
    }
  }
  static closeSplash() {
    if (this.splash && !this.splash.isDestroyed()) {
      this.splash.close();
      this.splash = null;
    }
  }
  static async createMainWindow() {
    const savedBounds = getWindowBounds();
    const defaults = { width: 1200, height: 800 };
    let bounds = defaults;
    if (savedBounds && savedBounds.width && savedBounds.height) {
      const display = screen.getDisplayMatching({
        x: savedBounds.x || 0,
        y: savedBounds.y || 0,
        width: savedBounds.width,
        height: savedBounds.height
      });
      if (display) {
        if (savedBounds.x !== void 0 && savedBounds.y !== void 0) {
          bounds = { ...defaults, ...savedBounds };
        } else {
          bounds = { ...defaults, width: savedBounds.width, height: savedBounds.height };
        }
      }
    }
    const preloadPath = path__default.join(__dirname$2, "preload.mjs");
    this.win = new BrowserWindow({
      icon: path__default.join(VITE_PUBLIC, "icon.png"),
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      show: false,
      backgroundColor: "#111827",
      webPreferences: {
        preload: preloadPath,
        webSecurity: false,
        // @ts-ignore
        enableAutofill: false
        // Fixes DevTools console error
      }
    });
    pythonProvider.setMainWindow(this.win);
    const saveBounds = () => {
      if (!this.win) return;
      const { x, y, width, height } = this.win.getBounds();
      setWindowBounds({ x, y, width, height });
    };
    this.win.on("resized", saveBounds);
    this.win.on("moved", saveBounds);
    this.win.on("close", saveBounds);
    this.win.setMenu(null);
    this.win.webContents.on("before-input-event", (event, input) => {
      var _a;
      if (input.control && input.shift && input.key.toLowerCase() === "i") {
        (_a = this.win) == null ? void 0 : _a.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
    this.win.once("ready-to-show", () => {
      var _a;
      (_a = this.win) == null ? void 0 : _a.show();
      this.closeSplash();
    });
    this.win.webContents.on("did-finish-load", () => {
      var _a;
      (_a = this.win) == null ? void 0 : _a.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
    });
    if (VITE_DEV_SERVER_URL$1) {
      this.win.loadURL(VITE_DEV_SERVER_URL$1);
    } else {
      this.win.loadFile(path__default.join(RENDERER_DIST$1, "index.html"));
    }
    logger.info("[WindowManager] Main window created");
    return this.win;
  }
  static getMainWindow() {
    return this.win;
  }
}
__publicField(WindowManager, "win", null);
__publicField(WindowManager, "splash", null);
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = path__default.dirname(__filename$1);
const LIBRARY_PATH = getLibraryPath();
logger.info(`[Main] Library Path: ${LIBRARY_PATH}`);
process.env.APP_ROOT = path__default.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path__default.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path__default.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path__default.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    WindowManager.createMainWindow();
  }
});
app.whenReady().then(async () => {
  try {
    await fs.mkdir(LIBRARY_PATH, { recursive: true });
  } catch (e) {
    logger.error(`[Main] Failed to create library path: ${LIBRARY_PATH}`, e);
  }
  WindowManager.createSplashWindow();
  try {
    await initDB(LIBRARY_PATH, (status) => {
      WindowManager.updateSplashStatus(status);
    });
  } catch (e) {
    logger.error("DB Init Failed", e);
  }
  pythonProvider.start();
  registerAIHandlers();
  registerDBHandlers();
  registerSettingsHandlers();
  registerFileHandlers();
  registerAppHandlers(() => WindowManager.getMainWindow());
  registerImageProtocol(async (filePath, width, box, orientation) => {
    try {
      const res = await pythonProvider.generateThumbnail(filePath, { width: width || 300, box, orientation: orientation || 1 });
      if (res.success && res.data) {
        return Buffer.from(res.data, "base64");
      }
    } catch (e) {
      logger.error(`[Main] Python thumbnail error: ${e}`);
    }
    return null;
  });
  const win = await WindowManager.createMainWindow();
  if (win) pythonProvider.setMainWindow(win);
});
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Rejection:", reason);
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
