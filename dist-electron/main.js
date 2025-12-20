var ud = Object.defineProperty;
var Oi = (e) => {
  throw TypeError(e);
};
var dd = (e, t, r) => t in e ? ud(e, t, { enumerable: !0, configurable: !0, writable: !0, value: r }) : e[t] = r;
var Br = (e, t, r) => dd(e, typeof t != "symbol" ? t + "" : t, r), Ds = (e, t, r) => t.has(e) || Oi("Cannot " + r);
var oe = (e, t, r) => (Ds(e, t, "read from private field"), r ? r.call(e) : t.get(e)), _t = (e, t, r) => t.has(e) ? Oi("Cannot add the same private member more than once") : t instanceof WeakSet ? t.add(e) : t.set(e, r), Ze = (e, t, r, n) => (Ds(e, t, "write to private field"), n ? n.call(e, r) : t.set(e, r), r), Rt = (e, t, r) => (Ds(e, t, "access private method"), r);
import nl, { app as mt, BrowserWindow as jo, protocol as fd, net as hd, ipcMain as Z, dialog as pd, shell as sl } from "electron";
import { spawn as md } from "node:child_process";
import { createInterface as yd } from "node:readline";
import { fileURLToPath as $d, pathToFileURL as gd } from "node:url";
import _d from "better-sqlite3";
import B from "node:path";
import re, { promises as tr } from "node:fs";
import rr, { createHash as vd } from "node:crypto";
import { ExifTool as Ed } from "exiftool-vendored";
import Ms from "sharp";
import _e from "node:process";
import { promisify as Le, isDeepStrictEqual as Ii } from "node:util";
import ji from "node:assert";
import ol from "node:os";
import "node:events";
import "node:stream";
import * as qe from "node:fs/promises";
const co = B.join(mt.getPath("userData"), "logs");
re.existsSync(co) || re.mkdirSync(co, { recursive: !0 });
const ar = B.join(co, "main.log"), wd = 5 * 1024 * 1024;
let rn = re.createWriteStream(ar, { flags: "a" });
function Ls() {
  try {
    if (re.existsSync(ar) && re.statSync(ar).size > wd) {
      rn.end();
      const t = ar + ".old";
      re.existsSync(t) && re.unlinkSync(t), re.renameSync(ar, t), rn = re.createWriteStream(ar, { flags: "a" });
    }
  } catch (e) {
    console.error("Failed to rotate logs:", e);
  }
}
function Sd() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function Fs(e, ...t) {
  const r = t.map((n) => typeof n == "object" ? JSON.stringify(n) : String(n)).join(" ");
  return `[${Sd()}] [${e}] ${r}
`;
}
const x = {
  info: (...e) => {
    Ls();
    const t = Fs("INFO", ...e);
    console.log(...e), rn.write(t);
  },
  warn: (...e) => {
    Ls();
    const t = Fs("WARN", ...e);
    console.warn(...e), rn.write(t);
  },
  error: (...e) => {
    Ls();
    const t = Fs("ERROR", ...e);
    console.error(...e), rn.write(t);
  },
  getLogPath: () => ar
};
let He;
function al(e) {
  const t = B.join(e, "library.db");
  x.info("Initializing Database at:", t), He = new _d(t), He.pragma("journal_mode = WAL"), He.exec(`
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
      name TEXT UNIQUE NOT NULL,
      descriptor_mean_json TEXT
    );

    CREATE TABLE IF NOT EXISTS faces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id INTEGER,
      box_json TEXT,
      descriptor_json TEXT,
      person_id INTEGER,
      is_ignored BOOLEAN DEFAULT 0,
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
  `);
  try {
    He.exec("ALTER TABLE faces ADD COLUMN blur_score REAL");
  } catch {
  }
  try {
    He.exec("ALTER TABLE faces ADD COLUMN is_ignored BOOLEAN DEFAULT 0");
  } catch {
  }
  try {
    He.exec("ALTER TABLE people ADD COLUMN descriptor_mean_json TEXT");
  } catch {
  }
  try {
    He.exec("ALTER TABLE photos ADD COLUMN blur_score REAL");
  } catch {
  }
  try {
    console.log('Running migration: Cleanup "AI Description" tag...');
    const r = He.prepare("SELECT id FROM tags WHERE name = ?").get("AI Description");
    r && (He.prepare("DELETE FROM photo_tags WHERE tag_id = ?").run(r.id), He.prepare("DELETE FROM tags WHERE id = ?").run(r.id), x.info('Migration complete: "AI Description" tag removed.'));
  } catch (r) {
    x.error("Migration failed:", r);
  }
  x.info("Database schema ensured.");
}
function il() {
  if (!He)
    throw new Error("Database not initialized");
  return He;
}
function bd() {
  He && (x.info("Closing Database connection."), He.close(), He = void 0);
}
const ie = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  closeDB: bd,
  getDB: il,
  initDB: al
}, Symbol.toStringTag, { value: "Module" }));
let Vs = null, wn = null;
async function Wr() {
  return Vs || wn || (wn = (async () => {
    try {
      x.info("Initializing ExifTool...");
      const e = new Ed({
        taskTimeoutMillis: 5e3,
        maxProcs: 1
      }), r = await new Promise((n, s) => {
        const o = setTimeout(() => s(new Error("ExifTool startup timed out")), 3e4);
        e.version().then((a) => {
          clearTimeout(o), n(a);
        }).catch((a) => {
          clearTimeout(o), s(a);
        });
      });
      return x.info(`ExifTool started successfully. Version: ${r}`), Vs = e, e;
    } catch (e) {
      return x.error("FAILED to initialize ExifTool. RAW support will be disabled.", e), null;
    }
  })(), wn);
}
const Pd = [".jpg", ".jpeg", ".png", ".arw", ".cr2", ".nef", ".dng", ".orf", ".rw2", ".tif", ".tiff"];
async function Nd(e, t, r) {
  const n = il(), s = [];
  let o = 0;
  const a = B.join(t, "previews");
  await tr.mkdir(a, { recursive: !0 });
  const i = n.prepare(`
    INSERT INTO photos (file_path, preview_cache_path, created_at, metadata_json) 
    VALUES (@file_path, @preview_cache_path, @created_at, @metadata_json)
    ON CONFLICT(file_path) DO NOTHING
  `), c = n.prepare("SELECT * FROM photos WHERE file_path = ?");
  async function d(m) {
    const v = B.basename(m), _ = `${vd("md5").update(m).digest("hex")}.jpg`, p = B.join(a, _);
    try {
      try {
        return await tr.access(p), p;
      } catch {
        const w = B.extname(m).toLowerCase(), P = ![".jpg", ".jpeg", ".png"].includes(w);
        let T = 0, I = !1;
        try {
          const L = await Wr();
          if (L) {
            const M = await L.read(m, ["Orientation"]);
            if (M != null && M.Orientation) {
              const ee = M.Orientation;
              ee === 1 || ee === "Horizontal (normal)" ? (T = 0, I = !1) : ee === 3 || ee === "Rotate 180" ? (T = 180, I = !0) : ee === 6 || ee === "Rotate 90 CW" ? (T = 90, I = !0) : (ee === 8 || ee === "Rotate 270 CW") && (T = 270, I = !0);
            }
          }
        } catch {
          x.warn(`Failed to read orientation for ${v}, assuming upright.`);
        }
        if (P) {
          let L = !1;
          if (![".tif", ".tiff"].includes(w))
            try {
              const M = await Wr();
              if (M) {
                const ee = `${p}.tmp`, he = new Promise(
                  (V, G) => setTimeout(() => G(new Error("Preview extraction timed out")), 15e3)
                );
                await Promise.race([
                  M.extractPreview(m, ee),
                  he
                ]), await tr.access(ee);
                const pe = Ms(ee);
                I && pe.rotate(T), await pe.resize(1200, 1200, { fit: "inside", withoutEnlargement: !0 }).jpeg({ quality: 80 }).toFile(p);
                try {
                  await tr.unlink(ee);
                } catch {
                }
                x.info(`Extracted and normalized preview for ${v}`), L = !0;
              }
            } catch {
              try {
                await tr.unlink(`${p}.tmp`);
              } catch {
              }
            }
          if (!L)
            try {
              x.info(`Generating preview with Sharp for ${v}...`);
              const M = Ms(m);
              I && M.rotate(T), await M.resize(1200, 1200, { fit: "inside", withoutEnlargement: !0 }).jpeg({ quality: 80 }).toFile(p), x.info(`Generated preview with Sharp for ${v}`), L = !0;
            } catch (M) {
              x.error(`Sharp conversion failed for ${v}:`, M);
            }
          if (L) return p;
        } else
          try {
            const L = Ms(m);
            return I && L.rotate(T), await L.resize(1200, 1200, { fit: "inside", withoutEnlargement: !0 }).jpeg({ quality: 80 }).toFile(p), p;
          } catch (L) {
            x.error(`Failed to generate preview for image ${v}`, L);
          }
      }
    } catch (w) {
      x.error(`Failed to extract/generate preview for ${m}`, w);
    }
    return null;
  }
  let u = 0;
  const f = {};
  async function g(m) {
    try {
      x.info(`Scanning directory: ${m}`);
      const v = await tr.readdir(m, { withFileTypes: !0 });
      x.info(`Found ${v.length} entries in ${m}`);
      for (const $ of v) {
        const _ = B.join(m, $.name);
        if ($.isDirectory())
          $.name.startsWith(".") || await g(_);
        else if ($.isFile()) {
          u++;
          const p = B.extname($.name).toLowerCase();
          if (Pd.includes(p)) {
            let w = c.get(_), P = !1;
            if (w) {
              const T = ![".jpg", ".jpeg", ".png"].includes(p);
              let I = !1;
              if (T) {
                if (w.preview_cache_path)
                  try {
                    await tr.access(w.preview_cache_path);
                  } catch {
                    I = !0;
                  }
                else
                  I = !0;
                if (I && await Wr()) {
                  const M = await d(_);
                  M && (n.prepare("UPDATE photos SET preview_cache_path = ? WHERE id = ?").run(M, w.id), w.preview_cache_path = M, P = !0);
                }
              }
              if (!w.metadata_json || w.metadata_json === "{}")
                try {
                  const L = await Wr();
                  if (L) {
                    const M = await L.read(_);
                    n.prepare("UPDATE photos SET metadata_json = ? WHERE id = ?").run(JSON.stringify(M), w.id), w.metadata_json = JSON.stringify(M), P = !0;
                  }
                } catch (L) {
                  x.error(`Failed to backfill metadata for ${_}`, L);
                }
            }
            if (!w) {
              x.info(`[Scanner] New photo found: ${$.name}`);
              const T = await d(_);
              try {
                let I = {};
                try {
                  const L = await Wr();
                  L && (I = await L.read(_));
                } catch (L) {
                  x.error(`Failed to read metadata for ${_}`, L);
                }
                i.run({
                  file_path: _,
                  preview_cache_path: T,
                  created_at: (/* @__PURE__ */ new Date()).toISOString(),
                  metadata_json: JSON.stringify(I)
                }), w = c.get(_);
              } catch (I) {
                x.error("Insert failed", I);
              }
            }
            w && (s.push(w), o++, (o % 10 === 0 || P) && (r && r(o), await new Promise((T) => setTimeout(T, 0))));
          } else
            f[p] = (f[p] || 0) + 1;
        }
      }
    } catch (v) {
      x.error(`Error scanning ${m}:`, v);
    }
  }
  return await g(e), x.info(`[Scanner] Total files: ${u}, Processed: ${o}, Returned: ${s.length}`), x.info("[Scanner] Skipped Extensions:", f), s;
}
const mr = (e) => {
  const t = typeof e;
  return e !== null && (t === "object" || t === "function");
}, cl = /* @__PURE__ */ new Set([
  "__proto__",
  "prototype",
  "constructor"
]), ll = 1e6, Rd = (e) => e >= "0" && e <= "9";
function ul(e) {
  if (e === "0")
    return !0;
  if (/^[1-9]\d*$/.test(e)) {
    const t = Number.parseInt(e, 10);
    return t <= Number.MAX_SAFE_INTEGER && t <= ll;
  }
  return !1;
}
function Us(e, t) {
  return cl.has(e) ? !1 : (e && ul(e) ? t.push(Number.parseInt(e, 10)) : t.push(e), !0);
}
function Td(e) {
  if (typeof e != "string")
    throw new TypeError(`Expected a string, got ${typeof e}`);
  const t = [];
  let r = "", n = "start", s = !1, o = 0;
  for (const a of e) {
    if (o++, s) {
      r += a, s = !1;
      continue;
    }
    if (a === "\\") {
      if (n === "index")
        throw new Error(`Invalid character '${a}' in an index at position ${o}`);
      if (n === "indexEnd")
        throw new Error(`Invalid character '${a}' after an index at position ${o}`);
      s = !0, n = n === "start" ? "property" : n;
      continue;
    }
    switch (a) {
      case ".": {
        if (n === "index")
          throw new Error(`Invalid character '${a}' in an index at position ${o}`);
        if (n === "indexEnd") {
          n = "property";
          break;
        }
        if (!Us(r, t))
          return [];
        r = "", n = "property";
        break;
      }
      case "[": {
        if (n === "index")
          throw new Error(`Invalid character '${a}' in an index at position ${o}`);
        if (n === "indexEnd") {
          n = "index";
          break;
        }
        if (n === "property" || n === "start") {
          if ((r || n === "property") && !Us(r, t))
            return [];
          r = "";
        }
        n = "index";
        break;
      }
      case "]": {
        if (n === "index") {
          if (r === "")
            r = (t.pop() || "") + "[]", n = "property";
          else {
            const i = Number.parseInt(r, 10);
            !Number.isNaN(i) && Number.isFinite(i) && i >= 0 && i <= Number.MAX_SAFE_INTEGER && i <= ll && r === String(i) ? t.push(i) : t.push(r), r = "", n = "indexEnd";
          }
          break;
        }
        if (n === "indexEnd")
          throw new Error(`Invalid character '${a}' after an index at position ${o}`);
        r += a;
        break;
      }
      default: {
        if (n === "index" && !Rd(a))
          throw new Error(`Invalid character '${a}' in an index at position ${o}`);
        if (n === "indexEnd")
          throw new Error(`Invalid character '${a}' after an index at position ${o}`);
        n === "start" && (n = "property"), r += a;
      }
    }
  }
  switch (s && (r += "\\"), n) {
    case "property": {
      if (!Us(r, t))
        return [];
      break;
    }
    case "index":
      throw new Error("Index was not closed");
    case "start": {
      t.push("");
      break;
    }
  }
  return t;
}
function hs(e) {
  if (typeof e == "string")
    return Td(e);
  if (Array.isArray(e)) {
    const t = [];
    for (const [r, n] of e.entries()) {
      if (typeof n != "string" && typeof n != "number")
        throw new TypeError(`Expected a string or number for path segment at index ${r}, got ${typeof n}`);
      if (typeof n == "number" && !Number.isFinite(n))
        throw new TypeError(`Path segment at index ${r} must be a finite number, got ${n}`);
      if (cl.has(n))
        return [];
      typeof n == "string" && ul(n) ? t.push(Number.parseInt(n, 10)) : t.push(n);
    }
    return t;
  }
  return [];
}
function Ai(e, t, r) {
  if (!mr(e) || typeof t != "string" && !Array.isArray(t))
    return r === void 0 ? e : r;
  const n = hs(t);
  if (n.length === 0)
    return r;
  for (let s = 0; s < n.length; s++) {
    const o = n[s];
    if (e = e[o], e == null) {
      if (s !== n.length - 1)
        return r;
      break;
    }
  }
  return e === void 0 ? r : e;
}
function Sn(e, t, r) {
  if (!mr(e) || typeof t != "string" && !Array.isArray(t))
    return e;
  const n = e, s = hs(t);
  if (s.length === 0)
    return e;
  for (let o = 0; o < s.length; o++) {
    const a = s[o];
    if (o === s.length - 1)
      e[a] = r;
    else if (!mr(e[a])) {
      const c = typeof s[o + 1] == "number";
      e[a] = c ? [] : {};
    }
    e = e[a];
  }
  return n;
}
function Od(e, t) {
  if (!mr(e) || typeof t != "string" && !Array.isArray(t))
    return !1;
  const r = hs(t);
  if (r.length === 0)
    return !1;
  for (let n = 0; n < r.length; n++) {
    const s = r[n];
    if (n === r.length - 1)
      return Object.hasOwn(e, s) ? (delete e[s], !0) : !1;
    if (e = e[s], !mr(e))
      return !1;
  }
}
function zs(e, t) {
  if (!mr(e) || typeof t != "string" && !Array.isArray(t))
    return !1;
  const r = hs(t);
  if (r.length === 0)
    return !1;
  for (const n of r) {
    if (!mr(e) || !(n in e))
      return !1;
    e = e[n];
  }
  return !0;
}
const Wt = ol.homedir(), Ao = ol.tmpdir(), { env: Pr } = _e, Id = (e) => {
  const t = B.join(Wt, "Library");
  return {
    data: B.join(t, "Application Support", e),
    config: B.join(t, "Preferences", e),
    cache: B.join(t, "Caches", e),
    log: B.join(t, "Logs", e),
    temp: B.join(Ao, e)
  };
}, jd = (e) => {
  const t = Pr.APPDATA || B.join(Wt, "AppData", "Roaming"), r = Pr.LOCALAPPDATA || B.join(Wt, "AppData", "Local");
  return {
    // Data/config/cache/log are invented by me as Windows isn't opinionated about this
    data: B.join(r, e, "Data"),
    config: B.join(t, e, "Config"),
    cache: B.join(r, e, "Cache"),
    log: B.join(r, e, "Log"),
    temp: B.join(Ao, e)
  };
}, Ad = (e) => {
  const t = B.basename(Wt);
  return {
    data: B.join(Pr.XDG_DATA_HOME || B.join(Wt, ".local", "share"), e),
    config: B.join(Pr.XDG_CONFIG_HOME || B.join(Wt, ".config"), e),
    cache: B.join(Pr.XDG_CACHE_HOME || B.join(Wt, ".cache"), e),
    // https://wiki.debian.org/XDGBaseDirectorySpecification#state
    log: B.join(Pr.XDG_STATE_HOME || B.join(Wt, ".local", "state"), e),
    temp: B.join(Ao, t, e)
  };
};
function Cd(e, { suffix: t = "nodejs" } = {}) {
  if (typeof e != "string")
    throw new TypeError(`Expected a string, got ${typeof e}`);
  return t && (e += `-${t}`), _e.platform === "darwin" ? Id(e) : _e.platform === "win32" ? jd(e) : Ad(e);
}
const Mt = (e, t) => {
  const { onError: r } = t;
  return function(...s) {
    return e.apply(void 0, s).catch(r);
  };
}, Tt = (e, t) => {
  const { onError: r } = t;
  return function(...s) {
    try {
      return e.apply(void 0, s);
    } catch (o) {
      return r(o);
    }
  };
}, kd = 250, Lt = (e, t) => {
  const { isRetriable: r } = t;
  return function(s) {
    const { timeout: o } = s, a = s.interval ?? kd, i = Date.now() + o;
    return function c(...d) {
      return e.apply(void 0, d).catch((u) => {
        if (!r(u) || Date.now() >= i)
          throw u;
        const f = Math.round(a * Math.random());
        return f > 0 ? new Promise((m) => setTimeout(m, f)).then(() => c.apply(void 0, d)) : c.apply(void 0, d);
      });
    };
  };
}, Ft = (e, t) => {
  const { isRetriable: r } = t;
  return function(s) {
    const { timeout: o } = s, a = Date.now() + o;
    return function(...c) {
      for (; ; )
        try {
          return e.apply(void 0, c);
        } catch (d) {
          if (!r(d) || Date.now() >= a)
            throw d;
          continue;
        }
    };
  };
}, Nr = {
  /* API */
  isChangeErrorOk: (e) => {
    if (!Nr.isNodeError(e))
      return !1;
    const { code: t } = e;
    return t === "ENOSYS" || !Dd && (t === "EINVAL" || t === "EPERM");
  },
  isNodeError: (e) => e instanceof Error,
  isRetriableError: (e) => {
    if (!Nr.isNodeError(e))
      return !1;
    const { code: t } = e;
    return t === "EMFILE" || t === "ENFILE" || t === "EAGAIN" || t === "EBUSY" || t === "EACCESS" || t === "EACCES" || t === "EACCS" || t === "EPERM";
  },
  onChangeError: (e) => {
    if (!Nr.isNodeError(e))
      throw e;
    if (!Nr.isChangeErrorOk(e))
      throw e;
  }
}, bn = {
  onError: Nr.onChangeError
}, et = {
  onError: () => {
  }
}, Dd = _e.getuid ? !_e.getuid() : !1, Fe = {
  isRetriable: Nr.isRetriableError
}, ze = {
  attempt: {
    /* ASYNC */
    chmod: Mt(Le(re.chmod), bn),
    chown: Mt(Le(re.chown), bn),
    close: Mt(Le(re.close), et),
    fsync: Mt(Le(re.fsync), et),
    mkdir: Mt(Le(re.mkdir), et),
    realpath: Mt(Le(re.realpath), et),
    stat: Mt(Le(re.stat), et),
    unlink: Mt(Le(re.unlink), et),
    /* SYNC */
    chmodSync: Tt(re.chmodSync, bn),
    chownSync: Tt(re.chownSync, bn),
    closeSync: Tt(re.closeSync, et),
    existsSync: Tt(re.existsSync, et),
    fsyncSync: Tt(re.fsync, et),
    mkdirSync: Tt(re.mkdirSync, et),
    realpathSync: Tt(re.realpathSync, et),
    statSync: Tt(re.statSync, et),
    unlinkSync: Tt(re.unlinkSync, et)
  },
  retry: {
    /* ASYNC */
    close: Lt(Le(re.close), Fe),
    fsync: Lt(Le(re.fsync), Fe),
    open: Lt(Le(re.open), Fe),
    readFile: Lt(Le(re.readFile), Fe),
    rename: Lt(Le(re.rename), Fe),
    stat: Lt(Le(re.stat), Fe),
    write: Lt(Le(re.write), Fe),
    writeFile: Lt(Le(re.writeFile), Fe),
    /* SYNC */
    closeSync: Ft(re.closeSync, Fe),
    fsyncSync: Ft(re.fsyncSync, Fe),
    openSync: Ft(re.openSync, Fe),
    readFileSync: Ft(re.readFileSync, Fe),
    renameSync: Ft(re.renameSync, Fe),
    statSync: Ft(re.statSync, Fe),
    writeSync: Ft(re.writeSync, Fe),
    writeFileSync: Ft(re.writeFileSync, Fe)
  }
}, Md = "utf8", Ci = 438, Ld = 511, Fd = {}, Vd = _e.geteuid ? _e.geteuid() : -1, Ud = _e.getegid ? _e.getegid() : -1, zd = 1e3, qd = !!_e.getuid;
_e.getuid && _e.getuid();
const ki = 128, Gd = (e) => e instanceof Error && "code" in e, Di = (e) => typeof e == "string", qs = (e) => e === void 0, Kd = _e.platform === "linux", dl = _e.platform === "win32", Co = ["SIGHUP", "SIGINT", "SIGTERM"];
dl || Co.push("SIGALRM", "SIGABRT", "SIGVTALRM", "SIGXCPU", "SIGXFSZ", "SIGUSR2", "SIGTRAP", "SIGSYS", "SIGQUIT", "SIGIOT");
Kd && Co.push("SIGIO", "SIGPOLL", "SIGPWR", "SIGSTKFLT");
class Hd {
  /* CONSTRUCTOR */
  constructor() {
    this.callbacks = /* @__PURE__ */ new Set(), this.exited = !1, this.exit = (t) => {
      if (!this.exited) {
        this.exited = !0;
        for (const r of this.callbacks)
          r();
        t && (dl && t !== "SIGINT" && t !== "SIGTERM" && t !== "SIGKILL" ? _e.kill(_e.pid, "SIGTERM") : _e.kill(_e.pid, t));
      }
    }, this.hook = () => {
      _e.once("exit", () => this.exit());
      for (const t of Co)
        try {
          _e.once(t, () => this.exit(t));
        } catch {
        }
    }, this.register = (t) => (this.callbacks.add(t), () => {
      this.callbacks.delete(t);
    }), this.hook();
  }
}
const Bd = new Hd(), Wd = Bd.register, Ge = {
  /* VARIABLES */
  store: {},
  // filePath => purge
  /* API */
  create: (e) => {
    const t = `000000${Math.floor(Math.random() * 16777215).toString(16)}`.slice(-6), s = `.tmp-${Date.now().toString().slice(-10)}${t}`;
    return `${e}${s}`;
  },
  get: (e, t, r = !0) => {
    const n = Ge.truncate(t(e));
    return n in Ge.store ? Ge.get(e, t, r) : (Ge.store[n] = r, [n, () => delete Ge.store[n]]);
  },
  purge: (e) => {
    Ge.store[e] && (delete Ge.store[e], ze.attempt.unlink(e));
  },
  purgeSync: (e) => {
    Ge.store[e] && (delete Ge.store[e], ze.attempt.unlinkSync(e));
  },
  purgeSyncAll: () => {
    for (const e in Ge.store)
      Ge.purgeSync(e);
  },
  truncate: (e) => {
    const t = B.basename(e);
    if (t.length <= ki)
      return e;
    const r = /^(\.?)(.*?)((?:\.[^.]+)?(?:\.tmp-\d{10}[a-f0-9]{6})?)$/.exec(t);
    if (!r)
      return e;
    const n = t.length - ki;
    return `${e.slice(0, -t.length)}${r[1]}${r[2].slice(0, -n)}${r[3]}`;
  }
};
Wd(Ge.purgeSyncAll);
function fl(e, t, r = Fd) {
  if (Di(r))
    return fl(e, t, { encoding: r });
  const s = { timeout: r.timeout ?? zd };
  let o = null, a = null, i = null;
  try {
    const c = ze.attempt.realpathSync(e), d = !!c;
    e = c || e, [a, o] = Ge.get(e, r.tmpCreate || Ge.create, r.tmpPurge !== !1);
    const u = qd && qs(r.chown), f = qs(r.mode);
    if (d && (u || f)) {
      const g = ze.attempt.statSync(e);
      g && (r = { ...r }, u && (r.chown = { uid: g.uid, gid: g.gid }), f && (r.mode = g.mode));
    }
    if (!d) {
      const g = B.dirname(e);
      ze.attempt.mkdirSync(g, {
        mode: Ld,
        recursive: !0
      });
    }
    i = ze.retry.openSync(s)(a, "w", r.mode || Ci), r.tmpCreated && r.tmpCreated(a), Di(t) ? ze.retry.writeSync(s)(i, t, 0, r.encoding || Md) : qs(t) || ze.retry.writeSync(s)(i, t, 0, t.length, 0), r.fsync !== !1 && (r.fsyncWait !== !1 ? ze.retry.fsyncSync(s)(i) : ze.attempt.fsync(i)), ze.retry.closeSync(s)(i), i = null, r.chown && (r.chown.uid !== Vd || r.chown.gid !== Ud) && ze.attempt.chownSync(a, r.chown.uid, r.chown.gid), r.mode && r.mode !== Ci && ze.attempt.chmodSync(a, r.mode);
    try {
      ze.retry.renameSync(s)(a, e);
    } catch (g) {
      if (!Gd(g) || g.code !== "ENAMETOOLONG")
        throw g;
      ze.retry.renameSync(s)(a, Ge.truncate(e));
    }
    o(), a = null;
  } finally {
    i && ze.attempt.closeSync(i), a && Ge.purge(a);
  }
}
function hl(e) {
  return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, "default") ? e.default : e;
}
var lo = { exports: {} }, pl = {}, pt = {}, Cr = {}, mn = {}, ae = {}, hn = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.regexpCode = e.getEsmExportName = e.getProperty = e.safeStringify = e.stringify = e.strConcat = e.addCodeArg = e.str = e._ = e.nil = e._Code = e.Name = e.IDENTIFIER = e._CodeOrName = void 0;
  class t {
  }
  e._CodeOrName = t, e.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
  class r extends t {
    constructor(w) {
      if (super(), !e.IDENTIFIER.test(w))
        throw new Error("CodeGen: name must be a valid identifier");
      this.str = w;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      return !1;
    }
    get names() {
      return { [this.str]: 1 };
    }
  }
  e.Name = r;
  class n extends t {
    constructor(w) {
      super(), this._items = typeof w == "string" ? [w] : w;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      if (this._items.length > 1)
        return !1;
      const w = this._items[0];
      return w === "" || w === '""';
    }
    get str() {
      var w;
      return (w = this._str) !== null && w !== void 0 ? w : this._str = this._items.reduce((P, T) => `${P}${T}`, "");
    }
    get names() {
      var w;
      return (w = this._names) !== null && w !== void 0 ? w : this._names = this._items.reduce((P, T) => (T instanceof r && (P[T.str] = (P[T.str] || 0) + 1), P), {});
    }
  }
  e._Code = n, e.nil = new n("");
  function s(p, ...w) {
    const P = [p[0]];
    let T = 0;
    for (; T < w.length; )
      i(P, w[T]), P.push(p[++T]);
    return new n(P);
  }
  e._ = s;
  const o = new n("+");
  function a(p, ...w) {
    const P = [m(p[0])];
    let T = 0;
    for (; T < w.length; )
      P.push(o), i(P, w[T]), P.push(o, m(p[++T]));
    return c(P), new n(P);
  }
  e.str = a;
  function i(p, w) {
    w instanceof n ? p.push(...w._items) : w instanceof r ? p.push(w) : p.push(f(w));
  }
  e.addCodeArg = i;
  function c(p) {
    let w = 1;
    for (; w < p.length - 1; ) {
      if (p[w] === o) {
        const P = d(p[w - 1], p[w + 1]);
        if (P !== void 0) {
          p.splice(w - 1, 3, P);
          continue;
        }
        p[w++] = "+";
      }
      w++;
    }
  }
  function d(p, w) {
    if (w === '""')
      return p;
    if (p === '""')
      return w;
    if (typeof p == "string")
      return w instanceof r || p[p.length - 1] !== '"' ? void 0 : typeof w != "string" ? `${p.slice(0, -1)}${w}"` : w[0] === '"' ? p.slice(0, -1) + w.slice(1) : void 0;
    if (typeof w == "string" && w[0] === '"' && !(p instanceof r))
      return `"${p}${w.slice(1)}`;
  }
  function u(p, w) {
    return w.emptyStr() ? p : p.emptyStr() ? w : a`${p}${w}`;
  }
  e.strConcat = u;
  function f(p) {
    return typeof p == "number" || typeof p == "boolean" || p === null ? p : m(Array.isArray(p) ? p.join(",") : p);
  }
  function g(p) {
    return new n(m(p));
  }
  e.stringify = g;
  function m(p) {
    return JSON.stringify(p).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  e.safeStringify = m;
  function v(p) {
    return typeof p == "string" && e.IDENTIFIER.test(p) ? new n(`.${p}`) : s`[${p}]`;
  }
  e.getProperty = v;
  function $(p) {
    if (typeof p == "string" && e.IDENTIFIER.test(p))
      return new n(`${p}`);
    throw new Error(`CodeGen: invalid export name: ${p}, use explicit $id name mapping`);
  }
  e.getEsmExportName = $;
  function _(p) {
    return new n(p.toString());
  }
  e.regexpCode = _;
})(hn);
var uo = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.ValueScope = e.ValueScopeName = e.Scope = e.varKinds = e.UsedValueState = void 0;
  const t = hn;
  class r extends Error {
    constructor(d) {
      super(`CodeGen: "code" for ${d} not defined`), this.value = d.value;
    }
  }
  var n;
  (function(c) {
    c[c.Started = 0] = "Started", c[c.Completed = 1] = "Completed";
  })(n || (e.UsedValueState = n = {})), e.varKinds = {
    const: new t.Name("const"),
    let: new t.Name("let"),
    var: new t.Name("var")
  };
  class s {
    constructor({ prefixes: d, parent: u } = {}) {
      this._names = {}, this._prefixes = d, this._parent = u;
    }
    toName(d) {
      return d instanceof t.Name ? d : this.name(d);
    }
    name(d) {
      return new t.Name(this._newName(d));
    }
    _newName(d) {
      const u = this._names[d] || this._nameGroup(d);
      return `${d}${u.index++}`;
    }
    _nameGroup(d) {
      var u, f;
      if (!((f = (u = this._parent) === null || u === void 0 ? void 0 : u._prefixes) === null || f === void 0) && f.has(d) || this._prefixes && !this._prefixes.has(d))
        throw new Error(`CodeGen: prefix "${d}" is not allowed in this scope`);
      return this._names[d] = { prefix: d, index: 0 };
    }
  }
  e.Scope = s;
  class o extends t.Name {
    constructor(d, u) {
      super(u), this.prefix = d;
    }
    setValue(d, { property: u, itemIndex: f }) {
      this.value = d, this.scopePath = (0, t._)`.${new t.Name(u)}[${f}]`;
    }
  }
  e.ValueScopeName = o;
  const a = (0, t._)`\n`;
  class i extends s {
    constructor(d) {
      super(d), this._values = {}, this._scope = d.scope, this.opts = { ...d, _n: d.lines ? a : t.nil };
    }
    get() {
      return this._scope;
    }
    name(d) {
      return new o(d, this._newName(d));
    }
    value(d, u) {
      var f;
      if (u.ref === void 0)
        throw new Error("CodeGen: ref must be passed in value");
      const g = this.toName(d), { prefix: m } = g, v = (f = u.key) !== null && f !== void 0 ? f : u.ref;
      let $ = this._values[m];
      if ($) {
        const w = $.get(v);
        if (w)
          return w;
      } else
        $ = this._values[m] = /* @__PURE__ */ new Map();
      $.set(v, g);
      const _ = this._scope[m] || (this._scope[m] = []), p = _.length;
      return _[p] = u.ref, g.setValue(u, { property: m, itemIndex: p }), g;
    }
    getValue(d, u) {
      const f = this._values[d];
      if (f)
        return f.get(u);
    }
    scopeRefs(d, u = this._values) {
      return this._reduceValues(u, (f) => {
        if (f.scopePath === void 0)
          throw new Error(`CodeGen: name "${f}" has no value`);
        return (0, t._)`${d}${f.scopePath}`;
      });
    }
    scopeCode(d = this._values, u, f) {
      return this._reduceValues(d, (g) => {
        if (g.value === void 0)
          throw new Error(`CodeGen: name "${g}" has no value`);
        return g.value.code;
      }, u, f);
    }
    _reduceValues(d, u, f = {}, g) {
      let m = t.nil;
      for (const v in d) {
        const $ = d[v];
        if (!$)
          continue;
        const _ = f[v] = f[v] || /* @__PURE__ */ new Map();
        $.forEach((p) => {
          if (_.has(p))
            return;
          _.set(p, n.Started);
          let w = u(p);
          if (w) {
            const P = this.opts.es5 ? e.varKinds.var : e.varKinds.const;
            m = (0, t._)`${m}${P} ${p} = ${w};${this.opts._n}`;
          } else if (w = g == null ? void 0 : g(p))
            m = (0, t._)`${m}${w}${this.opts._n}`;
          else
            throw new r(p);
          _.set(p, n.Completed);
        });
      }
      return m;
    }
  }
  e.ValueScope = i;
})(uo);
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.or = e.and = e.not = e.CodeGen = e.operators = e.varKinds = e.ValueScopeName = e.ValueScope = e.Scope = e.Name = e.regexpCode = e.stringify = e.getProperty = e.nil = e.strConcat = e.str = e._ = void 0;
  const t = hn, r = uo;
  var n = hn;
  Object.defineProperty(e, "_", { enumerable: !0, get: function() {
    return n._;
  } }), Object.defineProperty(e, "str", { enumerable: !0, get: function() {
    return n.str;
  } }), Object.defineProperty(e, "strConcat", { enumerable: !0, get: function() {
    return n.strConcat;
  } }), Object.defineProperty(e, "nil", { enumerable: !0, get: function() {
    return n.nil;
  } }), Object.defineProperty(e, "getProperty", { enumerable: !0, get: function() {
    return n.getProperty;
  } }), Object.defineProperty(e, "stringify", { enumerable: !0, get: function() {
    return n.stringify;
  } }), Object.defineProperty(e, "regexpCode", { enumerable: !0, get: function() {
    return n.regexpCode;
  } }), Object.defineProperty(e, "Name", { enumerable: !0, get: function() {
    return n.Name;
  } });
  var s = uo;
  Object.defineProperty(e, "Scope", { enumerable: !0, get: function() {
    return s.Scope;
  } }), Object.defineProperty(e, "ValueScope", { enumerable: !0, get: function() {
    return s.ValueScope;
  } }), Object.defineProperty(e, "ValueScopeName", { enumerable: !0, get: function() {
    return s.ValueScopeName;
  } }), Object.defineProperty(e, "varKinds", { enumerable: !0, get: function() {
    return s.varKinds;
  } }), e.operators = {
    GT: new t._Code(">"),
    GTE: new t._Code(">="),
    LT: new t._Code("<"),
    LTE: new t._Code("<="),
    EQ: new t._Code("==="),
    NEQ: new t._Code("!=="),
    NOT: new t._Code("!"),
    OR: new t._Code("||"),
    AND: new t._Code("&&"),
    ADD: new t._Code("+")
  };
  class o {
    optimizeNodes() {
      return this;
    }
    optimizeNames(l, h) {
      return this;
    }
  }
  class a extends o {
    constructor(l, h, b) {
      super(), this.varKind = l, this.name = h, this.rhs = b;
    }
    render({ es5: l, _n: h }) {
      const b = l ? r.varKinds.var : this.varKind, A = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
      return `${b} ${this.name}${A};` + h;
    }
    optimizeNames(l, h) {
      if (l[this.name.str])
        return this.rhs && (this.rhs = j(this.rhs, l, h)), this;
    }
    get names() {
      return this.rhs instanceof t._CodeOrName ? this.rhs.names : {};
    }
  }
  class i extends o {
    constructor(l, h, b) {
      super(), this.lhs = l, this.rhs = h, this.sideEffects = b;
    }
    render({ _n: l }) {
      return `${this.lhs} = ${this.rhs};` + l;
    }
    optimizeNames(l, h) {
      if (!(this.lhs instanceof t.Name && !l[this.lhs.str] && !this.sideEffects))
        return this.rhs = j(this.rhs, l, h), this;
    }
    get names() {
      const l = this.lhs instanceof t.Name ? {} : { ...this.lhs.names };
      return te(l, this.rhs);
    }
  }
  class c extends i {
    constructor(l, h, b, A) {
      super(l, b, A), this.op = h;
    }
    render({ _n: l }) {
      return `${this.lhs} ${this.op}= ${this.rhs};` + l;
    }
  }
  class d extends o {
    constructor(l) {
      super(), this.label = l, this.names = {};
    }
    render({ _n: l }) {
      return `${this.label}:` + l;
    }
  }
  class u extends o {
    constructor(l) {
      super(), this.label = l, this.names = {};
    }
    render({ _n: l }) {
      return `break${this.label ? ` ${this.label}` : ""};` + l;
    }
  }
  class f extends o {
    constructor(l) {
      super(), this.error = l;
    }
    render({ _n: l }) {
      return `throw ${this.error};` + l;
    }
    get names() {
      return this.error.names;
    }
  }
  class g extends o {
    constructor(l) {
      super(), this.code = l;
    }
    render({ _n: l }) {
      return `${this.code};` + l;
    }
    optimizeNodes() {
      return `${this.code}` ? this : void 0;
    }
    optimizeNames(l, h) {
      return this.code = j(this.code, l, h), this;
    }
    get names() {
      return this.code instanceof t._CodeOrName ? this.code.names : {};
    }
  }
  class m extends o {
    constructor(l = []) {
      super(), this.nodes = l;
    }
    render(l) {
      return this.nodes.reduce((h, b) => h + b.render(l), "");
    }
    optimizeNodes() {
      const { nodes: l } = this;
      let h = l.length;
      for (; h--; ) {
        const b = l[h].optimizeNodes();
        Array.isArray(b) ? l.splice(h, 1, ...b) : b ? l[h] = b : l.splice(h, 1);
      }
      return l.length > 0 ? this : void 0;
    }
    optimizeNames(l, h) {
      const { nodes: b } = this;
      let A = b.length;
      for (; A--; ) {
        const k = b[A];
        k.optimizeNames(l, h) || (C(l, k.names), b.splice(A, 1));
      }
      return b.length > 0 ? this : void 0;
    }
    get names() {
      return this.nodes.reduce((l, h) => G(l, h.names), {});
    }
  }
  class v extends m {
    render(l) {
      return "{" + l._n + super.render(l) + "}" + l._n;
    }
  }
  class $ extends m {
  }
  class _ extends v {
  }
  _.kind = "else";
  class p extends v {
    constructor(l, h) {
      super(h), this.condition = l;
    }
    render(l) {
      let h = `if(${this.condition})` + super.render(l);
      return this.else && (h += "else " + this.else.render(l)), h;
    }
    optimizeNodes() {
      super.optimizeNodes();
      const l = this.condition;
      if (l === !0)
        return this.nodes;
      let h = this.else;
      if (h) {
        const b = h.optimizeNodes();
        h = this.else = Array.isArray(b) ? new _(b) : b;
      }
      if (h)
        return l === !1 ? h instanceof p ? h : h.nodes : this.nodes.length ? this : new p(q(l), h instanceof p ? [h] : h.nodes);
      if (!(l === !1 || !this.nodes.length))
        return this;
    }
    optimizeNames(l, h) {
      var b;
      if (this.else = (b = this.else) === null || b === void 0 ? void 0 : b.optimizeNames(l, h), !!(super.optimizeNames(l, h) || this.else))
        return this.condition = j(this.condition, l, h), this;
    }
    get names() {
      const l = super.names;
      return te(l, this.condition), this.else && G(l, this.else.names), l;
    }
  }
  p.kind = "if";
  class w extends v {
  }
  w.kind = "for";
  class P extends w {
    constructor(l) {
      super(), this.iteration = l;
    }
    render(l) {
      return `for(${this.iteration})` + super.render(l);
    }
    optimizeNames(l, h) {
      if (super.optimizeNames(l, h))
        return this.iteration = j(this.iteration, l, h), this;
    }
    get names() {
      return G(super.names, this.iteration.names);
    }
  }
  class T extends w {
    constructor(l, h, b, A) {
      super(), this.varKind = l, this.name = h, this.from = b, this.to = A;
    }
    render(l) {
      const h = l.es5 ? r.varKinds.var : this.varKind, { name: b, from: A, to: k } = this;
      return `for(${h} ${b}=${A}; ${b}<${k}; ${b}++)` + super.render(l);
    }
    get names() {
      const l = te(super.names, this.from);
      return te(l, this.to);
    }
  }
  class I extends w {
    constructor(l, h, b, A) {
      super(), this.loop = l, this.varKind = h, this.name = b, this.iterable = A;
    }
    render(l) {
      return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(l);
    }
    optimizeNames(l, h) {
      if (super.optimizeNames(l, h))
        return this.iterable = j(this.iterable, l, h), this;
    }
    get names() {
      return G(super.names, this.iterable.names);
    }
  }
  class L extends v {
    constructor(l, h, b) {
      super(), this.name = l, this.args = h, this.async = b;
    }
    render(l) {
      return `${this.async ? "async " : ""}function ${this.name}(${this.args})` + super.render(l);
    }
  }
  L.kind = "func";
  class M extends m {
    render(l) {
      return "return " + super.render(l);
    }
  }
  M.kind = "return";
  class ee extends v {
    render(l) {
      let h = "try" + super.render(l);
      return this.catch && (h += this.catch.render(l)), this.finally && (h += this.finally.render(l)), h;
    }
    optimizeNodes() {
      var l, h;
      return super.optimizeNodes(), (l = this.catch) === null || l === void 0 || l.optimizeNodes(), (h = this.finally) === null || h === void 0 || h.optimizeNodes(), this;
    }
    optimizeNames(l, h) {
      var b, A;
      return super.optimizeNames(l, h), (b = this.catch) === null || b === void 0 || b.optimizeNames(l, h), (A = this.finally) === null || A === void 0 || A.optimizeNames(l, h), this;
    }
    get names() {
      const l = super.names;
      return this.catch && G(l, this.catch.names), this.finally && G(l, this.finally.names), l;
    }
  }
  class he extends v {
    constructor(l) {
      super(), this.error = l;
    }
    render(l) {
      return `catch(${this.error})` + super.render(l);
    }
  }
  he.kind = "catch";
  class pe extends v {
    render(l) {
      return "finally" + super.render(l);
    }
  }
  pe.kind = "finally";
  class V {
    constructor(l, h = {}) {
      this._values = {}, this._blockStarts = [], this._constants = {}, this.opts = { ...h, _n: h.lines ? `
` : "" }, this._extScope = l, this._scope = new r.Scope({ parent: l }), this._nodes = [new $()];
    }
    toString() {
      return this._root.render(this.opts);
    }
    // returns unique name in the internal scope
    name(l) {
      return this._scope.name(l);
    }
    // reserves unique name in the external scope
    scopeName(l) {
      return this._extScope.name(l);
    }
    // reserves unique name in the external scope and assigns value to it
    scopeValue(l, h) {
      const b = this._extScope.value(l, h);
      return (this._values[b.prefix] || (this._values[b.prefix] = /* @__PURE__ */ new Set())).add(b), b;
    }
    getScopeValue(l, h) {
      return this._extScope.getValue(l, h);
    }
    // return code that assigns values in the external scope to the names that are used internally
    // (same names that were returned by gen.scopeName or gen.scopeValue)
    scopeRefs(l) {
      return this._extScope.scopeRefs(l, this._values);
    }
    scopeCode() {
      return this._extScope.scopeCode(this._values);
    }
    _def(l, h, b, A) {
      const k = this._scope.toName(h);
      return b !== void 0 && A && (this._constants[k.str] = b), this._leafNode(new a(l, k, b)), k;
    }
    // `const` declaration (`var` in es5 mode)
    const(l, h, b) {
      return this._def(r.varKinds.const, l, h, b);
    }
    // `let` declaration with optional assignment (`var` in es5 mode)
    let(l, h, b) {
      return this._def(r.varKinds.let, l, h, b);
    }
    // `var` declaration with optional assignment
    var(l, h, b) {
      return this._def(r.varKinds.var, l, h, b);
    }
    // assignment code
    assign(l, h, b) {
      return this._leafNode(new i(l, h, b));
    }
    // `+=` code
    add(l, h) {
      return this._leafNode(new c(l, e.operators.ADD, h));
    }
    // appends passed SafeExpr to code or executes Block
    code(l) {
      return typeof l == "function" ? l() : l !== t.nil && this._leafNode(new g(l)), this;
    }
    // returns code for object literal for the passed argument list of key-value pairs
    object(...l) {
      const h = ["{"];
      for (const [b, A] of l)
        h.length > 1 && h.push(","), h.push(b), (b !== A || this.opts.es5) && (h.push(":"), (0, t.addCodeArg)(h, A));
      return h.push("}"), new t._Code(h);
    }
    // `if` clause (or statement if `thenBody` and, optionally, `elseBody` are passed)
    if(l, h, b) {
      if (this._blockNode(new p(l)), h && b)
        this.code(h).else().code(b).endIf();
      else if (h)
        this.code(h).endIf();
      else if (b)
        throw new Error('CodeGen: "else" body without "then" body');
      return this;
    }
    // `else if` clause - invalid without `if` or after `else` clauses
    elseIf(l) {
      return this._elseNode(new p(l));
    }
    // `else` clause - only valid after `if` or `else if` clauses
    else() {
      return this._elseNode(new _());
    }
    // end `if` statement (needed if gen.if was used only with condition)
    endIf() {
      return this._endBlockNode(p, _);
    }
    _for(l, h) {
      return this._blockNode(l), h && this.code(h).endFor(), this;
    }
    // a generic `for` clause (or statement if `forBody` is passed)
    for(l, h) {
      return this._for(new P(l), h);
    }
    // `for` statement for a range of values
    forRange(l, h, b, A, k = this.opts.es5 ? r.varKinds.var : r.varKinds.let) {
      const X = this._scope.toName(l);
      return this._for(new T(k, X, h, b), () => A(X));
    }
    // `for-of` statement (in es5 mode replace with a normal for loop)
    forOf(l, h, b, A = r.varKinds.const) {
      const k = this._scope.toName(l);
      if (this.opts.es5) {
        const X = h instanceof t.Name ? h : this.var("_arr", h);
        return this.forRange("_i", 0, (0, t._)`${X}.length`, (J) => {
          this.var(k, (0, t._)`${X}[${J}]`), b(k);
        });
      }
      return this._for(new I("of", A, k, h), () => b(k));
    }
    // `for-in` statement.
    // With option `ownProperties` replaced with a `for-of` loop for object keys
    forIn(l, h, b, A = this.opts.es5 ? r.varKinds.var : r.varKinds.const) {
      if (this.opts.ownProperties)
        return this.forOf(l, (0, t._)`Object.keys(${h})`, b);
      const k = this._scope.toName(l);
      return this._for(new I("in", A, k, h), () => b(k));
    }
    // end `for` loop
    endFor() {
      return this._endBlockNode(w);
    }
    // `label` statement
    label(l) {
      return this._leafNode(new d(l));
    }
    // `break` statement
    break(l) {
      return this._leafNode(new u(l));
    }
    // `return` statement
    return(l) {
      const h = new M();
      if (this._blockNode(h), this.code(l), h.nodes.length !== 1)
        throw new Error('CodeGen: "return" should have one node');
      return this._endBlockNode(M);
    }
    // `try` statement
    try(l, h, b) {
      if (!h && !b)
        throw new Error('CodeGen: "try" without "catch" and "finally"');
      const A = new ee();
      if (this._blockNode(A), this.code(l), h) {
        const k = this.name("e");
        this._currNode = A.catch = new he(k), h(k);
      }
      return b && (this._currNode = A.finally = new pe(), this.code(b)), this._endBlockNode(he, pe);
    }
    // `throw` statement
    throw(l) {
      return this._leafNode(new f(l));
    }
    // start self-balancing block
    block(l, h) {
      return this._blockStarts.push(this._nodes.length), l && this.code(l).endBlock(h), this;
    }
    // end the current self-balancing block
    endBlock(l) {
      const h = this._blockStarts.pop();
      if (h === void 0)
        throw new Error("CodeGen: not in self-balancing block");
      const b = this._nodes.length - h;
      if (b < 0 || l !== void 0 && b !== l)
        throw new Error(`CodeGen: wrong number of nodes: ${b} vs ${l} expected`);
      return this._nodes.length = h, this;
    }
    // `function` heading (or definition if funcBody is passed)
    func(l, h = t.nil, b, A) {
      return this._blockNode(new L(l, h, b)), A && this.code(A).endFunc(), this;
    }
    // end function definition
    endFunc() {
      return this._endBlockNode(L);
    }
    optimize(l = 1) {
      for (; l-- > 0; )
        this._root.optimizeNodes(), this._root.optimizeNames(this._root.names, this._constants);
    }
    _leafNode(l) {
      return this._currNode.nodes.push(l), this;
    }
    _blockNode(l) {
      this._currNode.nodes.push(l), this._nodes.push(l);
    }
    _endBlockNode(l, h) {
      const b = this._currNode;
      if (b instanceof l || h && b instanceof h)
        return this._nodes.pop(), this;
      throw new Error(`CodeGen: not in block "${h ? `${l.kind}/${h.kind}` : l.kind}"`);
    }
    _elseNode(l) {
      const h = this._currNode;
      if (!(h instanceof p))
        throw new Error('CodeGen: "else" without "if"');
      return this._currNode = h.else = l, this;
    }
    get _root() {
      return this._nodes[0];
    }
    get _currNode() {
      const l = this._nodes;
      return l[l.length - 1];
    }
    set _currNode(l) {
      const h = this._nodes;
      h[h.length - 1] = l;
    }
  }
  e.CodeGen = V;
  function G(E, l) {
    for (const h in l)
      E[h] = (E[h] || 0) + (l[h] || 0);
    return E;
  }
  function te(E, l) {
    return l instanceof t._CodeOrName ? G(E, l.names) : E;
  }
  function j(E, l, h) {
    if (E instanceof t.Name)
      return b(E);
    if (!A(E))
      return E;
    return new t._Code(E._items.reduce((k, X) => (X instanceof t.Name && (X = b(X)), X instanceof t._Code ? k.push(...X._items) : k.push(X), k), []));
    function b(k) {
      const X = h[k.str];
      return X === void 0 || l[k.str] !== 1 ? k : (delete l[k.str], X);
    }
    function A(k) {
      return k instanceof t._Code && k._items.some((X) => X instanceof t.Name && l[X.str] === 1 && h[X.str] !== void 0);
    }
  }
  function C(E, l) {
    for (const h in l)
      E[h] = (E[h] || 0) - (l[h] || 0);
  }
  function q(E) {
    return typeof E == "boolean" || typeof E == "number" || E === null ? !E : (0, t._)`!${S(E)}`;
  }
  e.not = q;
  const U = y(e.operators.AND);
  function W(...E) {
    return E.reduce(U);
  }
  e.and = W;
  const z = y(e.operators.OR);
  function N(...E) {
    return E.reduce(z);
  }
  e.or = N;
  function y(E) {
    return (l, h) => l === t.nil ? h : h === t.nil ? l : (0, t._)`${S(l)} ${E} ${S(h)}`;
  }
  function S(E) {
    return E instanceof t.Name ? E : (0, t._)`(${E})`;
  }
})(ae);
var K = {};
Object.defineProperty(K, "__esModule", { value: !0 });
K.checkStrictMode = K.getErrorPath = K.Type = K.useFunc = K.setEvaluated = K.evaluatedPropsToName = K.mergeEvaluated = K.eachItem = K.unescapeJsonPointer = K.escapeJsonPointer = K.escapeFragment = K.unescapeFragment = K.schemaRefOrVal = K.schemaHasRulesButRef = K.schemaHasRules = K.checkUnknownRules = K.alwaysValidSchema = K.toHash = void 0;
const me = ae, Jd = hn;
function Xd(e) {
  const t = {};
  for (const r of e)
    t[r] = !0;
  return t;
}
K.toHash = Xd;
function Yd(e, t) {
  return typeof t == "boolean" ? t : Object.keys(t).length === 0 ? !0 : (ml(e, t), !yl(t, e.self.RULES.all));
}
K.alwaysValidSchema = Yd;
function ml(e, t = e.schema) {
  const { opts: r, self: n } = e;
  if (!r.strictSchema || typeof t == "boolean")
    return;
  const s = n.RULES.keywords;
  for (const o in t)
    s[o] || _l(e, `unknown keyword: "${o}"`);
}
K.checkUnknownRules = ml;
function yl(e, t) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (t[r])
      return !0;
  return !1;
}
K.schemaHasRules = yl;
function xd(e, t) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (r !== "$ref" && t.all[r])
      return !0;
  return !1;
}
K.schemaHasRulesButRef = xd;
function Qd({ topSchemaRef: e, schemaPath: t }, r, n, s) {
  if (!s) {
    if (typeof r == "number" || typeof r == "boolean")
      return r;
    if (typeof r == "string")
      return (0, me._)`${r}`;
  }
  return (0, me._)`${e}${t}${(0, me.getProperty)(n)}`;
}
K.schemaRefOrVal = Qd;
function Zd(e) {
  return $l(decodeURIComponent(e));
}
K.unescapeFragment = Zd;
function ef(e) {
  return encodeURIComponent(ko(e));
}
K.escapeFragment = ef;
function ko(e) {
  return typeof e == "number" ? `${e}` : e.replace(/~/g, "~0").replace(/\//g, "~1");
}
K.escapeJsonPointer = ko;
function $l(e) {
  return e.replace(/~1/g, "/").replace(/~0/g, "~");
}
K.unescapeJsonPointer = $l;
function tf(e, t) {
  if (Array.isArray(e))
    for (const r of e)
      t(r);
  else
    t(e);
}
K.eachItem = tf;
function Mi({ mergeNames: e, mergeToName: t, mergeValues: r, resultToName: n }) {
  return (s, o, a, i) => {
    const c = a === void 0 ? o : a instanceof me.Name ? (o instanceof me.Name ? e(s, o, a) : t(s, o, a), a) : o instanceof me.Name ? (t(s, a, o), o) : r(o, a);
    return i === me.Name && !(c instanceof me.Name) ? n(s, c) : c;
  };
}
K.mergeEvaluated = {
  props: Mi({
    mergeNames: (e, t, r) => e.if((0, me._)`${r} !== true && ${t} !== undefined`, () => {
      e.if((0, me._)`${t} === true`, () => e.assign(r, !0), () => e.assign(r, (0, me._)`${r} || {}`).code((0, me._)`Object.assign(${r}, ${t})`));
    }),
    mergeToName: (e, t, r) => e.if((0, me._)`${r} !== true`, () => {
      t === !0 ? e.assign(r, !0) : (e.assign(r, (0, me._)`${r} || {}`), Do(e, r, t));
    }),
    mergeValues: (e, t) => e === !0 ? !0 : { ...e, ...t },
    resultToName: gl
  }),
  items: Mi({
    mergeNames: (e, t, r) => e.if((0, me._)`${r} !== true && ${t} !== undefined`, () => e.assign(r, (0, me._)`${t} === true ? true : ${r} > ${t} ? ${r} : ${t}`)),
    mergeToName: (e, t, r) => e.if((0, me._)`${r} !== true`, () => e.assign(r, t === !0 ? !0 : (0, me._)`${r} > ${t} ? ${r} : ${t}`)),
    mergeValues: (e, t) => e === !0 ? !0 : Math.max(e, t),
    resultToName: (e, t) => e.var("items", t)
  })
};
function gl(e, t) {
  if (t === !0)
    return e.var("props", !0);
  const r = e.var("props", (0, me._)`{}`);
  return t !== void 0 && Do(e, r, t), r;
}
K.evaluatedPropsToName = gl;
function Do(e, t, r) {
  Object.keys(r).forEach((n) => e.assign((0, me._)`${t}${(0, me.getProperty)(n)}`, !0));
}
K.setEvaluated = Do;
const Li = {};
function rf(e, t) {
  return e.scopeValue("func", {
    ref: t,
    code: Li[t.code] || (Li[t.code] = new Jd._Code(t.code))
  });
}
K.useFunc = rf;
var fo;
(function(e) {
  e[e.Num = 0] = "Num", e[e.Str = 1] = "Str";
})(fo || (K.Type = fo = {}));
function nf(e, t, r) {
  if (e instanceof me.Name) {
    const n = t === fo.Num;
    return r ? n ? (0, me._)`"[" + ${e} + "]"` : (0, me._)`"['" + ${e} + "']"` : n ? (0, me._)`"/" + ${e}` : (0, me._)`"/" + ${e}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
  }
  return r ? (0, me.getProperty)(e).toString() : "/" + ko(e);
}
K.getErrorPath = nf;
function _l(e, t, r = e.opts.strictSchema) {
  if (r) {
    if (t = `strict mode: ${t}`, r === !0)
      throw new Error(t);
    e.self.logger.warn(t);
  }
}
K.checkStrictMode = _l;
var tt = {};
Object.defineProperty(tt, "__esModule", { value: !0 });
const Ve = ae, sf = {
  // validation function arguments
  data: new Ve.Name("data"),
  // data passed to validation function
  // args passed from referencing schema
  valCxt: new Ve.Name("valCxt"),
  // validation/data context - should not be used directly, it is destructured to the names below
  instancePath: new Ve.Name("instancePath"),
  parentData: new Ve.Name("parentData"),
  parentDataProperty: new Ve.Name("parentDataProperty"),
  rootData: new Ve.Name("rootData"),
  // root data - same as the data passed to the first/top validation function
  dynamicAnchors: new Ve.Name("dynamicAnchors"),
  // used to support recursiveRef and dynamicRef
  // function scoped variables
  vErrors: new Ve.Name("vErrors"),
  // null or array of validation errors
  errors: new Ve.Name("errors"),
  // counter of validation errors
  this: new Ve.Name("this"),
  // "globals"
  self: new Ve.Name("self"),
  scope: new Ve.Name("scope"),
  // JTD serialize/parse name for JSON string and position
  json: new Ve.Name("json"),
  jsonPos: new Ve.Name("jsonPos"),
  jsonLen: new Ve.Name("jsonLen"),
  jsonPart: new Ve.Name("jsonPart")
};
tt.default = sf;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.extendErrors = e.resetErrorsCount = e.reportExtraError = e.reportError = e.keyword$DataError = e.keywordError = void 0;
  const t = ae, r = K, n = tt;
  e.keywordError = {
    message: ({ keyword: _ }) => (0, t.str)`must pass "${_}" keyword validation`
  }, e.keyword$DataError = {
    message: ({ keyword: _, schemaType: p }) => p ? (0, t.str)`"${_}" keyword must be ${p} ($data)` : (0, t.str)`"${_}" keyword is invalid ($data)`
  };
  function s(_, p = e.keywordError, w, P) {
    const { it: T } = _, { gen: I, compositeRule: L, allErrors: M } = T, ee = f(_, p, w);
    P ?? (L || M) ? c(I, ee) : d(T, (0, t._)`[${ee}]`);
  }
  e.reportError = s;
  function o(_, p = e.keywordError, w) {
    const { it: P } = _, { gen: T, compositeRule: I, allErrors: L } = P, M = f(_, p, w);
    c(T, M), I || L || d(P, n.default.vErrors);
  }
  e.reportExtraError = o;
  function a(_, p) {
    _.assign(n.default.errors, p), _.if((0, t._)`${n.default.vErrors} !== null`, () => _.if(p, () => _.assign((0, t._)`${n.default.vErrors}.length`, p), () => _.assign(n.default.vErrors, null)));
  }
  e.resetErrorsCount = a;
  function i({ gen: _, keyword: p, schemaValue: w, data: P, errsCount: T, it: I }) {
    if (T === void 0)
      throw new Error("ajv implementation error");
    const L = _.name("err");
    _.forRange("i", T, n.default.errors, (M) => {
      _.const(L, (0, t._)`${n.default.vErrors}[${M}]`), _.if((0, t._)`${L}.instancePath === undefined`, () => _.assign((0, t._)`${L}.instancePath`, (0, t.strConcat)(n.default.instancePath, I.errorPath))), _.assign((0, t._)`${L}.schemaPath`, (0, t.str)`${I.errSchemaPath}/${p}`), I.opts.verbose && (_.assign((0, t._)`${L}.schema`, w), _.assign((0, t._)`${L}.data`, P));
    });
  }
  e.extendErrors = i;
  function c(_, p) {
    const w = _.const("err", p);
    _.if((0, t._)`${n.default.vErrors} === null`, () => _.assign(n.default.vErrors, (0, t._)`[${w}]`), (0, t._)`${n.default.vErrors}.push(${w})`), _.code((0, t._)`${n.default.errors}++`);
  }
  function d(_, p) {
    const { gen: w, validateName: P, schemaEnv: T } = _;
    T.$async ? w.throw((0, t._)`new ${_.ValidationError}(${p})`) : (w.assign((0, t._)`${P}.errors`, p), w.return(!1));
  }
  const u = {
    keyword: new t.Name("keyword"),
    schemaPath: new t.Name("schemaPath"),
    // also used in JTD errors
    params: new t.Name("params"),
    propertyName: new t.Name("propertyName"),
    message: new t.Name("message"),
    schema: new t.Name("schema"),
    parentSchema: new t.Name("parentSchema")
  };
  function f(_, p, w) {
    const { createErrors: P } = _.it;
    return P === !1 ? (0, t._)`{}` : g(_, p, w);
  }
  function g(_, p, w = {}) {
    const { gen: P, it: T } = _, I = [
      m(T, w),
      v(_, w)
    ];
    return $(_, p, I), P.object(...I);
  }
  function m({ errorPath: _ }, { instancePath: p }) {
    const w = p ? (0, t.str)`${_}${(0, r.getErrorPath)(p, r.Type.Str)}` : _;
    return [n.default.instancePath, (0, t.strConcat)(n.default.instancePath, w)];
  }
  function v({ keyword: _, it: { errSchemaPath: p } }, { schemaPath: w, parentSchema: P }) {
    let T = P ? p : (0, t.str)`${p}/${_}`;
    return w && (T = (0, t.str)`${T}${(0, r.getErrorPath)(w, r.Type.Str)}`), [u.schemaPath, T];
  }
  function $(_, { params: p, message: w }, P) {
    const { keyword: T, data: I, schemaValue: L, it: M } = _, { opts: ee, propertyName: he, topSchemaRef: pe, schemaPath: V } = M;
    P.push([u.keyword, T], [u.params, typeof p == "function" ? p(_) : p || (0, t._)`{}`]), ee.messages && P.push([u.message, typeof w == "function" ? w(_) : w]), ee.verbose && P.push([u.schema, L], [u.parentSchema, (0, t._)`${pe}${V}`], [n.default.data, I]), he && P.push([u.propertyName, he]);
  }
})(mn);
Object.defineProperty(Cr, "__esModule", { value: !0 });
Cr.boolOrEmptySchema = Cr.topBoolOrEmptySchema = void 0;
const of = mn, af = ae, cf = tt, lf = {
  message: "boolean schema is false"
};
function uf(e) {
  const { gen: t, schema: r, validateName: n } = e;
  r === !1 ? vl(e, !1) : typeof r == "object" && r.$async === !0 ? t.return(cf.default.data) : (t.assign((0, af._)`${n}.errors`, null), t.return(!0));
}
Cr.topBoolOrEmptySchema = uf;
function df(e, t) {
  const { gen: r, schema: n } = e;
  n === !1 ? (r.var(t, !1), vl(e)) : r.var(t, !0);
}
Cr.boolOrEmptySchema = df;
function vl(e, t) {
  const { gen: r, data: n } = e, s = {
    gen: r,
    keyword: "false schema",
    data: n,
    schema: !1,
    schemaCode: !1,
    schemaValue: !1,
    params: {},
    it: e
  };
  (0, of.reportError)(s, lf, void 0, t);
}
var Re = {}, yr = {};
Object.defineProperty(yr, "__esModule", { value: !0 });
yr.getRules = yr.isJSONType = void 0;
const ff = ["string", "number", "integer", "boolean", "null", "object", "array"], hf = new Set(ff);
function pf(e) {
  return typeof e == "string" && hf.has(e);
}
yr.isJSONType = pf;
function mf() {
  const e = {
    number: { type: "number", rules: [] },
    string: { type: "string", rules: [] },
    array: { type: "array", rules: [] },
    object: { type: "object", rules: [] }
  };
  return {
    types: { ...e, integer: !0, boolean: !0, null: !0 },
    rules: [{ rules: [] }, e.number, e.string, e.array, e.object],
    post: { rules: [] },
    all: {},
    keywords: {}
  };
}
yr.getRules = mf;
var At = {};
Object.defineProperty(At, "__esModule", { value: !0 });
At.shouldUseRule = At.shouldUseGroup = At.schemaHasRulesForType = void 0;
function yf({ schema: e, self: t }, r) {
  const n = t.RULES.types[r];
  return n && n !== !0 && El(e, n);
}
At.schemaHasRulesForType = yf;
function El(e, t) {
  return t.rules.some((r) => wl(e, r));
}
At.shouldUseGroup = El;
function wl(e, t) {
  var r;
  return e[t.keyword] !== void 0 || ((r = t.definition.implements) === null || r === void 0 ? void 0 : r.some((n) => e[n] !== void 0));
}
At.shouldUseRule = wl;
Object.defineProperty(Re, "__esModule", { value: !0 });
Re.reportTypeError = Re.checkDataTypes = Re.checkDataType = Re.coerceAndCheckDataType = Re.getJSONTypes = Re.getSchemaTypes = Re.DataType = void 0;
const $f = yr, gf = At, _f = mn, ce = ae, Sl = K;
var Tr;
(function(e) {
  e[e.Correct = 0] = "Correct", e[e.Wrong = 1] = "Wrong";
})(Tr || (Re.DataType = Tr = {}));
function vf(e) {
  const t = bl(e.type);
  if (t.includes("null")) {
    if (e.nullable === !1)
      throw new Error("type: null contradicts nullable: false");
  } else {
    if (!t.length && e.nullable !== void 0)
      throw new Error('"nullable" cannot be used without "type"');
    e.nullable === !0 && t.push("null");
  }
  return t;
}
Re.getSchemaTypes = vf;
function bl(e) {
  const t = Array.isArray(e) ? e : e ? [e] : [];
  if (t.every($f.isJSONType))
    return t;
  throw new Error("type must be JSONType or JSONType[]: " + t.join(","));
}
Re.getJSONTypes = bl;
function Ef(e, t) {
  const { gen: r, data: n, opts: s } = e, o = wf(t, s.coerceTypes), a = t.length > 0 && !(o.length === 0 && t.length === 1 && (0, gf.schemaHasRulesForType)(e, t[0]));
  if (a) {
    const i = Mo(t, n, s.strictNumbers, Tr.Wrong);
    r.if(i, () => {
      o.length ? Sf(e, t, o) : Lo(e);
    });
  }
  return a;
}
Re.coerceAndCheckDataType = Ef;
const Pl = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
function wf(e, t) {
  return t ? e.filter((r) => Pl.has(r) || t === "array" && r === "array") : [];
}
function Sf(e, t, r) {
  const { gen: n, data: s, opts: o } = e, a = n.let("dataType", (0, ce._)`typeof ${s}`), i = n.let("coerced", (0, ce._)`undefined`);
  o.coerceTypes === "array" && n.if((0, ce._)`${a} == 'object' && Array.isArray(${s}) && ${s}.length == 1`, () => n.assign(s, (0, ce._)`${s}[0]`).assign(a, (0, ce._)`typeof ${s}`).if(Mo(t, s, o.strictNumbers), () => n.assign(i, s))), n.if((0, ce._)`${i} !== undefined`);
  for (const d of r)
    (Pl.has(d) || d === "array" && o.coerceTypes === "array") && c(d);
  n.else(), Lo(e), n.endIf(), n.if((0, ce._)`${i} !== undefined`, () => {
    n.assign(s, i), bf(e, i);
  });
  function c(d) {
    switch (d) {
      case "string":
        n.elseIf((0, ce._)`${a} == "number" || ${a} == "boolean"`).assign(i, (0, ce._)`"" + ${s}`).elseIf((0, ce._)`${s} === null`).assign(i, (0, ce._)`""`);
        return;
      case "number":
        n.elseIf((0, ce._)`${a} == "boolean" || ${s} === null
              || (${a} == "string" && ${s} && ${s} == +${s})`).assign(i, (0, ce._)`+${s}`);
        return;
      case "integer":
        n.elseIf((0, ce._)`${a} === "boolean" || ${s} === null
              || (${a} === "string" && ${s} && ${s} == +${s} && !(${s} % 1))`).assign(i, (0, ce._)`+${s}`);
        return;
      case "boolean":
        n.elseIf((0, ce._)`${s} === "false" || ${s} === 0 || ${s} === null`).assign(i, !1).elseIf((0, ce._)`${s} === "true" || ${s} === 1`).assign(i, !0);
        return;
      case "null":
        n.elseIf((0, ce._)`${s} === "" || ${s} === 0 || ${s} === false`), n.assign(i, null);
        return;
      case "array":
        n.elseIf((0, ce._)`${a} === "string" || ${a} === "number"
              || ${a} === "boolean" || ${s} === null`).assign(i, (0, ce._)`[${s}]`);
    }
  }
}
function bf({ gen: e, parentData: t, parentDataProperty: r }, n) {
  e.if((0, ce._)`${t} !== undefined`, () => e.assign((0, ce._)`${t}[${r}]`, n));
}
function ho(e, t, r, n = Tr.Correct) {
  const s = n === Tr.Correct ? ce.operators.EQ : ce.operators.NEQ;
  let o;
  switch (e) {
    case "null":
      return (0, ce._)`${t} ${s} null`;
    case "array":
      o = (0, ce._)`Array.isArray(${t})`;
      break;
    case "object":
      o = (0, ce._)`${t} && typeof ${t} == "object" && !Array.isArray(${t})`;
      break;
    case "integer":
      o = a((0, ce._)`!(${t} % 1) && !isNaN(${t})`);
      break;
    case "number":
      o = a();
      break;
    default:
      return (0, ce._)`typeof ${t} ${s} ${e}`;
  }
  return n === Tr.Correct ? o : (0, ce.not)(o);
  function a(i = ce.nil) {
    return (0, ce.and)((0, ce._)`typeof ${t} == "number"`, i, r ? (0, ce._)`isFinite(${t})` : ce.nil);
  }
}
Re.checkDataType = ho;
function Mo(e, t, r, n) {
  if (e.length === 1)
    return ho(e[0], t, r, n);
  let s;
  const o = (0, Sl.toHash)(e);
  if (o.array && o.object) {
    const a = (0, ce._)`typeof ${t} != "object"`;
    s = o.null ? a : (0, ce._)`!${t} || ${a}`, delete o.null, delete o.array, delete o.object;
  } else
    s = ce.nil;
  o.number && delete o.integer;
  for (const a in o)
    s = (0, ce.and)(s, ho(a, t, r, n));
  return s;
}
Re.checkDataTypes = Mo;
const Pf = {
  message: ({ schema: e }) => `must be ${e}`,
  params: ({ schema: e, schemaValue: t }) => typeof e == "string" ? (0, ce._)`{type: ${e}}` : (0, ce._)`{type: ${t}}`
};
function Lo(e) {
  const t = Nf(e);
  (0, _f.reportError)(t, Pf);
}
Re.reportTypeError = Lo;
function Nf(e) {
  const { gen: t, data: r, schema: n } = e, s = (0, Sl.schemaRefOrVal)(e, n, "type");
  return {
    gen: t,
    keyword: "type",
    data: r,
    schema: n.type,
    schemaCode: s,
    schemaValue: s,
    parentSchema: n,
    params: {},
    it: e
  };
}
var ps = {};
Object.defineProperty(ps, "__esModule", { value: !0 });
ps.assignDefaults = void 0;
const _r = ae, Rf = K;
function Tf(e, t) {
  const { properties: r, items: n } = e.schema;
  if (t === "object" && r)
    for (const s in r)
      Fi(e, s, r[s].default);
  else t === "array" && Array.isArray(n) && n.forEach((s, o) => Fi(e, o, s.default));
}
ps.assignDefaults = Tf;
function Fi(e, t, r) {
  const { gen: n, compositeRule: s, data: o, opts: a } = e;
  if (r === void 0)
    return;
  const i = (0, _r._)`${o}${(0, _r.getProperty)(t)}`;
  if (s) {
    (0, Rf.checkStrictMode)(e, `default is ignored for: ${i}`);
    return;
  }
  let c = (0, _r._)`${i} === undefined`;
  a.useDefaults === "empty" && (c = (0, _r._)`${c} || ${i} === null || ${i} === ""`), n.if(c, (0, _r._)`${i} = ${(0, _r.stringify)(r)}`);
}
var bt = {}, de = {};
Object.defineProperty(de, "__esModule", { value: !0 });
de.validateUnion = de.validateArray = de.usePattern = de.callValidateCode = de.schemaProperties = de.allSchemaProperties = de.noPropertyInData = de.propertyInData = de.isOwnProperty = de.hasPropFunc = de.reportMissingProp = de.checkMissingProp = de.checkReportMissingProp = void 0;
const $e = ae, Fo = K, Vt = tt, Of = K;
function If(e, t) {
  const { gen: r, data: n, it: s } = e;
  r.if(Uo(r, n, t, s.opts.ownProperties), () => {
    e.setParams({ missingProperty: (0, $e._)`${t}` }, !0), e.error();
  });
}
de.checkReportMissingProp = If;
function jf({ gen: e, data: t, it: { opts: r } }, n, s) {
  return (0, $e.or)(...n.map((o) => (0, $e.and)(Uo(e, t, o, r.ownProperties), (0, $e._)`${s} = ${o}`)));
}
de.checkMissingProp = jf;
function Af(e, t) {
  e.setParams({ missingProperty: t }, !0), e.error();
}
de.reportMissingProp = Af;
function Nl(e) {
  return e.scopeValue("func", {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    ref: Object.prototype.hasOwnProperty,
    code: (0, $e._)`Object.prototype.hasOwnProperty`
  });
}
de.hasPropFunc = Nl;
function Vo(e, t, r) {
  return (0, $e._)`${Nl(e)}.call(${t}, ${r})`;
}
de.isOwnProperty = Vo;
function Cf(e, t, r, n) {
  const s = (0, $e._)`${t}${(0, $e.getProperty)(r)} !== undefined`;
  return n ? (0, $e._)`${s} && ${Vo(e, t, r)}` : s;
}
de.propertyInData = Cf;
function Uo(e, t, r, n) {
  const s = (0, $e._)`${t}${(0, $e.getProperty)(r)} === undefined`;
  return n ? (0, $e.or)(s, (0, $e.not)(Vo(e, t, r))) : s;
}
de.noPropertyInData = Uo;
function Rl(e) {
  return e ? Object.keys(e).filter((t) => t !== "__proto__") : [];
}
de.allSchemaProperties = Rl;
function kf(e, t) {
  return Rl(t).filter((r) => !(0, Fo.alwaysValidSchema)(e, t[r]));
}
de.schemaProperties = kf;
function Df({ schemaCode: e, data: t, it: { gen: r, topSchemaRef: n, schemaPath: s, errorPath: o }, it: a }, i, c, d) {
  const u = d ? (0, $e._)`${e}, ${t}, ${n}${s}` : t, f = [
    [Vt.default.instancePath, (0, $e.strConcat)(Vt.default.instancePath, o)],
    [Vt.default.parentData, a.parentData],
    [Vt.default.parentDataProperty, a.parentDataProperty],
    [Vt.default.rootData, Vt.default.rootData]
  ];
  a.opts.dynamicRef && f.push([Vt.default.dynamicAnchors, Vt.default.dynamicAnchors]);
  const g = (0, $e._)`${u}, ${r.object(...f)}`;
  return c !== $e.nil ? (0, $e._)`${i}.call(${c}, ${g})` : (0, $e._)`${i}(${g})`;
}
de.callValidateCode = Df;
const Mf = (0, $e._)`new RegExp`;
function Lf({ gen: e, it: { opts: t } }, r) {
  const n = t.unicodeRegExp ? "u" : "", { regExp: s } = t.code, o = s(r, n);
  return e.scopeValue("pattern", {
    key: o.toString(),
    ref: o,
    code: (0, $e._)`${s.code === "new RegExp" ? Mf : (0, Of.useFunc)(e, s)}(${r}, ${n})`
  });
}
de.usePattern = Lf;
function Ff(e) {
  const { gen: t, data: r, keyword: n, it: s } = e, o = t.name("valid");
  if (s.allErrors) {
    const i = t.let("valid", !0);
    return a(() => t.assign(i, !1)), i;
  }
  return t.var(o, !0), a(() => t.break()), o;
  function a(i) {
    const c = t.const("len", (0, $e._)`${r}.length`);
    t.forRange("i", 0, c, (d) => {
      e.subschema({
        keyword: n,
        dataProp: d,
        dataPropType: Fo.Type.Num
      }, o), t.if((0, $e.not)(o), i);
    });
  }
}
de.validateArray = Ff;
function Vf(e) {
  const { gen: t, schema: r, keyword: n, it: s } = e;
  if (!Array.isArray(r))
    throw new Error("ajv implementation error");
  if (r.some((c) => (0, Fo.alwaysValidSchema)(s, c)) && !s.opts.unevaluated)
    return;
  const a = t.let("valid", !1), i = t.name("_valid");
  t.block(() => r.forEach((c, d) => {
    const u = e.subschema({
      keyword: n,
      schemaProp: d,
      compositeRule: !0
    }, i);
    t.assign(a, (0, $e._)`${a} || ${i}`), e.mergeValidEvaluated(u, i) || t.if((0, $e.not)(a));
  })), e.result(a, () => e.reset(), () => e.error(!0));
}
de.validateUnion = Vf;
Object.defineProperty(bt, "__esModule", { value: !0 });
bt.validateKeywordUsage = bt.validSchemaType = bt.funcKeywordCode = bt.macroKeywordCode = void 0;
const Be = ae, ir = tt, Uf = de, zf = mn;
function qf(e, t) {
  const { gen: r, keyword: n, schema: s, parentSchema: o, it: a } = e, i = t.macro.call(a.self, s, o, a), c = Tl(r, n, i);
  a.opts.validateSchema !== !1 && a.self.validateSchema(i, !0);
  const d = r.name("valid");
  e.subschema({
    schema: i,
    schemaPath: Be.nil,
    errSchemaPath: `${a.errSchemaPath}/${n}`,
    topSchemaRef: c,
    compositeRule: !0
  }, d), e.pass(d, () => e.error(!0));
}
bt.macroKeywordCode = qf;
function Gf(e, t) {
  var r;
  const { gen: n, keyword: s, schema: o, parentSchema: a, $data: i, it: c } = e;
  Hf(c, t);
  const d = !i && t.compile ? t.compile.call(c.self, o, a, c) : t.validate, u = Tl(n, s, d), f = n.let("valid");
  e.block$data(f, g), e.ok((r = t.valid) !== null && r !== void 0 ? r : f);
  function g() {
    if (t.errors === !1)
      $(), t.modifying && Vi(e), _(() => e.error());
    else {
      const p = t.async ? m() : v();
      t.modifying && Vi(e), _(() => Kf(e, p));
    }
  }
  function m() {
    const p = n.let("ruleErrs", null);
    return n.try(() => $((0, Be._)`await `), (w) => n.assign(f, !1).if((0, Be._)`${w} instanceof ${c.ValidationError}`, () => n.assign(p, (0, Be._)`${w}.errors`), () => n.throw(w))), p;
  }
  function v() {
    const p = (0, Be._)`${u}.errors`;
    return n.assign(p, null), $(Be.nil), p;
  }
  function $(p = t.async ? (0, Be._)`await ` : Be.nil) {
    const w = c.opts.passContext ? ir.default.this : ir.default.self, P = !("compile" in t && !i || t.schema === !1);
    n.assign(f, (0, Be._)`${p}${(0, Uf.callValidateCode)(e, u, w, P)}`, t.modifying);
  }
  function _(p) {
    var w;
    n.if((0, Be.not)((w = t.valid) !== null && w !== void 0 ? w : f), p);
  }
}
bt.funcKeywordCode = Gf;
function Vi(e) {
  const { gen: t, data: r, it: n } = e;
  t.if(n.parentData, () => t.assign(r, (0, Be._)`${n.parentData}[${n.parentDataProperty}]`));
}
function Kf(e, t) {
  const { gen: r } = e;
  r.if((0, Be._)`Array.isArray(${t})`, () => {
    r.assign(ir.default.vErrors, (0, Be._)`${ir.default.vErrors} === null ? ${t} : ${ir.default.vErrors}.concat(${t})`).assign(ir.default.errors, (0, Be._)`${ir.default.vErrors}.length`), (0, zf.extendErrors)(e);
  }, () => e.error());
}
function Hf({ schemaEnv: e }, t) {
  if (t.async && !e.$async)
    throw new Error("async keyword in sync schema");
}
function Tl(e, t, r) {
  if (r === void 0)
    throw new Error(`keyword "${t}" failed to compile`);
  return e.scopeValue("keyword", typeof r == "function" ? { ref: r } : { ref: r, code: (0, Be.stringify)(r) });
}
function Bf(e, t, r = !1) {
  return !t.length || t.some((n) => n === "array" ? Array.isArray(e) : n === "object" ? e && typeof e == "object" && !Array.isArray(e) : typeof e == n || r && typeof e > "u");
}
bt.validSchemaType = Bf;
function Wf({ schema: e, opts: t, self: r, errSchemaPath: n }, s, o) {
  if (Array.isArray(s.keyword) ? !s.keyword.includes(o) : s.keyword !== o)
    throw new Error("ajv implementation error");
  const a = s.dependencies;
  if (a != null && a.some((i) => !Object.prototype.hasOwnProperty.call(e, i)))
    throw new Error(`parent schema must have dependencies of ${o}: ${a.join(",")}`);
  if (s.validateSchema && !s.validateSchema(e[o])) {
    const c = `keyword "${o}" value is invalid at path "${n}": ` + r.errorsText(s.validateSchema.errors);
    if (t.validateSchema === "log")
      r.logger.error(c);
    else
      throw new Error(c);
  }
}
bt.validateKeywordUsage = Wf;
var xt = {};
Object.defineProperty(xt, "__esModule", { value: !0 });
xt.extendSubschemaMode = xt.extendSubschemaData = xt.getSubschema = void 0;
const wt = ae, Ol = K;
function Jf(e, { keyword: t, schemaProp: r, schema: n, schemaPath: s, errSchemaPath: o, topSchemaRef: a }) {
  if (t !== void 0 && n !== void 0)
    throw new Error('both "keyword" and "schema" passed, only one allowed');
  if (t !== void 0) {
    const i = e.schema[t];
    return r === void 0 ? {
      schema: i,
      schemaPath: (0, wt._)`${e.schemaPath}${(0, wt.getProperty)(t)}`,
      errSchemaPath: `${e.errSchemaPath}/${t}`
    } : {
      schema: i[r],
      schemaPath: (0, wt._)`${e.schemaPath}${(0, wt.getProperty)(t)}${(0, wt.getProperty)(r)}`,
      errSchemaPath: `${e.errSchemaPath}/${t}/${(0, Ol.escapeFragment)(r)}`
    };
  }
  if (n !== void 0) {
    if (s === void 0 || o === void 0 || a === void 0)
      throw new Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
    return {
      schema: n,
      schemaPath: s,
      topSchemaRef: a,
      errSchemaPath: o
    };
  }
  throw new Error('either "keyword" or "schema" must be passed');
}
xt.getSubschema = Jf;
function Xf(e, t, { dataProp: r, dataPropType: n, data: s, dataTypes: o, propertyName: a }) {
  if (s !== void 0 && r !== void 0)
    throw new Error('both "data" and "dataProp" passed, only one allowed');
  const { gen: i } = t;
  if (r !== void 0) {
    const { errorPath: d, dataPathArr: u, opts: f } = t, g = i.let("data", (0, wt._)`${t.data}${(0, wt.getProperty)(r)}`, !0);
    c(g), e.errorPath = (0, wt.str)`${d}${(0, Ol.getErrorPath)(r, n, f.jsPropertySyntax)}`, e.parentDataProperty = (0, wt._)`${r}`, e.dataPathArr = [...u, e.parentDataProperty];
  }
  if (s !== void 0) {
    const d = s instanceof wt.Name ? s : i.let("data", s, !0);
    c(d), a !== void 0 && (e.propertyName = a);
  }
  o && (e.dataTypes = o);
  function c(d) {
    e.data = d, e.dataLevel = t.dataLevel + 1, e.dataTypes = [], t.definedProperties = /* @__PURE__ */ new Set(), e.parentData = t.data, e.dataNames = [...t.dataNames, d];
  }
}
xt.extendSubschemaData = Xf;
function Yf(e, { jtdDiscriminator: t, jtdMetadata: r, compositeRule: n, createErrors: s, allErrors: o }) {
  n !== void 0 && (e.compositeRule = n), s !== void 0 && (e.createErrors = s), o !== void 0 && (e.allErrors = o), e.jtdDiscriminator = t, e.jtdMetadata = r;
}
xt.extendSubschemaMode = Yf;
var ke = {}, ms = function e(t, r) {
  if (t === r) return !0;
  if (t && r && typeof t == "object" && typeof r == "object") {
    if (t.constructor !== r.constructor) return !1;
    var n, s, o;
    if (Array.isArray(t)) {
      if (n = t.length, n != r.length) return !1;
      for (s = n; s-- !== 0; )
        if (!e(t[s], r[s])) return !1;
      return !0;
    }
    if (t.constructor === RegExp) return t.source === r.source && t.flags === r.flags;
    if (t.valueOf !== Object.prototype.valueOf) return t.valueOf() === r.valueOf();
    if (t.toString !== Object.prototype.toString) return t.toString() === r.toString();
    if (o = Object.keys(t), n = o.length, n !== Object.keys(r).length) return !1;
    for (s = n; s-- !== 0; )
      if (!Object.prototype.hasOwnProperty.call(r, o[s])) return !1;
    for (s = n; s-- !== 0; ) {
      var a = o[s];
      if (!e(t[a], r[a])) return !1;
    }
    return !0;
  }
  return t !== t && r !== r;
}, Il = { exports: {} }, Xt = Il.exports = function(e, t, r) {
  typeof t == "function" && (r = t, t = {}), r = t.cb || r;
  var n = typeof r == "function" ? r : r.pre || function() {
  }, s = r.post || function() {
  };
  Bn(t, n, s, e, "", e);
};
Xt.keywords = {
  additionalItems: !0,
  items: !0,
  contains: !0,
  additionalProperties: !0,
  propertyNames: !0,
  not: !0,
  if: !0,
  then: !0,
  else: !0
};
Xt.arrayKeywords = {
  items: !0,
  allOf: !0,
  anyOf: !0,
  oneOf: !0
};
Xt.propsKeywords = {
  $defs: !0,
  definitions: !0,
  properties: !0,
  patternProperties: !0,
  dependencies: !0
};
Xt.skipKeywords = {
  default: !0,
  enum: !0,
  const: !0,
  required: !0,
  maximum: !0,
  minimum: !0,
  exclusiveMaximum: !0,
  exclusiveMinimum: !0,
  multipleOf: !0,
  maxLength: !0,
  minLength: !0,
  pattern: !0,
  format: !0,
  maxItems: !0,
  minItems: !0,
  uniqueItems: !0,
  maxProperties: !0,
  minProperties: !0
};
function Bn(e, t, r, n, s, o, a, i, c, d) {
  if (n && typeof n == "object" && !Array.isArray(n)) {
    t(n, s, o, a, i, c, d);
    for (var u in n) {
      var f = n[u];
      if (Array.isArray(f)) {
        if (u in Xt.arrayKeywords)
          for (var g = 0; g < f.length; g++)
            Bn(e, t, r, f[g], s + "/" + u + "/" + g, o, s, u, n, g);
      } else if (u in Xt.propsKeywords) {
        if (f && typeof f == "object")
          for (var m in f)
            Bn(e, t, r, f[m], s + "/" + u + "/" + xf(m), o, s, u, n, m);
      } else (u in Xt.keywords || e.allKeys && !(u in Xt.skipKeywords)) && Bn(e, t, r, f, s + "/" + u, o, s, u, n);
    }
    r(n, s, o, a, i, c, d);
  }
}
function xf(e) {
  return e.replace(/~/g, "~0").replace(/\//g, "~1");
}
var Qf = Il.exports;
Object.defineProperty(ke, "__esModule", { value: !0 });
ke.getSchemaRefs = ke.resolveUrl = ke.normalizeId = ke._getFullPath = ke.getFullPath = ke.inlineRef = void 0;
const Zf = K, eh = ms, th = Qf, rh = /* @__PURE__ */ new Set([
  "type",
  "format",
  "pattern",
  "maxLength",
  "minLength",
  "maxProperties",
  "minProperties",
  "maxItems",
  "minItems",
  "maximum",
  "minimum",
  "uniqueItems",
  "multipleOf",
  "required",
  "enum",
  "const"
]);
function nh(e, t = !0) {
  return typeof e == "boolean" ? !0 : t === !0 ? !po(e) : t ? jl(e) <= t : !1;
}
ke.inlineRef = nh;
const sh = /* @__PURE__ */ new Set([
  "$ref",
  "$recursiveRef",
  "$recursiveAnchor",
  "$dynamicRef",
  "$dynamicAnchor"
]);
function po(e) {
  for (const t in e) {
    if (sh.has(t))
      return !0;
    const r = e[t];
    if (Array.isArray(r) && r.some(po) || typeof r == "object" && po(r))
      return !0;
  }
  return !1;
}
function jl(e) {
  let t = 0;
  for (const r in e) {
    if (r === "$ref")
      return 1 / 0;
    if (t++, !rh.has(r) && (typeof e[r] == "object" && (0, Zf.eachItem)(e[r], (n) => t += jl(n)), t === 1 / 0))
      return 1 / 0;
  }
  return t;
}
function Al(e, t = "", r) {
  r !== !1 && (t = Or(t));
  const n = e.parse(t);
  return Cl(e, n);
}
ke.getFullPath = Al;
function Cl(e, t) {
  return e.serialize(t).split("#")[0] + "#";
}
ke._getFullPath = Cl;
const oh = /#\/?$/;
function Or(e) {
  return e ? e.replace(oh, "") : "";
}
ke.normalizeId = Or;
function ah(e, t, r) {
  return r = Or(r), e.resolve(t, r);
}
ke.resolveUrl = ah;
const ih = /^[a-z_][-a-z0-9._]*$/i;
function ch(e, t) {
  if (typeof e == "boolean")
    return {};
  const { schemaId: r, uriResolver: n } = this.opts, s = Or(e[r] || t), o = { "": s }, a = Al(n, s, !1), i = {}, c = /* @__PURE__ */ new Set();
  return th(e, { allKeys: !0 }, (f, g, m, v) => {
    if (v === void 0)
      return;
    const $ = a + g;
    let _ = o[v];
    typeof f[r] == "string" && (_ = p.call(this, f[r])), w.call(this, f.$anchor), w.call(this, f.$dynamicAnchor), o[g] = _;
    function p(P) {
      const T = this.opts.uriResolver.resolve;
      if (P = Or(_ ? T(_, P) : P), c.has(P))
        throw u(P);
      c.add(P);
      let I = this.refs[P];
      return typeof I == "string" && (I = this.refs[I]), typeof I == "object" ? d(f, I.schema, P) : P !== Or($) && (P[0] === "#" ? (d(f, i[P], P), i[P] = f) : this.refs[P] = $), P;
    }
    function w(P) {
      if (typeof P == "string") {
        if (!ih.test(P))
          throw new Error(`invalid anchor "${P}"`);
        p.call(this, `#${P}`);
      }
    }
  }), i;
  function d(f, g, m) {
    if (g !== void 0 && !eh(f, g))
      throw u(m);
  }
  function u(f) {
    return new Error(`reference "${f}" resolves to more than one schema`);
  }
}
ke.getSchemaRefs = ch;
Object.defineProperty(pt, "__esModule", { value: !0 });
pt.getData = pt.KeywordCxt = pt.validateFunctionCode = void 0;
const kl = Cr, Ui = Re, zo = At, rs = Re, lh = ps, nn = bt, Gs = xt, Q = ae, ne = tt, uh = ke, Ct = K, Jr = mn;
function dh(e) {
  if (Ll(e) && (Fl(e), Ml(e))) {
    ph(e);
    return;
  }
  Dl(e, () => (0, kl.topBoolOrEmptySchema)(e));
}
pt.validateFunctionCode = dh;
function Dl({ gen: e, validateName: t, schema: r, schemaEnv: n, opts: s }, o) {
  s.code.es5 ? e.func(t, (0, Q._)`${ne.default.data}, ${ne.default.valCxt}`, n.$async, () => {
    e.code((0, Q._)`"use strict"; ${zi(r, s)}`), hh(e, s), e.code(o);
  }) : e.func(t, (0, Q._)`${ne.default.data}, ${fh(s)}`, n.$async, () => e.code(zi(r, s)).code(o));
}
function fh(e) {
  return (0, Q._)`{${ne.default.instancePath}="", ${ne.default.parentData}, ${ne.default.parentDataProperty}, ${ne.default.rootData}=${ne.default.data}${e.dynamicRef ? (0, Q._)`, ${ne.default.dynamicAnchors}={}` : Q.nil}}={}`;
}
function hh(e, t) {
  e.if(ne.default.valCxt, () => {
    e.var(ne.default.instancePath, (0, Q._)`${ne.default.valCxt}.${ne.default.instancePath}`), e.var(ne.default.parentData, (0, Q._)`${ne.default.valCxt}.${ne.default.parentData}`), e.var(ne.default.parentDataProperty, (0, Q._)`${ne.default.valCxt}.${ne.default.parentDataProperty}`), e.var(ne.default.rootData, (0, Q._)`${ne.default.valCxt}.${ne.default.rootData}`), t.dynamicRef && e.var(ne.default.dynamicAnchors, (0, Q._)`${ne.default.valCxt}.${ne.default.dynamicAnchors}`);
  }, () => {
    e.var(ne.default.instancePath, (0, Q._)`""`), e.var(ne.default.parentData, (0, Q._)`undefined`), e.var(ne.default.parentDataProperty, (0, Q._)`undefined`), e.var(ne.default.rootData, ne.default.data), t.dynamicRef && e.var(ne.default.dynamicAnchors, (0, Q._)`{}`);
  });
}
function ph(e) {
  const { schema: t, opts: r, gen: n } = e;
  Dl(e, () => {
    r.$comment && t.$comment && Ul(e), _h(e), n.let(ne.default.vErrors, null), n.let(ne.default.errors, 0), r.unevaluated && mh(e), Vl(e), wh(e);
  });
}
function mh(e) {
  const { gen: t, validateName: r } = e;
  e.evaluated = t.const("evaluated", (0, Q._)`${r}.evaluated`), t.if((0, Q._)`${e.evaluated}.dynamicProps`, () => t.assign((0, Q._)`${e.evaluated}.props`, (0, Q._)`undefined`)), t.if((0, Q._)`${e.evaluated}.dynamicItems`, () => t.assign((0, Q._)`${e.evaluated}.items`, (0, Q._)`undefined`));
}
function zi(e, t) {
  const r = typeof e == "object" && e[t.schemaId];
  return r && (t.code.source || t.code.process) ? (0, Q._)`/*# sourceURL=${r} */` : Q.nil;
}
function yh(e, t) {
  if (Ll(e) && (Fl(e), Ml(e))) {
    $h(e, t);
    return;
  }
  (0, kl.boolOrEmptySchema)(e, t);
}
function Ml({ schema: e, self: t }) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (t.RULES.all[r])
      return !0;
  return !1;
}
function Ll(e) {
  return typeof e.schema != "boolean";
}
function $h(e, t) {
  const { schema: r, gen: n, opts: s } = e;
  s.$comment && r.$comment && Ul(e), vh(e), Eh(e);
  const o = n.const("_errs", ne.default.errors);
  Vl(e, o), n.var(t, (0, Q._)`${o} === ${ne.default.errors}`);
}
function Fl(e) {
  (0, Ct.checkUnknownRules)(e), gh(e);
}
function Vl(e, t) {
  if (e.opts.jtd)
    return qi(e, [], !1, t);
  const r = (0, Ui.getSchemaTypes)(e.schema), n = (0, Ui.coerceAndCheckDataType)(e, r);
  qi(e, r, !n, t);
}
function gh(e) {
  const { schema: t, errSchemaPath: r, opts: n, self: s } = e;
  t.$ref && n.ignoreKeywordsWithRef && (0, Ct.schemaHasRulesButRef)(t, s.RULES) && s.logger.warn(`$ref: keywords ignored in schema at path "${r}"`);
}
function _h(e) {
  const { schema: t, opts: r } = e;
  t.default !== void 0 && r.useDefaults && r.strictSchema && (0, Ct.checkStrictMode)(e, "default is ignored in the schema root");
}
function vh(e) {
  const t = e.schema[e.opts.schemaId];
  t && (e.baseId = (0, uh.resolveUrl)(e.opts.uriResolver, e.baseId, t));
}
function Eh(e) {
  if (e.schema.$async && !e.schemaEnv.$async)
    throw new Error("async schema in sync schema");
}
function Ul({ gen: e, schemaEnv: t, schema: r, errSchemaPath: n, opts: s }) {
  const o = r.$comment;
  if (s.$comment === !0)
    e.code((0, Q._)`${ne.default.self}.logger.log(${o})`);
  else if (typeof s.$comment == "function") {
    const a = (0, Q.str)`${n}/$comment`, i = e.scopeValue("root", { ref: t.root });
    e.code((0, Q._)`${ne.default.self}.opts.$comment(${o}, ${a}, ${i}.schema)`);
  }
}
function wh(e) {
  const { gen: t, schemaEnv: r, validateName: n, ValidationError: s, opts: o } = e;
  r.$async ? t.if((0, Q._)`${ne.default.errors} === 0`, () => t.return(ne.default.data), () => t.throw((0, Q._)`new ${s}(${ne.default.vErrors})`)) : (t.assign((0, Q._)`${n}.errors`, ne.default.vErrors), o.unevaluated && Sh(e), t.return((0, Q._)`${ne.default.errors} === 0`));
}
function Sh({ gen: e, evaluated: t, props: r, items: n }) {
  r instanceof Q.Name && e.assign((0, Q._)`${t}.props`, r), n instanceof Q.Name && e.assign((0, Q._)`${t}.items`, n);
}
function qi(e, t, r, n) {
  const { gen: s, schema: o, data: a, allErrors: i, opts: c, self: d } = e, { RULES: u } = d;
  if (o.$ref && (c.ignoreKeywordsWithRef || !(0, Ct.schemaHasRulesButRef)(o, u))) {
    s.block(() => Gl(e, "$ref", u.all.$ref.definition));
    return;
  }
  c.jtd || bh(e, t), s.block(() => {
    for (const g of u.rules)
      f(g);
    f(u.post);
  });
  function f(g) {
    (0, zo.shouldUseGroup)(o, g) && (g.type ? (s.if((0, rs.checkDataType)(g.type, a, c.strictNumbers)), Gi(e, g), t.length === 1 && t[0] === g.type && r && (s.else(), (0, rs.reportTypeError)(e)), s.endIf()) : Gi(e, g), i || s.if((0, Q._)`${ne.default.errors} === ${n || 0}`));
  }
}
function Gi(e, t) {
  const { gen: r, schema: n, opts: { useDefaults: s } } = e;
  s && (0, lh.assignDefaults)(e, t.type), r.block(() => {
    for (const o of t.rules)
      (0, zo.shouldUseRule)(n, o) && Gl(e, o.keyword, o.definition, t.type);
  });
}
function bh(e, t) {
  e.schemaEnv.meta || !e.opts.strictTypes || (Ph(e, t), e.opts.allowUnionTypes || Nh(e, t), Rh(e, e.dataTypes));
}
function Ph(e, t) {
  if (t.length) {
    if (!e.dataTypes.length) {
      e.dataTypes = t;
      return;
    }
    t.forEach((r) => {
      zl(e.dataTypes, r) || qo(e, `type "${r}" not allowed by context "${e.dataTypes.join(",")}"`);
    }), Oh(e, t);
  }
}
function Nh(e, t) {
  t.length > 1 && !(t.length === 2 && t.includes("null")) && qo(e, "use allowUnionTypes to allow union type keyword");
}
function Rh(e, t) {
  const r = e.self.RULES.all;
  for (const n in r) {
    const s = r[n];
    if (typeof s == "object" && (0, zo.shouldUseRule)(e.schema, s)) {
      const { type: o } = s.definition;
      o.length && !o.some((a) => Th(t, a)) && qo(e, `missing type "${o.join(",")}" for keyword "${n}"`);
    }
  }
}
function Th(e, t) {
  return e.includes(t) || t === "number" && e.includes("integer");
}
function zl(e, t) {
  return e.includes(t) || t === "integer" && e.includes("number");
}
function Oh(e, t) {
  const r = [];
  for (const n of e.dataTypes)
    zl(t, n) ? r.push(n) : t.includes("integer") && n === "number" && r.push("integer");
  e.dataTypes = r;
}
function qo(e, t) {
  const r = e.schemaEnv.baseId + e.errSchemaPath;
  t += ` at "${r}" (strictTypes)`, (0, Ct.checkStrictMode)(e, t, e.opts.strictTypes);
}
class ql {
  constructor(t, r, n) {
    if ((0, nn.validateKeywordUsage)(t, r, n), this.gen = t.gen, this.allErrors = t.allErrors, this.keyword = n, this.data = t.data, this.schema = t.schema[n], this.$data = r.$data && t.opts.$data && this.schema && this.schema.$data, this.schemaValue = (0, Ct.schemaRefOrVal)(t, this.schema, n, this.$data), this.schemaType = r.schemaType, this.parentSchema = t.schema, this.params = {}, this.it = t, this.def = r, this.$data)
      this.schemaCode = t.gen.const("vSchema", Kl(this.$data, t));
    else if (this.schemaCode = this.schemaValue, !(0, nn.validSchemaType)(this.schema, r.schemaType, r.allowUndefined))
      throw new Error(`${n} value must be ${JSON.stringify(r.schemaType)}`);
    ("code" in r ? r.trackErrors : r.errors !== !1) && (this.errsCount = t.gen.const("_errs", ne.default.errors));
  }
  result(t, r, n) {
    this.failResult((0, Q.not)(t), r, n);
  }
  failResult(t, r, n) {
    this.gen.if(t), n ? n() : this.error(), r ? (this.gen.else(), r(), this.allErrors && this.gen.endIf()) : this.allErrors ? this.gen.endIf() : this.gen.else();
  }
  pass(t, r) {
    this.failResult((0, Q.not)(t), void 0, r);
  }
  fail(t) {
    if (t === void 0) {
      this.error(), this.allErrors || this.gen.if(!1);
      return;
    }
    this.gen.if(t), this.error(), this.allErrors ? this.gen.endIf() : this.gen.else();
  }
  fail$data(t) {
    if (!this.$data)
      return this.fail(t);
    const { schemaCode: r } = this;
    this.fail((0, Q._)`${r} !== undefined && (${(0, Q.or)(this.invalid$data(), t)})`);
  }
  error(t, r, n) {
    if (r) {
      this.setParams(r), this._error(t, n), this.setParams({});
      return;
    }
    this._error(t, n);
  }
  _error(t, r) {
    (t ? Jr.reportExtraError : Jr.reportError)(this, this.def.error, r);
  }
  $dataError() {
    (0, Jr.reportError)(this, this.def.$dataError || Jr.keyword$DataError);
  }
  reset() {
    if (this.errsCount === void 0)
      throw new Error('add "trackErrors" to keyword definition');
    (0, Jr.resetErrorsCount)(this.gen, this.errsCount);
  }
  ok(t) {
    this.allErrors || this.gen.if(t);
  }
  setParams(t, r) {
    r ? Object.assign(this.params, t) : this.params = t;
  }
  block$data(t, r, n = Q.nil) {
    this.gen.block(() => {
      this.check$data(t, n), r();
    });
  }
  check$data(t = Q.nil, r = Q.nil) {
    if (!this.$data)
      return;
    const { gen: n, schemaCode: s, schemaType: o, def: a } = this;
    n.if((0, Q.or)((0, Q._)`${s} === undefined`, r)), t !== Q.nil && n.assign(t, !0), (o.length || a.validateSchema) && (n.elseIf(this.invalid$data()), this.$dataError(), t !== Q.nil && n.assign(t, !1)), n.else();
  }
  invalid$data() {
    const { gen: t, schemaCode: r, schemaType: n, def: s, it: o } = this;
    return (0, Q.or)(a(), i());
    function a() {
      if (n.length) {
        if (!(r instanceof Q.Name))
          throw new Error("ajv implementation error");
        const c = Array.isArray(n) ? n : [n];
        return (0, Q._)`${(0, rs.checkDataTypes)(c, r, o.opts.strictNumbers, rs.DataType.Wrong)}`;
      }
      return Q.nil;
    }
    function i() {
      if (s.validateSchema) {
        const c = t.scopeValue("validate$data", { ref: s.validateSchema });
        return (0, Q._)`!${c}(${r})`;
      }
      return Q.nil;
    }
  }
  subschema(t, r) {
    const n = (0, Gs.getSubschema)(this.it, t);
    (0, Gs.extendSubschemaData)(n, this.it, t), (0, Gs.extendSubschemaMode)(n, t);
    const s = { ...this.it, ...n, items: void 0, props: void 0 };
    return yh(s, r), s;
  }
  mergeEvaluated(t, r) {
    const { it: n, gen: s } = this;
    n.opts.unevaluated && (n.props !== !0 && t.props !== void 0 && (n.props = Ct.mergeEvaluated.props(s, t.props, n.props, r)), n.items !== !0 && t.items !== void 0 && (n.items = Ct.mergeEvaluated.items(s, t.items, n.items, r)));
  }
  mergeValidEvaluated(t, r) {
    const { it: n, gen: s } = this;
    if (n.opts.unevaluated && (n.props !== !0 || n.items !== !0))
      return s.if(r, () => this.mergeEvaluated(t, Q.Name)), !0;
  }
}
pt.KeywordCxt = ql;
function Gl(e, t, r, n) {
  const s = new ql(e, r, t);
  "code" in r ? r.code(s, n) : s.$data && r.validate ? (0, nn.funcKeywordCode)(s, r) : "macro" in r ? (0, nn.macroKeywordCode)(s, r) : (r.compile || r.validate) && (0, nn.funcKeywordCode)(s, r);
}
const Ih = /^\/(?:[^~]|~0|~1)*$/, jh = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
function Kl(e, { dataLevel: t, dataNames: r, dataPathArr: n }) {
  let s, o;
  if (e === "")
    return ne.default.rootData;
  if (e[0] === "/") {
    if (!Ih.test(e))
      throw new Error(`Invalid JSON-pointer: ${e}`);
    s = e, o = ne.default.rootData;
  } else {
    const d = jh.exec(e);
    if (!d)
      throw new Error(`Invalid JSON-pointer: ${e}`);
    const u = +d[1];
    if (s = d[2], s === "#") {
      if (u >= t)
        throw new Error(c("property/index", u));
      return n[t - u];
    }
    if (u > t)
      throw new Error(c("data", u));
    if (o = r[t - u], !s)
      return o;
  }
  let a = o;
  const i = s.split("/");
  for (const d of i)
    d && (o = (0, Q._)`${o}${(0, Q.getProperty)((0, Ct.unescapeJsonPointer)(d))}`, a = (0, Q._)`${a} && ${o}`);
  return a;
  function c(d, u) {
    return `Cannot access ${d} ${u} levels up, current level is ${t}`;
  }
}
pt.getData = Kl;
var yn = {};
Object.defineProperty(yn, "__esModule", { value: !0 });
let Ah = class extends Error {
  constructor(t) {
    super("validation failed"), this.errors = t, this.ajv = this.validation = !0;
  }
};
yn.default = Ah;
var Mr = {};
Object.defineProperty(Mr, "__esModule", { value: !0 });
const Ks = ke;
class Ch extends Error {
  constructor(t, r, n, s) {
    super(s || `can't resolve reference ${n} from id ${r}`), this.missingRef = (0, Ks.resolveUrl)(t, r, n), this.missingSchema = (0, Ks.normalizeId)((0, Ks.getFullPath)(t, this.missingRef));
  }
}
Mr.default = Ch;
var We = {};
Object.defineProperty(We, "__esModule", { value: !0 });
We.resolveSchema = We.getCompilingSchema = We.resolveRef = We.compileSchema = We.SchemaEnv = void 0;
const at = ae, kh = yn, nr = tt, ft = ke, Ki = K, Dh = pt;
let ys = class {
  constructor(t) {
    var r;
    this.refs = {}, this.dynamicAnchors = {};
    let n;
    typeof t.schema == "object" && (n = t.schema), this.schema = t.schema, this.schemaId = t.schemaId, this.root = t.root || this, this.baseId = (r = t.baseId) !== null && r !== void 0 ? r : (0, ft.normalizeId)(n == null ? void 0 : n[t.schemaId || "$id"]), this.schemaPath = t.schemaPath, this.localRefs = t.localRefs, this.meta = t.meta, this.$async = n == null ? void 0 : n.$async, this.refs = {};
  }
};
We.SchemaEnv = ys;
function Go(e) {
  const t = Hl.call(this, e);
  if (t)
    return t;
  const r = (0, ft.getFullPath)(this.opts.uriResolver, e.root.baseId), { es5: n, lines: s } = this.opts.code, { ownProperties: o } = this.opts, a = new at.CodeGen(this.scope, { es5: n, lines: s, ownProperties: o });
  let i;
  e.$async && (i = a.scopeValue("Error", {
    ref: kh.default,
    code: (0, at._)`require("ajv/dist/runtime/validation_error").default`
  }));
  const c = a.scopeName("validate");
  e.validateName = c;
  const d = {
    gen: a,
    allErrors: this.opts.allErrors,
    data: nr.default.data,
    parentData: nr.default.parentData,
    parentDataProperty: nr.default.parentDataProperty,
    dataNames: [nr.default.data],
    dataPathArr: [at.nil],
    // TODO can its length be used as dataLevel if nil is removed?
    dataLevel: 0,
    dataTypes: [],
    definedProperties: /* @__PURE__ */ new Set(),
    topSchemaRef: a.scopeValue("schema", this.opts.code.source === !0 ? { ref: e.schema, code: (0, at.stringify)(e.schema) } : { ref: e.schema }),
    validateName: c,
    ValidationError: i,
    schema: e.schema,
    schemaEnv: e,
    rootId: r,
    baseId: e.baseId || r,
    schemaPath: at.nil,
    errSchemaPath: e.schemaPath || (this.opts.jtd ? "" : "#"),
    errorPath: (0, at._)`""`,
    opts: this.opts,
    self: this
  };
  let u;
  try {
    this._compilations.add(e), (0, Dh.validateFunctionCode)(d), a.optimize(this.opts.code.optimize);
    const f = a.toString();
    u = `${a.scopeRefs(nr.default.scope)}return ${f}`, this.opts.code.process && (u = this.opts.code.process(u, e));
    const m = new Function(`${nr.default.self}`, `${nr.default.scope}`, u)(this, this.scope.get());
    if (this.scope.value(c, { ref: m }), m.errors = null, m.schema = e.schema, m.schemaEnv = e, e.$async && (m.$async = !0), this.opts.code.source === !0 && (m.source = { validateName: c, validateCode: f, scopeValues: a._values }), this.opts.unevaluated) {
      const { props: v, items: $ } = d;
      m.evaluated = {
        props: v instanceof at.Name ? void 0 : v,
        items: $ instanceof at.Name ? void 0 : $,
        dynamicProps: v instanceof at.Name,
        dynamicItems: $ instanceof at.Name
      }, m.source && (m.source.evaluated = (0, at.stringify)(m.evaluated));
    }
    return e.validate = m, e;
  } catch (f) {
    throw delete e.validate, delete e.validateName, u && this.logger.error("Error compiling schema, function code:", u), f;
  } finally {
    this._compilations.delete(e);
  }
}
We.compileSchema = Go;
function Mh(e, t, r) {
  var n;
  r = (0, ft.resolveUrl)(this.opts.uriResolver, t, r);
  const s = e.refs[r];
  if (s)
    return s;
  let o = Vh.call(this, e, r);
  if (o === void 0) {
    const a = (n = e.localRefs) === null || n === void 0 ? void 0 : n[r], { schemaId: i } = this.opts;
    a && (o = new ys({ schema: a, schemaId: i, root: e, baseId: t }));
  }
  if (o !== void 0)
    return e.refs[r] = Lh.call(this, o);
}
We.resolveRef = Mh;
function Lh(e) {
  return (0, ft.inlineRef)(e.schema, this.opts.inlineRefs) ? e.schema : e.validate ? e : Go.call(this, e);
}
function Hl(e) {
  for (const t of this._compilations)
    if (Fh(t, e))
      return t;
}
We.getCompilingSchema = Hl;
function Fh(e, t) {
  return e.schema === t.schema && e.root === t.root && e.baseId === t.baseId;
}
function Vh(e, t) {
  let r;
  for (; typeof (r = this.refs[t]) == "string"; )
    t = r;
  return r || this.schemas[t] || $s.call(this, e, t);
}
function $s(e, t) {
  const r = this.opts.uriResolver.parse(t), n = (0, ft._getFullPath)(this.opts.uriResolver, r);
  let s = (0, ft.getFullPath)(this.opts.uriResolver, e.baseId, void 0);
  if (Object.keys(e.schema).length > 0 && n === s)
    return Hs.call(this, r, e);
  const o = (0, ft.normalizeId)(n), a = this.refs[o] || this.schemas[o];
  if (typeof a == "string") {
    const i = $s.call(this, e, a);
    return typeof (i == null ? void 0 : i.schema) != "object" ? void 0 : Hs.call(this, r, i);
  }
  if (typeof (a == null ? void 0 : a.schema) == "object") {
    if (a.validate || Go.call(this, a), o === (0, ft.normalizeId)(t)) {
      const { schema: i } = a, { schemaId: c } = this.opts, d = i[c];
      return d && (s = (0, ft.resolveUrl)(this.opts.uriResolver, s, d)), new ys({ schema: i, schemaId: c, root: e, baseId: s });
    }
    return Hs.call(this, r, a);
  }
}
We.resolveSchema = $s;
const Uh = /* @__PURE__ */ new Set([
  "properties",
  "patternProperties",
  "enum",
  "dependencies",
  "definitions"
]);
function Hs(e, { baseId: t, schema: r, root: n }) {
  var s;
  if (((s = e.fragment) === null || s === void 0 ? void 0 : s[0]) !== "/")
    return;
  for (const i of e.fragment.slice(1).split("/")) {
    if (typeof r == "boolean")
      return;
    const c = r[(0, Ki.unescapeFragment)(i)];
    if (c === void 0)
      return;
    r = c;
    const d = typeof r == "object" && r[this.opts.schemaId];
    !Uh.has(i) && d && (t = (0, ft.resolveUrl)(this.opts.uriResolver, t, d));
  }
  let o;
  if (typeof r != "boolean" && r.$ref && !(0, Ki.schemaHasRulesButRef)(r, this.RULES)) {
    const i = (0, ft.resolveUrl)(this.opts.uriResolver, t, r.$ref);
    o = $s.call(this, n, i);
  }
  const { schemaId: a } = this.opts;
  if (o = o || new ys({ schema: r, schemaId: a, root: n, baseId: t }), o.schema !== o.root.schema)
    return o;
}
const zh = "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#", qh = "Meta-schema for $data reference (JSON AnySchema extension proposal)", Gh = "object", Kh = [
  "$data"
], Hh = {
  $data: {
    type: "string",
    anyOf: [
      {
        format: "relative-json-pointer"
      },
      {
        format: "json-pointer"
      }
    ]
  }
}, Bh = !1, Wh = {
  $id: zh,
  description: qh,
  type: Gh,
  required: Kh,
  properties: Hh,
  additionalProperties: Bh
};
var Ko = {}, gs = { exports: {} };
const Jh = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu), Bl = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
function Wl(e) {
  let t = "", r = 0, n = 0;
  for (n = 0; n < e.length; n++)
    if (r = e[n].charCodeAt(0), r !== 48) {
      if (!(r >= 48 && r <= 57 || r >= 65 && r <= 70 || r >= 97 && r <= 102))
        return "";
      t += e[n];
      break;
    }
  for (n += 1; n < e.length; n++) {
    if (r = e[n].charCodeAt(0), !(r >= 48 && r <= 57 || r >= 65 && r <= 70 || r >= 97 && r <= 102))
      return "";
    t += e[n];
  }
  return t;
}
const Xh = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
function Hi(e) {
  return e.length = 0, !0;
}
function Yh(e, t, r) {
  if (e.length) {
    const n = Wl(e);
    if (n !== "")
      t.push(n);
    else
      return r.error = !0, !1;
    e.length = 0;
  }
  return !0;
}
function xh(e) {
  let t = 0;
  const r = { error: !1, address: "", zone: "" }, n = [], s = [];
  let o = !1, a = !1, i = Yh;
  for (let c = 0; c < e.length; c++) {
    const d = e[c];
    if (!(d === "[" || d === "]"))
      if (d === ":") {
        if (o === !0 && (a = !0), !i(s, n, r))
          break;
        if (++t > 7) {
          r.error = !0;
          break;
        }
        c > 0 && e[c - 1] === ":" && (o = !0), n.push(":");
        continue;
      } else if (d === "%") {
        if (!i(s, n, r))
          break;
        i = Hi;
      } else {
        s.push(d);
        continue;
      }
  }
  return s.length && (i === Hi ? r.zone = s.join("") : a ? n.push(s.join("")) : n.push(Wl(s))), r.address = n.join(""), r;
}
function Jl(e) {
  if (Qh(e, ":") < 2)
    return { host: e, isIPV6: !1 };
  const t = xh(e);
  if (t.error)
    return { host: e, isIPV6: !1 };
  {
    let r = t.address, n = t.address;
    return t.zone && (r += "%" + t.zone, n += "%25" + t.zone), { host: r, isIPV6: !0, escapedHost: n };
  }
}
function Qh(e, t) {
  let r = 0;
  for (let n = 0; n < e.length; n++)
    e[n] === t && r++;
  return r;
}
function Zh(e) {
  let t = e;
  const r = [];
  let n = -1, s = 0;
  for (; s = t.length; ) {
    if (s === 1) {
      if (t === ".")
        break;
      if (t === "/") {
        r.push("/");
        break;
      } else {
        r.push(t);
        break;
      }
    } else if (s === 2) {
      if (t[0] === ".") {
        if (t[1] === ".")
          break;
        if (t[1] === "/") {
          t = t.slice(2);
          continue;
        }
      } else if (t[0] === "/" && (t[1] === "." || t[1] === "/")) {
        r.push("/");
        break;
      }
    } else if (s === 3 && t === "/..") {
      r.length !== 0 && r.pop(), r.push("/");
      break;
    }
    if (t[0] === ".") {
      if (t[1] === ".") {
        if (t[2] === "/") {
          t = t.slice(3);
          continue;
        }
      } else if (t[1] === "/") {
        t = t.slice(2);
        continue;
      }
    } else if (t[0] === "/" && t[1] === ".") {
      if (t[2] === "/") {
        t = t.slice(2);
        continue;
      } else if (t[2] === "." && t[3] === "/") {
        t = t.slice(3), r.length !== 0 && r.pop();
        continue;
      }
    }
    if ((n = t.indexOf("/", 1)) === -1) {
      r.push(t);
      break;
    } else
      r.push(t.slice(0, n)), t = t.slice(n);
  }
  return r.join("");
}
function ep(e, t) {
  const r = t !== !0 ? escape : unescape;
  return e.scheme !== void 0 && (e.scheme = r(e.scheme)), e.userinfo !== void 0 && (e.userinfo = r(e.userinfo)), e.host !== void 0 && (e.host = r(e.host)), e.path !== void 0 && (e.path = r(e.path)), e.query !== void 0 && (e.query = r(e.query)), e.fragment !== void 0 && (e.fragment = r(e.fragment)), e;
}
function tp(e) {
  const t = [];
  if (e.userinfo !== void 0 && (t.push(e.userinfo), t.push("@")), e.host !== void 0) {
    let r = unescape(e.host);
    if (!Bl(r)) {
      const n = Jl(r);
      n.isIPV6 === !0 ? r = `[${n.escapedHost}]` : r = e.host;
    }
    t.push(r);
  }
  return (typeof e.port == "number" || typeof e.port == "string") && (t.push(":"), t.push(String(e.port))), t.length ? t.join("") : void 0;
}
var Xl = {
  nonSimpleDomain: Xh,
  recomposeAuthority: tp,
  normalizeComponentEncoding: ep,
  removeDotSegments: Zh,
  isIPv4: Bl,
  isUUID: Jh,
  normalizeIPv6: Jl
};
const { isUUID: rp } = Xl, np = /([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-.:;=@]|%[\da-f]{2})+)/iu;
function Yl(e) {
  return e.secure === !0 ? !0 : e.secure === !1 ? !1 : e.scheme ? e.scheme.length === 3 && (e.scheme[0] === "w" || e.scheme[0] === "W") && (e.scheme[1] === "s" || e.scheme[1] === "S") && (e.scheme[2] === "s" || e.scheme[2] === "S") : !1;
}
function xl(e) {
  return e.host || (e.error = e.error || "HTTP URIs must have a host."), e;
}
function Ql(e) {
  const t = String(e.scheme).toLowerCase() === "https";
  return (e.port === (t ? 443 : 80) || e.port === "") && (e.port = void 0), e.path || (e.path = "/"), e;
}
function sp(e) {
  return e.secure = Yl(e), e.resourceName = (e.path || "/") + (e.query ? "?" + e.query : ""), e.path = void 0, e.query = void 0, e;
}
function op(e) {
  if ((e.port === (Yl(e) ? 443 : 80) || e.port === "") && (e.port = void 0), typeof e.secure == "boolean" && (e.scheme = e.secure ? "wss" : "ws", e.secure = void 0), e.resourceName) {
    const [t, r] = e.resourceName.split("?");
    e.path = t && t !== "/" ? t : void 0, e.query = r, e.resourceName = void 0;
  }
  return e.fragment = void 0, e;
}
function ap(e, t) {
  if (!e.path)
    return e.error = "URN can not be parsed", e;
  const r = e.path.match(np);
  if (r) {
    const n = t.scheme || e.scheme || "urn";
    e.nid = r[1].toLowerCase(), e.nss = r[2];
    const s = `${n}:${t.nid || e.nid}`, o = Ho(s);
    e.path = void 0, o && (e = o.parse(e, t));
  } else
    e.error = e.error || "URN can not be parsed.";
  return e;
}
function ip(e, t) {
  if (e.nid === void 0)
    throw new Error("URN without nid cannot be serialized");
  const r = t.scheme || e.scheme || "urn", n = e.nid.toLowerCase(), s = `${r}:${t.nid || n}`, o = Ho(s);
  o && (e = o.serialize(e, t));
  const a = e, i = e.nss;
  return a.path = `${n || t.nid}:${i}`, t.skipEscape = !0, a;
}
function cp(e, t) {
  const r = e;
  return r.uuid = r.nss, r.nss = void 0, !t.tolerant && (!r.uuid || !rp(r.uuid)) && (r.error = r.error || "UUID is not valid."), r;
}
function lp(e) {
  const t = e;
  return t.nss = (e.uuid || "").toLowerCase(), t;
}
const Zl = (
  /** @type {SchemeHandler} */
  {
    scheme: "http",
    domainHost: !0,
    parse: xl,
    serialize: Ql
  }
), up = (
  /** @type {SchemeHandler} */
  {
    scheme: "https",
    domainHost: Zl.domainHost,
    parse: xl,
    serialize: Ql
  }
), Wn = (
  /** @type {SchemeHandler} */
  {
    scheme: "ws",
    domainHost: !0,
    parse: sp,
    serialize: op
  }
), dp = (
  /** @type {SchemeHandler} */
  {
    scheme: "wss",
    domainHost: Wn.domainHost,
    parse: Wn.parse,
    serialize: Wn.serialize
  }
), fp = (
  /** @type {SchemeHandler} */
  {
    scheme: "urn",
    parse: ap,
    serialize: ip,
    skipNormalize: !0
  }
), hp = (
  /** @type {SchemeHandler} */
  {
    scheme: "urn:uuid",
    parse: cp,
    serialize: lp,
    skipNormalize: !0
  }
), ns = (
  /** @type {Record<SchemeName, SchemeHandler>} */
  {
    http: Zl,
    https: up,
    ws: Wn,
    wss: dp,
    urn: fp,
    "urn:uuid": hp
  }
);
Object.setPrototypeOf(ns, null);
function Ho(e) {
  return e && (ns[
    /** @type {SchemeName} */
    e
  ] || ns[
    /** @type {SchemeName} */
    e.toLowerCase()
  ]) || void 0;
}
var pp = {
  SCHEMES: ns,
  getSchemeHandler: Ho
};
const { normalizeIPv6: mp, removeDotSegments: Zr, recomposeAuthority: yp, normalizeComponentEncoding: Pn, isIPv4: $p, nonSimpleDomain: gp } = Xl, { SCHEMES: _p, getSchemeHandler: eu } = pp;
function vp(e, t) {
  return typeof e == "string" ? e = /** @type {T} */
  Pt(kt(e, t), t) : typeof e == "object" && (e = /** @type {T} */
  kt(Pt(e, t), t)), e;
}
function Ep(e, t, r) {
  const n = r ? Object.assign({ scheme: "null" }, r) : { scheme: "null" }, s = tu(kt(e, n), kt(t, n), n, !0);
  return n.skipEscape = !0, Pt(s, n);
}
function tu(e, t, r, n) {
  const s = {};
  return n || (e = kt(Pt(e, r), r), t = kt(Pt(t, r), r)), r = r || {}, !r.tolerant && t.scheme ? (s.scheme = t.scheme, s.userinfo = t.userinfo, s.host = t.host, s.port = t.port, s.path = Zr(t.path || ""), s.query = t.query) : (t.userinfo !== void 0 || t.host !== void 0 || t.port !== void 0 ? (s.userinfo = t.userinfo, s.host = t.host, s.port = t.port, s.path = Zr(t.path || ""), s.query = t.query) : (t.path ? (t.path[0] === "/" ? s.path = Zr(t.path) : ((e.userinfo !== void 0 || e.host !== void 0 || e.port !== void 0) && !e.path ? s.path = "/" + t.path : e.path ? s.path = e.path.slice(0, e.path.lastIndexOf("/") + 1) + t.path : s.path = t.path, s.path = Zr(s.path)), s.query = t.query) : (s.path = e.path, t.query !== void 0 ? s.query = t.query : s.query = e.query), s.userinfo = e.userinfo, s.host = e.host, s.port = e.port), s.scheme = e.scheme), s.fragment = t.fragment, s;
}
function wp(e, t, r) {
  return typeof e == "string" ? (e = unescape(e), e = Pt(Pn(kt(e, r), !0), { ...r, skipEscape: !0 })) : typeof e == "object" && (e = Pt(Pn(e, !0), { ...r, skipEscape: !0 })), typeof t == "string" ? (t = unescape(t), t = Pt(Pn(kt(t, r), !0), { ...r, skipEscape: !0 })) : typeof t == "object" && (t = Pt(Pn(t, !0), { ...r, skipEscape: !0 })), e.toLowerCase() === t.toLowerCase();
}
function Pt(e, t) {
  const r = {
    host: e.host,
    scheme: e.scheme,
    userinfo: e.userinfo,
    port: e.port,
    path: e.path,
    query: e.query,
    nid: e.nid,
    nss: e.nss,
    uuid: e.uuid,
    fragment: e.fragment,
    reference: e.reference,
    resourceName: e.resourceName,
    secure: e.secure,
    error: ""
  }, n = Object.assign({}, t), s = [], o = eu(n.scheme || r.scheme);
  o && o.serialize && o.serialize(r, n), r.path !== void 0 && (n.skipEscape ? r.path = unescape(r.path) : (r.path = escape(r.path), r.scheme !== void 0 && (r.path = r.path.split("%3A").join(":")))), n.reference !== "suffix" && r.scheme && s.push(r.scheme, ":");
  const a = yp(r);
  if (a !== void 0 && (n.reference !== "suffix" && s.push("//"), s.push(a), r.path && r.path[0] !== "/" && s.push("/")), r.path !== void 0) {
    let i = r.path;
    !n.absolutePath && (!o || !o.absolutePath) && (i = Zr(i)), a === void 0 && i[0] === "/" && i[1] === "/" && (i = "/%2F" + i.slice(2)), s.push(i);
  }
  return r.query !== void 0 && s.push("?", r.query), r.fragment !== void 0 && s.push("#", r.fragment), s.join("");
}
const Sp = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
function kt(e, t) {
  const r = Object.assign({}, t), n = {
    scheme: void 0,
    userinfo: void 0,
    host: "",
    port: void 0,
    path: "",
    query: void 0,
    fragment: void 0
  };
  let s = !1;
  r.reference === "suffix" && (r.scheme ? e = r.scheme + ":" + e : e = "//" + e);
  const o = e.match(Sp);
  if (o) {
    if (n.scheme = o[1], n.userinfo = o[3], n.host = o[4], n.port = parseInt(o[5], 10), n.path = o[6] || "", n.query = o[7], n.fragment = o[8], isNaN(n.port) && (n.port = o[5]), n.host)
      if ($p(n.host) === !1) {
        const c = mp(n.host);
        n.host = c.host.toLowerCase(), s = c.isIPV6;
      } else
        s = !0;
    n.scheme === void 0 && n.userinfo === void 0 && n.host === void 0 && n.port === void 0 && n.query === void 0 && !n.path ? n.reference = "same-document" : n.scheme === void 0 ? n.reference = "relative" : n.fragment === void 0 ? n.reference = "absolute" : n.reference = "uri", r.reference && r.reference !== "suffix" && r.reference !== n.reference && (n.error = n.error || "URI is not a " + r.reference + " reference.");
    const a = eu(r.scheme || n.scheme);
    if (!r.unicodeSupport && (!a || !a.unicodeSupport) && n.host && (r.domainHost || a && a.domainHost) && s === !1 && gp(n.host))
      try {
        n.host = URL.domainToASCII(n.host.toLowerCase());
      } catch (i) {
        n.error = n.error || "Host's domain name can not be converted to ASCII: " + i;
      }
    (!a || a && !a.skipNormalize) && (e.indexOf("%") !== -1 && (n.scheme !== void 0 && (n.scheme = unescape(n.scheme)), n.host !== void 0 && (n.host = unescape(n.host))), n.path && (n.path = escape(unescape(n.path))), n.fragment && (n.fragment = encodeURI(decodeURIComponent(n.fragment)))), a && a.parse && a.parse(n, r);
  } else
    n.error = n.error || "URI can not be parsed.";
  return n;
}
const Bo = {
  SCHEMES: _p,
  normalize: vp,
  resolve: Ep,
  resolveComponent: tu,
  equal: wp,
  serialize: Pt,
  parse: kt
};
gs.exports = Bo;
gs.exports.default = Bo;
gs.exports.fastUri = Bo;
var ru = gs.exports;
Object.defineProperty(Ko, "__esModule", { value: !0 });
const nu = ru;
nu.code = 'require("ajv/dist/runtime/uri").default';
Ko.default = nu;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.CodeGen = e.Name = e.nil = e.stringify = e.str = e._ = e.KeywordCxt = void 0;
  var t = pt;
  Object.defineProperty(e, "KeywordCxt", { enumerable: !0, get: function() {
    return t.KeywordCxt;
  } });
  var r = ae;
  Object.defineProperty(e, "_", { enumerable: !0, get: function() {
    return r._;
  } }), Object.defineProperty(e, "str", { enumerable: !0, get: function() {
    return r.str;
  } }), Object.defineProperty(e, "stringify", { enumerable: !0, get: function() {
    return r.stringify;
  } }), Object.defineProperty(e, "nil", { enumerable: !0, get: function() {
    return r.nil;
  } }), Object.defineProperty(e, "Name", { enumerable: !0, get: function() {
    return r.Name;
  } }), Object.defineProperty(e, "CodeGen", { enumerable: !0, get: function() {
    return r.CodeGen;
  } });
  const n = yn, s = Mr, o = yr, a = We, i = ae, c = ke, d = Re, u = K, f = Wh, g = Ko, m = (N, y) => new RegExp(N, y);
  m.code = "new RegExp";
  const v = ["removeAdditional", "useDefaults", "coerceTypes"], $ = /* @__PURE__ */ new Set([
    "validate",
    "serialize",
    "parse",
    "wrapper",
    "root",
    "schema",
    "keyword",
    "pattern",
    "formats",
    "validate$data",
    "func",
    "obj",
    "Error"
  ]), _ = {
    errorDataPath: "",
    format: "`validateFormats: false` can be used instead.",
    nullable: '"nullable" keyword is supported by default.',
    jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
    extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
    missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
    processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
    sourceCode: "Use option `code: {source: true}`",
    strictDefaults: "It is default now, see option `strict`.",
    strictKeywords: "It is default now, see option `strict`.",
    uniqueItems: '"uniqueItems" keyword is always validated.',
    unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
    cache: "Map is used as cache, schema object as key.",
    serialize: "Map is used as cache, schema object as key.",
    ajvErrors: "It is default now."
  }, p = {
    ignoreKeywordsWithRef: "",
    jsPropertySyntax: "",
    unicode: '"minLength"/"maxLength" account for unicode characters by default.'
  }, w = 200;
  function P(N) {
    var y, S, E, l, h, b, A, k, X, J, R, O, D, F, Y, se, Ee, Ke, Oe, Ie, we, gt, Me, Qt, Zt;
    const ot = N.strict, er = (y = N.code) === null || y === void 0 ? void 0 : y.optimize, Kr = er === !0 || er === void 0 ? 1 : er || 0, Hr = (E = (S = N.code) === null || S === void 0 ? void 0 : S.regExp) !== null && E !== void 0 ? E : m, ks = (l = N.uriResolver) !== null && l !== void 0 ? l : g.default;
    return {
      strictSchema: (b = (h = N.strictSchema) !== null && h !== void 0 ? h : ot) !== null && b !== void 0 ? b : !0,
      strictNumbers: (k = (A = N.strictNumbers) !== null && A !== void 0 ? A : ot) !== null && k !== void 0 ? k : !0,
      strictTypes: (J = (X = N.strictTypes) !== null && X !== void 0 ? X : ot) !== null && J !== void 0 ? J : "log",
      strictTuples: (O = (R = N.strictTuples) !== null && R !== void 0 ? R : ot) !== null && O !== void 0 ? O : "log",
      strictRequired: (F = (D = N.strictRequired) !== null && D !== void 0 ? D : ot) !== null && F !== void 0 ? F : !1,
      code: N.code ? { ...N.code, optimize: Kr, regExp: Hr } : { optimize: Kr, regExp: Hr },
      loopRequired: (Y = N.loopRequired) !== null && Y !== void 0 ? Y : w,
      loopEnum: (se = N.loopEnum) !== null && se !== void 0 ? se : w,
      meta: (Ee = N.meta) !== null && Ee !== void 0 ? Ee : !0,
      messages: (Ke = N.messages) !== null && Ke !== void 0 ? Ke : !0,
      inlineRefs: (Oe = N.inlineRefs) !== null && Oe !== void 0 ? Oe : !0,
      schemaId: (Ie = N.schemaId) !== null && Ie !== void 0 ? Ie : "$id",
      addUsedSchema: (we = N.addUsedSchema) !== null && we !== void 0 ? we : !0,
      validateSchema: (gt = N.validateSchema) !== null && gt !== void 0 ? gt : !0,
      validateFormats: (Me = N.validateFormats) !== null && Me !== void 0 ? Me : !0,
      unicodeRegExp: (Qt = N.unicodeRegExp) !== null && Qt !== void 0 ? Qt : !0,
      int32range: (Zt = N.int32range) !== null && Zt !== void 0 ? Zt : !0,
      uriResolver: ks
    };
  }
  class T {
    constructor(y = {}) {
      this.schemas = {}, this.refs = {}, this.formats = {}, this._compilations = /* @__PURE__ */ new Set(), this._loading = {}, this._cache = /* @__PURE__ */ new Map(), y = this.opts = { ...y, ...P(y) };
      const { es5: S, lines: E } = this.opts.code;
      this.scope = new i.ValueScope({ scope: {}, prefixes: $, es5: S, lines: E }), this.logger = G(y.logger);
      const l = y.validateFormats;
      y.validateFormats = !1, this.RULES = (0, o.getRules)(), I.call(this, _, y, "NOT SUPPORTED"), I.call(this, p, y, "DEPRECATED", "warn"), this._metaOpts = pe.call(this), y.formats && ee.call(this), this._addVocabularies(), this._addDefaultMetaSchema(), y.keywords && he.call(this, y.keywords), typeof y.meta == "object" && this.addMetaSchema(y.meta), M.call(this), y.validateFormats = l;
    }
    _addVocabularies() {
      this.addKeyword("$async");
    }
    _addDefaultMetaSchema() {
      const { $data: y, meta: S, schemaId: E } = this.opts;
      let l = f;
      E === "id" && (l = { ...f }, l.id = l.$id, delete l.$id), S && y && this.addMetaSchema(l, l[E], !1);
    }
    defaultMeta() {
      const { meta: y, schemaId: S } = this.opts;
      return this.opts.defaultMeta = typeof y == "object" ? y[S] || y : void 0;
    }
    validate(y, S) {
      let E;
      if (typeof y == "string") {
        if (E = this.getSchema(y), !E)
          throw new Error(`no schema with key or ref "${y}"`);
      } else
        E = this.compile(y);
      const l = E(S);
      return "$async" in E || (this.errors = E.errors), l;
    }
    compile(y, S) {
      const E = this._addSchema(y, S);
      return E.validate || this._compileSchemaEnv(E);
    }
    compileAsync(y, S) {
      if (typeof this.opts.loadSchema != "function")
        throw new Error("options.loadSchema should be a function");
      const { loadSchema: E } = this.opts;
      return l.call(this, y, S);
      async function l(J, R) {
        await h.call(this, J.$schema);
        const O = this._addSchema(J, R);
        return O.validate || b.call(this, O);
      }
      async function h(J) {
        J && !this.getSchema(J) && await l.call(this, { $ref: J }, !0);
      }
      async function b(J) {
        try {
          return this._compileSchemaEnv(J);
        } catch (R) {
          if (!(R instanceof s.default))
            throw R;
          return A.call(this, R), await k.call(this, R.missingSchema), b.call(this, J);
        }
      }
      function A({ missingSchema: J, missingRef: R }) {
        if (this.refs[J])
          throw new Error(`AnySchema ${J} is loaded but ${R} cannot be resolved`);
      }
      async function k(J) {
        const R = await X.call(this, J);
        this.refs[J] || await h.call(this, R.$schema), this.refs[J] || this.addSchema(R, J, S);
      }
      async function X(J) {
        const R = this._loading[J];
        if (R)
          return R;
        try {
          return await (this._loading[J] = E(J));
        } finally {
          delete this._loading[J];
        }
      }
    }
    // Adds schema to the instance
    addSchema(y, S, E, l = this.opts.validateSchema) {
      if (Array.isArray(y)) {
        for (const b of y)
          this.addSchema(b, void 0, E, l);
        return this;
      }
      let h;
      if (typeof y == "object") {
        const { schemaId: b } = this.opts;
        if (h = y[b], h !== void 0 && typeof h != "string")
          throw new Error(`schema ${b} must be string`);
      }
      return S = (0, c.normalizeId)(S || h), this._checkUnique(S), this.schemas[S] = this._addSchema(y, E, S, l, !0), this;
    }
    // Add schema that will be used to validate other schemas
    // options in META_IGNORE_OPTIONS are alway set to false
    addMetaSchema(y, S, E = this.opts.validateSchema) {
      return this.addSchema(y, S, !0, E), this;
    }
    //  Validate schema against its meta-schema
    validateSchema(y, S) {
      if (typeof y == "boolean")
        return !0;
      let E;
      if (E = y.$schema, E !== void 0 && typeof E != "string")
        throw new Error("$schema must be a string");
      if (E = E || this.opts.defaultMeta || this.defaultMeta(), !E)
        return this.logger.warn("meta-schema not available"), this.errors = null, !0;
      const l = this.validate(E, y);
      if (!l && S) {
        const h = "schema is invalid: " + this.errorsText();
        if (this.opts.validateSchema === "log")
          this.logger.error(h);
        else
          throw new Error(h);
      }
      return l;
    }
    // Get compiled schema by `key` or `ref`.
    // (`key` that was passed to `addSchema` or full schema reference - `schema.$id` or resolved id)
    getSchema(y) {
      let S;
      for (; typeof (S = L.call(this, y)) == "string"; )
        y = S;
      if (S === void 0) {
        const { schemaId: E } = this.opts, l = new a.SchemaEnv({ schema: {}, schemaId: E });
        if (S = a.resolveSchema.call(this, l, y), !S)
          return;
        this.refs[y] = S;
      }
      return S.validate || this._compileSchemaEnv(S);
    }
    // Remove cached schema(s).
    // If no parameter is passed all schemas but meta-schemas are removed.
    // If RegExp is passed all schemas with key/id matching pattern but meta-schemas are removed.
    // Even if schema is referenced by other schemas it still can be removed as other schemas have local references.
    removeSchema(y) {
      if (y instanceof RegExp)
        return this._removeAllSchemas(this.schemas, y), this._removeAllSchemas(this.refs, y), this;
      switch (typeof y) {
        case "undefined":
          return this._removeAllSchemas(this.schemas), this._removeAllSchemas(this.refs), this._cache.clear(), this;
        case "string": {
          const S = L.call(this, y);
          return typeof S == "object" && this._cache.delete(S.schema), delete this.schemas[y], delete this.refs[y], this;
        }
        case "object": {
          const S = y;
          this._cache.delete(S);
          let E = y[this.opts.schemaId];
          return E && (E = (0, c.normalizeId)(E), delete this.schemas[E], delete this.refs[E]), this;
        }
        default:
          throw new Error("ajv.removeSchema: invalid parameter");
      }
    }
    // add "vocabulary" - a collection of keywords
    addVocabulary(y) {
      for (const S of y)
        this.addKeyword(S);
      return this;
    }
    addKeyword(y, S) {
      let E;
      if (typeof y == "string")
        E = y, typeof S == "object" && (this.logger.warn("these parameters are deprecated, see docs for addKeyword"), S.keyword = E);
      else if (typeof y == "object" && S === void 0) {
        if (S = y, E = S.keyword, Array.isArray(E) && !E.length)
          throw new Error("addKeywords: keyword must be string or non-empty array");
      } else
        throw new Error("invalid addKeywords parameters");
      if (j.call(this, E, S), !S)
        return (0, u.eachItem)(E, (h) => C.call(this, h)), this;
      U.call(this, S);
      const l = {
        ...S,
        type: (0, d.getJSONTypes)(S.type),
        schemaType: (0, d.getJSONTypes)(S.schemaType)
      };
      return (0, u.eachItem)(E, l.type.length === 0 ? (h) => C.call(this, h, l) : (h) => l.type.forEach((b) => C.call(this, h, l, b))), this;
    }
    getKeyword(y) {
      const S = this.RULES.all[y];
      return typeof S == "object" ? S.definition : !!S;
    }
    // Remove keyword
    removeKeyword(y) {
      const { RULES: S } = this;
      delete S.keywords[y], delete S.all[y];
      for (const E of S.rules) {
        const l = E.rules.findIndex((h) => h.keyword === y);
        l >= 0 && E.rules.splice(l, 1);
      }
      return this;
    }
    // Add format
    addFormat(y, S) {
      return typeof S == "string" && (S = new RegExp(S)), this.formats[y] = S, this;
    }
    errorsText(y = this.errors, { separator: S = ", ", dataVar: E = "data" } = {}) {
      return !y || y.length === 0 ? "No errors" : y.map((l) => `${E}${l.instancePath} ${l.message}`).reduce((l, h) => l + S + h);
    }
    $dataMetaSchema(y, S) {
      const E = this.RULES.all;
      y = JSON.parse(JSON.stringify(y));
      for (const l of S) {
        const h = l.split("/").slice(1);
        let b = y;
        for (const A of h)
          b = b[A];
        for (const A in E) {
          const k = E[A];
          if (typeof k != "object")
            continue;
          const { $data: X } = k.definition, J = b[A];
          X && J && (b[A] = z(J));
        }
      }
      return y;
    }
    _removeAllSchemas(y, S) {
      for (const E in y) {
        const l = y[E];
        (!S || S.test(E)) && (typeof l == "string" ? delete y[E] : l && !l.meta && (this._cache.delete(l.schema), delete y[E]));
      }
    }
    _addSchema(y, S, E, l = this.opts.validateSchema, h = this.opts.addUsedSchema) {
      let b;
      const { schemaId: A } = this.opts;
      if (typeof y == "object")
        b = y[A];
      else {
        if (this.opts.jtd)
          throw new Error("schema must be object");
        if (typeof y != "boolean")
          throw new Error("schema must be object or boolean");
      }
      let k = this._cache.get(y);
      if (k !== void 0)
        return k;
      E = (0, c.normalizeId)(b || E);
      const X = c.getSchemaRefs.call(this, y, E);
      return k = new a.SchemaEnv({ schema: y, schemaId: A, meta: S, baseId: E, localRefs: X }), this._cache.set(k.schema, k), h && !E.startsWith("#") && (E && this._checkUnique(E), this.refs[E] = k), l && this.validateSchema(y, !0), k;
    }
    _checkUnique(y) {
      if (this.schemas[y] || this.refs[y])
        throw new Error(`schema with key or id "${y}" already exists`);
    }
    _compileSchemaEnv(y) {
      if (y.meta ? this._compileMetaSchema(y) : a.compileSchema.call(this, y), !y.validate)
        throw new Error("ajv implementation error");
      return y.validate;
    }
    _compileMetaSchema(y) {
      const S = this.opts;
      this.opts = this._metaOpts;
      try {
        a.compileSchema.call(this, y);
      } finally {
        this.opts = S;
      }
    }
  }
  T.ValidationError = n.default, T.MissingRefError = s.default, e.default = T;
  function I(N, y, S, E = "error") {
    for (const l in N) {
      const h = l;
      h in y && this.logger[E](`${S}: option ${l}. ${N[h]}`);
    }
  }
  function L(N) {
    return N = (0, c.normalizeId)(N), this.schemas[N] || this.refs[N];
  }
  function M() {
    const N = this.opts.schemas;
    if (N)
      if (Array.isArray(N))
        this.addSchema(N);
      else
        for (const y in N)
          this.addSchema(N[y], y);
  }
  function ee() {
    for (const N in this.opts.formats) {
      const y = this.opts.formats[N];
      y && this.addFormat(N, y);
    }
  }
  function he(N) {
    if (Array.isArray(N)) {
      this.addVocabulary(N);
      return;
    }
    this.logger.warn("keywords option as map is deprecated, pass array");
    for (const y in N) {
      const S = N[y];
      S.keyword || (S.keyword = y), this.addKeyword(S);
    }
  }
  function pe() {
    const N = { ...this.opts };
    for (const y of v)
      delete N[y];
    return N;
  }
  const V = { log() {
  }, warn() {
  }, error() {
  } };
  function G(N) {
    if (N === !1)
      return V;
    if (N === void 0)
      return console;
    if (N.log && N.warn && N.error)
      return N;
    throw new Error("logger must implement log, warn and error methods");
  }
  const te = /^[a-z_$][a-z0-9_$:-]*$/i;
  function j(N, y) {
    const { RULES: S } = this;
    if ((0, u.eachItem)(N, (E) => {
      if (S.keywords[E])
        throw new Error(`Keyword ${E} is already defined`);
      if (!te.test(E))
        throw new Error(`Keyword ${E} has invalid name`);
    }), !!y && y.$data && !("code" in y || "validate" in y))
      throw new Error('$data keyword must have "code" or "validate" function');
  }
  function C(N, y, S) {
    var E;
    const l = y == null ? void 0 : y.post;
    if (S && l)
      throw new Error('keyword with "post" flag cannot have "type"');
    const { RULES: h } = this;
    let b = l ? h.post : h.rules.find(({ type: k }) => k === S);
    if (b || (b = { type: S, rules: [] }, h.rules.push(b)), h.keywords[N] = !0, !y)
      return;
    const A = {
      keyword: N,
      definition: {
        ...y,
        type: (0, d.getJSONTypes)(y.type),
        schemaType: (0, d.getJSONTypes)(y.schemaType)
      }
    };
    y.before ? q.call(this, b, A, y.before) : b.rules.push(A), h.all[N] = A, (E = y.implements) === null || E === void 0 || E.forEach((k) => this.addKeyword(k));
  }
  function q(N, y, S) {
    const E = N.rules.findIndex((l) => l.keyword === S);
    E >= 0 ? N.rules.splice(E, 0, y) : (N.rules.push(y), this.logger.warn(`rule ${S} is not defined`));
  }
  function U(N) {
    let { metaSchema: y } = N;
    y !== void 0 && (N.$data && this.opts.$data && (y = z(y)), N.validateSchema = this.compile(y, !0));
  }
  const W = {
    $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
  };
  function z(N) {
    return { anyOf: [N, W] };
  }
})(pl);
var Wo = {}, Jo = {}, Xo = {};
Object.defineProperty(Xo, "__esModule", { value: !0 });
const bp = {
  keyword: "id",
  code() {
    throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
  }
};
Xo.default = bp;
var Dt = {};
Object.defineProperty(Dt, "__esModule", { value: !0 });
Dt.callRef = Dt.getValidate = void 0;
const Pp = Mr, Bi = de, Ye = ae, vr = tt, Wi = We, Nn = K, Np = {
  keyword: "$ref",
  schemaType: "string",
  code(e) {
    const { gen: t, schema: r, it: n } = e, { baseId: s, schemaEnv: o, validateName: a, opts: i, self: c } = n, { root: d } = o;
    if ((r === "#" || r === "#/") && s === d.baseId)
      return f();
    const u = Wi.resolveRef.call(c, d, s, r);
    if (u === void 0)
      throw new Pp.default(n.opts.uriResolver, s, r);
    if (u instanceof Wi.SchemaEnv)
      return g(u);
    return m(u);
    function f() {
      if (o === d)
        return Jn(e, a, o, o.$async);
      const v = t.scopeValue("root", { ref: d });
      return Jn(e, (0, Ye._)`${v}.validate`, d, d.$async);
    }
    function g(v) {
      const $ = su(e, v);
      Jn(e, $, v, v.$async);
    }
    function m(v) {
      const $ = t.scopeValue("schema", i.code.source === !0 ? { ref: v, code: (0, Ye.stringify)(v) } : { ref: v }), _ = t.name("valid"), p = e.subschema({
        schema: v,
        dataTypes: [],
        schemaPath: Ye.nil,
        topSchemaRef: $,
        errSchemaPath: r
      }, _);
      e.mergeEvaluated(p), e.ok(_);
    }
  }
};
function su(e, t) {
  const { gen: r } = e;
  return t.validate ? r.scopeValue("validate", { ref: t.validate }) : (0, Ye._)`${r.scopeValue("wrapper", { ref: t })}.validate`;
}
Dt.getValidate = su;
function Jn(e, t, r, n) {
  const { gen: s, it: o } = e, { allErrors: a, schemaEnv: i, opts: c } = o, d = c.passContext ? vr.default.this : Ye.nil;
  n ? u() : f();
  function u() {
    if (!i.$async)
      throw new Error("async schema referenced by sync schema");
    const v = s.let("valid");
    s.try(() => {
      s.code((0, Ye._)`await ${(0, Bi.callValidateCode)(e, t, d)}`), m(t), a || s.assign(v, !0);
    }, ($) => {
      s.if((0, Ye._)`!(${$} instanceof ${o.ValidationError})`, () => s.throw($)), g($), a || s.assign(v, !1);
    }), e.ok(v);
  }
  function f() {
    e.result((0, Bi.callValidateCode)(e, t, d), () => m(t), () => g(t));
  }
  function g(v) {
    const $ = (0, Ye._)`${v}.errors`;
    s.assign(vr.default.vErrors, (0, Ye._)`${vr.default.vErrors} === null ? ${$} : ${vr.default.vErrors}.concat(${$})`), s.assign(vr.default.errors, (0, Ye._)`${vr.default.vErrors}.length`);
  }
  function m(v) {
    var $;
    if (!o.opts.unevaluated)
      return;
    const _ = ($ = r == null ? void 0 : r.validate) === null || $ === void 0 ? void 0 : $.evaluated;
    if (o.props !== !0)
      if (_ && !_.dynamicProps)
        _.props !== void 0 && (o.props = Nn.mergeEvaluated.props(s, _.props, o.props));
      else {
        const p = s.var("props", (0, Ye._)`${v}.evaluated.props`);
        o.props = Nn.mergeEvaluated.props(s, p, o.props, Ye.Name);
      }
    if (o.items !== !0)
      if (_ && !_.dynamicItems)
        _.items !== void 0 && (o.items = Nn.mergeEvaluated.items(s, _.items, o.items));
      else {
        const p = s.var("items", (0, Ye._)`${v}.evaluated.items`);
        o.items = Nn.mergeEvaluated.items(s, p, o.items, Ye.Name);
      }
  }
}
Dt.callRef = Jn;
Dt.default = Np;
Object.defineProperty(Jo, "__esModule", { value: !0 });
const Rp = Xo, Tp = Dt, Op = [
  "$schema",
  "$id",
  "$defs",
  "$vocabulary",
  { keyword: "$comment" },
  "definitions",
  Rp.default,
  Tp.default
];
Jo.default = Op;
var Yo = {}, xo = {};
Object.defineProperty(xo, "__esModule", { value: !0 });
const ss = ae, Ut = ss.operators, os = {
  maximum: { okStr: "<=", ok: Ut.LTE, fail: Ut.GT },
  minimum: { okStr: ">=", ok: Ut.GTE, fail: Ut.LT },
  exclusiveMaximum: { okStr: "<", ok: Ut.LT, fail: Ut.GTE },
  exclusiveMinimum: { okStr: ">", ok: Ut.GT, fail: Ut.LTE }
}, Ip = {
  message: ({ keyword: e, schemaCode: t }) => (0, ss.str)`must be ${os[e].okStr} ${t}`,
  params: ({ keyword: e, schemaCode: t }) => (0, ss._)`{comparison: ${os[e].okStr}, limit: ${t}}`
}, jp = {
  keyword: Object.keys(os),
  type: "number",
  schemaType: "number",
  $data: !0,
  error: Ip,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e;
    e.fail$data((0, ss._)`${r} ${os[t].fail} ${n} || isNaN(${r})`);
  }
};
xo.default = jp;
var Qo = {};
Object.defineProperty(Qo, "__esModule", { value: !0 });
const sn = ae, Ap = {
  message: ({ schemaCode: e }) => (0, sn.str)`must be multiple of ${e}`,
  params: ({ schemaCode: e }) => (0, sn._)`{multipleOf: ${e}}`
}, Cp = {
  keyword: "multipleOf",
  type: "number",
  schemaType: "number",
  $data: !0,
  error: Ap,
  code(e) {
    const { gen: t, data: r, schemaCode: n, it: s } = e, o = s.opts.multipleOfPrecision, a = t.let("res"), i = o ? (0, sn._)`Math.abs(Math.round(${a}) - ${a}) > 1e-${o}` : (0, sn._)`${a} !== parseInt(${a})`;
    e.fail$data((0, sn._)`(${n} === 0 || (${a} = ${r}/${n}, ${i}))`);
  }
};
Qo.default = Cp;
var Zo = {}, ea = {};
Object.defineProperty(ea, "__esModule", { value: !0 });
function ou(e) {
  const t = e.length;
  let r = 0, n = 0, s;
  for (; n < t; )
    r++, s = e.charCodeAt(n++), s >= 55296 && s <= 56319 && n < t && (s = e.charCodeAt(n), (s & 64512) === 56320 && n++);
  return r;
}
ea.default = ou;
ou.code = 'require("ajv/dist/runtime/ucs2length").default';
Object.defineProperty(Zo, "__esModule", { value: !0 });
const cr = ae, kp = K, Dp = ea, Mp = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxLength" ? "more" : "fewer";
    return (0, cr.str)`must NOT have ${r} than ${t} characters`;
  },
  params: ({ schemaCode: e }) => (0, cr._)`{limit: ${e}}`
}, Lp = {
  keyword: ["maxLength", "minLength"],
  type: "string",
  schemaType: "number",
  $data: !0,
  error: Mp,
  code(e) {
    const { keyword: t, data: r, schemaCode: n, it: s } = e, o = t === "maxLength" ? cr.operators.GT : cr.operators.LT, a = s.opts.unicode === !1 ? (0, cr._)`${r}.length` : (0, cr._)`${(0, kp.useFunc)(e.gen, Dp.default)}(${r})`;
    e.fail$data((0, cr._)`${a} ${o} ${n}`);
  }
};
Zo.default = Lp;
var ta = {};
Object.defineProperty(ta, "__esModule", { value: !0 });
const Fp = de, as = ae, Vp = {
  message: ({ schemaCode: e }) => (0, as.str)`must match pattern "${e}"`,
  params: ({ schemaCode: e }) => (0, as._)`{pattern: ${e}}`
}, Up = {
  keyword: "pattern",
  type: "string",
  schemaType: "string",
  $data: !0,
  error: Vp,
  code(e) {
    const { data: t, $data: r, schema: n, schemaCode: s, it: o } = e, a = o.opts.unicodeRegExp ? "u" : "", i = r ? (0, as._)`(new RegExp(${s}, ${a}))` : (0, Fp.usePattern)(e, n);
    e.fail$data((0, as._)`!${i}.test(${t})`);
  }
};
ta.default = Up;
var ra = {};
Object.defineProperty(ra, "__esModule", { value: !0 });
const on = ae, zp = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxProperties" ? "more" : "fewer";
    return (0, on.str)`must NOT have ${r} than ${t} properties`;
  },
  params: ({ schemaCode: e }) => (0, on._)`{limit: ${e}}`
}, qp = {
  keyword: ["maxProperties", "minProperties"],
  type: "object",
  schemaType: "number",
  $data: !0,
  error: zp,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e, s = t === "maxProperties" ? on.operators.GT : on.operators.LT;
    e.fail$data((0, on._)`Object.keys(${r}).length ${s} ${n}`);
  }
};
ra.default = qp;
var na = {};
Object.defineProperty(na, "__esModule", { value: !0 });
const Xr = de, an = ae, Gp = K, Kp = {
  message: ({ params: { missingProperty: e } }) => (0, an.str)`must have required property '${e}'`,
  params: ({ params: { missingProperty: e } }) => (0, an._)`{missingProperty: ${e}}`
}, Hp = {
  keyword: "required",
  type: "object",
  schemaType: "array",
  $data: !0,
  error: Kp,
  code(e) {
    const { gen: t, schema: r, schemaCode: n, data: s, $data: o, it: a } = e, { opts: i } = a;
    if (!o && r.length === 0)
      return;
    const c = r.length >= i.loopRequired;
    if (a.allErrors ? d() : u(), i.strictRequired) {
      const m = e.parentSchema.properties, { definedProperties: v } = e.it;
      for (const $ of r)
        if ((m == null ? void 0 : m[$]) === void 0 && !v.has($)) {
          const _ = a.schemaEnv.baseId + a.errSchemaPath, p = `required property "${$}" is not defined at "${_}" (strictRequired)`;
          (0, Gp.checkStrictMode)(a, p, a.opts.strictRequired);
        }
    }
    function d() {
      if (c || o)
        e.block$data(an.nil, f);
      else
        for (const m of r)
          (0, Xr.checkReportMissingProp)(e, m);
    }
    function u() {
      const m = t.let("missing");
      if (c || o) {
        const v = t.let("valid", !0);
        e.block$data(v, () => g(m, v)), e.ok(v);
      } else
        t.if((0, Xr.checkMissingProp)(e, r, m)), (0, Xr.reportMissingProp)(e, m), t.else();
    }
    function f() {
      t.forOf("prop", n, (m) => {
        e.setParams({ missingProperty: m }), t.if((0, Xr.noPropertyInData)(t, s, m, i.ownProperties), () => e.error());
      });
    }
    function g(m, v) {
      e.setParams({ missingProperty: m }), t.forOf(m, n, () => {
        t.assign(v, (0, Xr.propertyInData)(t, s, m, i.ownProperties)), t.if((0, an.not)(v), () => {
          e.error(), t.break();
        });
      }, an.nil);
    }
  }
};
na.default = Hp;
var sa = {};
Object.defineProperty(sa, "__esModule", { value: !0 });
const cn = ae, Bp = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxItems" ? "more" : "fewer";
    return (0, cn.str)`must NOT have ${r} than ${t} items`;
  },
  params: ({ schemaCode: e }) => (0, cn._)`{limit: ${e}}`
}, Wp = {
  keyword: ["maxItems", "minItems"],
  type: "array",
  schemaType: "number",
  $data: !0,
  error: Bp,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e, s = t === "maxItems" ? cn.operators.GT : cn.operators.LT;
    e.fail$data((0, cn._)`${r}.length ${s} ${n}`);
  }
};
sa.default = Wp;
var oa = {}, $n = {};
Object.defineProperty($n, "__esModule", { value: !0 });
const au = ms;
au.code = 'require("ajv/dist/runtime/equal").default';
$n.default = au;
Object.defineProperty(oa, "__esModule", { value: !0 });
const Bs = Re, Ae = ae, Jp = K, Xp = $n, Yp = {
  message: ({ params: { i: e, j: t } }) => (0, Ae.str)`must NOT have duplicate items (items ## ${t} and ${e} are identical)`,
  params: ({ params: { i: e, j: t } }) => (0, Ae._)`{i: ${e}, j: ${t}}`
}, xp = {
  keyword: "uniqueItems",
  type: "array",
  schemaType: "boolean",
  $data: !0,
  error: Yp,
  code(e) {
    const { gen: t, data: r, $data: n, schema: s, parentSchema: o, schemaCode: a, it: i } = e;
    if (!n && !s)
      return;
    const c = t.let("valid"), d = o.items ? (0, Bs.getSchemaTypes)(o.items) : [];
    e.block$data(c, u, (0, Ae._)`${a} === false`), e.ok(c);
    function u() {
      const v = t.let("i", (0, Ae._)`${r}.length`), $ = t.let("j");
      e.setParams({ i: v, j: $ }), t.assign(c, !0), t.if((0, Ae._)`${v} > 1`, () => (f() ? g : m)(v, $));
    }
    function f() {
      return d.length > 0 && !d.some((v) => v === "object" || v === "array");
    }
    function g(v, $) {
      const _ = t.name("item"), p = (0, Bs.checkDataTypes)(d, _, i.opts.strictNumbers, Bs.DataType.Wrong), w = t.const("indices", (0, Ae._)`{}`);
      t.for((0, Ae._)`;${v}--;`, () => {
        t.let(_, (0, Ae._)`${r}[${v}]`), t.if(p, (0, Ae._)`continue`), d.length > 1 && t.if((0, Ae._)`typeof ${_} == "string"`, (0, Ae._)`${_} += "_"`), t.if((0, Ae._)`typeof ${w}[${_}] == "number"`, () => {
          t.assign($, (0, Ae._)`${w}[${_}]`), e.error(), t.assign(c, !1).break();
        }).code((0, Ae._)`${w}[${_}] = ${v}`);
      });
    }
    function m(v, $) {
      const _ = (0, Jp.useFunc)(t, Xp.default), p = t.name("outer");
      t.label(p).for((0, Ae._)`;${v}--;`, () => t.for((0, Ae._)`${$} = ${v}; ${$}--;`, () => t.if((0, Ae._)`${_}(${r}[${v}], ${r}[${$}])`, () => {
        e.error(), t.assign(c, !1).break(p);
      })));
    }
  }
};
oa.default = xp;
var aa = {};
Object.defineProperty(aa, "__esModule", { value: !0 });
const mo = ae, Qp = K, Zp = $n, em = {
  message: "must be equal to constant",
  params: ({ schemaCode: e }) => (0, mo._)`{allowedValue: ${e}}`
}, tm = {
  keyword: "const",
  $data: !0,
  error: em,
  code(e) {
    const { gen: t, data: r, $data: n, schemaCode: s, schema: o } = e;
    n || o && typeof o == "object" ? e.fail$data((0, mo._)`!${(0, Qp.useFunc)(t, Zp.default)}(${r}, ${s})`) : e.fail((0, mo._)`${o} !== ${r}`);
  }
};
aa.default = tm;
var ia = {};
Object.defineProperty(ia, "__esModule", { value: !0 });
const en = ae, rm = K, nm = $n, sm = {
  message: "must be equal to one of the allowed values",
  params: ({ schemaCode: e }) => (0, en._)`{allowedValues: ${e}}`
}, om = {
  keyword: "enum",
  schemaType: "array",
  $data: !0,
  error: sm,
  code(e) {
    const { gen: t, data: r, $data: n, schema: s, schemaCode: o, it: a } = e;
    if (!n && s.length === 0)
      throw new Error("enum must have non-empty array");
    const i = s.length >= a.opts.loopEnum;
    let c;
    const d = () => c ?? (c = (0, rm.useFunc)(t, nm.default));
    let u;
    if (i || n)
      u = t.let("valid"), e.block$data(u, f);
    else {
      if (!Array.isArray(s))
        throw new Error("ajv implementation error");
      const m = t.const("vSchema", o);
      u = (0, en.or)(...s.map((v, $) => g(m, $)));
    }
    e.pass(u);
    function f() {
      t.assign(u, !1), t.forOf("v", o, (m) => t.if((0, en._)`${d()}(${r}, ${m})`, () => t.assign(u, !0).break()));
    }
    function g(m, v) {
      const $ = s[v];
      return typeof $ == "object" && $ !== null ? (0, en._)`${d()}(${r}, ${m}[${v}])` : (0, en._)`${r} === ${$}`;
    }
  }
};
ia.default = om;
Object.defineProperty(Yo, "__esModule", { value: !0 });
const am = xo, im = Qo, cm = Zo, lm = ta, um = ra, dm = na, fm = sa, hm = oa, pm = aa, mm = ia, ym = [
  // number
  am.default,
  im.default,
  // string
  cm.default,
  lm.default,
  // object
  um.default,
  dm.default,
  // array
  fm.default,
  hm.default,
  // any
  { keyword: "type", schemaType: ["string", "array"] },
  { keyword: "nullable", schemaType: "boolean" },
  pm.default,
  mm.default
];
Yo.default = ym;
var ca = {}, Lr = {};
Object.defineProperty(Lr, "__esModule", { value: !0 });
Lr.validateAdditionalItems = void 0;
const lr = ae, yo = K, $m = {
  message: ({ params: { len: e } }) => (0, lr.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, lr._)`{limit: ${e}}`
}, gm = {
  keyword: "additionalItems",
  type: "array",
  schemaType: ["boolean", "object"],
  before: "uniqueItems",
  error: $m,
  code(e) {
    const { parentSchema: t, it: r } = e, { items: n } = t;
    if (!Array.isArray(n)) {
      (0, yo.checkStrictMode)(r, '"additionalItems" is ignored when "items" is not an array of schemas');
      return;
    }
    iu(e, n);
  }
};
function iu(e, t) {
  const { gen: r, schema: n, data: s, keyword: o, it: a } = e;
  a.items = !0;
  const i = r.const("len", (0, lr._)`${s}.length`);
  if (n === !1)
    e.setParams({ len: t.length }), e.pass((0, lr._)`${i} <= ${t.length}`);
  else if (typeof n == "object" && !(0, yo.alwaysValidSchema)(a, n)) {
    const d = r.var("valid", (0, lr._)`${i} <= ${t.length}`);
    r.if((0, lr.not)(d), () => c(d)), e.ok(d);
  }
  function c(d) {
    r.forRange("i", t.length, i, (u) => {
      e.subschema({ keyword: o, dataProp: u, dataPropType: yo.Type.Num }, d), a.allErrors || r.if((0, lr.not)(d), () => r.break());
    });
  }
}
Lr.validateAdditionalItems = iu;
Lr.default = gm;
var la = {}, Fr = {};
Object.defineProperty(Fr, "__esModule", { value: !0 });
Fr.validateTuple = void 0;
const Ji = ae, Xn = K, _m = de, vm = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "array", "boolean"],
  before: "uniqueItems",
  code(e) {
    const { schema: t, it: r } = e;
    if (Array.isArray(t))
      return cu(e, "additionalItems", t);
    r.items = !0, !(0, Xn.alwaysValidSchema)(r, t) && e.ok((0, _m.validateArray)(e));
  }
};
function cu(e, t, r = e.schema) {
  const { gen: n, parentSchema: s, data: o, keyword: a, it: i } = e;
  u(s), i.opts.unevaluated && r.length && i.items !== !0 && (i.items = Xn.mergeEvaluated.items(n, r.length, i.items));
  const c = n.name("valid"), d = n.const("len", (0, Ji._)`${o}.length`);
  r.forEach((f, g) => {
    (0, Xn.alwaysValidSchema)(i, f) || (n.if((0, Ji._)`${d} > ${g}`, () => e.subschema({
      keyword: a,
      schemaProp: g,
      dataProp: g
    }, c)), e.ok(c));
  });
  function u(f) {
    const { opts: g, errSchemaPath: m } = i, v = r.length, $ = v === f.minItems && (v === f.maxItems || f[t] === !1);
    if (g.strictTuples && !$) {
      const _ = `"${a}" is ${v}-tuple, but minItems or maxItems/${t} are not specified or different at path "${m}"`;
      (0, Xn.checkStrictMode)(i, _, g.strictTuples);
    }
  }
}
Fr.validateTuple = cu;
Fr.default = vm;
Object.defineProperty(la, "__esModule", { value: !0 });
const Em = Fr, wm = {
  keyword: "prefixItems",
  type: "array",
  schemaType: ["array"],
  before: "uniqueItems",
  code: (e) => (0, Em.validateTuple)(e, "items")
};
la.default = wm;
var ua = {};
Object.defineProperty(ua, "__esModule", { value: !0 });
const Xi = ae, Sm = K, bm = de, Pm = Lr, Nm = {
  message: ({ params: { len: e } }) => (0, Xi.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, Xi._)`{limit: ${e}}`
}, Rm = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  error: Nm,
  code(e) {
    const { schema: t, parentSchema: r, it: n } = e, { prefixItems: s } = r;
    n.items = !0, !(0, Sm.alwaysValidSchema)(n, t) && (s ? (0, Pm.validateAdditionalItems)(e, s) : e.ok((0, bm.validateArray)(e)));
  }
};
ua.default = Rm;
var da = {};
Object.defineProperty(da, "__esModule", { value: !0 });
const nt = ae, Rn = K, Tm = {
  message: ({ params: { min: e, max: t } }) => t === void 0 ? (0, nt.str)`must contain at least ${e} valid item(s)` : (0, nt.str)`must contain at least ${e} and no more than ${t} valid item(s)`,
  params: ({ params: { min: e, max: t } }) => t === void 0 ? (0, nt._)`{minContains: ${e}}` : (0, nt._)`{minContains: ${e}, maxContains: ${t}}`
}, Om = {
  keyword: "contains",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  trackErrors: !0,
  error: Tm,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, it: o } = e;
    let a, i;
    const { minContains: c, maxContains: d } = n;
    o.opts.next ? (a = c === void 0 ? 1 : c, i = d) : a = 1;
    const u = t.const("len", (0, nt._)`${s}.length`);
    if (e.setParams({ min: a, max: i }), i === void 0 && a === 0) {
      (0, Rn.checkStrictMode)(o, '"minContains" == 0 without "maxContains": "contains" keyword ignored');
      return;
    }
    if (i !== void 0 && a > i) {
      (0, Rn.checkStrictMode)(o, '"minContains" > "maxContains" is always invalid'), e.fail();
      return;
    }
    if ((0, Rn.alwaysValidSchema)(o, r)) {
      let $ = (0, nt._)`${u} >= ${a}`;
      i !== void 0 && ($ = (0, nt._)`${$} && ${u} <= ${i}`), e.pass($);
      return;
    }
    o.items = !0;
    const f = t.name("valid");
    i === void 0 && a === 1 ? m(f, () => t.if(f, () => t.break())) : a === 0 ? (t.let(f, !0), i !== void 0 && t.if((0, nt._)`${s}.length > 0`, g)) : (t.let(f, !1), g()), e.result(f, () => e.reset());
    function g() {
      const $ = t.name("_valid"), _ = t.let("count", 0);
      m($, () => t.if($, () => v(_)));
    }
    function m($, _) {
      t.forRange("i", 0, u, (p) => {
        e.subschema({
          keyword: "contains",
          dataProp: p,
          dataPropType: Rn.Type.Num,
          compositeRule: !0
        }, $), _();
      });
    }
    function v($) {
      t.code((0, nt._)`${$}++`), i === void 0 ? t.if((0, nt._)`${$} >= ${a}`, () => t.assign(f, !0).break()) : (t.if((0, nt._)`${$} > ${i}`, () => t.assign(f, !1).break()), a === 1 ? t.assign(f, !0) : t.if((0, nt._)`${$} >= ${a}`, () => t.assign(f, !0)));
    }
  }
};
da.default = Om;
var _s = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.validateSchemaDeps = e.validatePropertyDeps = e.error = void 0;
  const t = ae, r = K, n = de;
  e.error = {
    message: ({ params: { property: c, depsCount: d, deps: u } }) => {
      const f = d === 1 ? "property" : "properties";
      return (0, t.str)`must have ${f} ${u} when property ${c} is present`;
    },
    params: ({ params: { property: c, depsCount: d, deps: u, missingProperty: f } }) => (0, t._)`{property: ${c},
    missingProperty: ${f},
    depsCount: ${d},
    deps: ${u}}`
    // TODO change to reference
  };
  const s = {
    keyword: "dependencies",
    type: "object",
    schemaType: "object",
    error: e.error,
    code(c) {
      const [d, u] = o(c);
      a(c, d), i(c, u);
    }
  };
  function o({ schema: c }) {
    const d = {}, u = {};
    for (const f in c) {
      if (f === "__proto__")
        continue;
      const g = Array.isArray(c[f]) ? d : u;
      g[f] = c[f];
    }
    return [d, u];
  }
  function a(c, d = c.schema) {
    const { gen: u, data: f, it: g } = c;
    if (Object.keys(d).length === 0)
      return;
    const m = u.let("missing");
    for (const v in d) {
      const $ = d[v];
      if ($.length === 0)
        continue;
      const _ = (0, n.propertyInData)(u, f, v, g.opts.ownProperties);
      c.setParams({
        property: v,
        depsCount: $.length,
        deps: $.join(", ")
      }), g.allErrors ? u.if(_, () => {
        for (const p of $)
          (0, n.checkReportMissingProp)(c, p);
      }) : (u.if((0, t._)`${_} && (${(0, n.checkMissingProp)(c, $, m)})`), (0, n.reportMissingProp)(c, m), u.else());
    }
  }
  e.validatePropertyDeps = a;
  function i(c, d = c.schema) {
    const { gen: u, data: f, keyword: g, it: m } = c, v = u.name("valid");
    for (const $ in d)
      (0, r.alwaysValidSchema)(m, d[$]) || (u.if(
        (0, n.propertyInData)(u, f, $, m.opts.ownProperties),
        () => {
          const _ = c.subschema({ keyword: g, schemaProp: $ }, v);
          c.mergeValidEvaluated(_, v);
        },
        () => u.var(v, !0)
        // TODO var
      ), c.ok(v));
  }
  e.validateSchemaDeps = i, e.default = s;
})(_s);
var fa = {};
Object.defineProperty(fa, "__esModule", { value: !0 });
const lu = ae, Im = K, jm = {
  message: "property name must be valid",
  params: ({ params: e }) => (0, lu._)`{propertyName: ${e.propertyName}}`
}, Am = {
  keyword: "propertyNames",
  type: "object",
  schemaType: ["object", "boolean"],
  error: jm,
  code(e) {
    const { gen: t, schema: r, data: n, it: s } = e;
    if ((0, Im.alwaysValidSchema)(s, r))
      return;
    const o = t.name("valid");
    t.forIn("key", n, (a) => {
      e.setParams({ propertyName: a }), e.subschema({
        keyword: "propertyNames",
        data: a,
        dataTypes: ["string"],
        propertyName: a,
        compositeRule: !0
      }, o), t.if((0, lu.not)(o), () => {
        e.error(!0), s.allErrors || t.break();
      });
    }), e.ok(o);
  }
};
fa.default = Am;
var vs = {};
Object.defineProperty(vs, "__esModule", { value: !0 });
const Tn = de, lt = ae, Cm = tt, On = K, km = {
  message: "must NOT have additional properties",
  params: ({ params: e }) => (0, lt._)`{additionalProperty: ${e.additionalProperty}}`
}, Dm = {
  keyword: "additionalProperties",
  type: ["object"],
  schemaType: ["boolean", "object"],
  allowUndefined: !0,
  trackErrors: !0,
  error: km,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, errsCount: o, it: a } = e;
    if (!o)
      throw new Error("ajv implementation error");
    const { allErrors: i, opts: c } = a;
    if (a.props = !0, c.removeAdditional !== "all" && (0, On.alwaysValidSchema)(a, r))
      return;
    const d = (0, Tn.allSchemaProperties)(n.properties), u = (0, Tn.allSchemaProperties)(n.patternProperties);
    f(), e.ok((0, lt._)`${o} === ${Cm.default.errors}`);
    function f() {
      t.forIn("key", s, (_) => {
        !d.length && !u.length ? v(_) : t.if(g(_), () => v(_));
      });
    }
    function g(_) {
      let p;
      if (d.length > 8) {
        const w = (0, On.schemaRefOrVal)(a, n.properties, "properties");
        p = (0, Tn.isOwnProperty)(t, w, _);
      } else d.length ? p = (0, lt.or)(...d.map((w) => (0, lt._)`${_} === ${w}`)) : p = lt.nil;
      return u.length && (p = (0, lt.or)(p, ...u.map((w) => (0, lt._)`${(0, Tn.usePattern)(e, w)}.test(${_})`))), (0, lt.not)(p);
    }
    function m(_) {
      t.code((0, lt._)`delete ${s}[${_}]`);
    }
    function v(_) {
      if (c.removeAdditional === "all" || c.removeAdditional && r === !1) {
        m(_);
        return;
      }
      if (r === !1) {
        e.setParams({ additionalProperty: _ }), e.error(), i || t.break();
        return;
      }
      if (typeof r == "object" && !(0, On.alwaysValidSchema)(a, r)) {
        const p = t.name("valid");
        c.removeAdditional === "failing" ? ($(_, p, !1), t.if((0, lt.not)(p), () => {
          e.reset(), m(_);
        })) : ($(_, p), i || t.if((0, lt.not)(p), () => t.break()));
      }
    }
    function $(_, p, w) {
      const P = {
        keyword: "additionalProperties",
        dataProp: _,
        dataPropType: On.Type.Str
      };
      w === !1 && Object.assign(P, {
        compositeRule: !0,
        createErrors: !1,
        allErrors: !1
      }), e.subschema(P, p);
    }
  }
};
vs.default = Dm;
var ha = {};
Object.defineProperty(ha, "__esModule", { value: !0 });
const Mm = pt, Yi = de, Ws = K, xi = vs, Lm = {
  keyword: "properties",
  type: "object",
  schemaType: "object",
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, it: o } = e;
    o.opts.removeAdditional === "all" && n.additionalProperties === void 0 && xi.default.code(new Mm.KeywordCxt(o, xi.default, "additionalProperties"));
    const a = (0, Yi.allSchemaProperties)(r);
    for (const f of a)
      o.definedProperties.add(f);
    o.opts.unevaluated && a.length && o.props !== !0 && (o.props = Ws.mergeEvaluated.props(t, (0, Ws.toHash)(a), o.props));
    const i = a.filter((f) => !(0, Ws.alwaysValidSchema)(o, r[f]));
    if (i.length === 0)
      return;
    const c = t.name("valid");
    for (const f of i)
      d(f) ? u(f) : (t.if((0, Yi.propertyInData)(t, s, f, o.opts.ownProperties)), u(f), o.allErrors || t.else().var(c, !0), t.endIf()), e.it.definedProperties.add(f), e.ok(c);
    function d(f) {
      return o.opts.useDefaults && !o.compositeRule && r[f].default !== void 0;
    }
    function u(f) {
      e.subschema({
        keyword: "properties",
        schemaProp: f,
        dataProp: f
      }, c);
    }
  }
};
ha.default = Lm;
var pa = {};
Object.defineProperty(pa, "__esModule", { value: !0 });
const Qi = de, In = ae, Zi = K, ec = K, Fm = {
  keyword: "patternProperties",
  type: "object",
  schemaType: "object",
  code(e) {
    const { gen: t, schema: r, data: n, parentSchema: s, it: o } = e, { opts: a } = o, i = (0, Qi.allSchemaProperties)(r), c = i.filter(($) => (0, Zi.alwaysValidSchema)(o, r[$]));
    if (i.length === 0 || c.length === i.length && (!o.opts.unevaluated || o.props === !0))
      return;
    const d = a.strictSchema && !a.allowMatchingProperties && s.properties, u = t.name("valid");
    o.props !== !0 && !(o.props instanceof In.Name) && (o.props = (0, ec.evaluatedPropsToName)(t, o.props));
    const { props: f } = o;
    g();
    function g() {
      for (const $ of i)
        d && m($), o.allErrors ? v($) : (t.var(u, !0), v($), t.if(u));
    }
    function m($) {
      for (const _ in d)
        new RegExp($).test(_) && (0, Zi.checkStrictMode)(o, `property ${_} matches pattern ${$} (use allowMatchingProperties)`);
    }
    function v($) {
      t.forIn("key", n, (_) => {
        t.if((0, In._)`${(0, Qi.usePattern)(e, $)}.test(${_})`, () => {
          const p = c.includes($);
          p || e.subschema({
            keyword: "patternProperties",
            schemaProp: $,
            dataProp: _,
            dataPropType: ec.Type.Str
          }, u), o.opts.unevaluated && f !== !0 ? t.assign((0, In._)`${f}[${_}]`, !0) : !p && !o.allErrors && t.if((0, In.not)(u), () => t.break());
        });
      });
    }
  }
};
pa.default = Fm;
var ma = {};
Object.defineProperty(ma, "__esModule", { value: !0 });
const Vm = K, Um = {
  keyword: "not",
  schemaType: ["object", "boolean"],
  trackErrors: !0,
  code(e) {
    const { gen: t, schema: r, it: n } = e;
    if ((0, Vm.alwaysValidSchema)(n, r)) {
      e.fail();
      return;
    }
    const s = t.name("valid");
    e.subschema({
      keyword: "not",
      compositeRule: !0,
      createErrors: !1,
      allErrors: !1
    }, s), e.failResult(s, () => e.reset(), () => e.error());
  },
  error: { message: "must NOT be valid" }
};
ma.default = Um;
var ya = {};
Object.defineProperty(ya, "__esModule", { value: !0 });
const zm = de, qm = {
  keyword: "anyOf",
  schemaType: "array",
  trackErrors: !0,
  code: zm.validateUnion,
  error: { message: "must match a schema in anyOf" }
};
ya.default = qm;
var $a = {};
Object.defineProperty($a, "__esModule", { value: !0 });
const Yn = ae, Gm = K, Km = {
  message: "must match exactly one schema in oneOf",
  params: ({ params: e }) => (0, Yn._)`{passingSchemas: ${e.passing}}`
}, Hm = {
  keyword: "oneOf",
  schemaType: "array",
  trackErrors: !0,
  error: Km,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, it: s } = e;
    if (!Array.isArray(r))
      throw new Error("ajv implementation error");
    if (s.opts.discriminator && n.discriminator)
      return;
    const o = r, a = t.let("valid", !1), i = t.let("passing", null), c = t.name("_valid");
    e.setParams({ passing: i }), t.block(d), e.result(a, () => e.reset(), () => e.error(!0));
    function d() {
      o.forEach((u, f) => {
        let g;
        (0, Gm.alwaysValidSchema)(s, u) ? t.var(c, !0) : g = e.subschema({
          keyword: "oneOf",
          schemaProp: f,
          compositeRule: !0
        }, c), f > 0 && t.if((0, Yn._)`${c} && ${a}`).assign(a, !1).assign(i, (0, Yn._)`[${i}, ${f}]`).else(), t.if(c, () => {
          t.assign(a, !0), t.assign(i, f), g && e.mergeEvaluated(g, Yn.Name);
        });
      });
    }
  }
};
$a.default = Hm;
var ga = {};
Object.defineProperty(ga, "__esModule", { value: !0 });
const Bm = K, Wm = {
  keyword: "allOf",
  schemaType: "array",
  code(e) {
    const { gen: t, schema: r, it: n } = e;
    if (!Array.isArray(r))
      throw new Error("ajv implementation error");
    const s = t.name("valid");
    r.forEach((o, a) => {
      if ((0, Bm.alwaysValidSchema)(n, o))
        return;
      const i = e.subschema({ keyword: "allOf", schemaProp: a }, s);
      e.ok(s), e.mergeEvaluated(i);
    });
  }
};
ga.default = Wm;
var _a = {};
Object.defineProperty(_a, "__esModule", { value: !0 });
const is = ae, uu = K, Jm = {
  message: ({ params: e }) => (0, is.str)`must match "${e.ifClause}" schema`,
  params: ({ params: e }) => (0, is._)`{failingKeyword: ${e.ifClause}}`
}, Xm = {
  keyword: "if",
  schemaType: ["object", "boolean"],
  trackErrors: !0,
  error: Jm,
  code(e) {
    const { gen: t, parentSchema: r, it: n } = e;
    r.then === void 0 && r.else === void 0 && (0, uu.checkStrictMode)(n, '"if" without "then" and "else" is ignored');
    const s = tc(n, "then"), o = tc(n, "else");
    if (!s && !o)
      return;
    const a = t.let("valid", !0), i = t.name("_valid");
    if (c(), e.reset(), s && o) {
      const u = t.let("ifClause");
      e.setParams({ ifClause: u }), t.if(i, d("then", u), d("else", u));
    } else s ? t.if(i, d("then")) : t.if((0, is.not)(i), d("else"));
    e.pass(a, () => e.error(!0));
    function c() {
      const u = e.subschema({
        keyword: "if",
        compositeRule: !0,
        createErrors: !1,
        allErrors: !1
      }, i);
      e.mergeEvaluated(u);
    }
    function d(u, f) {
      return () => {
        const g = e.subschema({ keyword: u }, i);
        t.assign(a, i), e.mergeValidEvaluated(g, a), f ? t.assign(f, (0, is._)`${u}`) : e.setParams({ ifClause: u });
      };
    }
  }
};
function tc(e, t) {
  const r = e.schema[t];
  return r !== void 0 && !(0, uu.alwaysValidSchema)(e, r);
}
_a.default = Xm;
var va = {};
Object.defineProperty(va, "__esModule", { value: !0 });
const Ym = K, xm = {
  keyword: ["then", "else"],
  schemaType: ["object", "boolean"],
  code({ keyword: e, parentSchema: t, it: r }) {
    t.if === void 0 && (0, Ym.checkStrictMode)(r, `"${e}" without "if" is ignored`);
  }
};
va.default = xm;
Object.defineProperty(ca, "__esModule", { value: !0 });
const Qm = Lr, Zm = la, ey = Fr, ty = ua, ry = da, ny = _s, sy = fa, oy = vs, ay = ha, iy = pa, cy = ma, ly = ya, uy = $a, dy = ga, fy = _a, hy = va;
function py(e = !1) {
  const t = [
    // any
    cy.default,
    ly.default,
    uy.default,
    dy.default,
    fy.default,
    hy.default,
    // object
    sy.default,
    oy.default,
    ny.default,
    ay.default,
    iy.default
  ];
  return e ? t.push(Zm.default, ty.default) : t.push(Qm.default, ey.default), t.push(ry.default), t;
}
ca.default = py;
var Ea = {}, Vr = {};
Object.defineProperty(Vr, "__esModule", { value: !0 });
Vr.dynamicAnchor = void 0;
const Js = ae, my = tt, rc = We, yy = Dt, $y = {
  keyword: "$dynamicAnchor",
  schemaType: "string",
  code: (e) => du(e, e.schema)
};
function du(e, t) {
  const { gen: r, it: n } = e;
  n.schemaEnv.root.dynamicAnchors[t] = !0;
  const s = (0, Js._)`${my.default.dynamicAnchors}${(0, Js.getProperty)(t)}`, o = n.errSchemaPath === "#" ? n.validateName : gy(e);
  r.if((0, Js._)`!${s}`, () => r.assign(s, o));
}
Vr.dynamicAnchor = du;
function gy(e) {
  const { schemaEnv: t, schema: r, self: n } = e.it, { root: s, baseId: o, localRefs: a, meta: i } = t.root, { schemaId: c } = n.opts, d = new rc.SchemaEnv({ schema: r, schemaId: c, root: s, baseId: o, localRefs: a, meta: i });
  return rc.compileSchema.call(n, d), (0, yy.getValidate)(e, d);
}
Vr.default = $y;
var Ur = {};
Object.defineProperty(Ur, "__esModule", { value: !0 });
Ur.dynamicRef = void 0;
const nc = ae, _y = tt, sc = Dt, vy = {
  keyword: "$dynamicRef",
  schemaType: "string",
  code: (e) => fu(e, e.schema)
};
function fu(e, t) {
  const { gen: r, keyword: n, it: s } = e;
  if (t[0] !== "#")
    throw new Error(`"${n}" only supports hash fragment reference`);
  const o = t.slice(1);
  if (s.allErrors)
    a();
  else {
    const c = r.let("valid", !1);
    a(c), e.ok(c);
  }
  function a(c) {
    if (s.schemaEnv.root.dynamicAnchors[o]) {
      const d = r.let("_v", (0, nc._)`${_y.default.dynamicAnchors}${(0, nc.getProperty)(o)}`);
      r.if(d, i(d, c), i(s.validateName, c));
    } else
      i(s.validateName, c)();
  }
  function i(c, d) {
    return d ? () => r.block(() => {
      (0, sc.callRef)(e, c), r.let(d, !0);
    }) : () => (0, sc.callRef)(e, c);
  }
}
Ur.dynamicRef = fu;
Ur.default = vy;
var wa = {};
Object.defineProperty(wa, "__esModule", { value: !0 });
const Ey = Vr, wy = K, Sy = {
  keyword: "$recursiveAnchor",
  schemaType: "boolean",
  code(e) {
    e.schema ? (0, Ey.dynamicAnchor)(e, "") : (0, wy.checkStrictMode)(e.it, "$recursiveAnchor: false is ignored");
  }
};
wa.default = Sy;
var Sa = {};
Object.defineProperty(Sa, "__esModule", { value: !0 });
const by = Ur, Py = {
  keyword: "$recursiveRef",
  schemaType: "string",
  code: (e) => (0, by.dynamicRef)(e, e.schema)
};
Sa.default = Py;
Object.defineProperty(Ea, "__esModule", { value: !0 });
const Ny = Vr, Ry = Ur, Ty = wa, Oy = Sa, Iy = [Ny.default, Ry.default, Ty.default, Oy.default];
Ea.default = Iy;
var ba = {}, Pa = {};
Object.defineProperty(Pa, "__esModule", { value: !0 });
const oc = _s, jy = {
  keyword: "dependentRequired",
  type: "object",
  schemaType: "object",
  error: oc.error,
  code: (e) => (0, oc.validatePropertyDeps)(e)
};
Pa.default = jy;
var Na = {};
Object.defineProperty(Na, "__esModule", { value: !0 });
const Ay = _s, Cy = {
  keyword: "dependentSchemas",
  type: "object",
  schemaType: "object",
  code: (e) => (0, Ay.validateSchemaDeps)(e)
};
Na.default = Cy;
var Ra = {};
Object.defineProperty(Ra, "__esModule", { value: !0 });
const ky = K, Dy = {
  keyword: ["maxContains", "minContains"],
  type: "array",
  schemaType: "number",
  code({ keyword: e, parentSchema: t, it: r }) {
    t.contains === void 0 && (0, ky.checkStrictMode)(r, `"${e}" without "contains" is ignored`);
  }
};
Ra.default = Dy;
Object.defineProperty(ba, "__esModule", { value: !0 });
const My = Pa, Ly = Na, Fy = Ra, Vy = [My.default, Ly.default, Fy.default];
ba.default = Vy;
var Ta = {}, Oa = {};
Object.defineProperty(Oa, "__esModule", { value: !0 });
const Ht = ae, ac = K, Uy = tt, zy = {
  message: "must NOT have unevaluated properties",
  params: ({ params: e }) => (0, Ht._)`{unevaluatedProperty: ${e.unevaluatedProperty}}`
}, qy = {
  keyword: "unevaluatedProperties",
  type: "object",
  schemaType: ["boolean", "object"],
  trackErrors: !0,
  error: zy,
  code(e) {
    const { gen: t, schema: r, data: n, errsCount: s, it: o } = e;
    if (!s)
      throw new Error("ajv implementation error");
    const { allErrors: a, props: i } = o;
    i instanceof Ht.Name ? t.if((0, Ht._)`${i} !== true`, () => t.forIn("key", n, (f) => t.if(d(i, f), () => c(f)))) : i !== !0 && t.forIn("key", n, (f) => i === void 0 ? c(f) : t.if(u(i, f), () => c(f))), o.props = !0, e.ok((0, Ht._)`${s} === ${Uy.default.errors}`);
    function c(f) {
      if (r === !1) {
        e.setParams({ unevaluatedProperty: f }), e.error(), a || t.break();
        return;
      }
      if (!(0, ac.alwaysValidSchema)(o, r)) {
        const g = t.name("valid");
        e.subschema({
          keyword: "unevaluatedProperties",
          dataProp: f,
          dataPropType: ac.Type.Str
        }, g), a || t.if((0, Ht.not)(g), () => t.break());
      }
    }
    function d(f, g) {
      return (0, Ht._)`!${f} || !${f}[${g}]`;
    }
    function u(f, g) {
      const m = [];
      for (const v in f)
        f[v] === !0 && m.push((0, Ht._)`${g} !== ${v}`);
      return (0, Ht.and)(...m);
    }
  }
};
Oa.default = qy;
var Ia = {};
Object.defineProperty(Ia, "__esModule", { value: !0 });
const ur = ae, ic = K, Gy = {
  message: ({ params: { len: e } }) => (0, ur.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, ur._)`{limit: ${e}}`
}, Ky = {
  keyword: "unevaluatedItems",
  type: "array",
  schemaType: ["boolean", "object"],
  error: Gy,
  code(e) {
    const { gen: t, schema: r, data: n, it: s } = e, o = s.items || 0;
    if (o === !0)
      return;
    const a = t.const("len", (0, ur._)`${n}.length`);
    if (r === !1)
      e.setParams({ len: o }), e.fail((0, ur._)`${a} > ${o}`);
    else if (typeof r == "object" && !(0, ic.alwaysValidSchema)(s, r)) {
      const c = t.var("valid", (0, ur._)`${a} <= ${o}`);
      t.if((0, ur.not)(c), () => i(c, o)), e.ok(c);
    }
    s.items = !0;
    function i(c, d) {
      t.forRange("i", d, a, (u) => {
        e.subschema({ keyword: "unevaluatedItems", dataProp: u, dataPropType: ic.Type.Num }, c), s.allErrors || t.if((0, ur.not)(c), () => t.break());
      });
    }
  }
};
Ia.default = Ky;
Object.defineProperty(Ta, "__esModule", { value: !0 });
const Hy = Oa, By = Ia, Wy = [Hy.default, By.default];
Ta.default = Wy;
var ja = {}, Aa = {};
Object.defineProperty(Aa, "__esModule", { value: !0 });
const Se = ae, Jy = {
  message: ({ schemaCode: e }) => (0, Se.str)`must match format "${e}"`,
  params: ({ schemaCode: e }) => (0, Se._)`{format: ${e}}`
}, Xy = {
  keyword: "format",
  type: ["number", "string"],
  schemaType: "string",
  $data: !0,
  error: Jy,
  code(e, t) {
    const { gen: r, data: n, $data: s, schema: o, schemaCode: a, it: i } = e, { opts: c, errSchemaPath: d, schemaEnv: u, self: f } = i;
    if (!c.validateFormats)
      return;
    s ? g() : m();
    function g() {
      const v = r.scopeValue("formats", {
        ref: f.formats,
        code: c.code.formats
      }), $ = r.const("fDef", (0, Se._)`${v}[${a}]`), _ = r.let("fType"), p = r.let("format");
      r.if((0, Se._)`typeof ${$} == "object" && !(${$} instanceof RegExp)`, () => r.assign(_, (0, Se._)`${$}.type || "string"`).assign(p, (0, Se._)`${$}.validate`), () => r.assign(_, (0, Se._)`"string"`).assign(p, $)), e.fail$data((0, Se.or)(w(), P()));
      function w() {
        return c.strictSchema === !1 ? Se.nil : (0, Se._)`${a} && !${p}`;
      }
      function P() {
        const T = u.$async ? (0, Se._)`(${$}.async ? await ${p}(${n}) : ${p}(${n}))` : (0, Se._)`${p}(${n})`, I = (0, Se._)`(typeof ${p} == "function" ? ${T} : ${p}.test(${n}))`;
        return (0, Se._)`${p} && ${p} !== true && ${_} === ${t} && !${I}`;
      }
    }
    function m() {
      const v = f.formats[o];
      if (!v) {
        w();
        return;
      }
      if (v === !0)
        return;
      const [$, _, p] = P(v);
      $ === t && e.pass(T());
      function w() {
        if (c.strictSchema === !1) {
          f.logger.warn(I());
          return;
        }
        throw new Error(I());
        function I() {
          return `unknown format "${o}" ignored in schema at path "${d}"`;
        }
      }
      function P(I) {
        const L = I instanceof RegExp ? (0, Se.regexpCode)(I) : c.code.formats ? (0, Se._)`${c.code.formats}${(0, Se.getProperty)(o)}` : void 0, M = r.scopeValue("formats", { key: o, ref: I, code: L });
        return typeof I == "object" && !(I instanceof RegExp) ? [I.type || "string", I.validate, (0, Se._)`${M}.validate`] : ["string", I, M];
      }
      function T() {
        if (typeof v == "object" && !(v instanceof RegExp) && v.async) {
          if (!u.$async)
            throw new Error("async format in sync schema");
          return (0, Se._)`await ${p}(${n})`;
        }
        return typeof _ == "function" ? (0, Se._)`${p}(${n})` : (0, Se._)`${p}.test(${n})`;
      }
    }
  }
};
Aa.default = Xy;
Object.defineProperty(ja, "__esModule", { value: !0 });
const Yy = Aa, xy = [Yy.default];
ja.default = xy;
var kr = {};
Object.defineProperty(kr, "__esModule", { value: !0 });
kr.contentVocabulary = kr.metadataVocabulary = void 0;
kr.metadataVocabulary = [
  "title",
  "description",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
  "examples"
];
kr.contentVocabulary = [
  "contentMediaType",
  "contentEncoding",
  "contentSchema"
];
Object.defineProperty(Wo, "__esModule", { value: !0 });
const Qy = Jo, Zy = Yo, e$ = ca, t$ = Ea, r$ = ba, n$ = Ta, s$ = ja, cc = kr, o$ = [
  t$.default,
  Qy.default,
  Zy.default,
  (0, e$.default)(!0),
  s$.default,
  cc.metadataVocabulary,
  cc.contentVocabulary,
  r$.default,
  n$.default
];
Wo.default = o$;
var Ca = {}, Es = {};
Object.defineProperty(Es, "__esModule", { value: !0 });
Es.DiscrError = void 0;
var lc;
(function(e) {
  e.Tag = "tag", e.Mapping = "mapping";
})(lc || (Es.DiscrError = lc = {}));
Object.defineProperty(Ca, "__esModule", { value: !0 });
const Sr = ae, $o = Es, uc = We, a$ = Mr, i$ = K, c$ = {
  message: ({ params: { discrError: e, tagName: t } }) => e === $o.DiscrError.Tag ? `tag "${t}" must be string` : `value of tag "${t}" must be in oneOf`,
  params: ({ params: { discrError: e, tag: t, tagName: r } }) => (0, Sr._)`{error: ${e}, tag: ${r}, tagValue: ${t}}`
}, l$ = {
  keyword: "discriminator",
  type: "object",
  schemaType: "object",
  error: c$,
  code(e) {
    const { gen: t, data: r, schema: n, parentSchema: s, it: o } = e, { oneOf: a } = s;
    if (!o.opts.discriminator)
      throw new Error("discriminator: requires discriminator option");
    const i = n.propertyName;
    if (typeof i != "string")
      throw new Error("discriminator: requires propertyName");
    if (n.mapping)
      throw new Error("discriminator: mapping is not supported");
    if (!a)
      throw new Error("discriminator: requires oneOf keyword");
    const c = t.let("valid", !1), d = t.const("tag", (0, Sr._)`${r}${(0, Sr.getProperty)(i)}`);
    t.if((0, Sr._)`typeof ${d} == "string"`, () => u(), () => e.error(!1, { discrError: $o.DiscrError.Tag, tag: d, tagName: i })), e.ok(c);
    function u() {
      const m = g();
      t.if(!1);
      for (const v in m)
        t.elseIf((0, Sr._)`${d} === ${v}`), t.assign(c, f(m[v]));
      t.else(), e.error(!1, { discrError: $o.DiscrError.Mapping, tag: d, tagName: i }), t.endIf();
    }
    function f(m) {
      const v = t.name("valid"), $ = e.subschema({ keyword: "oneOf", schemaProp: m }, v);
      return e.mergeEvaluated($, Sr.Name), v;
    }
    function g() {
      var m;
      const v = {}, $ = p(s);
      let _ = !0;
      for (let T = 0; T < a.length; T++) {
        let I = a[T];
        if (I != null && I.$ref && !(0, i$.schemaHasRulesButRef)(I, o.self.RULES)) {
          const M = I.$ref;
          if (I = uc.resolveRef.call(o.self, o.schemaEnv.root, o.baseId, M), I instanceof uc.SchemaEnv && (I = I.schema), I === void 0)
            throw new a$.default(o.opts.uriResolver, o.baseId, M);
        }
        const L = (m = I == null ? void 0 : I.properties) === null || m === void 0 ? void 0 : m[i];
        if (typeof L != "object")
          throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${i}"`);
        _ = _ && ($ || p(I)), w(L, T);
      }
      if (!_)
        throw new Error(`discriminator: "${i}" must be required`);
      return v;
      function p({ required: T }) {
        return Array.isArray(T) && T.includes(i);
      }
      function w(T, I) {
        if (T.const)
          P(T.const, I);
        else if (T.enum)
          for (const L of T.enum)
            P(L, I);
        else
          throw new Error(`discriminator: "properties/${i}" must have "const" or "enum"`);
      }
      function P(T, I) {
        if (typeof T != "string" || T in v)
          throw new Error(`discriminator: "${i}" values must be unique strings`);
        v[T] = I;
      }
    }
  }
};
Ca.default = l$;
var ka = {};
const u$ = "https://json-schema.org/draft/2020-12/schema", d$ = "https://json-schema.org/draft/2020-12/schema", f$ = {
  "https://json-schema.org/draft/2020-12/vocab/core": !0,
  "https://json-schema.org/draft/2020-12/vocab/applicator": !0,
  "https://json-schema.org/draft/2020-12/vocab/unevaluated": !0,
  "https://json-schema.org/draft/2020-12/vocab/validation": !0,
  "https://json-schema.org/draft/2020-12/vocab/meta-data": !0,
  "https://json-schema.org/draft/2020-12/vocab/format-annotation": !0,
  "https://json-schema.org/draft/2020-12/vocab/content": !0
}, h$ = "meta", p$ = "Core and Validation specifications meta-schema", m$ = [
  {
    $ref: "meta/core"
  },
  {
    $ref: "meta/applicator"
  },
  {
    $ref: "meta/unevaluated"
  },
  {
    $ref: "meta/validation"
  },
  {
    $ref: "meta/meta-data"
  },
  {
    $ref: "meta/format-annotation"
  },
  {
    $ref: "meta/content"
  }
], y$ = [
  "object",
  "boolean"
], $$ = "This meta-schema also defines keywords that have appeared in previous drafts in order to prevent incompatible extensions as they remain in common use.", g$ = {
  definitions: {
    $comment: '"definitions" has been replaced by "$defs".',
    type: "object",
    additionalProperties: {
      $dynamicRef: "#meta"
    },
    deprecated: !0,
    default: {}
  },
  dependencies: {
    $comment: '"dependencies" has been split and replaced by "dependentSchemas" and "dependentRequired" in order to serve their differing semantics.',
    type: "object",
    additionalProperties: {
      anyOf: [
        {
          $dynamicRef: "#meta"
        },
        {
          $ref: "meta/validation#/$defs/stringArray"
        }
      ]
    },
    deprecated: !0,
    default: {}
  },
  $recursiveAnchor: {
    $comment: '"$recursiveAnchor" has been replaced by "$dynamicAnchor".',
    $ref: "meta/core#/$defs/anchorString",
    deprecated: !0
  },
  $recursiveRef: {
    $comment: '"$recursiveRef" has been replaced by "$dynamicRef".',
    $ref: "meta/core#/$defs/uriReferenceString",
    deprecated: !0
  }
}, _$ = {
  $schema: u$,
  $id: d$,
  $vocabulary: f$,
  $dynamicAnchor: h$,
  title: p$,
  allOf: m$,
  type: y$,
  $comment: $$,
  properties: g$
}, v$ = "https://json-schema.org/draft/2020-12/schema", E$ = "https://json-schema.org/draft/2020-12/meta/applicator", w$ = {
  "https://json-schema.org/draft/2020-12/vocab/applicator": !0
}, S$ = "meta", b$ = "Applicator vocabulary meta-schema", P$ = [
  "object",
  "boolean"
], N$ = {
  prefixItems: {
    $ref: "#/$defs/schemaArray"
  },
  items: {
    $dynamicRef: "#meta"
  },
  contains: {
    $dynamicRef: "#meta"
  },
  additionalProperties: {
    $dynamicRef: "#meta"
  },
  properties: {
    type: "object",
    additionalProperties: {
      $dynamicRef: "#meta"
    },
    default: {}
  },
  patternProperties: {
    type: "object",
    additionalProperties: {
      $dynamicRef: "#meta"
    },
    propertyNames: {
      format: "regex"
    },
    default: {}
  },
  dependentSchemas: {
    type: "object",
    additionalProperties: {
      $dynamicRef: "#meta"
    },
    default: {}
  },
  propertyNames: {
    $dynamicRef: "#meta"
  },
  if: {
    $dynamicRef: "#meta"
  },
  then: {
    $dynamicRef: "#meta"
  },
  else: {
    $dynamicRef: "#meta"
  },
  allOf: {
    $ref: "#/$defs/schemaArray"
  },
  anyOf: {
    $ref: "#/$defs/schemaArray"
  },
  oneOf: {
    $ref: "#/$defs/schemaArray"
  },
  not: {
    $dynamicRef: "#meta"
  }
}, R$ = {
  schemaArray: {
    type: "array",
    minItems: 1,
    items: {
      $dynamicRef: "#meta"
    }
  }
}, T$ = {
  $schema: v$,
  $id: E$,
  $vocabulary: w$,
  $dynamicAnchor: S$,
  title: b$,
  type: P$,
  properties: N$,
  $defs: R$
}, O$ = "https://json-schema.org/draft/2020-12/schema", I$ = "https://json-schema.org/draft/2020-12/meta/unevaluated", j$ = {
  "https://json-schema.org/draft/2020-12/vocab/unevaluated": !0
}, A$ = "meta", C$ = "Unevaluated applicator vocabulary meta-schema", k$ = [
  "object",
  "boolean"
], D$ = {
  unevaluatedItems: {
    $dynamicRef: "#meta"
  },
  unevaluatedProperties: {
    $dynamicRef: "#meta"
  }
}, M$ = {
  $schema: O$,
  $id: I$,
  $vocabulary: j$,
  $dynamicAnchor: A$,
  title: C$,
  type: k$,
  properties: D$
}, L$ = "https://json-schema.org/draft/2020-12/schema", F$ = "https://json-schema.org/draft/2020-12/meta/content", V$ = {
  "https://json-schema.org/draft/2020-12/vocab/content": !0
}, U$ = "meta", z$ = "Content vocabulary meta-schema", q$ = [
  "object",
  "boolean"
], G$ = {
  contentEncoding: {
    type: "string"
  },
  contentMediaType: {
    type: "string"
  },
  contentSchema: {
    $dynamicRef: "#meta"
  }
}, K$ = {
  $schema: L$,
  $id: F$,
  $vocabulary: V$,
  $dynamicAnchor: U$,
  title: z$,
  type: q$,
  properties: G$
}, H$ = "https://json-schema.org/draft/2020-12/schema", B$ = "https://json-schema.org/draft/2020-12/meta/core", W$ = {
  "https://json-schema.org/draft/2020-12/vocab/core": !0
}, J$ = "meta", X$ = "Core vocabulary meta-schema", Y$ = [
  "object",
  "boolean"
], x$ = {
  $id: {
    $ref: "#/$defs/uriReferenceString",
    $comment: "Non-empty fragments not allowed.",
    pattern: "^[^#]*#?$"
  },
  $schema: {
    $ref: "#/$defs/uriString"
  },
  $ref: {
    $ref: "#/$defs/uriReferenceString"
  },
  $anchor: {
    $ref: "#/$defs/anchorString"
  },
  $dynamicRef: {
    $ref: "#/$defs/uriReferenceString"
  },
  $dynamicAnchor: {
    $ref: "#/$defs/anchorString"
  },
  $vocabulary: {
    type: "object",
    propertyNames: {
      $ref: "#/$defs/uriString"
    },
    additionalProperties: {
      type: "boolean"
    }
  },
  $comment: {
    type: "string"
  },
  $defs: {
    type: "object",
    additionalProperties: {
      $dynamicRef: "#meta"
    }
  }
}, Q$ = {
  anchorString: {
    type: "string",
    pattern: "^[A-Za-z_][-A-Za-z0-9._]*$"
  },
  uriString: {
    type: "string",
    format: "uri"
  },
  uriReferenceString: {
    type: "string",
    format: "uri-reference"
  }
}, Z$ = {
  $schema: H$,
  $id: B$,
  $vocabulary: W$,
  $dynamicAnchor: J$,
  title: X$,
  type: Y$,
  properties: x$,
  $defs: Q$
}, eg = "https://json-schema.org/draft/2020-12/schema", tg = "https://json-schema.org/draft/2020-12/meta/format-annotation", rg = {
  "https://json-schema.org/draft/2020-12/vocab/format-annotation": !0
}, ng = "meta", sg = "Format vocabulary meta-schema for annotation results", og = [
  "object",
  "boolean"
], ag = {
  format: {
    type: "string"
  }
}, ig = {
  $schema: eg,
  $id: tg,
  $vocabulary: rg,
  $dynamicAnchor: ng,
  title: sg,
  type: og,
  properties: ag
}, cg = "https://json-schema.org/draft/2020-12/schema", lg = "https://json-schema.org/draft/2020-12/meta/meta-data", ug = {
  "https://json-schema.org/draft/2020-12/vocab/meta-data": !0
}, dg = "meta", fg = "Meta-data vocabulary meta-schema", hg = [
  "object",
  "boolean"
], pg = {
  title: {
    type: "string"
  },
  description: {
    type: "string"
  },
  default: !0,
  deprecated: {
    type: "boolean",
    default: !1
  },
  readOnly: {
    type: "boolean",
    default: !1
  },
  writeOnly: {
    type: "boolean",
    default: !1
  },
  examples: {
    type: "array",
    items: !0
  }
}, mg = {
  $schema: cg,
  $id: lg,
  $vocabulary: ug,
  $dynamicAnchor: dg,
  title: fg,
  type: hg,
  properties: pg
}, yg = "https://json-schema.org/draft/2020-12/schema", $g = "https://json-schema.org/draft/2020-12/meta/validation", gg = {
  "https://json-schema.org/draft/2020-12/vocab/validation": !0
}, _g = "meta", vg = "Validation vocabulary meta-schema", Eg = [
  "object",
  "boolean"
], wg = {
  type: {
    anyOf: [
      {
        $ref: "#/$defs/simpleTypes"
      },
      {
        type: "array",
        items: {
          $ref: "#/$defs/simpleTypes"
        },
        minItems: 1,
        uniqueItems: !0
      }
    ]
  },
  const: !0,
  enum: {
    type: "array",
    items: !0
  },
  multipleOf: {
    type: "number",
    exclusiveMinimum: 0
  },
  maximum: {
    type: "number"
  },
  exclusiveMaximum: {
    type: "number"
  },
  minimum: {
    type: "number"
  },
  exclusiveMinimum: {
    type: "number"
  },
  maxLength: {
    $ref: "#/$defs/nonNegativeInteger"
  },
  minLength: {
    $ref: "#/$defs/nonNegativeIntegerDefault0"
  },
  pattern: {
    type: "string",
    format: "regex"
  },
  maxItems: {
    $ref: "#/$defs/nonNegativeInteger"
  },
  minItems: {
    $ref: "#/$defs/nonNegativeIntegerDefault0"
  },
  uniqueItems: {
    type: "boolean",
    default: !1
  },
  maxContains: {
    $ref: "#/$defs/nonNegativeInteger"
  },
  minContains: {
    $ref: "#/$defs/nonNegativeInteger",
    default: 1
  },
  maxProperties: {
    $ref: "#/$defs/nonNegativeInteger"
  },
  minProperties: {
    $ref: "#/$defs/nonNegativeIntegerDefault0"
  },
  required: {
    $ref: "#/$defs/stringArray"
  },
  dependentRequired: {
    type: "object",
    additionalProperties: {
      $ref: "#/$defs/stringArray"
    }
  }
}, Sg = {
  nonNegativeInteger: {
    type: "integer",
    minimum: 0
  },
  nonNegativeIntegerDefault0: {
    $ref: "#/$defs/nonNegativeInteger",
    default: 0
  },
  simpleTypes: {
    enum: [
      "array",
      "boolean",
      "integer",
      "null",
      "number",
      "object",
      "string"
    ]
  },
  stringArray: {
    type: "array",
    items: {
      type: "string"
    },
    uniqueItems: !0,
    default: []
  }
}, bg = {
  $schema: yg,
  $id: $g,
  $vocabulary: gg,
  $dynamicAnchor: _g,
  title: vg,
  type: Eg,
  properties: wg,
  $defs: Sg
};
Object.defineProperty(ka, "__esModule", { value: !0 });
const Pg = _$, Ng = T$, Rg = M$, Tg = K$, Og = Z$, Ig = ig, jg = mg, Ag = bg, Cg = ["/properties"];
function kg(e) {
  return [
    Pg,
    Ng,
    Rg,
    Tg,
    Og,
    t(this, Ig),
    jg,
    t(this, Ag)
  ].forEach((r) => this.addMetaSchema(r, void 0, !1)), this;
  function t(r, n) {
    return e ? r.$dataMetaSchema(n, Cg) : n;
  }
}
ka.default = kg;
(function(e, t) {
  Object.defineProperty(t, "__esModule", { value: !0 }), t.MissingRefError = t.ValidationError = t.CodeGen = t.Name = t.nil = t.stringify = t.str = t._ = t.KeywordCxt = t.Ajv2020 = void 0;
  const r = pl, n = Wo, s = Ca, o = ka, a = "https://json-schema.org/draft/2020-12/schema";
  class i extends r.default {
    constructor(m = {}) {
      super({
        ...m,
        dynamicRef: !0,
        next: !0,
        unevaluated: !0
      });
    }
    _addVocabularies() {
      super._addVocabularies(), n.default.forEach((m) => this.addVocabulary(m)), this.opts.discriminator && this.addKeyword(s.default);
    }
    _addDefaultMetaSchema() {
      super._addDefaultMetaSchema();
      const { $data: m, meta: v } = this.opts;
      v && (o.default.call(this, m), this.refs["http://json-schema.org/schema"] = a);
    }
    defaultMeta() {
      return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(a) ? a : void 0);
    }
  }
  t.Ajv2020 = i, e.exports = t = i, e.exports.Ajv2020 = i, Object.defineProperty(t, "__esModule", { value: !0 }), t.default = i;
  var c = pt;
  Object.defineProperty(t, "KeywordCxt", { enumerable: !0, get: function() {
    return c.KeywordCxt;
  } });
  var d = ae;
  Object.defineProperty(t, "_", { enumerable: !0, get: function() {
    return d._;
  } }), Object.defineProperty(t, "str", { enumerable: !0, get: function() {
    return d.str;
  } }), Object.defineProperty(t, "stringify", { enumerable: !0, get: function() {
    return d.stringify;
  } }), Object.defineProperty(t, "nil", { enumerable: !0, get: function() {
    return d.nil;
  } }), Object.defineProperty(t, "Name", { enumerable: !0, get: function() {
    return d.Name;
  } }), Object.defineProperty(t, "CodeGen", { enumerable: !0, get: function() {
    return d.CodeGen;
  } });
  var u = yn;
  Object.defineProperty(t, "ValidationError", { enumerable: !0, get: function() {
    return u.default;
  } });
  var f = Mr;
  Object.defineProperty(t, "MissingRefError", { enumerable: !0, get: function() {
    return f.default;
  } });
})(lo, lo.exports);
var Dg = lo.exports, go = { exports: {} }, hu = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.formatNames = e.fastFormats = e.fullFormats = void 0;
  function t(V, G) {
    return { validate: V, compare: G };
  }
  e.fullFormats = {
    // date: http://tools.ietf.org/html/rfc3339#section-5.6
    date: t(o, a),
    // date-time: http://tools.ietf.org/html/rfc3339#section-5.6
    time: t(c(!0), d),
    "date-time": t(g(!0), m),
    "iso-time": t(c(), u),
    "iso-date-time": t(g(), v),
    // duration: https://tools.ietf.org/html/rfc3339#appendix-A
    duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
    uri: p,
    "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
    // uri-template: https://tools.ietf.org/html/rfc6570
    "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
    // For the source: https://gist.github.com/dperini/729294
    // For test cases: https://mathiasbynens.be/demo/url-regex
    url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
    email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
    hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
    // optimized https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9780596802837/ch07s16.html
    ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
    ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
    regex: pe,
    // uuid: http://tools.ietf.org/html/rfc4122
    uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
    // JSON-pointer: https://tools.ietf.org/html/rfc6901
    // uri fragment: https://tools.ietf.org/html/rfc3986#appendix-A
    "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
    "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
    // relative JSON-pointer: http://tools.ietf.org/html/draft-luff-relative-json-pointer-00
    "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
    // the following formats are used by the openapi specification: https://spec.openapis.org/oas/v3.0.0#data-types
    // byte: https://github.com/miguelmota/is-base64
    byte: P,
    // signed 32 bit integer
    int32: { type: "number", validate: L },
    // signed 64 bit integer
    int64: { type: "number", validate: M },
    // C-type float
    float: { type: "number", validate: ee },
    // C-type double
    double: { type: "number", validate: ee },
    // hint to the UI to hide input strings
    password: !0,
    // unchecked string payload
    binary: !0
  }, e.fastFormats = {
    ...e.fullFormats,
    date: t(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, a),
    time: t(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, d),
    "date-time": t(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, m),
    "iso-time": t(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, u),
    "iso-date-time": t(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, v),
    // uri: https://github.com/mafintosh/is-my-json-valid/blob/master/formats.js
    uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
    "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
    // email (sources from jsen validator):
    // http://stackoverflow.com/questions/201323/using-a-regular-expression-to-validate-an-email-address#answer-8829363
    // http://www.w3.org/TR/html5/forms.html#valid-e-mail-address (search for 'wilful violation')
    email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
  }, e.formatNames = Object.keys(e.fullFormats);
  function r(V) {
    return V % 4 === 0 && (V % 100 !== 0 || V % 400 === 0);
  }
  const n = /^(\d\d\d\d)-(\d\d)-(\d\d)$/, s = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function o(V) {
    const G = n.exec(V);
    if (!G)
      return !1;
    const te = +G[1], j = +G[2], C = +G[3];
    return j >= 1 && j <= 12 && C >= 1 && C <= (j === 2 && r(te) ? 29 : s[j]);
  }
  function a(V, G) {
    if (V && G)
      return V > G ? 1 : V < G ? -1 : 0;
  }
  const i = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
  function c(V) {
    return function(te) {
      const j = i.exec(te);
      if (!j)
        return !1;
      const C = +j[1], q = +j[2], U = +j[3], W = j[4], z = j[5] === "-" ? -1 : 1, N = +(j[6] || 0), y = +(j[7] || 0);
      if (N > 23 || y > 59 || V && !W)
        return !1;
      if (C <= 23 && q <= 59 && U < 60)
        return !0;
      const S = q - y * z, E = C - N * z - (S < 0 ? 1 : 0);
      return (E === 23 || E === -1) && (S === 59 || S === -1) && U < 61;
    };
  }
  function d(V, G) {
    if (!(V && G))
      return;
    const te = (/* @__PURE__ */ new Date("2020-01-01T" + V)).valueOf(), j = (/* @__PURE__ */ new Date("2020-01-01T" + G)).valueOf();
    if (te && j)
      return te - j;
  }
  function u(V, G) {
    if (!(V && G))
      return;
    const te = i.exec(V), j = i.exec(G);
    if (te && j)
      return V = te[1] + te[2] + te[3], G = j[1] + j[2] + j[3], V > G ? 1 : V < G ? -1 : 0;
  }
  const f = /t|\s/i;
  function g(V) {
    const G = c(V);
    return function(j) {
      const C = j.split(f);
      return C.length === 2 && o(C[0]) && G(C[1]);
    };
  }
  function m(V, G) {
    if (!(V && G))
      return;
    const te = new Date(V).valueOf(), j = new Date(G).valueOf();
    if (te && j)
      return te - j;
  }
  function v(V, G) {
    if (!(V && G))
      return;
    const [te, j] = V.split(f), [C, q] = G.split(f), U = a(te, C);
    if (U !== void 0)
      return U || d(j, q);
  }
  const $ = /\/|:/, _ = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
  function p(V) {
    return $.test(V) && _.test(V);
  }
  const w = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
  function P(V) {
    return w.lastIndex = 0, w.test(V);
  }
  const T = -2147483648, I = 2 ** 31 - 1;
  function L(V) {
    return Number.isInteger(V) && V <= I && V >= T;
  }
  function M(V) {
    return Number.isInteger(V);
  }
  function ee() {
    return !0;
  }
  const he = /[^\\]\\Z/;
  function pe(V) {
    if (he.test(V))
      return !1;
    try {
      return new RegExp(V), !0;
    } catch {
      return !1;
    }
  }
})(hu);
var pu = {}, _o = { exports: {} }, mu = {}, Ot = {}, sr = {}, gn = {}, ue = {}, pn = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.regexpCode = e.getEsmExportName = e.getProperty = e.safeStringify = e.stringify = e.strConcat = e.addCodeArg = e.str = e._ = e.nil = e._Code = e.Name = e.IDENTIFIER = e._CodeOrName = void 0;
  class t {
  }
  e._CodeOrName = t, e.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
  class r extends t {
    constructor(w) {
      if (super(), !e.IDENTIFIER.test(w))
        throw new Error("CodeGen: name must be a valid identifier");
      this.str = w;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      return !1;
    }
    get names() {
      return { [this.str]: 1 };
    }
  }
  e.Name = r;
  class n extends t {
    constructor(w) {
      super(), this._items = typeof w == "string" ? [w] : w;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      if (this._items.length > 1)
        return !1;
      const w = this._items[0];
      return w === "" || w === '""';
    }
    get str() {
      var w;
      return (w = this._str) !== null && w !== void 0 ? w : this._str = this._items.reduce((P, T) => `${P}${T}`, "");
    }
    get names() {
      var w;
      return (w = this._names) !== null && w !== void 0 ? w : this._names = this._items.reduce((P, T) => (T instanceof r && (P[T.str] = (P[T.str] || 0) + 1), P), {});
    }
  }
  e._Code = n, e.nil = new n("");
  function s(p, ...w) {
    const P = [p[0]];
    let T = 0;
    for (; T < w.length; )
      i(P, w[T]), P.push(p[++T]);
    return new n(P);
  }
  e._ = s;
  const o = new n("+");
  function a(p, ...w) {
    const P = [m(p[0])];
    let T = 0;
    for (; T < w.length; )
      P.push(o), i(P, w[T]), P.push(o, m(p[++T]));
    return c(P), new n(P);
  }
  e.str = a;
  function i(p, w) {
    w instanceof n ? p.push(...w._items) : w instanceof r ? p.push(w) : p.push(f(w));
  }
  e.addCodeArg = i;
  function c(p) {
    let w = 1;
    for (; w < p.length - 1; ) {
      if (p[w] === o) {
        const P = d(p[w - 1], p[w + 1]);
        if (P !== void 0) {
          p.splice(w - 1, 3, P);
          continue;
        }
        p[w++] = "+";
      }
      w++;
    }
  }
  function d(p, w) {
    if (w === '""')
      return p;
    if (p === '""')
      return w;
    if (typeof p == "string")
      return w instanceof r || p[p.length - 1] !== '"' ? void 0 : typeof w != "string" ? `${p.slice(0, -1)}${w}"` : w[0] === '"' ? p.slice(0, -1) + w.slice(1) : void 0;
    if (typeof w == "string" && w[0] === '"' && !(p instanceof r))
      return `"${p}${w.slice(1)}`;
  }
  function u(p, w) {
    return w.emptyStr() ? p : p.emptyStr() ? w : a`${p}${w}`;
  }
  e.strConcat = u;
  function f(p) {
    return typeof p == "number" || typeof p == "boolean" || p === null ? p : m(Array.isArray(p) ? p.join(",") : p);
  }
  function g(p) {
    return new n(m(p));
  }
  e.stringify = g;
  function m(p) {
    return JSON.stringify(p).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  e.safeStringify = m;
  function v(p) {
    return typeof p == "string" && e.IDENTIFIER.test(p) ? new n(`.${p}`) : s`[${p}]`;
  }
  e.getProperty = v;
  function $(p) {
    if (typeof p == "string" && e.IDENTIFIER.test(p))
      return new n(`${p}`);
    throw new Error(`CodeGen: invalid export name: ${p}, use explicit $id name mapping`);
  }
  e.getEsmExportName = $;
  function _(p) {
    return new n(p.toString());
  }
  e.regexpCode = _;
})(pn);
var vo = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.ValueScope = e.ValueScopeName = e.Scope = e.varKinds = e.UsedValueState = void 0;
  const t = pn;
  class r extends Error {
    constructor(d) {
      super(`CodeGen: "code" for ${d} not defined`), this.value = d.value;
    }
  }
  var n;
  (function(c) {
    c[c.Started = 0] = "Started", c[c.Completed = 1] = "Completed";
  })(n || (e.UsedValueState = n = {})), e.varKinds = {
    const: new t.Name("const"),
    let: new t.Name("let"),
    var: new t.Name("var")
  };
  class s {
    constructor({ prefixes: d, parent: u } = {}) {
      this._names = {}, this._prefixes = d, this._parent = u;
    }
    toName(d) {
      return d instanceof t.Name ? d : this.name(d);
    }
    name(d) {
      return new t.Name(this._newName(d));
    }
    _newName(d) {
      const u = this._names[d] || this._nameGroup(d);
      return `${d}${u.index++}`;
    }
    _nameGroup(d) {
      var u, f;
      if (!((f = (u = this._parent) === null || u === void 0 ? void 0 : u._prefixes) === null || f === void 0) && f.has(d) || this._prefixes && !this._prefixes.has(d))
        throw new Error(`CodeGen: prefix "${d}" is not allowed in this scope`);
      return this._names[d] = { prefix: d, index: 0 };
    }
  }
  e.Scope = s;
  class o extends t.Name {
    constructor(d, u) {
      super(u), this.prefix = d;
    }
    setValue(d, { property: u, itemIndex: f }) {
      this.value = d, this.scopePath = (0, t._)`.${new t.Name(u)}[${f}]`;
    }
  }
  e.ValueScopeName = o;
  const a = (0, t._)`\n`;
  class i extends s {
    constructor(d) {
      super(d), this._values = {}, this._scope = d.scope, this.opts = { ...d, _n: d.lines ? a : t.nil };
    }
    get() {
      return this._scope;
    }
    name(d) {
      return new o(d, this._newName(d));
    }
    value(d, u) {
      var f;
      if (u.ref === void 0)
        throw new Error("CodeGen: ref must be passed in value");
      const g = this.toName(d), { prefix: m } = g, v = (f = u.key) !== null && f !== void 0 ? f : u.ref;
      let $ = this._values[m];
      if ($) {
        const w = $.get(v);
        if (w)
          return w;
      } else
        $ = this._values[m] = /* @__PURE__ */ new Map();
      $.set(v, g);
      const _ = this._scope[m] || (this._scope[m] = []), p = _.length;
      return _[p] = u.ref, g.setValue(u, { property: m, itemIndex: p }), g;
    }
    getValue(d, u) {
      const f = this._values[d];
      if (f)
        return f.get(u);
    }
    scopeRefs(d, u = this._values) {
      return this._reduceValues(u, (f) => {
        if (f.scopePath === void 0)
          throw new Error(`CodeGen: name "${f}" has no value`);
        return (0, t._)`${d}${f.scopePath}`;
      });
    }
    scopeCode(d = this._values, u, f) {
      return this._reduceValues(d, (g) => {
        if (g.value === void 0)
          throw new Error(`CodeGen: name "${g}" has no value`);
        return g.value.code;
      }, u, f);
    }
    _reduceValues(d, u, f = {}, g) {
      let m = t.nil;
      for (const v in d) {
        const $ = d[v];
        if (!$)
          continue;
        const _ = f[v] = f[v] || /* @__PURE__ */ new Map();
        $.forEach((p) => {
          if (_.has(p))
            return;
          _.set(p, n.Started);
          let w = u(p);
          if (w) {
            const P = this.opts.es5 ? e.varKinds.var : e.varKinds.const;
            m = (0, t._)`${m}${P} ${p} = ${w};${this.opts._n}`;
          } else if (w = g == null ? void 0 : g(p))
            m = (0, t._)`${m}${w}${this.opts._n}`;
          else
            throw new r(p);
          _.set(p, n.Completed);
        });
      }
      return m;
    }
  }
  e.ValueScope = i;
})(vo);
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.or = e.and = e.not = e.CodeGen = e.operators = e.varKinds = e.ValueScopeName = e.ValueScope = e.Scope = e.Name = e.regexpCode = e.stringify = e.getProperty = e.nil = e.strConcat = e.str = e._ = void 0;
  const t = pn, r = vo;
  var n = pn;
  Object.defineProperty(e, "_", { enumerable: !0, get: function() {
    return n._;
  } }), Object.defineProperty(e, "str", { enumerable: !0, get: function() {
    return n.str;
  } }), Object.defineProperty(e, "strConcat", { enumerable: !0, get: function() {
    return n.strConcat;
  } }), Object.defineProperty(e, "nil", { enumerable: !0, get: function() {
    return n.nil;
  } }), Object.defineProperty(e, "getProperty", { enumerable: !0, get: function() {
    return n.getProperty;
  } }), Object.defineProperty(e, "stringify", { enumerable: !0, get: function() {
    return n.stringify;
  } }), Object.defineProperty(e, "regexpCode", { enumerable: !0, get: function() {
    return n.regexpCode;
  } }), Object.defineProperty(e, "Name", { enumerable: !0, get: function() {
    return n.Name;
  } });
  var s = vo;
  Object.defineProperty(e, "Scope", { enumerable: !0, get: function() {
    return s.Scope;
  } }), Object.defineProperty(e, "ValueScope", { enumerable: !0, get: function() {
    return s.ValueScope;
  } }), Object.defineProperty(e, "ValueScopeName", { enumerable: !0, get: function() {
    return s.ValueScopeName;
  } }), Object.defineProperty(e, "varKinds", { enumerable: !0, get: function() {
    return s.varKinds;
  } }), e.operators = {
    GT: new t._Code(">"),
    GTE: new t._Code(">="),
    LT: new t._Code("<"),
    LTE: new t._Code("<="),
    EQ: new t._Code("==="),
    NEQ: new t._Code("!=="),
    NOT: new t._Code("!"),
    OR: new t._Code("||"),
    AND: new t._Code("&&"),
    ADD: new t._Code("+")
  };
  class o {
    optimizeNodes() {
      return this;
    }
    optimizeNames(l, h) {
      return this;
    }
  }
  class a extends o {
    constructor(l, h, b) {
      super(), this.varKind = l, this.name = h, this.rhs = b;
    }
    render({ es5: l, _n: h }) {
      const b = l ? r.varKinds.var : this.varKind, A = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
      return `${b} ${this.name}${A};` + h;
    }
    optimizeNames(l, h) {
      if (l[this.name.str])
        return this.rhs && (this.rhs = j(this.rhs, l, h)), this;
    }
    get names() {
      return this.rhs instanceof t._CodeOrName ? this.rhs.names : {};
    }
  }
  class i extends o {
    constructor(l, h, b) {
      super(), this.lhs = l, this.rhs = h, this.sideEffects = b;
    }
    render({ _n: l }) {
      return `${this.lhs} = ${this.rhs};` + l;
    }
    optimizeNames(l, h) {
      if (!(this.lhs instanceof t.Name && !l[this.lhs.str] && !this.sideEffects))
        return this.rhs = j(this.rhs, l, h), this;
    }
    get names() {
      const l = this.lhs instanceof t.Name ? {} : { ...this.lhs.names };
      return te(l, this.rhs);
    }
  }
  class c extends i {
    constructor(l, h, b, A) {
      super(l, b, A), this.op = h;
    }
    render({ _n: l }) {
      return `${this.lhs} ${this.op}= ${this.rhs};` + l;
    }
  }
  class d extends o {
    constructor(l) {
      super(), this.label = l, this.names = {};
    }
    render({ _n: l }) {
      return `${this.label}:` + l;
    }
  }
  class u extends o {
    constructor(l) {
      super(), this.label = l, this.names = {};
    }
    render({ _n: l }) {
      return `break${this.label ? ` ${this.label}` : ""};` + l;
    }
  }
  class f extends o {
    constructor(l) {
      super(), this.error = l;
    }
    render({ _n: l }) {
      return `throw ${this.error};` + l;
    }
    get names() {
      return this.error.names;
    }
  }
  class g extends o {
    constructor(l) {
      super(), this.code = l;
    }
    render({ _n: l }) {
      return `${this.code};` + l;
    }
    optimizeNodes() {
      return `${this.code}` ? this : void 0;
    }
    optimizeNames(l, h) {
      return this.code = j(this.code, l, h), this;
    }
    get names() {
      return this.code instanceof t._CodeOrName ? this.code.names : {};
    }
  }
  class m extends o {
    constructor(l = []) {
      super(), this.nodes = l;
    }
    render(l) {
      return this.nodes.reduce((h, b) => h + b.render(l), "");
    }
    optimizeNodes() {
      const { nodes: l } = this;
      let h = l.length;
      for (; h--; ) {
        const b = l[h].optimizeNodes();
        Array.isArray(b) ? l.splice(h, 1, ...b) : b ? l[h] = b : l.splice(h, 1);
      }
      return l.length > 0 ? this : void 0;
    }
    optimizeNames(l, h) {
      const { nodes: b } = this;
      let A = b.length;
      for (; A--; ) {
        const k = b[A];
        k.optimizeNames(l, h) || (C(l, k.names), b.splice(A, 1));
      }
      return b.length > 0 ? this : void 0;
    }
    get names() {
      return this.nodes.reduce((l, h) => G(l, h.names), {});
    }
  }
  class v extends m {
    render(l) {
      return "{" + l._n + super.render(l) + "}" + l._n;
    }
  }
  class $ extends m {
  }
  class _ extends v {
  }
  _.kind = "else";
  class p extends v {
    constructor(l, h) {
      super(h), this.condition = l;
    }
    render(l) {
      let h = `if(${this.condition})` + super.render(l);
      return this.else && (h += "else " + this.else.render(l)), h;
    }
    optimizeNodes() {
      super.optimizeNodes();
      const l = this.condition;
      if (l === !0)
        return this.nodes;
      let h = this.else;
      if (h) {
        const b = h.optimizeNodes();
        h = this.else = Array.isArray(b) ? new _(b) : b;
      }
      if (h)
        return l === !1 ? h instanceof p ? h : h.nodes : this.nodes.length ? this : new p(q(l), h instanceof p ? [h] : h.nodes);
      if (!(l === !1 || !this.nodes.length))
        return this;
    }
    optimizeNames(l, h) {
      var b;
      if (this.else = (b = this.else) === null || b === void 0 ? void 0 : b.optimizeNames(l, h), !!(super.optimizeNames(l, h) || this.else))
        return this.condition = j(this.condition, l, h), this;
    }
    get names() {
      const l = super.names;
      return te(l, this.condition), this.else && G(l, this.else.names), l;
    }
  }
  p.kind = "if";
  class w extends v {
  }
  w.kind = "for";
  class P extends w {
    constructor(l) {
      super(), this.iteration = l;
    }
    render(l) {
      return `for(${this.iteration})` + super.render(l);
    }
    optimizeNames(l, h) {
      if (super.optimizeNames(l, h))
        return this.iteration = j(this.iteration, l, h), this;
    }
    get names() {
      return G(super.names, this.iteration.names);
    }
  }
  class T extends w {
    constructor(l, h, b, A) {
      super(), this.varKind = l, this.name = h, this.from = b, this.to = A;
    }
    render(l) {
      const h = l.es5 ? r.varKinds.var : this.varKind, { name: b, from: A, to: k } = this;
      return `for(${h} ${b}=${A}; ${b}<${k}; ${b}++)` + super.render(l);
    }
    get names() {
      const l = te(super.names, this.from);
      return te(l, this.to);
    }
  }
  class I extends w {
    constructor(l, h, b, A) {
      super(), this.loop = l, this.varKind = h, this.name = b, this.iterable = A;
    }
    render(l) {
      return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(l);
    }
    optimizeNames(l, h) {
      if (super.optimizeNames(l, h))
        return this.iterable = j(this.iterable, l, h), this;
    }
    get names() {
      return G(super.names, this.iterable.names);
    }
  }
  class L extends v {
    constructor(l, h, b) {
      super(), this.name = l, this.args = h, this.async = b;
    }
    render(l) {
      return `${this.async ? "async " : ""}function ${this.name}(${this.args})` + super.render(l);
    }
  }
  L.kind = "func";
  class M extends m {
    render(l) {
      return "return " + super.render(l);
    }
  }
  M.kind = "return";
  class ee extends v {
    render(l) {
      let h = "try" + super.render(l);
      return this.catch && (h += this.catch.render(l)), this.finally && (h += this.finally.render(l)), h;
    }
    optimizeNodes() {
      var l, h;
      return super.optimizeNodes(), (l = this.catch) === null || l === void 0 || l.optimizeNodes(), (h = this.finally) === null || h === void 0 || h.optimizeNodes(), this;
    }
    optimizeNames(l, h) {
      var b, A;
      return super.optimizeNames(l, h), (b = this.catch) === null || b === void 0 || b.optimizeNames(l, h), (A = this.finally) === null || A === void 0 || A.optimizeNames(l, h), this;
    }
    get names() {
      const l = super.names;
      return this.catch && G(l, this.catch.names), this.finally && G(l, this.finally.names), l;
    }
  }
  class he extends v {
    constructor(l) {
      super(), this.error = l;
    }
    render(l) {
      return `catch(${this.error})` + super.render(l);
    }
  }
  he.kind = "catch";
  class pe extends v {
    render(l) {
      return "finally" + super.render(l);
    }
  }
  pe.kind = "finally";
  class V {
    constructor(l, h = {}) {
      this._values = {}, this._blockStarts = [], this._constants = {}, this.opts = { ...h, _n: h.lines ? `
` : "" }, this._extScope = l, this._scope = new r.Scope({ parent: l }), this._nodes = [new $()];
    }
    toString() {
      return this._root.render(this.opts);
    }
    // returns unique name in the internal scope
    name(l) {
      return this._scope.name(l);
    }
    // reserves unique name in the external scope
    scopeName(l) {
      return this._extScope.name(l);
    }
    // reserves unique name in the external scope and assigns value to it
    scopeValue(l, h) {
      const b = this._extScope.value(l, h);
      return (this._values[b.prefix] || (this._values[b.prefix] = /* @__PURE__ */ new Set())).add(b), b;
    }
    getScopeValue(l, h) {
      return this._extScope.getValue(l, h);
    }
    // return code that assigns values in the external scope to the names that are used internally
    // (same names that were returned by gen.scopeName or gen.scopeValue)
    scopeRefs(l) {
      return this._extScope.scopeRefs(l, this._values);
    }
    scopeCode() {
      return this._extScope.scopeCode(this._values);
    }
    _def(l, h, b, A) {
      const k = this._scope.toName(h);
      return b !== void 0 && A && (this._constants[k.str] = b), this._leafNode(new a(l, k, b)), k;
    }
    // `const` declaration (`var` in es5 mode)
    const(l, h, b) {
      return this._def(r.varKinds.const, l, h, b);
    }
    // `let` declaration with optional assignment (`var` in es5 mode)
    let(l, h, b) {
      return this._def(r.varKinds.let, l, h, b);
    }
    // `var` declaration with optional assignment
    var(l, h, b) {
      return this._def(r.varKinds.var, l, h, b);
    }
    // assignment code
    assign(l, h, b) {
      return this._leafNode(new i(l, h, b));
    }
    // `+=` code
    add(l, h) {
      return this._leafNode(new c(l, e.operators.ADD, h));
    }
    // appends passed SafeExpr to code or executes Block
    code(l) {
      return typeof l == "function" ? l() : l !== t.nil && this._leafNode(new g(l)), this;
    }
    // returns code for object literal for the passed argument list of key-value pairs
    object(...l) {
      const h = ["{"];
      for (const [b, A] of l)
        h.length > 1 && h.push(","), h.push(b), (b !== A || this.opts.es5) && (h.push(":"), (0, t.addCodeArg)(h, A));
      return h.push("}"), new t._Code(h);
    }
    // `if` clause (or statement if `thenBody` and, optionally, `elseBody` are passed)
    if(l, h, b) {
      if (this._blockNode(new p(l)), h && b)
        this.code(h).else().code(b).endIf();
      else if (h)
        this.code(h).endIf();
      else if (b)
        throw new Error('CodeGen: "else" body without "then" body');
      return this;
    }
    // `else if` clause - invalid without `if` or after `else` clauses
    elseIf(l) {
      return this._elseNode(new p(l));
    }
    // `else` clause - only valid after `if` or `else if` clauses
    else() {
      return this._elseNode(new _());
    }
    // end `if` statement (needed if gen.if was used only with condition)
    endIf() {
      return this._endBlockNode(p, _);
    }
    _for(l, h) {
      return this._blockNode(l), h && this.code(h).endFor(), this;
    }
    // a generic `for` clause (or statement if `forBody` is passed)
    for(l, h) {
      return this._for(new P(l), h);
    }
    // `for` statement for a range of values
    forRange(l, h, b, A, k = this.opts.es5 ? r.varKinds.var : r.varKinds.let) {
      const X = this._scope.toName(l);
      return this._for(new T(k, X, h, b), () => A(X));
    }
    // `for-of` statement (in es5 mode replace with a normal for loop)
    forOf(l, h, b, A = r.varKinds.const) {
      const k = this._scope.toName(l);
      if (this.opts.es5) {
        const X = h instanceof t.Name ? h : this.var("_arr", h);
        return this.forRange("_i", 0, (0, t._)`${X}.length`, (J) => {
          this.var(k, (0, t._)`${X}[${J}]`), b(k);
        });
      }
      return this._for(new I("of", A, k, h), () => b(k));
    }
    // `for-in` statement.
    // With option `ownProperties` replaced with a `for-of` loop for object keys
    forIn(l, h, b, A = this.opts.es5 ? r.varKinds.var : r.varKinds.const) {
      if (this.opts.ownProperties)
        return this.forOf(l, (0, t._)`Object.keys(${h})`, b);
      const k = this._scope.toName(l);
      return this._for(new I("in", A, k, h), () => b(k));
    }
    // end `for` loop
    endFor() {
      return this._endBlockNode(w);
    }
    // `label` statement
    label(l) {
      return this._leafNode(new d(l));
    }
    // `break` statement
    break(l) {
      return this._leafNode(new u(l));
    }
    // `return` statement
    return(l) {
      const h = new M();
      if (this._blockNode(h), this.code(l), h.nodes.length !== 1)
        throw new Error('CodeGen: "return" should have one node');
      return this._endBlockNode(M);
    }
    // `try` statement
    try(l, h, b) {
      if (!h && !b)
        throw new Error('CodeGen: "try" without "catch" and "finally"');
      const A = new ee();
      if (this._blockNode(A), this.code(l), h) {
        const k = this.name("e");
        this._currNode = A.catch = new he(k), h(k);
      }
      return b && (this._currNode = A.finally = new pe(), this.code(b)), this._endBlockNode(he, pe);
    }
    // `throw` statement
    throw(l) {
      return this._leafNode(new f(l));
    }
    // start self-balancing block
    block(l, h) {
      return this._blockStarts.push(this._nodes.length), l && this.code(l).endBlock(h), this;
    }
    // end the current self-balancing block
    endBlock(l) {
      const h = this._blockStarts.pop();
      if (h === void 0)
        throw new Error("CodeGen: not in self-balancing block");
      const b = this._nodes.length - h;
      if (b < 0 || l !== void 0 && b !== l)
        throw new Error(`CodeGen: wrong number of nodes: ${b} vs ${l} expected`);
      return this._nodes.length = h, this;
    }
    // `function` heading (or definition if funcBody is passed)
    func(l, h = t.nil, b, A) {
      return this._blockNode(new L(l, h, b)), A && this.code(A).endFunc(), this;
    }
    // end function definition
    endFunc() {
      return this._endBlockNode(L);
    }
    optimize(l = 1) {
      for (; l-- > 0; )
        this._root.optimizeNodes(), this._root.optimizeNames(this._root.names, this._constants);
    }
    _leafNode(l) {
      return this._currNode.nodes.push(l), this;
    }
    _blockNode(l) {
      this._currNode.nodes.push(l), this._nodes.push(l);
    }
    _endBlockNode(l, h) {
      const b = this._currNode;
      if (b instanceof l || h && b instanceof h)
        return this._nodes.pop(), this;
      throw new Error(`CodeGen: not in block "${h ? `${l.kind}/${h.kind}` : l.kind}"`);
    }
    _elseNode(l) {
      const h = this._currNode;
      if (!(h instanceof p))
        throw new Error('CodeGen: "else" without "if"');
      return this._currNode = h.else = l, this;
    }
    get _root() {
      return this._nodes[0];
    }
    get _currNode() {
      const l = this._nodes;
      return l[l.length - 1];
    }
    set _currNode(l) {
      const h = this._nodes;
      h[h.length - 1] = l;
    }
  }
  e.CodeGen = V;
  function G(E, l) {
    for (const h in l)
      E[h] = (E[h] || 0) + (l[h] || 0);
    return E;
  }
  function te(E, l) {
    return l instanceof t._CodeOrName ? G(E, l.names) : E;
  }
  function j(E, l, h) {
    if (E instanceof t.Name)
      return b(E);
    if (!A(E))
      return E;
    return new t._Code(E._items.reduce((k, X) => (X instanceof t.Name && (X = b(X)), X instanceof t._Code ? k.push(...X._items) : k.push(X), k), []));
    function b(k) {
      const X = h[k.str];
      return X === void 0 || l[k.str] !== 1 ? k : (delete l[k.str], X);
    }
    function A(k) {
      return k instanceof t._Code && k._items.some((X) => X instanceof t.Name && l[X.str] === 1 && h[X.str] !== void 0);
    }
  }
  function C(E, l) {
    for (const h in l)
      E[h] = (E[h] || 0) - (l[h] || 0);
  }
  function q(E) {
    return typeof E == "boolean" || typeof E == "number" || E === null ? !E : (0, t._)`!${S(E)}`;
  }
  e.not = q;
  const U = y(e.operators.AND);
  function W(...E) {
    return E.reduce(U);
  }
  e.and = W;
  const z = y(e.operators.OR);
  function N(...E) {
    return E.reduce(z);
  }
  e.or = N;
  function y(E) {
    return (l, h) => l === t.nil ? h : h === t.nil ? l : (0, t._)`${S(l)} ${E} ${S(h)}`;
  }
  function S(E) {
    return E instanceof t.Name ? E : (0, t._)`(${E})`;
  }
})(ue);
var H = {};
Object.defineProperty(H, "__esModule", { value: !0 });
H.checkStrictMode = H.getErrorPath = H.Type = H.useFunc = H.setEvaluated = H.evaluatedPropsToName = H.mergeEvaluated = H.eachItem = H.unescapeJsonPointer = H.escapeJsonPointer = H.escapeFragment = H.unescapeFragment = H.schemaRefOrVal = H.schemaHasRulesButRef = H.schemaHasRules = H.checkUnknownRules = H.alwaysValidSchema = H.toHash = void 0;
const ye = ue, Mg = pn;
function Lg(e) {
  const t = {};
  for (const r of e)
    t[r] = !0;
  return t;
}
H.toHash = Lg;
function Fg(e, t) {
  return typeof t == "boolean" ? t : Object.keys(t).length === 0 ? !0 : (yu(e, t), !$u(t, e.self.RULES.all));
}
H.alwaysValidSchema = Fg;
function yu(e, t = e.schema) {
  const { opts: r, self: n } = e;
  if (!r.strictSchema || typeof t == "boolean")
    return;
  const s = n.RULES.keywords;
  for (const o in t)
    s[o] || vu(e, `unknown keyword: "${o}"`);
}
H.checkUnknownRules = yu;
function $u(e, t) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (t[r])
      return !0;
  return !1;
}
H.schemaHasRules = $u;
function Vg(e, t) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (r !== "$ref" && t.all[r])
      return !0;
  return !1;
}
H.schemaHasRulesButRef = Vg;
function Ug({ topSchemaRef: e, schemaPath: t }, r, n, s) {
  if (!s) {
    if (typeof r == "number" || typeof r == "boolean")
      return r;
    if (typeof r == "string")
      return (0, ye._)`${r}`;
  }
  return (0, ye._)`${e}${t}${(0, ye.getProperty)(n)}`;
}
H.schemaRefOrVal = Ug;
function zg(e) {
  return gu(decodeURIComponent(e));
}
H.unescapeFragment = zg;
function qg(e) {
  return encodeURIComponent(Da(e));
}
H.escapeFragment = qg;
function Da(e) {
  return typeof e == "number" ? `${e}` : e.replace(/~/g, "~0").replace(/\//g, "~1");
}
H.escapeJsonPointer = Da;
function gu(e) {
  return e.replace(/~1/g, "/").replace(/~0/g, "~");
}
H.unescapeJsonPointer = gu;
function Gg(e, t) {
  if (Array.isArray(e))
    for (const r of e)
      t(r);
  else
    t(e);
}
H.eachItem = Gg;
function dc({ mergeNames: e, mergeToName: t, mergeValues: r, resultToName: n }) {
  return (s, o, a, i) => {
    const c = a === void 0 ? o : a instanceof ye.Name ? (o instanceof ye.Name ? e(s, o, a) : t(s, o, a), a) : o instanceof ye.Name ? (t(s, a, o), o) : r(o, a);
    return i === ye.Name && !(c instanceof ye.Name) ? n(s, c) : c;
  };
}
H.mergeEvaluated = {
  props: dc({
    mergeNames: (e, t, r) => e.if((0, ye._)`${r} !== true && ${t} !== undefined`, () => {
      e.if((0, ye._)`${t} === true`, () => e.assign(r, !0), () => e.assign(r, (0, ye._)`${r} || {}`).code((0, ye._)`Object.assign(${r}, ${t})`));
    }),
    mergeToName: (e, t, r) => e.if((0, ye._)`${r} !== true`, () => {
      t === !0 ? e.assign(r, !0) : (e.assign(r, (0, ye._)`${r} || {}`), Ma(e, r, t));
    }),
    mergeValues: (e, t) => e === !0 ? !0 : { ...e, ...t },
    resultToName: _u
  }),
  items: dc({
    mergeNames: (e, t, r) => e.if((0, ye._)`${r} !== true && ${t} !== undefined`, () => e.assign(r, (0, ye._)`${t} === true ? true : ${r} > ${t} ? ${r} : ${t}`)),
    mergeToName: (e, t, r) => e.if((0, ye._)`${r} !== true`, () => e.assign(r, t === !0 ? !0 : (0, ye._)`${r} > ${t} ? ${r} : ${t}`)),
    mergeValues: (e, t) => e === !0 ? !0 : Math.max(e, t),
    resultToName: (e, t) => e.var("items", t)
  })
};
function _u(e, t) {
  if (t === !0)
    return e.var("props", !0);
  const r = e.var("props", (0, ye._)`{}`);
  return t !== void 0 && Ma(e, r, t), r;
}
H.evaluatedPropsToName = _u;
function Ma(e, t, r) {
  Object.keys(r).forEach((n) => e.assign((0, ye._)`${t}${(0, ye.getProperty)(n)}`, !0));
}
H.setEvaluated = Ma;
const fc = {};
function Kg(e, t) {
  return e.scopeValue("func", {
    ref: t,
    code: fc[t.code] || (fc[t.code] = new Mg._Code(t.code))
  });
}
H.useFunc = Kg;
var Eo;
(function(e) {
  e[e.Num = 0] = "Num", e[e.Str = 1] = "Str";
})(Eo || (H.Type = Eo = {}));
function Hg(e, t, r) {
  if (e instanceof ye.Name) {
    const n = t === Eo.Num;
    return r ? n ? (0, ye._)`"[" + ${e} + "]"` : (0, ye._)`"['" + ${e} + "']"` : n ? (0, ye._)`"/" + ${e}` : (0, ye._)`"/" + ${e}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
  }
  return r ? (0, ye.getProperty)(e).toString() : "/" + Da(e);
}
H.getErrorPath = Hg;
function vu(e, t, r = e.opts.strictSchema) {
  if (r) {
    if (t = `strict mode: ${t}`, r === !0)
      throw new Error(t);
    e.self.logger.warn(t);
  }
}
H.checkStrictMode = vu;
var Nt = {};
Object.defineProperty(Nt, "__esModule", { value: !0 });
const Ue = ue, Bg = {
  // validation function arguments
  data: new Ue.Name("data"),
  // data passed to validation function
  // args passed from referencing schema
  valCxt: new Ue.Name("valCxt"),
  // validation/data context - should not be used directly, it is destructured to the names below
  instancePath: new Ue.Name("instancePath"),
  parentData: new Ue.Name("parentData"),
  parentDataProperty: new Ue.Name("parentDataProperty"),
  rootData: new Ue.Name("rootData"),
  // root data - same as the data passed to the first/top validation function
  dynamicAnchors: new Ue.Name("dynamicAnchors"),
  // used to support recursiveRef and dynamicRef
  // function scoped variables
  vErrors: new Ue.Name("vErrors"),
  // null or array of validation errors
  errors: new Ue.Name("errors"),
  // counter of validation errors
  this: new Ue.Name("this"),
  // "globals"
  self: new Ue.Name("self"),
  scope: new Ue.Name("scope"),
  // JTD serialize/parse name for JSON string and position
  json: new Ue.Name("json"),
  jsonPos: new Ue.Name("jsonPos"),
  jsonLen: new Ue.Name("jsonLen"),
  jsonPart: new Ue.Name("jsonPart")
};
Nt.default = Bg;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.extendErrors = e.resetErrorsCount = e.reportExtraError = e.reportError = e.keyword$DataError = e.keywordError = void 0;
  const t = ue, r = H, n = Nt;
  e.keywordError = {
    message: ({ keyword: _ }) => (0, t.str)`must pass "${_}" keyword validation`
  }, e.keyword$DataError = {
    message: ({ keyword: _, schemaType: p }) => p ? (0, t.str)`"${_}" keyword must be ${p} ($data)` : (0, t.str)`"${_}" keyword is invalid ($data)`
  };
  function s(_, p = e.keywordError, w, P) {
    const { it: T } = _, { gen: I, compositeRule: L, allErrors: M } = T, ee = f(_, p, w);
    P ?? (L || M) ? c(I, ee) : d(T, (0, t._)`[${ee}]`);
  }
  e.reportError = s;
  function o(_, p = e.keywordError, w) {
    const { it: P } = _, { gen: T, compositeRule: I, allErrors: L } = P, M = f(_, p, w);
    c(T, M), I || L || d(P, n.default.vErrors);
  }
  e.reportExtraError = o;
  function a(_, p) {
    _.assign(n.default.errors, p), _.if((0, t._)`${n.default.vErrors} !== null`, () => _.if(p, () => _.assign((0, t._)`${n.default.vErrors}.length`, p), () => _.assign(n.default.vErrors, null)));
  }
  e.resetErrorsCount = a;
  function i({ gen: _, keyword: p, schemaValue: w, data: P, errsCount: T, it: I }) {
    if (T === void 0)
      throw new Error("ajv implementation error");
    const L = _.name("err");
    _.forRange("i", T, n.default.errors, (M) => {
      _.const(L, (0, t._)`${n.default.vErrors}[${M}]`), _.if((0, t._)`${L}.instancePath === undefined`, () => _.assign((0, t._)`${L}.instancePath`, (0, t.strConcat)(n.default.instancePath, I.errorPath))), _.assign((0, t._)`${L}.schemaPath`, (0, t.str)`${I.errSchemaPath}/${p}`), I.opts.verbose && (_.assign((0, t._)`${L}.schema`, w), _.assign((0, t._)`${L}.data`, P));
    });
  }
  e.extendErrors = i;
  function c(_, p) {
    const w = _.const("err", p);
    _.if((0, t._)`${n.default.vErrors} === null`, () => _.assign(n.default.vErrors, (0, t._)`[${w}]`), (0, t._)`${n.default.vErrors}.push(${w})`), _.code((0, t._)`${n.default.errors}++`);
  }
  function d(_, p) {
    const { gen: w, validateName: P, schemaEnv: T } = _;
    T.$async ? w.throw((0, t._)`new ${_.ValidationError}(${p})`) : (w.assign((0, t._)`${P}.errors`, p), w.return(!1));
  }
  const u = {
    keyword: new t.Name("keyword"),
    schemaPath: new t.Name("schemaPath"),
    // also used in JTD errors
    params: new t.Name("params"),
    propertyName: new t.Name("propertyName"),
    message: new t.Name("message"),
    schema: new t.Name("schema"),
    parentSchema: new t.Name("parentSchema")
  };
  function f(_, p, w) {
    const { createErrors: P } = _.it;
    return P === !1 ? (0, t._)`{}` : g(_, p, w);
  }
  function g(_, p, w = {}) {
    const { gen: P, it: T } = _, I = [
      m(T, w),
      v(_, w)
    ];
    return $(_, p, I), P.object(...I);
  }
  function m({ errorPath: _ }, { instancePath: p }) {
    const w = p ? (0, t.str)`${_}${(0, r.getErrorPath)(p, r.Type.Str)}` : _;
    return [n.default.instancePath, (0, t.strConcat)(n.default.instancePath, w)];
  }
  function v({ keyword: _, it: { errSchemaPath: p } }, { schemaPath: w, parentSchema: P }) {
    let T = P ? p : (0, t.str)`${p}/${_}`;
    return w && (T = (0, t.str)`${T}${(0, r.getErrorPath)(w, r.Type.Str)}`), [u.schemaPath, T];
  }
  function $(_, { params: p, message: w }, P) {
    const { keyword: T, data: I, schemaValue: L, it: M } = _, { opts: ee, propertyName: he, topSchemaRef: pe, schemaPath: V } = M;
    P.push([u.keyword, T], [u.params, typeof p == "function" ? p(_) : p || (0, t._)`{}`]), ee.messages && P.push([u.message, typeof w == "function" ? w(_) : w]), ee.verbose && P.push([u.schema, L], [u.parentSchema, (0, t._)`${pe}${V}`], [n.default.data, I]), he && P.push([u.propertyName, he]);
  }
})(gn);
var hc;
function Wg() {
  if (hc) return sr;
  hc = 1, Object.defineProperty(sr, "__esModule", { value: !0 }), sr.boolOrEmptySchema = sr.topBoolOrEmptySchema = void 0;
  const e = gn, t = ue, r = Nt, n = {
    message: "boolean schema is false"
  };
  function s(i) {
    const { gen: c, schema: d, validateName: u } = i;
    d === !1 ? a(i, !1) : typeof d == "object" && d.$async === !0 ? c.return(r.default.data) : (c.assign((0, t._)`${u}.errors`, null), c.return(!0));
  }
  sr.topBoolOrEmptySchema = s;
  function o(i, c) {
    const { gen: d, schema: u } = i;
    u === !1 ? (d.var(c, !1), a(i)) : d.var(c, !0);
  }
  sr.boolOrEmptySchema = o;
  function a(i, c) {
    const { gen: d, data: u } = i, f = {
      gen: d,
      keyword: "false schema",
      data: u,
      schema: !1,
      schemaCode: !1,
      schemaValue: !1,
      params: {},
      it: i
    };
    (0, e.reportError)(f, n, void 0, c);
  }
  return sr;
}
var Te = {}, $r = {};
Object.defineProperty($r, "__esModule", { value: !0 });
$r.getRules = $r.isJSONType = void 0;
const Jg = ["string", "number", "integer", "boolean", "null", "object", "array"], Xg = new Set(Jg);
function Yg(e) {
  return typeof e == "string" && Xg.has(e);
}
$r.isJSONType = Yg;
function xg() {
  const e = {
    number: { type: "number", rules: [] },
    string: { type: "string", rules: [] },
    array: { type: "array", rules: [] },
    object: { type: "object", rules: [] }
  };
  return {
    types: { ...e, integer: !0, boolean: !0, null: !0 },
    rules: [{ rules: [] }, e.number, e.string, e.array, e.object],
    post: { rules: [] },
    all: {},
    keywords: {}
  };
}
$r.getRules = xg;
var It = {}, pc;
function Eu() {
  if (pc) return It;
  pc = 1, Object.defineProperty(It, "__esModule", { value: !0 }), It.shouldUseRule = It.shouldUseGroup = It.schemaHasRulesForType = void 0;
  function e({ schema: n, self: s }, o) {
    const a = s.RULES.types[o];
    return a && a !== !0 && t(n, a);
  }
  It.schemaHasRulesForType = e;
  function t(n, s) {
    return s.rules.some((o) => r(n, o));
  }
  It.shouldUseGroup = t;
  function r(n, s) {
    var o;
    return n[s.keyword] !== void 0 || ((o = s.definition.implements) === null || o === void 0 ? void 0 : o.some((a) => n[a] !== void 0));
  }
  return It.shouldUseRule = r, It;
}
Object.defineProperty(Te, "__esModule", { value: !0 });
Te.reportTypeError = Te.checkDataTypes = Te.checkDataType = Te.coerceAndCheckDataType = Te.getJSONTypes = Te.getSchemaTypes = Te.DataType = void 0;
const Qg = $r, Zg = Eu(), e_ = gn, le = ue, wu = H;
var Ir;
(function(e) {
  e[e.Correct = 0] = "Correct", e[e.Wrong = 1] = "Wrong";
})(Ir || (Te.DataType = Ir = {}));
function t_(e) {
  const t = Su(e.type);
  if (t.includes("null")) {
    if (e.nullable === !1)
      throw new Error("type: null contradicts nullable: false");
  } else {
    if (!t.length && e.nullable !== void 0)
      throw new Error('"nullable" cannot be used without "type"');
    e.nullable === !0 && t.push("null");
  }
  return t;
}
Te.getSchemaTypes = t_;
function Su(e) {
  const t = Array.isArray(e) ? e : e ? [e] : [];
  if (t.every(Qg.isJSONType))
    return t;
  throw new Error("type must be JSONType or JSONType[]: " + t.join(","));
}
Te.getJSONTypes = Su;
function r_(e, t) {
  const { gen: r, data: n, opts: s } = e, o = n_(t, s.coerceTypes), a = t.length > 0 && !(o.length === 0 && t.length === 1 && (0, Zg.schemaHasRulesForType)(e, t[0]));
  if (a) {
    const i = La(t, n, s.strictNumbers, Ir.Wrong);
    r.if(i, () => {
      o.length ? s_(e, t, o) : Fa(e);
    });
  }
  return a;
}
Te.coerceAndCheckDataType = r_;
const bu = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
function n_(e, t) {
  return t ? e.filter((r) => bu.has(r) || t === "array" && r === "array") : [];
}
function s_(e, t, r) {
  const { gen: n, data: s, opts: o } = e, a = n.let("dataType", (0, le._)`typeof ${s}`), i = n.let("coerced", (0, le._)`undefined`);
  o.coerceTypes === "array" && n.if((0, le._)`${a} == 'object' && Array.isArray(${s}) && ${s}.length == 1`, () => n.assign(s, (0, le._)`${s}[0]`).assign(a, (0, le._)`typeof ${s}`).if(La(t, s, o.strictNumbers), () => n.assign(i, s))), n.if((0, le._)`${i} !== undefined`);
  for (const d of r)
    (bu.has(d) || d === "array" && o.coerceTypes === "array") && c(d);
  n.else(), Fa(e), n.endIf(), n.if((0, le._)`${i} !== undefined`, () => {
    n.assign(s, i), o_(e, i);
  });
  function c(d) {
    switch (d) {
      case "string":
        n.elseIf((0, le._)`${a} == "number" || ${a} == "boolean"`).assign(i, (0, le._)`"" + ${s}`).elseIf((0, le._)`${s} === null`).assign(i, (0, le._)`""`);
        return;
      case "number":
        n.elseIf((0, le._)`${a} == "boolean" || ${s} === null
              || (${a} == "string" && ${s} && ${s} == +${s})`).assign(i, (0, le._)`+${s}`);
        return;
      case "integer":
        n.elseIf((0, le._)`${a} === "boolean" || ${s} === null
              || (${a} === "string" && ${s} && ${s} == +${s} && !(${s} % 1))`).assign(i, (0, le._)`+${s}`);
        return;
      case "boolean":
        n.elseIf((0, le._)`${s} === "false" || ${s} === 0 || ${s} === null`).assign(i, !1).elseIf((0, le._)`${s} === "true" || ${s} === 1`).assign(i, !0);
        return;
      case "null":
        n.elseIf((0, le._)`${s} === "" || ${s} === 0 || ${s} === false`), n.assign(i, null);
        return;
      case "array":
        n.elseIf((0, le._)`${a} === "string" || ${a} === "number"
              || ${a} === "boolean" || ${s} === null`).assign(i, (0, le._)`[${s}]`);
    }
  }
}
function o_({ gen: e, parentData: t, parentDataProperty: r }, n) {
  e.if((0, le._)`${t} !== undefined`, () => e.assign((0, le._)`${t}[${r}]`, n));
}
function wo(e, t, r, n = Ir.Correct) {
  const s = n === Ir.Correct ? le.operators.EQ : le.operators.NEQ;
  let o;
  switch (e) {
    case "null":
      return (0, le._)`${t} ${s} null`;
    case "array":
      o = (0, le._)`Array.isArray(${t})`;
      break;
    case "object":
      o = (0, le._)`${t} && typeof ${t} == "object" && !Array.isArray(${t})`;
      break;
    case "integer":
      o = a((0, le._)`!(${t} % 1) && !isNaN(${t})`);
      break;
    case "number":
      o = a();
      break;
    default:
      return (0, le._)`typeof ${t} ${s} ${e}`;
  }
  return n === Ir.Correct ? o : (0, le.not)(o);
  function a(i = le.nil) {
    return (0, le.and)((0, le._)`typeof ${t} == "number"`, i, r ? (0, le._)`isFinite(${t})` : le.nil);
  }
}
Te.checkDataType = wo;
function La(e, t, r, n) {
  if (e.length === 1)
    return wo(e[0], t, r, n);
  let s;
  const o = (0, wu.toHash)(e);
  if (o.array && o.object) {
    const a = (0, le._)`typeof ${t} != "object"`;
    s = o.null ? a : (0, le._)`!${t} || ${a}`, delete o.null, delete o.array, delete o.object;
  } else
    s = le.nil;
  o.number && delete o.integer;
  for (const a in o)
    s = (0, le.and)(s, wo(a, t, r, n));
  return s;
}
Te.checkDataTypes = La;
const a_ = {
  message: ({ schema: e }) => `must be ${e}`,
  params: ({ schema: e, schemaValue: t }) => typeof e == "string" ? (0, le._)`{type: ${e}}` : (0, le._)`{type: ${t}}`
};
function Fa(e) {
  const t = i_(e);
  (0, e_.reportError)(t, a_);
}
Te.reportTypeError = Fa;
function i_(e) {
  const { gen: t, data: r, schema: n } = e, s = (0, wu.schemaRefOrVal)(e, n, "type");
  return {
    gen: t,
    keyword: "type",
    data: r,
    schema: n.type,
    schemaCode: s,
    schemaValue: s,
    parentSchema: n,
    params: {},
    it: e
  };
}
var Yr = {}, mc;
function c_() {
  if (mc) return Yr;
  mc = 1, Object.defineProperty(Yr, "__esModule", { value: !0 }), Yr.assignDefaults = void 0;
  const e = ue, t = H;
  function r(s, o) {
    const { properties: a, items: i } = s.schema;
    if (o === "object" && a)
      for (const c in a)
        n(s, c, a[c].default);
    else o === "array" && Array.isArray(i) && i.forEach((c, d) => n(s, d, c.default));
  }
  Yr.assignDefaults = r;
  function n(s, o, a) {
    const { gen: i, compositeRule: c, data: d, opts: u } = s;
    if (a === void 0)
      return;
    const f = (0, e._)`${d}${(0, e.getProperty)(o)}`;
    if (c) {
      (0, t.checkStrictMode)(s, `default is ignored for: ${f}`);
      return;
    }
    let g = (0, e._)`${f} === undefined`;
    u.useDefaults === "empty" && (g = (0, e._)`${g} || ${f} === null || ${f} === ""`), i.if(g, (0, e._)`${f} = ${(0, e.stringify)(a)}`);
  }
  return Yr;
}
var it = {}, fe = {};
Object.defineProperty(fe, "__esModule", { value: !0 });
fe.validateUnion = fe.validateArray = fe.usePattern = fe.callValidateCode = fe.schemaProperties = fe.allSchemaProperties = fe.noPropertyInData = fe.propertyInData = fe.isOwnProperty = fe.hasPropFunc = fe.reportMissingProp = fe.checkMissingProp = fe.checkReportMissingProp = void 0;
const ge = ue, Va = H, zt = Nt, l_ = H;
function u_(e, t) {
  const { gen: r, data: n, it: s } = e;
  r.if(za(r, n, t, s.opts.ownProperties), () => {
    e.setParams({ missingProperty: (0, ge._)`${t}` }, !0), e.error();
  });
}
fe.checkReportMissingProp = u_;
function d_({ gen: e, data: t, it: { opts: r } }, n, s) {
  return (0, ge.or)(...n.map((o) => (0, ge.and)(za(e, t, o, r.ownProperties), (0, ge._)`${s} = ${o}`)));
}
fe.checkMissingProp = d_;
function f_(e, t) {
  e.setParams({ missingProperty: t }, !0), e.error();
}
fe.reportMissingProp = f_;
function Pu(e) {
  return e.scopeValue("func", {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    ref: Object.prototype.hasOwnProperty,
    code: (0, ge._)`Object.prototype.hasOwnProperty`
  });
}
fe.hasPropFunc = Pu;
function Ua(e, t, r) {
  return (0, ge._)`${Pu(e)}.call(${t}, ${r})`;
}
fe.isOwnProperty = Ua;
function h_(e, t, r, n) {
  const s = (0, ge._)`${t}${(0, ge.getProperty)(r)} !== undefined`;
  return n ? (0, ge._)`${s} && ${Ua(e, t, r)}` : s;
}
fe.propertyInData = h_;
function za(e, t, r, n) {
  const s = (0, ge._)`${t}${(0, ge.getProperty)(r)} === undefined`;
  return n ? (0, ge.or)(s, (0, ge.not)(Ua(e, t, r))) : s;
}
fe.noPropertyInData = za;
function Nu(e) {
  return e ? Object.keys(e).filter((t) => t !== "__proto__") : [];
}
fe.allSchemaProperties = Nu;
function p_(e, t) {
  return Nu(t).filter((r) => !(0, Va.alwaysValidSchema)(e, t[r]));
}
fe.schemaProperties = p_;
function m_({ schemaCode: e, data: t, it: { gen: r, topSchemaRef: n, schemaPath: s, errorPath: o }, it: a }, i, c, d) {
  const u = d ? (0, ge._)`${e}, ${t}, ${n}${s}` : t, f = [
    [zt.default.instancePath, (0, ge.strConcat)(zt.default.instancePath, o)],
    [zt.default.parentData, a.parentData],
    [zt.default.parentDataProperty, a.parentDataProperty],
    [zt.default.rootData, zt.default.rootData]
  ];
  a.opts.dynamicRef && f.push([zt.default.dynamicAnchors, zt.default.dynamicAnchors]);
  const g = (0, ge._)`${u}, ${r.object(...f)}`;
  return c !== ge.nil ? (0, ge._)`${i}.call(${c}, ${g})` : (0, ge._)`${i}(${g})`;
}
fe.callValidateCode = m_;
const y_ = (0, ge._)`new RegExp`;
function $_({ gen: e, it: { opts: t } }, r) {
  const n = t.unicodeRegExp ? "u" : "", { regExp: s } = t.code, o = s(r, n);
  return e.scopeValue("pattern", {
    key: o.toString(),
    ref: o,
    code: (0, ge._)`${s.code === "new RegExp" ? y_ : (0, l_.useFunc)(e, s)}(${r}, ${n})`
  });
}
fe.usePattern = $_;
function g_(e) {
  const { gen: t, data: r, keyword: n, it: s } = e, o = t.name("valid");
  if (s.allErrors) {
    const i = t.let("valid", !0);
    return a(() => t.assign(i, !1)), i;
  }
  return t.var(o, !0), a(() => t.break()), o;
  function a(i) {
    const c = t.const("len", (0, ge._)`${r}.length`);
    t.forRange("i", 0, c, (d) => {
      e.subschema({
        keyword: n,
        dataProp: d,
        dataPropType: Va.Type.Num
      }, o), t.if((0, ge.not)(o), i);
    });
  }
}
fe.validateArray = g_;
function __(e) {
  const { gen: t, schema: r, keyword: n, it: s } = e;
  if (!Array.isArray(r))
    throw new Error("ajv implementation error");
  if (r.some((c) => (0, Va.alwaysValidSchema)(s, c)) && !s.opts.unevaluated)
    return;
  const a = t.let("valid", !1), i = t.name("_valid");
  t.block(() => r.forEach((c, d) => {
    const u = e.subschema({
      keyword: n,
      schemaProp: d,
      compositeRule: !0
    }, i);
    t.assign(a, (0, ge._)`${a} || ${i}`), e.mergeValidEvaluated(u, i) || t.if((0, ge.not)(a));
  })), e.result(a, () => e.reset(), () => e.error(!0));
}
fe.validateUnion = __;
var yc;
function v_() {
  if (yc) return it;
  yc = 1, Object.defineProperty(it, "__esModule", { value: !0 }), it.validateKeywordUsage = it.validSchemaType = it.funcKeywordCode = it.macroKeywordCode = void 0;
  const e = ue, t = Nt, r = fe, n = gn;
  function s(g, m) {
    const { gen: v, keyword: $, schema: _, parentSchema: p, it: w } = g, P = m.macro.call(w.self, _, p, w), T = d(v, $, P);
    w.opts.validateSchema !== !1 && w.self.validateSchema(P, !0);
    const I = v.name("valid");
    g.subschema({
      schema: P,
      schemaPath: e.nil,
      errSchemaPath: `${w.errSchemaPath}/${$}`,
      topSchemaRef: T,
      compositeRule: !0
    }, I), g.pass(I, () => g.error(!0));
  }
  it.macroKeywordCode = s;
  function o(g, m) {
    var v;
    const { gen: $, keyword: _, schema: p, parentSchema: w, $data: P, it: T } = g;
    c(T, m);
    const I = !P && m.compile ? m.compile.call(T.self, p, w, T) : m.validate, L = d($, _, I), M = $.let("valid");
    g.block$data(M, ee), g.ok((v = m.valid) !== null && v !== void 0 ? v : M);
    function ee() {
      if (m.errors === !1)
        V(), m.modifying && a(g), G(() => g.error());
      else {
        const te = m.async ? he() : pe();
        m.modifying && a(g), G(() => i(g, te));
      }
    }
    function he() {
      const te = $.let("ruleErrs", null);
      return $.try(() => V((0, e._)`await `), (j) => $.assign(M, !1).if((0, e._)`${j} instanceof ${T.ValidationError}`, () => $.assign(te, (0, e._)`${j}.errors`), () => $.throw(j))), te;
    }
    function pe() {
      const te = (0, e._)`${L}.errors`;
      return $.assign(te, null), V(e.nil), te;
    }
    function V(te = m.async ? (0, e._)`await ` : e.nil) {
      const j = T.opts.passContext ? t.default.this : t.default.self, C = !("compile" in m && !P || m.schema === !1);
      $.assign(M, (0, e._)`${te}${(0, r.callValidateCode)(g, L, j, C)}`, m.modifying);
    }
    function G(te) {
      var j;
      $.if((0, e.not)((j = m.valid) !== null && j !== void 0 ? j : M), te);
    }
  }
  it.funcKeywordCode = o;
  function a(g) {
    const { gen: m, data: v, it: $ } = g;
    m.if($.parentData, () => m.assign(v, (0, e._)`${$.parentData}[${$.parentDataProperty}]`));
  }
  function i(g, m) {
    const { gen: v } = g;
    v.if((0, e._)`Array.isArray(${m})`, () => {
      v.assign(t.default.vErrors, (0, e._)`${t.default.vErrors} === null ? ${m} : ${t.default.vErrors}.concat(${m})`).assign(t.default.errors, (0, e._)`${t.default.vErrors}.length`), (0, n.extendErrors)(g);
    }, () => g.error());
  }
  function c({ schemaEnv: g }, m) {
    if (m.async && !g.$async)
      throw new Error("async keyword in sync schema");
  }
  function d(g, m, v) {
    if (v === void 0)
      throw new Error(`keyword "${m}" failed to compile`);
    return g.scopeValue("keyword", typeof v == "function" ? { ref: v } : { ref: v, code: (0, e.stringify)(v) });
  }
  function u(g, m, v = !1) {
    return !m.length || m.some(($) => $ === "array" ? Array.isArray(g) : $ === "object" ? g && typeof g == "object" && !Array.isArray(g) : typeof g == $ || v && typeof g > "u");
  }
  it.validSchemaType = u;
  function f({ schema: g, opts: m, self: v, errSchemaPath: $ }, _, p) {
    if (Array.isArray(_.keyword) ? !_.keyword.includes(p) : _.keyword !== p)
      throw new Error("ajv implementation error");
    const w = _.dependencies;
    if (w != null && w.some((P) => !Object.prototype.hasOwnProperty.call(g, P)))
      throw new Error(`parent schema must have dependencies of ${p}: ${w.join(",")}`);
    if (_.validateSchema && !_.validateSchema(g[p])) {
      const T = `keyword "${p}" value is invalid at path "${$}": ` + v.errorsText(_.validateSchema.errors);
      if (m.validateSchema === "log")
        v.logger.error(T);
      else
        throw new Error(T);
    }
  }
  return it.validateKeywordUsage = f, it;
}
var jt = {}, $c;
function E_() {
  if ($c) return jt;
  $c = 1, Object.defineProperty(jt, "__esModule", { value: !0 }), jt.extendSubschemaMode = jt.extendSubschemaData = jt.getSubschema = void 0;
  const e = ue, t = H;
  function r(o, { keyword: a, schemaProp: i, schema: c, schemaPath: d, errSchemaPath: u, topSchemaRef: f }) {
    if (a !== void 0 && c !== void 0)
      throw new Error('both "keyword" and "schema" passed, only one allowed');
    if (a !== void 0) {
      const g = o.schema[a];
      return i === void 0 ? {
        schema: g,
        schemaPath: (0, e._)`${o.schemaPath}${(0, e.getProperty)(a)}`,
        errSchemaPath: `${o.errSchemaPath}/${a}`
      } : {
        schema: g[i],
        schemaPath: (0, e._)`${o.schemaPath}${(0, e.getProperty)(a)}${(0, e.getProperty)(i)}`,
        errSchemaPath: `${o.errSchemaPath}/${a}/${(0, t.escapeFragment)(i)}`
      };
    }
    if (c !== void 0) {
      if (d === void 0 || u === void 0 || f === void 0)
        throw new Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
      return {
        schema: c,
        schemaPath: d,
        topSchemaRef: f,
        errSchemaPath: u
      };
    }
    throw new Error('either "keyword" or "schema" must be passed');
  }
  jt.getSubschema = r;
  function n(o, a, { dataProp: i, dataPropType: c, data: d, dataTypes: u, propertyName: f }) {
    if (d !== void 0 && i !== void 0)
      throw new Error('both "data" and "dataProp" passed, only one allowed');
    const { gen: g } = a;
    if (i !== void 0) {
      const { errorPath: v, dataPathArr: $, opts: _ } = a, p = g.let("data", (0, e._)`${a.data}${(0, e.getProperty)(i)}`, !0);
      m(p), o.errorPath = (0, e.str)`${v}${(0, t.getErrorPath)(i, c, _.jsPropertySyntax)}`, o.parentDataProperty = (0, e._)`${i}`, o.dataPathArr = [...$, o.parentDataProperty];
    }
    if (d !== void 0) {
      const v = d instanceof e.Name ? d : g.let("data", d, !0);
      m(v), f !== void 0 && (o.propertyName = f);
    }
    u && (o.dataTypes = u);
    function m(v) {
      o.data = v, o.dataLevel = a.dataLevel + 1, o.dataTypes = [], a.definedProperties = /* @__PURE__ */ new Set(), o.parentData = a.data, o.dataNames = [...a.dataNames, v];
    }
  }
  jt.extendSubschemaData = n;
  function s(o, { jtdDiscriminator: a, jtdMetadata: i, compositeRule: c, createErrors: d, allErrors: u }) {
    c !== void 0 && (o.compositeRule = c), d !== void 0 && (o.createErrors = d), u !== void 0 && (o.allErrors = u), o.jtdDiscriminator = a, o.jtdMetadata = i;
  }
  return jt.extendSubschemaMode = s, jt;
}
var De = {}, Ru = { exports: {} }, Yt = Ru.exports = function(e, t, r) {
  typeof t == "function" && (r = t, t = {}), r = t.cb || r;
  var n = typeof r == "function" ? r : r.pre || function() {
  }, s = r.post || function() {
  };
  xn(t, n, s, e, "", e);
};
Yt.keywords = {
  additionalItems: !0,
  items: !0,
  contains: !0,
  additionalProperties: !0,
  propertyNames: !0,
  not: !0,
  if: !0,
  then: !0,
  else: !0
};
Yt.arrayKeywords = {
  items: !0,
  allOf: !0,
  anyOf: !0,
  oneOf: !0
};
Yt.propsKeywords = {
  $defs: !0,
  definitions: !0,
  properties: !0,
  patternProperties: !0,
  dependencies: !0
};
Yt.skipKeywords = {
  default: !0,
  enum: !0,
  const: !0,
  required: !0,
  maximum: !0,
  minimum: !0,
  exclusiveMaximum: !0,
  exclusiveMinimum: !0,
  multipleOf: !0,
  maxLength: !0,
  minLength: !0,
  pattern: !0,
  format: !0,
  maxItems: !0,
  minItems: !0,
  uniqueItems: !0,
  maxProperties: !0,
  minProperties: !0
};
function xn(e, t, r, n, s, o, a, i, c, d) {
  if (n && typeof n == "object" && !Array.isArray(n)) {
    t(n, s, o, a, i, c, d);
    for (var u in n) {
      var f = n[u];
      if (Array.isArray(f)) {
        if (u in Yt.arrayKeywords)
          for (var g = 0; g < f.length; g++)
            xn(e, t, r, f[g], s + "/" + u + "/" + g, o, s, u, n, g);
      } else if (u in Yt.propsKeywords) {
        if (f && typeof f == "object")
          for (var m in f)
            xn(e, t, r, f[m], s + "/" + u + "/" + w_(m), o, s, u, n, m);
      } else (u in Yt.keywords || e.allKeys && !(u in Yt.skipKeywords)) && xn(e, t, r, f, s + "/" + u, o, s, u, n);
    }
    r(n, s, o, a, i, c, d);
  }
}
function w_(e) {
  return e.replace(/~/g, "~0").replace(/\//g, "~1");
}
var S_ = Ru.exports;
Object.defineProperty(De, "__esModule", { value: !0 });
De.getSchemaRefs = De.resolveUrl = De.normalizeId = De._getFullPath = De.getFullPath = De.inlineRef = void 0;
const b_ = H, P_ = ms, N_ = S_, R_ = /* @__PURE__ */ new Set([
  "type",
  "format",
  "pattern",
  "maxLength",
  "minLength",
  "maxProperties",
  "minProperties",
  "maxItems",
  "minItems",
  "maximum",
  "minimum",
  "uniqueItems",
  "multipleOf",
  "required",
  "enum",
  "const"
]);
function T_(e, t = !0) {
  return typeof e == "boolean" ? !0 : t === !0 ? !So(e) : t ? Tu(e) <= t : !1;
}
De.inlineRef = T_;
const O_ = /* @__PURE__ */ new Set([
  "$ref",
  "$recursiveRef",
  "$recursiveAnchor",
  "$dynamicRef",
  "$dynamicAnchor"
]);
function So(e) {
  for (const t in e) {
    if (O_.has(t))
      return !0;
    const r = e[t];
    if (Array.isArray(r) && r.some(So) || typeof r == "object" && So(r))
      return !0;
  }
  return !1;
}
function Tu(e) {
  let t = 0;
  for (const r in e) {
    if (r === "$ref")
      return 1 / 0;
    if (t++, !R_.has(r) && (typeof e[r] == "object" && (0, b_.eachItem)(e[r], (n) => t += Tu(n)), t === 1 / 0))
      return 1 / 0;
  }
  return t;
}
function Ou(e, t = "", r) {
  r !== !1 && (t = jr(t));
  const n = e.parse(t);
  return Iu(e, n);
}
De.getFullPath = Ou;
function Iu(e, t) {
  return e.serialize(t).split("#")[0] + "#";
}
De._getFullPath = Iu;
const I_ = /#\/?$/;
function jr(e) {
  return e ? e.replace(I_, "") : "";
}
De.normalizeId = jr;
function j_(e, t, r) {
  return r = jr(r), e.resolve(t, r);
}
De.resolveUrl = j_;
const A_ = /^[a-z_][-a-z0-9._]*$/i;
function C_(e, t) {
  if (typeof e == "boolean")
    return {};
  const { schemaId: r, uriResolver: n } = this.opts, s = jr(e[r] || t), o = { "": s }, a = Ou(n, s, !1), i = {}, c = /* @__PURE__ */ new Set();
  return N_(e, { allKeys: !0 }, (f, g, m, v) => {
    if (v === void 0)
      return;
    const $ = a + g;
    let _ = o[v];
    typeof f[r] == "string" && (_ = p.call(this, f[r])), w.call(this, f.$anchor), w.call(this, f.$dynamicAnchor), o[g] = _;
    function p(P) {
      const T = this.opts.uriResolver.resolve;
      if (P = jr(_ ? T(_, P) : P), c.has(P))
        throw u(P);
      c.add(P);
      let I = this.refs[P];
      return typeof I == "string" && (I = this.refs[I]), typeof I == "object" ? d(f, I.schema, P) : P !== jr($) && (P[0] === "#" ? (d(f, i[P], P), i[P] = f) : this.refs[P] = $), P;
    }
    function w(P) {
      if (typeof P == "string") {
        if (!A_.test(P))
          throw new Error(`invalid anchor "${P}"`);
        p.call(this, `#${P}`);
      }
    }
  }), i;
  function d(f, g, m) {
    if (g !== void 0 && !P_(f, g))
      throw u(m);
  }
  function u(f) {
    return new Error(`reference "${f}" resolves to more than one schema`);
  }
}
De.getSchemaRefs = C_;
var gc;
function ws() {
  if (gc) return Ot;
  gc = 1, Object.defineProperty(Ot, "__esModule", { value: !0 }), Ot.getData = Ot.KeywordCxt = Ot.validateFunctionCode = void 0;
  const e = Wg(), t = Te, r = Eu(), n = Te, s = c_(), o = v_(), a = E_(), i = ue, c = Nt, d = De, u = H, f = gn;
  function g(R) {
    if (I(R) && (M(R), T(R))) {
      _(R);
      return;
    }
    m(R, () => (0, e.topBoolOrEmptySchema)(R));
  }
  Ot.validateFunctionCode = g;
  function m({ gen: R, validateName: O, schema: D, schemaEnv: F, opts: Y }, se) {
    Y.code.es5 ? R.func(O, (0, i._)`${c.default.data}, ${c.default.valCxt}`, F.$async, () => {
      R.code((0, i._)`"use strict"; ${w(D, Y)}`), $(R, Y), R.code(se);
    }) : R.func(O, (0, i._)`${c.default.data}, ${v(Y)}`, F.$async, () => R.code(w(D, Y)).code(se));
  }
  function v(R) {
    return (0, i._)`{${c.default.instancePath}="", ${c.default.parentData}, ${c.default.parentDataProperty}, ${c.default.rootData}=${c.default.data}${R.dynamicRef ? (0, i._)`, ${c.default.dynamicAnchors}={}` : i.nil}}={}`;
  }
  function $(R, O) {
    R.if(c.default.valCxt, () => {
      R.var(c.default.instancePath, (0, i._)`${c.default.valCxt}.${c.default.instancePath}`), R.var(c.default.parentData, (0, i._)`${c.default.valCxt}.${c.default.parentData}`), R.var(c.default.parentDataProperty, (0, i._)`${c.default.valCxt}.${c.default.parentDataProperty}`), R.var(c.default.rootData, (0, i._)`${c.default.valCxt}.${c.default.rootData}`), O.dynamicRef && R.var(c.default.dynamicAnchors, (0, i._)`${c.default.valCxt}.${c.default.dynamicAnchors}`);
    }, () => {
      R.var(c.default.instancePath, (0, i._)`""`), R.var(c.default.parentData, (0, i._)`undefined`), R.var(c.default.parentDataProperty, (0, i._)`undefined`), R.var(c.default.rootData, c.default.data), O.dynamicRef && R.var(c.default.dynamicAnchors, (0, i._)`{}`);
    });
  }
  function _(R) {
    const { schema: O, opts: D, gen: F } = R;
    m(R, () => {
      D.$comment && O.$comment && te(R), pe(R), F.let(c.default.vErrors, null), F.let(c.default.errors, 0), D.unevaluated && p(R), ee(R), j(R);
    });
  }
  function p(R) {
    const { gen: O, validateName: D } = R;
    R.evaluated = O.const("evaluated", (0, i._)`${D}.evaluated`), O.if((0, i._)`${R.evaluated}.dynamicProps`, () => O.assign((0, i._)`${R.evaluated}.props`, (0, i._)`undefined`)), O.if((0, i._)`${R.evaluated}.dynamicItems`, () => O.assign((0, i._)`${R.evaluated}.items`, (0, i._)`undefined`));
  }
  function w(R, O) {
    const D = typeof R == "object" && R[O.schemaId];
    return D && (O.code.source || O.code.process) ? (0, i._)`/*# sourceURL=${D} */` : i.nil;
  }
  function P(R, O) {
    if (I(R) && (M(R), T(R))) {
      L(R, O);
      return;
    }
    (0, e.boolOrEmptySchema)(R, O);
  }
  function T({ schema: R, self: O }) {
    if (typeof R == "boolean")
      return !R;
    for (const D in R)
      if (O.RULES.all[D])
        return !0;
    return !1;
  }
  function I(R) {
    return typeof R.schema != "boolean";
  }
  function L(R, O) {
    const { schema: D, gen: F, opts: Y } = R;
    Y.$comment && D.$comment && te(R), V(R), G(R);
    const se = F.const("_errs", c.default.errors);
    ee(R, se), F.var(O, (0, i._)`${se} === ${c.default.errors}`);
  }
  function M(R) {
    (0, u.checkUnknownRules)(R), he(R);
  }
  function ee(R, O) {
    if (R.opts.jtd)
      return q(R, [], !1, O);
    const D = (0, t.getSchemaTypes)(R.schema), F = (0, t.coerceAndCheckDataType)(R, D);
    q(R, D, !F, O);
  }
  function he(R) {
    const { schema: O, errSchemaPath: D, opts: F, self: Y } = R;
    O.$ref && F.ignoreKeywordsWithRef && (0, u.schemaHasRulesButRef)(O, Y.RULES) && Y.logger.warn(`$ref: keywords ignored in schema at path "${D}"`);
  }
  function pe(R) {
    const { schema: O, opts: D } = R;
    O.default !== void 0 && D.useDefaults && D.strictSchema && (0, u.checkStrictMode)(R, "default is ignored in the schema root");
  }
  function V(R) {
    const O = R.schema[R.opts.schemaId];
    O && (R.baseId = (0, d.resolveUrl)(R.opts.uriResolver, R.baseId, O));
  }
  function G(R) {
    if (R.schema.$async && !R.schemaEnv.$async)
      throw new Error("async schema in sync schema");
  }
  function te({ gen: R, schemaEnv: O, schema: D, errSchemaPath: F, opts: Y }) {
    const se = D.$comment;
    if (Y.$comment === !0)
      R.code((0, i._)`${c.default.self}.logger.log(${se})`);
    else if (typeof Y.$comment == "function") {
      const Ee = (0, i.str)`${F}/$comment`, Ke = R.scopeValue("root", { ref: O.root });
      R.code((0, i._)`${c.default.self}.opts.$comment(${se}, ${Ee}, ${Ke}.schema)`);
    }
  }
  function j(R) {
    const { gen: O, schemaEnv: D, validateName: F, ValidationError: Y, opts: se } = R;
    D.$async ? O.if((0, i._)`${c.default.errors} === 0`, () => O.return(c.default.data), () => O.throw((0, i._)`new ${Y}(${c.default.vErrors})`)) : (O.assign((0, i._)`${F}.errors`, c.default.vErrors), se.unevaluated && C(R), O.return((0, i._)`${c.default.errors} === 0`));
  }
  function C({ gen: R, evaluated: O, props: D, items: F }) {
    D instanceof i.Name && R.assign((0, i._)`${O}.props`, D), F instanceof i.Name && R.assign((0, i._)`${O}.items`, F);
  }
  function q(R, O, D, F) {
    const { gen: Y, schema: se, data: Ee, allErrors: Ke, opts: Oe, self: Ie } = R, { RULES: we } = Ie;
    if (se.$ref && (Oe.ignoreKeywordsWithRef || !(0, u.schemaHasRulesButRef)(se, we))) {
      Y.block(() => A(R, "$ref", we.all.$ref.definition));
      return;
    }
    Oe.jtd || W(R, O), Y.block(() => {
      for (const Me of we.rules)
        gt(Me);
      gt(we.post);
    });
    function gt(Me) {
      (0, r.shouldUseGroup)(se, Me) && (Me.type ? (Y.if((0, n.checkDataType)(Me.type, Ee, Oe.strictNumbers)), U(R, Me), O.length === 1 && O[0] === Me.type && D && (Y.else(), (0, n.reportTypeError)(R)), Y.endIf()) : U(R, Me), Ke || Y.if((0, i._)`${c.default.errors} === ${F || 0}`));
    }
  }
  function U(R, O) {
    const { gen: D, schema: F, opts: { useDefaults: Y } } = R;
    Y && (0, s.assignDefaults)(R, O.type), D.block(() => {
      for (const se of O.rules)
        (0, r.shouldUseRule)(F, se) && A(R, se.keyword, se.definition, O.type);
    });
  }
  function W(R, O) {
    R.schemaEnv.meta || !R.opts.strictTypes || (z(R, O), R.opts.allowUnionTypes || N(R, O), y(R, R.dataTypes));
  }
  function z(R, O) {
    if (O.length) {
      if (!R.dataTypes.length) {
        R.dataTypes = O;
        return;
      }
      O.forEach((D) => {
        E(R.dataTypes, D) || h(R, `type "${D}" not allowed by context "${R.dataTypes.join(",")}"`);
      }), l(R, O);
    }
  }
  function N(R, O) {
    O.length > 1 && !(O.length === 2 && O.includes("null")) && h(R, "use allowUnionTypes to allow union type keyword");
  }
  function y(R, O) {
    const D = R.self.RULES.all;
    for (const F in D) {
      const Y = D[F];
      if (typeof Y == "object" && (0, r.shouldUseRule)(R.schema, Y)) {
        const { type: se } = Y.definition;
        se.length && !se.some((Ee) => S(O, Ee)) && h(R, `missing type "${se.join(",")}" for keyword "${F}"`);
      }
    }
  }
  function S(R, O) {
    return R.includes(O) || O === "number" && R.includes("integer");
  }
  function E(R, O) {
    return R.includes(O) || O === "integer" && R.includes("number");
  }
  function l(R, O) {
    const D = [];
    for (const F of R.dataTypes)
      E(O, F) ? D.push(F) : O.includes("integer") && F === "number" && D.push("integer");
    R.dataTypes = D;
  }
  function h(R, O) {
    const D = R.schemaEnv.baseId + R.errSchemaPath;
    O += ` at "${D}" (strictTypes)`, (0, u.checkStrictMode)(R, O, R.opts.strictTypes);
  }
  class b {
    constructor(O, D, F) {
      if ((0, o.validateKeywordUsage)(O, D, F), this.gen = O.gen, this.allErrors = O.allErrors, this.keyword = F, this.data = O.data, this.schema = O.schema[F], this.$data = D.$data && O.opts.$data && this.schema && this.schema.$data, this.schemaValue = (0, u.schemaRefOrVal)(O, this.schema, F, this.$data), this.schemaType = D.schemaType, this.parentSchema = O.schema, this.params = {}, this.it = O, this.def = D, this.$data)
        this.schemaCode = O.gen.const("vSchema", J(this.$data, O));
      else if (this.schemaCode = this.schemaValue, !(0, o.validSchemaType)(this.schema, D.schemaType, D.allowUndefined))
        throw new Error(`${F} value must be ${JSON.stringify(D.schemaType)}`);
      ("code" in D ? D.trackErrors : D.errors !== !1) && (this.errsCount = O.gen.const("_errs", c.default.errors));
    }
    result(O, D, F) {
      this.failResult((0, i.not)(O), D, F);
    }
    failResult(O, D, F) {
      this.gen.if(O), F ? F() : this.error(), D ? (this.gen.else(), D(), this.allErrors && this.gen.endIf()) : this.allErrors ? this.gen.endIf() : this.gen.else();
    }
    pass(O, D) {
      this.failResult((0, i.not)(O), void 0, D);
    }
    fail(O) {
      if (O === void 0) {
        this.error(), this.allErrors || this.gen.if(!1);
        return;
      }
      this.gen.if(O), this.error(), this.allErrors ? this.gen.endIf() : this.gen.else();
    }
    fail$data(O) {
      if (!this.$data)
        return this.fail(O);
      const { schemaCode: D } = this;
      this.fail((0, i._)`${D} !== undefined && (${(0, i.or)(this.invalid$data(), O)})`);
    }
    error(O, D, F) {
      if (D) {
        this.setParams(D), this._error(O, F), this.setParams({});
        return;
      }
      this._error(O, F);
    }
    _error(O, D) {
      (O ? f.reportExtraError : f.reportError)(this, this.def.error, D);
    }
    $dataError() {
      (0, f.reportError)(this, this.def.$dataError || f.keyword$DataError);
    }
    reset() {
      if (this.errsCount === void 0)
        throw new Error('add "trackErrors" to keyword definition');
      (0, f.resetErrorsCount)(this.gen, this.errsCount);
    }
    ok(O) {
      this.allErrors || this.gen.if(O);
    }
    setParams(O, D) {
      D ? Object.assign(this.params, O) : this.params = O;
    }
    block$data(O, D, F = i.nil) {
      this.gen.block(() => {
        this.check$data(O, F), D();
      });
    }
    check$data(O = i.nil, D = i.nil) {
      if (!this.$data)
        return;
      const { gen: F, schemaCode: Y, schemaType: se, def: Ee } = this;
      F.if((0, i.or)((0, i._)`${Y} === undefined`, D)), O !== i.nil && F.assign(O, !0), (se.length || Ee.validateSchema) && (F.elseIf(this.invalid$data()), this.$dataError(), O !== i.nil && F.assign(O, !1)), F.else();
    }
    invalid$data() {
      const { gen: O, schemaCode: D, schemaType: F, def: Y, it: se } = this;
      return (0, i.or)(Ee(), Ke());
      function Ee() {
        if (F.length) {
          if (!(D instanceof i.Name))
            throw new Error("ajv implementation error");
          const Oe = Array.isArray(F) ? F : [F];
          return (0, i._)`${(0, n.checkDataTypes)(Oe, D, se.opts.strictNumbers, n.DataType.Wrong)}`;
        }
        return i.nil;
      }
      function Ke() {
        if (Y.validateSchema) {
          const Oe = O.scopeValue("validate$data", { ref: Y.validateSchema });
          return (0, i._)`!${Oe}(${D})`;
        }
        return i.nil;
      }
    }
    subschema(O, D) {
      const F = (0, a.getSubschema)(this.it, O);
      (0, a.extendSubschemaData)(F, this.it, O), (0, a.extendSubschemaMode)(F, O);
      const Y = { ...this.it, ...F, items: void 0, props: void 0 };
      return P(Y, D), Y;
    }
    mergeEvaluated(O, D) {
      const { it: F, gen: Y } = this;
      F.opts.unevaluated && (F.props !== !0 && O.props !== void 0 && (F.props = u.mergeEvaluated.props(Y, O.props, F.props, D)), F.items !== !0 && O.items !== void 0 && (F.items = u.mergeEvaluated.items(Y, O.items, F.items, D)));
    }
    mergeValidEvaluated(O, D) {
      const { it: F, gen: Y } = this;
      if (F.opts.unevaluated && (F.props !== !0 || F.items !== !0))
        return Y.if(D, () => this.mergeEvaluated(O, i.Name)), !0;
    }
  }
  Ot.KeywordCxt = b;
  function A(R, O, D, F) {
    const Y = new b(R, D, O);
    "code" in D ? D.code(Y, F) : Y.$data && D.validate ? (0, o.funcKeywordCode)(Y, D) : "macro" in D ? (0, o.macroKeywordCode)(Y, D) : (D.compile || D.validate) && (0, o.funcKeywordCode)(Y, D);
  }
  const k = /^\/(?:[^~]|~0|~1)*$/, X = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
  function J(R, { dataLevel: O, dataNames: D, dataPathArr: F }) {
    let Y, se;
    if (R === "")
      return c.default.rootData;
    if (R[0] === "/") {
      if (!k.test(R))
        throw new Error(`Invalid JSON-pointer: ${R}`);
      Y = R, se = c.default.rootData;
    } else {
      const Ie = X.exec(R);
      if (!Ie)
        throw new Error(`Invalid JSON-pointer: ${R}`);
      const we = +Ie[1];
      if (Y = Ie[2], Y === "#") {
        if (we >= O)
          throw new Error(Oe("property/index", we));
        return F[O - we];
      }
      if (we > O)
        throw new Error(Oe("data", we));
      if (se = D[O - we], !Y)
        return se;
    }
    let Ee = se;
    const Ke = Y.split("/");
    for (const Ie of Ke)
      Ie && (se = (0, i._)`${se}${(0, i.getProperty)((0, u.unescapeJsonPointer)(Ie))}`, Ee = (0, i._)`${Ee} && ${se}`);
    return Ee;
    function Oe(Ie, we) {
      return `Cannot access ${Ie} ${we} levels up, current level is ${O}`;
    }
  }
  return Ot.getData = J, Ot;
}
var _n = {};
Object.defineProperty(_n, "__esModule", { value: !0 });
class k_ extends Error {
  constructor(t) {
    super("validation failed"), this.errors = t, this.ajv = this.validation = !0;
  }
}
_n.default = k_;
var jn = {}, _c;
function Ss() {
  if (_c) return jn;
  _c = 1, Object.defineProperty(jn, "__esModule", { value: !0 });
  const e = De;
  class t extends Error {
    constructor(n, s, o, a) {
      super(a || `can't resolve reference ${o} from id ${s}`), this.missingRef = (0, e.resolveUrl)(n, s, o), this.missingSchema = (0, e.normalizeId)((0, e.getFullPath)(n, this.missingRef));
    }
  }
  return jn.default = t, jn;
}
var Qe = {};
Object.defineProperty(Qe, "__esModule", { value: !0 });
Qe.resolveSchema = Qe.getCompilingSchema = Qe.resolveRef = Qe.compileSchema = Qe.SchemaEnv = void 0;
const ct = ue, D_ = _n, or = Nt, ht = De, vc = H, M_ = ws();
class bs {
  constructor(t) {
    var r;
    this.refs = {}, this.dynamicAnchors = {};
    let n;
    typeof t.schema == "object" && (n = t.schema), this.schema = t.schema, this.schemaId = t.schemaId, this.root = t.root || this, this.baseId = (r = t.baseId) !== null && r !== void 0 ? r : (0, ht.normalizeId)(n == null ? void 0 : n[t.schemaId || "$id"]), this.schemaPath = t.schemaPath, this.localRefs = t.localRefs, this.meta = t.meta, this.$async = n == null ? void 0 : n.$async, this.refs = {};
  }
}
Qe.SchemaEnv = bs;
function qa(e) {
  const t = ju.call(this, e);
  if (t)
    return t;
  const r = (0, ht.getFullPath)(this.opts.uriResolver, e.root.baseId), { es5: n, lines: s } = this.opts.code, { ownProperties: o } = this.opts, a = new ct.CodeGen(this.scope, { es5: n, lines: s, ownProperties: o });
  let i;
  e.$async && (i = a.scopeValue("Error", {
    ref: D_.default,
    code: (0, ct._)`require("ajv/dist/runtime/validation_error").default`
  }));
  const c = a.scopeName("validate");
  e.validateName = c;
  const d = {
    gen: a,
    allErrors: this.opts.allErrors,
    data: or.default.data,
    parentData: or.default.parentData,
    parentDataProperty: or.default.parentDataProperty,
    dataNames: [or.default.data],
    dataPathArr: [ct.nil],
    // TODO can its length be used as dataLevel if nil is removed?
    dataLevel: 0,
    dataTypes: [],
    definedProperties: /* @__PURE__ */ new Set(),
    topSchemaRef: a.scopeValue("schema", this.opts.code.source === !0 ? { ref: e.schema, code: (0, ct.stringify)(e.schema) } : { ref: e.schema }),
    validateName: c,
    ValidationError: i,
    schema: e.schema,
    schemaEnv: e,
    rootId: r,
    baseId: e.baseId || r,
    schemaPath: ct.nil,
    errSchemaPath: e.schemaPath || (this.opts.jtd ? "" : "#"),
    errorPath: (0, ct._)`""`,
    opts: this.opts,
    self: this
  };
  let u;
  try {
    this._compilations.add(e), (0, M_.validateFunctionCode)(d), a.optimize(this.opts.code.optimize);
    const f = a.toString();
    u = `${a.scopeRefs(or.default.scope)}return ${f}`, this.opts.code.process && (u = this.opts.code.process(u, e));
    const m = new Function(`${or.default.self}`, `${or.default.scope}`, u)(this, this.scope.get());
    if (this.scope.value(c, { ref: m }), m.errors = null, m.schema = e.schema, m.schemaEnv = e, e.$async && (m.$async = !0), this.opts.code.source === !0 && (m.source = { validateName: c, validateCode: f, scopeValues: a._values }), this.opts.unevaluated) {
      const { props: v, items: $ } = d;
      m.evaluated = {
        props: v instanceof ct.Name ? void 0 : v,
        items: $ instanceof ct.Name ? void 0 : $,
        dynamicProps: v instanceof ct.Name,
        dynamicItems: $ instanceof ct.Name
      }, m.source && (m.source.evaluated = (0, ct.stringify)(m.evaluated));
    }
    return e.validate = m, e;
  } catch (f) {
    throw delete e.validate, delete e.validateName, u && this.logger.error("Error compiling schema, function code:", u), f;
  } finally {
    this._compilations.delete(e);
  }
}
Qe.compileSchema = qa;
function L_(e, t, r) {
  var n;
  r = (0, ht.resolveUrl)(this.opts.uriResolver, t, r);
  const s = e.refs[r];
  if (s)
    return s;
  let o = U_.call(this, e, r);
  if (o === void 0) {
    const a = (n = e.localRefs) === null || n === void 0 ? void 0 : n[r], { schemaId: i } = this.opts;
    a && (o = new bs({ schema: a, schemaId: i, root: e, baseId: t }));
  }
  if (o !== void 0)
    return e.refs[r] = F_.call(this, o);
}
Qe.resolveRef = L_;
function F_(e) {
  return (0, ht.inlineRef)(e.schema, this.opts.inlineRefs) ? e.schema : e.validate ? e : qa.call(this, e);
}
function ju(e) {
  for (const t of this._compilations)
    if (V_(t, e))
      return t;
}
Qe.getCompilingSchema = ju;
function V_(e, t) {
  return e.schema === t.schema && e.root === t.root && e.baseId === t.baseId;
}
function U_(e, t) {
  let r;
  for (; typeof (r = this.refs[t]) == "string"; )
    t = r;
  return r || this.schemas[t] || Ps.call(this, e, t);
}
function Ps(e, t) {
  const r = this.opts.uriResolver.parse(t), n = (0, ht._getFullPath)(this.opts.uriResolver, r);
  let s = (0, ht.getFullPath)(this.opts.uriResolver, e.baseId, void 0);
  if (Object.keys(e.schema).length > 0 && n === s)
    return Xs.call(this, r, e);
  const o = (0, ht.normalizeId)(n), a = this.refs[o] || this.schemas[o];
  if (typeof a == "string") {
    const i = Ps.call(this, e, a);
    return typeof (i == null ? void 0 : i.schema) != "object" ? void 0 : Xs.call(this, r, i);
  }
  if (typeof (a == null ? void 0 : a.schema) == "object") {
    if (a.validate || qa.call(this, a), o === (0, ht.normalizeId)(t)) {
      const { schema: i } = a, { schemaId: c } = this.opts, d = i[c];
      return d && (s = (0, ht.resolveUrl)(this.opts.uriResolver, s, d)), new bs({ schema: i, schemaId: c, root: e, baseId: s });
    }
    return Xs.call(this, r, a);
  }
}
Qe.resolveSchema = Ps;
const z_ = /* @__PURE__ */ new Set([
  "properties",
  "patternProperties",
  "enum",
  "dependencies",
  "definitions"
]);
function Xs(e, { baseId: t, schema: r, root: n }) {
  var s;
  if (((s = e.fragment) === null || s === void 0 ? void 0 : s[0]) !== "/")
    return;
  for (const i of e.fragment.slice(1).split("/")) {
    if (typeof r == "boolean")
      return;
    const c = r[(0, vc.unescapeFragment)(i)];
    if (c === void 0)
      return;
    r = c;
    const d = typeof r == "object" && r[this.opts.schemaId];
    !z_.has(i) && d && (t = (0, ht.resolveUrl)(this.opts.uriResolver, t, d));
  }
  let o;
  if (typeof r != "boolean" && r.$ref && !(0, vc.schemaHasRulesButRef)(r, this.RULES)) {
    const i = (0, ht.resolveUrl)(this.opts.uriResolver, t, r.$ref);
    o = Ps.call(this, n, i);
  }
  const { schemaId: a } = this.opts;
  if (o = o || new bs({ schema: r, schemaId: a, root: n, baseId: t }), o.schema !== o.root.schema)
    return o;
}
const q_ = "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#", G_ = "Meta-schema for $data reference (JSON AnySchema extension proposal)", K_ = "object", H_ = [
  "$data"
], B_ = {
  $data: {
    type: "string",
    anyOf: [
      {
        format: "relative-json-pointer"
      },
      {
        format: "json-pointer"
      }
    ]
  }
}, W_ = !1, J_ = {
  $id: q_,
  description: G_,
  type: K_,
  required: H_,
  properties: B_,
  additionalProperties: W_
};
var Ga = {};
Object.defineProperty(Ga, "__esModule", { value: !0 });
const Au = ru;
Au.code = 'require("ajv/dist/runtime/uri").default';
Ga.default = Au;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.CodeGen = e.Name = e.nil = e.stringify = e.str = e._ = e.KeywordCxt = void 0;
  var t = ws();
  Object.defineProperty(e, "KeywordCxt", { enumerable: !0, get: function() {
    return t.KeywordCxt;
  } });
  var r = ue;
  Object.defineProperty(e, "_", { enumerable: !0, get: function() {
    return r._;
  } }), Object.defineProperty(e, "str", { enumerable: !0, get: function() {
    return r.str;
  } }), Object.defineProperty(e, "stringify", { enumerable: !0, get: function() {
    return r.stringify;
  } }), Object.defineProperty(e, "nil", { enumerable: !0, get: function() {
    return r.nil;
  } }), Object.defineProperty(e, "Name", { enumerable: !0, get: function() {
    return r.Name;
  } }), Object.defineProperty(e, "CodeGen", { enumerable: !0, get: function() {
    return r.CodeGen;
  } });
  const n = _n, s = Ss(), o = $r, a = Qe, i = ue, c = De, d = Te, u = H, f = J_, g = Ga, m = (N, y) => new RegExp(N, y);
  m.code = "new RegExp";
  const v = ["removeAdditional", "useDefaults", "coerceTypes"], $ = /* @__PURE__ */ new Set([
    "validate",
    "serialize",
    "parse",
    "wrapper",
    "root",
    "schema",
    "keyword",
    "pattern",
    "formats",
    "validate$data",
    "func",
    "obj",
    "Error"
  ]), _ = {
    errorDataPath: "",
    format: "`validateFormats: false` can be used instead.",
    nullable: '"nullable" keyword is supported by default.',
    jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
    extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
    missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
    processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
    sourceCode: "Use option `code: {source: true}`",
    strictDefaults: "It is default now, see option `strict`.",
    strictKeywords: "It is default now, see option `strict`.",
    uniqueItems: '"uniqueItems" keyword is always validated.',
    unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
    cache: "Map is used as cache, schema object as key.",
    serialize: "Map is used as cache, schema object as key.",
    ajvErrors: "It is default now."
  }, p = {
    ignoreKeywordsWithRef: "",
    jsPropertySyntax: "",
    unicode: '"minLength"/"maxLength" account for unicode characters by default.'
  }, w = 200;
  function P(N) {
    var y, S, E, l, h, b, A, k, X, J, R, O, D, F, Y, se, Ee, Ke, Oe, Ie, we, gt, Me, Qt, Zt;
    const ot = N.strict, er = (y = N.code) === null || y === void 0 ? void 0 : y.optimize, Kr = er === !0 || er === void 0 ? 1 : er || 0, Hr = (E = (S = N.code) === null || S === void 0 ? void 0 : S.regExp) !== null && E !== void 0 ? E : m, ks = (l = N.uriResolver) !== null && l !== void 0 ? l : g.default;
    return {
      strictSchema: (b = (h = N.strictSchema) !== null && h !== void 0 ? h : ot) !== null && b !== void 0 ? b : !0,
      strictNumbers: (k = (A = N.strictNumbers) !== null && A !== void 0 ? A : ot) !== null && k !== void 0 ? k : !0,
      strictTypes: (J = (X = N.strictTypes) !== null && X !== void 0 ? X : ot) !== null && J !== void 0 ? J : "log",
      strictTuples: (O = (R = N.strictTuples) !== null && R !== void 0 ? R : ot) !== null && O !== void 0 ? O : "log",
      strictRequired: (F = (D = N.strictRequired) !== null && D !== void 0 ? D : ot) !== null && F !== void 0 ? F : !1,
      code: N.code ? { ...N.code, optimize: Kr, regExp: Hr } : { optimize: Kr, regExp: Hr },
      loopRequired: (Y = N.loopRequired) !== null && Y !== void 0 ? Y : w,
      loopEnum: (se = N.loopEnum) !== null && se !== void 0 ? se : w,
      meta: (Ee = N.meta) !== null && Ee !== void 0 ? Ee : !0,
      messages: (Ke = N.messages) !== null && Ke !== void 0 ? Ke : !0,
      inlineRefs: (Oe = N.inlineRefs) !== null && Oe !== void 0 ? Oe : !0,
      schemaId: (Ie = N.schemaId) !== null && Ie !== void 0 ? Ie : "$id",
      addUsedSchema: (we = N.addUsedSchema) !== null && we !== void 0 ? we : !0,
      validateSchema: (gt = N.validateSchema) !== null && gt !== void 0 ? gt : !0,
      validateFormats: (Me = N.validateFormats) !== null && Me !== void 0 ? Me : !0,
      unicodeRegExp: (Qt = N.unicodeRegExp) !== null && Qt !== void 0 ? Qt : !0,
      int32range: (Zt = N.int32range) !== null && Zt !== void 0 ? Zt : !0,
      uriResolver: ks
    };
  }
  class T {
    constructor(y = {}) {
      this.schemas = {}, this.refs = {}, this.formats = {}, this._compilations = /* @__PURE__ */ new Set(), this._loading = {}, this._cache = /* @__PURE__ */ new Map(), y = this.opts = { ...y, ...P(y) };
      const { es5: S, lines: E } = this.opts.code;
      this.scope = new i.ValueScope({ scope: {}, prefixes: $, es5: S, lines: E }), this.logger = G(y.logger);
      const l = y.validateFormats;
      y.validateFormats = !1, this.RULES = (0, o.getRules)(), I.call(this, _, y, "NOT SUPPORTED"), I.call(this, p, y, "DEPRECATED", "warn"), this._metaOpts = pe.call(this), y.formats && ee.call(this), this._addVocabularies(), this._addDefaultMetaSchema(), y.keywords && he.call(this, y.keywords), typeof y.meta == "object" && this.addMetaSchema(y.meta), M.call(this), y.validateFormats = l;
    }
    _addVocabularies() {
      this.addKeyword("$async");
    }
    _addDefaultMetaSchema() {
      const { $data: y, meta: S, schemaId: E } = this.opts;
      let l = f;
      E === "id" && (l = { ...f }, l.id = l.$id, delete l.$id), S && y && this.addMetaSchema(l, l[E], !1);
    }
    defaultMeta() {
      const { meta: y, schemaId: S } = this.opts;
      return this.opts.defaultMeta = typeof y == "object" ? y[S] || y : void 0;
    }
    validate(y, S) {
      let E;
      if (typeof y == "string") {
        if (E = this.getSchema(y), !E)
          throw new Error(`no schema with key or ref "${y}"`);
      } else
        E = this.compile(y);
      const l = E(S);
      return "$async" in E || (this.errors = E.errors), l;
    }
    compile(y, S) {
      const E = this._addSchema(y, S);
      return E.validate || this._compileSchemaEnv(E);
    }
    compileAsync(y, S) {
      if (typeof this.opts.loadSchema != "function")
        throw new Error("options.loadSchema should be a function");
      const { loadSchema: E } = this.opts;
      return l.call(this, y, S);
      async function l(J, R) {
        await h.call(this, J.$schema);
        const O = this._addSchema(J, R);
        return O.validate || b.call(this, O);
      }
      async function h(J) {
        J && !this.getSchema(J) && await l.call(this, { $ref: J }, !0);
      }
      async function b(J) {
        try {
          return this._compileSchemaEnv(J);
        } catch (R) {
          if (!(R instanceof s.default))
            throw R;
          return A.call(this, R), await k.call(this, R.missingSchema), b.call(this, J);
        }
      }
      function A({ missingSchema: J, missingRef: R }) {
        if (this.refs[J])
          throw new Error(`AnySchema ${J} is loaded but ${R} cannot be resolved`);
      }
      async function k(J) {
        const R = await X.call(this, J);
        this.refs[J] || await h.call(this, R.$schema), this.refs[J] || this.addSchema(R, J, S);
      }
      async function X(J) {
        const R = this._loading[J];
        if (R)
          return R;
        try {
          return await (this._loading[J] = E(J));
        } finally {
          delete this._loading[J];
        }
      }
    }
    // Adds schema to the instance
    addSchema(y, S, E, l = this.opts.validateSchema) {
      if (Array.isArray(y)) {
        for (const b of y)
          this.addSchema(b, void 0, E, l);
        return this;
      }
      let h;
      if (typeof y == "object") {
        const { schemaId: b } = this.opts;
        if (h = y[b], h !== void 0 && typeof h != "string")
          throw new Error(`schema ${b} must be string`);
      }
      return S = (0, c.normalizeId)(S || h), this._checkUnique(S), this.schemas[S] = this._addSchema(y, E, S, l, !0), this;
    }
    // Add schema that will be used to validate other schemas
    // options in META_IGNORE_OPTIONS are alway set to false
    addMetaSchema(y, S, E = this.opts.validateSchema) {
      return this.addSchema(y, S, !0, E), this;
    }
    //  Validate schema against its meta-schema
    validateSchema(y, S) {
      if (typeof y == "boolean")
        return !0;
      let E;
      if (E = y.$schema, E !== void 0 && typeof E != "string")
        throw new Error("$schema must be a string");
      if (E = E || this.opts.defaultMeta || this.defaultMeta(), !E)
        return this.logger.warn("meta-schema not available"), this.errors = null, !0;
      const l = this.validate(E, y);
      if (!l && S) {
        const h = "schema is invalid: " + this.errorsText();
        if (this.opts.validateSchema === "log")
          this.logger.error(h);
        else
          throw new Error(h);
      }
      return l;
    }
    // Get compiled schema by `key` or `ref`.
    // (`key` that was passed to `addSchema` or full schema reference - `schema.$id` or resolved id)
    getSchema(y) {
      let S;
      for (; typeof (S = L.call(this, y)) == "string"; )
        y = S;
      if (S === void 0) {
        const { schemaId: E } = this.opts, l = new a.SchemaEnv({ schema: {}, schemaId: E });
        if (S = a.resolveSchema.call(this, l, y), !S)
          return;
        this.refs[y] = S;
      }
      return S.validate || this._compileSchemaEnv(S);
    }
    // Remove cached schema(s).
    // If no parameter is passed all schemas but meta-schemas are removed.
    // If RegExp is passed all schemas with key/id matching pattern but meta-schemas are removed.
    // Even if schema is referenced by other schemas it still can be removed as other schemas have local references.
    removeSchema(y) {
      if (y instanceof RegExp)
        return this._removeAllSchemas(this.schemas, y), this._removeAllSchemas(this.refs, y), this;
      switch (typeof y) {
        case "undefined":
          return this._removeAllSchemas(this.schemas), this._removeAllSchemas(this.refs), this._cache.clear(), this;
        case "string": {
          const S = L.call(this, y);
          return typeof S == "object" && this._cache.delete(S.schema), delete this.schemas[y], delete this.refs[y], this;
        }
        case "object": {
          const S = y;
          this._cache.delete(S);
          let E = y[this.opts.schemaId];
          return E && (E = (0, c.normalizeId)(E), delete this.schemas[E], delete this.refs[E]), this;
        }
        default:
          throw new Error("ajv.removeSchema: invalid parameter");
      }
    }
    // add "vocabulary" - a collection of keywords
    addVocabulary(y) {
      for (const S of y)
        this.addKeyword(S);
      return this;
    }
    addKeyword(y, S) {
      let E;
      if (typeof y == "string")
        E = y, typeof S == "object" && (this.logger.warn("these parameters are deprecated, see docs for addKeyword"), S.keyword = E);
      else if (typeof y == "object" && S === void 0) {
        if (S = y, E = S.keyword, Array.isArray(E) && !E.length)
          throw new Error("addKeywords: keyword must be string or non-empty array");
      } else
        throw new Error("invalid addKeywords parameters");
      if (j.call(this, E, S), !S)
        return (0, u.eachItem)(E, (h) => C.call(this, h)), this;
      U.call(this, S);
      const l = {
        ...S,
        type: (0, d.getJSONTypes)(S.type),
        schemaType: (0, d.getJSONTypes)(S.schemaType)
      };
      return (0, u.eachItem)(E, l.type.length === 0 ? (h) => C.call(this, h, l) : (h) => l.type.forEach((b) => C.call(this, h, l, b))), this;
    }
    getKeyword(y) {
      const S = this.RULES.all[y];
      return typeof S == "object" ? S.definition : !!S;
    }
    // Remove keyword
    removeKeyword(y) {
      const { RULES: S } = this;
      delete S.keywords[y], delete S.all[y];
      for (const E of S.rules) {
        const l = E.rules.findIndex((h) => h.keyword === y);
        l >= 0 && E.rules.splice(l, 1);
      }
      return this;
    }
    // Add format
    addFormat(y, S) {
      return typeof S == "string" && (S = new RegExp(S)), this.formats[y] = S, this;
    }
    errorsText(y = this.errors, { separator: S = ", ", dataVar: E = "data" } = {}) {
      return !y || y.length === 0 ? "No errors" : y.map((l) => `${E}${l.instancePath} ${l.message}`).reduce((l, h) => l + S + h);
    }
    $dataMetaSchema(y, S) {
      const E = this.RULES.all;
      y = JSON.parse(JSON.stringify(y));
      for (const l of S) {
        const h = l.split("/").slice(1);
        let b = y;
        for (const A of h)
          b = b[A];
        for (const A in E) {
          const k = E[A];
          if (typeof k != "object")
            continue;
          const { $data: X } = k.definition, J = b[A];
          X && J && (b[A] = z(J));
        }
      }
      return y;
    }
    _removeAllSchemas(y, S) {
      for (const E in y) {
        const l = y[E];
        (!S || S.test(E)) && (typeof l == "string" ? delete y[E] : l && !l.meta && (this._cache.delete(l.schema), delete y[E]));
      }
    }
    _addSchema(y, S, E, l = this.opts.validateSchema, h = this.opts.addUsedSchema) {
      let b;
      const { schemaId: A } = this.opts;
      if (typeof y == "object")
        b = y[A];
      else {
        if (this.opts.jtd)
          throw new Error("schema must be object");
        if (typeof y != "boolean")
          throw new Error("schema must be object or boolean");
      }
      let k = this._cache.get(y);
      if (k !== void 0)
        return k;
      E = (0, c.normalizeId)(b || E);
      const X = c.getSchemaRefs.call(this, y, E);
      return k = new a.SchemaEnv({ schema: y, schemaId: A, meta: S, baseId: E, localRefs: X }), this._cache.set(k.schema, k), h && !E.startsWith("#") && (E && this._checkUnique(E), this.refs[E] = k), l && this.validateSchema(y, !0), k;
    }
    _checkUnique(y) {
      if (this.schemas[y] || this.refs[y])
        throw new Error(`schema with key or id "${y}" already exists`);
    }
    _compileSchemaEnv(y) {
      if (y.meta ? this._compileMetaSchema(y) : a.compileSchema.call(this, y), !y.validate)
        throw new Error("ajv implementation error");
      return y.validate;
    }
    _compileMetaSchema(y) {
      const S = this.opts;
      this.opts = this._metaOpts;
      try {
        a.compileSchema.call(this, y);
      } finally {
        this.opts = S;
      }
    }
  }
  T.ValidationError = n.default, T.MissingRefError = s.default, e.default = T;
  function I(N, y, S, E = "error") {
    for (const l in N) {
      const h = l;
      h in y && this.logger[E](`${S}: option ${l}. ${N[h]}`);
    }
  }
  function L(N) {
    return N = (0, c.normalizeId)(N), this.schemas[N] || this.refs[N];
  }
  function M() {
    const N = this.opts.schemas;
    if (N)
      if (Array.isArray(N))
        this.addSchema(N);
      else
        for (const y in N)
          this.addSchema(N[y], y);
  }
  function ee() {
    for (const N in this.opts.formats) {
      const y = this.opts.formats[N];
      y && this.addFormat(N, y);
    }
  }
  function he(N) {
    if (Array.isArray(N)) {
      this.addVocabulary(N);
      return;
    }
    this.logger.warn("keywords option as map is deprecated, pass array");
    for (const y in N) {
      const S = N[y];
      S.keyword || (S.keyword = y), this.addKeyword(S);
    }
  }
  function pe() {
    const N = { ...this.opts };
    for (const y of v)
      delete N[y];
    return N;
  }
  const V = { log() {
  }, warn() {
  }, error() {
  } };
  function G(N) {
    if (N === !1)
      return V;
    if (N === void 0)
      return console;
    if (N.log && N.warn && N.error)
      return N;
    throw new Error("logger must implement log, warn and error methods");
  }
  const te = /^[a-z_$][a-z0-9_$:-]*$/i;
  function j(N, y) {
    const { RULES: S } = this;
    if ((0, u.eachItem)(N, (E) => {
      if (S.keywords[E])
        throw new Error(`Keyword ${E} is already defined`);
      if (!te.test(E))
        throw new Error(`Keyword ${E} has invalid name`);
    }), !!y && y.$data && !("code" in y || "validate" in y))
      throw new Error('$data keyword must have "code" or "validate" function');
  }
  function C(N, y, S) {
    var E;
    const l = y == null ? void 0 : y.post;
    if (S && l)
      throw new Error('keyword with "post" flag cannot have "type"');
    const { RULES: h } = this;
    let b = l ? h.post : h.rules.find(({ type: k }) => k === S);
    if (b || (b = { type: S, rules: [] }, h.rules.push(b)), h.keywords[N] = !0, !y)
      return;
    const A = {
      keyword: N,
      definition: {
        ...y,
        type: (0, d.getJSONTypes)(y.type),
        schemaType: (0, d.getJSONTypes)(y.schemaType)
      }
    };
    y.before ? q.call(this, b, A, y.before) : b.rules.push(A), h.all[N] = A, (E = y.implements) === null || E === void 0 || E.forEach((k) => this.addKeyword(k));
  }
  function q(N, y, S) {
    const E = N.rules.findIndex((l) => l.keyword === S);
    E >= 0 ? N.rules.splice(E, 0, y) : (N.rules.push(y), this.logger.warn(`rule ${S} is not defined`));
  }
  function U(N) {
    let { metaSchema: y } = N;
    y !== void 0 && (N.$data && this.opts.$data && (y = z(y)), N.validateSchema = this.compile(y, !0));
  }
  const W = {
    $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
  };
  function z(N) {
    return { anyOf: [N, W] };
  }
})(mu);
var Ka = {}, Ha = {}, Ba = {};
Object.defineProperty(Ba, "__esModule", { value: !0 });
const X_ = {
  keyword: "id",
  code() {
    throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
  }
};
Ba.default = X_;
var gr = {};
Object.defineProperty(gr, "__esModule", { value: !0 });
gr.callRef = gr.getValidate = void 0;
const Y_ = Ss(), Ec = fe, xe = ue, Er = Nt, wc = Qe, An = H, x_ = {
  keyword: "$ref",
  schemaType: "string",
  code(e) {
    const { gen: t, schema: r, it: n } = e, { baseId: s, schemaEnv: o, validateName: a, opts: i, self: c } = n, { root: d } = o;
    if ((r === "#" || r === "#/") && s === d.baseId)
      return f();
    const u = wc.resolveRef.call(c, d, s, r);
    if (u === void 0)
      throw new Y_.default(n.opts.uriResolver, s, r);
    if (u instanceof wc.SchemaEnv)
      return g(u);
    return m(u);
    function f() {
      if (o === d)
        return Qn(e, a, o, o.$async);
      const v = t.scopeValue("root", { ref: d });
      return Qn(e, (0, xe._)`${v}.validate`, d, d.$async);
    }
    function g(v) {
      const $ = Cu(e, v);
      Qn(e, $, v, v.$async);
    }
    function m(v) {
      const $ = t.scopeValue("schema", i.code.source === !0 ? { ref: v, code: (0, xe.stringify)(v) } : { ref: v }), _ = t.name("valid"), p = e.subschema({
        schema: v,
        dataTypes: [],
        schemaPath: xe.nil,
        topSchemaRef: $,
        errSchemaPath: r
      }, _);
      e.mergeEvaluated(p), e.ok(_);
    }
  }
};
function Cu(e, t) {
  const { gen: r } = e;
  return t.validate ? r.scopeValue("validate", { ref: t.validate }) : (0, xe._)`${r.scopeValue("wrapper", { ref: t })}.validate`;
}
gr.getValidate = Cu;
function Qn(e, t, r, n) {
  const { gen: s, it: o } = e, { allErrors: a, schemaEnv: i, opts: c } = o, d = c.passContext ? Er.default.this : xe.nil;
  n ? u() : f();
  function u() {
    if (!i.$async)
      throw new Error("async schema referenced by sync schema");
    const v = s.let("valid");
    s.try(() => {
      s.code((0, xe._)`await ${(0, Ec.callValidateCode)(e, t, d)}`), m(t), a || s.assign(v, !0);
    }, ($) => {
      s.if((0, xe._)`!(${$} instanceof ${o.ValidationError})`, () => s.throw($)), g($), a || s.assign(v, !1);
    }), e.ok(v);
  }
  function f() {
    e.result((0, Ec.callValidateCode)(e, t, d), () => m(t), () => g(t));
  }
  function g(v) {
    const $ = (0, xe._)`${v}.errors`;
    s.assign(Er.default.vErrors, (0, xe._)`${Er.default.vErrors} === null ? ${$} : ${Er.default.vErrors}.concat(${$})`), s.assign(Er.default.errors, (0, xe._)`${Er.default.vErrors}.length`);
  }
  function m(v) {
    var $;
    if (!o.opts.unevaluated)
      return;
    const _ = ($ = r == null ? void 0 : r.validate) === null || $ === void 0 ? void 0 : $.evaluated;
    if (o.props !== !0)
      if (_ && !_.dynamicProps)
        _.props !== void 0 && (o.props = An.mergeEvaluated.props(s, _.props, o.props));
      else {
        const p = s.var("props", (0, xe._)`${v}.evaluated.props`);
        o.props = An.mergeEvaluated.props(s, p, o.props, xe.Name);
      }
    if (o.items !== !0)
      if (_ && !_.dynamicItems)
        _.items !== void 0 && (o.items = An.mergeEvaluated.items(s, _.items, o.items));
      else {
        const p = s.var("items", (0, xe._)`${v}.evaluated.items`);
        o.items = An.mergeEvaluated.items(s, p, o.items, xe.Name);
      }
  }
}
gr.callRef = Qn;
gr.default = x_;
Object.defineProperty(Ha, "__esModule", { value: !0 });
const Q_ = Ba, Z_ = gr, e0 = [
  "$schema",
  "$id",
  "$defs",
  "$vocabulary",
  { keyword: "$comment" },
  "definitions",
  Q_.default,
  Z_.default
];
Ha.default = e0;
var Wa = {}, Ja = {};
Object.defineProperty(Ja, "__esModule", { value: !0 });
const cs = ue, qt = cs.operators, ls = {
  maximum: { okStr: "<=", ok: qt.LTE, fail: qt.GT },
  minimum: { okStr: ">=", ok: qt.GTE, fail: qt.LT },
  exclusiveMaximum: { okStr: "<", ok: qt.LT, fail: qt.GTE },
  exclusiveMinimum: { okStr: ">", ok: qt.GT, fail: qt.LTE }
}, t0 = {
  message: ({ keyword: e, schemaCode: t }) => (0, cs.str)`must be ${ls[e].okStr} ${t}`,
  params: ({ keyword: e, schemaCode: t }) => (0, cs._)`{comparison: ${ls[e].okStr}, limit: ${t}}`
}, r0 = {
  keyword: Object.keys(ls),
  type: "number",
  schemaType: "number",
  $data: !0,
  error: t0,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e;
    e.fail$data((0, cs._)`${r} ${ls[t].fail} ${n} || isNaN(${r})`);
  }
};
Ja.default = r0;
var Xa = {};
Object.defineProperty(Xa, "__esModule", { value: !0 });
const ln = ue, n0 = {
  message: ({ schemaCode: e }) => (0, ln.str)`must be multiple of ${e}`,
  params: ({ schemaCode: e }) => (0, ln._)`{multipleOf: ${e}}`
}, s0 = {
  keyword: "multipleOf",
  type: "number",
  schemaType: "number",
  $data: !0,
  error: n0,
  code(e) {
    const { gen: t, data: r, schemaCode: n, it: s } = e, o = s.opts.multipleOfPrecision, a = t.let("res"), i = o ? (0, ln._)`Math.abs(Math.round(${a}) - ${a}) > 1e-${o}` : (0, ln._)`${a} !== parseInt(${a})`;
    e.fail$data((0, ln._)`(${n} === 0 || (${a} = ${r}/${n}, ${i}))`);
  }
};
Xa.default = s0;
var Ya = {}, xa = {};
Object.defineProperty(xa, "__esModule", { value: !0 });
function ku(e) {
  const t = e.length;
  let r = 0, n = 0, s;
  for (; n < t; )
    r++, s = e.charCodeAt(n++), s >= 55296 && s <= 56319 && n < t && (s = e.charCodeAt(n), (s & 64512) === 56320 && n++);
  return r;
}
xa.default = ku;
ku.code = 'require("ajv/dist/runtime/ucs2length").default';
Object.defineProperty(Ya, "__esModule", { value: !0 });
const dr = ue, o0 = H, a0 = xa, i0 = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxLength" ? "more" : "fewer";
    return (0, dr.str)`must NOT have ${r} than ${t} characters`;
  },
  params: ({ schemaCode: e }) => (0, dr._)`{limit: ${e}}`
}, c0 = {
  keyword: ["maxLength", "minLength"],
  type: "string",
  schemaType: "number",
  $data: !0,
  error: i0,
  code(e) {
    const { keyword: t, data: r, schemaCode: n, it: s } = e, o = t === "maxLength" ? dr.operators.GT : dr.operators.LT, a = s.opts.unicode === !1 ? (0, dr._)`${r}.length` : (0, dr._)`${(0, o0.useFunc)(e.gen, a0.default)}(${r})`;
    e.fail$data((0, dr._)`${a} ${o} ${n}`);
  }
};
Ya.default = c0;
var Qa = {};
Object.defineProperty(Qa, "__esModule", { value: !0 });
const l0 = fe, us = ue, u0 = {
  message: ({ schemaCode: e }) => (0, us.str)`must match pattern "${e}"`,
  params: ({ schemaCode: e }) => (0, us._)`{pattern: ${e}}`
}, d0 = {
  keyword: "pattern",
  type: "string",
  schemaType: "string",
  $data: !0,
  error: u0,
  code(e) {
    const { data: t, $data: r, schema: n, schemaCode: s, it: o } = e, a = o.opts.unicodeRegExp ? "u" : "", i = r ? (0, us._)`(new RegExp(${s}, ${a}))` : (0, l0.usePattern)(e, n);
    e.fail$data((0, us._)`!${i}.test(${t})`);
  }
};
Qa.default = d0;
var Za = {};
Object.defineProperty(Za, "__esModule", { value: !0 });
const un = ue, f0 = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxProperties" ? "more" : "fewer";
    return (0, un.str)`must NOT have ${r} than ${t} properties`;
  },
  params: ({ schemaCode: e }) => (0, un._)`{limit: ${e}}`
}, h0 = {
  keyword: ["maxProperties", "minProperties"],
  type: "object",
  schemaType: "number",
  $data: !0,
  error: f0,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e, s = t === "maxProperties" ? un.operators.GT : un.operators.LT;
    e.fail$data((0, un._)`Object.keys(${r}).length ${s} ${n}`);
  }
};
Za.default = h0;
var ei = {};
Object.defineProperty(ei, "__esModule", { value: !0 });
const xr = fe, dn = ue, p0 = H, m0 = {
  message: ({ params: { missingProperty: e } }) => (0, dn.str)`must have required property '${e}'`,
  params: ({ params: { missingProperty: e } }) => (0, dn._)`{missingProperty: ${e}}`
}, y0 = {
  keyword: "required",
  type: "object",
  schemaType: "array",
  $data: !0,
  error: m0,
  code(e) {
    const { gen: t, schema: r, schemaCode: n, data: s, $data: o, it: a } = e, { opts: i } = a;
    if (!o && r.length === 0)
      return;
    const c = r.length >= i.loopRequired;
    if (a.allErrors ? d() : u(), i.strictRequired) {
      const m = e.parentSchema.properties, { definedProperties: v } = e.it;
      for (const $ of r)
        if ((m == null ? void 0 : m[$]) === void 0 && !v.has($)) {
          const _ = a.schemaEnv.baseId + a.errSchemaPath, p = `required property "${$}" is not defined at "${_}" (strictRequired)`;
          (0, p0.checkStrictMode)(a, p, a.opts.strictRequired);
        }
    }
    function d() {
      if (c || o)
        e.block$data(dn.nil, f);
      else
        for (const m of r)
          (0, xr.checkReportMissingProp)(e, m);
    }
    function u() {
      const m = t.let("missing");
      if (c || o) {
        const v = t.let("valid", !0);
        e.block$data(v, () => g(m, v)), e.ok(v);
      } else
        t.if((0, xr.checkMissingProp)(e, r, m)), (0, xr.reportMissingProp)(e, m), t.else();
    }
    function f() {
      t.forOf("prop", n, (m) => {
        e.setParams({ missingProperty: m }), t.if((0, xr.noPropertyInData)(t, s, m, i.ownProperties), () => e.error());
      });
    }
    function g(m, v) {
      e.setParams({ missingProperty: m }), t.forOf(m, n, () => {
        t.assign(v, (0, xr.propertyInData)(t, s, m, i.ownProperties)), t.if((0, dn.not)(v), () => {
          e.error(), t.break();
        });
      }, dn.nil);
    }
  }
};
ei.default = y0;
var ti = {};
Object.defineProperty(ti, "__esModule", { value: !0 });
const fn = ue, $0 = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxItems" ? "more" : "fewer";
    return (0, fn.str)`must NOT have ${r} than ${t} items`;
  },
  params: ({ schemaCode: e }) => (0, fn._)`{limit: ${e}}`
}, g0 = {
  keyword: ["maxItems", "minItems"],
  type: "array",
  schemaType: "number",
  $data: !0,
  error: $0,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e, s = t === "maxItems" ? fn.operators.GT : fn.operators.LT;
    e.fail$data((0, fn._)`${r}.length ${s} ${n}`);
  }
};
ti.default = g0;
var ri = {}, vn = {};
Object.defineProperty(vn, "__esModule", { value: !0 });
const Du = ms;
Du.code = 'require("ajv/dist/runtime/equal").default';
vn.default = Du;
Object.defineProperty(ri, "__esModule", { value: !0 });
const Ys = Te, Ce = ue, _0 = H, v0 = vn, E0 = {
  message: ({ params: { i: e, j: t } }) => (0, Ce.str)`must NOT have duplicate items (items ## ${t} and ${e} are identical)`,
  params: ({ params: { i: e, j: t } }) => (0, Ce._)`{i: ${e}, j: ${t}}`
}, w0 = {
  keyword: "uniqueItems",
  type: "array",
  schemaType: "boolean",
  $data: !0,
  error: E0,
  code(e) {
    const { gen: t, data: r, $data: n, schema: s, parentSchema: o, schemaCode: a, it: i } = e;
    if (!n && !s)
      return;
    const c = t.let("valid"), d = o.items ? (0, Ys.getSchemaTypes)(o.items) : [];
    e.block$data(c, u, (0, Ce._)`${a} === false`), e.ok(c);
    function u() {
      const v = t.let("i", (0, Ce._)`${r}.length`), $ = t.let("j");
      e.setParams({ i: v, j: $ }), t.assign(c, !0), t.if((0, Ce._)`${v} > 1`, () => (f() ? g : m)(v, $));
    }
    function f() {
      return d.length > 0 && !d.some((v) => v === "object" || v === "array");
    }
    function g(v, $) {
      const _ = t.name("item"), p = (0, Ys.checkDataTypes)(d, _, i.opts.strictNumbers, Ys.DataType.Wrong), w = t.const("indices", (0, Ce._)`{}`);
      t.for((0, Ce._)`;${v}--;`, () => {
        t.let(_, (0, Ce._)`${r}[${v}]`), t.if(p, (0, Ce._)`continue`), d.length > 1 && t.if((0, Ce._)`typeof ${_} == "string"`, (0, Ce._)`${_} += "_"`), t.if((0, Ce._)`typeof ${w}[${_}] == "number"`, () => {
          t.assign($, (0, Ce._)`${w}[${_}]`), e.error(), t.assign(c, !1).break();
        }).code((0, Ce._)`${w}[${_}] = ${v}`);
      });
    }
    function m(v, $) {
      const _ = (0, _0.useFunc)(t, v0.default), p = t.name("outer");
      t.label(p).for((0, Ce._)`;${v}--;`, () => t.for((0, Ce._)`${$} = ${v}; ${$}--;`, () => t.if((0, Ce._)`${_}(${r}[${v}], ${r}[${$}])`, () => {
        e.error(), t.assign(c, !1).break(p);
      })));
    }
  }
};
ri.default = w0;
var ni = {};
Object.defineProperty(ni, "__esModule", { value: !0 });
const bo = ue, S0 = H, b0 = vn, P0 = {
  message: "must be equal to constant",
  params: ({ schemaCode: e }) => (0, bo._)`{allowedValue: ${e}}`
}, N0 = {
  keyword: "const",
  $data: !0,
  error: P0,
  code(e) {
    const { gen: t, data: r, $data: n, schemaCode: s, schema: o } = e;
    n || o && typeof o == "object" ? e.fail$data((0, bo._)`!${(0, S0.useFunc)(t, b0.default)}(${r}, ${s})`) : e.fail((0, bo._)`${o} !== ${r}`);
  }
};
ni.default = N0;
var si = {};
Object.defineProperty(si, "__esModule", { value: !0 });
const tn = ue, R0 = H, T0 = vn, O0 = {
  message: "must be equal to one of the allowed values",
  params: ({ schemaCode: e }) => (0, tn._)`{allowedValues: ${e}}`
}, I0 = {
  keyword: "enum",
  schemaType: "array",
  $data: !0,
  error: O0,
  code(e) {
    const { gen: t, data: r, $data: n, schema: s, schemaCode: o, it: a } = e;
    if (!n && s.length === 0)
      throw new Error("enum must have non-empty array");
    const i = s.length >= a.opts.loopEnum;
    let c;
    const d = () => c ?? (c = (0, R0.useFunc)(t, T0.default));
    let u;
    if (i || n)
      u = t.let("valid"), e.block$data(u, f);
    else {
      if (!Array.isArray(s))
        throw new Error("ajv implementation error");
      const m = t.const("vSchema", o);
      u = (0, tn.or)(...s.map((v, $) => g(m, $)));
    }
    e.pass(u);
    function f() {
      t.assign(u, !1), t.forOf("v", o, (m) => t.if((0, tn._)`${d()}(${r}, ${m})`, () => t.assign(u, !0).break()));
    }
    function g(m, v) {
      const $ = s[v];
      return typeof $ == "object" && $ !== null ? (0, tn._)`${d()}(${r}, ${m}[${v}])` : (0, tn._)`${r} === ${$}`;
    }
  }
};
si.default = I0;
Object.defineProperty(Wa, "__esModule", { value: !0 });
const j0 = Ja, A0 = Xa, C0 = Ya, k0 = Qa, D0 = Za, M0 = ei, L0 = ti, F0 = ri, V0 = ni, U0 = si, z0 = [
  // number
  j0.default,
  A0.default,
  // string
  C0.default,
  k0.default,
  // object
  D0.default,
  M0.default,
  // array
  L0.default,
  F0.default,
  // any
  { keyword: "type", schemaType: ["string", "array"] },
  { keyword: "nullable", schemaType: "boolean" },
  V0.default,
  U0.default
];
Wa.default = z0;
var oi = {}, zr = {};
Object.defineProperty(zr, "__esModule", { value: !0 });
zr.validateAdditionalItems = void 0;
const fr = ue, Po = H, q0 = {
  message: ({ params: { len: e } }) => (0, fr.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, fr._)`{limit: ${e}}`
}, G0 = {
  keyword: "additionalItems",
  type: "array",
  schemaType: ["boolean", "object"],
  before: "uniqueItems",
  error: q0,
  code(e) {
    const { parentSchema: t, it: r } = e, { items: n } = t;
    if (!Array.isArray(n)) {
      (0, Po.checkStrictMode)(r, '"additionalItems" is ignored when "items" is not an array of schemas');
      return;
    }
    Mu(e, n);
  }
};
function Mu(e, t) {
  const { gen: r, schema: n, data: s, keyword: o, it: a } = e;
  a.items = !0;
  const i = r.const("len", (0, fr._)`${s}.length`);
  if (n === !1)
    e.setParams({ len: t.length }), e.pass((0, fr._)`${i} <= ${t.length}`);
  else if (typeof n == "object" && !(0, Po.alwaysValidSchema)(a, n)) {
    const d = r.var("valid", (0, fr._)`${i} <= ${t.length}`);
    r.if((0, fr.not)(d), () => c(d)), e.ok(d);
  }
  function c(d) {
    r.forRange("i", t.length, i, (u) => {
      e.subschema({ keyword: o, dataProp: u, dataPropType: Po.Type.Num }, d), a.allErrors || r.if((0, fr.not)(d), () => r.break());
    });
  }
}
zr.validateAdditionalItems = Mu;
zr.default = G0;
var ai = {}, qr = {};
Object.defineProperty(qr, "__esModule", { value: !0 });
qr.validateTuple = void 0;
const Sc = ue, Zn = H, K0 = fe, H0 = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "array", "boolean"],
  before: "uniqueItems",
  code(e) {
    const { schema: t, it: r } = e;
    if (Array.isArray(t))
      return Lu(e, "additionalItems", t);
    r.items = !0, !(0, Zn.alwaysValidSchema)(r, t) && e.ok((0, K0.validateArray)(e));
  }
};
function Lu(e, t, r = e.schema) {
  const { gen: n, parentSchema: s, data: o, keyword: a, it: i } = e;
  u(s), i.opts.unevaluated && r.length && i.items !== !0 && (i.items = Zn.mergeEvaluated.items(n, r.length, i.items));
  const c = n.name("valid"), d = n.const("len", (0, Sc._)`${o}.length`);
  r.forEach((f, g) => {
    (0, Zn.alwaysValidSchema)(i, f) || (n.if((0, Sc._)`${d} > ${g}`, () => e.subschema({
      keyword: a,
      schemaProp: g,
      dataProp: g
    }, c)), e.ok(c));
  });
  function u(f) {
    const { opts: g, errSchemaPath: m } = i, v = r.length, $ = v === f.minItems && (v === f.maxItems || f[t] === !1);
    if (g.strictTuples && !$) {
      const _ = `"${a}" is ${v}-tuple, but minItems or maxItems/${t} are not specified or different at path "${m}"`;
      (0, Zn.checkStrictMode)(i, _, g.strictTuples);
    }
  }
}
qr.validateTuple = Lu;
qr.default = H0;
Object.defineProperty(ai, "__esModule", { value: !0 });
const B0 = qr, W0 = {
  keyword: "prefixItems",
  type: "array",
  schemaType: ["array"],
  before: "uniqueItems",
  code: (e) => (0, B0.validateTuple)(e, "items")
};
ai.default = W0;
var ii = {};
Object.defineProperty(ii, "__esModule", { value: !0 });
const bc = ue, J0 = H, X0 = fe, Y0 = zr, x0 = {
  message: ({ params: { len: e } }) => (0, bc.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, bc._)`{limit: ${e}}`
}, Q0 = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  error: x0,
  code(e) {
    const { schema: t, parentSchema: r, it: n } = e, { prefixItems: s } = r;
    n.items = !0, !(0, J0.alwaysValidSchema)(n, t) && (s ? (0, Y0.validateAdditionalItems)(e, s) : e.ok((0, X0.validateArray)(e)));
  }
};
ii.default = Q0;
var ci = {};
Object.defineProperty(ci, "__esModule", { value: !0 });
const st = ue, Cn = H, Z0 = {
  message: ({ params: { min: e, max: t } }) => t === void 0 ? (0, st.str)`must contain at least ${e} valid item(s)` : (0, st.str)`must contain at least ${e} and no more than ${t} valid item(s)`,
  params: ({ params: { min: e, max: t } }) => t === void 0 ? (0, st._)`{minContains: ${e}}` : (0, st._)`{minContains: ${e}, maxContains: ${t}}`
}, ev = {
  keyword: "contains",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  trackErrors: !0,
  error: Z0,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, it: o } = e;
    let a, i;
    const { minContains: c, maxContains: d } = n;
    o.opts.next ? (a = c === void 0 ? 1 : c, i = d) : a = 1;
    const u = t.const("len", (0, st._)`${s}.length`);
    if (e.setParams({ min: a, max: i }), i === void 0 && a === 0) {
      (0, Cn.checkStrictMode)(o, '"minContains" == 0 without "maxContains": "contains" keyword ignored');
      return;
    }
    if (i !== void 0 && a > i) {
      (0, Cn.checkStrictMode)(o, '"minContains" > "maxContains" is always invalid'), e.fail();
      return;
    }
    if ((0, Cn.alwaysValidSchema)(o, r)) {
      let $ = (0, st._)`${u} >= ${a}`;
      i !== void 0 && ($ = (0, st._)`${$} && ${u} <= ${i}`), e.pass($);
      return;
    }
    o.items = !0;
    const f = t.name("valid");
    i === void 0 && a === 1 ? m(f, () => t.if(f, () => t.break())) : a === 0 ? (t.let(f, !0), i !== void 0 && t.if((0, st._)`${s}.length > 0`, g)) : (t.let(f, !1), g()), e.result(f, () => e.reset());
    function g() {
      const $ = t.name("_valid"), _ = t.let("count", 0);
      m($, () => t.if($, () => v(_)));
    }
    function m($, _) {
      t.forRange("i", 0, u, (p) => {
        e.subschema({
          keyword: "contains",
          dataProp: p,
          dataPropType: Cn.Type.Num,
          compositeRule: !0
        }, $), _();
      });
    }
    function v($) {
      t.code((0, st._)`${$}++`), i === void 0 ? t.if((0, st._)`${$} >= ${a}`, () => t.assign(f, !0).break()) : (t.if((0, st._)`${$} > ${i}`, () => t.assign(f, !1).break()), a === 1 ? t.assign(f, !0) : t.if((0, st._)`${$} >= ${a}`, () => t.assign(f, !0)));
    }
  }
};
ci.default = ev;
var Fu = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.validateSchemaDeps = e.validatePropertyDeps = e.error = void 0;
  const t = ue, r = H, n = fe;
  e.error = {
    message: ({ params: { property: c, depsCount: d, deps: u } }) => {
      const f = d === 1 ? "property" : "properties";
      return (0, t.str)`must have ${f} ${u} when property ${c} is present`;
    },
    params: ({ params: { property: c, depsCount: d, deps: u, missingProperty: f } }) => (0, t._)`{property: ${c},
    missingProperty: ${f},
    depsCount: ${d},
    deps: ${u}}`
    // TODO change to reference
  };
  const s = {
    keyword: "dependencies",
    type: "object",
    schemaType: "object",
    error: e.error,
    code(c) {
      const [d, u] = o(c);
      a(c, d), i(c, u);
    }
  };
  function o({ schema: c }) {
    const d = {}, u = {};
    for (const f in c) {
      if (f === "__proto__")
        continue;
      const g = Array.isArray(c[f]) ? d : u;
      g[f] = c[f];
    }
    return [d, u];
  }
  function a(c, d = c.schema) {
    const { gen: u, data: f, it: g } = c;
    if (Object.keys(d).length === 0)
      return;
    const m = u.let("missing");
    for (const v in d) {
      const $ = d[v];
      if ($.length === 0)
        continue;
      const _ = (0, n.propertyInData)(u, f, v, g.opts.ownProperties);
      c.setParams({
        property: v,
        depsCount: $.length,
        deps: $.join(", ")
      }), g.allErrors ? u.if(_, () => {
        for (const p of $)
          (0, n.checkReportMissingProp)(c, p);
      }) : (u.if((0, t._)`${_} && (${(0, n.checkMissingProp)(c, $, m)})`), (0, n.reportMissingProp)(c, m), u.else());
    }
  }
  e.validatePropertyDeps = a;
  function i(c, d = c.schema) {
    const { gen: u, data: f, keyword: g, it: m } = c, v = u.name("valid");
    for (const $ in d)
      (0, r.alwaysValidSchema)(m, d[$]) || (u.if(
        (0, n.propertyInData)(u, f, $, m.opts.ownProperties),
        () => {
          const _ = c.subschema({ keyword: g, schemaProp: $ }, v);
          c.mergeValidEvaluated(_, v);
        },
        () => u.var(v, !0)
        // TODO var
      ), c.ok(v));
  }
  e.validateSchemaDeps = i, e.default = s;
})(Fu);
var li = {};
Object.defineProperty(li, "__esModule", { value: !0 });
const Vu = ue, tv = H, rv = {
  message: "property name must be valid",
  params: ({ params: e }) => (0, Vu._)`{propertyName: ${e.propertyName}}`
}, nv = {
  keyword: "propertyNames",
  type: "object",
  schemaType: ["object", "boolean"],
  error: rv,
  code(e) {
    const { gen: t, schema: r, data: n, it: s } = e;
    if ((0, tv.alwaysValidSchema)(s, r))
      return;
    const o = t.name("valid");
    t.forIn("key", n, (a) => {
      e.setParams({ propertyName: a }), e.subschema({
        keyword: "propertyNames",
        data: a,
        dataTypes: ["string"],
        propertyName: a,
        compositeRule: !0
      }, o), t.if((0, Vu.not)(o), () => {
        e.error(!0), s.allErrors || t.break();
      });
    }), e.ok(o);
  }
};
li.default = nv;
var Ns = {};
Object.defineProperty(Ns, "__esModule", { value: !0 });
const kn = fe, ut = ue, sv = Nt, Dn = H, ov = {
  message: "must NOT have additional properties",
  params: ({ params: e }) => (0, ut._)`{additionalProperty: ${e.additionalProperty}}`
}, av = {
  keyword: "additionalProperties",
  type: ["object"],
  schemaType: ["boolean", "object"],
  allowUndefined: !0,
  trackErrors: !0,
  error: ov,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, errsCount: o, it: a } = e;
    if (!o)
      throw new Error("ajv implementation error");
    const { allErrors: i, opts: c } = a;
    if (a.props = !0, c.removeAdditional !== "all" && (0, Dn.alwaysValidSchema)(a, r))
      return;
    const d = (0, kn.allSchemaProperties)(n.properties), u = (0, kn.allSchemaProperties)(n.patternProperties);
    f(), e.ok((0, ut._)`${o} === ${sv.default.errors}`);
    function f() {
      t.forIn("key", s, (_) => {
        !d.length && !u.length ? v(_) : t.if(g(_), () => v(_));
      });
    }
    function g(_) {
      let p;
      if (d.length > 8) {
        const w = (0, Dn.schemaRefOrVal)(a, n.properties, "properties");
        p = (0, kn.isOwnProperty)(t, w, _);
      } else d.length ? p = (0, ut.or)(...d.map((w) => (0, ut._)`${_} === ${w}`)) : p = ut.nil;
      return u.length && (p = (0, ut.or)(p, ...u.map((w) => (0, ut._)`${(0, kn.usePattern)(e, w)}.test(${_})`))), (0, ut.not)(p);
    }
    function m(_) {
      t.code((0, ut._)`delete ${s}[${_}]`);
    }
    function v(_) {
      if (c.removeAdditional === "all" || c.removeAdditional && r === !1) {
        m(_);
        return;
      }
      if (r === !1) {
        e.setParams({ additionalProperty: _ }), e.error(), i || t.break();
        return;
      }
      if (typeof r == "object" && !(0, Dn.alwaysValidSchema)(a, r)) {
        const p = t.name("valid");
        c.removeAdditional === "failing" ? ($(_, p, !1), t.if((0, ut.not)(p), () => {
          e.reset(), m(_);
        })) : ($(_, p), i || t.if((0, ut.not)(p), () => t.break()));
      }
    }
    function $(_, p, w) {
      const P = {
        keyword: "additionalProperties",
        dataProp: _,
        dataPropType: Dn.Type.Str
      };
      w === !1 && Object.assign(P, {
        compositeRule: !0,
        createErrors: !1,
        allErrors: !1
      }), e.subschema(P, p);
    }
  }
};
Ns.default = av;
var ui = {};
Object.defineProperty(ui, "__esModule", { value: !0 });
const iv = ws(), Pc = fe, xs = H, Nc = Ns, cv = {
  keyword: "properties",
  type: "object",
  schemaType: "object",
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, it: o } = e;
    o.opts.removeAdditional === "all" && n.additionalProperties === void 0 && Nc.default.code(new iv.KeywordCxt(o, Nc.default, "additionalProperties"));
    const a = (0, Pc.allSchemaProperties)(r);
    for (const f of a)
      o.definedProperties.add(f);
    o.opts.unevaluated && a.length && o.props !== !0 && (o.props = xs.mergeEvaluated.props(t, (0, xs.toHash)(a), o.props));
    const i = a.filter((f) => !(0, xs.alwaysValidSchema)(o, r[f]));
    if (i.length === 0)
      return;
    const c = t.name("valid");
    for (const f of i)
      d(f) ? u(f) : (t.if((0, Pc.propertyInData)(t, s, f, o.opts.ownProperties)), u(f), o.allErrors || t.else().var(c, !0), t.endIf()), e.it.definedProperties.add(f), e.ok(c);
    function d(f) {
      return o.opts.useDefaults && !o.compositeRule && r[f].default !== void 0;
    }
    function u(f) {
      e.subschema({
        keyword: "properties",
        schemaProp: f,
        dataProp: f
      }, c);
    }
  }
};
ui.default = cv;
var di = {};
Object.defineProperty(di, "__esModule", { value: !0 });
const Rc = fe, Mn = ue, Tc = H, Oc = H, lv = {
  keyword: "patternProperties",
  type: "object",
  schemaType: "object",
  code(e) {
    const { gen: t, schema: r, data: n, parentSchema: s, it: o } = e, { opts: a } = o, i = (0, Rc.allSchemaProperties)(r), c = i.filter(($) => (0, Tc.alwaysValidSchema)(o, r[$]));
    if (i.length === 0 || c.length === i.length && (!o.opts.unevaluated || o.props === !0))
      return;
    const d = a.strictSchema && !a.allowMatchingProperties && s.properties, u = t.name("valid");
    o.props !== !0 && !(o.props instanceof Mn.Name) && (o.props = (0, Oc.evaluatedPropsToName)(t, o.props));
    const { props: f } = o;
    g();
    function g() {
      for (const $ of i)
        d && m($), o.allErrors ? v($) : (t.var(u, !0), v($), t.if(u));
    }
    function m($) {
      for (const _ in d)
        new RegExp($).test(_) && (0, Tc.checkStrictMode)(o, `property ${_} matches pattern ${$} (use allowMatchingProperties)`);
    }
    function v($) {
      t.forIn("key", n, (_) => {
        t.if((0, Mn._)`${(0, Rc.usePattern)(e, $)}.test(${_})`, () => {
          const p = c.includes($);
          p || e.subschema({
            keyword: "patternProperties",
            schemaProp: $,
            dataProp: _,
            dataPropType: Oc.Type.Str
          }, u), o.opts.unevaluated && f !== !0 ? t.assign((0, Mn._)`${f}[${_}]`, !0) : !p && !o.allErrors && t.if((0, Mn.not)(u), () => t.break());
        });
      });
    }
  }
};
di.default = lv;
var fi = {};
Object.defineProperty(fi, "__esModule", { value: !0 });
const uv = H, dv = {
  keyword: "not",
  schemaType: ["object", "boolean"],
  trackErrors: !0,
  code(e) {
    const { gen: t, schema: r, it: n } = e;
    if ((0, uv.alwaysValidSchema)(n, r)) {
      e.fail();
      return;
    }
    const s = t.name("valid");
    e.subschema({
      keyword: "not",
      compositeRule: !0,
      createErrors: !1,
      allErrors: !1
    }, s), e.failResult(s, () => e.reset(), () => e.error());
  },
  error: { message: "must NOT be valid" }
};
fi.default = dv;
var hi = {};
Object.defineProperty(hi, "__esModule", { value: !0 });
const fv = fe, hv = {
  keyword: "anyOf",
  schemaType: "array",
  trackErrors: !0,
  code: fv.validateUnion,
  error: { message: "must match a schema in anyOf" }
};
hi.default = hv;
var pi = {};
Object.defineProperty(pi, "__esModule", { value: !0 });
const es = ue, pv = H, mv = {
  message: "must match exactly one schema in oneOf",
  params: ({ params: e }) => (0, es._)`{passingSchemas: ${e.passing}}`
}, yv = {
  keyword: "oneOf",
  schemaType: "array",
  trackErrors: !0,
  error: mv,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, it: s } = e;
    if (!Array.isArray(r))
      throw new Error("ajv implementation error");
    if (s.opts.discriminator && n.discriminator)
      return;
    const o = r, a = t.let("valid", !1), i = t.let("passing", null), c = t.name("_valid");
    e.setParams({ passing: i }), t.block(d), e.result(a, () => e.reset(), () => e.error(!0));
    function d() {
      o.forEach((u, f) => {
        let g;
        (0, pv.alwaysValidSchema)(s, u) ? t.var(c, !0) : g = e.subschema({
          keyword: "oneOf",
          schemaProp: f,
          compositeRule: !0
        }, c), f > 0 && t.if((0, es._)`${c} && ${a}`).assign(a, !1).assign(i, (0, es._)`[${i}, ${f}]`).else(), t.if(c, () => {
          t.assign(a, !0), t.assign(i, f), g && e.mergeEvaluated(g, es.Name);
        });
      });
    }
  }
};
pi.default = yv;
var mi = {};
Object.defineProperty(mi, "__esModule", { value: !0 });
const $v = H, gv = {
  keyword: "allOf",
  schemaType: "array",
  code(e) {
    const { gen: t, schema: r, it: n } = e;
    if (!Array.isArray(r))
      throw new Error("ajv implementation error");
    const s = t.name("valid");
    r.forEach((o, a) => {
      if ((0, $v.alwaysValidSchema)(n, o))
        return;
      const i = e.subschema({ keyword: "allOf", schemaProp: a }, s);
      e.ok(s), e.mergeEvaluated(i);
    });
  }
};
mi.default = gv;
var yi = {};
Object.defineProperty(yi, "__esModule", { value: !0 });
const ds = ue, Uu = H, _v = {
  message: ({ params: e }) => (0, ds.str)`must match "${e.ifClause}" schema`,
  params: ({ params: e }) => (0, ds._)`{failingKeyword: ${e.ifClause}}`
}, vv = {
  keyword: "if",
  schemaType: ["object", "boolean"],
  trackErrors: !0,
  error: _v,
  code(e) {
    const { gen: t, parentSchema: r, it: n } = e;
    r.then === void 0 && r.else === void 0 && (0, Uu.checkStrictMode)(n, '"if" without "then" and "else" is ignored');
    const s = Ic(n, "then"), o = Ic(n, "else");
    if (!s && !o)
      return;
    const a = t.let("valid", !0), i = t.name("_valid");
    if (c(), e.reset(), s && o) {
      const u = t.let("ifClause");
      e.setParams({ ifClause: u }), t.if(i, d("then", u), d("else", u));
    } else s ? t.if(i, d("then")) : t.if((0, ds.not)(i), d("else"));
    e.pass(a, () => e.error(!0));
    function c() {
      const u = e.subschema({
        keyword: "if",
        compositeRule: !0,
        createErrors: !1,
        allErrors: !1
      }, i);
      e.mergeEvaluated(u);
    }
    function d(u, f) {
      return () => {
        const g = e.subschema({ keyword: u }, i);
        t.assign(a, i), e.mergeValidEvaluated(g, a), f ? t.assign(f, (0, ds._)`${u}`) : e.setParams({ ifClause: u });
      };
    }
  }
};
function Ic(e, t) {
  const r = e.schema[t];
  return r !== void 0 && !(0, Uu.alwaysValidSchema)(e, r);
}
yi.default = vv;
var $i = {};
Object.defineProperty($i, "__esModule", { value: !0 });
const Ev = H, wv = {
  keyword: ["then", "else"],
  schemaType: ["object", "boolean"],
  code({ keyword: e, parentSchema: t, it: r }) {
    t.if === void 0 && (0, Ev.checkStrictMode)(r, `"${e}" without "if" is ignored`);
  }
};
$i.default = wv;
Object.defineProperty(oi, "__esModule", { value: !0 });
const Sv = zr, bv = ai, Pv = qr, Nv = ii, Rv = ci, Tv = Fu, Ov = li, Iv = Ns, jv = ui, Av = di, Cv = fi, kv = hi, Dv = pi, Mv = mi, Lv = yi, Fv = $i;
function Vv(e = !1) {
  const t = [
    // any
    Cv.default,
    kv.default,
    Dv.default,
    Mv.default,
    Lv.default,
    Fv.default,
    // object
    Ov.default,
    Iv.default,
    Tv.default,
    jv.default,
    Av.default
  ];
  return e ? t.push(bv.default, Nv.default) : t.push(Sv.default, Pv.default), t.push(Rv.default), t;
}
oi.default = Vv;
var gi = {}, _i = {};
Object.defineProperty(_i, "__esModule", { value: !0 });
const be = ue, Uv = {
  message: ({ schemaCode: e }) => (0, be.str)`must match format "${e}"`,
  params: ({ schemaCode: e }) => (0, be._)`{format: ${e}}`
}, zv = {
  keyword: "format",
  type: ["number", "string"],
  schemaType: "string",
  $data: !0,
  error: Uv,
  code(e, t) {
    const { gen: r, data: n, $data: s, schema: o, schemaCode: a, it: i } = e, { opts: c, errSchemaPath: d, schemaEnv: u, self: f } = i;
    if (!c.validateFormats)
      return;
    s ? g() : m();
    function g() {
      const v = r.scopeValue("formats", {
        ref: f.formats,
        code: c.code.formats
      }), $ = r.const("fDef", (0, be._)`${v}[${a}]`), _ = r.let("fType"), p = r.let("format");
      r.if((0, be._)`typeof ${$} == "object" && !(${$} instanceof RegExp)`, () => r.assign(_, (0, be._)`${$}.type || "string"`).assign(p, (0, be._)`${$}.validate`), () => r.assign(_, (0, be._)`"string"`).assign(p, $)), e.fail$data((0, be.or)(w(), P()));
      function w() {
        return c.strictSchema === !1 ? be.nil : (0, be._)`${a} && !${p}`;
      }
      function P() {
        const T = u.$async ? (0, be._)`(${$}.async ? await ${p}(${n}) : ${p}(${n}))` : (0, be._)`${p}(${n})`, I = (0, be._)`(typeof ${p} == "function" ? ${T} : ${p}.test(${n}))`;
        return (0, be._)`${p} && ${p} !== true && ${_} === ${t} && !${I}`;
      }
    }
    function m() {
      const v = f.formats[o];
      if (!v) {
        w();
        return;
      }
      if (v === !0)
        return;
      const [$, _, p] = P(v);
      $ === t && e.pass(T());
      function w() {
        if (c.strictSchema === !1) {
          f.logger.warn(I());
          return;
        }
        throw new Error(I());
        function I() {
          return `unknown format "${o}" ignored in schema at path "${d}"`;
        }
      }
      function P(I) {
        const L = I instanceof RegExp ? (0, be.regexpCode)(I) : c.code.formats ? (0, be._)`${c.code.formats}${(0, be.getProperty)(o)}` : void 0, M = r.scopeValue("formats", { key: o, ref: I, code: L });
        return typeof I == "object" && !(I instanceof RegExp) ? [I.type || "string", I.validate, (0, be._)`${M}.validate`] : ["string", I, M];
      }
      function T() {
        if (typeof v == "object" && !(v instanceof RegExp) && v.async) {
          if (!u.$async)
            throw new Error("async format in sync schema");
          return (0, be._)`await ${p}(${n})`;
        }
        return typeof _ == "function" ? (0, be._)`${p}(${n})` : (0, be._)`${p}.test(${n})`;
      }
    }
  }
};
_i.default = zv;
Object.defineProperty(gi, "__esModule", { value: !0 });
const qv = _i, Gv = [qv.default];
gi.default = Gv;
var Dr = {};
Object.defineProperty(Dr, "__esModule", { value: !0 });
Dr.contentVocabulary = Dr.metadataVocabulary = void 0;
Dr.metadataVocabulary = [
  "title",
  "description",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
  "examples"
];
Dr.contentVocabulary = [
  "contentMediaType",
  "contentEncoding",
  "contentSchema"
];
Object.defineProperty(Ka, "__esModule", { value: !0 });
const Kv = Ha, Hv = Wa, Bv = oi, Wv = gi, jc = Dr, Jv = [
  Kv.default,
  Hv.default,
  (0, Bv.default)(),
  Wv.default,
  jc.metadataVocabulary,
  jc.contentVocabulary
];
Ka.default = Jv;
var vi = {}, Rs = {};
Object.defineProperty(Rs, "__esModule", { value: !0 });
Rs.DiscrError = void 0;
var Ac;
(function(e) {
  e.Tag = "tag", e.Mapping = "mapping";
})(Ac || (Rs.DiscrError = Ac = {}));
Object.defineProperty(vi, "__esModule", { value: !0 });
const br = ue, No = Rs, Cc = Qe, Xv = Ss(), Yv = H, xv = {
  message: ({ params: { discrError: e, tagName: t } }) => e === No.DiscrError.Tag ? `tag "${t}" must be string` : `value of tag "${t}" must be in oneOf`,
  params: ({ params: { discrError: e, tag: t, tagName: r } }) => (0, br._)`{error: ${e}, tag: ${r}, tagValue: ${t}}`
}, Qv = {
  keyword: "discriminator",
  type: "object",
  schemaType: "object",
  error: xv,
  code(e) {
    const { gen: t, data: r, schema: n, parentSchema: s, it: o } = e, { oneOf: a } = s;
    if (!o.opts.discriminator)
      throw new Error("discriminator: requires discriminator option");
    const i = n.propertyName;
    if (typeof i != "string")
      throw new Error("discriminator: requires propertyName");
    if (n.mapping)
      throw new Error("discriminator: mapping is not supported");
    if (!a)
      throw new Error("discriminator: requires oneOf keyword");
    const c = t.let("valid", !1), d = t.const("tag", (0, br._)`${r}${(0, br.getProperty)(i)}`);
    t.if((0, br._)`typeof ${d} == "string"`, () => u(), () => e.error(!1, { discrError: No.DiscrError.Tag, tag: d, tagName: i })), e.ok(c);
    function u() {
      const m = g();
      t.if(!1);
      for (const v in m)
        t.elseIf((0, br._)`${d} === ${v}`), t.assign(c, f(m[v]));
      t.else(), e.error(!1, { discrError: No.DiscrError.Mapping, tag: d, tagName: i }), t.endIf();
    }
    function f(m) {
      const v = t.name("valid"), $ = e.subschema({ keyword: "oneOf", schemaProp: m }, v);
      return e.mergeEvaluated($, br.Name), v;
    }
    function g() {
      var m;
      const v = {}, $ = p(s);
      let _ = !0;
      for (let T = 0; T < a.length; T++) {
        let I = a[T];
        if (I != null && I.$ref && !(0, Yv.schemaHasRulesButRef)(I, o.self.RULES)) {
          const M = I.$ref;
          if (I = Cc.resolveRef.call(o.self, o.schemaEnv.root, o.baseId, M), I instanceof Cc.SchemaEnv && (I = I.schema), I === void 0)
            throw new Xv.default(o.opts.uriResolver, o.baseId, M);
        }
        const L = (m = I == null ? void 0 : I.properties) === null || m === void 0 ? void 0 : m[i];
        if (typeof L != "object")
          throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${i}"`);
        _ = _ && ($ || p(I)), w(L, T);
      }
      if (!_)
        throw new Error(`discriminator: "${i}" must be required`);
      return v;
      function p({ required: T }) {
        return Array.isArray(T) && T.includes(i);
      }
      function w(T, I) {
        if (T.const)
          P(T.const, I);
        else if (T.enum)
          for (const L of T.enum)
            P(L, I);
        else
          throw new Error(`discriminator: "properties/${i}" must have "const" or "enum"`);
      }
      function P(T, I) {
        if (typeof T != "string" || T in v)
          throw new Error(`discriminator: "${i}" values must be unique strings`);
        v[T] = I;
      }
    }
  }
};
vi.default = Qv;
const Zv = "http://json-schema.org/draft-07/schema#", eE = "http://json-schema.org/draft-07/schema#", tE = "Core schema meta-schema", rE = {
  schemaArray: {
    type: "array",
    minItems: 1,
    items: {
      $ref: "#"
    }
  },
  nonNegativeInteger: {
    type: "integer",
    minimum: 0
  },
  nonNegativeIntegerDefault0: {
    allOf: [
      {
        $ref: "#/definitions/nonNegativeInteger"
      },
      {
        default: 0
      }
    ]
  },
  simpleTypes: {
    enum: [
      "array",
      "boolean",
      "integer",
      "null",
      "number",
      "object",
      "string"
    ]
  },
  stringArray: {
    type: "array",
    items: {
      type: "string"
    },
    uniqueItems: !0,
    default: []
  }
}, nE = [
  "object",
  "boolean"
], sE = {
  $id: {
    type: "string",
    format: "uri-reference"
  },
  $schema: {
    type: "string",
    format: "uri"
  },
  $ref: {
    type: "string",
    format: "uri-reference"
  },
  $comment: {
    type: "string"
  },
  title: {
    type: "string"
  },
  description: {
    type: "string"
  },
  default: !0,
  readOnly: {
    type: "boolean",
    default: !1
  },
  examples: {
    type: "array",
    items: !0
  },
  multipleOf: {
    type: "number",
    exclusiveMinimum: 0
  },
  maximum: {
    type: "number"
  },
  exclusiveMaximum: {
    type: "number"
  },
  minimum: {
    type: "number"
  },
  exclusiveMinimum: {
    type: "number"
  },
  maxLength: {
    $ref: "#/definitions/nonNegativeInteger"
  },
  minLength: {
    $ref: "#/definitions/nonNegativeIntegerDefault0"
  },
  pattern: {
    type: "string",
    format: "regex"
  },
  additionalItems: {
    $ref: "#"
  },
  items: {
    anyOf: [
      {
        $ref: "#"
      },
      {
        $ref: "#/definitions/schemaArray"
      }
    ],
    default: !0
  },
  maxItems: {
    $ref: "#/definitions/nonNegativeInteger"
  },
  minItems: {
    $ref: "#/definitions/nonNegativeIntegerDefault0"
  },
  uniqueItems: {
    type: "boolean",
    default: !1
  },
  contains: {
    $ref: "#"
  },
  maxProperties: {
    $ref: "#/definitions/nonNegativeInteger"
  },
  minProperties: {
    $ref: "#/definitions/nonNegativeIntegerDefault0"
  },
  required: {
    $ref: "#/definitions/stringArray"
  },
  additionalProperties: {
    $ref: "#"
  },
  definitions: {
    type: "object",
    additionalProperties: {
      $ref: "#"
    },
    default: {}
  },
  properties: {
    type: "object",
    additionalProperties: {
      $ref: "#"
    },
    default: {}
  },
  patternProperties: {
    type: "object",
    additionalProperties: {
      $ref: "#"
    },
    propertyNames: {
      format: "regex"
    },
    default: {}
  },
  dependencies: {
    type: "object",
    additionalProperties: {
      anyOf: [
        {
          $ref: "#"
        },
        {
          $ref: "#/definitions/stringArray"
        }
      ]
    }
  },
  propertyNames: {
    $ref: "#"
  },
  const: !0,
  enum: {
    type: "array",
    items: !0,
    minItems: 1,
    uniqueItems: !0
  },
  type: {
    anyOf: [
      {
        $ref: "#/definitions/simpleTypes"
      },
      {
        type: "array",
        items: {
          $ref: "#/definitions/simpleTypes"
        },
        minItems: 1,
        uniqueItems: !0
      }
    ]
  },
  format: {
    type: "string"
  },
  contentMediaType: {
    type: "string"
  },
  contentEncoding: {
    type: "string"
  },
  if: {
    $ref: "#"
  },
  then: {
    $ref: "#"
  },
  else: {
    $ref: "#"
  },
  allOf: {
    $ref: "#/definitions/schemaArray"
  },
  anyOf: {
    $ref: "#/definitions/schemaArray"
  },
  oneOf: {
    $ref: "#/definitions/schemaArray"
  },
  not: {
    $ref: "#"
  }
}, oE = {
  $schema: Zv,
  $id: eE,
  title: tE,
  definitions: rE,
  type: nE,
  properties: sE,
  default: !0
};
(function(e, t) {
  Object.defineProperty(t, "__esModule", { value: !0 }), t.MissingRefError = t.ValidationError = t.CodeGen = t.Name = t.nil = t.stringify = t.str = t._ = t.KeywordCxt = t.Ajv = void 0;
  const r = mu, n = Ka, s = vi, o = oE, a = ["/properties"], i = "http://json-schema.org/draft-07/schema";
  class c extends r.default {
    _addVocabularies() {
      super._addVocabularies(), n.default.forEach((v) => this.addVocabulary(v)), this.opts.discriminator && this.addKeyword(s.default);
    }
    _addDefaultMetaSchema() {
      if (super._addDefaultMetaSchema(), !this.opts.meta)
        return;
      const v = this.opts.$data ? this.$dataMetaSchema(o, a) : o;
      this.addMetaSchema(v, i, !1), this.refs["http://json-schema.org/schema"] = i;
    }
    defaultMeta() {
      return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(i) ? i : void 0);
    }
  }
  t.Ajv = c, e.exports = t = c, e.exports.Ajv = c, Object.defineProperty(t, "__esModule", { value: !0 }), t.default = c;
  var d = ws();
  Object.defineProperty(t, "KeywordCxt", { enumerable: !0, get: function() {
    return d.KeywordCxt;
  } });
  var u = ue;
  Object.defineProperty(t, "_", { enumerable: !0, get: function() {
    return u._;
  } }), Object.defineProperty(t, "str", { enumerable: !0, get: function() {
    return u.str;
  } }), Object.defineProperty(t, "stringify", { enumerable: !0, get: function() {
    return u.stringify;
  } }), Object.defineProperty(t, "nil", { enumerable: !0, get: function() {
    return u.nil;
  } }), Object.defineProperty(t, "Name", { enumerable: !0, get: function() {
    return u.Name;
  } }), Object.defineProperty(t, "CodeGen", { enumerable: !0, get: function() {
    return u.CodeGen;
  } });
  var f = _n;
  Object.defineProperty(t, "ValidationError", { enumerable: !0, get: function() {
    return f.default;
  } });
  var g = Ss();
  Object.defineProperty(t, "MissingRefError", { enumerable: !0, get: function() {
    return g.default;
  } });
})(_o, _o.exports);
var aE = _o.exports;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.formatLimitDefinition = void 0;
  const t = aE, r = ue, n = r.operators, s = {
    formatMaximum: { okStr: "<=", ok: n.LTE, fail: n.GT },
    formatMinimum: { okStr: ">=", ok: n.GTE, fail: n.LT },
    formatExclusiveMaximum: { okStr: "<", ok: n.LT, fail: n.GTE },
    formatExclusiveMinimum: { okStr: ">", ok: n.GT, fail: n.LTE }
  }, o = {
    message: ({ keyword: i, schemaCode: c }) => (0, r.str)`should be ${s[i].okStr} ${c}`,
    params: ({ keyword: i, schemaCode: c }) => (0, r._)`{comparison: ${s[i].okStr}, limit: ${c}}`
  };
  e.formatLimitDefinition = {
    keyword: Object.keys(s),
    type: "string",
    schemaType: "string",
    $data: !0,
    error: o,
    code(i) {
      const { gen: c, data: d, schemaCode: u, keyword: f, it: g } = i, { opts: m, self: v } = g;
      if (!m.validateFormats)
        return;
      const $ = new t.KeywordCxt(g, v.RULES.all.format.definition, "format");
      $.$data ? _() : p();
      function _() {
        const P = c.scopeValue("formats", {
          ref: v.formats,
          code: m.code.formats
        }), T = c.const("fmt", (0, r._)`${P}[${$.schemaCode}]`);
        i.fail$data((0, r.or)((0, r._)`typeof ${T} != "object"`, (0, r._)`${T} instanceof RegExp`, (0, r._)`typeof ${T}.compare != "function"`, w(T)));
      }
      function p() {
        const P = $.schema, T = v.formats[P];
        if (!T || T === !0)
          return;
        if (typeof T != "object" || T instanceof RegExp || typeof T.compare != "function")
          throw new Error(`"${f}": format "${P}" does not define "compare" function`);
        const I = c.scopeValue("formats", {
          key: P,
          ref: T,
          code: m.code.formats ? (0, r._)`${m.code.formats}${(0, r.getProperty)(P)}` : void 0
        });
        i.fail$data(w(I));
      }
      function w(P) {
        return (0, r._)`${P}.compare(${d}, ${u}) ${s[f].fail} 0`;
      }
    },
    dependencies: ["format"]
  };
  const a = (i) => (i.addKeyword(e.formatLimitDefinition), i);
  e.default = a;
})(pu);
(function(e, t) {
  Object.defineProperty(t, "__esModule", { value: !0 });
  const r = hu, n = pu, s = ue, o = new s.Name("fullFormats"), a = new s.Name("fastFormats"), i = (d, u = { keywords: !0 }) => {
    if (Array.isArray(u))
      return c(d, u, r.fullFormats, o), d;
    const [f, g] = u.mode === "fast" ? [r.fastFormats, a] : [r.fullFormats, o], m = u.formats || r.formatNames;
    return c(d, m, f, g), u.keywords && (0, n.default)(d), d;
  };
  i.get = (d, u = "full") => {
    const g = (u === "fast" ? r.fastFormats : r.fullFormats)[d];
    if (!g)
      throw new Error(`Unknown format "${d}"`);
    return g;
  };
  function c(d, u, f, g) {
    var m, v;
    (m = (v = d.opts.code).formats) !== null && m !== void 0 || (v.formats = (0, s._)`require("ajv-formats/dist/formats").${g}`);
    for (const $ of u)
      d.addFormat($, f[$]);
  }
  e.exports = t = i, Object.defineProperty(t, "__esModule", { value: !0 }), t.default = i;
})(go, go.exports);
var iE = go.exports;
const cE = /* @__PURE__ */ hl(iE), lE = (e, t, r, n) => {
  if (r === "length" || r === "prototype" || r === "arguments" || r === "caller")
    return;
  const s = Object.getOwnPropertyDescriptor(e, r), o = Object.getOwnPropertyDescriptor(t, r);
  !uE(s, o) && n || Object.defineProperty(e, r, o);
}, uE = function(e, t) {
  return e === void 0 || e.configurable || e.writable === t.writable && e.enumerable === t.enumerable && e.configurable === t.configurable && (e.writable || e.value === t.value);
}, dE = (e, t) => {
  const r = Object.getPrototypeOf(t);
  r !== Object.getPrototypeOf(e) && Object.setPrototypeOf(e, r);
}, fE = (e, t) => `/* Wrapped ${e}*/
${t}`, hE = Object.getOwnPropertyDescriptor(Function.prototype, "toString"), pE = Object.getOwnPropertyDescriptor(Function.prototype.toString, "name"), mE = (e, t, r) => {
  const n = r === "" ? "" : `with ${r.trim()}() `, s = fE.bind(null, n, t.toString());
  Object.defineProperty(s, "name", pE);
  const { writable: o, enumerable: a, configurable: i } = hE;
  Object.defineProperty(e, "toString", { value: s, writable: o, enumerable: a, configurable: i });
};
function yE(e, t, { ignoreNonConfigurable: r = !1 } = {}) {
  const { name: n } = e;
  for (const s of Reflect.ownKeys(t))
    lE(e, t, s, r);
  return dE(e, t), mE(e, t, n), e;
}
const kc = (e, t = {}) => {
  if (typeof e != "function")
    throw new TypeError(`Expected the first argument to be a function, got \`${typeof e}\``);
  const {
    wait: r = 0,
    maxWait: n = Number.POSITIVE_INFINITY,
    before: s = !1,
    after: o = !0
  } = t;
  if (r < 0 || n < 0)
    throw new RangeError("`wait` and `maxWait` must not be negative.");
  if (!s && !o)
    throw new Error("Both `before` and `after` are false, function wouldn't be called.");
  let a, i, c;
  const d = function(...u) {
    const f = this, g = () => {
      a = void 0, i && (clearTimeout(i), i = void 0), o && (c = e.apply(f, u));
    }, m = () => {
      i = void 0, a && (clearTimeout(a), a = void 0), o && (c = e.apply(f, u));
    }, v = s && !a;
    return clearTimeout(a), a = setTimeout(g, r), n > 0 && n !== Number.POSITIVE_INFINITY && !i && (i = setTimeout(m, n)), v && (c = e.apply(f, u)), c;
  };
  return yE(d, e), d.cancel = () => {
    a && (clearTimeout(a), a = void 0), i && (clearTimeout(i), i = void 0);
  }, d;
};
var Ro = { exports: {} };
const $E = "2.0.0", zu = 256, gE = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
9007199254740991, _E = 16, vE = zu - 6, EE = [
  "major",
  "premajor",
  "minor",
  "preminor",
  "patch",
  "prepatch",
  "prerelease"
];
var Ts = {
  MAX_LENGTH: zu,
  MAX_SAFE_COMPONENT_LENGTH: _E,
  MAX_SAFE_BUILD_LENGTH: vE,
  MAX_SAFE_INTEGER: gE,
  RELEASE_TYPES: EE,
  SEMVER_SPEC_VERSION: $E,
  FLAG_INCLUDE_PRERELEASE: 1,
  FLAG_LOOSE: 2
};
const wE = typeof process == "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...e) => console.error("SEMVER", ...e) : () => {
};
var Os = wE;
(function(e, t) {
  const {
    MAX_SAFE_COMPONENT_LENGTH: r,
    MAX_SAFE_BUILD_LENGTH: n,
    MAX_LENGTH: s
  } = Ts, o = Os;
  t = e.exports = {};
  const a = t.re = [], i = t.safeRe = [], c = t.src = [], d = t.safeSrc = [], u = t.t = {};
  let f = 0;
  const g = "[a-zA-Z0-9-]", m = [
    ["\\s", 1],
    ["\\d", s],
    [g, n]
  ], v = (_) => {
    for (const [p, w] of m)
      _ = _.split(`${p}*`).join(`${p}{0,${w}}`).split(`${p}+`).join(`${p}{1,${w}}`);
    return _;
  }, $ = (_, p, w) => {
    const P = v(p), T = f++;
    o(_, T, p), u[_] = T, c[T] = p, d[T] = P, a[T] = new RegExp(p, w ? "g" : void 0), i[T] = new RegExp(P, w ? "g" : void 0);
  };
  $("NUMERICIDENTIFIER", "0|[1-9]\\d*"), $("NUMERICIDENTIFIERLOOSE", "\\d+"), $("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${g}*`), $("MAINVERSION", `(${c[u.NUMERICIDENTIFIER]})\\.(${c[u.NUMERICIDENTIFIER]})\\.(${c[u.NUMERICIDENTIFIER]})`), $("MAINVERSIONLOOSE", `(${c[u.NUMERICIDENTIFIERLOOSE]})\\.(${c[u.NUMERICIDENTIFIERLOOSE]})\\.(${c[u.NUMERICIDENTIFIERLOOSE]})`), $("PRERELEASEIDENTIFIER", `(?:${c[u.NONNUMERICIDENTIFIER]}|${c[u.NUMERICIDENTIFIER]})`), $("PRERELEASEIDENTIFIERLOOSE", `(?:${c[u.NONNUMERICIDENTIFIER]}|${c[u.NUMERICIDENTIFIERLOOSE]})`), $("PRERELEASE", `(?:-(${c[u.PRERELEASEIDENTIFIER]}(?:\\.${c[u.PRERELEASEIDENTIFIER]})*))`), $("PRERELEASELOOSE", `(?:-?(${c[u.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${c[u.PRERELEASEIDENTIFIERLOOSE]})*))`), $("BUILDIDENTIFIER", `${g}+`), $("BUILD", `(?:\\+(${c[u.BUILDIDENTIFIER]}(?:\\.${c[u.BUILDIDENTIFIER]})*))`), $("FULLPLAIN", `v?${c[u.MAINVERSION]}${c[u.PRERELEASE]}?${c[u.BUILD]}?`), $("FULL", `^${c[u.FULLPLAIN]}$`), $("LOOSEPLAIN", `[v=\\s]*${c[u.MAINVERSIONLOOSE]}${c[u.PRERELEASELOOSE]}?${c[u.BUILD]}?`), $("LOOSE", `^${c[u.LOOSEPLAIN]}$`), $("GTLT", "((?:<|>)?=?)"), $("XRANGEIDENTIFIERLOOSE", `${c[u.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`), $("XRANGEIDENTIFIER", `${c[u.NUMERICIDENTIFIER]}|x|X|\\*`), $("XRANGEPLAIN", `[v=\\s]*(${c[u.XRANGEIDENTIFIER]})(?:\\.(${c[u.XRANGEIDENTIFIER]})(?:\\.(${c[u.XRANGEIDENTIFIER]})(?:${c[u.PRERELEASE]})?${c[u.BUILD]}?)?)?`), $("XRANGEPLAINLOOSE", `[v=\\s]*(${c[u.XRANGEIDENTIFIERLOOSE]})(?:\\.(${c[u.XRANGEIDENTIFIERLOOSE]})(?:\\.(${c[u.XRANGEIDENTIFIERLOOSE]})(?:${c[u.PRERELEASELOOSE]})?${c[u.BUILD]}?)?)?`), $("XRANGE", `^${c[u.GTLT]}\\s*${c[u.XRANGEPLAIN]}$`), $("XRANGELOOSE", `^${c[u.GTLT]}\\s*${c[u.XRANGEPLAINLOOSE]}$`), $("COERCEPLAIN", `(^|[^\\d])(\\d{1,${r}})(?:\\.(\\d{1,${r}}))?(?:\\.(\\d{1,${r}}))?`), $("COERCE", `${c[u.COERCEPLAIN]}(?:$|[^\\d])`), $("COERCEFULL", c[u.COERCEPLAIN] + `(?:${c[u.PRERELEASE]})?(?:${c[u.BUILD]})?(?:$|[^\\d])`), $("COERCERTL", c[u.COERCE], !0), $("COERCERTLFULL", c[u.COERCEFULL], !0), $("LONETILDE", "(?:~>?)"), $("TILDETRIM", `(\\s*)${c[u.LONETILDE]}\\s+`, !0), t.tildeTrimReplace = "$1~", $("TILDE", `^${c[u.LONETILDE]}${c[u.XRANGEPLAIN]}$`), $("TILDELOOSE", `^${c[u.LONETILDE]}${c[u.XRANGEPLAINLOOSE]}$`), $("LONECARET", "(?:\\^)"), $("CARETTRIM", `(\\s*)${c[u.LONECARET]}\\s+`, !0), t.caretTrimReplace = "$1^", $("CARET", `^${c[u.LONECARET]}${c[u.XRANGEPLAIN]}$`), $("CARETLOOSE", `^${c[u.LONECARET]}${c[u.XRANGEPLAINLOOSE]}$`), $("COMPARATORLOOSE", `^${c[u.GTLT]}\\s*(${c[u.LOOSEPLAIN]})$|^$`), $("COMPARATOR", `^${c[u.GTLT]}\\s*(${c[u.FULLPLAIN]})$|^$`), $("COMPARATORTRIM", `(\\s*)${c[u.GTLT]}\\s*(${c[u.LOOSEPLAIN]}|${c[u.XRANGEPLAIN]})`, !0), t.comparatorTrimReplace = "$1$2$3", $("HYPHENRANGE", `^\\s*(${c[u.XRANGEPLAIN]})\\s+-\\s+(${c[u.XRANGEPLAIN]})\\s*$`), $("HYPHENRANGELOOSE", `^\\s*(${c[u.XRANGEPLAINLOOSE]})\\s+-\\s+(${c[u.XRANGEPLAINLOOSE]})\\s*$`), $("STAR", "(<|>)?=?\\s*\\*"), $("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$"), $("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
})(Ro, Ro.exports);
var En = Ro.exports;
const SE = Object.freeze({ loose: !0 }), bE = Object.freeze({}), PE = (e) => e ? typeof e != "object" ? SE : e : bE;
var Ei = PE;
const Dc = /^[0-9]+$/, qu = (e, t) => {
  if (typeof e == "number" && typeof t == "number")
    return e === t ? 0 : e < t ? -1 : 1;
  const r = Dc.test(e), n = Dc.test(t);
  return r && n && (e = +e, t = +t), e === t ? 0 : r && !n ? -1 : n && !r ? 1 : e < t ? -1 : 1;
}, NE = (e, t) => qu(t, e);
var Gu = {
  compareIdentifiers: qu,
  rcompareIdentifiers: NE
};
const Ln = Os, { MAX_LENGTH: Mc, MAX_SAFE_INTEGER: Fn } = Ts, { safeRe: Vn, t: Un } = En, RE = Ei, { compareIdentifiers: Qs } = Gu;
let TE = class vt {
  constructor(t, r) {
    if (r = RE(r), t instanceof vt) {
      if (t.loose === !!r.loose && t.includePrerelease === !!r.includePrerelease)
        return t;
      t = t.version;
    } else if (typeof t != "string")
      throw new TypeError(`Invalid version. Must be a string. Got type "${typeof t}".`);
    if (t.length > Mc)
      throw new TypeError(
        `version is longer than ${Mc} characters`
      );
    Ln("SemVer", t, r), this.options = r, this.loose = !!r.loose, this.includePrerelease = !!r.includePrerelease;
    const n = t.trim().match(r.loose ? Vn[Un.LOOSE] : Vn[Un.FULL]);
    if (!n)
      throw new TypeError(`Invalid Version: ${t}`);
    if (this.raw = t, this.major = +n[1], this.minor = +n[2], this.patch = +n[3], this.major > Fn || this.major < 0)
      throw new TypeError("Invalid major version");
    if (this.minor > Fn || this.minor < 0)
      throw new TypeError("Invalid minor version");
    if (this.patch > Fn || this.patch < 0)
      throw new TypeError("Invalid patch version");
    n[4] ? this.prerelease = n[4].split(".").map((s) => {
      if (/^[0-9]+$/.test(s)) {
        const o = +s;
        if (o >= 0 && o < Fn)
          return o;
      }
      return s;
    }) : this.prerelease = [], this.build = n[5] ? n[5].split(".") : [], this.format();
  }
  format() {
    return this.version = `${this.major}.${this.minor}.${this.patch}`, this.prerelease.length && (this.version += `-${this.prerelease.join(".")}`), this.version;
  }
  toString() {
    return this.version;
  }
  compare(t) {
    if (Ln("SemVer.compare", this.version, this.options, t), !(t instanceof vt)) {
      if (typeof t == "string" && t === this.version)
        return 0;
      t = new vt(t, this.options);
    }
    return t.version === this.version ? 0 : this.compareMain(t) || this.comparePre(t);
  }
  compareMain(t) {
    return t instanceof vt || (t = new vt(t, this.options)), this.major < t.major ? -1 : this.major > t.major ? 1 : this.minor < t.minor ? -1 : this.minor > t.minor ? 1 : this.patch < t.patch ? -1 : this.patch > t.patch ? 1 : 0;
  }
  comparePre(t) {
    if (t instanceof vt || (t = new vt(t, this.options)), this.prerelease.length && !t.prerelease.length)
      return -1;
    if (!this.prerelease.length && t.prerelease.length)
      return 1;
    if (!this.prerelease.length && !t.prerelease.length)
      return 0;
    let r = 0;
    do {
      const n = this.prerelease[r], s = t.prerelease[r];
      if (Ln("prerelease compare", r, n, s), n === void 0 && s === void 0)
        return 0;
      if (s === void 0)
        return 1;
      if (n === void 0)
        return -1;
      if (n === s)
        continue;
      return Qs(n, s);
    } while (++r);
  }
  compareBuild(t) {
    t instanceof vt || (t = new vt(t, this.options));
    let r = 0;
    do {
      const n = this.build[r], s = t.build[r];
      if (Ln("build compare", r, n, s), n === void 0 && s === void 0)
        return 0;
      if (s === void 0)
        return 1;
      if (n === void 0)
        return -1;
      if (n === s)
        continue;
      return Qs(n, s);
    } while (++r);
  }
  // preminor will bump the version up to the next minor release, and immediately
  // down to pre-release. premajor and prepatch work the same way.
  inc(t, r, n) {
    if (t.startsWith("pre")) {
      if (!r && n === !1)
        throw new Error("invalid increment argument: identifier is empty");
      if (r) {
        const s = `-${r}`.match(this.options.loose ? Vn[Un.PRERELEASELOOSE] : Vn[Un.PRERELEASE]);
        if (!s || s[1] !== r)
          throw new Error(`invalid identifier: ${r}`);
      }
    }
    switch (t) {
      case "premajor":
        this.prerelease.length = 0, this.patch = 0, this.minor = 0, this.major++, this.inc("pre", r, n);
        break;
      case "preminor":
        this.prerelease.length = 0, this.patch = 0, this.minor++, this.inc("pre", r, n);
        break;
      case "prepatch":
        this.prerelease.length = 0, this.inc("patch", r, n), this.inc("pre", r, n);
        break;
      case "prerelease":
        this.prerelease.length === 0 && this.inc("patch", r, n), this.inc("pre", r, n);
        break;
      case "release":
        if (this.prerelease.length === 0)
          throw new Error(`version ${this.raw} is not a prerelease`);
        this.prerelease.length = 0;
        break;
      case "major":
        (this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) && this.major++, this.minor = 0, this.patch = 0, this.prerelease = [];
        break;
      case "minor":
        (this.patch !== 0 || this.prerelease.length === 0) && this.minor++, this.patch = 0, this.prerelease = [];
        break;
      case "patch":
        this.prerelease.length === 0 && this.patch++, this.prerelease = [];
        break;
      case "pre": {
        const s = Number(n) ? 1 : 0;
        if (this.prerelease.length === 0)
          this.prerelease = [s];
        else {
          let o = this.prerelease.length;
          for (; --o >= 0; )
            typeof this.prerelease[o] == "number" && (this.prerelease[o]++, o = -2);
          if (o === -1) {
            if (r === this.prerelease.join(".") && n === !1)
              throw new Error("invalid increment argument: identifier already exists");
            this.prerelease.push(s);
          }
        }
        if (r) {
          let o = [r, s];
          n === !1 && (o = [r]), Qs(this.prerelease[0], r) === 0 ? isNaN(this.prerelease[1]) && (this.prerelease = o) : this.prerelease = o;
        }
        break;
      }
      default:
        throw new Error(`invalid increment argument: ${t}`);
    }
    return this.raw = this.format(), this.build.length && (this.raw += `+${this.build.join(".")}`), this;
  }
};
var Je = TE;
const Lc = Je, OE = (e, t, r = !1) => {
  if (e instanceof Lc)
    return e;
  try {
    return new Lc(e, t);
  } catch (n) {
    if (!r)
      return null;
    throw n;
  }
};
var Gr = OE;
const IE = Gr, jE = (e, t) => {
  const r = IE(e, t);
  return r ? r.version : null;
};
var AE = jE;
const CE = Gr, kE = (e, t) => {
  const r = CE(e.trim().replace(/^[=v]+/, ""), t);
  return r ? r.version : null;
};
var DE = kE;
const Fc = Je, ME = (e, t, r, n, s) => {
  typeof r == "string" && (s = n, n = r, r = void 0);
  try {
    return new Fc(
      e instanceof Fc ? e.version : e,
      r
    ).inc(t, n, s).version;
  } catch {
    return null;
  }
};
var LE = ME;
const Vc = Gr, FE = (e, t) => {
  const r = Vc(e, null, !0), n = Vc(t, null, !0), s = r.compare(n);
  if (s === 0)
    return null;
  const o = s > 0, a = o ? r : n, i = o ? n : r, c = !!a.prerelease.length;
  if (!!i.prerelease.length && !c) {
    if (!i.patch && !i.minor)
      return "major";
    if (i.compareMain(a) === 0)
      return i.minor && !i.patch ? "minor" : "patch";
  }
  const u = c ? "pre" : "";
  return r.major !== n.major ? u + "major" : r.minor !== n.minor ? u + "minor" : r.patch !== n.patch ? u + "patch" : "prerelease";
};
var VE = FE;
const UE = Je, zE = (e, t) => new UE(e, t).major;
var qE = zE;
const GE = Je, KE = (e, t) => new GE(e, t).minor;
var HE = KE;
const BE = Je, WE = (e, t) => new BE(e, t).patch;
var JE = WE;
const XE = Gr, YE = (e, t) => {
  const r = XE(e, t);
  return r && r.prerelease.length ? r.prerelease : null;
};
var xE = YE;
const Uc = Je, QE = (e, t, r) => new Uc(e, r).compare(new Uc(t, r));
var yt = QE;
const ZE = yt, ew = (e, t, r) => ZE(t, e, r);
var tw = ew;
const rw = yt, nw = (e, t) => rw(e, t, !0);
var sw = nw;
const zc = Je, ow = (e, t, r) => {
  const n = new zc(e, r), s = new zc(t, r);
  return n.compare(s) || n.compareBuild(s);
};
var wi = ow;
const aw = wi, iw = (e, t) => e.sort((r, n) => aw(r, n, t));
var cw = iw;
const lw = wi, uw = (e, t) => e.sort((r, n) => lw(n, r, t));
var dw = uw;
const fw = yt, hw = (e, t, r) => fw(e, t, r) > 0;
var Is = hw;
const pw = yt, mw = (e, t, r) => pw(e, t, r) < 0;
var Si = mw;
const yw = yt, $w = (e, t, r) => yw(e, t, r) === 0;
var Ku = $w;
const gw = yt, _w = (e, t, r) => gw(e, t, r) !== 0;
var Hu = _w;
const vw = yt, Ew = (e, t, r) => vw(e, t, r) >= 0;
var bi = Ew;
const ww = yt, Sw = (e, t, r) => ww(e, t, r) <= 0;
var Pi = Sw;
const bw = Ku, Pw = Hu, Nw = Is, Rw = bi, Tw = Si, Ow = Pi, Iw = (e, t, r, n) => {
  switch (t) {
    case "===":
      return typeof e == "object" && (e = e.version), typeof r == "object" && (r = r.version), e === r;
    case "!==":
      return typeof e == "object" && (e = e.version), typeof r == "object" && (r = r.version), e !== r;
    case "":
    case "=":
    case "==":
      return bw(e, r, n);
    case "!=":
      return Pw(e, r, n);
    case ">":
      return Nw(e, r, n);
    case ">=":
      return Rw(e, r, n);
    case "<":
      return Tw(e, r, n);
    case "<=":
      return Ow(e, r, n);
    default:
      throw new TypeError(`Invalid operator: ${t}`);
  }
};
var Bu = Iw;
const jw = Je, Aw = Gr, { safeRe: zn, t: qn } = En, Cw = (e, t) => {
  if (e instanceof jw)
    return e;
  if (typeof e == "number" && (e = String(e)), typeof e != "string")
    return null;
  t = t || {};
  let r = null;
  if (!t.rtl)
    r = e.match(t.includePrerelease ? zn[qn.COERCEFULL] : zn[qn.COERCE]);
  else {
    const c = t.includePrerelease ? zn[qn.COERCERTLFULL] : zn[qn.COERCERTL];
    let d;
    for (; (d = c.exec(e)) && (!r || r.index + r[0].length !== e.length); )
      (!r || d.index + d[0].length !== r.index + r[0].length) && (r = d), c.lastIndex = d.index + d[1].length + d[2].length;
    c.lastIndex = -1;
  }
  if (r === null)
    return null;
  const n = r[2], s = r[3] || "0", o = r[4] || "0", a = t.includePrerelease && r[5] ? `-${r[5]}` : "", i = t.includePrerelease && r[6] ? `+${r[6]}` : "";
  return Aw(`${n}.${s}.${o}${a}${i}`, t);
};
var kw = Cw;
class Dw {
  constructor() {
    this.max = 1e3, this.map = /* @__PURE__ */ new Map();
  }
  get(t) {
    const r = this.map.get(t);
    if (r !== void 0)
      return this.map.delete(t), this.map.set(t, r), r;
  }
  delete(t) {
    return this.map.delete(t);
  }
  set(t, r) {
    if (!this.delete(t) && r !== void 0) {
      if (this.map.size >= this.max) {
        const s = this.map.keys().next().value;
        this.delete(s);
      }
      this.map.set(t, r);
    }
    return this;
  }
}
var Mw = Dw, Zs, qc;
function $t() {
  if (qc) return Zs;
  qc = 1;
  const e = /\s+/g;
  class t {
    constructor(C, q) {
      if (q = s(q), C instanceof t)
        return C.loose === !!q.loose && C.includePrerelease === !!q.includePrerelease ? C : new t(C.raw, q);
      if (C instanceof o)
        return this.raw = C.value, this.set = [[C]], this.formatted = void 0, this;
      if (this.options = q, this.loose = !!q.loose, this.includePrerelease = !!q.includePrerelease, this.raw = C.trim().replace(e, " "), this.set = this.raw.split("||").map((U) => this.parseRange(U.trim())).filter((U) => U.length), !this.set.length)
        throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
      if (this.set.length > 1) {
        const U = this.set[0];
        if (this.set = this.set.filter((W) => !$(W[0])), this.set.length === 0)
          this.set = [U];
        else if (this.set.length > 1) {
          for (const W of this.set)
            if (W.length === 1 && _(W[0])) {
              this.set = [W];
              break;
            }
        }
      }
      this.formatted = void 0;
    }
    get range() {
      if (this.formatted === void 0) {
        this.formatted = "";
        for (let C = 0; C < this.set.length; C++) {
          C > 0 && (this.formatted += "||");
          const q = this.set[C];
          for (let U = 0; U < q.length; U++)
            U > 0 && (this.formatted += " "), this.formatted += q[U].toString().trim();
        }
      }
      return this.formatted;
    }
    format() {
      return this.range;
    }
    toString() {
      return this.range;
    }
    parseRange(C) {
      const U = ((this.options.includePrerelease && m) | (this.options.loose && v)) + ":" + C, W = n.get(U);
      if (W)
        return W;
      const z = this.options.loose, N = z ? c[d.HYPHENRANGELOOSE] : c[d.HYPHENRANGE];
      C = C.replace(N, G(this.options.includePrerelease)), a("hyphen replace", C), C = C.replace(c[d.COMPARATORTRIM], u), a("comparator trim", C), C = C.replace(c[d.TILDETRIM], f), a("tilde trim", C), C = C.replace(c[d.CARETTRIM], g), a("caret trim", C);
      let y = C.split(" ").map((h) => w(h, this.options)).join(" ").split(/\s+/).map((h) => V(h, this.options));
      z && (y = y.filter((h) => (a("loose invalid filter", h, this.options), !!h.match(c[d.COMPARATORLOOSE])))), a("range list", y);
      const S = /* @__PURE__ */ new Map(), E = y.map((h) => new o(h, this.options));
      for (const h of E) {
        if ($(h))
          return [h];
        S.set(h.value, h);
      }
      S.size > 1 && S.has("") && S.delete("");
      const l = [...S.values()];
      return n.set(U, l), l;
    }
    intersects(C, q) {
      if (!(C instanceof t))
        throw new TypeError("a Range is required");
      return this.set.some((U) => p(U, q) && C.set.some((W) => p(W, q) && U.every((z) => W.every((N) => z.intersects(N, q)))));
    }
    // if ANY of the sets match ALL of its comparators, then pass
    test(C) {
      if (!C)
        return !1;
      if (typeof C == "string")
        try {
          C = new i(C, this.options);
        } catch {
          return !1;
        }
      for (let q = 0; q < this.set.length; q++)
        if (te(this.set[q], C, this.options))
          return !0;
      return !1;
    }
  }
  Zs = t;
  const r = Mw, n = new r(), s = Ei, o = js(), a = Os, i = Je, {
    safeRe: c,
    t: d,
    comparatorTrimReplace: u,
    tildeTrimReplace: f,
    caretTrimReplace: g
  } = En, { FLAG_INCLUDE_PRERELEASE: m, FLAG_LOOSE: v } = Ts, $ = (j) => j.value === "<0.0.0-0", _ = (j) => j.value === "", p = (j, C) => {
    let q = !0;
    const U = j.slice();
    let W = U.pop();
    for (; q && U.length; )
      q = U.every((z) => W.intersects(z, C)), W = U.pop();
    return q;
  }, w = (j, C) => (j = j.replace(c[d.BUILD], ""), a("comp", j, C), j = L(j, C), a("caret", j), j = T(j, C), a("tildes", j), j = ee(j, C), a("xrange", j), j = pe(j, C), a("stars", j), j), P = (j) => !j || j.toLowerCase() === "x" || j === "*", T = (j, C) => j.trim().split(/\s+/).map((q) => I(q, C)).join(" "), I = (j, C) => {
    const q = C.loose ? c[d.TILDELOOSE] : c[d.TILDE];
    return j.replace(q, (U, W, z, N, y) => {
      a("tilde", j, U, W, z, N, y);
      let S;
      return P(W) ? S = "" : P(z) ? S = `>=${W}.0.0 <${+W + 1}.0.0-0` : P(N) ? S = `>=${W}.${z}.0 <${W}.${+z + 1}.0-0` : y ? (a("replaceTilde pr", y), S = `>=${W}.${z}.${N}-${y} <${W}.${+z + 1}.0-0`) : S = `>=${W}.${z}.${N} <${W}.${+z + 1}.0-0`, a("tilde return", S), S;
    });
  }, L = (j, C) => j.trim().split(/\s+/).map((q) => M(q, C)).join(" "), M = (j, C) => {
    a("caret", j, C);
    const q = C.loose ? c[d.CARETLOOSE] : c[d.CARET], U = C.includePrerelease ? "-0" : "";
    return j.replace(q, (W, z, N, y, S) => {
      a("caret", j, W, z, N, y, S);
      let E;
      return P(z) ? E = "" : P(N) ? E = `>=${z}.0.0${U} <${+z + 1}.0.0-0` : P(y) ? z === "0" ? E = `>=${z}.${N}.0${U} <${z}.${+N + 1}.0-0` : E = `>=${z}.${N}.0${U} <${+z + 1}.0.0-0` : S ? (a("replaceCaret pr", S), z === "0" ? N === "0" ? E = `>=${z}.${N}.${y}-${S} <${z}.${N}.${+y + 1}-0` : E = `>=${z}.${N}.${y}-${S} <${z}.${+N + 1}.0-0` : E = `>=${z}.${N}.${y}-${S} <${+z + 1}.0.0-0`) : (a("no pr"), z === "0" ? N === "0" ? E = `>=${z}.${N}.${y}${U} <${z}.${N}.${+y + 1}-0` : E = `>=${z}.${N}.${y}${U} <${z}.${+N + 1}.0-0` : E = `>=${z}.${N}.${y} <${+z + 1}.0.0-0`), a("caret return", E), E;
    });
  }, ee = (j, C) => (a("replaceXRanges", j, C), j.split(/\s+/).map((q) => he(q, C)).join(" ")), he = (j, C) => {
    j = j.trim();
    const q = C.loose ? c[d.XRANGELOOSE] : c[d.XRANGE];
    return j.replace(q, (U, W, z, N, y, S) => {
      a("xRange", j, U, W, z, N, y, S);
      const E = P(z), l = E || P(N), h = l || P(y), b = h;
      return W === "=" && b && (W = ""), S = C.includePrerelease ? "-0" : "", E ? W === ">" || W === "<" ? U = "<0.0.0-0" : U = "*" : W && b ? (l && (N = 0), y = 0, W === ">" ? (W = ">=", l ? (z = +z + 1, N = 0, y = 0) : (N = +N + 1, y = 0)) : W === "<=" && (W = "<", l ? z = +z + 1 : N = +N + 1), W === "<" && (S = "-0"), U = `${W + z}.${N}.${y}${S}`) : l ? U = `>=${z}.0.0${S} <${+z + 1}.0.0-0` : h && (U = `>=${z}.${N}.0${S} <${z}.${+N + 1}.0-0`), a("xRange return", U), U;
    });
  }, pe = (j, C) => (a("replaceStars", j, C), j.trim().replace(c[d.STAR], "")), V = (j, C) => (a("replaceGTE0", j, C), j.trim().replace(c[C.includePrerelease ? d.GTE0PRE : d.GTE0], "")), G = (j) => (C, q, U, W, z, N, y, S, E, l, h, b) => (P(U) ? q = "" : P(W) ? q = `>=${U}.0.0${j ? "-0" : ""}` : P(z) ? q = `>=${U}.${W}.0${j ? "-0" : ""}` : N ? q = `>=${q}` : q = `>=${q}${j ? "-0" : ""}`, P(E) ? S = "" : P(l) ? S = `<${+E + 1}.0.0-0` : P(h) ? S = `<${E}.${+l + 1}.0-0` : b ? S = `<=${E}.${l}.${h}-${b}` : j ? S = `<${E}.${l}.${+h + 1}-0` : S = `<=${S}`, `${q} ${S}`.trim()), te = (j, C, q) => {
    for (let U = 0; U < j.length; U++)
      if (!j[U].test(C))
        return !1;
    if (C.prerelease.length && !q.includePrerelease) {
      for (let U = 0; U < j.length; U++)
        if (a(j[U].semver), j[U].semver !== o.ANY && j[U].semver.prerelease.length > 0) {
          const W = j[U].semver;
          if (W.major === C.major && W.minor === C.minor && W.patch === C.patch)
            return !0;
        }
      return !1;
    }
    return !0;
  };
  return Zs;
}
var eo, Gc;
function js() {
  if (Gc) return eo;
  Gc = 1;
  const e = Symbol("SemVer ANY");
  class t {
    static get ANY() {
      return e;
    }
    constructor(u, f) {
      if (f = r(f), u instanceof t) {
        if (u.loose === !!f.loose)
          return u;
        u = u.value;
      }
      u = u.trim().split(/\s+/).join(" "), a("comparator", u, f), this.options = f, this.loose = !!f.loose, this.parse(u), this.semver === e ? this.value = "" : this.value = this.operator + this.semver.version, a("comp", this);
    }
    parse(u) {
      const f = this.options.loose ? n[s.COMPARATORLOOSE] : n[s.COMPARATOR], g = u.match(f);
      if (!g)
        throw new TypeError(`Invalid comparator: ${u}`);
      this.operator = g[1] !== void 0 ? g[1] : "", this.operator === "=" && (this.operator = ""), g[2] ? this.semver = new i(g[2], this.options.loose) : this.semver = e;
    }
    toString() {
      return this.value;
    }
    test(u) {
      if (a("Comparator.test", u, this.options.loose), this.semver === e || u === e)
        return !0;
      if (typeof u == "string")
        try {
          u = new i(u, this.options);
        } catch {
          return !1;
        }
      return o(u, this.operator, this.semver, this.options);
    }
    intersects(u, f) {
      if (!(u instanceof t))
        throw new TypeError("a Comparator is required");
      return this.operator === "" ? this.value === "" ? !0 : new c(u.value, f).test(this.value) : u.operator === "" ? u.value === "" ? !0 : new c(this.value, f).test(u.semver) : (f = r(f), f.includePrerelease && (this.value === "<0.0.0-0" || u.value === "<0.0.0-0") || !f.includePrerelease && (this.value.startsWith("<0.0.0") || u.value.startsWith("<0.0.0")) ? !1 : !!(this.operator.startsWith(">") && u.operator.startsWith(">") || this.operator.startsWith("<") && u.operator.startsWith("<") || this.semver.version === u.semver.version && this.operator.includes("=") && u.operator.includes("=") || o(this.semver, "<", u.semver, f) && this.operator.startsWith(">") && u.operator.startsWith("<") || o(this.semver, ">", u.semver, f) && this.operator.startsWith("<") && u.operator.startsWith(">")));
    }
  }
  eo = t;
  const r = Ei, { safeRe: n, t: s } = En, o = Bu, a = Os, i = Je, c = $t();
  return eo;
}
const Lw = $t(), Fw = (e, t, r) => {
  try {
    t = new Lw(t, r);
  } catch {
    return !1;
  }
  return t.test(e);
};
var As = Fw;
const Vw = $t(), Uw = (e, t) => new Vw(e, t).set.map((r) => r.map((n) => n.value).join(" ").trim().split(" "));
var zw = Uw;
const qw = Je, Gw = $t(), Kw = (e, t, r) => {
  let n = null, s = null, o = null;
  try {
    o = new Gw(t, r);
  } catch {
    return null;
  }
  return e.forEach((a) => {
    o.test(a) && (!n || s.compare(a) === -1) && (n = a, s = new qw(n, r));
  }), n;
};
var Hw = Kw;
const Bw = Je, Ww = $t(), Jw = (e, t, r) => {
  let n = null, s = null, o = null;
  try {
    o = new Ww(t, r);
  } catch {
    return null;
  }
  return e.forEach((a) => {
    o.test(a) && (!n || s.compare(a) === 1) && (n = a, s = new Bw(n, r));
  }), n;
};
var Xw = Jw;
const to = Je, Yw = $t(), Kc = Is, xw = (e, t) => {
  e = new Yw(e, t);
  let r = new to("0.0.0");
  if (e.test(r) || (r = new to("0.0.0-0"), e.test(r)))
    return r;
  r = null;
  for (let n = 0; n < e.set.length; ++n) {
    const s = e.set[n];
    let o = null;
    s.forEach((a) => {
      const i = new to(a.semver.version);
      switch (a.operator) {
        case ">":
          i.prerelease.length === 0 ? i.patch++ : i.prerelease.push(0), i.raw = i.format();
        case "":
        case ">=":
          (!o || Kc(i, o)) && (o = i);
          break;
        case "<":
        case "<=":
          break;
        default:
          throw new Error(`Unexpected operation: ${a.operator}`);
      }
    }), o && (!r || Kc(r, o)) && (r = o);
  }
  return r && e.test(r) ? r : null;
};
var Qw = xw;
const Zw = $t(), eS = (e, t) => {
  try {
    return new Zw(e, t).range || "*";
  } catch {
    return null;
  }
};
var tS = eS;
const rS = Je, Wu = js(), { ANY: nS } = Wu, sS = $t(), oS = As, Hc = Is, Bc = Si, aS = Pi, iS = bi, cS = (e, t, r, n) => {
  e = new rS(e, n), t = new sS(t, n);
  let s, o, a, i, c;
  switch (r) {
    case ">":
      s = Hc, o = aS, a = Bc, i = ">", c = ">=";
      break;
    case "<":
      s = Bc, o = iS, a = Hc, i = "<", c = "<=";
      break;
    default:
      throw new TypeError('Must provide a hilo val of "<" or ">"');
  }
  if (oS(e, t, n))
    return !1;
  for (let d = 0; d < t.set.length; ++d) {
    const u = t.set[d];
    let f = null, g = null;
    if (u.forEach((m) => {
      m.semver === nS && (m = new Wu(">=0.0.0")), f = f || m, g = g || m, s(m.semver, f.semver, n) ? f = m : a(m.semver, g.semver, n) && (g = m);
    }), f.operator === i || f.operator === c || (!g.operator || g.operator === i) && o(e, g.semver))
      return !1;
    if (g.operator === c && a(e, g.semver))
      return !1;
  }
  return !0;
};
var Ni = cS;
const lS = Ni, uS = (e, t, r) => lS(e, t, ">", r);
var dS = uS;
const fS = Ni, hS = (e, t, r) => fS(e, t, "<", r);
var pS = hS;
const Wc = $t(), mS = (e, t, r) => (e = new Wc(e, r), t = new Wc(t, r), e.intersects(t, r));
var yS = mS;
const $S = As, gS = yt;
var _S = (e, t, r) => {
  const n = [];
  let s = null, o = null;
  const a = e.sort((u, f) => gS(u, f, r));
  for (const u of a)
    $S(u, t, r) ? (o = u, s || (s = u)) : (o && n.push([s, o]), o = null, s = null);
  s && n.push([s, null]);
  const i = [];
  for (const [u, f] of n)
    u === f ? i.push(u) : !f && u === a[0] ? i.push("*") : f ? u === a[0] ? i.push(`<=${f}`) : i.push(`${u} - ${f}`) : i.push(`>=${u}`);
  const c = i.join(" || "), d = typeof t.raw == "string" ? t.raw : String(t);
  return c.length < d.length ? c : t;
};
const Jc = $t(), Ri = js(), { ANY: ro } = Ri, Qr = As, Ti = yt, vS = (e, t, r = {}) => {
  if (e === t)
    return !0;
  e = new Jc(e, r), t = new Jc(t, r);
  let n = !1;
  e: for (const s of e.set) {
    for (const o of t.set) {
      const a = wS(s, o, r);
      if (n = n || a !== null, a)
        continue e;
    }
    if (n)
      return !1;
  }
  return !0;
}, ES = [new Ri(">=0.0.0-0")], Xc = [new Ri(">=0.0.0")], wS = (e, t, r) => {
  if (e === t)
    return !0;
  if (e.length === 1 && e[0].semver === ro) {
    if (t.length === 1 && t[0].semver === ro)
      return !0;
    r.includePrerelease ? e = ES : e = Xc;
  }
  if (t.length === 1 && t[0].semver === ro) {
    if (r.includePrerelease)
      return !0;
    t = Xc;
  }
  const n = /* @__PURE__ */ new Set();
  let s, o;
  for (const m of e)
    m.operator === ">" || m.operator === ">=" ? s = Yc(s, m, r) : m.operator === "<" || m.operator === "<=" ? o = xc(o, m, r) : n.add(m.semver);
  if (n.size > 1)
    return null;
  let a;
  if (s && o) {
    if (a = Ti(s.semver, o.semver, r), a > 0)
      return null;
    if (a === 0 && (s.operator !== ">=" || o.operator !== "<="))
      return null;
  }
  for (const m of n) {
    if (s && !Qr(m, String(s), r) || o && !Qr(m, String(o), r))
      return null;
    for (const v of t)
      if (!Qr(m, String(v), r))
        return !1;
    return !0;
  }
  let i, c, d, u, f = o && !r.includePrerelease && o.semver.prerelease.length ? o.semver : !1, g = s && !r.includePrerelease && s.semver.prerelease.length ? s.semver : !1;
  f && f.prerelease.length === 1 && o.operator === "<" && f.prerelease[0] === 0 && (f = !1);
  for (const m of t) {
    if (u = u || m.operator === ">" || m.operator === ">=", d = d || m.operator === "<" || m.operator === "<=", s) {
      if (g && m.semver.prerelease && m.semver.prerelease.length && m.semver.major === g.major && m.semver.minor === g.minor && m.semver.patch === g.patch && (g = !1), m.operator === ">" || m.operator === ">=") {
        if (i = Yc(s, m, r), i === m && i !== s)
          return !1;
      } else if (s.operator === ">=" && !Qr(s.semver, String(m), r))
        return !1;
    }
    if (o) {
      if (f && m.semver.prerelease && m.semver.prerelease.length && m.semver.major === f.major && m.semver.minor === f.minor && m.semver.patch === f.patch && (f = !1), m.operator === "<" || m.operator === "<=") {
        if (c = xc(o, m, r), c === m && c !== o)
          return !1;
      } else if (o.operator === "<=" && !Qr(o.semver, String(m), r))
        return !1;
    }
    if (!m.operator && (o || s) && a !== 0)
      return !1;
  }
  return !(s && d && !o && a !== 0 || o && u && !s && a !== 0 || g || f);
}, Yc = (e, t, r) => {
  if (!e)
    return t;
  const n = Ti(e.semver, t.semver, r);
  return n > 0 ? e : n < 0 || t.operator === ">" && e.operator === ">=" ? t : e;
}, xc = (e, t, r) => {
  if (!e)
    return t;
  const n = Ti(e.semver, t.semver, r);
  return n < 0 ? e : n > 0 || t.operator === "<" && e.operator === "<=" ? t : e;
};
var SS = vS;
const no = En, Qc = Ts, bS = Je, Zc = Gu, PS = Gr, NS = AE, RS = DE, TS = LE, OS = VE, IS = qE, jS = HE, AS = JE, CS = xE, kS = yt, DS = tw, MS = sw, LS = wi, FS = cw, VS = dw, US = Is, zS = Si, qS = Ku, GS = Hu, KS = bi, HS = Pi, BS = Bu, WS = kw, JS = js(), XS = $t(), YS = As, xS = zw, QS = Hw, ZS = Xw, eb = Qw, tb = tS, rb = Ni, nb = dS, sb = pS, ob = yS, ab = _S, ib = SS;
var cb = {
  parse: PS,
  valid: NS,
  clean: RS,
  inc: TS,
  diff: OS,
  major: IS,
  minor: jS,
  patch: AS,
  prerelease: CS,
  compare: kS,
  rcompare: DS,
  compareLoose: MS,
  compareBuild: LS,
  sort: FS,
  rsort: VS,
  gt: US,
  lt: zS,
  eq: qS,
  neq: GS,
  gte: KS,
  lte: HS,
  cmp: BS,
  coerce: WS,
  Comparator: JS,
  Range: XS,
  satisfies: YS,
  toComparators: xS,
  maxSatisfying: QS,
  minSatisfying: ZS,
  minVersion: eb,
  validRange: tb,
  outside: rb,
  gtr: nb,
  ltr: sb,
  intersects: ob,
  simplifyRange: ab,
  subset: ib,
  SemVer: bS,
  re: no.re,
  src: no.src,
  tokens: no.t,
  SEMVER_SPEC_VERSION: Qc.SEMVER_SPEC_VERSION,
  RELEASE_TYPES: Qc.RELEASE_TYPES,
  compareIdentifiers: Zc.compareIdentifiers,
  rcompareIdentifiers: Zc.rcompareIdentifiers
};
const wr = /* @__PURE__ */ hl(cb), lb = Object.prototype.toString, ub = "[object Uint8Array]", db = "[object ArrayBuffer]";
function Ju(e, t, r) {
  return e ? e.constructor === t ? !0 : lb.call(e) === r : !1;
}
function Xu(e) {
  return Ju(e, Uint8Array, ub);
}
function fb(e) {
  return Ju(e, ArrayBuffer, db);
}
function hb(e) {
  return Xu(e) || fb(e);
}
function pb(e) {
  if (!Xu(e))
    throw new TypeError(`Expected \`Uint8Array\`, got \`${typeof e}\``);
}
function mb(e) {
  if (!hb(e))
    throw new TypeError(`Expected \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof e}\``);
}
function so(e, t) {
  if (e.length === 0)
    return new Uint8Array(0);
  t ?? (t = e.reduce((s, o) => s + o.length, 0));
  const r = new Uint8Array(t);
  let n = 0;
  for (const s of e)
    pb(s), r.set(s, n), n += s.length;
  return r;
}
const Gn = {
  utf8: new globalThis.TextDecoder("utf8")
};
function Kn(e, t = "utf8") {
  return mb(e), Gn[t] ?? (Gn[t] = new globalThis.TextDecoder(t)), Gn[t].decode(e);
}
function yb(e) {
  if (typeof e != "string")
    throw new TypeError(`Expected \`string\`, got \`${typeof e}\``);
}
const $b = new globalThis.TextEncoder();
function Hn(e) {
  return yb(e), $b.encode(e);
}
Array.from({ length: 256 }, (e, t) => t.toString(16).padStart(2, "0"));
const oo = "aes-256-cbc", Gt = () => /* @__PURE__ */ Object.create(null), el = (e) => e !== void 0, ao = (e, t) => {
  const r = /* @__PURE__ */ new Set([
    "undefined",
    "symbol",
    "function"
  ]), n = typeof t;
  if (r.has(n))
    throw new TypeError(`Setting a value of type \`${n}\` for key \`${e}\` is not allowed as it's not supported by JSON`);
}, Bt = "__internal__", io = `${Bt}.migrations.version`;
var Jt, dt, Xe, rt, hr, pr, Ar, Et, je, Yu, xu, Qu, Zu, ed, td, rd, nd;
class gb {
  constructor(t = {}) {
    _t(this, je);
    Br(this, "path");
    Br(this, "events");
    _t(this, Jt);
    _t(this, dt);
    _t(this, Xe);
    _t(this, rt, {});
    _t(this, hr, !1);
    _t(this, pr);
    _t(this, Ar);
    _t(this, Et);
    Br(this, "_deserialize", (t) => JSON.parse(t));
    Br(this, "_serialize", (t) => JSON.stringify(t, void 0, "	"));
    const r = Rt(this, je, Yu).call(this, t);
    Ze(this, Xe, r), Rt(this, je, xu).call(this, r), Rt(this, je, Zu).call(this, r), Rt(this, je, ed).call(this, r), this.events = new EventTarget(), Ze(this, dt, r.encryptionKey), this.path = Rt(this, je, td).call(this, r), Rt(this, je, rd).call(this, r), r.watch && this._watch();
  }
  get(t, r) {
    if (oe(this, Xe).accessPropertiesByDotNotation)
      return this._get(t, r);
    const { store: n } = this;
    return t in n ? n[t] : r;
  }
  set(t, r) {
    if (typeof t != "string" && typeof t != "object")
      throw new TypeError(`Expected \`key\` to be of type \`string\` or \`object\`, got ${typeof t}`);
    if (typeof t != "object" && r === void 0)
      throw new TypeError("Use `delete()` to clear values");
    if (this._containsReservedKey(t))
      throw new TypeError(`Please don't use the ${Bt} key, as it's used to manage this module internal operations.`);
    const { store: n } = this, s = (o, a) => {
      if (ao(o, a), oe(this, Xe).accessPropertiesByDotNotation)
        Sn(n, o, a);
      else {
        if (o === "__proto__" || o === "constructor" || o === "prototype")
          return;
        n[o] = a;
      }
    };
    if (typeof t == "object") {
      const o = t;
      for (const [a, i] of Object.entries(o))
        s(a, i);
    } else
      s(t, r);
    this.store = n;
  }
  has(t) {
    return oe(this, Xe).accessPropertiesByDotNotation ? zs(this.store, t) : t in this.store;
  }
  appendToArray(t, r) {
    ao(t, r);
    const n = oe(this, Xe).accessPropertiesByDotNotation ? this._get(t, []) : t in this.store ? this.store[t] : [];
    if (!Array.isArray(n))
      throw new TypeError(`The key \`${t}\` is already set to a non-array value`);
    this.set(t, [...n, r]);
  }
  /**
      Reset items to their default values, as defined by the `defaults` or `schema` option.
  
      @see `clear()` to reset all items.
  
      @param keys - The keys of the items to reset.
      */
  reset(...t) {
    for (const r of t)
      el(oe(this, rt)[r]) && this.set(r, oe(this, rt)[r]);
  }
  delete(t) {
    const { store: r } = this;
    oe(this, Xe).accessPropertiesByDotNotation ? Od(r, t) : delete r[t], this.store = r;
  }
  /**
      Delete all items.
  
      This resets known items to their default values, if defined by the `defaults` or `schema` option.
      */
  clear() {
    const t = Gt();
    for (const r of Object.keys(oe(this, rt)))
      el(oe(this, rt)[r]) && (ao(r, oe(this, rt)[r]), oe(this, Xe).accessPropertiesByDotNotation ? Sn(t, r, oe(this, rt)[r]) : t[r] = oe(this, rt)[r]);
    this.store = t;
  }
  onDidChange(t, r) {
    if (typeof t != "string")
      throw new TypeError(`Expected \`key\` to be of type \`string\`, got ${typeof t}`);
    if (typeof r != "function")
      throw new TypeError(`Expected \`callback\` to be of type \`function\`, got ${typeof r}`);
    return this._handleValueChange(() => this.get(t), r);
  }
  /**
      Watches the whole config object, calling `callback` on any changes.
  
      @param callback - A callback function that is called on any changes. When a `key` is first set `oldValue` will be `undefined`, and when a key is deleted `newValue` will be `undefined`.
      @returns A function, that when called, will unsubscribe.
      */
  onDidAnyChange(t) {
    if (typeof t != "function")
      throw new TypeError(`Expected \`callback\` to be of type \`function\`, got ${typeof t}`);
    return this._handleStoreChange(t);
  }
  get size() {
    return Object.keys(this.store).filter((r) => !this._isReservedKeyPath(r)).length;
  }
  /**
      Get all the config as an object or replace the current config with an object.
  
      @example
      ```
      console.log(config.store);
      //=> {name: 'John', age: 30}
      ```
  
      @example
      ```
      config.store = {
          hello: 'world'
      };
      ```
      */
  get store() {
    var t;
    try {
      const r = re.readFileSync(this.path, oe(this, dt) ? null : "utf8"), n = this._decryptData(r), s = this._deserialize(n);
      return oe(this, hr) || this._validate(s), Object.assign(Gt(), s);
    } catch (r) {
      if ((r == null ? void 0 : r.code) === "ENOENT")
        return this._ensureDirectory(), Gt();
      if (oe(this, Xe).clearInvalidConfig) {
        const n = r;
        if (n.name === "SyntaxError" || (t = n.message) != null && t.startsWith("Config schema violation:"))
          return Gt();
      }
      throw r;
    }
  }
  set store(t) {
    if (this._ensureDirectory(), !zs(t, Bt))
      try {
        const r = re.readFileSync(this.path, oe(this, dt) ? null : "utf8"), n = this._decryptData(r), s = this._deserialize(n);
        zs(s, Bt) && Sn(t, Bt, Ai(s, Bt));
      } catch {
      }
    oe(this, hr) || this._validate(t), this._write(t), this.events.dispatchEvent(new Event("change"));
  }
  *[Symbol.iterator]() {
    for (const [t, r] of Object.entries(this.store))
      this._isReservedKeyPath(t) || (yield [t, r]);
  }
  /**
  Close the file watcher if one exists. This is useful in tests to prevent the process from hanging.
  */
  _closeWatcher() {
    oe(this, pr) && (oe(this, pr).close(), Ze(this, pr, void 0)), oe(this, Ar) && (re.unwatchFile(this.path), Ze(this, Ar, !1)), Ze(this, Et, void 0);
  }
  _decryptData(t) {
    if (!oe(this, dt))
      return typeof t == "string" ? t : Kn(t);
    try {
      const r = t.slice(0, 16), n = rr.pbkdf2Sync(oe(this, dt), r, 1e4, 32, "sha512"), s = rr.createDecipheriv(oo, n, r), o = t.slice(17), a = typeof o == "string" ? Hn(o) : o;
      return Kn(so([s.update(a), s.final()]));
    } catch {
      try {
        const r = t.slice(0, 16), n = rr.pbkdf2Sync(oe(this, dt), r.toString(), 1e4, 32, "sha512"), s = rr.createDecipheriv(oo, n, r), o = t.slice(17), a = typeof o == "string" ? Hn(o) : o;
        return Kn(so([s.update(a), s.final()]));
      } catch {
      }
    }
    return typeof t == "string" ? t : Kn(t);
  }
  _handleStoreChange(t) {
    let r = this.store;
    const n = () => {
      const s = r, o = this.store;
      Ii(o, s) || (r = o, t.call(this, o, s));
    };
    return this.events.addEventListener("change", n), () => {
      this.events.removeEventListener("change", n);
    };
  }
  _handleValueChange(t, r) {
    let n = t();
    const s = () => {
      const o = n, a = t();
      Ii(a, o) || (n = a, r.call(this, a, o));
    };
    return this.events.addEventListener("change", s), () => {
      this.events.removeEventListener("change", s);
    };
  }
  _validate(t) {
    if (!oe(this, Jt) || oe(this, Jt).call(this, t) || !oe(this, Jt).errors)
      return;
    const n = oe(this, Jt).errors.map(({ instancePath: s, message: o = "" }) => `\`${s.slice(1)}\` ${o}`);
    throw new Error("Config schema violation: " + n.join("; "));
  }
  _ensureDirectory() {
    re.mkdirSync(B.dirname(this.path), { recursive: !0 });
  }
  _write(t) {
    let r = this._serialize(t);
    if (oe(this, dt)) {
      const n = rr.randomBytes(16), s = rr.pbkdf2Sync(oe(this, dt), n, 1e4, 32, "sha512"), o = rr.createCipheriv(oo, s, n);
      r = so([n, Hn(":"), o.update(Hn(r)), o.final()]);
    }
    if (_e.env.SNAP)
      re.writeFileSync(this.path, r, { mode: oe(this, Xe).configFileMode });
    else
      try {
        fl(this.path, r, { mode: oe(this, Xe).configFileMode });
      } catch (n) {
        if ((n == null ? void 0 : n.code) === "EXDEV") {
          re.writeFileSync(this.path, r, { mode: oe(this, Xe).configFileMode });
          return;
        }
        throw n;
      }
  }
  _watch() {
    if (this._ensureDirectory(), re.existsSync(this.path) || this._write(Gt()), _e.platform === "win32" || _e.platform === "darwin") {
      oe(this, Et) ?? Ze(this, Et, kc(() => {
        this.events.dispatchEvent(new Event("change"));
      }, { wait: 100 }));
      const t = B.dirname(this.path), r = B.basename(this.path);
      Ze(this, pr, re.watch(t, { persistent: !1, encoding: "utf8" }, (n, s) => {
        s && s !== r || typeof oe(this, Et) == "function" && oe(this, Et).call(this);
      }));
    } else
      oe(this, Et) ?? Ze(this, Et, kc(() => {
        this.events.dispatchEvent(new Event("change"));
      }, { wait: 1e3 })), re.watchFile(this.path, { persistent: !1 }, (t, r) => {
        typeof oe(this, Et) == "function" && oe(this, Et).call(this);
      }), Ze(this, Ar, !0);
  }
  _migrate(t, r, n) {
    let s = this._get(io, "0.0.0");
    const o = Object.keys(t).filter((i) => this._shouldPerformMigration(i, s, r));
    let a = structuredClone(this.store);
    for (const i of o)
      try {
        n && n(this, {
          fromVersion: s,
          toVersion: i,
          finalVersion: r,
          versions: o
        });
        const c = t[i];
        c == null || c(this), this._set(io, i), s = i, a = structuredClone(this.store);
      } catch (c) {
        this.store = a;
        try {
          this._write(a);
        } catch {
        }
        const d = c instanceof Error ? c.message : String(c);
        throw new Error(`Something went wrong during the migration! Changes applied to the store until this failed migration will be restored. ${d}`);
      }
    (this._isVersionInRangeFormat(s) || !wr.eq(s, r)) && this._set(io, r);
  }
  _containsReservedKey(t) {
    return typeof t == "string" ? this._isReservedKeyPath(t) : !t || typeof t != "object" ? !1 : this._objectContainsReservedKey(t);
  }
  _objectContainsReservedKey(t) {
    if (!t || typeof t != "object")
      return !1;
    for (const [r, n] of Object.entries(t))
      if (this._isReservedKeyPath(r) || this._objectContainsReservedKey(n))
        return !0;
    return !1;
  }
  _isReservedKeyPath(t) {
    return t === Bt || t.startsWith(`${Bt}.`);
  }
  _isVersionInRangeFormat(t) {
    return wr.clean(t) === null;
  }
  _shouldPerformMigration(t, r, n) {
    return this._isVersionInRangeFormat(t) ? r !== "0.0.0" && wr.satisfies(r, t) ? !1 : wr.satisfies(n, t) : !(wr.lte(t, r) || wr.gt(t, n));
  }
  _get(t, r) {
    return Ai(this.store, t, r);
  }
  _set(t, r) {
    const { store: n } = this;
    Sn(n, t, r), this.store = n;
  }
}
Jt = new WeakMap(), dt = new WeakMap(), Xe = new WeakMap(), rt = new WeakMap(), hr = new WeakMap(), pr = new WeakMap(), Ar = new WeakMap(), Et = new WeakMap(), je = new WeakSet(), Yu = function(t) {
  const r = {
    configName: "config",
    fileExtension: "json",
    projectSuffix: "nodejs",
    clearInvalidConfig: !1,
    accessPropertiesByDotNotation: !0,
    configFileMode: 438,
    ...t
  };
  if (!r.cwd) {
    if (!r.projectName)
      throw new Error("Please specify the `projectName` option.");
    r.cwd = Cd(r.projectName, { suffix: r.projectSuffix }).config;
  }
  return typeof r.fileExtension == "string" && (r.fileExtension = r.fileExtension.replace(/^\.+/, "")), r;
}, xu = function(t) {
  if (!(t.schema ?? t.ajvOptions ?? t.rootSchema))
    return;
  if (t.schema && typeof t.schema != "object")
    throw new TypeError("The `schema` option must be an object.");
  const r = cE.default, n = new Dg.Ajv2020({
    allErrors: !0,
    useDefaults: !0,
    ...t.ajvOptions
  });
  r(n);
  const s = {
    ...t.rootSchema,
    type: "object",
    properties: t.schema
  };
  Ze(this, Jt, n.compile(s)), Rt(this, je, Qu).call(this, t.schema);
}, Qu = function(t) {
  const r = Object.entries(t ?? {});
  for (const [n, s] of r) {
    if (!s || typeof s != "object" || !Object.hasOwn(s, "default"))
      continue;
    const { default: o } = s;
    o !== void 0 && (oe(this, rt)[n] = o);
  }
}, Zu = function(t) {
  t.defaults && Object.assign(oe(this, rt), t.defaults);
}, ed = function(t) {
  t.serialize && (this._serialize = t.serialize), t.deserialize && (this._deserialize = t.deserialize);
}, td = function(t) {
  const r = typeof t.fileExtension == "string" ? t.fileExtension : void 0, n = r ? `.${r}` : "";
  return B.resolve(t.cwd, `${t.configName ?? "config"}${n}`);
}, rd = function(t) {
  if (t.migrations) {
    Rt(this, je, nd).call(this, t), this._validate(this.store);
    return;
  }
  const r = this.store, n = Object.assign(Gt(), t.defaults ?? {}, r);
  this._validate(n);
  try {
    ji.deepEqual(r, n);
  } catch {
    this.store = n;
  }
}, nd = function(t) {
  const { migrations: r, projectVersion: n } = t;
  if (r) {
    if (!n)
      throw new Error("Please specify the `projectVersion` option.");
    Ze(this, hr, !0);
    try {
      const s = this.store, o = Object.assign(Gt(), t.defaults ?? {}, s);
      try {
        ji.deepEqual(s, o);
      } catch {
        this._write(o);
      }
      this._migrate(r, n, t.beforeEachMigration);
    } finally {
      Ze(this, hr, !1);
    }
  }
};
const { app: ts, ipcMain: To, shell: _b } = nl;
let tl = !1;
const rl = () => {
  if (!To || !ts)
    throw new Error("Electron Store: You need to call `.initRenderer()` from the main process.");
  const e = {
    defaultCwd: ts.getPath("userData"),
    appVersion: ts.getVersion()
  };
  return tl || (To.on("electron-store-get-data", (t) => {
    t.returnValue = e;
  }), tl = !0), e;
};
class sd extends gb {
  constructor(t) {
    let r, n;
    if (_e.type === "renderer") {
      const s = nl.ipcRenderer.sendSync("electron-store-get-data");
      if (!s)
        throw new Error("Electron Store: You need to call `.initRenderer()` from the main process.");
      ({ defaultCwd: r, appVersion: n } = s);
    } else To && ts && ({ defaultCwd: r, appVersion: n } = rl());
    t = {
      name: "config",
      ...t
    }, t.projectVersion || (t.projectVersion = n), t.cwd ? t.cwd = B.isAbsolute(t.cwd) ? t.cwd : B.join(r, t.cwd) : t.cwd = r, t.configName = t.name, delete t.name, super(t);
  }
  static initRenderer() {
    rl();
  }
  async openInEditor() {
    const t = await _b.openPath(this.path);
    if (t)
      throw new Error(t);
  }
}
const Cs = new sd({
  defaults: {
    libraryPath: B.join(mt.getPath("userData")),
    aiSettings: {
      faceDetectionThreshold: 0.6,
      faceBlurThreshold: 20,
      vlmTemperature: 0.2,
      vlmMaxTokens: 100
    }
  }
});
function Oo() {
  return Cs.get("libraryPath");
}
function vb(e) {
  Cs.set("libraryPath", e);
}
function od() {
  return Cs.get("aiSettings");
}
function Eb(e) {
  Cs.set("aiSettings", e);
}
const fs = new sd(), wb = $d(import.meta.url), ad = B.dirname(wb), St = Oo();
x.info(`[Main] Library Path: ${St}`);
process.env.APP_ROOT = B.join(ad, "..");
const Io = process.env.VITE_DEV_SERVER_URL, Hb = B.join(process.env.APP_ROOT, "dist-electron"), id = B.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = Io ? B.join(process.env.APP_ROOT, "public") : id;
let Pe, Rr = null, Ne = null;
const ve = /* @__PURE__ */ new Map();
function Sb() {
  let e, t;
  if (mt.isPackaged)
    e = B.join(process.resourcesPath, "python-bin", "smart-photo-ai", "smart-photo-ai.exe"), t = [], x.info(`[Main] Starting Bundled Python Backend (Prod): ${e}`);
  else {
    e = B.join(process.env.APP_ROOT, "src", "python", ".venv", "Scripts", "python.exe");
    const r = B.join(process.env.APP_ROOT, "src", "python", "main.py");
    t = [r], x.info(`[Main] Starting Python Backend (Dev): ${e} ${r}`);
  }
  Ne = md(e, t, {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
      LIBRARY_PATH: St,
      LOG_PATH: B.join(mt.getPath("userData"), "logs"),
      PYTORCH_CUDA_ALLOC_CONF: "expandable_segments:True"
    }
  }), Ne.stdout && (setTimeout(() => bb(), 2e3), yd({ input: Ne.stdout }).on("line", async (n) => {
    var s;
    try {
      const o = JSON.parse(n);
      x.info("[Python]", o), Pe && (o.type === "scan_result" || o.type === "tags_result") && Pe.webContents.send("ai:scan-result", o), o.type === "cluster_result" && console.log(`[Main] Received Cluster Result for ${o.photoId}. Clusters: ${(s = o.clusters) == null ? void 0 : s.length}`);
      const a = o.photoId || o.reqId || o.payload && o.payload.reqId;
      if (Pe && (o.type === "download_progress" || o.type === "download_result") && Pe.webContents.send("ai:model-progress", o), a && ve.has(a)) {
        const i = ve.get(a);
        o.error ? i == null || i.reject(o.error) : i == null || i.resolve(o), ve.delete(a);
      }
      if ((o.type === "scan_result" || o.type === "tags_result") && o.error && o.photoId)
        try {
          const { getDB: i } = await Promise.resolve().then(() => ie), d = i().prepare("INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, (SELECT file_path FROM photos WHERE id = ?), ?, ?)"), u = o.type === "scan_result" ? "Face Scan" : "Smart Tags";
          d.run(o.photoId, o.photoId, o.error, u), x.info(`[Main] Logged scan error for ${o.photoId}`);
        } catch (i) {
          x.error("[Main] Failed to log auto-error:", i);
        }
    } catch {
      x.info("[Python Raw]", n);
    }
  })), Ne.stderr && Ne.stderr.on("data", (r) => {
    const n = r.toString();
    n.toLowerCase().includes("error") || n.toLowerCase().includes("exception") ? x.error(`[Python Error]: ${n}`) : x.info(`[Python Log]: ${n}`);
  }), Ne.on("close", (r) => {
    x.info(`[Main] Python process exited with code ${r}`), Ne = null;
  });
}
function Kt(e) {
  Ne && Ne.stdin ? Ne.stdin.write(JSON.stringify(e) + `
`) : x.error("[Main] Python process not running. Queuing or dropping command.", e.type);
}
function bb() {
  if (Ne && Ne.stdin) {
    const t = { type: "update_config", payload: { config: od() } };
    Ne.stdin.write(JSON.stringify(t) + `
`);
  }
}
function Pb() {
  Rr = new jo({
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
  }), Rr.loadFile(B.join(process.env.VITE_PUBLIC, "splash.html")), Rr.on("closed", () => Rr = null);
}
function cd() {
  Pe = new jo({
    icon: B.join(process.env.VITE_PUBLIC, "icon.png"),
    width: 1200,
    height: 800,
    show: !1,
    // Hide initially
    backgroundColor: "#111827",
    // Set dark background
    webPreferences: {
      preload: B.join(ad, "preload.mjs"),
      webSecurity: !1
    }
  }), Pe.once("ready-to-show", () => {
    Pe == null || Pe.show(), Rr && Rr.close();
  }), Pe.webContents.on("did-finish-load", () => {
    Pe == null || Pe.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), Io ? Pe.loadURL(Io) : Pe.loadFile(B.join(id, "index.html"));
}
mt.on("window-all-closed", () => {
  Ne && Ne.kill(), process.platform !== "darwin" && (mt.quit(), Pe = null);
});
mt.on("activate", () => {
  jo.getAllWindows().length === 0 && cd();
});
mt.whenReady().then(async () => {
  try {
    await qe.mkdir(St, { recursive: !0 });
  } catch (t) {
    x.error(`[Main] Failed to create library path: ${St}`, t);
  }
  al(St), Sb(), fd.handle("local-resource", (t) => {
    let r = t.url.replace("local-resource://", "");
    const n = r.indexOf("?");
    n !== -1 && (r = r.substring(0, n));
    const s = decodeURIComponent(r);
    return hd.fetch(gd(s).toString());
  }), Pb(), cd(), Z.handle("app:focusWindow", () => Pe ? (Pe.isMinimized() && Pe.restore(), Pe.focus(), !0) : !1), Z.handle("scan-directory", async (t, r) => await Nd(r, St, (n) => {
    t.sender.send("scan-progress", n);
  })), Z.handle("dialog:openDirectory", async () => {
    const { canceled: t, filePaths: r } = await pd.showOpenDialog({
      properties: ["openDirectory"]
    });
    return t ? null : r[0];
  }), Z.handle("read-file-buffer", async (t, r) => {
    const n = await import("node:fs/promises");
    try {
      return await n.readFile(r);
    } catch (s) {
      throw x.error("Failed to read file:", r, s), s;
    }
  }), Z.handle("ai:getSettings", () => od()), Z.handle("ai:saveSettings", (t, r) => {
    if (Eb(r), Ne && Ne.stdin) {
      const n = { type: "update_config", payload: { config: r } };
      Ne.stdin.write(JSON.stringify(n) + `
`);
    }
    return !0;
  }), Z.handle("ai:downloadModel", async (t, { modelName: r }) => (x.info(`[Main] Requesting model download: ${r}`), new Promise((n, s) => {
    const o = Math.floor(Math.random() * 1e6);
    ve.set(o, {
      resolve: (a) => n(a),
      reject: s
    }), Kt({
      type: "download_model",
      payload: {
        reqId: o,
        modelName: r
      }
    }), setTimeout(() => {
      ve.has(o) && (ve.delete(o), s("Model download timed out"));
    }, 18e5);
  }))), Z.handle("ai:getSystemStatus", async () => new Promise((t, r) => {
    const n = Math.floor(Math.random() * 1e6);
    ve.set(n, {
      resolve: (s) => t(s.status || {}),
      reject: r
    }), Kt({
      type: "get_system_status",
      payload: { reqId: n }
    }), setTimeout(() => {
      ve.has(n) && (ve.delete(n), r("Get system status timed out"));
    }, 1e4);
  })), Z.handle("face:getBlurry", async (t, { personId: r, threshold: n, scope: s }) => {
    const { getDB: o } = await Promise.resolve().then(() => ie), a = o();
    let i = "";
    const c = [];
    r ? (i = `SELECT f.id, f.photo_id, f.blur_score, f.box_json, p.file_path, p.preview_cache_path, p.metadata_json, pp.name as person_name 
               FROM faces f 
               JOIN photos p ON f.photo_id = p.id
               LEFT JOIN people pp ON f.person_id = pp.id
               WHERE f.person_id = ? AND f.blur_score < ?`, c.push(r)) : s === "all" ? i = `SELECT f.id, f.photo_id, f.blur_score, f.box_json, p.file_path, p.preview_cache_path, p.metadata_json, pp.name as person_name
               FROM faces f 
               JOIN photos p ON f.photo_id = p.id
               LEFT JOIN people pp ON f.person_id = pp.id
               WHERE f.blur_score < ?` : i = `SELECT f.id, f.photo_id, f.blur_score, f.box_json, p.file_path, p.preview_cache_path, p.metadata_json 
               FROM faces f 
               JOIN photos p ON f.photo_id = p.id
               WHERE f.person_id IS NULL AND f.blur_score < ?`;
    const d = n || 20;
    return c.push(d), a.prepare(i).all(...c).map((g) => {
      let m = null;
      if (g.metadata_json)
        try {
          const v = JSON.parse(g.metadata_json);
          m = v.ImageWidth || v.SourceImageWidth || v.ExifImageWidth;
        } catch {
        }
      return {
        ...g,
        box: JSON.parse(g.box_json),
        original_width: m
      };
    });
  }), Z.handle("debug:getBlurStats", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ie), r = t();
    try {
      return { success: !0, stats: r.prepare(`
        SELECT 
          COUNT(*) as total,
          COUNT(blur_score) as scored_count,
          MIN(blur_score) as min_score,
          MAX(blur_score) as max_score,
          (SELECT COUNT(*) FROM faces WHERE blur_score IS NULL) as null_count
        FROM faces
      `).get() };
    } catch (n) {
      return { success: !1, error: String(n) };
    }
  }), Z.handle("db:getPhotosMissingBlurScores", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ie), r = t();
    try {
      return { success: !0, photoIds: r.prepare("SELECT DISTINCT photo_id FROM faces WHERE blur_score IS NULL").all().map((o) => o.photo_id) };
    } catch (n) {
      return { success: !1, error: String(n) };
    }
  }), Z.handle("settings:getPreviewStats", async () => {
    try {
      const t = B.join(Oo(), "previews");
      try {
        await qe.access(t);
      } catch {
        return { success: !0, count: 0, size: 0 };
      }
      let r = 0, n = 0;
      const s = await qe.readdir(t);
      for (const o of s)
        if (!o.startsWith("."))
          try {
            const a = await qe.stat(B.join(t, o));
            a.isFile() && (r++, n += a.size);
          } catch {
          }
      return { success: !0, count: r, size: n };
    } catch (t) {
      return { success: !1, error: String(t) };
    }
  }), Z.handle("settings:cleanupPreviews", async (t, { days: r }) => {
    try {
      const n = B.join(Oo(), "previews");
      try {
        await qe.access(n);
      } catch {
        return { success: !0, deletedCount: 0, deletedSize: 0 };
      }
      const s = Date.now(), o = r * 24 * 60 * 60 * 1e3;
      let a = 0, i = 0;
      const c = await qe.readdir(n);
      for (const d of c) {
        if (d.startsWith(".")) continue;
        const u = B.join(n, d);
        try {
          const f = await qe.stat(u);
          s - f.mtimeMs > o && (await qe.unlink(u), a++, i += f.size);
        } catch {
        }
      }
      return { success: !0, deletedCount: a, deletedSize: i };
    } catch (n) {
      return { success: !1, error: String(n) };
    }
  }), Z.handle("face:deleteFaces", async (t, r) => {
    const { getDB: n } = await Promise.resolve().then(() => ie), s = n(), o = r.map(() => "?").join(",");
    return s.prepare(`DELETE FROM faces WHERE id IN (${o})`).run(...r), !0;
  }), Z.handle("ai:scanImage", async (t, { photoId: r }) => {
    const { getDB: n } = await Promise.resolve().then(() => ie), s = n();
    x.info(`[Main] Requesting AI scan for ${r}`);
    try {
      const a = s.prepare("SELECT file_path FROM photos WHERE id = ?").get(r);
      if (a && a.file_path) {
        const i = B.join(St, "previews");
        return await qe.mkdir(i, { recursive: !0 }), Kt({
          type: "scan_image",
          payload: {
            photoId: r,
            filePath: a.file_path,
            previewStorageDir: i
          }
        }), new Promise((c, d) => {
          ve.set(r, { resolve: c, reject: d }), setTimeout(() => {
            ve.has(r) && (ve.delete(r), d("Scan timed out"));
          }, 3e5);
        });
      } else
        return x.error("[Main] Photo not found or no path:", r), { success: !1, error: "Photo not found" };
    } catch (o) {
      return x.error("[Main] Failed to lookup photo for AI:", o), { success: !1, error: o };
    }
  }), Z.handle("ai:generateTags", async (t, { photoId: r }) => {
    const { getDB: n } = await Promise.resolve().then(() => ie), s = n();
    x.info(`[Main] Requesting Tags (VLM) for ${r}`);
    try {
      const a = s.prepare("SELECT file_path FROM photos WHERE id = ?").get(r);
      return a && a.file_path ? (Kt({ type: "generate_tags", payload: { photoId: r, filePath: a.file_path } }), { success: !0 }) : { success: !1, error: "Photo not found" };
    } catch (o) {
      return x.error("[Main] Failed to lookup photo for VLM:", o), { success: !1, error: o };
    }
  }), Z.handle("ai:enhanceImage", async (t, { photoId: r, task: n, modelName: s }) => {
    const { getDB: o } = await Promise.resolve().then(() => ie), a = o();
    x.info(`[Main] Enhance Request: ${r} [${n}]`);
    try {
      const c = a.prepare("SELECT file_path FROM photos WHERE id = ?").get(r);
      if (!c || !c.file_path) return { success: !1, error: "Photo not found" };
      const d = B.extname(c.file_path), u = B.basename(c.file_path, d), f = n === "upscale" ? "_upscaled" : "_restored", g = B.join(B.dirname(c.file_path), `${u}${f}.jpg`);
      return new Promise((m, v) => {
        const $ = Math.floor(Math.random() * 1e6);
        ve.set($, {
          resolve: (_) => {
            _.success ? m({ success: !0, outPath: _.outPath }) : m({ success: !1, error: _.error });
          },
          reject: v
        }), Kt({
          type: "enhance_image",
          payload: {
            reqId: $,
            // We piggyback on generic promise handler
            filePath: c.file_path,
            outPath: g,
            task: n,
            modelName: s
          }
        }), setTimeout(() => {
          ve.has($) && (ve.delete($), v("Enhancement timed out"));
        }, 6e5);
      });
    } catch (i) {
      return x.error("Enhance failed:", i), { success: !1, error: String(i) };
    }
  }), Z.handle("ai:rebuildIndex", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ie), r = t();
    x.info("[Main] Rebuilding Vector Index...");
    try {
      const n = r.prepare("SELECT id, descriptor_json FROM faces WHERE descriptor_json IS NOT NULL").all(), s = n.map((a) => JSON.parse(a.descriptor_json)), o = n.map((a) => a.id);
      return s.length === 0 ? { success: !0, count: 0 } : new Promise((a, i) => {
        const c = Math.floor(Math.random() * 1e6);
        ve.set(c, {
          resolve: (d) => a({ success: !0, count: d.count }),
          reject: i
        }), Kt({
          type: "rebuild_index",
          payload: {
            reqId: c,
            descriptors: s,
            ids: o
          }
        });
      });
    } catch (n) {
      return x.error("Failed to rebuild index:", n), { success: !1, error: String(n) };
    }
  }), Z.handle("ai:command", async (t, r) => {
    try {
      const n = Math.floor(Math.random() * 1e7);
      return r.payload || (r.payload = {}), r.payload.reqId = n, new Promise((s, o) => {
        ve.set(n, { resolve: s, reject: o }), Kt(r), setTimeout(() => {
          ve.has(n) && (ve.delete(n), o("Command timed out"));
        }, 3e4);
      });
    } catch (n) {
      return x.error("AI Command Failed:", n), { error: n };
    }
  }), Z.handle("ai:clusterFaces", async (t, { faceIds: r, eps: n, min_samples: s } = {}) => {
    const { getDB: o } = await Promise.resolve().then(() => ie), a = o();
    try {
      let i;
      if (r && r.length > 0) {
        const u = r.map(() => "?").join(",");
        i = a.prepare(`SELECT id, descriptor_json FROM faces WHERE id IN (${u})`).all(...r);
      } else
        i = a.prepare("SELECT id, descriptor_json FROM faces WHERE person_id IS NULL AND is_ignored = 0").all();
      const c = i.map((u) => JSON.parse(u.descriptor_json)), d = i.map((u) => u.id);
      return c.length === 0 ? { success: !0, clusters: [] } : new Promise((u, f) => {
        const g = Math.floor(Math.random() * 1e6);
        ve.set(g, { resolve: (m) => u({ success: !0, clusters: m.clusters }), reject: f }), Kt({
          type: "cluster_faces",
          payload: {
            photoId: g,
            // Abuse photoId as requestId
            descriptors: c,
            ids: d,
            eps: n,
            min_samples: s
          }
        }), setTimeout(() => {
          ve.has(g) && (ve.delete(g), f("Clustering timed out"));
        }, 3e5);
      });
    } catch (i) {
      return x.error("Failed to cluster faces:", i), { success: !1, error: i };
    }
  }), Z.handle("db:addTags", async (t, { photoId: r, tags: n }) => {
    const { getDB: s } = await Promise.resolve().then(() => ie), o = s(), a = o.prepare("INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING"), i = o.prepare("SELECT id FROM tags WHERE name = ?"), c = o.prepare(`
      INSERT INTO photo_tags (photo_id, tag_id, source) 
      VALUES (@photoId, @tagId, 'AI') 
      ON CONFLICT(photo_id, tag_id) DO NOTHING
    `), d = o.transaction((u, f) => {
      for (const g of f) {
        a.run(g);
        const m = i.get(g);
        m && c.run({ photoId: u, tagId: m.id });
      }
    });
    try {
      return d(r, n), { success: !0 };
    } catch (u) {
      return x.error("Failed to add tags:", u), { success: !1, error: u };
    }
  }), Z.handle("db:getTags", async (t, r) => {
    const { getDB: n } = await Promise.resolve().then(() => ie), o = n().prepare(`
      SELECT t.name FROM tags t
      JOIN photo_tags pt ON pt.tag_id = t.id
      WHERE pt.photo_id = ?
    `);
    try {
      return o.all(r).map((i) => i.name);
    } catch (a) {
      return x.error("Failed to get tags:", a), [];
    }
  }), Z.handle("db:clearAITags", async (t) => {
    const { getDB: r } = await Promise.resolve().then(() => ie), n = r();
    try {
      return n.exec(`
        DELETE FROM photo_tags WHERE source = 'AI';
        DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM photo_tags);
      `), x.info("Cleared all AI tags."), { success: !0 };
    } catch (s) {
      return x.error("Failed to clear AI tags:", s), { success: !1, error: s };
    }
  }), Z.handle("db:getPhoto", async (t, r) => {
    const { getDB: n } = await Promise.resolve().then(() => ie), s = n();
    try {
      return s.prepare("SELECT * FROM photos WHERE id = ?").get(r) || null;
    } catch (o) {
      return x.error("Failed to get photo:", o), null;
    }
  }), Z.handle("db:getPhotos", async (t, { limit: r = 50, offset: n = 0, filter: s = {} } = {}) => {
    const { getDB: o } = await Promise.resolve().then(() => ie), a = o();
    try {
      let i = "SELECT p.* FROM photos p";
      const c = [], d = [];
      if (s.untagged && d.push("p.id NOT IN (SELECT photo_id FROM photo_tags)"), s.folder && (d.push("p.file_path LIKE ?"), c.push(`${s.folder}%`)), s.tags && Array.isArray(s.tags) && s.tags.length > 0)
        if (s.tagsMatchAll) {
          const m = s.tags.map(() => "?").join(",");
          d.push(`p.id IN (
             SELECT pt.photo_id FROM photo_tags pt
             JOIN tags t ON pt.tag_id = t.id
             WHERE t.name IN (${m})
             GROUP BY pt.photo_id
             HAVING COUNT(DISTINCT t.name) = ?
           )`), c.push(...s.tags), c.push(s.tags.length);
        } else {
          const m = s.tags.map(() => "?").join(",");
          d.push(`p.id IN (
             SELECT pt.photo_id FROM photo_tags pt
             JOIN tags t ON pt.tag_id = t.id
             WHERE t.name IN (${m})
           )`), c.push(...s.tags);
        }
      else s.tag && (d.push(`p.id IN (
          SELECT pt.photo_id FROM photo_tags pt
          JOIN tags t ON pt.tag_id = t.id
          WHERE t.name = ?
        )`), c.push(s.tag));
      if (s.search) {
        const g = `%${s.search}%`;
        d.push(`p.id IN (
            SELECT pt.photo_id FROM photo_tags pt
            JOIN tags t ON pt.tag_id = t.id
            WHERE t.name LIKE ?
        )`), c.push(g);
      }
      if (s.people && Array.isArray(s.people) && s.people.length > 0) {
        const g = s.peopleMatchAll, m = s.people.map(() => "?").join(",");
        g ? (d.push(`p.id IN (
              SELECT f.photo_id FROM faces f
              WHERE f.person_id IN (${m})
              GROUP BY f.photo_id
              HAVING COUNT(DISTINCT f.person_id) = ?
            )`), c.push(...s.people), c.push(s.people.length)) : (d.push(`p.id IN (
              SELECT f.photo_id FROM faces f
              WHERE f.person_id IN (${m})
            )`), c.push(...s.people));
      }
      return d.length > 0 && (i += " WHERE " + d.join(" AND ")), i += " ORDER BY created_at DESC LIMIT ? OFFSET ?", c.push(r, n), a.prepare(i).all(...c);
    } catch (i) {
      return console.error("Failed to get photos:", i), [];
    }
  }), Z.handle("os:createAlbum", async (t, { photoIds: r, targetDir: n }) => {
    const { getDB: s } = await Promise.resolve().then(() => ie), o = s();
    if (console.log(`[Main] Creating album with ${r == null ? void 0 : r.length} photos in ${n}`), !r || !r.length || !n)
      return { success: !1, error: "Invalid arguments" };
    try {
      const a = r.map(() => "?").join(","), i = o.prepare(`SELECT file_path FROM photos WHERE id IN (${a})`).all(...r);
      let c = 0, d = 0;
      await qe.mkdir(n, { recursive: !0 });
      for (const u of i) {
        const f = u.file_path, g = B.basename(f), m = B.join(n, g);
        try {
          await qe.copyFile(f, m), c++;
        } catch (v) {
          console.error(`Failed to copy ${f} to ${m}`, v), d++;
        }
      }
      return { success: !0, successCount: c, failCount: d };
    } catch (a) {
      return console.error("Create Album failed", a), { success: !1, error: a };
    }
  }), Z.handle("db:getPhotosForRescan", async (t, { filter: r = {} } = {}) => {
    const { getDB: n } = await Promise.resolve().then(() => ie), s = n();
    try {
      let o = "SELECT p.id, p.file_path, p.preview_cache_path FROM photos p";
      const a = [], i = [];
      if (r.untagged && i.push("p.id NOT IN (SELECT photo_id FROM photo_tags)"), r.folder && (i.push("p.file_path LIKE ?"), a.push(`${r.folder}%`)), r.tag && (i.push(`p.id IN (
          SELECT pt.photo_id FROM photo_tags pt
          JOIN tags t ON pt.tag_id = t.id
          WHERE t.name = ?
        )`), a.push(r.tag)), r.people && Array.isArray(r.people) && r.people.length > 0) {
        const d = r.people.map(() => "?").join(",");
        i.push(`p.id IN (
          SELECT f.photo_id FROM faces f
          WHERE f.person_id IN (${d})
        )`), a.push(...r.people);
      }
      return i.length > 0 && (o += " WHERE " + i.join(" AND ")), o += " ORDER BY created_at DESC", s.prepare(o).all(...a);
    } catch (o) {
      return console.error("Failed to get photos for rescan:", o), [];
    }
  }), Z.handle("db:getAllTags", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ie), r = t();
    try {
      return r.prepare(`
        SELECT t.name, COUNT(pt.photo_id) as count
        FROM tags t
        JOIN photo_tags pt ON t.id = pt.tag_id
        GROUP BY t.id
        ORDER BY count DESC
      `).all();
    } catch (n) {
      return console.error("Failed to get all tags:", n), [];
    }
  }), Z.handle("db:removeTag", async (t, { photoId: r, tag: n }) => {
    const { getDB: s } = await Promise.resolve().then(() => ie), o = s();
    try {
      return o.prepare(`
        DELETE FROM photo_tags 
        WHERE photo_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)
      `).run(r, n), { success: !0 };
    } catch (a) {
      return console.error("Failed to remove tag:", a), { success: !1, error: a };
    }
  }), Z.handle("db:renamePerson", async (t, { personId: r, newName: n }) => {
    const { getDB: s } = await Promise.resolve().then(() => ie), o = s(), a = n.trim();
    if (!a) return { success: !1, error: "Name cannot be empty" };
    try {
      const i = o.prepare("SELECT id FROM people WHERE name = ? COLLATE NOCASE").get(a);
      return i ? i.id === r ? { success: !0 } : (console.log(`[Main] Merging person ${r} into ${i.id} (${a})`), o.transaction(() => {
        o.prepare("UPDATE faces SET person_id = ? WHERE person_id = ?").run(i.id, r), o.prepare("DELETE FROM people WHERE id = ?").run(r);
      })(), { success: !0, merged: !0, targetId: i.id }) : (console.log(`[Main] Renaming person ${r} to ${a}`), o.prepare("UPDATE people SET name = ? WHERE id = ?").run(a, r), { success: !0, merged: !1 });
    } catch (i) {
      return console.error("Failed to rename person:", i), { success: !1, error: String(i) };
    }
  }), Z.handle("db:updateFaces", async (t, { photoId: r, faces: n, previewPath: s, width: o, height: a, globalBlurScore: i }) => {
    const { getDB: c } = await Promise.resolve().then(() => ie), d = c();
    try {
      const u = d.prepare("SELECT id, box_json, person_id FROM faces WHERE photo_id = ?"), f = d.prepare("UPDATE faces SET box_json = ?, descriptor_json = ?, blur_score = ? WHERE id = ?"), g = d.prepare("INSERT INTO faces (photo_id, box_json, descriptor_json, person_id, blur_score) VALUES (?, ?, ?, ?, ?)"), m = d.prepare("DELETE FROM faces WHERE id = ?"), v = d.prepare("SELECT id, descriptor_mean_json FROM people WHERE descriptor_mean_json IS NOT NULL"), $ = d.prepare("SELECT person_id, descriptor_json FROM faces WHERE person_id IS NOT NULL"), _ = d.prepare("UPDATE photos SET preview_cache_path = ? WHERE id = ?"), p = d.prepare("UPDATE photos SET width = ?, height = ? WHERE id = ?"), w = d.prepare("UPDATE photos SET blur_score = ? WHERE id = ?");
      return d.transaction(() => {
        s && _.run(s, r), o && a && p.run(o, a, r), i != null && w.run(i, r);
        const T = u.all(r), I = /* @__PURE__ */ new Set(), L = /* @__PURE__ */ new Set();
        for (const M of n) {
          const ee = M.box;
          let he = null, pe = 0;
          for (const V of T) {
            if (I.has(V.id)) continue;
            const G = JSON.parse(V.box_json), te = Math.max(ee.x, G.x), j = Math.max(ee.y, G.y), C = Math.min(ee.x + M.box.width, G.x + G.width), q = Math.min(ee.y + M.box.height, G.y + G.height), U = Math.max(0, C - te) * Math.max(0, q - j);
            if (U > 0) {
              const W = ee.width * ee.height, z = G.width * G.height, N = U / (W + z - U);
              N > 0.25 && N > pe && (pe = N, he = V.id);
            }
          }
          if (he) {
            f.run(JSON.stringify(ee), JSON.stringify(M.descriptor), M.blur_score || null, he), I.add(he);
            const V = T.find((G) => G.id === he);
            V && V.person_id && L.add(V.person_id);
          } else {
            let V = null, G = 0.45;
            const te = v.all();
            for (const j of te) {
              const C = JSON.parse(j.descriptor_mean_json);
              let q = 0, U = 0, W = 0;
              if (M.descriptor.length !== C.length) continue;
              for (let y = 0; y < M.descriptor.length; y++)
                q += M.descriptor[y] * C[y], U += M.descriptor[y] ** 2, W += C[y] ** 2;
              const z = Math.sqrt(U) * Math.sqrt(W), N = z === 0 ? 1 : 1 - q / z;
              N < G && (G = N, V = j.id);
            }
            if (!V) {
              const j = $.all();
              for (const C of j) {
                const q = JSON.parse(C.descriptor_json);
                let U = 0, W = 0, z = 0;
                if (M.descriptor.length !== q.length) continue;
                for (let S = 0; S < M.descriptor.length; S++)
                  U += M.descriptor[S] * q[S], W += M.descriptor[S] ** 2, z += q[S] ** 2;
                const N = Math.sqrt(W) * Math.sqrt(z), y = N === 0 ? 1 : 1 - U / N;
                y < G && (G = y, V = C.person_id);
              }
            }
            g.run(r, JSON.stringify(ee), JSON.stringify(M.descriptor), V, M.blur_score || null), V && L.add(V);
          }
        }
        for (const M of T)
          I.has(M.id) || (m.run(M.id), M.person_id && L.add(M.person_id));
        for (const M of L)
          e(d, M);
      })(), { success: !0 };
    } catch (u) {
      return console.error("Failed to update faces:", u), { success: !1, error: u };
    }
  }), Z.handle("db:getFaces", async (t, r) => {
    const { getDB: n } = await Promise.resolve().then(() => ie), s = n();
    try {
      return s.prepare(`
        SELECT f.*, p.name as person_name 
        FROM faces f
        LEFT JOIN people p ON f.person_id = p.id
        WHERE f.photo_id = ?
      `).all(r).map((i) => ({
        ...i,
        box: JSON.parse(i.box_json),
        descriptor: JSON.parse(i.descriptor_json)
      }));
    } catch (o) {
      return console.error("Failed to get faces:", o), [];
    }
  }), Z.handle("db:getPeople", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ie), r = t();
    try {
      return r.prepare(`
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
      `).all();
    } catch (n) {
      return console.error("Failed to get people", n), [];
    }
  }), Z.handle("db:getAllFaces", async (t, { limit: r = 100, offset: n = 0, filter: s = {} } = {}) => {
    const { getDB: o } = await Promise.resolve().then(() => ie), a = o();
    try {
      let i = `
        SELECT f.*, p.file_path, p.preview_cache_path, p.width, p.height 
        FROM faces f
        JOIN photos p ON f.photo_id = p.id
      `;
      const c = [], d = [];
      return s.unnamed && d.push("f.person_id IS NULL"), s.personId && (d.push("f.person_id = ?"), c.push(s.personId)), d.length > 0 && (i += " WHERE " + d.join(" AND ")), i.includes("is_ignored") || (i += d.length > 0 ? " AND is_ignored = 0" : " WHERE is_ignored = 0"), i += " ORDER BY p.created_at DESC LIMIT ? OFFSET ?", c.push(r, n), a.prepare(i).all(...c).map((g) => ({
        ...g,
        box: JSON.parse(g.box_json),
        descriptor: JSON.parse(g.descriptor_json)
      }));
    } catch (i) {
      return console.error("Failed to get all faces:", i), [];
    }
  }), Z.handle("db:assignPerson", async (t, { faceId: r, personName: n }) => {
    const { getDB: s } = await Promise.resolve().then(() => ie), o = s(), a = o.prepare("INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING"), i = o.prepare("SELECT id FROM people WHERE name = ?"), c = o.prepare("SELECT person_id FROM faces WHERE id = ?"), d = o.prepare("UPDATE faces SET person_id = ? WHERE id = ?"), u = o.transaction(() => {
      const f = c.get(r), g = f ? f.person_id : null;
      a.run(n);
      const m = i.get(n);
      return d.run(m.id, r), e(o, m.id), g && e(o, g), m;
    });
    try {
      return { success: !0, person: u() };
    } catch (f) {
      return console.error("Failed to assign person:", f), { success: !1, error: f };
    }
  }), Z.handle("db:getLibraryStats", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ie), r = t(), n = await import("node:path");
    try {
      try {
        r.function("DIRNAME", (c) => n.dirname(c)), r.function("EXTNAME", (c) => n.extname(c).toLowerCase());
      } catch {
      }
      const o = r.prepare("SELECT COUNT(*) as count FROM photos").get().count, a = r.prepare(`
              SELECT EXTNAME(file_path) as type, COUNT(*) as count 
              FROM photos 
              GROUP BY type 
              ORDER BY count DESC
          `).all(), i = r.prepare(`
              SELECT DISTINCT DIRNAME(file_path) as folder, COUNT(*) as count 
              FROM photos 
              GROUP BY folder 
              ORDER BY count DESC
          `).all();
      return { success: !0, stats: { totalPhotos: o, fileTypes: a, folders: i } };
    } catch (s) {
      return console.error("Failed to get library stats:", s), { success: !1, error: s };
    }
  }), Z.handle("db:deleteFaces", async (t, r) => {
    const { getDB: n } = await Promise.resolve().then(() => ie), s = n();
    try {
      if (!r || r.length === 0) return { success: !0 };
      const o = r.map(() => "?").join(","), i = s.prepare(`SELECT DISTINCT person_id FROM faces WHERE id IN (${o}) AND person_id IS NOT NULL`).all(...r).map((u) => u.person_id), c = s.prepare(`DELETE FROM faces WHERE id IN (${o})`);
      return s.transaction(() => {
        c.run(...r);
        for (const u of i)
          e(s, u);
      })(), { success: !0 };
    } catch (o) {
      return x.error("Failed to delete faces:", o), { success: !1, error: o };
    }
  }), Z.handle("db:reassignFaces", async (t, { faceIds: r, personName: n }) => {
    const { getDB: s } = await Promise.resolve().then(() => ie), o = s(), a = o.prepare("INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING"), i = o.prepare("SELECT id FROM people WHERE name = ?");
    n && a.run(n);
    const c = i.get(n);
    if (!c)
      return { success: !1, error: "Target person could not be created" };
    try {
      if (!r || r.length === 0) return { success: !0 };
      const d = r.map(() => "?").join(","), f = o.prepare(`SELECT DISTINCT person_id FROM faces WHERE id IN (${d}) AND person_id IS NOT NULL`).all(...r).map((v) => v.person_id), g = o.prepare(`UPDATE faces SET person_id = ? WHERE id IN (${d})`);
      return o.transaction(() => {
        g.run(c.id, ...r), e(o, c.id);
        for (const v of f)
          e(o, v);
      })(), { success: !0, person: c };
    } catch (d) {
      return console.error("Failed to reassign faces:", d), { success: !1, error: d };
    }
  }), Z.handle("db:getScanErrors", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ie), r = t();
    try {
      return r.prepare("SELECT * FROM scan_errors ORDER BY timestamp DESC").all();
    } catch (n) {
      return console.error("Failed to get scan errors:", n), [];
    }
  }), Z.handle("db:clearScanErrors", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ie), r = t();
    try {
      return r.exec("DELETE FROM scan_errors"), { success: !0 };
    } catch (n) {
      return { success: !1, error: n };
    }
  }), Z.handle("db:retryScanErrors", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ie), r = t();
    try {
      const s = r.prepare("SELECT photo_id FROM scan_errors").all();
      if (r.exec("DELETE FROM scan_errors"), s.length === 0) return [];
      const o = s.map((c) => c.photo_id), a = o.map(() => "?").join(",");
      return r.prepare(`SELECT * FROM photos WHERE id IN (${a})`).all(...o);
    } catch (n) {
      return console.error("Failed to prepare retry:", n), [];
    }
  });
  const e = (t, r) => {
    try {
      const n = t.prepare("SELECT descriptor_json FROM faces WHERE person_id = ? AND is_ignored = 0").all(r);
      if (n.length === 0) {
        t.prepare("UPDATE people SET descriptor_mean_json = NULL WHERE id = ?").run(r);
        return;
      }
      const s = n.map((i) => JSON.parse(i.descriptor_json));
      if (s.length === 0) return;
      const o = s[0].length, a = new Array(o).fill(0);
      for (const i of s)
        for (let c = 0; c < o; c++)
          a[c] += i[c];
      for (let i = 0; i < o; i++)
        a[i] /= s.length;
      t.prepare("UPDATE people SET descriptor_mean_json = ? WHERE id = ?").run(JSON.stringify(a), r);
    } catch (n) {
      console.error("Mean recalc failed", n);
    }
  };
});
Z.handle("settings:getLibraryPath", () => St);
Z.handle("settings:moveLibrary", async (e, t) => {
  console.log(`[Main] Configuring move library to: ${t}`);
  try {
    if (!(await qe.stat(t)).isDirectory()) return { success: !1, error: "Target is not a directory" };
  } catch {
    return { success: !1, error: "Target directory does not exist" };
  }
  const { closeDB: r } = await Promise.resolve().then(() => ie);
  try {
    r(), Ne && Ne.kill(), console.log("[Main] Moving files...");
    const n = ["library.db", "previews", "vectors.index", "id_map.pkl", "library.db-shm", "library.db-wal"];
    await new Promise((s) => setTimeout(s, 1e3));
    for (const s of n) {
      const o = B.join(St, s), a = B.join(t, s);
      try {
        await qe.access(o), console.log(`Copying ${o} -> ${a}`), await qe.cp(o, a, { recursive: !0, force: !0 });
      } catch (i) {
        if (i.code === "ENOENT")
          continue;
        throw console.error(`Failed to copy ${s}:`, i), new Error(`Failed to copy ${s}: ${i.message}`);
      }
    }
    try {
      await qe.access(B.join(t, "library.db"));
    } catch {
    }
    vb(t), console.log("Cleaning up old files...");
    for (const s of n) {
      const o = B.join(St, s);
      try {
        await qe.rm(o, { recursive: !0, force: !0 });
      } catch (a) {
        console.error(`Failed to cleanup ${o}:`, a);
      }
    }
    return console.log("[Main] Restarting application..."), mt.relaunch(), mt.exit(0), { success: !0 };
  } catch (n) {
    return console.error("[Main] Move failed:", n), { success: !1, error: n };
  }
});
Z.handle("db:unassignFaces", async (e, t) => {
  const { getDB: r } = await Promise.resolve().then(() => ie), n = r();
  try {
    if (!t || t.length === 0) return { success: !0 };
    const s = t.map(() => "?").join(",");
    return n.prepare(`UPDATE faces SET person_id = NULL WHERE id IN (${s})`).run(...t), { success: !0 };
  } catch (s) {
    return console.error("Failed to unassign faces:", s), { success: !1, error: s };
  }
});
Z.handle("db:getPerson", async (e, t) => {
  const { getDB: r } = await Promise.resolve().then(() => ie), n = r();
  try {
    return n.prepare("SELECT * FROM people WHERE id = ?").get(t) || null;
  } catch (s) {
    return console.error("Failed to get person:", s), null;
  }
});
Z.handle("db:getFolders", async () => {
  const { getDB: e } = await Promise.resolve().then(() => ie), t = await import("node:path"), r = e();
  try {
    r.function("DIRNAME", (n) => t.dirname(n));
  } catch {
  }
  try {
    return r.prepare(`
        SELECT DISTINCT DIRNAME(file_path) as folder, COUNT(*) as count 
        FROM photos 
        GROUP BY folder 
        ORDER BY count DESC
      `).all();
  } catch (n) {
    return console.error("Failed to get folders:", n), [];
  }
});
Z.handle("db:ignoreFace", async (e, t) => {
  const { getDB: r } = await Promise.resolve().then(() => ie), n = r();
  try {
    const o = n.prepare("SELECT person_id FROM faces WHERE id = ?").get(t), a = n.prepare("UPDATE faces SET is_ignored = 1 WHERE id = ?");
    return n.transaction(() => {
      a.run(t), o && o.person_id && ld(n, o.person_id);
    })(), { success: !0 };
  } catch (s) {
    return { success: !1, error: s };
  }
});
Z.handle("db:ignoreFaces", async (e, t) => {
  const { getDB: r } = await Promise.resolve().then(() => ie), n = r();
  try {
    if (!t || t.length === 0) return { success: !0 };
    const s = t.map(() => "?").join(","), o = n.prepare(`UPDATE faces SET is_ignored = 1 WHERE id IN (${s})`), i = n.prepare(`SELECT DISTINCT person_id FROM faces WHERE id IN (${s}) AND person_id IS NOT NULL`).all(...t).map((d) => d.person_id);
    return n.transaction(() => {
      o.run(...t);
      for (const d of i)
        ld(n, d);
    })(), { success: !0 };
  } catch (s) {
    return console.error("Failed to ignore faces:", s), { success: !1, error: s };
  }
});
const ld = (e, t) => {
  const r = e.prepare("SELECT descriptor_json FROM faces WHERE person_id = ? AND is_ignored = 0").all(t);
  if (r.length === 0) {
    e.prepare("UPDATE people SET descriptor_mean_json = NULL WHERE id = ?").run(t);
    return;
  }
  const n = r.map((i) => JSON.parse(i.descriptor_json));
  if (n.length === 0) return;
  const s = n[0].length, o = new Array(s).fill(0);
  for (const i of n)
    for (let c = 0; c < s; c++)
      o[c] += i[c];
  let a = 0;
  for (let i = 0; i < s; i++)
    o[i] /= n.length, a += o[i] ** 2;
  if (a = Math.sqrt(a), a > 0)
    for (let i = 0; i < s; i++)
      o[i] /= a;
  e.prepare("UPDATE people SET descriptor_mean_json = ? WHERE id = ?").run(JSON.stringify(o), t);
};
Z.handle("db:removeDuplicateFaces", async () => {
  const { getDB: e } = await Promise.resolve().then(() => ie), t = e();
  try {
    const r = t.prepare(`
        SELECT photo_id, COUNT(*) as count 
        FROM faces 
        GROUP BY photo_id 
        HAVING count > 1
      `).all();
    let n = 0;
    const s = t.prepare("DELETE FROM faces WHERE id = ?");
    for (const o of r) {
      const a = o.photo_id, i = t.prepare("SELECT * FROM faces WHERE photo_id = ? ORDER BY id ASC").all(a), c = [];
      for (const f of i) {
        const g = JSON.parse(f.box_json);
        let m = !1;
        for (const v of c) {
          const $ = JSON.parse(v.box_json), _ = Math.max(g.x, $.x), p = Math.max(g.y, $.y), w = Math.min(g.x + g.width, $.x + $.width), P = Math.min(g.y + g.height, $.y + $.height), T = Math.max(0, w - _) * Math.max(0, P - p);
          if (T > 0) {
            const I = g.width * g.height, L = $.width * $.height;
            if (T / (I + L - T) > 0.5) {
              m = !0, f.person_id && v.person_id;
              break;
            }
          }
        }
        m || c.push(f);
      }
      const d = i.sort((f, g) => f.person_id && !g.person_id ? -1 : !f.person_id && g.person_id ? 1 : f.id - g.id), u = [];
      for (const f of d) {
        const g = JSON.parse(f.box_json);
        let m = !1;
        for (const v of u) {
          const $ = JSON.parse(v.box_json), _ = Math.max(g.x, $.x), p = Math.max(g.y, $.y), w = Math.min(g.x + g.width, $.x + $.width), P = Math.min(g.y + g.height, $.y + $.height), T = Math.max(0, w - _) * Math.max(0, P - p);
          if (T > 0) {
            const I = g.width * g.height, L = $.width * $.height;
            if (T / (I + L - T) > 0.5) {
              m = !0;
              break;
            }
          }
        }
        m ? (s.run(f.id), n++) : u.push(f);
      }
    }
    return console.log(`Deduplication complete. Removed ${n} faces.`), { success: !0, removedCount: n };
  } catch (r) {
    return console.error("Failed to remove duplicates:", r), { success: !1, error: r };
  }
});
Z.handle("db:getAllUnassignedFaceDescriptors", async () => {
  const { getDB: e } = await Promise.resolve().then(() => ie), t = e();
  try {
    return t.prepare(`
        SELECT id, descriptor_json, photo_id 
        FROM faces 
        WHERE person_id IS NULL AND is_ignored = 0
      `).all().map((s) => ({
      id: s.id,
      photoId: s.photo_id,
      descriptor: JSON.parse(s.descriptor_json)
    }));
  } catch (r) {
    return console.error("Failed to get unassigned descriptors:", r), [];
  }
});
Z.handle("db:factoryReset", async () => {
  const { getDB: e } = await Promise.resolve().then(() => ie), t = await import("node:fs/promises"), r = await import("node:path"), n = e();
  try {
    console.log("Commencing Factory Reset..."), n.exec(`
            DELETE FROM photo_tags;
            DELETE FROM faces;
            DELETE FROM people;
            DELETE FROM tags;
            DELETE FROM photos;
            DELETE FROM sqlite_sequence; -- Reset autoincrement
            VACUUM;
        `), console.log("Database tables cleared.");
    const s = mt.getPath("userData"), o = r.join(s, "previews");
    try {
      await t.rm(o, { recursive: !0, force: !0 }), await t.mkdir(o, { recursive: !0 }), console.log("Preview directory cleared.");
    } catch (a) {
      console.error("Error clearing preview directory (non-fatal):", a);
    }
    return { success: !0 };
  } catch (s) {
    return console.error("Factory Reset Failed:", s), { success: !1, error: s };
  }
});
Z.handle("settings:getQueueConfig", async () => ({
  batchSize: fs.get("queue.batchSize", 0),
  cooldownSeconds: fs.get("queue.cooldownSeconds", 60)
}));
Z.handle("settings:setQueueConfig", async (e, t) => (fs.set("queue.batchSize", t.batchSize), fs.set("queue.cooldownSeconds", t.cooldownSeconds), { success: !0 }));
Z.handle("db:getUnprocessedItems", async () => {
  const { getDB: e } = await Promise.resolve().then(() => ie), t = e();
  try {
    const n = t.prepare(`
            SELECT id, file_path FROM photos 
            WHERE id NOT IN (SELECT photo_id FROM photo_tags WHERE source = 'AI')
            ORDER BY created_at DESC
        `).all();
    return console.log(`[Main] Found ${n.length} unprocessed items.`), n;
  } catch (r) {
    return console.error("Failed to get unprocessed items:", r), [];
  }
});
Z.handle("os:getLogPath", () => x.getLogPath());
Z.handle("os:showInFolder", (e, t) => {
  sl.showItemInFolder(t);
});
Z.handle("os:openFolder", (e, t) => {
  sl.openPath(t);
});
process.on("uncaughtException", (e) => {
  x.error("Uncaught Exception:", e);
});
process.on("unhandledRejection", (e) => {
  x.error("Unhandled Rejection:", e);
});
export {
  Hb as MAIN_DIST,
  id as RENDERER_DIST,
  Io as VITE_DEV_SERVER_URL
};
