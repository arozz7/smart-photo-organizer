var ye = Object.defineProperty;
var we = (a, e, t) => e in a ? ye(a, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : a[e] = t;
var v = (a, e, t) => we(a, typeof e != "symbol" ? e + "" : e, t);
import { app as C, net as ee, protocol as Te, ipcMain as g, dialog as Se, shell as ce, BrowserWindow as ae, screen as Re } from "electron";
import * as L from "node:fs/promises";
import * as j from "node:path";
import T from "node:path";
import { pathToFileURL as te, fileURLToPath as he } from "node:url";
import * as re from "node:fs";
import W, { promises as M } from "node:fs";
import Ne from "better-sqlite3";
import Q from "sharp";
import { spawn as be } from "node:child_process";
import { createInterface as Ie } from "node:readline";
import { createHash as Fe } from "node:crypto";
import { ExifTool as Oe } from "exiftool-vendored";
const ne = T.join(C.getPath("userData"), "logs");
W.existsSync(ne) || W.mkdirSync(ne, { recursive: !0 });
const H = T.join(ne, "main.log"), Le = 5 * 1024 * 1024;
let k = W.createWriteStream(H, { flags: "a" });
function X() {
  try {
    if (W.existsSync(H) && W.statSync(H).size > Le) {
      k.end();
      const e = H + ".old";
      W.existsSync(e) && W.unlinkSync(e), W.renameSync(H, e), k = W.createWriteStream(H, { flags: "a" });
    }
  } catch (a) {
    console.error("Failed to rotate logs:", a);
  }
}
function Ae() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function V(a, ...e) {
  const t = e.map((r) => typeof r == "object" ? JSON.stringify(r) : String(r)).join(" ");
  return `[${Ae()}] [${a}] ${t}
`;
}
const E = {
  info: (...a) => {
    X();
    const e = V("INFO", ...a);
    console.log(...a), k.write(e);
  },
  warn: (...a) => {
    X();
    const e = V("WARN", ...a);
    console.warn(...a), k.write(e);
  },
  error: (...a) => {
    X();
    const e = V("ERROR", ...a);
    console.error(...a), k.write(e);
  },
  debug: (...a) => {
    if (process.env.DEBUG) {
      X();
      const e = V("DEBUG", ...a);
      console.log(...a), k.write(e);
    }
  },
  getLogPath: () => H
}, Pe = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
class Me {
  constructor(e, t, r) {
    this.repo = e, this.processor = t, this.fallbackGenerator = r;
  }
  async processRequest(e) {
    let t = "";
    try {
      const r = new URL(e.url), s = e.url.replace(/^local-resource:\/\//, "");
      t = decodeURIComponent(s);
      const o = t.indexOf("?");
      o !== -1 && (t = t.substring(0, o)), (t.endsWith("/") || t.endsWith("\\")) && (t = t.slice(0, -1));
      const n = r.searchParams.get("width") ? parseInt(r.searchParams.get("width")) : void 0, h = r.searchParams.get("originalWidth") ? parseInt(r.searchParams.get("originalWidth")) : void 0, c = r.searchParams.get("box"), i = r.searchParams.get("hq") === "true", p = e.url.includes("silent_404=true"), u = r.searchParams.get("photoId");
      let f;
      if (c) {
        const d = c.split(",").map(Number);
        d.length === 4 && d.every((_) => !isNaN(_)) && (f = { x: d[0], y: d[1], w: d[2], h: d[3] });
      }
      const l = {
        width: n,
        originalWidth: h,
        box: f,
        hq: i,
        silent_404: p,
        photoId: u ? parseInt(u) : void 0
      };
      return n && n > 0 || f ? await this.handleResizeRequest(t, l) : await this.handleDirectRequest(t, e, l);
    } catch (r) {
      return this.handleGlobalError(r, t, e);
    }
  }
  async handleResizeRequest(e, t) {
    try {
      const { orientation: r } = await this.repo.getImageMetadata(e), s = T.extname(e).toLowerCase();
      if ([".nef", ".arw", ".cr2", ".dng", ".orf", ".rw2"].includes(s))
        try {
          const h = await this.attemptPreviewFallback(e, t, "Optimization: Use Preview");
          if (h) return h;
        } catch {
        }
      const n = await this.processor.process(e, t, r);
      return new Response(n, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "max-age=3600"
        }
      });
    } catch (r) {
      const s = r.message || String(r);
      try {
        const h = await this.attemptPreviewFallback(e, t, s);
        if (h) return h;
      } catch (h) {
        E.warn(`[Protocol] Preview fallback failed for ${e}: ${h}`);
      }
      const o = T.extname(e).toLowerCase();
      if ([".nef", ".arw", ".cr2", ".dng", ".orf", ".rw2"].includes(o) && this.fallbackGenerator)
        try {
          const { orientation: h } = await this.repo.getImageMetadata(e), c = t.box ? `${t.box.x},${t.box.y},${t.box.w},${t.box.h}` : void 0, i = t.width || 300, p = await this.fallbackGenerator(e, i, c, h);
          if (p)
            return new Response(p, {
              headers: {
                "Content-Type": "image/jpeg",
                "X-Generated-By": "Python-Fallback"
              }
            });
        } catch (h) {
          E.warn(`[Protocol] Python Fallback (Resize) failed: ${h}`);
        }
      if (t.silent_404)
        return this.serveTransparent();
      if (t.photoId)
        await this.repo.logError(t.photoId, e, s, "Preview Generation");
      else {
        const h = await this.repo.getPhotoId(e);
        h && await this.repo.logError(h, e, s, "Preview Generation");
      }
      return new Response("Thumbnail Generation Failed", { status: 500 });
    }
  }
  async attemptPreviewFallback(e, t, r) {
    const s = await this.repo.getPreviewPath(e);
    if (s && !t.hq)
      try {
        await L.access(s);
        const o = await this.processor.process(s, t, 1);
        return new Response(o, { headers: { "Content-Type": "image/jpeg" } });
      } catch (o) {
        if (o.code === "ENOENT" || o.message.includes("ENOENT"))
          return E.warn(`[Protocol] Stale preview path detected and removed for ${e}`), await this.repo.clearPreviewPath(e), null;
        throw o;
      }
    return null;
  }
  async handleDirectRequest(e, t, r) {
    const s = T.extname(e).toLowerCase();
    if ([".nef", ".arw", ".cr2", ".dng", ".orf", ".rw2"].includes(s))
      try {
        const n = await this.repo.getPreviewPath(e);
        if (n)
          try {
            await L.access(n);
            const c = await L.readFile(n);
            return new Response(c, { headers: { "Content-Type": "image/jpeg" } });
          } catch {
            E.warn(`[Protocol] RAW Preview found but inaccessible: ${n}`);
          }
        const h = await this.processor.convertRaw(e);
        return new Response(h, { headers: { "Content-Type": "image/jpeg" } });
      } catch (n) {
        throw E.error(`[Protocol] Failed to serve RAW file ${e}:`, n), n;
      }
    try {
      return await L.access(e), await ee.fetch(te(e).toString());
    } catch (n) {
      throw n;
    }
  }
  async handleGlobalError(e, t, r) {
    const s = e.message || String(e), o = r.url.includes("silent_404=true");
    if (s.includes("ERR_FILE_NOT_FOUND") || s.includes("ENOENT")) {
      const n = t.match(/previews[\\\/]([a-f0-9]+)\.jpg/);
      if (n && n[1])
        try {
          const h = await this.repo.getFilePathFromPreview(n[1]);
          if (h) {
            const c = T.extname(h).toLowerCase();
            if ([".nef", ".arw", ".cr2", ".dng", ".orf", ".rw2"].includes(c))
              try {
                const p = await this.processor.convertRaw(h);
                return new Response(p, { headers: { "Content-Type": "image/jpeg" } });
              } catch (p) {
                const u = await this.attemptSiblingRecovery(h);
                if (u) return new Response(u, { headers: { "Content-Type": "image/zip" } });
                if (this.fallbackGenerator) {
                  const f = new URL(r.url), l = f.searchParams.get("width") ? parseInt(f.searchParams.get("width")) : 300, d = await this.fallbackGenerator(h, l);
                  if (d) return new Response(d, { headers: { "Content-Type": "image/jpeg", "X-Generated-By": "Python-Fallback" } });
                }
                throw p;
              }
            else
              return await ee.fetch(te(h).toString());
          }
        } catch (h) {
          E.warn(`[Protocol] Recovery failed: ${h}`);
        }
    }
    if (s.includes("ERR_FILE_NOT_FOUND") || s.includes("ENOENT")) {
      if (o)
        return this.serveTransparent();
    } else
      E.error(`[Protocol] Failed to handle request: ${r.url}`, e);
    return new Response("Not Found", { status: 404 });
  }
  serveTransparent() {
    return new Response(Pe, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache"
      }
    });
  }
  // Helper for Sibling Recovery logic (Lines 456-470)
  async attemptSiblingRecovery(e) {
    const t = [
      e.replace(/\.[^.]+$/, ".JPG"),
      e.replace(/\.[^.]+$/, ".jpg"),
      e + ".JPG",
      e + ".jpg"
    ];
    for (const r of t)
      if (r !== e)
        try {
          return await L.access(r), await ee.fetch(te(r).toString());
        } catch {
        }
    return null;
  }
}
let S;
async function Ce(a, e) {
  const t = T.join(a, "library.db");
  e && e("Initializing Database..."), E.info("Initializing Database at:", t), await new Promise((r) => setTimeout(r, 100)), S = new Ne(t), S.pragma("journal_mode = WAL"), S.exec(`
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
    S.exec("ALTER TABLE faces ADD COLUMN blur_score REAL");
  } catch {
  }
  try {
    S.exec("ALTER TABLE faces ADD COLUMN is_ignored BOOLEAN DEFAULT 0");
  } catch {
  }
  try {
    S.exec("ALTER TABLE faces ADD COLUMN score REAL");
  } catch {
  }
  try {
    S.exec("ALTER TABLE people ADD COLUMN descriptor_mean_json TEXT");
  } catch {
  }
  try {
    S.exec("ALTER TABLE photos ADD COLUMN blur_score REAL");
  } catch {
  }
  try {
    S.exec("ALTER TABLE scan_history ADD COLUMN scan_mode TEXT");
  } catch {
  }
  try {
    S.exec("ALTER TABLE photos ADD COLUMN description TEXT");
  } catch {
  }
  try {
    S.exec("ALTER TABLE people ADD COLUMN cover_face_id INTEGER");
  } catch {
  }
  try {
    try {
      S.exec("ALTER TABLE faces ADD COLUMN descriptor BLOB");
    } catch {
    }
    try {
      S.exec("ALTER TABLE faces ADD COLUMN is_reference BOOLEAN DEFAULT 0");
    } catch {
    }
    let r = { count: 0 };
    try {
      r = S.prepare("SELECT count(*) as count FROM faces WHERE descriptor IS NULL AND (descriptor_json IS NOT NULL AND descriptor_json != 'NULL')").get();
    } catch {
    }
    if (r.count > 0) {
      e && e(`Migrating ${r.count} faces...`), E.info(`Starting Smart Face Storage Migration for ${r.count} faces...`);
      const s = S.prepare("SELECT id, descriptor_json, person_id, blur_score FROM faces").all(), o = S.prepare("UPDATE faces SET descriptor = ?, is_reference = ? WHERE id = ?");
      e && e("Analyzing Face Quality...");
      const n = {}, h = [];
      for (const d of s)
        d.person_id ? (n[d.person_id] || (n[d.person_id] = []), n[d.person_id].push(d)) : h.push(d);
      let c = 0;
      const i = r.count, p = 500, u = () => {
        if (e) {
          const d = Math.round(c / i * 100);
          e(`Migrating Database: ${d}%`);
        }
      }, f = [];
      for (let d = 0; d < h.length; d += p)
        f.push(h.slice(d, d + p));
      for (const d of f)
        S.transaction(() => {
          for (const w of d)
            if (w.descriptor_json)
              try {
                const y = JSON.parse(w.descriptor_json), N = Buffer.from(new Float32Array(y).buffer);
                o.run(N, 0, w.id);
              } catch (y) {
                E.error(`Failed to migrate face ${w.id}`, y);
              }
        })(), c += d.length, u(), await new Promise((w) => setTimeout(w, 0));
      const l = Object.keys(n);
      for (let d = 0; d < l.length; d += 50) {
        const _ = l.slice(d, d + 50);
        S.transaction(() => {
          for (const y of _) {
            const N = n[parseInt(y)];
            N.sort((b, A) => (A.blur_score || 0) - (b.blur_score || 0)), N.forEach((b, A) => {
              if (A < 100) {
                if (b.descriptor_json)
                  try {
                    const D = JSON.parse(b.descriptor_json), U = Buffer.from(new Float32Array(D).buffer);
                    o.run(U, 1, b.id);
                  } catch (D) {
                    E.error(`Failed to migrate reference ${b.id}`, D);
                  }
              } else
                o.run(null, 0, b.id);
            }), c += N.length;
          }
        })(), u(), await new Promise((y) => setTimeout(y, 0));
      }
      E.info("Smart Face Storage Migration: Data converted.");
      try {
        e && e("Optimizing Database (VACUUM)..."), await new Promise((d) => setTimeout(d, 100)), E.info("Dropping old descriptor_json column..."), S.exec("ALTER TABLE faces DROP COLUMN descriptor_json"), S.exec("VACUUM");
      } catch (d) {
        E.warn("Could not drop descriptor_json column (SQLite version might be old), setting to NULL instead.", d), S.exec("UPDATE faces SET descriptor_json = NULL"), S.exec("VACUUM");
      }
      E.info("Smart Face Storage Migration: Complete.");
    }
  } catch (r) {
    E.error("Smart Face Storage Migration Failed:", r);
  }
  try {
    const r = S.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='people'").get();
    if (r && !r.sql.includes("COLLATE NOCASE")) {
      e && e("Upgrading People Table (Uniqueness)..."), E.info("Upgrading People Table to enforce case-insensitive uniqueness...");
      const s = S.prepare("SELECT id, name FROM people").all(), o = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map();
      for (const p of s) {
        const u = p.name.trim().toLowerCase();
        o.has(u) ? n.set(p.id, o.get(u)) : o.set(u, p.id);
      }
      S.exec("PRAGMA foreign_keys = OFF"), S.transaction(() => {
        const p = S.prepare("UPDATE faces SET person_id = ? WHERE person_id = ?");
        for (const [l, d] of n.entries())
          p.run(d, l);
        S.exec(`
          DROP TABLE IF EXISTS people_new;
          CREATE TABLE people_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL COLLATE NOCASE,
            descriptor_mean_json TEXT
          );
        `);
        const u = [...o.values()], f = S.prepare("INSERT INTO people_new (id, name, descriptor_mean_json) SELECT id, name, descriptor_mean_json FROM people WHERE id = ?");
        for (const l of u)
          f.run(l);
        S.exec("DROP TABLE people"), S.exec("ALTER TABLE people_new RENAME TO people");
      })(), S.exec("PRAGMA foreign_keys = ON");
      const c = (p, u) => {
        try {
          const f = p.prepare("SELECT descriptor FROM faces WHERE person_id = ? AND is_ignored = 0 AND (blur_score IS NULL OR blur_score >= 20)").all(u);
          if (f.length === 0) {
            p.prepare("UPDATE people SET descriptor_mean_json = NULL WHERE id = ?").run(u);
            return;
          }
          const l = [];
          for (const y of f)
            y.descriptor && l.push(Array.from(new Float32Array(y.descriptor.buffer, y.descriptor.byteOffset, y.descriptor.byteLength / 4)));
          if (l.length == 0) return;
          const d = l[0].length, _ = new Array(d).fill(0);
          for (const y of l) for (let N = 0; N < d; N++) _[N] += y[N];
          let w = 0;
          for (let y = 0; y < d; y++)
            _[y] /= l.length, w += _[y] ** 2;
          if (w = Math.sqrt(w), w > 0) for (let y = 0; y < d; y++) _[y] /= w;
          p.prepare("UPDATE people SET descriptor_mean_json = ? WHERE id = ?").run(JSON.stringify(_), u);
        } catch (f) {
          console.error("Migration Recalc failed", f);
        }
      }, i = [...new Set(n.values())];
      for (const p of i)
        c(S, p);
      E.info("People Table Upgrade: Complete.");
    }
  } catch (r) {
    E.error("Failed to migrate people table:", r);
  }
  try {
    const r = S.prepare("SELECT id FROM tags WHERE name = ?").get("AI Description");
    r && (S.prepare("DELETE FROM photo_tags WHERE tag_id = ?").run(r.id), S.prepare("DELETE FROM tags WHERE id = ?").run(r.id), E.info('Migration complete: "AI Description" tag removed.'));
  } catch (r) {
    E.error("Migration failed:", r);
  }
  E.info("Database schema ensured.");
}
function m() {
  if (!S)
    throw new Error("Database not initialized");
  return S;
}
function De() {
  S && (E.info("Closing Database connection."), S.close(), S = void 0);
}
class ve {
  async getImageMetadata(e) {
    let t = 1;
    try {
      const s = m().prepare("SELECT metadata_json FROM photos WHERE file_path = ?").get(e);
      if (s && s.metadata_json) {
        const o = JSON.parse(s.metadata_json);
        o.Orientation ? t = parseInt(o.Orientation) : o.ExifImageOrientation && (t = parseInt(o.ExifImageOrientation));
      }
    } catch {
    }
    return { orientation: t };
  }
  async getPreviewPath(e) {
    try {
      const r = m().prepare("SELECT preview_cache_path FROM photos WHERE file_path = ?").get(e);
      if (r && r.preview_cache_path)
        return r.preview_cache_path;
    } catch {
    }
    return null;
  }
  async getFilePathFromPreview(e) {
    try {
      const r = m().prepare("SELECT file_path FROM photos WHERE preview_cache_path LIKE ?").get(`%${e}%`);
      if (r && r.file_path)
        return r.file_path;
    } catch {
    }
    return null;
  }
  async getPhotoId(e) {
    try {
      const r = m().prepare("SELECT id FROM photos WHERE file_path = ?").get(e);
      return r ? r.id : null;
    } catch {
      return null;
    }
  }
  async clearPreviewPath(e) {
    try {
      m().prepare("UPDATE photos SET preview_cache_path = NULL WHERE file_path = ?").run(e);
    } catch (t) {
      E.warn(`[MetadataRepository] Failed to clear preview path for ${e}`, t);
    }
  }
  async logError(e, t, r, s) {
    try {
      m().prepare("INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, ?, ?, ?)").run(e, t, r, s);
    } catch (o) {
      E.error("[MetadataRepository] Failed to log error to DB", o);
    }
  }
}
class xe {
  async process(e, t, r = 1) {
    const s = Q(e);
    return this.processPipeline(s, t, r, !1);
  }
  async processPipeline(e, t, r = 1, s = !1) {
    const o = await e.metadata(), n = o.width || 0, h = o.height || 0, c = o.orientation || 1, i = n > h, p = r === 6 || r === 8;
    let u = !1;
    if (p && i ? c >= 5 && c <= 8 ? (e.rotate(), u = !0) : r === 6 ? (e.rotate(90), u = !0) : r === 8 && (e.rotate(-90), u = !0) : r === 3 && (c === 3 ? e.rotate() : e.rotate(180)), t.box) {
      let f = n, l = h;
      if (u && ([f, l] = [l, f]), f && l) {
        let { x: d, y: _, w, h: y } = t.box;
        if (t.originalWidth && t.originalWidth > 0 && f !== t.originalWidth) {
          const U = f / t.originalWidth;
          d = d * U, _ = _ * U, w = w * U, y = y * U;
        }
        const N = Math.max(0, Math.min(Math.round(d), f - 1)), b = Math.max(0, Math.min(Math.round(_), l - 1)), A = Math.max(1, Math.min(Math.round(w), f - N)), D = Math.max(1, Math.min(Math.round(y), l - b));
        e.extract({ left: N, top: b, width: A, height: D });
      }
    }
    return t.width && t.width > 0 && e.resize(t.width, null, { fit: "inside", withoutEnlargement: !0 }), await e.toBuffer();
  }
  async convertRaw(e) {
    return await Q(e).rotate().toFormat("jpeg", { quality: 80 }).toBuffer();
  }
}
function Ue(a) {
  const e = new ve(), t = new xe(), r = new Me(e, t, a);
  Te.handle("local-resource", async (s) => await r.processRequest(s));
}
class R {
  static parseFace(e) {
    let t = e.width, r = e.height;
    if ((!t || !r) && e.metadata_json)
      try {
        const s = JSON.parse(e.metadata_json);
        t = t || s.ImageWidth || s.SourceImageWidth || s.ExifImageWidth, r = r || s.ImageHeight || s.SourceImageHeight || s.ExifImageHeight;
      } catch {
      }
    return {
      ...e,
      box: JSON.parse(e.box_json),
      original_width: t,
      original_height: r,
      descriptor: e.descriptor ? Array.from(new Float32Array(e.descriptor.buffer, e.descriptor.byteOffset, e.descriptor.byteLength / 4)) : null,
      is_reference: !!e.is_reference
    };
  }
  static getBlurryFaces(e) {
    const t = m(), { personId: r, scope: s, limit: o = 1e3, offset: n = 0, threshold: h = 20 } = e;
    let c = `SELECT f.id, f.photo_id, f.blur_score, f.box_json, p.file_path, p.preview_cache_path, p.metadata_json, p.width, p.height, pp.name as person_name 
               FROM faces f 
               JOIN photos p ON f.photo_id = p.id
               LEFT JOIN people pp ON f.person_id = pp.id
               WHERE (f.is_ignored = 0 OR f.is_ignored IS NULL) AND f.blur_score < ?`, i = "SELECT COUNT(*) as count FROM faces f WHERE (f.is_ignored = 0 OR f.is_ignored IS NULL) AND f.blur_score < ?";
    const p = [h];
    r ? (c += " AND f.person_id = ?", i += " AND f.person_id = ?", p.push(r)) : s !== "all" && (c += " AND f.person_id IS NULL", i += " AND f.person_id IS NULL"), c += " ORDER BY f.blur_score ASC LIMIT ? OFFSET ?";
    const u = [...p, o, n];
    try {
      const f = t.prepare(c).all(...u), l = t.prepare(i).get(...p);
      return {
        faces: f.map((d) => this.parseFace(d)),
        total: l ? l.count : 0
      };
    } catch (f) {
      throw new Error(`FaceRepository.getBlurryFaces failed: ${String(f)}`);
    }
  }
  static getFacesByIds(e) {
    const t = m();
    if (e.length === 0) return [];
    const s = `
            SELECT f.id, f.photo_id, f.blur_score, f.box_json, f.descriptor, p.file_path, p.preview_cache_path, p.metadata_json, p.width, p.height
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.id IN (${e.map(() => "?").join(",")})
        `;
    return t.prepare(s).all(...e).map((n) => this.parseFace(n));
  }
  static ignoreFaces(e) {
    const t = m();
    if (e.length === 0) return;
    const s = `UPDATE faces SET is_ignored = 1 WHERE id IN (${e.map(() => "?").join(",")})`;
    t.prepare(s).run(...e);
  }
  static restoreFaces(e, t) {
    const r = m();
    if (e.length === 0) return;
    const s = e.map(() => "?").join(",");
    let o, n;
    t !== void 0 ? (o = `UPDATE faces SET is_ignored = 0, person_id = ? WHERE id IN (${s})`, n = [t, ...e]) : (o = `UPDATE faces SET is_ignored = 0 WHERE id IN (${s})`, n = [...e]), r.prepare(o).run(...n);
  }
  static getIgnoredFaces(e = 1, t = 50) {
    const r = m(), s = (e - 1) * t, o = r.prepare("SELECT COUNT(*) as count FROM faces WHERE is_ignored = 1").get();
    return {
      faces: r.prepare(`
            SELECT f.id, f.photo_id, f.blur_score, f.box_json, f.is_ignored, f.descriptor,
                   p.file_path, p.preview_cache_path, p.metadata_json, p.width, p.height
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.is_ignored = 1
            LIMIT ? OFFSET ?
        `).all(t, s).map((h) => this.parseFace(h)),
      total: o.count
    };
  }
  static getUnclusteredFaces(e = 500, t = 0) {
    const r = m();
    try {
      const s = r.prepare(`
                SELECT f.id, f.photo_id, f.blur_score, f.box_json, p.file_path, p.preview_cache_path, p.width, p.height
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
                WHERE f.person_id IS NULL 
                  AND f.descriptor IS NOT NULL
                  AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
                  AND (f.blur_score IS NULL OR f.blur_score >= 10)
                ORDER BY f.id ASC
                LIMIT ? OFFSET ?
            `).all(e, t), o = r.prepare(`
                SELECT COUNT(f.id) as count
                FROM faces f
                WHERE f.person_id IS NULL 
                AND f.descriptor IS NOT NULL
                AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
                AND (f.blur_score IS NULL OR f.blur_score >= 10)
            `).get();
      return {
        faces: s.map((n) => ({
          id: n.id,
          photo_id: n.photo_id,
          blur_score: n.blur_score,
          box: JSON.parse(n.box_json),
          file_path: n.file_path,
          preview_cache_path: n.preview_cache_path,
          width: n.width,
          height: n.height
        })),
        total: o.count
      };
    } catch (s) {
      throw new Error(`FaceRepository.getUnclusteredFaces failed: ${String(s)}`);
    }
  }
  static getFacesForClustering() {
    const e = m();
    try {
      return e.prepare(`
                SELECT id, descriptor
                FROM faces 
                WHERE person_id IS NULL 
                  AND descriptor IS NOT NULL
                  AND (is_ignored = 0 OR is_ignored IS NULL)
                  AND (blur_score IS NULL OR blur_score >= 10)
            `).all().map((r) => ({
        id: r.id,
        descriptor: Array.from(new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4))
      }));
    } catch (t) {
      throw new Error(`FaceRepository.getFacesForClustering failed: ${String(t)}`);
    }
  }
  static getFaceById(e) {
    const t = m();
    try {
      const r = t.prepare("SELECT * FROM faces WHERE id = ?").get(e);
      return r ? {
        ...r,
        box: JSON.parse(r.box_json),
        descriptor: r.descriptor ? Array.from(new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4)) : null,
        is_reference: !!r.is_reference
      } : null;
    } catch (r) {
      return console.error("FaceRepository.getFaceById failed:", r), null;
    }
  }
  static getFacesByPhoto(e) {
    const t = m();
    try {
      return t.prepare(`
                SELECT f.*, p.name as person_name 
                FROM faces f
                LEFT JOIN people p ON f.person_id = p.id
                WHERE f.photo_id = ? AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
            `).all(e).map((o) => ({
        ...o,
        box: JSON.parse(o.box_json),
        descriptor: o.descriptor ? Array.from(new Float32Array(o.descriptor.buffer, o.descriptor.byteOffset, o.descriptor.byteLength / 4)) : null,
        is_reference: !!o.is_reference
      }));
    } catch (r) {
      return console.error("FaceRepository.getFacesByPhoto failed:", r), [];
    }
  }
  static getAllFaces(e = 100, t = 0, r = {}, s = !0) {
    const o = m();
    try {
      let n = `
                SELECT f.*, p.file_path, p.preview_cache_path, p.width, p.height 
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
            `;
      const h = [], c = [];
      return r.unnamed && c.push("f.person_id IS NULL"), r.personId && (c.push("f.person_id = ?"), h.push(r.personId)), c.length > 0 && (n += " WHERE " + c.join(" AND ")), n.includes("is_ignored") || (n += c.length > 0 ? " AND is_ignored = 0" : " WHERE is_ignored = 0"), n += " ORDER BY p.created_at DESC LIMIT ? OFFSET ?", h.push(e, t), o.prepare(n).all(...h).map((p) => ({
        ...p,
        box: JSON.parse(p.box_json),
        descriptor: s && p.descriptor ? Array.from(new Float32Array(p.descriptor.buffer, p.descriptor.byteOffset, p.descriptor.byteLength / 4)) : null,
        is_reference: !!p.is_reference
      }));
    } catch (n) {
      throw new Error(`FaceRepository.getAllFaces failed: ${String(n)}`);
    }
  }
  static deleteFaces(e) {
    if (!e || e.length === 0) return;
    const t = m(), r = e.map(() => "?").join(",");
    t.prepare(`DELETE FROM faces WHERE id IN (${r})`).run(...e);
  }
  static updateFacePerson(e, t) {
    if (!e || e.length === 0) return;
    const r = m(), s = e.map(() => "?").join(",");
    r.prepare(`UPDATE faces SET person_id = ? WHERE id IN (${s})`).run(t, ...e);
  }
  static getAllDescriptors() {
    return m().prepare("SELECT id, descriptor FROM faces WHERE descriptor IS NOT NULL").all().map((r) => ({
      id: r.id,
      descriptor: Array.from(new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4))
    }));
  }
  static getUnassignedDescriptors() {
    return m().prepare("SELECT id, descriptor FROM faces WHERE descriptor IS NOT NULL AND person_id IS NULL AND (is_ignored = 0 OR is_ignored IS NULL)").all().map((r) => ({
      id: r.id,
      descriptor: Array.from(new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4))
    }));
  }
  /**
   * Get faces with their descriptors for a specific person.
   * Used for outlier detection analysis.
   * Includes photo data for direct display without additional lookups.
   */
  static getFacesWithDescriptorsByPerson(e) {
    const t = m();
    try {
      return t.prepare(`
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
            `).all(e);
    } catch (r) {
      throw new Error(`FaceRepository.getFacesWithDescriptorsByPerson failed: ${String(r)}`);
    }
  }
  /**
   * Get unnamed faces with descriptors and photo appearance counts.
   * Used for Background Face Filter to identify noise candidates.
   * Photo count represents how often faces in this photo's cluster appear.
   */
  static getUnnamedFacesForNoiseDetection() {
    const e = m();
    try {
      return e.prepare(`
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
    } catch (t) {
      throw new Error(`FaceRepository.getUnnamedFacesForNoiseDetection failed: ${String(t)}`);
    }
  }
}
class F {
  static getPeople() {
    const e = m();
    try {
      return e.prepare(`
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
            `).all();
    } catch (t) {
      throw new Error(`PersonRepository.getPeople failed: ${String(t)}`);
    }
  }
  static getPeopleWithDescriptors() {
    const e = m();
    try {
      return e.prepare("SELECT id, name, descriptor_mean_json FROM people WHERE descriptor_mean_json IS NOT NULL").all().map((r) => ({
        id: r.id,
        name: r.name,
        descriptor: JSON.parse(r.descriptor_mean_json)
      }));
    } catch (t) {
      throw new Error(`PersonRepository.getPeopleWithDescriptors failed: ${String(t)}`);
    }
  }
  static getPersonById(e) {
    return m().prepare("SELECT * FROM people WHERE id = ?").get(e);
  }
  static getPersonByName(e) {
    return m().prepare("SELECT * FROM people WHERE name = ? COLLATE NOCASE").get(e.trim());
  }
  static createPerson(e) {
    const t = m(), r = e.trim();
    return t.prepare("INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING").run(r), this.getPersonByName(r);
  }
  static updatePersonName(e, t) {
    m().prepare("UPDATE people SET name = ? WHERE id = ?").run(t.trim(), e);
  }
  static updateDescriptorMean(e, t) {
    m().prepare("UPDATE people SET descriptor_mean_json = ? WHERE id = ?").run(t, e);
  }
  static deletePerson(e) {
    m().prepare("DELETE FROM people WHERE id = ?").run(e);
  }
  static setPersonCover(e, t) {
    m().prepare("UPDATE people SET cover_face_id = ? WHERE id = ?").run(t, e);
  }
  /**
   * Get person with their descriptor mean (centroid) for outlier analysis.
   */
  static getPersonWithDescriptor(e) {
    const t = m();
    try {
      return t.prepare(
        "SELECT id, name, descriptor_mean_json FROM people WHERE id = ?"
      ).get(e) || null;
    } catch (r) {
      throw new Error(`PersonRepository.getPersonWithDescriptor failed: ${String(r)}`);
    }
  }
}
const z = {
  libraryPath: "",
  aiSettings: {
    faceSimilarityThreshold: 0.65,
    faceBlurThreshold: 20,
    minFaceSize: 40,
    modelSize: "medium",
    aiProfile: "balanced",
    useGpu: !0,
    vlmEnabled: !1,
    // Default to off for performance
    runtimeUrl: void 0
  },
  windowBounds: { width: 1200, height: 800, x: 0, y: 0 },
  firstRun: !0,
  queue: { batchSize: 0, cooldownSeconds: 60 },
  smartIgnore: {
    minPhotoAppearances: 3,
    maxClusterSize: 2,
    centroidDistanceThreshold: 0.7,
    outlierThreshold: 1.2
  },
  ai_queue: []
};
class P {
  static load() {
    if (!this.config)
      try {
        if (re.existsSync(this.configPath)) {
          const e = re.readFileSync(this.configPath, "utf8"), t = JSON.parse(e);
          this.config = { ...z, ...t }, this.config.aiSettings = { ...z.aiSettings, ...t.aiSettings || {} }, this.config.queue = { ...z.queue, ...t.queue || {} }, this.config.smartIgnore = { ...z.smartIgnore, ...t.smartIgnore || {} };
        } else
          this.config = { ...z }, this.save();
      } catch (e) {
        console.error("Failed to load config, resetting:", e), this.config = { ...z };
      }
  }
  static save() {
    try {
      re.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (e) {
      console.error("Failed to save config:", e);
    }
  }
  static getSettings() {
    return this.load(), this.config;
  }
  static updateSettings(e) {
    this.load(), this.config = { ...this.config, ...e }, this.save();
  }
  // For specific nested updates
  static updateQueueConfig(e) {
    this.load(), this.config.queue = { ...this.config.queue, ...e }, this.save();
  }
  // Legacy Helpers
  static getAISettings() {
    return this.getSettings().aiSettings;
  }
  static setAISettings(e) {
    this.load(), this.config.aiSettings = { ...this.config.aiSettings, ...e }, this.save();
  }
  static getLibraryPath() {
    return this.load(), this.config.libraryPath || T.join(C.getPath("userData"), "Library");
  }
  static setLibraryPath(e) {
    this.updateSettings({ libraryPath: e });
  }
  // Smart Ignore Helpers
  static getSmartIgnoreSettings() {
    return this.getSettings().smartIgnore;
  }
  static updateSmartIgnoreSettings(e) {
    this.load(), this.config.smartIgnore = { ...this.config.smartIgnore, ...e }, this.save();
  }
}
v(P, "configPath", T.join(C.getPath("userData"), "config.json")), v(P, "config");
function B() {
  return P.getAISettings();
}
function We(a) {
  P.setAISettings(a);
}
function $() {
  return P.getLibraryPath();
}
function $e(a) {
  P.setLibraryPath(a);
}
function Be() {
  return P.getSettings().windowBounds;
}
function je(a) {
  P.updateSettings({ windowBounds: a });
}
class x {
  static async recalculatePersonMean(e) {
    console.time(`recalculatePersonMean-${e}`);
    const r = B().faceBlurThreshold ?? 20, o = R.getAllFaces(1e4, 0, { personId: e }, !0).filter(
      (p) => p.descriptor && p.descriptor.length > 0 && (p.blur_score === null || p.blur_score >= r)
    );
    if (o.length === 0) {
      F.updateDescriptorMean(e, null);
      return;
    }
    const n = o.map((p) => p.descriptor), h = n[0].length, c = new Array(h).fill(0);
    for (const p of n)
      for (let u = 0; u < h; u++)
        c[u] += p[u];
    let i = 0;
    for (let p = 0; p < h; p++)
      c[p] /= n.length, i += c[p] ** 2;
    if (i = Math.sqrt(i), i > 0)
      for (let p = 0; p < h; p++)
        c[p] /= i;
    console.timeEnd(`recalculatePersonMean-${e}`), F.updateDescriptorMean(e, JSON.stringify(c));
  }
  static async mergePeople(e, t) {
    if (e === t) return;
    const s = R.getAllFaces(1e4, 0, { personId: e }, !1).map((o) => o.id);
    s.length > 0 && R.updateFacePerson(s, t), F.deletePerson(e), await this.recalculatePersonMean(t);
  }
  static async recalculateAllMeans() {
    const e = F.getPeople();
    console.log(`[PersonService] Recalculating means for ${e.length} people...`);
    for (const t of e)
      await this.recalculatePersonMean(t.id);
    return console.log("[PersonService] Recalculation complete."), { success: !0, count: e.length };
  }
  static async assignPerson(e, t) {
    const r = t.trim();
    let s = F.getPersonByName(r);
    return s || (s = F.createPerson(r)), R.updateFacePerson([e], s.id), this.recalculatePersonMean(s.id), { success: !0, person: s };
  }
  /**
   * Move faces to a target person by name, handling creation if needed.
   * Recalculates means for both source(s) and target.
   */
  static async moveFacesToPerson(e, t) {
    if (e.length === 0) return { success: !0 };
    const r = t.trim();
    let s = F.getPersonByName(r);
    s || (s = F.createPerson(r));
    const o = R.getFacesByIds(e), n = /* @__PURE__ */ new Set();
    for (const h of o)
      h.person_id && h.person_id !== s.id && n.add(h.person_id);
    R.updateFacePerson(e, s.id), await this.recalculatePersonMean(s.id);
    for (const h of n)
      await this.recalculatePersonMean(h);
    return { success: !0, person: s };
  }
  static async renamePerson(e, t) {
    const r = F.getPersonByName(t);
    return r && r.id !== e ? this.mergePeople(e, r.id) : (F.updatePersonName(e, t), { success: !0, merged: !1 });
  }
  static async unassignFaces(e) {
    if (e.length === 0) return;
    const t = R.getFacesByIds(e), r = /* @__PURE__ */ new Set();
    for (const s of t)
      s.person_id && r.add(s.person_id);
    R.updateFacePerson(e, null);
    for (const s of r)
      await this.recalculatePersonMean(s);
  }
}
class Y {
  /**
   * Modular formula for matching a descriptor against the entire library.
   * Uses a Hybrid Strategy: Centroids first, then FAISS fallback.
   */
  static async matchFace(e, t = {}) {
    const r = B(), s = t.threshold ?? r.faceSimilarityThreshold ?? 0.65;
    let o = [];
    if (e instanceof Buffer || e instanceof Uint8Array)
      o = Array.from(new Float32Array(e.buffer, e.byteOffset, e.byteLength / 4));
    else if (typeof e == "string")
      o = JSON.parse(e);
    else if (Array.isArray(e))
      o = e;
    else
      return null;
    const n = t.candidatePeople ?? F.getPeopleWithDescriptors(), h = this.matchAgainstCentroids(o, n, s);
    if (h) return { ...h, matchType: "centroid" };
    if (t.searchFn) {
      const c = 1 / Math.max(0.01, s) - 1, i = await t.searchFn([o], t.topK ?? 5, c);
      if (i.length > 0 && i[0].length > 0) {
        const p = i[0], u = p.map((_) => _.id), f = m(), l = u.map(() => "?").join(","), d = f.prepare(`
                    SELECT f.person_id, p.name 
                    FROM faces f 
                    JOIN people p ON f.person_id = p.id 
                    WHERE f.id IN (${l}) AND f.person_id IS NOT NULL 
                    LIMIT 1
                `).all(...u);
        if (d.length > 0) {
          const _ = p[0];
          return {
            personId: d[0].person_id,
            personName: d[0].name,
            similarity: 1 / (1 + ((_ == null ? void 0 : _.distance) ?? 0)),
            distance: (_ == null ? void 0 : _.distance) ?? 0,
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
  static async matchBatch(e, t = {}) {
    const r = B(), s = t.threshold ?? r.faceSimilarityThreshold ?? 0.65, o = new Array(e.length).fill(null), n = e.map((i) => i instanceof Buffer || i instanceof Uint8Array ? Array.from(new Float32Array(i.buffer, i.byteOffset, i.byteLength / 4)) : typeof i == "string" ? JSON.parse(i) : i), h = t.candidatePeople ?? F.getPeopleWithDescriptors();
    for (let i = 0; i < n.length; i++) {
      const p = this.matchAgainstCentroids(n[i], h, s);
      p && (o[i] = { ...p, matchType: "centroid" });
    }
    const c = o.map((i, p) => i === null ? p : -1).filter((i) => i !== -1);
    if (c.length > 0 && t.searchFn) {
      const i = c.map((l) => n[l]), p = 1 / Math.max(0.01, s) - 1, u = await t.searchFn(i, t.topK ?? 5, p), f = /* @__PURE__ */ new Set();
      if (u.forEach((l) => l.forEach((d) => f.add(d.id))), f.size > 0) {
        const l = m(), d = Array.from(f).map(() => "?").join(","), _ = l.prepare(`
                    SELECT f.id, f.person_id, p.name 
                    FROM faces f 
                    JOIN people p ON f.person_id = p.id 
                    WHERE f.id IN (${d}) AND f.person_id IS NOT NULL
                `).all(...Array.from(f)), w = /* @__PURE__ */ new Map();
        _.forEach((y) => w.set(y.id, { personId: y.person_id, name: y.name }));
        for (let y = 0; y < c.length; y++) {
          const N = c[y], b = u[y];
          for (const A of b)
            if (w.has(A.id)) {
              const D = w.get(A.id);
              o[N] = {
                personId: D.personId,
                personName: D.name,
                similarity: 1 / (1 + A.distance),
                distance: A.distance,
                matchType: "faiss"
              };
              break;
            }
        }
      }
    }
    return o;
  }
  static matchAgainstCentroids(e, t, r) {
    if (!e || t.length === 0) return null;
    let s = 0;
    for (const i of e) s += i * i;
    s = Math.sqrt(s);
    const o = s > 0 ? e.map((i) => i / s) : e;
    let n = null, h = 1 / 0;
    for (const i of t) {
      if (!i.mean || i.mean.length !== o.length) continue;
      let p = 0;
      for (let f = 0; f < o.length; f++) {
        const l = o[f] - i.mean[f];
        p += l * l;
      }
      const u = Math.sqrt(p);
      u < h && (h = u, n = i);
    }
    const c = 1 / (1 + h);
    return n && c >= r ? { personId: n.id, personName: n.name, distance: h, similarity: c } : null;
  }
  static async autoAssignFaces(e, t, r) {
    try {
      let s = 0;
      const o = [];
      let n = 1;
      const h = 5;
      for (; n <= h; ) {
        const c = R.getFacesForClustering();
        let i = e && e.length > 0 ? c.filter((l) => e.includes(l.id)) : c;
        if (i.length === 0) break;
        E.info(`[AutoAssign] Pass ${n}: Matching ${i.length} faces...`);
        const p = await this.matchBatch(
          i.map((l) => l.descriptor),
          { threshold: t, searchFn: r }
        );
        let u = 0;
        const f = /* @__PURE__ */ new Set();
        for (let l = 0; l < i.length; l++) {
          const d = p[l];
          d && (R.updateFacePerson([i[l].id], d.personId), u++, o.push({ faceId: i[l].id, personId: d.personId, similarity: d.similarity }), f.add(d.personId));
        }
        if (u === 0) break;
        s += u, E.info(`[AutoAssign] Pass ${n}: Successfully identified ${u} faces.`);
        for (const l of f)
          await x.recalculatePersonMean(l);
        n++;
      }
      return s > 0 && E.info(`[AutoAssign] Final: Identified ${s} faces.`), { success: !0, count: s, assigned: o };
    } catch (s) {
      return E.error("Auto-Assign failed:", s), { success: !1, error: String(s) };
    }
  }
  static async processAnalysisResult(e, t, r, s, o) {
    E.info(`[FaceService] Processing ${t.length} faces for photo ${e}`);
    const n = m(), h = R.getFacesByPhoto(e);
    if (r && s)
      try {
        n.prepare("UPDATE photos SET width = ?, height = ? WHERE id = ?").run(r, s, e);
      } catch {
      }
    const c = [], i = [];
    if (n.transaction(() => {
      for (const p of t) {
        let u = null, f = 0;
        for (const _ of h) {
          const w = _.box, y = p.box, N = Math.max(y.x, w.x), b = Math.max(y.y, w.y), A = Math.min(y.x + y.width, w.x + w.width), D = Math.min(y.y + y.height, w.y + w.height), U = Math.max(0, A - N) * Math.max(0, D - b), ie = y.width * y.height + w.width * w.height - U, Z = ie > 0 ? U / ie : 0;
          Z > 0.5 && Z > f && (f = Z, u = _);
        }
        let l = 0, d = null;
        if (p.descriptor && Array.isArray(p.descriptor) && (d = Buffer.from(new Float32Array(p.descriptor).buffer)), u)
          n.prepare("UPDATE faces SET descriptor = ?, box_json = ?, blur_score = ? WHERE id = ?").run(d, JSON.stringify(p.box), p.blurScore, u.id), l = u.id;
        else {
          const _ = n.prepare(`
                        INSERT INTO faces (photo_id, person_id, descriptor, box_json, blur_score, is_reference)
                        VALUES (?, ?, ?, ?, ?, 0)
                     `).run(e, null, d, JSON.stringify(p.box), p.blurScore);
          l = Number(_.lastInsertRowid);
        }
        c.push(l), l > 0 && p.descriptor && p.descriptor.length > 0 && i.push({ id: l, descriptor: p.descriptor });
      }
    })(), i.length > 0 && o && o.addToIndex(i), c.length > 0) {
      const p = B(), u = await this.autoAssignFaces(c, p.faceSimilarityThreshold, async (f, l, d) => o.searchFaces(f, l, d));
      u.success && typeof u.count == "number" && u.count > 0 && E.info(`[FaceService] Auto-assigned ${u.count} faces for photo ${e}`);
    }
  }
}
class O {
  static getPhotos(e = 1, t = 50, r = "date_desc", s = {}, o) {
    const n = m(), h = o !== void 0 ? o : (e - 1) * t;
    let c = "created_at DESC";
    switch (r) {
      case "date_asc":
        c = "created_at ASC";
        break;
      case "name_asc":
        c = "file_path ASC";
        break;
      case "name_desc":
        c = "file_path DESC";
        break;
    }
    const i = [], p = [];
    if (s.folder && (p.push("file_path LIKE ?"), i.push(`${s.folder}%`)), s.search && (p.push("file_path LIKE ?"), i.push(`%${s.search}%`)), s.tag && (p.push("id IN (SELECT photo_id FROM photo_tags pt JOIN tags t ON pt.tag_id = t.id WHERE t.name = ?)"), i.push(s.tag)), s.people && s.people.length > 0) {
      const f = s.people[0];
      p.push("id IN (SELECT photo_id FROM faces WHERE person_id = ?)"), i.push(f);
    }
    s.untagged === "untagged" && p.push("id IN (SELECT photo_id FROM faces WHERE person_id IS NULL)");
    let u = "";
    p.length > 0 && (u = " WHERE " + p.join(" AND "));
    try {
      const f = `SELECT * FROM photos${u} ORDER BY ${c} LIMIT ? OFFSET ?`, l = `SELECT COUNT(*) as count FROM photos${u}`, d = n.prepare(f).all(...i, t, h), _ = n.prepare(l).get(...i).count;
      return { photos: d, total: _ };
    } catch (f) {
      throw new Error(`PhotoRepository.getPhotos failed: ${String(f)}`);
    }
  }
  static getLibraryStats() {
    const e = m();
    try {
      try {
        e.function("DIRNAME", (o) => T.dirname(o)), e.function("EXTNAME", (o) => T.extname(o).toLowerCase());
      } catch {
      }
      const t = e.prepare("SELECT COUNT(*) as count FROM photos").get().count, r = e.prepare(`
                SELECT EXTNAME(file_path) as type, COUNT(*) as count 
                FROM photos 
                GROUP BY type 
                ORDER BY count DESC
            `).all(), s = e.prepare(`
                SELECT DISTINCT DIRNAME(file_path) as folder, COUNT(*) as count 
                FROM photos 
                GROUP BY folder 
                ORDER BY count DESC
            `).all();
      return { totalPhotos: t, fileTypes: r, folders: s };
    } catch (t) {
      throw new Error(`PhotoRepository.getLibraryStats failed: ${String(t)}`);
    }
  }
  static getUnprocessedPhotos() {
    return m().prepare("SELECT * FROM photos WHERE blur_score IS NULL LIMIT 1000").all();
  }
  static getFolders() {
    const t = m().prepare("SELECT DISTINCT file_path FROM photos").all(), r = new Set(t.map((s) => T.dirname(s.file_path)));
    return Array.from(r).sort().map((s) => ({ folder: s }));
  }
  static getPhotoById(e) {
    return m().prepare("SELECT * FROM photos WHERE id = ?").get(e);
  }
  static updatePhoto(e, t) {
    const r = m(), s = [], o = [];
    t.description !== void 0 && (s.push("description = ?"), o.push(t.description)), t.blur_score !== void 0 && (s.push("blur_score = ?"), o.push(t.blur_score)), s.length > 0 && (o.push(e), r.prepare(`UPDATE photos SET ${s.join(", ")} WHERE id = ?`).run(...o));
  }
  static getMetricsHistory(e = 1e3) {
    const t = m();
    try {
      const r = t.prepare("SELECT * FROM scan_history ORDER BY timestamp DESC LIMIT ?").all(e), s = t.prepare(`
                SELECT 
                    COUNT(*) as total_scans,
                    SUM(CASE WHEN face_count > 0 THEN 1 ELSE 0 END) as face_scans,
                    SUM(COALESCE(scan_ms, 0) + COALESCE(tag_ms, 0)) as total_processing_time,
                    SUM(COALESCE(face_count, 0)) as total_faces
                FROM scan_history
                WHERE status = 'success'
            `).get(), o = {
        total_scans: (s == null ? void 0 : s.total_scans) || 0,
        face_scans: (s == null ? void 0 : s.face_scans) || 0,
        total_processing_time: (s == null ? void 0 : s.total_processing_time) || 0,
        total_faces: (s == null ? void 0 : s.total_faces) || 0
      };
      return { success: !0, history: r, stats: o };
    } catch (r) {
      throw console.error("getMetricsHistory error:", r), new Error(`PhotoRepository.getMetricsHistory failed: ${String(r)}`);
    }
  }
  static recordScanHistory(e) {
    const t = m();
    try {
      console.log(`[PhotoRepository] Recording history: Photo=${e.photoId} Status=${e.status} Scan=${e.scanMs}ms`), t.prepare(`
                INSERT INTO scan_history (photo_id, file_path, scan_ms, tag_ms, face_count, scan_mode, status, error, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
        e.photoId,
        e.filePath,
        e.scanMs,
        e.tagMs || 0,
        e.faceCount,
        e.scanMode,
        e.status,
        e.error || null,
        Date.now()
      );
    } catch (r) {
      console.error("Failed to record scan history:", r);
    }
  }
  static getScanErrors() {
    return m().prepare("SELECT * FROM scan_errors ORDER BY timestamp DESC").all();
  }
  static async deleteScanErrorAndFile(e, t) {
    const r = m();
    try {
      const s = r.prepare("SELECT file_path FROM scan_errors WHERE id = ?").get(e);
      if (t && s && s.file_path) {
        try {
          await M.unlink(s.file_path);
        } catch (o) {
          console.error("Failed to delete file:", o);
        }
        r.prepare("DELETE FROM photos WHERE file_path = ?").run(s.file_path);
      }
      return r.prepare("DELETE FROM scan_errors WHERE id = ?").run(e), { success: !0 };
    } catch (s) {
      return { success: !1, error: String(s) };
    }
  }
  static retryScanErrors() {
    const e = m(), t = e.prepare("SELECT file_path FROM scan_errors").all();
    return e.prepare("DELETE FROM scan_errors").run(), t.map((r) => r.file_path);
  }
  static getFilePaths(e) {
    if (e.length === 0) return [];
    const t = m(), r = e.map(() => "?").join(",");
    return t.prepare(`SELECT file_path FROM photos WHERE id IN (${r})`).all(...e).map((o) => o.file_path);
  }
  static getPhotosForTargetedScan(e) {
    const t = m(), r = [], s = [];
    e.folderPath && (s.push("file_path LIKE ?"), r.push(`${e.folderPath}%`)), e.onlyWithFaces && s.push("id IN (SELECT DISTINCT photo_id FROM faces)");
    let o = "";
    s.length > 0 && (o = " WHERE " + s.join(" AND "));
    try {
      const n = `SELECT id FROM photos${o}`;
      return t.prepare(n).all(...r);
    } catch (n) {
      return console.error("getPhotosForTargetedScan Error:", n), [];
    }
  }
  static getPhotosForRescan(e) {
    return this.getPhotos(1, 1e5, "date_desc", e.filter || {}, 0).photos.map((t) => t.id);
  }
  static getAllTags() {
    return m().prepare("SELECT * FROM tags ORDER BY name ASC").all();
  }
  static getTagsForPhoto(e) {
    return m().prepare(`
            SELECT t.name 
            FROM tags t
            JOIN photo_tags pt ON t.id = pt.tag_id
            WHERE pt.photo_id = ?
        `).all(e).map((s) => s.name);
  }
  static removeTag(e, t) {
    const r = m(), s = r.prepare("SELECT id FROM tags WHERE name = ?").get(t);
    s && r.prepare("DELETE FROM photo_tags WHERE photo_id = ? AND tag_id = ?").run(e, s.id);
  }
  static addTags(e, t) {
    const r = m(), s = r.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)"), o = r.prepare("SELECT id FROM tags WHERE name = ?"), n = r.prepare("INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, source) VALUES (?, ?, ?)");
    r.transaction(() => {
      for (const c of t) {
        const i = c.toLowerCase();
        s.run(i);
        const p = o.get(i);
        p && n.run(e, p.id, "auto");
      }
    })();
  }
  static cleanupTags() {
    console.log("[PhotoRepository] Starting cleanupTags...");
    const e = m();
    let t = 0, r = 0;
    const s = e.transaction(() => {
      const o = e.prepare("SELECT id, name FROM tags").all(), n = e.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)"), h = e.prepare("SELECT id FROM tags WHERE name = ?"), c = e.prepare("INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, source) VALUES (?, ?, ?)"), i = e.prepare("SELECT photo_id FROM photo_tags WHERE tag_id = ?"), p = e.prepare("DELETE FROM tags WHERE id = ?"), u = e.prepare("DELETE FROM photo_tags WHERE tag_id = ?");
      for (const l of o) {
        const d = l.name.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim(), _ = d.split(/\s+/).filter((y) => y.length > 0);
        if (l.name !== d || _.length > 1) {
          const y = i.all(l.id);
          if (y.length > 0) {
            for (const N of _) {
              n.run(N);
              const b = h.get(N);
              for (const A of y)
                c.run(A.photo_id, b.id, "auto");
            }
            r += y.length;
          }
          u.run(l.id), p.run(l.id), t++;
        }
      }
      const f = e.prepare("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM photo_tags)").run();
      t += f.changes;
    });
    try {
      return s(), { success: !0, deletedCount: t, mergedCount: r };
    } catch (o) {
      return { success: !1, error: o.message };
    }
  }
  static clearAITags() {
    const e = m();
    try {
      return e.transaction(() => {
        e.prepare("DELETE FROM photo_tags WHERE source = 'auto'").run(), e.prepare("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM photo_tags)").run();
      })(), { success: !0 };
    } catch (t) {
      return { success: !1, error: t.message };
    }
  }
  static factoryReset() {
    const e = m();
    try {
      return e.transaction(() => {
        e.prepare("DELETE FROM photo_tags").run(), e.prepare("DELETE FROM faces").run(), e.prepare("DELETE FROM people").run(), e.prepare("DELETE FROM tags").run(), e.prepare("DELETE FROM scan_errors").run(), e.prepare("DELETE FROM scan_history").run(), e.prepare("DELETE FROM photos").run();
      })(), { success: !0 };
    } catch (t) {
      return { success: !1, error: t.message };
    }
  }
}
class He {
  constructor() {
    v(this, "process", null);
    v(this, "mainWindow", null);
    v(this, "scanPromises", /* @__PURE__ */ new Map());
  }
  setMainWindow(e) {
    this.mainWindow = e;
  }
  async start() {
    let e, t;
    const r = $();
    C.isPackaged ? (e = T.join(process.resourcesPath, "python-bin", "smart-photo-ai", "smart-photo-ai.exe"), t = []) : (e = T.join(process.env.APP_ROOT, "src", "python", ".venv", "Scripts", "python.exe"), t = [T.join(process.env.APP_ROOT, "src", "python", "main.py")]), E.info(`[PythonAIProvider] Starting Python Backend: ${e}`), this.process = be(e, t, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        IS_DEV: C.isPackaged ? "false" : "true",
        HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
        LIBRARY_PATH: r,
        LOG_PATH: T.join(C.getPath("userData"), "logs"),
        PYTORCH_CUDA_ALLOC_CONF: "expandable_segments:True"
      }
    }), this.setupListeners(), setTimeout(() => this.syncSettings(), 2e3);
  }
  setupListeners() {
    this.process && (this.process.stdout && Ie({ input: this.process.stdout }).on("line", async (t) => {
      try {
        const r = JSON.parse(t);
        this.handleMessage(r);
      } catch {
        E.info("[Python Raw]", t);
      }
    }), this.process.stderr && this.process.stderr.on("data", (e) => {
      const t = e.toString();
      t.toLowerCase().includes("error") ? E.error(`[Python Error] ${t}`) : E.info(`[Python Log] ${t}`);
    }), this.process.on("close", (e) => {
      E.warn(`Python process exited with code ${e}`), this.process = null;
    }));
  }
  async handleMessage(e) {
    var r;
    const t = e.reqId || e.photoId || e.payload && e.payload.reqId;
    if (t && this.scanPromises.has(t)) {
      const s = this.scanPromises.get(t);
      e.error ? s == null || s.reject(e.error) : s == null || s.resolve(e), this.scanPromises.delete(t);
    }
    if (e.type === "analysis_result") {
      !e.error && e.faces && e.faces.length > 0 && await Y.processAnalysisResult(e.photoId, e.faces, e.width, e.height, this);
      try {
        const s = e.metrics || {};
        E.info(`[Metrics] Recording history for photo ${e.photoId}`), O.recordScanHistory({
          photoId: e.photoId,
          filePath: e.filePath || "",
          scanMs: s.scan || s.total || 0,
          tagMs: s.tag || 0,
          faceCount: e.faces ? e.faces.length : 0,
          scanMode: ((r = e.payload) == null ? void 0 : r.scanMode) || "FAST",
          status: e.error ? "error" : "success",
          error: e.error
        });
      } catch (s) {
        E.error("[Main] Failed to record scan history:", s);
      }
    }
    this.mainWindow && ["scan_result", "tags_result", "analysis_result"].includes(e.type) && this.mainWindow.webContents.send("ai:scan-result", e), this.mainWindow && ["download_progress", "download_result"].includes(e.type) && this.mainWindow.webContents.send("ai:model-progress", e);
  }
  stop() {
    this.process && (E.info("[PythonAIProvider] Stopping Python Backend..."), this.process.kill(), this.process = null);
  }
  syncSettings() {
    const e = B(), t = e.aiProfile === "high";
    this.sendCommand("update_config", { config: { ...e, vlmEnabled: t } });
  }
  sendCommand(e, t) {
    this.process && this.process.stdin && this.process.stdin.write(JSON.stringify({ type: e, payload: t }) + `
`);
  }
  sendRequest(e, t, r = 3e4) {
    return new Promise((s, o) => {
      const n = Math.floor(Math.random() * 1e6);
      this.scanPromises.set(n, { resolve: s, reject: o }), this.sendCommand(e, { ...t, reqId: n }), setTimeout(() => {
        this.scanPromises.has(n) && (this.scanPromises.delete(n), o("Timeout"));
      }, r);
    });
  }
  // IAIProvider Implementation
  async analyzeImage(e, t) {
    return this.sendRequest("analyze_image", { filePath: e, ...t });
  }
  async clusterFaces(e, t, r) {
    return this.sendRequest("cluster_faces", { faces: e, eps: t, minSamples: r });
  }
  async searchFaces(e, t, r) {
    const s = await this.sendRequest("batch_search_index", { descriptors: e, k: t, threshold: r });
    if (s.error) throw new Error(s.error);
    return s.results;
  }
  async generateThumbnail(e, t) {
    return this.sendRequest("generate_thumbnail", { filePath: e, ...t });
  }
  async rotateImage(e, t) {
    return Promise.resolve();
  }
  async checkStatus(e = {}) {
    return this.sendRequest("get_system_status", e, 5e3);
  }
  // Custom helper
  addToIndex(e) {
    this.sendCommand("add_faces_to_vector_index", { faces: e });
  }
}
const I = new He();
class G {
  static async getExifTool() {
    return this._exiftool ? this._exiftool : this._exiftoolInitPromise ? this._exiftoolInitPromise : (this._exiftoolInitPromise = (async () => {
      try {
        E.info("Initializing ExifTool in PhotoService...");
        const e = new Oe({ taskTimeoutMillis: 5e3, maxProcs: 1 });
        return await e.version(), this._exiftool = e, e;
      } catch (e) {
        return E.error("FAILED to initialize ExifTool.", e), null;
      }
    })(), this._exiftoolInitPromise);
  }
  // --- PREVIEW GENERATION ---
  static async extractPreview(e, t, r = !1, s = !1) {
    const o = e.replace(/\\/g, "/"), n = Fe("md5").update(o).digest("hex"), h = T.join(t, `${n}.jpg`);
    try {
      if (!r)
        try {
          return await M.access(h), h;
        } catch {
        }
      const c = T.extname(e).toLowerCase(), i = ![".jpg", ".jpeg", ".png"].includes(c);
      let p = 0, u = !1;
      try {
        const l = await this.getExifTool();
        if (l) {
          const d = await l.read(e, ["Orientation"]);
          if (d != null && d.Orientation) {
            const _ = d.Orientation;
            _ === 3 || _.toString().includes("180") ? (p = 180, u = !0) : _ === 6 || _.toString().includes("90 CW") ? (p = 90, u = !0) : (_ === 8 || _.toString().includes("270 CW")) && (p = 270, u = !0);
          }
        }
      } catch {
      }
      let f = !1;
      if (i && ![".tif", ".tiff"].includes(c))
        try {
          const l = await this.getExifTool();
          if (l) {
            const d = `${h}.tmp`;
            await l.extractPreview(e, d), await M.access(d);
            const _ = Q(d);
            u && _.rotate(p), await _.resize(2560, 2560, { fit: "inside", withoutEnlargement: !0 }).jpeg({ quality: 80 }).toFile(h);
            try {
              await M.unlink(d);
            } catch {
            }
            f = !0;
          }
        } catch {
        }
      if (!f)
        try {
          const l = Q(e);
          u && l.rotate(p), await l.resize(2560, 2560, { fit: "inside", withoutEnlargement: !0 }).jpeg({ quality: 80 }).toFile(h), f = !0;
        } catch {
        }
      if (!f) {
        const l = await I.generateThumbnail(e, { width: 2560 });
        l.success && l.data && (await M.writeFile(h, Buffer.from(l.data, "base64")), f = !0);
      }
      if (f) return h;
      if (s) throw new Error("Failed to generate preview");
    } catch (c) {
      if (E.error(`Preview generation failed key=${e}`, c), s) throw c;
    }
    return null;
  }
  // --- ROTATION ---
  static async rotatePhoto(e, t, r) {
    const s = T.join($(), "previews");
    return await M.mkdir(s, { recursive: !0 }), T.extname(t).toLowerCase(), I.rotateImage(t, r);
  }
  // --- AI WRAPPERS ---
  static async generateTags(e, t) {
    const r = await I.sendRequest("generate_tags", { photoId: e, filePath: t }, 6e4);
    if (r && !r.error && (r.description || r.tags)) {
      const s = [];
      r.description && (O.updatePhoto(e, { description: r.description }), s.push("Description saved")), r.tags && (O.addTags(e, r.tags), s.push(`Tags saved: ${r.tags.length}`)), r.dbStatus = s.join(", ");
    }
    return r;
  }
  static async analyzeImage(e) {
    return I.analyzeImage(e.filePath, e);
  }
}
v(G, "_exiftool", null), v(G, "_exiftoolInitPromise", null);
const ue = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  PhotoService: G
}, Symbol.toStringTag, { value: "Module" }));
function qe() {
  g.handle("ai:command", async (a, e) => {
    const { type: t, payload: r } = e;
    let s = 3e4;
    return (t === "cluster_faces" || t === "analyze_image") && (s = 3e5), await I.sendRequest(t, r, s);
  }), g.handle("ai:analyzeImage", async (a, e) => {
    let { photoId: t, filePath: r, ...s } = e;
    if (!r && t) {
      const n = m().prepare("SELECT file_path FROM photos WHERE id = ?").get(t);
      n && (r = n.file_path);
    }
    return r ? (E.info(`[Main] Analyze Request ${t}`), await G.analyzeImage({ photoId: t, filePath: r, ...s })) : { success: !1, error: "Missing filePath" };
  }), g.handle("ai:scanImage", async (a, e) => {
    let { photoId: t, filePath: r, ...s } = e;
    if (!r && t) {
      const n = m().prepare("SELECT file_path FROM photos WHERE id = ?").get(t);
      n && (r = n.file_path);
    }
    return r ? await G.analyzeImage({ photoId: t, filePath: r, scanMode: "FAST", ...s }) : { success: !1, error: "Missing filePath" };
  }), g.handle("ai:generateTags", async (a, { photoId: e }) => {
    const r = m().prepare("SELECT file_path FROM photos WHERE id = ?").get(e);
    return r ? await G.generateTags(e, r.file_path) : { success: !1, error: "Photo not found" };
  }), g.handle("ai:getSettings", () => B()), g.handle("ai:saveSettings", (a, e) => (We(e), I.syncSettings(), !0)), g.handle("ai:downloadModel", async (a, { modelName: e }) => {
    let t;
    if (e.includes("Runtime")) {
      const r = B();
      r.runtimeUrl ? t = r.runtimeUrl : t = `https://github.com/arozz7/smart-photo-organizer/releases/download/v${C.getVersion()}/ai-runtime-win-x64.zip`;
    }
    return await I.sendRequest("download_model", { modelName: e, url: t }, 18e5);
  }), g.handle("ai:enhanceImage", async (a, e) => await I.sendRequest("enhance_image", e, 3e5)), g.handle("ai:getSystemStatus", async () => {
    let e = B().runtimeUrl;
    return e || (e = `https://github.com/arozz7/smart-photo-organizer/releases/download/v${C.getVersion()}/ai-runtime-win-x64.zip`), (await I.checkStatus({ runtimeUrl: e })).status;
  }), g.handle("face:getBlurry", async (a, e) => R.getBlurryFaces(e)), g.handle("ai:clusterFaces", async (a, e) => {
    const { faceIds: t, eps: r, min_samples: s } = e, o = t || [];
    if (o.length === 0) return { clusters: [], singles: [] };
    try {
      const h = R.getFacesByIds(o).filter((c) => c.descriptor && c.descriptor.length > 0).map((c) => ({ id: c.id, descriptor: c.descriptor }));
      return await I.clusterFaces(h, r, s);
    } catch (n) {
      return E.error(`[IPC] ai:clusterFaces failed: ${n}`), { clusters: [], singles: [] };
    }
  }), g.handle("ai:rebuildIndex", async () => {
    try {
      const a = R.getAllDescriptors();
      return await I.sendRequest("rebuild_index", {
        descriptors: a.map((e) => e.descriptor),
        ids: a.map((e) => e.id)
      }, 6e5);
    } catch (a) {
      return { success: !1, error: String(a) };
    }
  }), g.handle("ai:getClusteredFaces", async (a, e) => {
    try {
      const r = {
        faces: R.getUnassignedDescriptors(),
        // [{id, descriptor}, ...]
        ...e
      };
      return await I.sendRequest("cluster_faces", r, 3e5);
    } catch (t) {
      return E.error(`[Main] ai:getClusteredFaces failed: ${t}`), { clusters: [], singles: [] };
    }
  }), g.handle("ai:searchIndex", async (a, { descriptor: e, k: t, threshold: r }) => await I.sendRequest("search_index", { descriptor: e, k: t, threshold: r })), g.handle("ai:matchFace", async (a, { descriptor: e, options: t }) => {
    const r = async (s, o, n) => I.searchFaces(s, o, n);
    return await Y.matchFace(e, { ...t, searchFn: r });
  }), g.handle("ai:matchBatch", async (a, { descriptors: e, options: t }) => {
    const r = async (s, o, n) => I.searchFaces(s, o, n);
    return await Y.matchBatch(e, { ...t, searchFn: r });
  }), g.handle("face:findPotentialMatches", async (a, { faceIds: e, threshold: t }) => {
    try {
      const r = R.getFacesByIds(e), s = r.map((i) => i.descriptor).filter(Boolean), o = r.filter((i) => i.descriptor).map((i) => i.id);
      if (s.length === 0) return { success: !0, matches: [] };
      const n = async (i, p, u) => I.searchFaces(i, p, u);
      return { success: !0, matches: (await Y.matchBatch(s, { threshold: t, searchFn: n })).map((i, p) => i ? {
        faceId: o[p],
        match: i
      } : null).filter(Boolean) };
    } catch (r) {
      return E.error(`[IPC] face:findPotentialMatches failed: ${r}`), { success: !1, error: String(r) };
    }
  });
}
class le {
  /**
   * L2-normalize a vector (unit length).
   */
  static normalizeVector(e) {
    let t = 0;
    for (let r = 0; r < e.length; r++)
      t += e[r] * e[r];
    return t = Math.sqrt(t), t === 0 ? e : e.map((r) => r / t);
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
  static computeDistance(e, t) {
    if (!e || !t || e.length !== t.length)
      return 1 / 0;
    const r = this.normalizeVector(e), s = this.normalizeVector(t);
    let o = 0;
    for (let n = 0; n < r.length; n++) {
      const h = r[n] - s[n];
      o += h * h;
    }
    return Math.sqrt(o);
  }
  /**
   * Parse a descriptor from various formats (BLOB, JSON string, or array).
   * 
   * @param raw Raw descriptor data
   * @returns Parsed number array or null if invalid
   */
  static parseDescriptor(e) {
    if (!e) return null;
    if (Array.isArray(e))
      return e;
    if (Buffer.isBuffer(e))
      try {
        const t = new Float32Array(
          e.buffer,
          e.byteOffset,
          e.byteLength / 4
        );
        return Array.from(t);
      } catch {
        return null;
      }
    if (typeof e == "string")
      try {
        return JSON.parse(e);
      } catch {
        return null;
      }
    return null;
  }
  /**
   * Find faces that are potential outliers (misassigned) for a given person.
   * Uses distance-to-centroid analysis to identify faces that don't match
   * the person's mean embedding.
   * 
   * @param personId The person ID to analyze
   * @param threshold Distance threshold above which faces are flagged (default: 1.0)
   *                  For L2-normalized embeddings: 0=identical, ~0.8=similar, ~1.2=different, 2=opposite
   * @returns Analysis result with outlier list
   */
  static findOutliersForPerson(e, t = 1.2) {
    const r = F.getPersonWithDescriptor(e);
    if (!r)
      throw new Error(`Person with ID ${e} not found`);
    const s = this.parseDescriptor(r.descriptor_mean_json);
    if (!s || s.length === 0)
      return {
        personId: e,
        personName: r.name,
        totalFaces: 0,
        outliers: [],
        threshold: t,
        centroidValid: !1
      };
    const o = R.getFacesWithDescriptorsByPerson(e), n = [], h = [];
    for (const c of o) {
      const i = this.parseDescriptor(c.descriptor);
      if (!i) continue;
      const p = this.computeDistance(i, s);
      if (h.push(p), p > t) {
        let u = { x: 0, y: 0, width: 100, height: 100 };
        try {
          u = JSON.parse(c.box_json);
        } catch {
        }
        n.push({
          faceId: c.id,
          distance: p,
          blurScore: c.blur_score,
          box: u,
          photo_id: c.photo_id,
          // Added
          file_path: c.file_path,
          preview_cache_path: c.preview_cache_path,
          photo_width: c.width,
          photo_height: c.height
        });
      }
    }
    if (h.length > 0) {
      const c = [...h].sort((l, d) => l - d), i = c[0], p = c[c.length - 1], u = c[Math.floor(c.length / 2)], f = h.reduce((l, d) => l + d, 0) / h.length;
      console.log(`[FaceAnalysis] Person ${r.name}: ${o.length} faces, distances min=${i.toFixed(3)} max=${p.toFixed(3)} avg=${f.toFixed(3)} median=${u.toFixed(3)}, threshold=${t}, outliers=${n.length}`);
    }
    return n.sort((c, i) => i.distance - c.distance), {
      personId: e,
      personName: r.name,
      totalFaces: o.length,
      outliers: n,
      threshold: t,
      centroidValid: !0
    };
  }
  /**
   * Detect background/noise faces for bulk ignore.
   * Sends data to Python backend for DBSCAN clustering and centroid distance calculation.
   * 
   * @param options Threshold overrides from SmartIgnoreSettings
   * @param pythonProvider Python AI provider for backend calls
   */
  static async detectBackgroundFaces(e, t) {
    const r = R.getUnnamedFacesForNoiseDetection();
    if (r.length === 0)
      return {
        candidates: [],
        stats: { totalUnnamed: 0, singlePhotoCount: 0, twoPhotoCount: 0, noiseCount: 0 }
      };
    const o = F.getPeopleWithDescriptors().map((i) => ({
      personId: i.id,
      name: i.name,
      descriptor: i.descriptor
    })).filter((i) => i.descriptor.length > 0), n = r.map((i) => ({
      id: i.id,
      descriptor: this.parseDescriptor(i.descriptor) || [],
      photo_id: i.photo_id,
      box_json: i.box_json,
      file_path: i.file_path,
      preview_cache_path: i.preview_cache_path,
      width: i.width,
      height: i.height
    })).filter((i) => i.descriptor.length > 0);
    console.log(`[FaceAnalysis] detectBackgroundFaces: ${n.length} faces, ${o.length} centroids`);
    const h = await t.sendRequest("detect_background_faces", {
      faces: n,
      centroids: o,
      minPhotoAppearances: e.minPhotoAppearances ?? 3,
      maxClusterSize: e.maxClusterSize ?? 2,
      centroidDistanceThreshold: e.centroidDistanceThreshold ?? 0.7
    });
    if (!h.success && h.error)
      throw new Error(h.error);
    return {
      candidates: (h.candidates || []).map((i) => {
        let p = { x: 0, y: 0, width: 100, height: 100 };
        try {
          i.box_json && (p = JSON.parse(i.box_json));
        } catch {
        }
        return {
          faceId: i.faceId,
          photoCount: i.photoCount,
          clusterSize: i.clusterSize,
          nearestPersonDistance: i.nearestPersonDistance,
          nearestPersonName: i.nearestPersonName,
          box: p,
          photo_id: i.photo_id,
          file_path: i.file_path,
          preview_cache_path: i.preview_cache_path,
          photo_width: i.width,
          photo_height: i.height
        };
      }),
      stats: h.stats || { totalUnnamed: 0, singlePhotoCount: 0, twoPhotoCount: 0, noiseCount: 0 }
    };
  }
}
function ze() {
  g.handle("db:getLibraryStats", async () => {
    try {
      return { success: !0, stats: O.getLibraryStats() };
    } catch (a) {
      return { success: !1, error: String(a) };
    }
  }), g.handle("db:getScanErrors", async () => O.getScanErrors()), g.handle("db:deleteScanError", async (a, { id: e, deleteFile: t }) => O.deleteScanErrorAndFile(e, t)), g.handle("db:clearScanErrors", async () => ({ success: !1, error: "Not implemented in refactor yet" })), g.handle("db:cleanupTags", async () => {
    console.log("[Main] db:cleanupTags called");
    const a = O.cleanupTags();
    return console.log("[Main] db:cleanupTags result:", a), a;
  }), g.handle("db:clearAITags", async () => (console.log("[Main] db:clearAITags called"), O.clearAITags())), g.handle("db:factoryReset", async () => {
    console.log("[Main] db:factoryReset called");
    const a = O.factoryReset();
    try {
      await I.sendRequest("rebuild_index", { descriptors: [], ids: [] }), console.log("[Main] FAISS Index cleared.");
    } catch (e) {
      console.error("[Main] Failed to clear FAISS index:", e);
    }
    try {
      P.updateSettings({ ai_queue: [] }), console.log("[Main] AI Processing Queue cleared.");
    } catch (e) {
      console.error("[Main] Failed to clear AI Queue:", e);
    }
    return a;
  }), g.handle("db:getAllTags", async () => O.getAllTags()), g.handle("db:getTags", async (a, e) => O.getTagsForPhoto(e)), g.handle("db:removeTag", async (a, { photoId: e, tag: t }) => (O.removeTag(e, t), { success: !0 })), g.handle("db:addTags", async (a, { photoId: e, tags: t }) => (O.addTags(e, t), { success: !0 })), g.handle("db:getPhotos", async (a, e) => {
    try {
      return O.getPhotos(e.page, e.limit, e.sort, e.filter, e.offset);
    } catch (t) {
      return { photos: [], total: 0, error: String(t) };
    }
  }), g.handle("db:getPhoto", async (a, e) => O.getPhotoById(e)), g.handle("db:getFolders", async () => O.getFolders()), g.handle("db:getUnprocessedItems", async () => O.getUnprocessedPhotos()), g.handle("db:getPhotosMissingBlurScores", async () => {
    try {
      return { success: !0, photoIds: m().prepare(`
                SELECT id FROM photos 
                WHERE blur_score IS NULL 
                AND (
                    id IN (SELECT photo_id FROM scan_history)
                    OR
                    id IN (SELECT photo_id FROM faces)
                )
            `).all().map((r) => r.id) };
    } catch (a) {
      return { success: !1, error: String(a) };
    }
  }), g.handle("db:getFaces", async (a, e) => R.getFacesByPhoto(e)), g.handle("db:getFacesByIds", async (a, e) => R.getFacesByIds(e)), g.handle("db:getAllFaces", async (a, e) => R.getAllFaces(e.limit, e.offset, e.filter, e.includeDescriptors)), g.handle("db:ignoreFaces", async (a, e) => (R.ignoreFaces(e), { success: !0 })), g.handle("db:ignoreFace", async (a, e) => (R.ignoreFaces([e]), { success: !0 })), g.handle("db:getIgnoredFaces", async (a, e) => R.getIgnoredFaces((e == null ? void 0 : e.page) || 1, (e == null ? void 0 : e.limit) || 50)), g.handle("db:restoreFaces", async (a, { faceIds: e, personId: t }) => (R.restoreFaces(e, t), t && await x.recalculatePersonMean(t), { success: !0 })), g.handle("db:restoreFace", async (a, e) => (R.restoreFaces([e]), { success: !0 })), g.handle("db:removeDuplicateFaces", async () => ({ success: !1, error: "Not implemented" })), g.handle("db:autoAssignFaces", async (a, e) => {
    const t = async (o, n, h) => I.searchFaces(o, n, h), s = P.getAISettings().faceSimilarityThreshold || 0.65;
    return Y.autoAssignFaces(e.faceIds, s, t);
  }), g.handle("db:updateFaces", async (a, e) => ({ success: !1, error: "Not implemented" })), g.handle("db:deleteFaces", async (a, e) => (R.deleteFaces(e), { success: !0 })), g.handle("db:unassignFaces", async (a, e) => (await x.unassignFaces(e), { success: !0 })), g.handle("db:getPeople", async () => F.getPeople()), g.handle("db:setPersonCover", async (a, { personId: e, faceId: t }) => (F.setPersonCover(e, t), { success: !0 })), g.handle("db:getPerson", async (a, e) => F.getPersonById(e)), g.handle("db:assignPerson", async (a, { faceId: e, personName: t }) => await x.assignPerson(e, t)), g.handle("db:renamePerson", async (a, { personId: e, newName: t }) => await x.renamePerson(e, t)), g.handle("db:getPersonMeanDescriptor", async (a, e) => {
    const t = F.getPersonById(e);
    if (t && t.descriptor_mean_json)
      try {
        return JSON.parse(t.descriptor_mean_json);
      } catch {
        return null;
      }
    return null;
  }), g.handle("db:getPeopleWithDescriptors", async () => {
    let a = F.getPeopleWithDescriptors();
    const e = m();
    if (a.length === 0) {
      const t = F.getPeople();
      if (t.length > 0) {
        const r = e.prepare("SELECT COUNT(*) as c FROM faces").get(), s = e.prepare("SELECT COUNT(*) as c FROM faces WHERE descriptor IS NOT NULL").get();
        console.log(`[Main] db:getPeopleWithDescriptors: Found ${t.length} people, 0 with means.`), console.log(`[Main] DB Stats: ${r.c} faces, ${s.c} have descriptors.`), s.c > 0 ? (console.log("[Main] Descriptors exist. Triggering auto-recalc of person means..."), await x.recalculateAllMeans(), a = F.getPeopleWithDescriptors(), console.log(`[Main] Recalc done. New People with Means: ${a.length}`)) : console.warn("[Main] NO DESCRIPTORS in DB. Quick Scan will fail. Deep Scan required.");
      }
    }
    return a;
  }), g.handle("db:getPhotosForTargetedScan", async (a, e) => O.getPhotosForTargetedScan(e)), g.handle("db:getPhotosForRescan", async (a, e) => O.getPhotosForRescan(e)), g.handle("db:retryScanErrors", async () => O.retryScanErrors()), g.handle("db:getFilePaths", async (a, e) => O.getFilePaths(e)), g.handle("db:getMetricsHistory", async (a, e) => O.getMetricsHistory(e)), g.handle("db:reassignFaces", async (a, { faceIds: e, personName: t }) => {
    const r = t.trim();
    let s = F.getPersonByName(r);
    return s || (s = F.createPerson(r)), R.updateFacePerson(e, s.id), await x.recalculatePersonMean(s.id), { success: !0, person: s };
  }), g.handle("db:moveFacesToPerson", async (a, e, t) => x.moveFacesToPerson(e, t)), g.handle("debug:getBlurStats", async () => {
    try {
      const a = m(), e = a.prepare("SELECT COUNT(*) as count FROM faces").get(), t = a.prepare("SELECT COUNT(*) as count FROM faces WHERE blur_score IS NOT NULL").get();
      return {
        success: !0,
        stats: {
          total: e.count,
          scored_count: t.count,
          null_count: e.count - t.count
        }
      };
    } catch (a) {
      return { success: !1, error: String(a) };
    }
  }), g.handle("db:getFaceMetadata", async (a, e) => {
    if (!e || e.length === 0) return [];
    const t = m(), r = e.map(() => "?").join(",");
    return t.prepare(`
            SELECT f.id, f.person_id, f.photo_id, p.file_path, p.preview_cache_path
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.id IN (${r})
        `).all(...e);
  }), g.handle("db:associateMatchedFaces", async (a, { personId: e, faceIds: t }) => (R.updateFacePerson(t, e), await x.recalculatePersonMean(e), { success: !0 })), g.handle("db:associateBulkMatchedFaces", async (a, e) => {
    const t = /* @__PURE__ */ new Map();
    for (const { personId: r, faceId: s } of e)
      t.has(r) || t.set(r, []), t.get(r).push(s);
    for (const [r, s] of t.entries())
      R.updateFacePerson(s, r), await x.recalculatePersonMean(r);
    return { success: !0 };
  }), g.handle("person:findOutliers", async (a, { personId: e, threshold: t }) => {
    try {
      return { success: !0, ...le.findOutliersForPerson(
        e,
        t ?? 0.6
      ) };
    } catch (r) {
      return console.error("[Main] person:findOutliers failed:", r), { success: !1, error: String(r) };
    }
  }), g.handle("db:detectBackgroundFaces", async (a, e) => {
    try {
      const t = P.getSmartIgnoreSettings(), r = {
        minPhotoAppearances: (e == null ? void 0 : e.minPhotoAppearances) ?? t.minPhotoAppearances,
        maxClusterSize: (e == null ? void 0 : e.maxClusterSize) ?? t.maxClusterSize,
        centroidDistanceThreshold: (e == null ? void 0 : e.centroidDistanceThreshold) ?? t.centroidDistanceThreshold
      };
      return { success: !0, ...await le.detectBackgroundFaces(r, I) };
    } catch (t) {
      return console.error("[Main] db:detectBackgroundFaces failed:", t), { success: !1, error: String(t) };
    }
  });
}
function ke() {
  g.handle("settings:getLibraryPath", () => $()), g.handle("settings:moveLibrary", async (a, e) => {
    console.log(`[Main] Configuring move library to: ${e}`);
    const t = $();
    try {
      if (!(await L.stat(e)).isDirectory()) return { success: !1, error: "Target is not a directory" };
    } catch {
      return { success: !1, error: "Target directory does not exist" };
    }
    try {
      De(), I.stop(), console.log("[Main] Moving files...");
      const r = ["library.db", "previews", "vectors.index", "id_map.pkl", "library.db-shm", "library.db-wal"];
      await new Promise((s) => setTimeout(s, 1e3));
      for (const s of r) {
        const o = j.join(t, s), n = j.join(e, s);
        try {
          await L.access(o), console.log(`Copying ${o} -> ${n}`), await L.cp(o, n, { recursive: !0, force: !0 });
        } catch (h) {
          if (h.code === "ENOENT") continue;
          throw new Error(`Failed to copy ${s}: ${h.message}`);
        }
      }
      $e(e), console.log("Cleaning up old files...");
      for (const s of r) {
        const o = j.join(t, s);
        try {
          await L.rm(o, { recursive: !0, force: !0 });
        } catch (n) {
          console.error(`Failed to cleanup ${o}:`, n);
        }
      }
      return console.log("[Main] Restarting application..."), C.relaunch(), C.exit(0), { success: !0 };
    } catch (r) {
      return console.error("[Main] Move failed:", r), { success: !1, error: r };
    }
  }), g.handle("settings:getQueueConfig", async () => {
    const a = P.getSettings().queue;
    return {
      batchSize: a.batchSize || 0,
      cooldownSeconds: a.cooldownSeconds || 60
    };
  }), g.handle("settings:setQueueConfig", async (a, e) => (P.updateQueueConfig({
    batchSize: e.batchSize,
    cooldownSeconds: e.cooldownSeconds
  }), { success: !0 })), g.handle("settings:getAIQueue", () => P.getSettings().ai_queue || []), g.handle("settings:setAIQueue", (a, e) => {
    P.updateSettings({ ai_queue: e });
  }), g.handle("settings:getPreviewStats", async () => {
    const a = $(), e = j.join(a, "previews");
    let t = 0, r = 0;
    try {
      await L.access(e);
      const s = await L.readdir(e);
      for (const o of s)
        if (o.endsWith(".jpg") || o.endsWith(".jpeg"))
          try {
            const n = await L.stat(j.join(e, o));
            t++, r += n.size;
          } catch {
          }
      return { success: !0, count: t, size: r };
    } catch {
      return { success: !0, count: 0, size: 0 };
    }
  }), g.handle("settings:cleanupPreviews", async (a, { days: e }) => {
    const t = $(), r = j.join(t, "previews");
    let s = 0, o = 0;
    const n = Date.now(), h = (e || 0) * 24 * 60 * 60 * 1e3;
    try {
      const c = await L.readdir(r);
      for (const i of c) {
        const p = j.join(r, i);
        try {
          const u = await L.stat(p), f = n - u.mtime.getTime();
          (e === 0 || f > h) && (await L.unlink(p), s++, o += u.size);
        } catch {
        }
      }
      return { success: !0, deletedCount: s, deletedSize: o };
    } catch (c) {
      return { success: !1, error: c.message };
    }
  });
}
async function se() {
  const { PhotoService: a } = await Promise.resolve().then(() => ue);
  return a.getExifTool();
}
const fe = [".jpg", ".jpeg", ".png", ".arw", ".cr2", ".nef", ".dng", ".orf", ".rw2", ".tif", ".tiff"];
async function oe(a, e, t = !1) {
  const { PhotoService: r } = await Promise.resolve().then(() => ue);
  return r.extractPreview(a, e, t, !0);
}
async function ge(a, e, t, r = {}) {
  const { forceRescan: s } = r, o = T.extname(a).toLowerCase();
  if (!fe.includes(o)) return null;
  const n = t.prepare("SELECT * FROM photos WHERE file_path = ?"), h = t.prepare(`
        INSERT INTO photos (file_path, preview_cache_path, created_at, metadata_json, width, height) 
        VALUES (@file_path, @preview_cache_path, @created_at, @metadata_json, @width, @height)
        ON CONFLICT(file_path) DO NOTHING
    `);
  let c = n.get(a), i = !1, p = !1;
  if (c) {
    s && (p = !0, i = !0);
    const u = ![".jpg", ".jpeg", ".png"].includes(o);
    let f = !1;
    if (u) {
      if (c.preview_cache_path)
        try {
          await M.access(c.preview_cache_path), (await M.stat(c.preview_cache_path)).size === 0 && (E.debug(`[Scanner] Preview exists but is 0 bytes: ${c.preview_cache_path}`), f = !0);
        } catch {
          E.debug(`[Scanner] Preview missing (access failed) for ${a} at ${c.preview_cache_path}`), f = !0;
        }
      else
        f = !0;
      if ((f || s) && await se())
        try {
          const d = await oe(a, e, s);
          d && (t.prepare("UPDATE photos SET preview_cache_path = ? WHERE id = ?").run(d, c.id), c.preview_cache_path = d, i = !0, t.prepare("DELETE FROM scan_errors WHERE photo_id = ?").run(c.id));
        } catch (d) {
          E.error(`[Scanner] Preview generation failed for ${T.basename(a)}`, d), t.prepare("INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, ?, ?, ?)").run(c.id, a, d.message || String(d), "Preview Generation");
        }
    } else {
      if (c.preview_cache_path)
        try {
          await M.access(c.preview_cache_path), (await M.stat(c.preview_cache_path)).size === 0 && (f = !0);
        } catch {
          f = !0;
        }
      else
        f = !0;
      if (f || s)
        try {
          const l = await oe(a, e, s);
          l && (t.prepare("UPDATE photos SET preview_cache_path = ? WHERE id = ?").run(l, c.id), c.preview_cache_path = l, i = !0, t.prepare("DELETE FROM scan_errors WHERE photo_id = ?").run(c.id));
        } catch (l) {
          E.error(`[Scanner] Preview generation failed for ${T.basename(a)}`, l), t.prepare("INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, ?, ?, ?)").run(c.id, a, l.message || String(l), "Preview Generation");
        }
    }
    if (!c.metadata_json || c.metadata_json === "{}" || s)
      try {
        const l = await se();
        if (l) {
          const d = await l.read(a);
          let _ = (d == null ? void 0 : d.ImageWidth) || (d == null ? void 0 : d.SourceImageWidth) || (d == null ? void 0 : d.ExifImageWidth) || null, w = (d == null ? void 0 : d.ImageHeight) || (d == null ? void 0 : d.SourceImageHeight) || (d == null ? void 0 : d.ExifImageHeight) || null;
          const y = d == null ? void 0 : d.Orientation;
          if ((y === 6 || y === 8 || y === 5 || y === 7 || y === "Rotate 90 CW" || y === "Rotate 270 CW") && _ && w) {
            E.info(`[Scanner] Detected Rotation for ${T.basename(a)}: ${y}. Swapping ${_}x${w} -> ${w}x${_}`);
            const b = _;
            _ = w, w = b;
          } else
            E.debug(`[Scanner] No Rotation detected for ${T.basename(a)}: ${y} (W:${_}, H:${w})`);
          t.prepare("UPDATE photos SET metadata_json = ?, width = ?, height = ? WHERE id = ?").run(JSON.stringify(d), _, w, c.id), c.metadata_json = JSON.stringify(d), c.width = _, c.height = w, i = !0;
        }
      } catch (l) {
        E.error(`Failed to backfill metadata for ${a}`, l);
      }
  }
  if (!c) {
    E.debug(`[Scanner] New photo found: ${T.basename(a)}`);
    let u = null, f = null;
    try {
      u = await oe(a, e, s);
    } catch (l) {
      f = l, E.error(`[Scanner] Initial preview failed for ${T.basename(a)}`, l);
    }
    try {
      let l = {}, d = null, _ = null;
      try {
        const N = await se();
        if (N) {
          l = await N.read(a), d = (l == null ? void 0 : l.ImageWidth) || (l == null ? void 0 : l.SourceImageWidth) || (l == null ? void 0 : l.ExifImageWidth) || null, _ = (l == null ? void 0 : l.ImageHeight) || (l == null ? void 0 : l.SourceImageHeight) || (l == null ? void 0 : l.ExifImageHeight) || null;
          const b = l == null ? void 0 : l.Orientation;
          if ((b === 6 || b === 8 || b === 5 || b === 7 || b === "Rotate 90 CW" || b === "Rotate 270 CW") && d && _) {
            const D = d;
            d = _, _ = D, E.debug(`[Scanner] Swapped dimensions for ${T.basename(a)} (Orientation: ${b})`);
          }
        }
      } catch (N) {
        E.error(`Failed to read metadata for ${a}`, N);
      }
      const y = h.run({
        file_path: a,
        preview_cache_path: u,
        // Might be null
        created_at: (/* @__PURE__ */ new Date()).toISOString(),
        metadata_json: JSON.stringify(l),
        width: d,
        height: _
      }).lastInsertRowid;
      c = n.get(a), p = !0, f && t.prepare("INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, ?, ?, ?)").run(y, a, f.message || String(f), "Initial Scan");
    } catch (l) {
      E.error("Insert failed", l);
    }
  }
  return c ? (c.isNew = p, c.needsUpdate = i, c) : null;
}
async function Ge(a, e, t, r = {}) {
  const s = m(), o = [];
  let n = 0;
  const h = T.join(e, "previews");
  await M.mkdir(h, { recursive: !0 }), E.info(`Scanning ${a.length} specific files...`);
  for (const c of a)
    try {
      await M.access(c);
      const i = await ge(c, h, s, r);
      i && (o.push(i), n++, t && n % 5 === 0 && t(n));
    } catch (i) {
      E.error(`Failed to process specific file: ${c}`, i);
    }
  return t && t(n), o;
}
async function Je(a, e, t, r = {}) {
  const s = m(), o = [];
  let n = 0, h = 0;
  const c = {}, i = T.join(e, "previews");
  await M.mkdir(i, { recursive: !0 });
  async function p(u) {
    try {
      E.info(`Scanning directory: ${u}`);
      const f = await M.readdir(u, { withFileTypes: !0 });
      for (const l of f) {
        const d = T.join(u, l.name);
        if (l.isDirectory())
          l.name.startsWith(".") || await p(d);
        else if (l.isFile()) {
          h++;
          const _ = await ge(d, i, s, r);
          if (_)
            o.push(_), n++, (n % 10 === 0 || _.needsUpdate) && (t && t(n), await new Promise((w) => setTimeout(w, 0)));
          else {
            const w = T.extname(l.name).toLowerCase();
            fe.includes(w) || (c[w] = (c[w] || 0) + 1);
          }
        }
      }
    } catch (f) {
      E.error(`Error scanning ${u}:`, f);
    }
  }
  return await p(a), E.info(`[Scanner] Scanning Finished. Details: Total=${h}, New=${n}, Returned=${o.length}, Skipped=${JSON.stringify(c)}`), o;
}
class Ye {
  constructor() {
    v(this, "queue", []);
    v(this, "isProcessing", !1);
  }
  enqueueDirectory(e, t, r) {
    return new Promise((s, o) => {
      this.queue.push({ type: "directory", path: e, options: t, resolve: s, reject: o, sender: r }), this.processNext();
    });
  }
  enqueueFiles(e, t, r) {
    return new Promise((s, o) => {
      this.queue.push({ type: "files", paths: e, options: t, resolve: s, reject: o, sender: r }), this.processNext();
    });
  }
  async processNext() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = !0;
    const e = this.queue.shift();
    if (!e) {
      this.isProcessing = !1;
      return;
    }
    E.info(`[ScanQueue] Starting task: ${e.type} - ${e.type === "directory" ? e.path : e.paths.length + " files"}`);
    try {
      const t = $();
      let r;
      e.type === "directory" ? r = await Je(e.path, t, (s) => {
        e.sender.isDestroyed() || e.sender.send("scan-progress", s);
      }, e.options) : r = await Ge(e.paths, t, (s) => {
        e.sender.isDestroyed() || e.sender.send("scan-progress", s);
      }, e.options), e.resolve(r);
    } catch (t) {
      E.error("[ScanQueue] Task failed:", t), e.reject(t);
    } finally {
      this.isProcessing = !1, this.processNext();
    }
  }
}
const de = new Ye();
function Xe() {
  g.handle("scan-directory", async (a, e, t = {}) => await de.enqueueDirectory(e, t, a.sender)), g.handle("scan-files", async (a, e, t = {}) => await de.enqueueFiles(e, t, a.sender)), g.handle("dialog:openDirectory", async () => {
    const { canceled: a, filePaths: e } = await Se.showOpenDialog({
      properties: ["openDirectory"]
    });
    return a ? null : e[0];
  }), g.handle("read-file-buffer", async (a, e) => {
    const t = await import("node:fs/promises");
    try {
      return await t.readFile(e);
    } catch (r) {
      throw E.error("Failed to read file:", e, r), r;
    }
  });
}
function Ve(a) {
  g.handle("app:focusWindow", () => {
    const e = a();
    return e ? (e.isMinimized() && e.restore(), e.focus(), !0) : !1;
  }), g.handle("os:getLogPath", () => E.getLogPath()), g.handle("os:showInFolder", (e, t) => {
    ce.showItemInFolder(t);
  }), g.handle("os:openFolder", (e, t) => {
    ce.openPath(t);
  });
}
const Ke = he(import.meta.url), Ee = T.dirname(Ke), J = process.env.VITE_DEV_SERVER_URL, _e = process.env.APP_ROOT || T.join(Ee, ".."), me = T.join(_e, "dist"), pe = J ? T.join(_e, "public") : me;
class q {
  static async createSplashWindow() {
    this.splash = new ae({
      width: 500,
      height: 300,
      transparent: !0,
      frame: !1,
      alwaysOnTop: !0,
      center: !0,
      resizable: !1,
      webPreferences: {
        nodeIntegration: !1,
        contextIsolation: !0
      }
    });
    const e = T.join(pe, "splash.html");
    E.info(`[WindowManager] Loading splash from: ${e}`);
    try {
      await L.access(e), this.splash.loadFile(e);
    } catch (t) {
      E.error(`[WindowManager] Splash file not found at ${e}:`, t), J && this.splash.loadURL(`${J}/splash.html`);
    }
    this.splash.on("closed", () => this.splash = null), E.info("[WindowManager] Splash window created");
  }
  static updateSplashStatus(e) {
    if (this.splash && !this.splash.isDestroyed()) {
      const t = e.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"');
      this.splash.webContents.executeJavaScript(`
                  var el = document.getElementById('status');
                  if(el) el.innerText = '${t}';
              `).catch(() => {
      });
    }
  }
  static closeSplash() {
    this.splash && !this.splash.isDestroyed() && (this.splash.close(), this.splash = null);
  }
  static async createMainWindow() {
    const e = Be(), t = { width: 1200, height: 800 };
    let r = t;
    e && e.width && e.height && Re.getDisplayMatching({
      x: e.x || 0,
      y: e.y || 0,
      width: e.width,
      height: e.height
    }) && (e.x !== void 0 && e.y !== void 0 ? r = { ...t, ...e } : r = { ...t, width: e.width, height: e.height });
    const s = T.join(Ee, "preload.mjs");
    this.win = new ae({
      icon: T.join(pe, "icon.png"),
      width: r.width,
      height: r.height,
      x: r.x,
      y: r.y,
      show: !1,
      backgroundColor: "#111827",
      webPreferences: {
        preload: s,
        webSecurity: !1,
        // @ts-ignore
        enableAutofill: !1
        // Fixes DevTools console error
      }
    }), I.setMainWindow(this.win);
    const o = () => {
      if (!this.win) return;
      const { x: n, y: h, width: c, height: i } = this.win.getBounds();
      je({ x: n, y: h, width: c, height: i });
    };
    return this.win.on("resized", o), this.win.on("moved", o), this.win.on("close", o), this.win.setMenu(null), this.win.webContents.on("before-input-event", (n, h) => {
      var c;
      h.control && h.shift && h.key.toLowerCase() === "i" && ((c = this.win) == null || c.webContents.toggleDevTools(), n.preventDefault());
    }), this.win.once("ready-to-show", () => {
      var n;
      (n = this.win) == null || n.show(), this.closeSplash();
    }), this.win.webContents.on("did-finish-load", () => {
      var n;
      (n = this.win) == null || n.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
    }), J ? this.win.loadURL(J) : this.win.loadFile(T.join(me, "index.html")), E.info("[WindowManager] Main window created"), this.win;
  }
  static getMainWindow() {
    return this.win;
  }
}
v(q, "win", null), v(q, "splash", null);
const Qe = he(import.meta.url), Ze = T.dirname(Qe), K = $();
E.info(`[Main] Library Path: ${K}`);
process.env.APP_ROOT = T.join(Ze, "..");
const et = process.env.VITE_DEV_SERVER_URL, ut = T.join(process.env.APP_ROOT, "dist-electron"), tt = T.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = et ? T.join(process.env.APP_ROOT, "public") : tt;
C.on("window-all-closed", () => {
  process.platform !== "darwin" && C.quit();
});
C.on("activate", () => {
  ae.getAllWindows().length === 0 && q.createMainWindow();
});
C.whenReady().then(async () => {
  try {
    await L.mkdir(K, { recursive: !0 });
  } catch (e) {
    E.error(`[Main] Failed to create library path: ${K}`, e);
  }
  q.createSplashWindow();
  try {
    await Ce(K, (e) => {
      q.updateSplashStatus(e);
    });
  } catch (e) {
    E.error("DB Init Failed", e);
  }
  I.start(), qe(), ze(), ke(), Xe(), Ve(() => q.getMainWindow()), Ue(async (e, t, r, s) => {
    try {
      const o = await I.generateThumbnail(e, { width: t || 300, box: r, orientation: s || 1 });
      if (o.success && o.data)
        return Buffer.from(o.data, "base64");
    } catch (o) {
      E.error(`[Main] Python thumbnail error: ${o}`);
    }
    return null;
  });
  const a = await q.createMainWindow();
  a && I.setMainWindow(a);
});
process.on("uncaughtException", (a) => {
  E.error("Uncaught Exception:", a);
});
process.on("unhandledRejection", (a) => {
  E.error("Unhandled Rejection:", a);
});
export {
  ut as MAIN_DIST,
  tt as RENDERER_DIST,
  et as VITE_DEV_SERVER_URL
};
