var jd = Object.defineProperty;
var Di = (e) => {
  throw TypeError(e);
};
var Ad = (e, t, r) => t in e ? jd(e, t, { enumerable: !0, configurable: !0, writable: !0, value: r }) : e[t] = r;
var Qr = (e, t, r) => Ad(e, typeof t != "symbol" ? t + "" : t, r), Us = (e, t, r) => t.has(e) || Di("Cannot " + r);
var x = (e, t, r) => (Us(e, t, "read from private field"), r ? r.call(e) : t.get(e)), lt = (e, t, r) => t.has(e) ? Di("Cannot add the same private member more than once") : t instanceof WeakSet ? t.add(e) : t.set(e, r), He = (e, t, r, n) => (Us(e, t, "write to private field"), n ? n.call(e, r) : t.set(e, r), r), _t = (e, t, r) => (Us(e, t, "access private method"), r);
import ul, { app as Pt, BrowserWindow as ko, protocol as Cd, net as kd, ipcMain as J, dialog as Dd } from "electron";
import { spawn as Md } from "node:child_process";
import { createInterface as Ld } from "node:readline";
import { fileURLToPath as Fd, pathToFileURL as Vd } from "node:url";
import Ud from "better-sqlite3";
import q from "node:path";
import Q, { promises as or } from "node:fs";
import ar, { createHash as zd } from "node:crypto";
import { ExifTool as qd } from "exiftool-vendored";
import Mi from "sharp";
import pe from "node:process";
import { promisify as Te, isDeepStrictEqual as Li } from "node:util";
import Fi from "node:assert";
import dl from "node:os";
import "node:events";
import "node:stream";
import * as Ce from "node:fs/promises";
let De;
function fl(e) {
  const t = q.join(e, "library.db");
  console.log("Initializing Database at:", t), De = new Ud(t), De.pragma("journal_mode = WAL"), De.exec(`
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
    De.exec("ALTER TABLE faces ADD COLUMN blur_score REAL");
  } catch {
  }
  try {
    De.exec("ALTER TABLE faces ADD COLUMN is_ignored BOOLEAN DEFAULT 0");
  } catch {
  }
  try {
    De.exec("ALTER TABLE people ADD COLUMN descriptor_mean_json TEXT");
  } catch {
  }
  try {
    De.exec("ALTER TABLE photos ADD COLUMN blur_score REAL");
  } catch {
  }
  try {
    console.log('Running migration: Cleanup "AI Description" tag...');
    const r = De.prepare("SELECT id FROM tags WHERE name = ?").get("AI Description");
    r && (De.prepare("DELETE FROM photo_tags WHERE tag_id = ?").run(r.id), De.prepare("DELETE FROM tags WHERE id = ?").run(r.id), console.log('Migration complete: "AI Description" tag removed.'));
  } catch (r) {
    console.error("Migration failed:", r);
  }
  console.log("Database schema ensured.");
}
function hl() {
  if (!De)
    throw new Error("Database not initialized");
  return De;
}
function Gd() {
  De && (console.log("Closing Database connection."), De.close(), De = void 0);
}
const ee = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  closeDB: Gd,
  getDB: hl,
  initDB: fl
}, Symbol.toStringTag, { value: "Module" }));
let zs = null, Nn = null;
async function Rn() {
  return zs || Nn || (Nn = (async () => {
    try {
      console.log("Initializing ExifTool...");
      const e = new qd({
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
      return console.log(`ExifTool started successfully. Version: ${r}`), zs = e, e;
    } catch (e) {
      return console.error("FAILED to initialize ExifTool. RAW support will be disabled.", e), null;
    }
  })(), Nn);
}
const Kd = [".jpg", ".jpeg", ".png", ".arw", ".cr2", ".nef", ".dng", ".orf", ".rw2", ".tif", ".tiff"];
async function Hd(e, t, r) {
  const n = hl(), s = [];
  let o = 0;
  const a = q.join(t, "previews");
  await or.mkdir(a, { recursive: !0 });
  const i = n.prepare(`
    INSERT INTO photos (file_path, preview_cache_path, created_at, metadata_json) 
    VALUES (@file_path, @preview_cache_path, @created_at, @metadata_json)
    ON CONFLICT(file_path) DO NOTHING
  `), c = n.prepare("SELECT * FROM photos WHERE file_path = ?");
  async function d(y) {
    const w = q.basename(y), $ = `${zd("md5").update(y).digest("hex")}.jpg`, p = q.join(a, $);
    try {
      try {
        return await or.access(p), p;
      } catch {
        const E = q.extname(y).toLowerCase();
        if (![".jpg", ".jpeg", ".png"].includes(E)) {
          let R = !1;
          if (![".tif", ".tiff"].includes(E))
            try {
              const T = await Rn();
              if (T) {
                const C = `${p}.tmp`, k = new Promise(
                  (ce, le) => setTimeout(() => le(new Error("Preview extraction timed out")), 15e3)
                );
                await Promise.race([
                  T.extractPreview(y, C),
                  k
                ]), await or.access(C), await Mi(C).rotate().resize(1200, 1200, { fit: "inside", withoutEnlargement: !0 }).jpeg({ quality: 80 }).toFile(p);
                try {
                  await or.unlink(C);
                } catch {
                }
                console.log(`Extracted and normalized preview for ${w}`), R = !0;
              }
            } catch {
              try {
                await or.unlink(`${p}.tmp`);
              } catch {
              }
            }
          if (!R)
            try {
              console.log(`Generating preview with Sharp for ${w}...`), await Mi(y).rotate().resize(1200, 1200, { fit: "inside", withoutEnlargement: !0 }).jpeg({ quality: 80 }).toFile(p), console.log(`Generated preview with Sharp for ${w}`), R = !0;
            } catch (T) {
              console.error(`Sharp conversion failed for ${w}:`, T);
            }
          if (R) return p;
        }
      }
    } catch (E) {
      console.error(`Failed to extract/generate preview for ${y}`, E);
    }
    return null;
  }
  let u = 0;
  const f = {};
  async function _(y) {
    try {
      console.log(`Scanning directory: ${y}`);
      const w = await or.readdir(y, { withFileTypes: !0 });
      console.log(`Found ${w.length} entries in ${y}`);
      for (const g of w) {
        const $ = q.join(y, g.name);
        if (g.isDirectory())
          g.name.startsWith(".") || await _($);
        else if (g.isFile()) {
          u++;
          const p = q.extname(g.name).toLowerCase();
          if (Kd.includes(p)) {
            let E = c.get($), N = !1;
            if (E) {
              const R = ![".jpg", ".jpeg", ".png"].includes(p);
              let T = !1;
              if (R) {
                if (E.preview_cache_path)
                  try {
                    await or.access(E.preview_cache_path);
                  } catch {
                    T = !0;
                  }
                else
                  T = !0;
                if (T && await Rn()) {
                  const k = await d($);
                  k && (n.prepare("UPDATE photos SET preview_cache_path = ? WHERE id = ?").run(k, E.id), E.preview_cache_path = k, N = !0);
                }
              }
              if (!E.metadata_json || E.metadata_json === "{}")
                try {
                  const C = await Rn();
                  if (C) {
                    const k = await C.read($);
                    n.prepare("UPDATE photos SET metadata_json = ? WHERE id = ?").run(JSON.stringify(k), E.id), E.metadata_json = JSON.stringify(k), N = !0;
                  }
                } catch (C) {
                  console.error(`Failed to backfill metadata for ${$}`, C);
                }
            }
            if (!E) {
              console.log(`[Scanner] New photo found: ${g.name}`);
              const R = await d($);
              try {
                let T = {};
                try {
                  const C = await Rn();
                  C && (T = await C.read($));
                } catch (C) {
                  console.error(`Failed to read metadata for ${$}`, C);
                }
                i.run({
                  file_path: $,
                  preview_cache_path: R,
                  created_at: (/* @__PURE__ */ new Date()).toISOString(),
                  metadata_json: JSON.stringify(T)
                }), E = c.get($);
              } catch (T) {
                console.error("Insert failed", T);
              }
            }
            E && (s.push(E), o++, (o % 10 === 0 || N) && (r && r(o), await new Promise((R) => setTimeout(R, 0))));
          } else
            f[p] = (f[p] || 0) + 1;
        }
      }
    } catch (w) {
      console.error(`Error scanning ${y}:`, w);
    }
  }
  return await _(e), console.log(`[Scanner] Total files: ${u}, Processed: ${o}, Returned: ${s.length}`), console.log("[Scanner] Skipped Extensions:", f), s;
}
const gr = (e) => {
  const t = typeof e;
  return e !== null && (t === "object" || t === "function");
}, pl = /* @__PURE__ */ new Set([
  "__proto__",
  "prototype",
  "constructor"
]), ml = 1e6, Bd = (e) => e >= "0" && e <= "9";
function yl(e) {
  if (e === "0")
    return !0;
  if (/^[1-9]\d*$/.test(e)) {
    const t = Number.parseInt(e, 10);
    return t <= Number.MAX_SAFE_INTEGER && t <= ml;
  }
  return !1;
}
function qs(e, t) {
  return pl.has(e) ? !1 : (e && yl(e) ? t.push(Number.parseInt(e, 10)) : t.push(e), !0);
}
function Wd(e) {
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
        if (!qs(r, t))
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
          if ((r || n === "property") && !qs(r, t))
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
            !Number.isNaN(i) && Number.isFinite(i) && i >= 0 && i <= Number.MAX_SAFE_INTEGER && i <= ml && r === String(i) ? t.push(i) : t.push(r), r = "", n = "indexEnd";
          }
          break;
        }
        if (n === "indexEnd")
          throw new Error(`Invalid character '${a}' after an index at position ${o}`);
        r += a;
        break;
      }
      default: {
        if (n === "index" && !Bd(a))
          throw new Error(`Invalid character '${a}' in an index at position ${o}`);
        if (n === "indexEnd")
          throw new Error(`Invalid character '${a}' after an index at position ${o}`);
        n === "start" && (n = "property"), r += a;
      }
    }
  }
  switch (s && (r += "\\"), n) {
    case "property": {
      if (!qs(r, t))
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
function _s(e) {
  if (typeof e == "string")
    return Wd(e);
  if (Array.isArray(e)) {
    const t = [];
    for (const [r, n] of e.entries()) {
      if (typeof n != "string" && typeof n != "number")
        throw new TypeError(`Expected a string or number for path segment at index ${r}, got ${typeof n}`);
      if (typeof n == "number" && !Number.isFinite(n))
        throw new TypeError(`Path segment at index ${r} must be a finite number, got ${n}`);
      if (pl.has(n))
        return [];
      typeof n == "string" && yl(n) ? t.push(Number.parseInt(n, 10)) : t.push(n);
    }
    return t;
  }
  return [];
}
function Vi(e, t, r) {
  if (!gr(e) || typeof t != "string" && !Array.isArray(t))
    return r === void 0 ? e : r;
  const n = _s(t);
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
function Tn(e, t, r) {
  if (!gr(e) || typeof t != "string" && !Array.isArray(t))
    return e;
  const n = e, s = _s(t);
  if (s.length === 0)
    return e;
  for (let o = 0; o < s.length; o++) {
    const a = s[o];
    if (o === s.length - 1)
      e[a] = r;
    else if (!gr(e[a])) {
      const c = typeof s[o + 1] == "number";
      e[a] = c ? [] : {};
    }
    e = e[a];
  }
  return n;
}
function Jd(e, t) {
  if (!gr(e) || typeof t != "string" && !Array.isArray(t))
    return !1;
  const r = _s(t);
  if (r.length === 0)
    return !1;
  for (let n = 0; n < r.length; n++) {
    const s = r[n];
    if (n === r.length - 1)
      return Object.hasOwn(e, s) ? (delete e[s], !0) : !1;
    if (e = e[s], !gr(e))
      return !1;
  }
}
function Gs(e, t) {
  if (!gr(e) || typeof t != "string" && !Array.isArray(t))
    return !1;
  const r = _s(t);
  if (r.length === 0)
    return !1;
  for (const n of r) {
    if (!gr(e) || !(n in e))
      return !1;
    e = e[n];
  }
  return !0;
}
const Vt = dl.homedir(), Do = dl.tmpdir(), { env: Or } = pe, Xd = (e) => {
  const t = q.join(Vt, "Library");
  return {
    data: q.join(t, "Application Support", e),
    config: q.join(t, "Preferences", e),
    cache: q.join(t, "Caches", e),
    log: q.join(t, "Logs", e),
    temp: q.join(Do, e)
  };
}, Yd = (e) => {
  const t = Or.APPDATA || q.join(Vt, "AppData", "Roaming"), r = Or.LOCALAPPDATA || q.join(Vt, "AppData", "Local");
  return {
    // Data/config/cache/log are invented by me as Windows isn't opinionated about this
    data: q.join(r, e, "Data"),
    config: q.join(t, e, "Config"),
    cache: q.join(r, e, "Cache"),
    log: q.join(r, e, "Log"),
    temp: q.join(Do, e)
  };
}, xd = (e) => {
  const t = q.basename(Vt);
  return {
    data: q.join(Or.XDG_DATA_HOME || q.join(Vt, ".local", "share"), e),
    config: q.join(Or.XDG_CONFIG_HOME || q.join(Vt, ".config"), e),
    cache: q.join(Or.XDG_CACHE_HOME || q.join(Vt, ".cache"), e),
    // https://wiki.debian.org/XDGBaseDirectorySpecification#state
    log: q.join(Or.XDG_STATE_HOME || q.join(Vt, ".local", "state"), e),
    temp: q.join(Do, t, e)
  };
};
function Qd(e, { suffix: t = "nodejs" } = {}) {
  if (typeof e != "string")
    throw new TypeError(`Expected a string, got ${typeof e}`);
  return t && (e += `-${t}`), pe.platform === "darwin" ? Xd(e) : pe.platform === "win32" ? Yd(e) : xd(e);
}
const Tt = (e, t) => {
  const { onError: r } = t;
  return function(...s) {
    return e.apply(void 0, s).catch(r);
  };
}, vt = (e, t) => {
  const { onError: r } = t;
  return function(...s) {
    try {
      return e.apply(void 0, s);
    } catch (o) {
      return r(o);
    }
  };
}, Zd = 250, Ot = (e, t) => {
  const { isRetriable: r } = t;
  return function(s) {
    const { timeout: o } = s, a = s.interval ?? Zd, i = Date.now() + o;
    return function c(...d) {
      return e.apply(void 0, d).catch((u) => {
        if (!r(u) || Date.now() >= i)
          throw u;
        const f = Math.round(a * Math.random());
        return f > 0 ? new Promise((y) => setTimeout(y, f)).then(() => c.apply(void 0, d)) : c.apply(void 0, d);
      });
    };
  };
}, It = (e, t) => {
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
}, Ir = {
  /* API */
  isChangeErrorOk: (e) => {
    if (!Ir.isNodeError(e))
      return !1;
    const { code: t } = e;
    return t === "ENOSYS" || !ef && (t === "EINVAL" || t === "EPERM");
  },
  isNodeError: (e) => e instanceof Error,
  isRetriableError: (e) => {
    if (!Ir.isNodeError(e))
      return !1;
    const { code: t } = e;
    return t === "EMFILE" || t === "ENFILE" || t === "EAGAIN" || t === "EBUSY" || t === "EACCESS" || t === "EACCES" || t === "EACCS" || t === "EPERM";
  },
  onChangeError: (e) => {
    if (!Ir.isNodeError(e))
      throw e;
    if (!Ir.isChangeErrorOk(e))
      throw e;
  }
}, On = {
  onError: Ir.onChangeError
}, Be = {
  onError: () => {
  }
}, ef = pe.getuid ? !pe.getuid() : !1, Oe = {
  isRetriable: Ir.isRetriableError
}, Ae = {
  attempt: {
    /* ASYNC */
    chmod: Tt(Te(Q.chmod), On),
    chown: Tt(Te(Q.chown), On),
    close: Tt(Te(Q.close), Be),
    fsync: Tt(Te(Q.fsync), Be),
    mkdir: Tt(Te(Q.mkdir), Be),
    realpath: Tt(Te(Q.realpath), Be),
    stat: Tt(Te(Q.stat), Be),
    unlink: Tt(Te(Q.unlink), Be),
    /* SYNC */
    chmodSync: vt(Q.chmodSync, On),
    chownSync: vt(Q.chownSync, On),
    closeSync: vt(Q.closeSync, Be),
    existsSync: vt(Q.existsSync, Be),
    fsyncSync: vt(Q.fsync, Be),
    mkdirSync: vt(Q.mkdirSync, Be),
    realpathSync: vt(Q.realpathSync, Be),
    statSync: vt(Q.statSync, Be),
    unlinkSync: vt(Q.unlinkSync, Be)
  },
  retry: {
    /* ASYNC */
    close: Ot(Te(Q.close), Oe),
    fsync: Ot(Te(Q.fsync), Oe),
    open: Ot(Te(Q.open), Oe),
    readFile: Ot(Te(Q.readFile), Oe),
    rename: Ot(Te(Q.rename), Oe),
    stat: Ot(Te(Q.stat), Oe),
    write: Ot(Te(Q.write), Oe),
    writeFile: Ot(Te(Q.writeFile), Oe),
    /* SYNC */
    closeSync: It(Q.closeSync, Oe),
    fsyncSync: It(Q.fsyncSync, Oe),
    openSync: It(Q.openSync, Oe),
    readFileSync: It(Q.readFileSync, Oe),
    renameSync: It(Q.renameSync, Oe),
    statSync: It(Q.statSync, Oe),
    writeSync: It(Q.writeSync, Oe),
    writeFileSync: It(Q.writeFileSync, Oe)
  }
}, tf = "utf8", Ui = 438, rf = 511, nf = {}, sf = pe.geteuid ? pe.geteuid() : -1, of = pe.getegid ? pe.getegid() : -1, af = 1e3, cf = !!pe.getuid;
pe.getuid && pe.getuid();
const zi = 128, lf = (e) => e instanceof Error && "code" in e, qi = (e) => typeof e == "string", Ks = (e) => e === void 0, uf = pe.platform === "linux", $l = pe.platform === "win32", Mo = ["SIGHUP", "SIGINT", "SIGTERM"];
$l || Mo.push("SIGALRM", "SIGABRT", "SIGVTALRM", "SIGXCPU", "SIGXFSZ", "SIGUSR2", "SIGTRAP", "SIGSYS", "SIGQUIT", "SIGIOT");
uf && Mo.push("SIGIO", "SIGPOLL", "SIGPWR", "SIGSTKFLT");
class df {
  /* CONSTRUCTOR */
  constructor() {
    this.callbacks = /* @__PURE__ */ new Set(), this.exited = !1, this.exit = (t) => {
      if (!this.exited) {
        this.exited = !0;
        for (const r of this.callbacks)
          r();
        t && ($l && t !== "SIGINT" && t !== "SIGTERM" && t !== "SIGKILL" ? pe.kill(pe.pid, "SIGTERM") : pe.kill(pe.pid, t));
      }
    }, this.hook = () => {
      pe.once("exit", () => this.exit());
      for (const t of Mo)
        try {
          pe.once(t, () => this.exit(t));
        } catch {
        }
    }, this.register = (t) => (this.callbacks.add(t), () => {
      this.callbacks.delete(t);
    }), this.hook();
  }
}
const ff = new df(), hf = ff.register, ke = {
  /* VARIABLES */
  store: {},
  // filePath => purge
  /* API */
  create: (e) => {
    const t = `000000${Math.floor(Math.random() * 16777215).toString(16)}`.slice(-6), s = `.tmp-${Date.now().toString().slice(-10)}${t}`;
    return `${e}${s}`;
  },
  get: (e, t, r = !0) => {
    const n = ke.truncate(t(e));
    return n in ke.store ? ke.get(e, t, r) : (ke.store[n] = r, [n, () => delete ke.store[n]]);
  },
  purge: (e) => {
    ke.store[e] && (delete ke.store[e], Ae.attempt.unlink(e));
  },
  purgeSync: (e) => {
    ke.store[e] && (delete ke.store[e], Ae.attempt.unlinkSync(e));
  },
  purgeSyncAll: () => {
    for (const e in ke.store)
      ke.purgeSync(e);
  },
  truncate: (e) => {
    const t = q.basename(e);
    if (t.length <= zi)
      return e;
    const r = /^(\.?)(.*?)((?:\.[^.]+)?(?:\.tmp-\d{10}[a-f0-9]{6})?)$/.exec(t);
    if (!r)
      return e;
    const n = t.length - zi;
    return `${e.slice(0, -t.length)}${r[1]}${r[2].slice(0, -n)}${r[3]}`;
  }
};
hf(ke.purgeSyncAll);
function gl(e, t, r = nf) {
  if (qi(r))
    return gl(e, t, { encoding: r });
  const s = { timeout: r.timeout ?? af };
  let o = null, a = null, i = null;
  try {
    const c = Ae.attempt.realpathSync(e), d = !!c;
    e = c || e, [a, o] = ke.get(e, r.tmpCreate || ke.create, r.tmpPurge !== !1);
    const u = cf && Ks(r.chown), f = Ks(r.mode);
    if (d && (u || f)) {
      const _ = Ae.attempt.statSync(e);
      _ && (r = { ...r }, u && (r.chown = { uid: _.uid, gid: _.gid }), f && (r.mode = _.mode));
    }
    if (!d) {
      const _ = q.dirname(e);
      Ae.attempt.mkdirSync(_, {
        mode: rf,
        recursive: !0
      });
    }
    i = Ae.retry.openSync(s)(a, "w", r.mode || Ui), r.tmpCreated && r.tmpCreated(a), qi(t) ? Ae.retry.writeSync(s)(i, t, 0, r.encoding || tf) : Ks(t) || Ae.retry.writeSync(s)(i, t, 0, t.length, 0), r.fsync !== !1 && (r.fsyncWait !== !1 ? Ae.retry.fsyncSync(s)(i) : Ae.attempt.fsync(i)), Ae.retry.closeSync(s)(i), i = null, r.chown && (r.chown.uid !== sf || r.chown.gid !== of) && Ae.attempt.chownSync(a, r.chown.uid, r.chown.gid), r.mode && r.mode !== Ui && Ae.attempt.chmodSync(a, r.mode);
    try {
      Ae.retry.renameSync(s)(a, e);
    } catch (_) {
      if (!lf(_) || _.code !== "ENAMETOOLONG")
        throw _;
      Ae.retry.renameSync(s)(a, ke.truncate(e));
    }
    o(), a = null;
  } finally {
    i && Ae.attempt.closeSync(i), a && ke.purge(a);
  }
}
function _l(e) {
  return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, "default") ? e.default : e;
}
var ho = { exports: {} }, vl = {}, ot = {}, Lr = {}, vn = {}, Z = {}, gn = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.regexpCode = e.getEsmExportName = e.getProperty = e.safeStringify = e.stringify = e.strConcat = e.addCodeArg = e.str = e._ = e.nil = e._Code = e.Name = e.IDENTIFIER = e._CodeOrName = void 0;
  class t {
  }
  e._CodeOrName = t, e.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
  class r extends t {
    constructor(E) {
      if (super(), !e.IDENTIFIER.test(E))
        throw new Error("CodeGen: name must be a valid identifier");
      this.str = E;
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
    constructor(E) {
      super(), this._items = typeof E == "string" ? [E] : E;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      if (this._items.length > 1)
        return !1;
      const E = this._items[0];
      return E === "" || E === '""';
    }
    get str() {
      var E;
      return (E = this._str) !== null && E !== void 0 ? E : this._str = this._items.reduce((N, R) => `${N}${R}`, "");
    }
    get names() {
      var E;
      return (E = this._names) !== null && E !== void 0 ? E : this._names = this._items.reduce((N, R) => (R instanceof r && (N[R.str] = (N[R.str] || 0) + 1), N), {});
    }
  }
  e._Code = n, e.nil = new n("");
  function s(p, ...E) {
    const N = [p[0]];
    let R = 0;
    for (; R < E.length; )
      i(N, E[R]), N.push(p[++R]);
    return new n(N);
  }
  e._ = s;
  const o = new n("+");
  function a(p, ...E) {
    const N = [y(p[0])];
    let R = 0;
    for (; R < E.length; )
      N.push(o), i(N, E[R]), N.push(o, y(p[++R]));
    return c(N), new n(N);
  }
  e.str = a;
  function i(p, E) {
    E instanceof n ? p.push(...E._items) : E instanceof r ? p.push(E) : p.push(f(E));
  }
  e.addCodeArg = i;
  function c(p) {
    let E = 1;
    for (; E < p.length - 1; ) {
      if (p[E] === o) {
        const N = d(p[E - 1], p[E + 1]);
        if (N !== void 0) {
          p.splice(E - 1, 3, N);
          continue;
        }
        p[E++] = "+";
      }
      E++;
    }
  }
  function d(p, E) {
    if (E === '""')
      return p;
    if (p === '""')
      return E;
    if (typeof p == "string")
      return E instanceof r || p[p.length - 1] !== '"' ? void 0 : typeof E != "string" ? `${p.slice(0, -1)}${E}"` : E[0] === '"' ? p.slice(0, -1) + E.slice(1) : void 0;
    if (typeof E == "string" && E[0] === '"' && !(p instanceof r))
      return `"${p}${E.slice(1)}`;
  }
  function u(p, E) {
    return E.emptyStr() ? p : p.emptyStr() ? E : a`${p}${E}`;
  }
  e.strConcat = u;
  function f(p) {
    return typeof p == "number" || typeof p == "boolean" || p === null ? p : y(Array.isArray(p) ? p.join(",") : p);
  }
  function _(p) {
    return new n(y(p));
  }
  e.stringify = _;
  function y(p) {
    return JSON.stringify(p).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  e.safeStringify = y;
  function w(p) {
    return typeof p == "string" && e.IDENTIFIER.test(p) ? new n(`.${p}`) : s`[${p}]`;
  }
  e.getProperty = w;
  function g(p) {
    if (typeof p == "string" && e.IDENTIFIER.test(p))
      return new n(`${p}`);
    throw new Error(`CodeGen: invalid export name: ${p}, use explicit $id name mapping`);
  }
  e.getEsmExportName = g;
  function $(p) {
    return new n(p.toString());
  }
  e.regexpCode = $;
})(gn);
var po = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.ValueScope = e.ValueScopeName = e.Scope = e.varKinds = e.UsedValueState = void 0;
  const t = gn;
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
      const _ = this.toName(d), { prefix: y } = _, w = (f = u.key) !== null && f !== void 0 ? f : u.ref;
      let g = this._values[y];
      if (g) {
        const E = g.get(w);
        if (E)
          return E;
      } else
        g = this._values[y] = /* @__PURE__ */ new Map();
      g.set(w, _);
      const $ = this._scope[y] || (this._scope[y] = []), p = $.length;
      return $[p] = u.ref, _.setValue(u, { property: y, itemIndex: p }), _;
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
      return this._reduceValues(d, (_) => {
        if (_.value === void 0)
          throw new Error(`CodeGen: name "${_}" has no value`);
        return _.value.code;
      }, u, f);
    }
    _reduceValues(d, u, f = {}, _) {
      let y = t.nil;
      for (const w in d) {
        const g = d[w];
        if (!g)
          continue;
        const $ = f[w] = f[w] || /* @__PURE__ */ new Map();
        g.forEach((p) => {
          if ($.has(p))
            return;
          $.set(p, n.Started);
          let E = u(p);
          if (E) {
            const N = this.opts.es5 ? e.varKinds.var : e.varKinds.const;
            y = (0, t._)`${y}${N} ${p} = ${E};${this.opts._n}`;
          } else if (E = _ == null ? void 0 : _(p))
            y = (0, t._)`${y}${E}${this.opts._n}`;
          else
            throw new r(p);
          $.set(p, n.Completed);
        });
      }
      return y;
    }
  }
  e.ValueScope = i;
})(po);
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.or = e.and = e.not = e.CodeGen = e.operators = e.varKinds = e.ValueScopeName = e.ValueScope = e.Scope = e.Name = e.regexpCode = e.stringify = e.getProperty = e.nil = e.strConcat = e.str = e._ = void 0;
  const t = gn, r = po;
  var n = gn;
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
  var s = po;
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
      const b = l ? r.varKinds.var : this.varKind, I = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
      return `${b} ${this.name}${I};` + h;
    }
    optimizeNames(l, h) {
      if (l[this.name.str])
        return this.rhs && (this.rhs = O(this.rhs, l, h)), this;
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
        return this.rhs = O(this.rhs, l, h), this;
    }
    get names() {
      const l = this.lhs instanceof t.Name ? {} : { ...this.lhs.names };
      return ae(l, this.rhs);
    }
  }
  class c extends i {
    constructor(l, h, b, I) {
      super(l, b, I), this.op = h;
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
  class _ extends o {
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
      return this.code = O(this.code, l, h), this;
    }
    get names() {
      return this.code instanceof t._CodeOrName ? this.code.names : {};
    }
  }
  class y extends o {
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
      let I = b.length;
      for (; I--; ) {
        const j = b[I];
        j.optimizeNames(l, h) || (A(l, j.names), b.splice(I, 1));
      }
      return b.length > 0 ? this : void 0;
    }
    get names() {
      return this.nodes.reduce((l, h) => z(l, h.names), {});
    }
  }
  class w extends y {
    render(l) {
      return "{" + l._n + super.render(l) + "}" + l._n;
    }
  }
  class g extends y {
  }
  class $ extends w {
  }
  $.kind = "else";
  class p extends w {
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
        h = this.else = Array.isArray(b) ? new $(b) : b;
      }
      if (h)
        return l === !1 ? h instanceof p ? h : h.nodes : this.nodes.length ? this : new p(V(l), h instanceof p ? [h] : h.nodes);
      if (!(l === !1 || !this.nodes.length))
        return this;
    }
    optimizeNames(l, h) {
      var b;
      if (this.else = (b = this.else) === null || b === void 0 ? void 0 : b.optimizeNames(l, h), !!(super.optimizeNames(l, h) || this.else))
        return this.condition = O(this.condition, l, h), this;
    }
    get names() {
      const l = super.names;
      return ae(l, this.condition), this.else && z(l, this.else.names), l;
    }
  }
  p.kind = "if";
  class E extends w {
  }
  E.kind = "for";
  class N extends E {
    constructor(l) {
      super(), this.iteration = l;
    }
    render(l) {
      return `for(${this.iteration})` + super.render(l);
    }
    optimizeNames(l, h) {
      if (super.optimizeNames(l, h))
        return this.iteration = O(this.iteration, l, h), this;
    }
    get names() {
      return z(super.names, this.iteration.names);
    }
  }
  class R extends E {
    constructor(l, h, b, I) {
      super(), this.varKind = l, this.name = h, this.from = b, this.to = I;
    }
    render(l) {
      const h = l.es5 ? r.varKinds.var : this.varKind, { name: b, from: I, to: j } = this;
      return `for(${h} ${b}=${I}; ${b}<${j}; ${b}++)` + super.render(l);
    }
    get names() {
      const l = ae(super.names, this.from);
      return ae(l, this.to);
    }
  }
  class T extends E {
    constructor(l, h, b, I) {
      super(), this.loop = l, this.varKind = h, this.name = b, this.iterable = I;
    }
    render(l) {
      return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(l);
    }
    optimizeNames(l, h) {
      if (super.optimizeNames(l, h))
        return this.iterable = O(this.iterable, l, h), this;
    }
    get names() {
      return z(super.names, this.iterable.names);
    }
  }
  class C extends w {
    constructor(l, h, b) {
      super(), this.name = l, this.args = h, this.async = b;
    }
    render(l) {
      return `${this.async ? "async " : ""}function ${this.name}(${this.args})` + super.render(l);
    }
  }
  C.kind = "func";
  class k extends y {
    render(l) {
      return "return " + super.render(l);
    }
  }
  k.kind = "return";
  class ce extends w {
    render(l) {
      let h = "try" + super.render(l);
      return this.catch && (h += this.catch.render(l)), this.finally && (h += this.finally.render(l)), h;
    }
    optimizeNodes() {
      var l, h;
      return super.optimizeNodes(), (l = this.catch) === null || l === void 0 || l.optimizeNodes(), (h = this.finally) === null || h === void 0 || h.optimizeNodes(), this;
    }
    optimizeNames(l, h) {
      var b, I;
      return super.optimizeNames(l, h), (b = this.catch) === null || b === void 0 || b.optimizeNames(l, h), (I = this.finally) === null || I === void 0 || I.optimizeNames(l, h), this;
    }
    get names() {
      const l = super.names;
      return this.catch && z(l, this.catch.names), this.finally && z(l, this.finally.names), l;
    }
  }
  class le extends w {
    constructor(l) {
      super(), this.error = l;
    }
    render(l) {
      return `catch(${this.error})` + super.render(l);
    }
  }
  le.kind = "catch";
  class me extends w {
    render(l) {
      return "finally" + super.render(l);
    }
  }
  me.kind = "finally";
  class L {
    constructor(l, h = {}) {
      this._values = {}, this._blockStarts = [], this._constants = {}, this.opts = { ...h, _n: h.lines ? `
` : "" }, this._extScope = l, this._scope = new r.Scope({ parent: l }), this._nodes = [new g()];
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
    _def(l, h, b, I) {
      const j = this._scope.toName(h);
      return b !== void 0 && I && (this._constants[j.str] = b), this._leafNode(new a(l, j, b)), j;
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
      return typeof l == "function" ? l() : l !== t.nil && this._leafNode(new _(l)), this;
    }
    // returns code for object literal for the passed argument list of key-value pairs
    object(...l) {
      const h = ["{"];
      for (const [b, I] of l)
        h.length > 1 && h.push(","), h.push(b), (b !== I || this.opts.es5) && (h.push(":"), (0, t.addCodeArg)(h, I));
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
      return this._elseNode(new $());
    }
    // end `if` statement (needed if gen.if was used only with condition)
    endIf() {
      return this._endBlockNode(p, $);
    }
    _for(l, h) {
      return this._blockNode(l), h && this.code(h).endFor(), this;
    }
    // a generic `for` clause (or statement if `forBody` is passed)
    for(l, h) {
      return this._for(new N(l), h);
    }
    // `for` statement for a range of values
    forRange(l, h, b, I, j = this.opts.es5 ? r.varKinds.var : r.varKinds.let) {
      const H = this._scope.toName(l);
      return this._for(new R(j, H, h, b), () => I(H));
    }
    // `for-of` statement (in es5 mode replace with a normal for loop)
    forOf(l, h, b, I = r.varKinds.const) {
      const j = this._scope.toName(l);
      if (this.opts.es5) {
        const H = h instanceof t.Name ? h : this.var("_arr", h);
        return this.forRange("_i", 0, (0, t._)`${H}.length`, (K) => {
          this.var(j, (0, t._)`${H}[${K}]`), b(j);
        });
      }
      return this._for(new T("of", I, j, h), () => b(j));
    }
    // `for-in` statement.
    // With option `ownProperties` replaced with a `for-of` loop for object keys
    forIn(l, h, b, I = this.opts.es5 ? r.varKinds.var : r.varKinds.const) {
      if (this.opts.ownProperties)
        return this.forOf(l, (0, t._)`Object.keys(${h})`, b);
      const j = this._scope.toName(l);
      return this._for(new T("in", I, j, h), () => b(j));
    }
    // end `for` loop
    endFor() {
      return this._endBlockNode(E);
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
      const h = new k();
      if (this._blockNode(h), this.code(l), h.nodes.length !== 1)
        throw new Error('CodeGen: "return" should have one node');
      return this._endBlockNode(k);
    }
    // `try` statement
    try(l, h, b) {
      if (!h && !b)
        throw new Error('CodeGen: "try" without "catch" and "finally"');
      const I = new ce();
      if (this._blockNode(I), this.code(l), h) {
        const j = this.name("e");
        this._currNode = I.catch = new le(j), h(j);
      }
      return b && (this._currNode = I.finally = new me(), this.code(b)), this._endBlockNode(le, me);
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
    func(l, h = t.nil, b, I) {
      return this._blockNode(new C(l, h, b)), I && this.code(I).endFunc(), this;
    }
    // end function definition
    endFunc() {
      return this._endBlockNode(C);
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
  e.CodeGen = L;
  function z(v, l) {
    for (const h in l)
      v[h] = (v[h] || 0) + (l[h] || 0);
    return v;
  }
  function ae(v, l) {
    return l instanceof t._CodeOrName ? z(v, l.names) : v;
  }
  function O(v, l, h) {
    if (v instanceof t.Name)
      return b(v);
    if (!I(v))
      return v;
    return new t._Code(v._items.reduce((j, H) => (H instanceof t.Name && (H = b(H)), H instanceof t._Code ? j.push(...H._items) : j.push(H), j), []));
    function b(j) {
      const H = h[j.str];
      return H === void 0 || l[j.str] !== 1 ? j : (delete l[j.str], H);
    }
    function I(j) {
      return j instanceof t._Code && j._items.some((H) => H instanceof t.Name && l[H.str] === 1 && h[H.str] !== void 0);
    }
  }
  function A(v, l) {
    for (const h in l)
      v[h] = (v[h] || 0) - (l[h] || 0);
  }
  function V(v) {
    return typeof v == "boolean" || typeof v == "number" || v === null ? !v : (0, t._)`!${S(v)}`;
  }
  e.not = V;
  const D = m(e.operators.AND);
  function G(...v) {
    return v.reduce(D);
  }
  e.and = G;
  const M = m(e.operators.OR);
  function P(...v) {
    return v.reduce(M);
  }
  e.or = P;
  function m(v) {
    return (l, h) => l === t.nil ? h : h === t.nil ? l : (0, t._)`${S(l)} ${v} ${S(h)}`;
  }
  function S(v) {
    return v instanceof t.Name ? v : (0, t._)`(${v})`;
  }
})(Z);
var F = {};
Object.defineProperty(F, "__esModule", { value: !0 });
F.checkStrictMode = F.getErrorPath = F.Type = F.useFunc = F.setEvaluated = F.evaluatedPropsToName = F.mergeEvaluated = F.eachItem = F.unescapeJsonPointer = F.escapeJsonPointer = F.escapeFragment = F.unescapeFragment = F.schemaRefOrVal = F.schemaHasRulesButRef = F.schemaHasRules = F.checkUnknownRules = F.alwaysValidSchema = F.toHash = void 0;
const ue = Z, pf = gn;
function mf(e) {
  const t = {};
  for (const r of e)
    t[r] = !0;
  return t;
}
F.toHash = mf;
function yf(e, t) {
  return typeof t == "boolean" ? t : Object.keys(t).length === 0 ? !0 : (El(e, t), !wl(t, e.self.RULES.all));
}
F.alwaysValidSchema = yf;
function El(e, t = e.schema) {
  const { opts: r, self: n } = e;
  if (!r.strictSchema || typeof t == "boolean")
    return;
  const s = n.RULES.keywords;
  for (const o in t)
    s[o] || Pl(e, `unknown keyword: "${o}"`);
}
F.checkUnknownRules = El;
function wl(e, t) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (t[r])
      return !0;
  return !1;
}
F.schemaHasRules = wl;
function $f(e, t) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (r !== "$ref" && t.all[r])
      return !0;
  return !1;
}
F.schemaHasRulesButRef = $f;
function gf({ topSchemaRef: e, schemaPath: t }, r, n, s) {
  if (!s) {
    if (typeof r == "number" || typeof r == "boolean")
      return r;
    if (typeof r == "string")
      return (0, ue._)`${r}`;
  }
  return (0, ue._)`${e}${t}${(0, ue.getProperty)(n)}`;
}
F.schemaRefOrVal = gf;
function _f(e) {
  return Sl(decodeURIComponent(e));
}
F.unescapeFragment = _f;
function vf(e) {
  return encodeURIComponent(Lo(e));
}
F.escapeFragment = vf;
function Lo(e) {
  return typeof e == "number" ? `${e}` : e.replace(/~/g, "~0").replace(/\//g, "~1");
}
F.escapeJsonPointer = Lo;
function Sl(e) {
  return e.replace(/~1/g, "/").replace(/~0/g, "~");
}
F.unescapeJsonPointer = Sl;
function Ef(e, t) {
  if (Array.isArray(e))
    for (const r of e)
      t(r);
  else
    t(e);
}
F.eachItem = Ef;
function Gi({ mergeNames: e, mergeToName: t, mergeValues: r, resultToName: n }) {
  return (s, o, a, i) => {
    const c = a === void 0 ? o : a instanceof ue.Name ? (o instanceof ue.Name ? e(s, o, a) : t(s, o, a), a) : o instanceof ue.Name ? (t(s, a, o), o) : r(o, a);
    return i === ue.Name && !(c instanceof ue.Name) ? n(s, c) : c;
  };
}
F.mergeEvaluated = {
  props: Gi({
    mergeNames: (e, t, r) => e.if((0, ue._)`${r} !== true && ${t} !== undefined`, () => {
      e.if((0, ue._)`${t} === true`, () => e.assign(r, !0), () => e.assign(r, (0, ue._)`${r} || {}`).code((0, ue._)`Object.assign(${r}, ${t})`));
    }),
    mergeToName: (e, t, r) => e.if((0, ue._)`${r} !== true`, () => {
      t === !0 ? e.assign(r, !0) : (e.assign(r, (0, ue._)`${r} || {}`), Fo(e, r, t));
    }),
    mergeValues: (e, t) => e === !0 ? !0 : { ...e, ...t },
    resultToName: bl
  }),
  items: Gi({
    mergeNames: (e, t, r) => e.if((0, ue._)`${r} !== true && ${t} !== undefined`, () => e.assign(r, (0, ue._)`${t} === true ? true : ${r} > ${t} ? ${r} : ${t}`)),
    mergeToName: (e, t, r) => e.if((0, ue._)`${r} !== true`, () => e.assign(r, t === !0 ? !0 : (0, ue._)`${r} > ${t} ? ${r} : ${t}`)),
    mergeValues: (e, t) => e === !0 ? !0 : Math.max(e, t),
    resultToName: (e, t) => e.var("items", t)
  })
};
function bl(e, t) {
  if (t === !0)
    return e.var("props", !0);
  const r = e.var("props", (0, ue._)`{}`);
  return t !== void 0 && Fo(e, r, t), r;
}
F.evaluatedPropsToName = bl;
function Fo(e, t, r) {
  Object.keys(r).forEach((n) => e.assign((0, ue._)`${t}${(0, ue.getProperty)(n)}`, !0));
}
F.setEvaluated = Fo;
const Ki = {};
function wf(e, t) {
  return e.scopeValue("func", {
    ref: t,
    code: Ki[t.code] || (Ki[t.code] = new pf._Code(t.code))
  });
}
F.useFunc = wf;
var mo;
(function(e) {
  e[e.Num = 0] = "Num", e[e.Str = 1] = "Str";
})(mo || (F.Type = mo = {}));
function Sf(e, t, r) {
  if (e instanceof ue.Name) {
    const n = t === mo.Num;
    return r ? n ? (0, ue._)`"[" + ${e} + "]"` : (0, ue._)`"['" + ${e} + "']"` : n ? (0, ue._)`"/" + ${e}` : (0, ue._)`"/" + ${e}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
  }
  return r ? (0, ue.getProperty)(e).toString() : "/" + Lo(e);
}
F.getErrorPath = Sf;
function Pl(e, t, r = e.opts.strictSchema) {
  if (r) {
    if (t = `strict mode: ${t}`, r === !0)
      throw new Error(t);
    e.self.logger.warn(t);
  }
}
F.checkStrictMode = Pl;
var We = {};
Object.defineProperty(We, "__esModule", { value: !0 });
const Ie = Z, bf = {
  // validation function arguments
  data: new Ie.Name("data"),
  // data passed to validation function
  // args passed from referencing schema
  valCxt: new Ie.Name("valCxt"),
  // validation/data context - should not be used directly, it is destructured to the names below
  instancePath: new Ie.Name("instancePath"),
  parentData: new Ie.Name("parentData"),
  parentDataProperty: new Ie.Name("parentDataProperty"),
  rootData: new Ie.Name("rootData"),
  // root data - same as the data passed to the first/top validation function
  dynamicAnchors: new Ie.Name("dynamicAnchors"),
  // used to support recursiveRef and dynamicRef
  // function scoped variables
  vErrors: new Ie.Name("vErrors"),
  // null or array of validation errors
  errors: new Ie.Name("errors"),
  // counter of validation errors
  this: new Ie.Name("this"),
  // "globals"
  self: new Ie.Name("self"),
  scope: new Ie.Name("scope"),
  // JTD serialize/parse name for JSON string and position
  json: new Ie.Name("json"),
  jsonPos: new Ie.Name("jsonPos"),
  jsonLen: new Ie.Name("jsonLen"),
  jsonPart: new Ie.Name("jsonPart")
};
We.default = bf;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.extendErrors = e.resetErrorsCount = e.reportExtraError = e.reportError = e.keyword$DataError = e.keywordError = void 0;
  const t = Z, r = F, n = We;
  e.keywordError = {
    message: ({ keyword: $ }) => (0, t.str)`must pass "${$}" keyword validation`
  }, e.keyword$DataError = {
    message: ({ keyword: $, schemaType: p }) => p ? (0, t.str)`"${$}" keyword must be ${p} ($data)` : (0, t.str)`"${$}" keyword is invalid ($data)`
  };
  function s($, p = e.keywordError, E, N) {
    const { it: R } = $, { gen: T, compositeRule: C, allErrors: k } = R, ce = f($, p, E);
    N ?? (C || k) ? c(T, ce) : d(R, (0, t._)`[${ce}]`);
  }
  e.reportError = s;
  function o($, p = e.keywordError, E) {
    const { it: N } = $, { gen: R, compositeRule: T, allErrors: C } = N, k = f($, p, E);
    c(R, k), T || C || d(N, n.default.vErrors);
  }
  e.reportExtraError = o;
  function a($, p) {
    $.assign(n.default.errors, p), $.if((0, t._)`${n.default.vErrors} !== null`, () => $.if(p, () => $.assign((0, t._)`${n.default.vErrors}.length`, p), () => $.assign(n.default.vErrors, null)));
  }
  e.resetErrorsCount = a;
  function i({ gen: $, keyword: p, schemaValue: E, data: N, errsCount: R, it: T }) {
    if (R === void 0)
      throw new Error("ajv implementation error");
    const C = $.name("err");
    $.forRange("i", R, n.default.errors, (k) => {
      $.const(C, (0, t._)`${n.default.vErrors}[${k}]`), $.if((0, t._)`${C}.instancePath === undefined`, () => $.assign((0, t._)`${C}.instancePath`, (0, t.strConcat)(n.default.instancePath, T.errorPath))), $.assign((0, t._)`${C}.schemaPath`, (0, t.str)`${T.errSchemaPath}/${p}`), T.opts.verbose && ($.assign((0, t._)`${C}.schema`, E), $.assign((0, t._)`${C}.data`, N));
    });
  }
  e.extendErrors = i;
  function c($, p) {
    const E = $.const("err", p);
    $.if((0, t._)`${n.default.vErrors} === null`, () => $.assign(n.default.vErrors, (0, t._)`[${E}]`), (0, t._)`${n.default.vErrors}.push(${E})`), $.code((0, t._)`${n.default.errors}++`);
  }
  function d($, p) {
    const { gen: E, validateName: N, schemaEnv: R } = $;
    R.$async ? E.throw((0, t._)`new ${$.ValidationError}(${p})`) : (E.assign((0, t._)`${N}.errors`, p), E.return(!1));
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
  function f($, p, E) {
    const { createErrors: N } = $.it;
    return N === !1 ? (0, t._)`{}` : _($, p, E);
  }
  function _($, p, E = {}) {
    const { gen: N, it: R } = $, T = [
      y(R, E),
      w($, E)
    ];
    return g($, p, T), N.object(...T);
  }
  function y({ errorPath: $ }, { instancePath: p }) {
    const E = p ? (0, t.str)`${$}${(0, r.getErrorPath)(p, r.Type.Str)}` : $;
    return [n.default.instancePath, (0, t.strConcat)(n.default.instancePath, E)];
  }
  function w({ keyword: $, it: { errSchemaPath: p } }, { schemaPath: E, parentSchema: N }) {
    let R = N ? p : (0, t.str)`${p}/${$}`;
    return E && (R = (0, t.str)`${R}${(0, r.getErrorPath)(E, r.Type.Str)}`), [u.schemaPath, R];
  }
  function g($, { params: p, message: E }, N) {
    const { keyword: R, data: T, schemaValue: C, it: k } = $, { opts: ce, propertyName: le, topSchemaRef: me, schemaPath: L } = k;
    N.push([u.keyword, R], [u.params, typeof p == "function" ? p($) : p || (0, t._)`{}`]), ce.messages && N.push([u.message, typeof E == "function" ? E($) : E]), ce.verbose && N.push([u.schema, C], [u.parentSchema, (0, t._)`${me}${L}`], [n.default.data, T]), le && N.push([u.propertyName, le]);
  }
})(vn);
Object.defineProperty(Lr, "__esModule", { value: !0 });
Lr.boolOrEmptySchema = Lr.topBoolOrEmptySchema = void 0;
const Pf = vn, Nf = Z, Rf = We, Tf = {
  message: "boolean schema is false"
};
function Of(e) {
  const { gen: t, schema: r, validateName: n } = e;
  r === !1 ? Nl(e, !1) : typeof r == "object" && r.$async === !0 ? t.return(Rf.default.data) : (t.assign((0, Nf._)`${n}.errors`, null), t.return(!0));
}
Lr.topBoolOrEmptySchema = Of;
function If(e, t) {
  const { gen: r, schema: n } = e;
  n === !1 ? (r.var(t, !1), Nl(e)) : r.var(t, !0);
}
Lr.boolOrEmptySchema = If;
function Nl(e, t) {
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
  (0, Pf.reportError)(s, Tf, void 0, t);
}
var Ee = {}, _r = {};
Object.defineProperty(_r, "__esModule", { value: !0 });
_r.getRules = _r.isJSONType = void 0;
const jf = ["string", "number", "integer", "boolean", "null", "object", "array"], Af = new Set(jf);
function Cf(e) {
  return typeof e == "string" && Af.has(e);
}
_r.isJSONType = Cf;
function kf() {
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
_r.getRules = kf;
var Et = {};
Object.defineProperty(Et, "__esModule", { value: !0 });
Et.shouldUseRule = Et.shouldUseGroup = Et.schemaHasRulesForType = void 0;
function Df({ schema: e, self: t }, r) {
  const n = t.RULES.types[r];
  return n && n !== !0 && Rl(e, n);
}
Et.schemaHasRulesForType = Df;
function Rl(e, t) {
  return t.rules.some((r) => Tl(e, r));
}
Et.shouldUseGroup = Rl;
function Tl(e, t) {
  var r;
  return e[t.keyword] !== void 0 || ((r = t.definition.implements) === null || r === void 0 ? void 0 : r.some((n) => e[n] !== void 0));
}
Et.shouldUseRule = Tl;
Object.defineProperty(Ee, "__esModule", { value: !0 });
Ee.reportTypeError = Ee.checkDataTypes = Ee.checkDataType = Ee.coerceAndCheckDataType = Ee.getJSONTypes = Ee.getSchemaTypes = Ee.DataType = void 0;
const Mf = _r, Lf = Et, Ff = vn, te = Z, Ol = F;
var Ar;
(function(e) {
  e[e.Correct = 0] = "Correct", e[e.Wrong = 1] = "Wrong";
})(Ar || (Ee.DataType = Ar = {}));
function Vf(e) {
  const t = Il(e.type);
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
Ee.getSchemaTypes = Vf;
function Il(e) {
  const t = Array.isArray(e) ? e : e ? [e] : [];
  if (t.every(Mf.isJSONType))
    return t;
  throw new Error("type must be JSONType or JSONType[]: " + t.join(","));
}
Ee.getJSONTypes = Il;
function Uf(e, t) {
  const { gen: r, data: n, opts: s } = e, o = zf(t, s.coerceTypes), a = t.length > 0 && !(o.length === 0 && t.length === 1 && (0, Lf.schemaHasRulesForType)(e, t[0]));
  if (a) {
    const i = Vo(t, n, s.strictNumbers, Ar.Wrong);
    r.if(i, () => {
      o.length ? qf(e, t, o) : Uo(e);
    });
  }
  return a;
}
Ee.coerceAndCheckDataType = Uf;
const jl = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
function zf(e, t) {
  return t ? e.filter((r) => jl.has(r) || t === "array" && r === "array") : [];
}
function qf(e, t, r) {
  const { gen: n, data: s, opts: o } = e, a = n.let("dataType", (0, te._)`typeof ${s}`), i = n.let("coerced", (0, te._)`undefined`);
  o.coerceTypes === "array" && n.if((0, te._)`${a} == 'object' && Array.isArray(${s}) && ${s}.length == 1`, () => n.assign(s, (0, te._)`${s}[0]`).assign(a, (0, te._)`typeof ${s}`).if(Vo(t, s, o.strictNumbers), () => n.assign(i, s))), n.if((0, te._)`${i} !== undefined`);
  for (const d of r)
    (jl.has(d) || d === "array" && o.coerceTypes === "array") && c(d);
  n.else(), Uo(e), n.endIf(), n.if((0, te._)`${i} !== undefined`, () => {
    n.assign(s, i), Gf(e, i);
  });
  function c(d) {
    switch (d) {
      case "string":
        n.elseIf((0, te._)`${a} == "number" || ${a} == "boolean"`).assign(i, (0, te._)`"" + ${s}`).elseIf((0, te._)`${s} === null`).assign(i, (0, te._)`""`);
        return;
      case "number":
        n.elseIf((0, te._)`${a} == "boolean" || ${s} === null
              || (${a} == "string" && ${s} && ${s} == +${s})`).assign(i, (0, te._)`+${s}`);
        return;
      case "integer":
        n.elseIf((0, te._)`${a} === "boolean" || ${s} === null
              || (${a} === "string" && ${s} && ${s} == +${s} && !(${s} % 1))`).assign(i, (0, te._)`+${s}`);
        return;
      case "boolean":
        n.elseIf((0, te._)`${s} === "false" || ${s} === 0 || ${s} === null`).assign(i, !1).elseIf((0, te._)`${s} === "true" || ${s} === 1`).assign(i, !0);
        return;
      case "null":
        n.elseIf((0, te._)`${s} === "" || ${s} === 0 || ${s} === false`), n.assign(i, null);
        return;
      case "array":
        n.elseIf((0, te._)`${a} === "string" || ${a} === "number"
              || ${a} === "boolean" || ${s} === null`).assign(i, (0, te._)`[${s}]`);
    }
  }
}
function Gf({ gen: e, parentData: t, parentDataProperty: r }, n) {
  e.if((0, te._)`${t} !== undefined`, () => e.assign((0, te._)`${t}[${r}]`, n));
}
function yo(e, t, r, n = Ar.Correct) {
  const s = n === Ar.Correct ? te.operators.EQ : te.operators.NEQ;
  let o;
  switch (e) {
    case "null":
      return (0, te._)`${t} ${s} null`;
    case "array":
      o = (0, te._)`Array.isArray(${t})`;
      break;
    case "object":
      o = (0, te._)`${t} && typeof ${t} == "object" && !Array.isArray(${t})`;
      break;
    case "integer":
      o = a((0, te._)`!(${t} % 1) && !isNaN(${t})`);
      break;
    case "number":
      o = a();
      break;
    default:
      return (0, te._)`typeof ${t} ${s} ${e}`;
  }
  return n === Ar.Correct ? o : (0, te.not)(o);
  function a(i = te.nil) {
    return (0, te.and)((0, te._)`typeof ${t} == "number"`, i, r ? (0, te._)`isFinite(${t})` : te.nil);
  }
}
Ee.checkDataType = yo;
function Vo(e, t, r, n) {
  if (e.length === 1)
    return yo(e[0], t, r, n);
  let s;
  const o = (0, Ol.toHash)(e);
  if (o.array && o.object) {
    const a = (0, te._)`typeof ${t} != "object"`;
    s = o.null ? a : (0, te._)`!${t} || ${a}`, delete o.null, delete o.array, delete o.object;
  } else
    s = te.nil;
  o.number && delete o.integer;
  for (const a in o)
    s = (0, te.and)(s, yo(a, t, r, n));
  return s;
}
Ee.checkDataTypes = Vo;
const Kf = {
  message: ({ schema: e }) => `must be ${e}`,
  params: ({ schema: e, schemaValue: t }) => typeof e == "string" ? (0, te._)`{type: ${e}}` : (0, te._)`{type: ${t}}`
};
function Uo(e) {
  const t = Hf(e);
  (0, Ff.reportError)(t, Kf);
}
Ee.reportTypeError = Uo;
function Hf(e) {
  const { gen: t, data: r, schema: n } = e, s = (0, Ol.schemaRefOrVal)(e, n, "type");
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
var vs = {};
Object.defineProperty(vs, "__esModule", { value: !0 });
vs.assignDefaults = void 0;
const wr = Z, Bf = F;
function Wf(e, t) {
  const { properties: r, items: n } = e.schema;
  if (t === "object" && r)
    for (const s in r)
      Hi(e, s, r[s].default);
  else t === "array" && Array.isArray(n) && n.forEach((s, o) => Hi(e, o, s.default));
}
vs.assignDefaults = Wf;
function Hi(e, t, r) {
  const { gen: n, compositeRule: s, data: o, opts: a } = e;
  if (r === void 0)
    return;
  const i = (0, wr._)`${o}${(0, wr.getProperty)(t)}`;
  if (s) {
    (0, Bf.checkStrictMode)(e, `default is ignored for: ${i}`);
    return;
  }
  let c = (0, wr._)`${i} === undefined`;
  a.useDefaults === "empty" && (c = (0, wr._)`${c} || ${i} === null || ${i} === ""`), n.if(c, (0, wr._)`${i} = ${(0, wr.stringify)(r)}`);
}
var mt = {}, se = {};
Object.defineProperty(se, "__esModule", { value: !0 });
se.validateUnion = se.validateArray = se.usePattern = se.callValidateCode = se.schemaProperties = se.allSchemaProperties = se.noPropertyInData = se.propertyInData = se.isOwnProperty = se.hasPropFunc = se.reportMissingProp = se.checkMissingProp = se.checkReportMissingProp = void 0;
const fe = Z, zo = F, jt = We, Jf = F;
function Xf(e, t) {
  const { gen: r, data: n, it: s } = e;
  r.if(Go(r, n, t, s.opts.ownProperties), () => {
    e.setParams({ missingProperty: (0, fe._)`${t}` }, !0), e.error();
  });
}
se.checkReportMissingProp = Xf;
function Yf({ gen: e, data: t, it: { opts: r } }, n, s) {
  return (0, fe.or)(...n.map((o) => (0, fe.and)(Go(e, t, o, r.ownProperties), (0, fe._)`${s} = ${o}`)));
}
se.checkMissingProp = Yf;
function xf(e, t) {
  e.setParams({ missingProperty: t }, !0), e.error();
}
se.reportMissingProp = xf;
function Al(e) {
  return e.scopeValue("func", {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    ref: Object.prototype.hasOwnProperty,
    code: (0, fe._)`Object.prototype.hasOwnProperty`
  });
}
se.hasPropFunc = Al;
function qo(e, t, r) {
  return (0, fe._)`${Al(e)}.call(${t}, ${r})`;
}
se.isOwnProperty = qo;
function Qf(e, t, r, n) {
  const s = (0, fe._)`${t}${(0, fe.getProperty)(r)} !== undefined`;
  return n ? (0, fe._)`${s} && ${qo(e, t, r)}` : s;
}
se.propertyInData = Qf;
function Go(e, t, r, n) {
  const s = (0, fe._)`${t}${(0, fe.getProperty)(r)} === undefined`;
  return n ? (0, fe.or)(s, (0, fe.not)(qo(e, t, r))) : s;
}
se.noPropertyInData = Go;
function Cl(e) {
  return e ? Object.keys(e).filter((t) => t !== "__proto__") : [];
}
se.allSchemaProperties = Cl;
function Zf(e, t) {
  return Cl(t).filter((r) => !(0, zo.alwaysValidSchema)(e, t[r]));
}
se.schemaProperties = Zf;
function eh({ schemaCode: e, data: t, it: { gen: r, topSchemaRef: n, schemaPath: s, errorPath: o }, it: a }, i, c, d) {
  const u = d ? (0, fe._)`${e}, ${t}, ${n}${s}` : t, f = [
    [jt.default.instancePath, (0, fe.strConcat)(jt.default.instancePath, o)],
    [jt.default.parentData, a.parentData],
    [jt.default.parentDataProperty, a.parentDataProperty],
    [jt.default.rootData, jt.default.rootData]
  ];
  a.opts.dynamicRef && f.push([jt.default.dynamicAnchors, jt.default.dynamicAnchors]);
  const _ = (0, fe._)`${u}, ${r.object(...f)}`;
  return c !== fe.nil ? (0, fe._)`${i}.call(${c}, ${_})` : (0, fe._)`${i}(${_})`;
}
se.callValidateCode = eh;
const th = (0, fe._)`new RegExp`;
function rh({ gen: e, it: { opts: t } }, r) {
  const n = t.unicodeRegExp ? "u" : "", { regExp: s } = t.code, o = s(r, n);
  return e.scopeValue("pattern", {
    key: o.toString(),
    ref: o,
    code: (0, fe._)`${s.code === "new RegExp" ? th : (0, Jf.useFunc)(e, s)}(${r}, ${n})`
  });
}
se.usePattern = rh;
function nh(e) {
  const { gen: t, data: r, keyword: n, it: s } = e, o = t.name("valid");
  if (s.allErrors) {
    const i = t.let("valid", !0);
    return a(() => t.assign(i, !1)), i;
  }
  return t.var(o, !0), a(() => t.break()), o;
  function a(i) {
    const c = t.const("len", (0, fe._)`${r}.length`);
    t.forRange("i", 0, c, (d) => {
      e.subschema({
        keyword: n,
        dataProp: d,
        dataPropType: zo.Type.Num
      }, o), t.if((0, fe.not)(o), i);
    });
  }
}
se.validateArray = nh;
function sh(e) {
  const { gen: t, schema: r, keyword: n, it: s } = e;
  if (!Array.isArray(r))
    throw new Error("ajv implementation error");
  if (r.some((c) => (0, zo.alwaysValidSchema)(s, c)) && !s.opts.unevaluated)
    return;
  const a = t.let("valid", !1), i = t.name("_valid");
  t.block(() => r.forEach((c, d) => {
    const u = e.subschema({
      keyword: n,
      schemaProp: d,
      compositeRule: !0
    }, i);
    t.assign(a, (0, fe._)`${a} || ${i}`), e.mergeValidEvaluated(u, i) || t.if((0, fe.not)(a));
  })), e.result(a, () => e.reset(), () => e.error(!0));
}
se.validateUnion = sh;
Object.defineProperty(mt, "__esModule", { value: !0 });
mt.validateKeywordUsage = mt.validSchemaType = mt.funcKeywordCode = mt.macroKeywordCode = void 0;
const Me = Z, lr = We, oh = se, ah = vn;
function ih(e, t) {
  const { gen: r, keyword: n, schema: s, parentSchema: o, it: a } = e, i = t.macro.call(a.self, s, o, a), c = kl(r, n, i);
  a.opts.validateSchema !== !1 && a.self.validateSchema(i, !0);
  const d = r.name("valid");
  e.subschema({
    schema: i,
    schemaPath: Me.nil,
    errSchemaPath: `${a.errSchemaPath}/${n}`,
    topSchemaRef: c,
    compositeRule: !0
  }, d), e.pass(d, () => e.error(!0));
}
mt.macroKeywordCode = ih;
function ch(e, t) {
  var r;
  const { gen: n, keyword: s, schema: o, parentSchema: a, $data: i, it: c } = e;
  uh(c, t);
  const d = !i && t.compile ? t.compile.call(c.self, o, a, c) : t.validate, u = kl(n, s, d), f = n.let("valid");
  e.block$data(f, _), e.ok((r = t.valid) !== null && r !== void 0 ? r : f);
  function _() {
    if (t.errors === !1)
      g(), t.modifying && Bi(e), $(() => e.error());
    else {
      const p = t.async ? y() : w();
      t.modifying && Bi(e), $(() => lh(e, p));
    }
  }
  function y() {
    const p = n.let("ruleErrs", null);
    return n.try(() => g((0, Me._)`await `), (E) => n.assign(f, !1).if((0, Me._)`${E} instanceof ${c.ValidationError}`, () => n.assign(p, (0, Me._)`${E}.errors`), () => n.throw(E))), p;
  }
  function w() {
    const p = (0, Me._)`${u}.errors`;
    return n.assign(p, null), g(Me.nil), p;
  }
  function g(p = t.async ? (0, Me._)`await ` : Me.nil) {
    const E = c.opts.passContext ? lr.default.this : lr.default.self, N = !("compile" in t && !i || t.schema === !1);
    n.assign(f, (0, Me._)`${p}${(0, oh.callValidateCode)(e, u, E, N)}`, t.modifying);
  }
  function $(p) {
    var E;
    n.if((0, Me.not)((E = t.valid) !== null && E !== void 0 ? E : f), p);
  }
}
mt.funcKeywordCode = ch;
function Bi(e) {
  const { gen: t, data: r, it: n } = e;
  t.if(n.parentData, () => t.assign(r, (0, Me._)`${n.parentData}[${n.parentDataProperty}]`));
}
function lh(e, t) {
  const { gen: r } = e;
  r.if((0, Me._)`Array.isArray(${t})`, () => {
    r.assign(lr.default.vErrors, (0, Me._)`${lr.default.vErrors} === null ? ${t} : ${lr.default.vErrors}.concat(${t})`).assign(lr.default.errors, (0, Me._)`${lr.default.vErrors}.length`), (0, ah.extendErrors)(e);
  }, () => e.error());
}
function uh({ schemaEnv: e }, t) {
  if (t.async && !e.$async)
    throw new Error("async keyword in sync schema");
}
function kl(e, t, r) {
  if (r === void 0)
    throw new Error(`keyword "${t}" failed to compile`);
  return e.scopeValue("keyword", typeof r == "function" ? { ref: r } : { ref: r, code: (0, Me.stringify)(r) });
}
function dh(e, t, r = !1) {
  return !t.length || t.some((n) => n === "array" ? Array.isArray(e) : n === "object" ? e && typeof e == "object" && !Array.isArray(e) : typeof e == n || r && typeof e > "u");
}
mt.validSchemaType = dh;
function fh({ schema: e, opts: t, self: r, errSchemaPath: n }, s, o) {
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
mt.validateKeywordUsage = fh;
var Gt = {};
Object.defineProperty(Gt, "__esModule", { value: !0 });
Gt.extendSubschemaMode = Gt.extendSubschemaData = Gt.getSubschema = void 0;
const ft = Z, Dl = F;
function hh(e, { keyword: t, schemaProp: r, schema: n, schemaPath: s, errSchemaPath: o, topSchemaRef: a }) {
  if (t !== void 0 && n !== void 0)
    throw new Error('both "keyword" and "schema" passed, only one allowed');
  if (t !== void 0) {
    const i = e.schema[t];
    return r === void 0 ? {
      schema: i,
      schemaPath: (0, ft._)`${e.schemaPath}${(0, ft.getProperty)(t)}`,
      errSchemaPath: `${e.errSchemaPath}/${t}`
    } : {
      schema: i[r],
      schemaPath: (0, ft._)`${e.schemaPath}${(0, ft.getProperty)(t)}${(0, ft.getProperty)(r)}`,
      errSchemaPath: `${e.errSchemaPath}/${t}/${(0, Dl.escapeFragment)(r)}`
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
Gt.getSubschema = hh;
function ph(e, t, { dataProp: r, dataPropType: n, data: s, dataTypes: o, propertyName: a }) {
  if (s !== void 0 && r !== void 0)
    throw new Error('both "data" and "dataProp" passed, only one allowed');
  const { gen: i } = t;
  if (r !== void 0) {
    const { errorPath: d, dataPathArr: u, opts: f } = t, _ = i.let("data", (0, ft._)`${t.data}${(0, ft.getProperty)(r)}`, !0);
    c(_), e.errorPath = (0, ft.str)`${d}${(0, Dl.getErrorPath)(r, n, f.jsPropertySyntax)}`, e.parentDataProperty = (0, ft._)`${r}`, e.dataPathArr = [...u, e.parentDataProperty];
  }
  if (s !== void 0) {
    const d = s instanceof ft.Name ? s : i.let("data", s, !0);
    c(d), a !== void 0 && (e.propertyName = a);
  }
  o && (e.dataTypes = o);
  function c(d) {
    e.data = d, e.dataLevel = t.dataLevel + 1, e.dataTypes = [], t.definedProperties = /* @__PURE__ */ new Set(), e.parentData = t.data, e.dataNames = [...t.dataNames, d];
  }
}
Gt.extendSubschemaData = ph;
function mh(e, { jtdDiscriminator: t, jtdMetadata: r, compositeRule: n, createErrors: s, allErrors: o }) {
  n !== void 0 && (e.compositeRule = n), s !== void 0 && (e.createErrors = s), o !== void 0 && (e.allErrors = o), e.jtdDiscriminator = t, e.jtdMetadata = r;
}
Gt.extendSubschemaMode = mh;
var Ne = {}, Es = function e(t, r) {
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
}, Ml = { exports: {} }, zt = Ml.exports = function(e, t, r) {
  typeof t == "function" && (r = t, t = {}), r = t.cb || r;
  var n = typeof r == "function" ? r : r.pre || function() {
  }, s = r.post || function() {
  };
  xn(t, n, s, e, "", e);
};
zt.keywords = {
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
zt.arrayKeywords = {
  items: !0,
  allOf: !0,
  anyOf: !0,
  oneOf: !0
};
zt.propsKeywords = {
  $defs: !0,
  definitions: !0,
  properties: !0,
  patternProperties: !0,
  dependencies: !0
};
zt.skipKeywords = {
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
        if (u in zt.arrayKeywords)
          for (var _ = 0; _ < f.length; _++)
            xn(e, t, r, f[_], s + "/" + u + "/" + _, o, s, u, n, _);
      } else if (u in zt.propsKeywords) {
        if (f && typeof f == "object")
          for (var y in f)
            xn(e, t, r, f[y], s + "/" + u + "/" + yh(y), o, s, u, n, y);
      } else (u in zt.keywords || e.allKeys && !(u in zt.skipKeywords)) && xn(e, t, r, f, s + "/" + u, o, s, u, n);
    }
    r(n, s, o, a, i, c, d);
  }
}
function yh(e) {
  return e.replace(/~/g, "~0").replace(/\//g, "~1");
}
var $h = Ml.exports;
Object.defineProperty(Ne, "__esModule", { value: !0 });
Ne.getSchemaRefs = Ne.resolveUrl = Ne.normalizeId = Ne._getFullPath = Ne.getFullPath = Ne.inlineRef = void 0;
const gh = F, _h = Es, vh = $h, Eh = /* @__PURE__ */ new Set([
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
function wh(e, t = !0) {
  return typeof e == "boolean" ? !0 : t === !0 ? !$o(e) : t ? Ll(e) <= t : !1;
}
Ne.inlineRef = wh;
const Sh = /* @__PURE__ */ new Set([
  "$ref",
  "$recursiveRef",
  "$recursiveAnchor",
  "$dynamicRef",
  "$dynamicAnchor"
]);
function $o(e) {
  for (const t in e) {
    if (Sh.has(t))
      return !0;
    const r = e[t];
    if (Array.isArray(r) && r.some($o) || typeof r == "object" && $o(r))
      return !0;
  }
  return !1;
}
function Ll(e) {
  let t = 0;
  for (const r in e) {
    if (r === "$ref")
      return 1 / 0;
    if (t++, !Eh.has(r) && (typeof e[r] == "object" && (0, gh.eachItem)(e[r], (n) => t += Ll(n)), t === 1 / 0))
      return 1 / 0;
  }
  return t;
}
function Fl(e, t = "", r) {
  r !== !1 && (t = Cr(t));
  const n = e.parse(t);
  return Vl(e, n);
}
Ne.getFullPath = Fl;
function Vl(e, t) {
  return e.serialize(t).split("#")[0] + "#";
}
Ne._getFullPath = Vl;
const bh = /#\/?$/;
function Cr(e) {
  return e ? e.replace(bh, "") : "";
}
Ne.normalizeId = Cr;
function Ph(e, t, r) {
  return r = Cr(r), e.resolve(t, r);
}
Ne.resolveUrl = Ph;
const Nh = /^[a-z_][-a-z0-9._]*$/i;
function Rh(e, t) {
  if (typeof e == "boolean")
    return {};
  const { schemaId: r, uriResolver: n } = this.opts, s = Cr(e[r] || t), o = { "": s }, a = Fl(n, s, !1), i = {}, c = /* @__PURE__ */ new Set();
  return vh(e, { allKeys: !0 }, (f, _, y, w) => {
    if (w === void 0)
      return;
    const g = a + _;
    let $ = o[w];
    typeof f[r] == "string" && ($ = p.call(this, f[r])), E.call(this, f.$anchor), E.call(this, f.$dynamicAnchor), o[_] = $;
    function p(N) {
      const R = this.opts.uriResolver.resolve;
      if (N = Cr($ ? R($, N) : N), c.has(N))
        throw u(N);
      c.add(N);
      let T = this.refs[N];
      return typeof T == "string" && (T = this.refs[T]), typeof T == "object" ? d(f, T.schema, N) : N !== Cr(g) && (N[0] === "#" ? (d(f, i[N], N), i[N] = f) : this.refs[N] = g), N;
    }
    function E(N) {
      if (typeof N == "string") {
        if (!Nh.test(N))
          throw new Error(`invalid anchor "${N}"`);
        p.call(this, `#${N}`);
      }
    }
  }), i;
  function d(f, _, y) {
    if (_ !== void 0 && !_h(f, _))
      throw u(y);
  }
  function u(f) {
    return new Error(`reference "${f}" resolves to more than one schema`);
  }
}
Ne.getSchemaRefs = Rh;
Object.defineProperty(ot, "__esModule", { value: !0 });
ot.getData = ot.KeywordCxt = ot.validateFunctionCode = void 0;
const Ul = Lr, Wi = Ee, Ko = Et, is = Ee, Th = vs, cn = mt, Hs = Gt, B = Z, X = We, Oh = Ne, wt = F, Zr = vn;
function Ih(e) {
  if (Gl(e) && (Kl(e), ql(e))) {
    Ch(e);
    return;
  }
  zl(e, () => (0, Ul.topBoolOrEmptySchema)(e));
}
ot.validateFunctionCode = Ih;
function zl({ gen: e, validateName: t, schema: r, schemaEnv: n, opts: s }, o) {
  s.code.es5 ? e.func(t, (0, B._)`${X.default.data}, ${X.default.valCxt}`, n.$async, () => {
    e.code((0, B._)`"use strict"; ${Ji(r, s)}`), Ah(e, s), e.code(o);
  }) : e.func(t, (0, B._)`${X.default.data}, ${jh(s)}`, n.$async, () => e.code(Ji(r, s)).code(o));
}
function jh(e) {
  return (0, B._)`{${X.default.instancePath}="", ${X.default.parentData}, ${X.default.parentDataProperty}, ${X.default.rootData}=${X.default.data}${e.dynamicRef ? (0, B._)`, ${X.default.dynamicAnchors}={}` : B.nil}}={}`;
}
function Ah(e, t) {
  e.if(X.default.valCxt, () => {
    e.var(X.default.instancePath, (0, B._)`${X.default.valCxt}.${X.default.instancePath}`), e.var(X.default.parentData, (0, B._)`${X.default.valCxt}.${X.default.parentData}`), e.var(X.default.parentDataProperty, (0, B._)`${X.default.valCxt}.${X.default.parentDataProperty}`), e.var(X.default.rootData, (0, B._)`${X.default.valCxt}.${X.default.rootData}`), t.dynamicRef && e.var(X.default.dynamicAnchors, (0, B._)`${X.default.valCxt}.${X.default.dynamicAnchors}`);
  }, () => {
    e.var(X.default.instancePath, (0, B._)`""`), e.var(X.default.parentData, (0, B._)`undefined`), e.var(X.default.parentDataProperty, (0, B._)`undefined`), e.var(X.default.rootData, X.default.data), t.dynamicRef && e.var(X.default.dynamicAnchors, (0, B._)`{}`);
  });
}
function Ch(e) {
  const { schema: t, opts: r, gen: n } = e;
  zl(e, () => {
    r.$comment && t.$comment && Bl(e), Fh(e), n.let(X.default.vErrors, null), n.let(X.default.errors, 0), r.unevaluated && kh(e), Hl(e), zh(e);
  });
}
function kh(e) {
  const { gen: t, validateName: r } = e;
  e.evaluated = t.const("evaluated", (0, B._)`${r}.evaluated`), t.if((0, B._)`${e.evaluated}.dynamicProps`, () => t.assign((0, B._)`${e.evaluated}.props`, (0, B._)`undefined`)), t.if((0, B._)`${e.evaluated}.dynamicItems`, () => t.assign((0, B._)`${e.evaluated}.items`, (0, B._)`undefined`));
}
function Ji(e, t) {
  const r = typeof e == "object" && e[t.schemaId];
  return r && (t.code.source || t.code.process) ? (0, B._)`/*# sourceURL=${r} */` : B.nil;
}
function Dh(e, t) {
  if (Gl(e) && (Kl(e), ql(e))) {
    Mh(e, t);
    return;
  }
  (0, Ul.boolOrEmptySchema)(e, t);
}
function ql({ schema: e, self: t }) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (t.RULES.all[r])
      return !0;
  return !1;
}
function Gl(e) {
  return typeof e.schema != "boolean";
}
function Mh(e, t) {
  const { schema: r, gen: n, opts: s } = e;
  s.$comment && r.$comment && Bl(e), Vh(e), Uh(e);
  const o = n.const("_errs", X.default.errors);
  Hl(e, o), n.var(t, (0, B._)`${o} === ${X.default.errors}`);
}
function Kl(e) {
  (0, wt.checkUnknownRules)(e), Lh(e);
}
function Hl(e, t) {
  if (e.opts.jtd)
    return Xi(e, [], !1, t);
  const r = (0, Wi.getSchemaTypes)(e.schema), n = (0, Wi.coerceAndCheckDataType)(e, r);
  Xi(e, r, !n, t);
}
function Lh(e) {
  const { schema: t, errSchemaPath: r, opts: n, self: s } = e;
  t.$ref && n.ignoreKeywordsWithRef && (0, wt.schemaHasRulesButRef)(t, s.RULES) && s.logger.warn(`$ref: keywords ignored in schema at path "${r}"`);
}
function Fh(e) {
  const { schema: t, opts: r } = e;
  t.default !== void 0 && r.useDefaults && r.strictSchema && (0, wt.checkStrictMode)(e, "default is ignored in the schema root");
}
function Vh(e) {
  const t = e.schema[e.opts.schemaId];
  t && (e.baseId = (0, Oh.resolveUrl)(e.opts.uriResolver, e.baseId, t));
}
function Uh(e) {
  if (e.schema.$async && !e.schemaEnv.$async)
    throw new Error("async schema in sync schema");
}
function Bl({ gen: e, schemaEnv: t, schema: r, errSchemaPath: n, opts: s }) {
  const o = r.$comment;
  if (s.$comment === !0)
    e.code((0, B._)`${X.default.self}.logger.log(${o})`);
  else if (typeof s.$comment == "function") {
    const a = (0, B.str)`${n}/$comment`, i = e.scopeValue("root", { ref: t.root });
    e.code((0, B._)`${X.default.self}.opts.$comment(${o}, ${a}, ${i}.schema)`);
  }
}
function zh(e) {
  const { gen: t, schemaEnv: r, validateName: n, ValidationError: s, opts: o } = e;
  r.$async ? t.if((0, B._)`${X.default.errors} === 0`, () => t.return(X.default.data), () => t.throw((0, B._)`new ${s}(${X.default.vErrors})`)) : (t.assign((0, B._)`${n}.errors`, X.default.vErrors), o.unevaluated && qh(e), t.return((0, B._)`${X.default.errors} === 0`));
}
function qh({ gen: e, evaluated: t, props: r, items: n }) {
  r instanceof B.Name && e.assign((0, B._)`${t}.props`, r), n instanceof B.Name && e.assign((0, B._)`${t}.items`, n);
}
function Xi(e, t, r, n) {
  const { gen: s, schema: o, data: a, allErrors: i, opts: c, self: d } = e, { RULES: u } = d;
  if (o.$ref && (c.ignoreKeywordsWithRef || !(0, wt.schemaHasRulesButRef)(o, u))) {
    s.block(() => Xl(e, "$ref", u.all.$ref.definition));
    return;
  }
  c.jtd || Gh(e, t), s.block(() => {
    for (const _ of u.rules)
      f(_);
    f(u.post);
  });
  function f(_) {
    (0, Ko.shouldUseGroup)(o, _) && (_.type ? (s.if((0, is.checkDataType)(_.type, a, c.strictNumbers)), Yi(e, _), t.length === 1 && t[0] === _.type && r && (s.else(), (0, is.reportTypeError)(e)), s.endIf()) : Yi(e, _), i || s.if((0, B._)`${X.default.errors} === ${n || 0}`));
  }
}
function Yi(e, t) {
  const { gen: r, schema: n, opts: { useDefaults: s } } = e;
  s && (0, Th.assignDefaults)(e, t.type), r.block(() => {
    for (const o of t.rules)
      (0, Ko.shouldUseRule)(n, o) && Xl(e, o.keyword, o.definition, t.type);
  });
}
function Gh(e, t) {
  e.schemaEnv.meta || !e.opts.strictTypes || (Kh(e, t), e.opts.allowUnionTypes || Hh(e, t), Bh(e, e.dataTypes));
}
function Kh(e, t) {
  if (t.length) {
    if (!e.dataTypes.length) {
      e.dataTypes = t;
      return;
    }
    t.forEach((r) => {
      Wl(e.dataTypes, r) || Ho(e, `type "${r}" not allowed by context "${e.dataTypes.join(",")}"`);
    }), Jh(e, t);
  }
}
function Hh(e, t) {
  t.length > 1 && !(t.length === 2 && t.includes("null")) && Ho(e, "use allowUnionTypes to allow union type keyword");
}
function Bh(e, t) {
  const r = e.self.RULES.all;
  for (const n in r) {
    const s = r[n];
    if (typeof s == "object" && (0, Ko.shouldUseRule)(e.schema, s)) {
      const { type: o } = s.definition;
      o.length && !o.some((a) => Wh(t, a)) && Ho(e, `missing type "${o.join(",")}" for keyword "${n}"`);
    }
  }
}
function Wh(e, t) {
  return e.includes(t) || t === "number" && e.includes("integer");
}
function Wl(e, t) {
  return e.includes(t) || t === "integer" && e.includes("number");
}
function Jh(e, t) {
  const r = [];
  for (const n of e.dataTypes)
    Wl(t, n) ? r.push(n) : t.includes("integer") && n === "number" && r.push("integer");
  e.dataTypes = r;
}
function Ho(e, t) {
  const r = e.schemaEnv.baseId + e.errSchemaPath;
  t += ` at "${r}" (strictTypes)`, (0, wt.checkStrictMode)(e, t, e.opts.strictTypes);
}
let Jl = class {
  constructor(t, r, n) {
    if ((0, cn.validateKeywordUsage)(t, r, n), this.gen = t.gen, this.allErrors = t.allErrors, this.keyword = n, this.data = t.data, this.schema = t.schema[n], this.$data = r.$data && t.opts.$data && this.schema && this.schema.$data, this.schemaValue = (0, wt.schemaRefOrVal)(t, this.schema, n, this.$data), this.schemaType = r.schemaType, this.parentSchema = t.schema, this.params = {}, this.it = t, this.def = r, this.$data)
      this.schemaCode = t.gen.const("vSchema", Yl(this.$data, t));
    else if (this.schemaCode = this.schemaValue, !(0, cn.validSchemaType)(this.schema, r.schemaType, r.allowUndefined))
      throw new Error(`${n} value must be ${JSON.stringify(r.schemaType)}`);
    ("code" in r ? r.trackErrors : r.errors !== !1) && (this.errsCount = t.gen.const("_errs", X.default.errors));
  }
  result(t, r, n) {
    this.failResult((0, B.not)(t), r, n);
  }
  failResult(t, r, n) {
    this.gen.if(t), n ? n() : this.error(), r ? (this.gen.else(), r(), this.allErrors && this.gen.endIf()) : this.allErrors ? this.gen.endIf() : this.gen.else();
  }
  pass(t, r) {
    this.failResult((0, B.not)(t), void 0, r);
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
    this.fail((0, B._)`${r} !== undefined && (${(0, B.or)(this.invalid$data(), t)})`);
  }
  error(t, r, n) {
    if (r) {
      this.setParams(r), this._error(t, n), this.setParams({});
      return;
    }
    this._error(t, n);
  }
  _error(t, r) {
    (t ? Zr.reportExtraError : Zr.reportError)(this, this.def.error, r);
  }
  $dataError() {
    (0, Zr.reportError)(this, this.def.$dataError || Zr.keyword$DataError);
  }
  reset() {
    if (this.errsCount === void 0)
      throw new Error('add "trackErrors" to keyword definition');
    (0, Zr.resetErrorsCount)(this.gen, this.errsCount);
  }
  ok(t) {
    this.allErrors || this.gen.if(t);
  }
  setParams(t, r) {
    r ? Object.assign(this.params, t) : this.params = t;
  }
  block$data(t, r, n = B.nil) {
    this.gen.block(() => {
      this.check$data(t, n), r();
    });
  }
  check$data(t = B.nil, r = B.nil) {
    if (!this.$data)
      return;
    const { gen: n, schemaCode: s, schemaType: o, def: a } = this;
    n.if((0, B.or)((0, B._)`${s} === undefined`, r)), t !== B.nil && n.assign(t, !0), (o.length || a.validateSchema) && (n.elseIf(this.invalid$data()), this.$dataError(), t !== B.nil && n.assign(t, !1)), n.else();
  }
  invalid$data() {
    const { gen: t, schemaCode: r, schemaType: n, def: s, it: o } = this;
    return (0, B.or)(a(), i());
    function a() {
      if (n.length) {
        if (!(r instanceof B.Name))
          throw new Error("ajv implementation error");
        const c = Array.isArray(n) ? n : [n];
        return (0, B._)`${(0, is.checkDataTypes)(c, r, o.opts.strictNumbers, is.DataType.Wrong)}`;
      }
      return B.nil;
    }
    function i() {
      if (s.validateSchema) {
        const c = t.scopeValue("validate$data", { ref: s.validateSchema });
        return (0, B._)`!${c}(${r})`;
      }
      return B.nil;
    }
  }
  subschema(t, r) {
    const n = (0, Hs.getSubschema)(this.it, t);
    (0, Hs.extendSubschemaData)(n, this.it, t), (0, Hs.extendSubschemaMode)(n, t);
    const s = { ...this.it, ...n, items: void 0, props: void 0 };
    return Dh(s, r), s;
  }
  mergeEvaluated(t, r) {
    const { it: n, gen: s } = this;
    n.opts.unevaluated && (n.props !== !0 && t.props !== void 0 && (n.props = wt.mergeEvaluated.props(s, t.props, n.props, r)), n.items !== !0 && t.items !== void 0 && (n.items = wt.mergeEvaluated.items(s, t.items, n.items, r)));
  }
  mergeValidEvaluated(t, r) {
    const { it: n, gen: s } = this;
    if (n.opts.unevaluated && (n.props !== !0 || n.items !== !0))
      return s.if(r, () => this.mergeEvaluated(t, B.Name)), !0;
  }
};
ot.KeywordCxt = Jl;
function Xl(e, t, r, n) {
  const s = new Jl(e, r, t);
  "code" in r ? r.code(s, n) : s.$data && r.validate ? (0, cn.funcKeywordCode)(s, r) : "macro" in r ? (0, cn.macroKeywordCode)(s, r) : (r.compile || r.validate) && (0, cn.funcKeywordCode)(s, r);
}
const Xh = /^\/(?:[^~]|~0|~1)*$/, Yh = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
function Yl(e, { dataLevel: t, dataNames: r, dataPathArr: n }) {
  let s, o;
  if (e === "")
    return X.default.rootData;
  if (e[0] === "/") {
    if (!Xh.test(e))
      throw new Error(`Invalid JSON-pointer: ${e}`);
    s = e, o = X.default.rootData;
  } else {
    const d = Yh.exec(e);
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
    d && (o = (0, B._)`${o}${(0, B.getProperty)((0, wt.unescapeJsonPointer)(d))}`, a = (0, B._)`${a} && ${o}`);
  return a;
  function c(d, u) {
    return `Cannot access ${d} ${u} levels up, current level is ${t}`;
  }
}
ot.getData = Yl;
var In = {}, xi;
function Bo() {
  if (xi) return In;
  xi = 1, Object.defineProperty(In, "__esModule", { value: !0 });
  class e extends Error {
    constructor(r) {
      super("validation failed"), this.errors = r, this.ajv = this.validation = !0;
    }
  }
  return In.default = e, In;
}
var zr = {};
Object.defineProperty(zr, "__esModule", { value: !0 });
const Bs = Ne;
let xh = class extends Error {
  constructor(t, r, n, s) {
    super(s || `can't resolve reference ${n} from id ${r}`), this.missingRef = (0, Bs.resolveUrl)(t, r, n), this.missingSchema = (0, Bs.normalizeId)((0, Bs.getFullPath)(t, this.missingRef));
  }
};
zr.default = xh;
var Fe = {};
Object.defineProperty(Fe, "__esModule", { value: !0 });
Fe.resolveSchema = Fe.getCompilingSchema = Fe.resolveRef = Fe.compileSchema = Fe.SchemaEnv = void 0;
const Qe = Z, Qh = Bo(), ir = We, nt = Ne, Qi = F, Zh = ot;
let ws = class {
  constructor(t) {
    var r;
    this.refs = {}, this.dynamicAnchors = {};
    let n;
    typeof t.schema == "object" && (n = t.schema), this.schema = t.schema, this.schemaId = t.schemaId, this.root = t.root || this, this.baseId = (r = t.baseId) !== null && r !== void 0 ? r : (0, nt.normalizeId)(n == null ? void 0 : n[t.schemaId || "$id"]), this.schemaPath = t.schemaPath, this.localRefs = t.localRefs, this.meta = t.meta, this.$async = n == null ? void 0 : n.$async, this.refs = {};
  }
};
Fe.SchemaEnv = ws;
function Wo(e) {
  const t = xl.call(this, e);
  if (t)
    return t;
  const r = (0, nt.getFullPath)(this.opts.uriResolver, e.root.baseId), { es5: n, lines: s } = this.opts.code, { ownProperties: o } = this.opts, a = new Qe.CodeGen(this.scope, { es5: n, lines: s, ownProperties: o });
  let i;
  e.$async && (i = a.scopeValue("Error", {
    ref: Qh.default,
    code: (0, Qe._)`require("ajv/dist/runtime/validation_error").default`
  }));
  const c = a.scopeName("validate");
  e.validateName = c;
  const d = {
    gen: a,
    allErrors: this.opts.allErrors,
    data: ir.default.data,
    parentData: ir.default.parentData,
    parentDataProperty: ir.default.parentDataProperty,
    dataNames: [ir.default.data],
    dataPathArr: [Qe.nil],
    // TODO can its length be used as dataLevel if nil is removed?
    dataLevel: 0,
    dataTypes: [],
    definedProperties: /* @__PURE__ */ new Set(),
    topSchemaRef: a.scopeValue("schema", this.opts.code.source === !0 ? { ref: e.schema, code: (0, Qe.stringify)(e.schema) } : { ref: e.schema }),
    validateName: c,
    ValidationError: i,
    schema: e.schema,
    schemaEnv: e,
    rootId: r,
    baseId: e.baseId || r,
    schemaPath: Qe.nil,
    errSchemaPath: e.schemaPath || (this.opts.jtd ? "" : "#"),
    errorPath: (0, Qe._)`""`,
    opts: this.opts,
    self: this
  };
  let u;
  try {
    this._compilations.add(e), (0, Zh.validateFunctionCode)(d), a.optimize(this.opts.code.optimize);
    const f = a.toString();
    u = `${a.scopeRefs(ir.default.scope)}return ${f}`, this.opts.code.process && (u = this.opts.code.process(u, e));
    const y = new Function(`${ir.default.self}`, `${ir.default.scope}`, u)(this, this.scope.get());
    if (this.scope.value(c, { ref: y }), y.errors = null, y.schema = e.schema, y.schemaEnv = e, e.$async && (y.$async = !0), this.opts.code.source === !0 && (y.source = { validateName: c, validateCode: f, scopeValues: a._values }), this.opts.unevaluated) {
      const { props: w, items: g } = d;
      y.evaluated = {
        props: w instanceof Qe.Name ? void 0 : w,
        items: g instanceof Qe.Name ? void 0 : g,
        dynamicProps: w instanceof Qe.Name,
        dynamicItems: g instanceof Qe.Name
      }, y.source && (y.source.evaluated = (0, Qe.stringify)(y.evaluated));
    }
    return e.validate = y, e;
  } catch (f) {
    throw delete e.validate, delete e.validateName, u && this.logger.error("Error compiling schema, function code:", u), f;
  } finally {
    this._compilations.delete(e);
  }
}
Fe.compileSchema = Wo;
function ep(e, t, r) {
  var n;
  r = (0, nt.resolveUrl)(this.opts.uriResolver, t, r);
  const s = e.refs[r];
  if (s)
    return s;
  let o = np.call(this, e, r);
  if (o === void 0) {
    const a = (n = e.localRefs) === null || n === void 0 ? void 0 : n[r], { schemaId: i } = this.opts;
    a && (o = new ws({ schema: a, schemaId: i, root: e, baseId: t }));
  }
  if (o !== void 0)
    return e.refs[r] = tp.call(this, o);
}
Fe.resolveRef = ep;
function tp(e) {
  return (0, nt.inlineRef)(e.schema, this.opts.inlineRefs) ? e.schema : e.validate ? e : Wo.call(this, e);
}
function xl(e) {
  for (const t of this._compilations)
    if (rp(t, e))
      return t;
}
Fe.getCompilingSchema = xl;
function rp(e, t) {
  return e.schema === t.schema && e.root === t.root && e.baseId === t.baseId;
}
function np(e, t) {
  let r;
  for (; typeof (r = this.refs[t]) == "string"; )
    t = r;
  return r || this.schemas[t] || Ss.call(this, e, t);
}
function Ss(e, t) {
  const r = this.opts.uriResolver.parse(t), n = (0, nt._getFullPath)(this.opts.uriResolver, r);
  let s = (0, nt.getFullPath)(this.opts.uriResolver, e.baseId, void 0);
  if (Object.keys(e.schema).length > 0 && n === s)
    return Ws.call(this, r, e);
  const o = (0, nt.normalizeId)(n), a = this.refs[o] || this.schemas[o];
  if (typeof a == "string") {
    const i = Ss.call(this, e, a);
    return typeof (i == null ? void 0 : i.schema) != "object" ? void 0 : Ws.call(this, r, i);
  }
  if (typeof (a == null ? void 0 : a.schema) == "object") {
    if (a.validate || Wo.call(this, a), o === (0, nt.normalizeId)(t)) {
      const { schema: i } = a, { schemaId: c } = this.opts, d = i[c];
      return d && (s = (0, nt.resolveUrl)(this.opts.uriResolver, s, d)), new ws({ schema: i, schemaId: c, root: e, baseId: s });
    }
    return Ws.call(this, r, a);
  }
}
Fe.resolveSchema = Ss;
const sp = /* @__PURE__ */ new Set([
  "properties",
  "patternProperties",
  "enum",
  "dependencies",
  "definitions"
]);
function Ws(e, { baseId: t, schema: r, root: n }) {
  var s;
  if (((s = e.fragment) === null || s === void 0 ? void 0 : s[0]) !== "/")
    return;
  for (const i of e.fragment.slice(1).split("/")) {
    if (typeof r == "boolean")
      return;
    const c = r[(0, Qi.unescapeFragment)(i)];
    if (c === void 0)
      return;
    r = c;
    const d = typeof r == "object" && r[this.opts.schemaId];
    !sp.has(i) && d && (t = (0, nt.resolveUrl)(this.opts.uriResolver, t, d));
  }
  let o;
  if (typeof r != "boolean" && r.$ref && !(0, Qi.schemaHasRulesButRef)(r, this.RULES)) {
    const i = (0, nt.resolveUrl)(this.opts.uriResolver, t, r.$ref);
    o = Ss.call(this, n, i);
  }
  const { schemaId: a } = this.opts;
  if (o = o || new ws({ schema: r, schemaId: a, root: n, baseId: t }), o.schema !== o.root.schema)
    return o;
}
const op = "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#", ap = "Meta-schema for $data reference (JSON AnySchema extension proposal)", ip = "object", cp = [
  "$data"
], lp = {
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
}, up = !1, dp = {
  $id: op,
  description: ap,
  type: ip,
  required: cp,
  properties: lp,
  additionalProperties: up
};
var Jo = {}, bs = { exports: {} };
const fp = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu), Ql = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
function Zl(e) {
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
const hp = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
function Zi(e) {
  return e.length = 0, !0;
}
function pp(e, t, r) {
  if (e.length) {
    const n = Zl(e);
    if (n !== "")
      t.push(n);
    else
      return r.error = !0, !1;
    e.length = 0;
  }
  return !0;
}
function mp(e) {
  let t = 0;
  const r = { error: !1, address: "", zone: "" }, n = [], s = [];
  let o = !1, a = !1, i = pp;
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
        i = Zi;
      } else {
        s.push(d);
        continue;
      }
  }
  return s.length && (i === Zi ? r.zone = s.join("") : a ? n.push(s.join("")) : n.push(Zl(s))), r.address = n.join(""), r;
}
function eu(e) {
  if (yp(e, ":") < 2)
    return { host: e, isIPV6: !1 };
  const t = mp(e);
  if (t.error)
    return { host: e, isIPV6: !1 };
  {
    let r = t.address, n = t.address;
    return t.zone && (r += "%" + t.zone, n += "%25" + t.zone), { host: r, isIPV6: !0, escapedHost: n };
  }
}
function yp(e, t) {
  let r = 0;
  for (let n = 0; n < e.length; n++)
    e[n] === t && r++;
  return r;
}
function $p(e) {
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
function gp(e, t) {
  const r = t !== !0 ? escape : unescape;
  return e.scheme !== void 0 && (e.scheme = r(e.scheme)), e.userinfo !== void 0 && (e.userinfo = r(e.userinfo)), e.host !== void 0 && (e.host = r(e.host)), e.path !== void 0 && (e.path = r(e.path)), e.query !== void 0 && (e.query = r(e.query)), e.fragment !== void 0 && (e.fragment = r(e.fragment)), e;
}
function _p(e) {
  const t = [];
  if (e.userinfo !== void 0 && (t.push(e.userinfo), t.push("@")), e.host !== void 0) {
    let r = unescape(e.host);
    if (!Ql(r)) {
      const n = eu(r);
      n.isIPV6 === !0 ? r = `[${n.escapedHost}]` : r = e.host;
    }
    t.push(r);
  }
  return (typeof e.port == "number" || typeof e.port == "string") && (t.push(":"), t.push(String(e.port))), t.length ? t.join("") : void 0;
}
var tu = {
  nonSimpleDomain: hp,
  recomposeAuthority: _p,
  normalizeComponentEncoding: gp,
  removeDotSegments: $p,
  isIPv4: Ql,
  isUUID: fp,
  normalizeIPv6: eu
};
const { isUUID: vp } = tu, Ep = /([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-.:;=@]|%[\da-f]{2})+)/iu;
function ru(e) {
  return e.secure === !0 ? !0 : e.secure === !1 ? !1 : e.scheme ? e.scheme.length === 3 && (e.scheme[0] === "w" || e.scheme[0] === "W") && (e.scheme[1] === "s" || e.scheme[1] === "S") && (e.scheme[2] === "s" || e.scheme[2] === "S") : !1;
}
function nu(e) {
  return e.host || (e.error = e.error || "HTTP URIs must have a host."), e;
}
function su(e) {
  const t = String(e.scheme).toLowerCase() === "https";
  return (e.port === (t ? 443 : 80) || e.port === "") && (e.port = void 0), e.path || (e.path = "/"), e;
}
function wp(e) {
  return e.secure = ru(e), e.resourceName = (e.path || "/") + (e.query ? "?" + e.query : ""), e.path = void 0, e.query = void 0, e;
}
function Sp(e) {
  if ((e.port === (ru(e) ? 443 : 80) || e.port === "") && (e.port = void 0), typeof e.secure == "boolean" && (e.scheme = e.secure ? "wss" : "ws", e.secure = void 0), e.resourceName) {
    const [t, r] = e.resourceName.split("?");
    e.path = t && t !== "/" ? t : void 0, e.query = r, e.resourceName = void 0;
  }
  return e.fragment = void 0, e;
}
function bp(e, t) {
  if (!e.path)
    return e.error = "URN can not be parsed", e;
  const r = e.path.match(Ep);
  if (r) {
    const n = t.scheme || e.scheme || "urn";
    e.nid = r[1].toLowerCase(), e.nss = r[2];
    const s = `${n}:${t.nid || e.nid}`, o = Xo(s);
    e.path = void 0, o && (e = o.parse(e, t));
  } else
    e.error = e.error || "URN can not be parsed.";
  return e;
}
function Pp(e, t) {
  if (e.nid === void 0)
    throw new Error("URN without nid cannot be serialized");
  const r = t.scheme || e.scheme || "urn", n = e.nid.toLowerCase(), s = `${r}:${t.nid || n}`, o = Xo(s);
  o && (e = o.serialize(e, t));
  const a = e, i = e.nss;
  return a.path = `${n || t.nid}:${i}`, t.skipEscape = !0, a;
}
function Np(e, t) {
  const r = e;
  return r.uuid = r.nss, r.nss = void 0, !t.tolerant && (!r.uuid || !vp(r.uuid)) && (r.error = r.error || "UUID is not valid."), r;
}
function Rp(e) {
  const t = e;
  return t.nss = (e.uuid || "").toLowerCase(), t;
}
const ou = (
  /** @type {SchemeHandler} */
  {
    scheme: "http",
    domainHost: !0,
    parse: nu,
    serialize: su
  }
), Tp = (
  /** @type {SchemeHandler} */
  {
    scheme: "https",
    domainHost: ou.domainHost,
    parse: nu,
    serialize: su
  }
), Qn = (
  /** @type {SchemeHandler} */
  {
    scheme: "ws",
    domainHost: !0,
    parse: wp,
    serialize: Sp
  }
), Op = (
  /** @type {SchemeHandler} */
  {
    scheme: "wss",
    domainHost: Qn.domainHost,
    parse: Qn.parse,
    serialize: Qn.serialize
  }
), Ip = (
  /** @type {SchemeHandler} */
  {
    scheme: "urn",
    parse: bp,
    serialize: Pp,
    skipNormalize: !0
  }
), jp = (
  /** @type {SchemeHandler} */
  {
    scheme: "urn:uuid",
    parse: Np,
    serialize: Rp,
    skipNormalize: !0
  }
), cs = (
  /** @type {Record<SchemeName, SchemeHandler>} */
  {
    http: ou,
    https: Tp,
    ws: Qn,
    wss: Op,
    urn: Ip,
    "urn:uuid": jp
  }
);
Object.setPrototypeOf(cs, null);
function Xo(e) {
  return e && (cs[
    /** @type {SchemeName} */
    e
  ] || cs[
    /** @type {SchemeName} */
    e.toLowerCase()
  ]) || void 0;
}
var Ap = {
  SCHEMES: cs,
  getSchemeHandler: Xo
};
const { normalizeIPv6: Cp, removeDotSegments: sn, recomposeAuthority: kp, normalizeComponentEncoding: jn, isIPv4: Dp, nonSimpleDomain: Mp } = tu, { SCHEMES: Lp, getSchemeHandler: au } = Ap;
function Fp(e, t) {
  return typeof e == "string" ? e = /** @type {T} */
  yt(Nt(e, t), t) : typeof e == "object" && (e = /** @type {T} */
  Nt(yt(e, t), t)), e;
}
function Vp(e, t, r) {
  const n = r ? Object.assign({ scheme: "null" }, r) : { scheme: "null" }, s = iu(Nt(e, n), Nt(t, n), n, !0);
  return n.skipEscape = !0, yt(s, n);
}
function iu(e, t, r, n) {
  const s = {};
  return n || (e = Nt(yt(e, r), r), t = Nt(yt(t, r), r)), r = r || {}, !r.tolerant && t.scheme ? (s.scheme = t.scheme, s.userinfo = t.userinfo, s.host = t.host, s.port = t.port, s.path = sn(t.path || ""), s.query = t.query) : (t.userinfo !== void 0 || t.host !== void 0 || t.port !== void 0 ? (s.userinfo = t.userinfo, s.host = t.host, s.port = t.port, s.path = sn(t.path || ""), s.query = t.query) : (t.path ? (t.path[0] === "/" ? s.path = sn(t.path) : ((e.userinfo !== void 0 || e.host !== void 0 || e.port !== void 0) && !e.path ? s.path = "/" + t.path : e.path ? s.path = e.path.slice(0, e.path.lastIndexOf("/") + 1) + t.path : s.path = t.path, s.path = sn(s.path)), s.query = t.query) : (s.path = e.path, t.query !== void 0 ? s.query = t.query : s.query = e.query), s.userinfo = e.userinfo, s.host = e.host, s.port = e.port), s.scheme = e.scheme), s.fragment = t.fragment, s;
}
function Up(e, t, r) {
  return typeof e == "string" ? (e = unescape(e), e = yt(jn(Nt(e, r), !0), { ...r, skipEscape: !0 })) : typeof e == "object" && (e = yt(jn(e, !0), { ...r, skipEscape: !0 })), typeof t == "string" ? (t = unescape(t), t = yt(jn(Nt(t, r), !0), { ...r, skipEscape: !0 })) : typeof t == "object" && (t = yt(jn(t, !0), { ...r, skipEscape: !0 })), e.toLowerCase() === t.toLowerCase();
}
function yt(e, t) {
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
  }, n = Object.assign({}, t), s = [], o = au(n.scheme || r.scheme);
  o && o.serialize && o.serialize(r, n), r.path !== void 0 && (n.skipEscape ? r.path = unescape(r.path) : (r.path = escape(r.path), r.scheme !== void 0 && (r.path = r.path.split("%3A").join(":")))), n.reference !== "suffix" && r.scheme && s.push(r.scheme, ":");
  const a = kp(r);
  if (a !== void 0 && (n.reference !== "suffix" && s.push("//"), s.push(a), r.path && r.path[0] !== "/" && s.push("/")), r.path !== void 0) {
    let i = r.path;
    !n.absolutePath && (!o || !o.absolutePath) && (i = sn(i)), a === void 0 && i[0] === "/" && i[1] === "/" && (i = "/%2F" + i.slice(2)), s.push(i);
  }
  return r.query !== void 0 && s.push("?", r.query), r.fragment !== void 0 && s.push("#", r.fragment), s.join("");
}
const zp = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
function Nt(e, t) {
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
  const o = e.match(zp);
  if (o) {
    if (n.scheme = o[1], n.userinfo = o[3], n.host = o[4], n.port = parseInt(o[5], 10), n.path = o[6] || "", n.query = o[7], n.fragment = o[8], isNaN(n.port) && (n.port = o[5]), n.host)
      if (Dp(n.host) === !1) {
        const c = Cp(n.host);
        n.host = c.host.toLowerCase(), s = c.isIPV6;
      } else
        s = !0;
    n.scheme === void 0 && n.userinfo === void 0 && n.host === void 0 && n.port === void 0 && n.query === void 0 && !n.path ? n.reference = "same-document" : n.scheme === void 0 ? n.reference = "relative" : n.fragment === void 0 ? n.reference = "absolute" : n.reference = "uri", r.reference && r.reference !== "suffix" && r.reference !== n.reference && (n.error = n.error || "URI is not a " + r.reference + " reference.");
    const a = au(r.scheme || n.scheme);
    if (!r.unicodeSupport && (!a || !a.unicodeSupport) && n.host && (r.domainHost || a && a.domainHost) && s === !1 && Mp(n.host))
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
const Yo = {
  SCHEMES: Lp,
  normalize: Fp,
  resolve: Vp,
  resolveComponent: iu,
  equal: Up,
  serialize: yt,
  parse: Nt
};
bs.exports = Yo;
bs.exports.default = Yo;
bs.exports.fastUri = Yo;
var cu = bs.exports;
Object.defineProperty(Jo, "__esModule", { value: !0 });
const lu = cu;
lu.code = 'require("ajv/dist/runtime/uri").default';
Jo.default = lu;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.CodeGen = e.Name = e.nil = e.stringify = e.str = e._ = e.KeywordCxt = void 0;
  var t = ot;
  Object.defineProperty(e, "KeywordCxt", { enumerable: !0, get: function() {
    return t.KeywordCxt;
  } });
  var r = Z;
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
  const n = Bo(), s = zr, o = _r, a = Fe, i = Z, c = Ne, d = Ee, u = F, f = dp, _ = Jo, y = (P, m) => new RegExp(P, m);
  y.code = "new RegExp";
  const w = ["removeAdditional", "useDefaults", "coerceTypes"], g = /* @__PURE__ */ new Set([
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
  ]), $ = {
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
  }, E = 200;
  function N(P) {
    var m, S, v, l, h, b, I, j, H, K, ie, Ke, Ht, Bt, Wt, Jt, Xt, Yt, xt, Qt, Zt, er, tr, rr, nr;
    const xe = P.strict, sr = (m = P.code) === null || m === void 0 ? void 0 : m.optimize, Yr = sr === !0 || sr === void 0 ? 1 : sr || 0, xr = (v = (S = P.code) === null || S === void 0 ? void 0 : S.regExp) !== null && v !== void 0 ? v : y, Vs = (l = P.uriResolver) !== null && l !== void 0 ? l : _.default;
    return {
      strictSchema: (b = (h = P.strictSchema) !== null && h !== void 0 ? h : xe) !== null && b !== void 0 ? b : !0,
      strictNumbers: (j = (I = P.strictNumbers) !== null && I !== void 0 ? I : xe) !== null && j !== void 0 ? j : !0,
      strictTypes: (K = (H = P.strictTypes) !== null && H !== void 0 ? H : xe) !== null && K !== void 0 ? K : "log",
      strictTuples: (Ke = (ie = P.strictTuples) !== null && ie !== void 0 ? ie : xe) !== null && Ke !== void 0 ? Ke : "log",
      strictRequired: (Bt = (Ht = P.strictRequired) !== null && Ht !== void 0 ? Ht : xe) !== null && Bt !== void 0 ? Bt : !1,
      code: P.code ? { ...P.code, optimize: Yr, regExp: xr } : { optimize: Yr, regExp: xr },
      loopRequired: (Wt = P.loopRequired) !== null && Wt !== void 0 ? Wt : E,
      loopEnum: (Jt = P.loopEnum) !== null && Jt !== void 0 ? Jt : E,
      meta: (Xt = P.meta) !== null && Xt !== void 0 ? Xt : !0,
      messages: (Yt = P.messages) !== null && Yt !== void 0 ? Yt : !0,
      inlineRefs: (xt = P.inlineRefs) !== null && xt !== void 0 ? xt : !0,
      schemaId: (Qt = P.schemaId) !== null && Qt !== void 0 ? Qt : "$id",
      addUsedSchema: (Zt = P.addUsedSchema) !== null && Zt !== void 0 ? Zt : !0,
      validateSchema: (er = P.validateSchema) !== null && er !== void 0 ? er : !0,
      validateFormats: (tr = P.validateFormats) !== null && tr !== void 0 ? tr : !0,
      unicodeRegExp: (rr = P.unicodeRegExp) !== null && rr !== void 0 ? rr : !0,
      int32range: (nr = P.int32range) !== null && nr !== void 0 ? nr : !0,
      uriResolver: Vs
    };
  }
  class R {
    constructor(m = {}) {
      this.schemas = {}, this.refs = {}, this.formats = {}, this._compilations = /* @__PURE__ */ new Set(), this._loading = {}, this._cache = /* @__PURE__ */ new Map(), m = this.opts = { ...m, ...N(m) };
      const { es5: S, lines: v } = this.opts.code;
      this.scope = new i.ValueScope({ scope: {}, prefixes: g, es5: S, lines: v }), this.logger = z(m.logger);
      const l = m.validateFormats;
      m.validateFormats = !1, this.RULES = (0, o.getRules)(), T.call(this, $, m, "NOT SUPPORTED"), T.call(this, p, m, "DEPRECATED", "warn"), this._metaOpts = me.call(this), m.formats && ce.call(this), this._addVocabularies(), this._addDefaultMetaSchema(), m.keywords && le.call(this, m.keywords), typeof m.meta == "object" && this.addMetaSchema(m.meta), k.call(this), m.validateFormats = l;
    }
    _addVocabularies() {
      this.addKeyword("$async");
    }
    _addDefaultMetaSchema() {
      const { $data: m, meta: S, schemaId: v } = this.opts;
      let l = f;
      v === "id" && (l = { ...f }, l.id = l.$id, delete l.$id), S && m && this.addMetaSchema(l, l[v], !1);
    }
    defaultMeta() {
      const { meta: m, schemaId: S } = this.opts;
      return this.opts.defaultMeta = typeof m == "object" ? m[S] || m : void 0;
    }
    validate(m, S) {
      let v;
      if (typeof m == "string") {
        if (v = this.getSchema(m), !v)
          throw new Error(`no schema with key or ref "${m}"`);
      } else
        v = this.compile(m);
      const l = v(S);
      return "$async" in v || (this.errors = v.errors), l;
    }
    compile(m, S) {
      const v = this._addSchema(m, S);
      return v.validate || this._compileSchemaEnv(v);
    }
    compileAsync(m, S) {
      if (typeof this.opts.loadSchema != "function")
        throw new Error("options.loadSchema should be a function");
      const { loadSchema: v } = this.opts;
      return l.call(this, m, S);
      async function l(K, ie) {
        await h.call(this, K.$schema);
        const Ke = this._addSchema(K, ie);
        return Ke.validate || b.call(this, Ke);
      }
      async function h(K) {
        K && !this.getSchema(K) && await l.call(this, { $ref: K }, !0);
      }
      async function b(K) {
        try {
          return this._compileSchemaEnv(K);
        } catch (ie) {
          if (!(ie instanceof s.default))
            throw ie;
          return I.call(this, ie), await j.call(this, ie.missingSchema), b.call(this, K);
        }
      }
      function I({ missingSchema: K, missingRef: ie }) {
        if (this.refs[K])
          throw new Error(`AnySchema ${K} is loaded but ${ie} cannot be resolved`);
      }
      async function j(K) {
        const ie = await H.call(this, K);
        this.refs[K] || await h.call(this, ie.$schema), this.refs[K] || this.addSchema(ie, K, S);
      }
      async function H(K) {
        const ie = this._loading[K];
        if (ie)
          return ie;
        try {
          return await (this._loading[K] = v(K));
        } finally {
          delete this._loading[K];
        }
      }
    }
    // Adds schema to the instance
    addSchema(m, S, v, l = this.opts.validateSchema) {
      if (Array.isArray(m)) {
        for (const b of m)
          this.addSchema(b, void 0, v, l);
        return this;
      }
      let h;
      if (typeof m == "object") {
        const { schemaId: b } = this.opts;
        if (h = m[b], h !== void 0 && typeof h != "string")
          throw new Error(`schema ${b} must be string`);
      }
      return S = (0, c.normalizeId)(S || h), this._checkUnique(S), this.schemas[S] = this._addSchema(m, v, S, l, !0), this;
    }
    // Add schema that will be used to validate other schemas
    // options in META_IGNORE_OPTIONS are alway set to false
    addMetaSchema(m, S, v = this.opts.validateSchema) {
      return this.addSchema(m, S, !0, v), this;
    }
    //  Validate schema against its meta-schema
    validateSchema(m, S) {
      if (typeof m == "boolean")
        return !0;
      let v;
      if (v = m.$schema, v !== void 0 && typeof v != "string")
        throw new Error("$schema must be a string");
      if (v = v || this.opts.defaultMeta || this.defaultMeta(), !v)
        return this.logger.warn("meta-schema not available"), this.errors = null, !0;
      const l = this.validate(v, m);
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
    getSchema(m) {
      let S;
      for (; typeof (S = C.call(this, m)) == "string"; )
        m = S;
      if (S === void 0) {
        const { schemaId: v } = this.opts, l = new a.SchemaEnv({ schema: {}, schemaId: v });
        if (S = a.resolveSchema.call(this, l, m), !S)
          return;
        this.refs[m] = S;
      }
      return S.validate || this._compileSchemaEnv(S);
    }
    // Remove cached schema(s).
    // If no parameter is passed all schemas but meta-schemas are removed.
    // If RegExp is passed all schemas with key/id matching pattern but meta-schemas are removed.
    // Even if schema is referenced by other schemas it still can be removed as other schemas have local references.
    removeSchema(m) {
      if (m instanceof RegExp)
        return this._removeAllSchemas(this.schemas, m), this._removeAllSchemas(this.refs, m), this;
      switch (typeof m) {
        case "undefined":
          return this._removeAllSchemas(this.schemas), this._removeAllSchemas(this.refs), this._cache.clear(), this;
        case "string": {
          const S = C.call(this, m);
          return typeof S == "object" && this._cache.delete(S.schema), delete this.schemas[m], delete this.refs[m], this;
        }
        case "object": {
          const S = m;
          this._cache.delete(S);
          let v = m[this.opts.schemaId];
          return v && (v = (0, c.normalizeId)(v), delete this.schemas[v], delete this.refs[v]), this;
        }
        default:
          throw new Error("ajv.removeSchema: invalid parameter");
      }
    }
    // add "vocabulary" - a collection of keywords
    addVocabulary(m) {
      for (const S of m)
        this.addKeyword(S);
      return this;
    }
    addKeyword(m, S) {
      let v;
      if (typeof m == "string")
        v = m, typeof S == "object" && (this.logger.warn("these parameters are deprecated, see docs for addKeyword"), S.keyword = v);
      else if (typeof m == "object" && S === void 0) {
        if (S = m, v = S.keyword, Array.isArray(v) && !v.length)
          throw new Error("addKeywords: keyword must be string or non-empty array");
      } else
        throw new Error("invalid addKeywords parameters");
      if (O.call(this, v, S), !S)
        return (0, u.eachItem)(v, (h) => A.call(this, h)), this;
      D.call(this, S);
      const l = {
        ...S,
        type: (0, d.getJSONTypes)(S.type),
        schemaType: (0, d.getJSONTypes)(S.schemaType)
      };
      return (0, u.eachItem)(v, l.type.length === 0 ? (h) => A.call(this, h, l) : (h) => l.type.forEach((b) => A.call(this, h, l, b))), this;
    }
    getKeyword(m) {
      const S = this.RULES.all[m];
      return typeof S == "object" ? S.definition : !!S;
    }
    // Remove keyword
    removeKeyword(m) {
      const { RULES: S } = this;
      delete S.keywords[m], delete S.all[m];
      for (const v of S.rules) {
        const l = v.rules.findIndex((h) => h.keyword === m);
        l >= 0 && v.rules.splice(l, 1);
      }
      return this;
    }
    // Add format
    addFormat(m, S) {
      return typeof S == "string" && (S = new RegExp(S)), this.formats[m] = S, this;
    }
    errorsText(m = this.errors, { separator: S = ", ", dataVar: v = "data" } = {}) {
      return !m || m.length === 0 ? "No errors" : m.map((l) => `${v}${l.instancePath} ${l.message}`).reduce((l, h) => l + S + h);
    }
    $dataMetaSchema(m, S) {
      const v = this.RULES.all;
      m = JSON.parse(JSON.stringify(m));
      for (const l of S) {
        const h = l.split("/").slice(1);
        let b = m;
        for (const I of h)
          b = b[I];
        for (const I in v) {
          const j = v[I];
          if (typeof j != "object")
            continue;
          const { $data: H } = j.definition, K = b[I];
          H && K && (b[I] = M(K));
        }
      }
      return m;
    }
    _removeAllSchemas(m, S) {
      for (const v in m) {
        const l = m[v];
        (!S || S.test(v)) && (typeof l == "string" ? delete m[v] : l && !l.meta && (this._cache.delete(l.schema), delete m[v]));
      }
    }
    _addSchema(m, S, v, l = this.opts.validateSchema, h = this.opts.addUsedSchema) {
      let b;
      const { schemaId: I } = this.opts;
      if (typeof m == "object")
        b = m[I];
      else {
        if (this.opts.jtd)
          throw new Error("schema must be object");
        if (typeof m != "boolean")
          throw new Error("schema must be object or boolean");
      }
      let j = this._cache.get(m);
      if (j !== void 0)
        return j;
      v = (0, c.normalizeId)(b || v);
      const H = c.getSchemaRefs.call(this, m, v);
      return j = new a.SchemaEnv({ schema: m, schemaId: I, meta: S, baseId: v, localRefs: H }), this._cache.set(j.schema, j), h && !v.startsWith("#") && (v && this._checkUnique(v), this.refs[v] = j), l && this.validateSchema(m, !0), j;
    }
    _checkUnique(m) {
      if (this.schemas[m] || this.refs[m])
        throw new Error(`schema with key or id "${m}" already exists`);
    }
    _compileSchemaEnv(m) {
      if (m.meta ? this._compileMetaSchema(m) : a.compileSchema.call(this, m), !m.validate)
        throw new Error("ajv implementation error");
      return m.validate;
    }
    _compileMetaSchema(m) {
      const S = this.opts;
      this.opts = this._metaOpts;
      try {
        a.compileSchema.call(this, m);
      } finally {
        this.opts = S;
      }
    }
  }
  R.ValidationError = n.default, R.MissingRefError = s.default, e.default = R;
  function T(P, m, S, v = "error") {
    for (const l in P) {
      const h = l;
      h in m && this.logger[v](`${S}: option ${l}. ${P[h]}`);
    }
  }
  function C(P) {
    return P = (0, c.normalizeId)(P), this.schemas[P] || this.refs[P];
  }
  function k() {
    const P = this.opts.schemas;
    if (P)
      if (Array.isArray(P))
        this.addSchema(P);
      else
        for (const m in P)
          this.addSchema(P[m], m);
  }
  function ce() {
    for (const P in this.opts.formats) {
      const m = this.opts.formats[P];
      m && this.addFormat(P, m);
    }
  }
  function le(P) {
    if (Array.isArray(P)) {
      this.addVocabulary(P);
      return;
    }
    this.logger.warn("keywords option as map is deprecated, pass array");
    for (const m in P) {
      const S = P[m];
      S.keyword || (S.keyword = m), this.addKeyword(S);
    }
  }
  function me() {
    const P = { ...this.opts };
    for (const m of w)
      delete P[m];
    return P;
  }
  const L = { log() {
  }, warn() {
  }, error() {
  } };
  function z(P) {
    if (P === !1)
      return L;
    if (P === void 0)
      return console;
    if (P.log && P.warn && P.error)
      return P;
    throw new Error("logger must implement log, warn and error methods");
  }
  const ae = /^[a-z_$][a-z0-9_$:-]*$/i;
  function O(P, m) {
    const { RULES: S } = this;
    if ((0, u.eachItem)(P, (v) => {
      if (S.keywords[v])
        throw new Error(`Keyword ${v} is already defined`);
      if (!ae.test(v))
        throw new Error(`Keyword ${v} has invalid name`);
    }), !!m && m.$data && !("code" in m || "validate" in m))
      throw new Error('$data keyword must have "code" or "validate" function');
  }
  function A(P, m, S) {
    var v;
    const l = m == null ? void 0 : m.post;
    if (S && l)
      throw new Error('keyword with "post" flag cannot have "type"');
    const { RULES: h } = this;
    let b = l ? h.post : h.rules.find(({ type: j }) => j === S);
    if (b || (b = { type: S, rules: [] }, h.rules.push(b)), h.keywords[P] = !0, !m)
      return;
    const I = {
      keyword: P,
      definition: {
        ...m,
        type: (0, d.getJSONTypes)(m.type),
        schemaType: (0, d.getJSONTypes)(m.schemaType)
      }
    };
    m.before ? V.call(this, b, I, m.before) : b.rules.push(I), h.all[P] = I, (v = m.implements) === null || v === void 0 || v.forEach((j) => this.addKeyword(j));
  }
  function V(P, m, S) {
    const v = P.rules.findIndex((l) => l.keyword === S);
    v >= 0 ? P.rules.splice(v, 0, m) : (P.rules.push(m), this.logger.warn(`rule ${S} is not defined`));
  }
  function D(P) {
    let { metaSchema: m } = P;
    m !== void 0 && (P.$data && this.opts.$data && (m = M(m)), P.validateSchema = this.compile(m, !0));
  }
  const G = {
    $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
  };
  function M(P) {
    return { anyOf: [P, G] };
  }
})(vl);
var xo = {}, Qo = {}, Zo = {};
Object.defineProperty(Zo, "__esModule", { value: !0 });
const qp = {
  keyword: "id",
  code() {
    throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
  }
};
Zo.default = qp;
var Rt = {};
Object.defineProperty(Rt, "__esModule", { value: !0 });
Rt.callRef = Rt.getValidate = void 0;
const Gp = zr, ec = se, ze = Z, Sr = We, tc = Fe, An = F, Kp = {
  keyword: "$ref",
  schemaType: "string",
  code(e) {
    const { gen: t, schema: r, it: n } = e, { baseId: s, schemaEnv: o, validateName: a, opts: i, self: c } = n, { root: d } = o;
    if ((r === "#" || r === "#/") && s === d.baseId)
      return f();
    const u = tc.resolveRef.call(c, d, s, r);
    if (u === void 0)
      throw new Gp.default(n.opts.uriResolver, s, r);
    if (u instanceof tc.SchemaEnv)
      return _(u);
    return y(u);
    function f() {
      if (o === d)
        return Zn(e, a, o, o.$async);
      const w = t.scopeValue("root", { ref: d });
      return Zn(e, (0, ze._)`${w}.validate`, d, d.$async);
    }
    function _(w) {
      const g = uu(e, w);
      Zn(e, g, w, w.$async);
    }
    function y(w) {
      const g = t.scopeValue("schema", i.code.source === !0 ? { ref: w, code: (0, ze.stringify)(w) } : { ref: w }), $ = t.name("valid"), p = e.subschema({
        schema: w,
        dataTypes: [],
        schemaPath: ze.nil,
        topSchemaRef: g,
        errSchemaPath: r
      }, $);
      e.mergeEvaluated(p), e.ok($);
    }
  }
};
function uu(e, t) {
  const { gen: r } = e;
  return t.validate ? r.scopeValue("validate", { ref: t.validate }) : (0, ze._)`${r.scopeValue("wrapper", { ref: t })}.validate`;
}
Rt.getValidate = uu;
function Zn(e, t, r, n) {
  const { gen: s, it: o } = e, { allErrors: a, schemaEnv: i, opts: c } = o, d = c.passContext ? Sr.default.this : ze.nil;
  n ? u() : f();
  function u() {
    if (!i.$async)
      throw new Error("async schema referenced by sync schema");
    const w = s.let("valid");
    s.try(() => {
      s.code((0, ze._)`await ${(0, ec.callValidateCode)(e, t, d)}`), y(t), a || s.assign(w, !0);
    }, (g) => {
      s.if((0, ze._)`!(${g} instanceof ${o.ValidationError})`, () => s.throw(g)), _(g), a || s.assign(w, !1);
    }), e.ok(w);
  }
  function f() {
    e.result((0, ec.callValidateCode)(e, t, d), () => y(t), () => _(t));
  }
  function _(w) {
    const g = (0, ze._)`${w}.errors`;
    s.assign(Sr.default.vErrors, (0, ze._)`${Sr.default.vErrors} === null ? ${g} : ${Sr.default.vErrors}.concat(${g})`), s.assign(Sr.default.errors, (0, ze._)`${Sr.default.vErrors}.length`);
  }
  function y(w) {
    var g;
    if (!o.opts.unevaluated)
      return;
    const $ = (g = r == null ? void 0 : r.validate) === null || g === void 0 ? void 0 : g.evaluated;
    if (o.props !== !0)
      if ($ && !$.dynamicProps)
        $.props !== void 0 && (o.props = An.mergeEvaluated.props(s, $.props, o.props));
      else {
        const p = s.var("props", (0, ze._)`${w}.evaluated.props`);
        o.props = An.mergeEvaluated.props(s, p, o.props, ze.Name);
      }
    if (o.items !== !0)
      if ($ && !$.dynamicItems)
        $.items !== void 0 && (o.items = An.mergeEvaluated.items(s, $.items, o.items));
      else {
        const p = s.var("items", (0, ze._)`${w}.evaluated.items`);
        o.items = An.mergeEvaluated.items(s, p, o.items, ze.Name);
      }
  }
}
Rt.callRef = Zn;
Rt.default = Kp;
Object.defineProperty(Qo, "__esModule", { value: !0 });
const Hp = Zo, Bp = Rt, Wp = [
  "$schema",
  "$id",
  "$defs",
  "$vocabulary",
  { keyword: "$comment" },
  "definitions",
  Hp.default,
  Bp.default
];
Qo.default = Wp;
var ea = {}, ta = {};
Object.defineProperty(ta, "__esModule", { value: !0 });
const ls = Z, At = ls.operators, us = {
  maximum: { okStr: "<=", ok: At.LTE, fail: At.GT },
  minimum: { okStr: ">=", ok: At.GTE, fail: At.LT },
  exclusiveMaximum: { okStr: "<", ok: At.LT, fail: At.GTE },
  exclusiveMinimum: { okStr: ">", ok: At.GT, fail: At.LTE }
}, Jp = {
  message: ({ keyword: e, schemaCode: t }) => (0, ls.str)`must be ${us[e].okStr} ${t}`,
  params: ({ keyword: e, schemaCode: t }) => (0, ls._)`{comparison: ${us[e].okStr}, limit: ${t}}`
}, Xp = {
  keyword: Object.keys(us),
  type: "number",
  schemaType: "number",
  $data: !0,
  error: Jp,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e;
    e.fail$data((0, ls._)`${r} ${us[t].fail} ${n} || isNaN(${r})`);
  }
};
ta.default = Xp;
var ra = {};
Object.defineProperty(ra, "__esModule", { value: !0 });
const ln = Z, Yp = {
  message: ({ schemaCode: e }) => (0, ln.str)`must be multiple of ${e}`,
  params: ({ schemaCode: e }) => (0, ln._)`{multipleOf: ${e}}`
}, xp = {
  keyword: "multipleOf",
  type: "number",
  schemaType: "number",
  $data: !0,
  error: Yp,
  code(e) {
    const { gen: t, data: r, schemaCode: n, it: s } = e, o = s.opts.multipleOfPrecision, a = t.let("res"), i = o ? (0, ln._)`Math.abs(Math.round(${a}) - ${a}) > 1e-${o}` : (0, ln._)`${a} !== parseInt(${a})`;
    e.fail$data((0, ln._)`(${n} === 0 || (${a} = ${r}/${n}, ${i}))`);
  }
};
ra.default = xp;
var na = {}, sa = {};
Object.defineProperty(sa, "__esModule", { value: !0 });
function du(e) {
  const t = e.length;
  let r = 0, n = 0, s;
  for (; n < t; )
    r++, s = e.charCodeAt(n++), s >= 55296 && s <= 56319 && n < t && (s = e.charCodeAt(n), (s & 64512) === 56320 && n++);
  return r;
}
sa.default = du;
du.code = 'require("ajv/dist/runtime/ucs2length").default';
Object.defineProperty(na, "__esModule", { value: !0 });
const ur = Z, Qp = F, Zp = sa, em = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxLength" ? "more" : "fewer";
    return (0, ur.str)`must NOT have ${r} than ${t} characters`;
  },
  params: ({ schemaCode: e }) => (0, ur._)`{limit: ${e}}`
}, tm = {
  keyword: ["maxLength", "minLength"],
  type: "string",
  schemaType: "number",
  $data: !0,
  error: em,
  code(e) {
    const { keyword: t, data: r, schemaCode: n, it: s } = e, o = t === "maxLength" ? ur.operators.GT : ur.operators.LT, a = s.opts.unicode === !1 ? (0, ur._)`${r}.length` : (0, ur._)`${(0, Qp.useFunc)(e.gen, Zp.default)}(${r})`;
    e.fail$data((0, ur._)`${a} ${o} ${n}`);
  }
};
na.default = tm;
var oa = {};
Object.defineProperty(oa, "__esModule", { value: !0 });
const rm = se, ds = Z, nm = {
  message: ({ schemaCode: e }) => (0, ds.str)`must match pattern "${e}"`,
  params: ({ schemaCode: e }) => (0, ds._)`{pattern: ${e}}`
}, sm = {
  keyword: "pattern",
  type: "string",
  schemaType: "string",
  $data: !0,
  error: nm,
  code(e) {
    const { data: t, $data: r, schema: n, schemaCode: s, it: o } = e, a = o.opts.unicodeRegExp ? "u" : "", i = r ? (0, ds._)`(new RegExp(${s}, ${a}))` : (0, rm.usePattern)(e, n);
    e.fail$data((0, ds._)`!${i}.test(${t})`);
  }
};
oa.default = sm;
var aa = {};
Object.defineProperty(aa, "__esModule", { value: !0 });
const un = Z, om = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxProperties" ? "more" : "fewer";
    return (0, un.str)`must NOT have ${r} than ${t} properties`;
  },
  params: ({ schemaCode: e }) => (0, un._)`{limit: ${e}}`
}, am = {
  keyword: ["maxProperties", "minProperties"],
  type: "object",
  schemaType: "number",
  $data: !0,
  error: om,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e, s = t === "maxProperties" ? un.operators.GT : un.operators.LT;
    e.fail$data((0, un._)`Object.keys(${r}).length ${s} ${n}`);
  }
};
aa.default = am;
var ia = {};
Object.defineProperty(ia, "__esModule", { value: !0 });
const en = se, dn = Z, im = F, cm = {
  message: ({ params: { missingProperty: e } }) => (0, dn.str)`must have required property '${e}'`,
  params: ({ params: { missingProperty: e } }) => (0, dn._)`{missingProperty: ${e}}`
}, lm = {
  keyword: "required",
  type: "object",
  schemaType: "array",
  $data: !0,
  error: cm,
  code(e) {
    const { gen: t, schema: r, schemaCode: n, data: s, $data: o, it: a } = e, { opts: i } = a;
    if (!o && r.length === 0)
      return;
    const c = r.length >= i.loopRequired;
    if (a.allErrors ? d() : u(), i.strictRequired) {
      const y = e.parentSchema.properties, { definedProperties: w } = e.it;
      for (const g of r)
        if ((y == null ? void 0 : y[g]) === void 0 && !w.has(g)) {
          const $ = a.schemaEnv.baseId + a.errSchemaPath, p = `required property "${g}" is not defined at "${$}" (strictRequired)`;
          (0, im.checkStrictMode)(a, p, a.opts.strictRequired);
        }
    }
    function d() {
      if (c || o)
        e.block$data(dn.nil, f);
      else
        for (const y of r)
          (0, en.checkReportMissingProp)(e, y);
    }
    function u() {
      const y = t.let("missing");
      if (c || o) {
        const w = t.let("valid", !0);
        e.block$data(w, () => _(y, w)), e.ok(w);
      } else
        t.if((0, en.checkMissingProp)(e, r, y)), (0, en.reportMissingProp)(e, y), t.else();
    }
    function f() {
      t.forOf("prop", n, (y) => {
        e.setParams({ missingProperty: y }), t.if((0, en.noPropertyInData)(t, s, y, i.ownProperties), () => e.error());
      });
    }
    function _(y, w) {
      e.setParams({ missingProperty: y }), t.forOf(y, n, () => {
        t.assign(w, (0, en.propertyInData)(t, s, y, i.ownProperties)), t.if((0, dn.not)(w), () => {
          e.error(), t.break();
        });
      }, dn.nil);
    }
  }
};
ia.default = lm;
var ca = {};
Object.defineProperty(ca, "__esModule", { value: !0 });
const fn = Z, um = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxItems" ? "more" : "fewer";
    return (0, fn.str)`must NOT have ${r} than ${t} items`;
  },
  params: ({ schemaCode: e }) => (0, fn._)`{limit: ${e}}`
}, dm = {
  keyword: ["maxItems", "minItems"],
  type: "array",
  schemaType: "number",
  $data: !0,
  error: um,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e, s = t === "maxItems" ? fn.operators.GT : fn.operators.LT;
    e.fail$data((0, fn._)`${r}.length ${s} ${n}`);
  }
};
ca.default = dm;
var la = {}, En = {};
Object.defineProperty(En, "__esModule", { value: !0 });
const fu = Es;
fu.code = 'require("ajv/dist/runtime/equal").default';
En.default = fu;
Object.defineProperty(la, "__esModule", { value: !0 });
const Js = Ee, be = Z, fm = F, hm = En, pm = {
  message: ({ params: { i: e, j: t } }) => (0, be.str)`must NOT have duplicate items (items ## ${t} and ${e} are identical)`,
  params: ({ params: { i: e, j: t } }) => (0, be._)`{i: ${e}, j: ${t}}`
}, mm = {
  keyword: "uniqueItems",
  type: "array",
  schemaType: "boolean",
  $data: !0,
  error: pm,
  code(e) {
    const { gen: t, data: r, $data: n, schema: s, parentSchema: o, schemaCode: a, it: i } = e;
    if (!n && !s)
      return;
    const c = t.let("valid"), d = o.items ? (0, Js.getSchemaTypes)(o.items) : [];
    e.block$data(c, u, (0, be._)`${a} === false`), e.ok(c);
    function u() {
      const w = t.let("i", (0, be._)`${r}.length`), g = t.let("j");
      e.setParams({ i: w, j: g }), t.assign(c, !0), t.if((0, be._)`${w} > 1`, () => (f() ? _ : y)(w, g));
    }
    function f() {
      return d.length > 0 && !d.some((w) => w === "object" || w === "array");
    }
    function _(w, g) {
      const $ = t.name("item"), p = (0, Js.checkDataTypes)(d, $, i.opts.strictNumbers, Js.DataType.Wrong), E = t.const("indices", (0, be._)`{}`);
      t.for((0, be._)`;${w}--;`, () => {
        t.let($, (0, be._)`${r}[${w}]`), t.if(p, (0, be._)`continue`), d.length > 1 && t.if((0, be._)`typeof ${$} == "string"`, (0, be._)`${$} += "_"`), t.if((0, be._)`typeof ${E}[${$}] == "number"`, () => {
          t.assign(g, (0, be._)`${E}[${$}]`), e.error(), t.assign(c, !1).break();
        }).code((0, be._)`${E}[${$}] = ${w}`);
      });
    }
    function y(w, g) {
      const $ = (0, fm.useFunc)(t, hm.default), p = t.name("outer");
      t.label(p).for((0, be._)`;${w}--;`, () => t.for((0, be._)`${g} = ${w}; ${g}--;`, () => t.if((0, be._)`${$}(${r}[${w}], ${r}[${g}])`, () => {
        e.error(), t.assign(c, !1).break(p);
      })));
    }
  }
};
la.default = mm;
var ua = {};
Object.defineProperty(ua, "__esModule", { value: !0 });
const go = Z, ym = F, $m = En, gm = {
  message: "must be equal to constant",
  params: ({ schemaCode: e }) => (0, go._)`{allowedValue: ${e}}`
}, _m = {
  keyword: "const",
  $data: !0,
  error: gm,
  code(e) {
    const { gen: t, data: r, $data: n, schemaCode: s, schema: o } = e;
    n || o && typeof o == "object" ? e.fail$data((0, go._)`!${(0, ym.useFunc)(t, $m.default)}(${r}, ${s})`) : e.fail((0, go._)`${o} !== ${r}`);
  }
};
ua.default = _m;
var da = {};
Object.defineProperty(da, "__esModule", { value: !0 });
const on = Z, vm = F, Em = En, wm = {
  message: "must be equal to one of the allowed values",
  params: ({ schemaCode: e }) => (0, on._)`{allowedValues: ${e}}`
}, Sm = {
  keyword: "enum",
  schemaType: "array",
  $data: !0,
  error: wm,
  code(e) {
    const { gen: t, data: r, $data: n, schema: s, schemaCode: o, it: a } = e;
    if (!n && s.length === 0)
      throw new Error("enum must have non-empty array");
    const i = s.length >= a.opts.loopEnum;
    let c;
    const d = () => c ?? (c = (0, vm.useFunc)(t, Em.default));
    let u;
    if (i || n)
      u = t.let("valid"), e.block$data(u, f);
    else {
      if (!Array.isArray(s))
        throw new Error("ajv implementation error");
      const y = t.const("vSchema", o);
      u = (0, on.or)(...s.map((w, g) => _(y, g)));
    }
    e.pass(u);
    function f() {
      t.assign(u, !1), t.forOf("v", o, (y) => t.if((0, on._)`${d()}(${r}, ${y})`, () => t.assign(u, !0).break()));
    }
    function _(y, w) {
      const g = s[w];
      return typeof g == "object" && g !== null ? (0, on._)`${d()}(${r}, ${y}[${w}])` : (0, on._)`${r} === ${g}`;
    }
  }
};
da.default = Sm;
Object.defineProperty(ea, "__esModule", { value: !0 });
const bm = ta, Pm = ra, Nm = na, Rm = oa, Tm = aa, Om = ia, Im = ca, jm = la, Am = ua, Cm = da, km = [
  // number
  bm.default,
  Pm.default,
  // string
  Nm.default,
  Rm.default,
  // object
  Tm.default,
  Om.default,
  // array
  Im.default,
  jm.default,
  // any
  { keyword: "type", schemaType: ["string", "array"] },
  { keyword: "nullable", schemaType: "boolean" },
  Am.default,
  Cm.default
];
ea.default = km;
var fa = {}, qr = {};
Object.defineProperty(qr, "__esModule", { value: !0 });
qr.validateAdditionalItems = void 0;
const dr = Z, _o = F, Dm = {
  message: ({ params: { len: e } }) => (0, dr.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, dr._)`{limit: ${e}}`
}, Mm = {
  keyword: "additionalItems",
  type: "array",
  schemaType: ["boolean", "object"],
  before: "uniqueItems",
  error: Dm,
  code(e) {
    const { parentSchema: t, it: r } = e, { items: n } = t;
    if (!Array.isArray(n)) {
      (0, _o.checkStrictMode)(r, '"additionalItems" is ignored when "items" is not an array of schemas');
      return;
    }
    hu(e, n);
  }
};
function hu(e, t) {
  const { gen: r, schema: n, data: s, keyword: o, it: a } = e;
  a.items = !0;
  const i = r.const("len", (0, dr._)`${s}.length`);
  if (n === !1)
    e.setParams({ len: t.length }), e.pass((0, dr._)`${i} <= ${t.length}`);
  else if (typeof n == "object" && !(0, _o.alwaysValidSchema)(a, n)) {
    const d = r.var("valid", (0, dr._)`${i} <= ${t.length}`);
    r.if((0, dr.not)(d), () => c(d)), e.ok(d);
  }
  function c(d) {
    r.forRange("i", t.length, i, (u) => {
      e.subschema({ keyword: o, dataProp: u, dataPropType: _o.Type.Num }, d), a.allErrors || r.if((0, dr.not)(d), () => r.break());
    });
  }
}
qr.validateAdditionalItems = hu;
qr.default = Mm;
var ha = {}, Gr = {};
Object.defineProperty(Gr, "__esModule", { value: !0 });
Gr.validateTuple = void 0;
const rc = Z, es = F, Lm = se, Fm = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "array", "boolean"],
  before: "uniqueItems",
  code(e) {
    const { schema: t, it: r } = e;
    if (Array.isArray(t))
      return pu(e, "additionalItems", t);
    r.items = !0, !(0, es.alwaysValidSchema)(r, t) && e.ok((0, Lm.validateArray)(e));
  }
};
function pu(e, t, r = e.schema) {
  const { gen: n, parentSchema: s, data: o, keyword: a, it: i } = e;
  u(s), i.opts.unevaluated && r.length && i.items !== !0 && (i.items = es.mergeEvaluated.items(n, r.length, i.items));
  const c = n.name("valid"), d = n.const("len", (0, rc._)`${o}.length`);
  r.forEach((f, _) => {
    (0, es.alwaysValidSchema)(i, f) || (n.if((0, rc._)`${d} > ${_}`, () => e.subschema({
      keyword: a,
      schemaProp: _,
      dataProp: _
    }, c)), e.ok(c));
  });
  function u(f) {
    const { opts: _, errSchemaPath: y } = i, w = r.length, g = w === f.minItems && (w === f.maxItems || f[t] === !1);
    if (_.strictTuples && !g) {
      const $ = `"${a}" is ${w}-tuple, but minItems or maxItems/${t} are not specified or different at path "${y}"`;
      (0, es.checkStrictMode)(i, $, _.strictTuples);
    }
  }
}
Gr.validateTuple = pu;
Gr.default = Fm;
Object.defineProperty(ha, "__esModule", { value: !0 });
const Vm = Gr, Um = {
  keyword: "prefixItems",
  type: "array",
  schemaType: ["array"],
  before: "uniqueItems",
  code: (e) => (0, Vm.validateTuple)(e, "items")
};
ha.default = Um;
var pa = {};
Object.defineProperty(pa, "__esModule", { value: !0 });
const nc = Z, zm = F, qm = se, Gm = qr, Km = {
  message: ({ params: { len: e } }) => (0, nc.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, nc._)`{limit: ${e}}`
}, Hm = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  error: Km,
  code(e) {
    const { schema: t, parentSchema: r, it: n } = e, { prefixItems: s } = r;
    n.items = !0, !(0, zm.alwaysValidSchema)(n, t) && (s ? (0, Gm.validateAdditionalItems)(e, s) : e.ok((0, qm.validateArray)(e)));
  }
};
pa.default = Hm;
var ma = {};
Object.defineProperty(ma, "__esModule", { value: !0 });
const Xe = Z, Cn = F, Bm = {
  message: ({ params: { min: e, max: t } }) => t === void 0 ? (0, Xe.str)`must contain at least ${e} valid item(s)` : (0, Xe.str)`must contain at least ${e} and no more than ${t} valid item(s)`,
  params: ({ params: { min: e, max: t } }) => t === void 0 ? (0, Xe._)`{minContains: ${e}}` : (0, Xe._)`{minContains: ${e}, maxContains: ${t}}`
}, Wm = {
  keyword: "contains",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  trackErrors: !0,
  error: Bm,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, it: o } = e;
    let a, i;
    const { minContains: c, maxContains: d } = n;
    o.opts.next ? (a = c === void 0 ? 1 : c, i = d) : a = 1;
    const u = t.const("len", (0, Xe._)`${s}.length`);
    if (e.setParams({ min: a, max: i }), i === void 0 && a === 0) {
      (0, Cn.checkStrictMode)(o, '"minContains" == 0 without "maxContains": "contains" keyword ignored');
      return;
    }
    if (i !== void 0 && a > i) {
      (0, Cn.checkStrictMode)(o, '"minContains" > "maxContains" is always invalid'), e.fail();
      return;
    }
    if ((0, Cn.alwaysValidSchema)(o, r)) {
      let g = (0, Xe._)`${u} >= ${a}`;
      i !== void 0 && (g = (0, Xe._)`${g} && ${u} <= ${i}`), e.pass(g);
      return;
    }
    o.items = !0;
    const f = t.name("valid");
    i === void 0 && a === 1 ? y(f, () => t.if(f, () => t.break())) : a === 0 ? (t.let(f, !0), i !== void 0 && t.if((0, Xe._)`${s}.length > 0`, _)) : (t.let(f, !1), _()), e.result(f, () => e.reset());
    function _() {
      const g = t.name("_valid"), $ = t.let("count", 0);
      y(g, () => t.if(g, () => w($)));
    }
    function y(g, $) {
      t.forRange("i", 0, u, (p) => {
        e.subschema({
          keyword: "contains",
          dataProp: p,
          dataPropType: Cn.Type.Num,
          compositeRule: !0
        }, g), $();
      });
    }
    function w(g) {
      t.code((0, Xe._)`${g}++`), i === void 0 ? t.if((0, Xe._)`${g} >= ${a}`, () => t.assign(f, !0).break()) : (t.if((0, Xe._)`${g} > ${i}`, () => t.assign(f, !1).break()), a === 1 ? t.assign(f, !0) : t.if((0, Xe._)`${g} >= ${a}`, () => t.assign(f, !0)));
    }
  }
};
ma.default = Wm;
var Ps = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.validateSchemaDeps = e.validatePropertyDeps = e.error = void 0;
  const t = Z, r = F, n = se;
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
      const _ = Array.isArray(c[f]) ? d : u;
      _[f] = c[f];
    }
    return [d, u];
  }
  function a(c, d = c.schema) {
    const { gen: u, data: f, it: _ } = c;
    if (Object.keys(d).length === 0)
      return;
    const y = u.let("missing");
    for (const w in d) {
      const g = d[w];
      if (g.length === 0)
        continue;
      const $ = (0, n.propertyInData)(u, f, w, _.opts.ownProperties);
      c.setParams({
        property: w,
        depsCount: g.length,
        deps: g.join(", ")
      }), _.allErrors ? u.if($, () => {
        for (const p of g)
          (0, n.checkReportMissingProp)(c, p);
      }) : (u.if((0, t._)`${$} && (${(0, n.checkMissingProp)(c, g, y)})`), (0, n.reportMissingProp)(c, y), u.else());
    }
  }
  e.validatePropertyDeps = a;
  function i(c, d = c.schema) {
    const { gen: u, data: f, keyword: _, it: y } = c, w = u.name("valid");
    for (const g in d)
      (0, r.alwaysValidSchema)(y, d[g]) || (u.if(
        (0, n.propertyInData)(u, f, g, y.opts.ownProperties),
        () => {
          const $ = c.subschema({ keyword: _, schemaProp: g }, w);
          c.mergeValidEvaluated($, w);
        },
        () => u.var(w, !0)
        // TODO var
      ), c.ok(w));
  }
  e.validateSchemaDeps = i, e.default = s;
})(Ps);
var ya = {};
Object.defineProperty(ya, "__esModule", { value: !0 });
const mu = Z, Jm = F, Xm = {
  message: "property name must be valid",
  params: ({ params: e }) => (0, mu._)`{propertyName: ${e.propertyName}}`
}, Ym = {
  keyword: "propertyNames",
  type: "object",
  schemaType: ["object", "boolean"],
  error: Xm,
  code(e) {
    const { gen: t, schema: r, data: n, it: s } = e;
    if ((0, Jm.alwaysValidSchema)(s, r))
      return;
    const o = t.name("valid");
    t.forIn("key", n, (a) => {
      e.setParams({ propertyName: a }), e.subschema({
        keyword: "propertyNames",
        data: a,
        dataTypes: ["string"],
        propertyName: a,
        compositeRule: !0
      }, o), t.if((0, mu.not)(o), () => {
        e.error(!0), s.allErrors || t.break();
      });
    }), e.ok(o);
  }
};
ya.default = Ym;
var Ns = {};
Object.defineProperty(Ns, "__esModule", { value: !0 });
const kn = se, et = Z, xm = We, Dn = F, Qm = {
  message: "must NOT have additional properties",
  params: ({ params: e }) => (0, et._)`{additionalProperty: ${e.additionalProperty}}`
}, Zm = {
  keyword: "additionalProperties",
  type: ["object"],
  schemaType: ["boolean", "object"],
  allowUndefined: !0,
  trackErrors: !0,
  error: Qm,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, errsCount: o, it: a } = e;
    if (!o)
      throw new Error("ajv implementation error");
    const { allErrors: i, opts: c } = a;
    if (a.props = !0, c.removeAdditional !== "all" && (0, Dn.alwaysValidSchema)(a, r))
      return;
    const d = (0, kn.allSchemaProperties)(n.properties), u = (0, kn.allSchemaProperties)(n.patternProperties);
    f(), e.ok((0, et._)`${o} === ${xm.default.errors}`);
    function f() {
      t.forIn("key", s, ($) => {
        !d.length && !u.length ? w($) : t.if(_($), () => w($));
      });
    }
    function _($) {
      let p;
      if (d.length > 8) {
        const E = (0, Dn.schemaRefOrVal)(a, n.properties, "properties");
        p = (0, kn.isOwnProperty)(t, E, $);
      } else d.length ? p = (0, et.or)(...d.map((E) => (0, et._)`${$} === ${E}`)) : p = et.nil;
      return u.length && (p = (0, et.or)(p, ...u.map((E) => (0, et._)`${(0, kn.usePattern)(e, E)}.test(${$})`))), (0, et.not)(p);
    }
    function y($) {
      t.code((0, et._)`delete ${s}[${$}]`);
    }
    function w($) {
      if (c.removeAdditional === "all" || c.removeAdditional && r === !1) {
        y($);
        return;
      }
      if (r === !1) {
        e.setParams({ additionalProperty: $ }), e.error(), i || t.break();
        return;
      }
      if (typeof r == "object" && !(0, Dn.alwaysValidSchema)(a, r)) {
        const p = t.name("valid");
        c.removeAdditional === "failing" ? (g($, p, !1), t.if((0, et.not)(p), () => {
          e.reset(), y($);
        })) : (g($, p), i || t.if((0, et.not)(p), () => t.break()));
      }
    }
    function g($, p, E) {
      const N = {
        keyword: "additionalProperties",
        dataProp: $,
        dataPropType: Dn.Type.Str
      };
      E === !1 && Object.assign(N, {
        compositeRule: !0,
        createErrors: !1,
        allErrors: !1
      }), e.subschema(N, p);
    }
  }
};
Ns.default = Zm;
var $a = {};
Object.defineProperty($a, "__esModule", { value: !0 });
const ey = ot, sc = se, Xs = F, oc = Ns, ty = {
  keyword: "properties",
  type: "object",
  schemaType: "object",
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, it: o } = e;
    o.opts.removeAdditional === "all" && n.additionalProperties === void 0 && oc.default.code(new ey.KeywordCxt(o, oc.default, "additionalProperties"));
    const a = (0, sc.allSchemaProperties)(r);
    for (const f of a)
      o.definedProperties.add(f);
    o.opts.unevaluated && a.length && o.props !== !0 && (o.props = Xs.mergeEvaluated.props(t, (0, Xs.toHash)(a), o.props));
    const i = a.filter((f) => !(0, Xs.alwaysValidSchema)(o, r[f]));
    if (i.length === 0)
      return;
    const c = t.name("valid");
    for (const f of i)
      d(f) ? u(f) : (t.if((0, sc.propertyInData)(t, s, f, o.opts.ownProperties)), u(f), o.allErrors || t.else().var(c, !0), t.endIf()), e.it.definedProperties.add(f), e.ok(c);
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
$a.default = ty;
var ga = {};
Object.defineProperty(ga, "__esModule", { value: !0 });
const ac = se, Mn = Z, ic = F, cc = F, ry = {
  keyword: "patternProperties",
  type: "object",
  schemaType: "object",
  code(e) {
    const { gen: t, schema: r, data: n, parentSchema: s, it: o } = e, { opts: a } = o, i = (0, ac.allSchemaProperties)(r), c = i.filter((g) => (0, ic.alwaysValidSchema)(o, r[g]));
    if (i.length === 0 || c.length === i.length && (!o.opts.unevaluated || o.props === !0))
      return;
    const d = a.strictSchema && !a.allowMatchingProperties && s.properties, u = t.name("valid");
    o.props !== !0 && !(o.props instanceof Mn.Name) && (o.props = (0, cc.evaluatedPropsToName)(t, o.props));
    const { props: f } = o;
    _();
    function _() {
      for (const g of i)
        d && y(g), o.allErrors ? w(g) : (t.var(u, !0), w(g), t.if(u));
    }
    function y(g) {
      for (const $ in d)
        new RegExp(g).test($) && (0, ic.checkStrictMode)(o, `property ${$} matches pattern ${g} (use allowMatchingProperties)`);
    }
    function w(g) {
      t.forIn("key", n, ($) => {
        t.if((0, Mn._)`${(0, ac.usePattern)(e, g)}.test(${$})`, () => {
          const p = c.includes(g);
          p || e.subschema({
            keyword: "patternProperties",
            schemaProp: g,
            dataProp: $,
            dataPropType: cc.Type.Str
          }, u), o.opts.unevaluated && f !== !0 ? t.assign((0, Mn._)`${f}[${$}]`, !0) : !p && !o.allErrors && t.if((0, Mn.not)(u), () => t.break());
        });
      });
    }
  }
};
ga.default = ry;
var _a = {};
Object.defineProperty(_a, "__esModule", { value: !0 });
const ny = F, sy = {
  keyword: "not",
  schemaType: ["object", "boolean"],
  trackErrors: !0,
  code(e) {
    const { gen: t, schema: r, it: n } = e;
    if ((0, ny.alwaysValidSchema)(n, r)) {
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
_a.default = sy;
var va = {};
Object.defineProperty(va, "__esModule", { value: !0 });
const oy = se, ay = {
  keyword: "anyOf",
  schemaType: "array",
  trackErrors: !0,
  code: oy.validateUnion,
  error: { message: "must match a schema in anyOf" }
};
va.default = ay;
var Ea = {};
Object.defineProperty(Ea, "__esModule", { value: !0 });
const ts = Z, iy = F, cy = {
  message: "must match exactly one schema in oneOf",
  params: ({ params: e }) => (0, ts._)`{passingSchemas: ${e.passing}}`
}, ly = {
  keyword: "oneOf",
  schemaType: "array",
  trackErrors: !0,
  error: cy,
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
        let _;
        (0, iy.alwaysValidSchema)(s, u) ? t.var(c, !0) : _ = e.subschema({
          keyword: "oneOf",
          schemaProp: f,
          compositeRule: !0
        }, c), f > 0 && t.if((0, ts._)`${c} && ${a}`).assign(a, !1).assign(i, (0, ts._)`[${i}, ${f}]`).else(), t.if(c, () => {
          t.assign(a, !0), t.assign(i, f), _ && e.mergeEvaluated(_, ts.Name);
        });
      });
    }
  }
};
Ea.default = ly;
var wa = {};
Object.defineProperty(wa, "__esModule", { value: !0 });
const uy = F, dy = {
  keyword: "allOf",
  schemaType: "array",
  code(e) {
    const { gen: t, schema: r, it: n } = e;
    if (!Array.isArray(r))
      throw new Error("ajv implementation error");
    const s = t.name("valid");
    r.forEach((o, a) => {
      if ((0, uy.alwaysValidSchema)(n, o))
        return;
      const i = e.subschema({ keyword: "allOf", schemaProp: a }, s);
      e.ok(s), e.mergeEvaluated(i);
    });
  }
};
wa.default = dy;
var Sa = {};
Object.defineProperty(Sa, "__esModule", { value: !0 });
const fs = Z, yu = F, fy = {
  message: ({ params: e }) => (0, fs.str)`must match "${e.ifClause}" schema`,
  params: ({ params: e }) => (0, fs._)`{failingKeyword: ${e.ifClause}}`
}, hy = {
  keyword: "if",
  schemaType: ["object", "boolean"],
  trackErrors: !0,
  error: fy,
  code(e) {
    const { gen: t, parentSchema: r, it: n } = e;
    r.then === void 0 && r.else === void 0 && (0, yu.checkStrictMode)(n, '"if" without "then" and "else" is ignored');
    const s = lc(n, "then"), o = lc(n, "else");
    if (!s && !o)
      return;
    const a = t.let("valid", !0), i = t.name("_valid");
    if (c(), e.reset(), s && o) {
      const u = t.let("ifClause");
      e.setParams({ ifClause: u }), t.if(i, d("then", u), d("else", u));
    } else s ? t.if(i, d("then")) : t.if((0, fs.not)(i), d("else"));
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
        const _ = e.subschema({ keyword: u }, i);
        t.assign(a, i), e.mergeValidEvaluated(_, a), f ? t.assign(f, (0, fs._)`${u}`) : e.setParams({ ifClause: u });
      };
    }
  }
};
function lc(e, t) {
  const r = e.schema[t];
  return r !== void 0 && !(0, yu.alwaysValidSchema)(e, r);
}
Sa.default = hy;
var ba = {};
Object.defineProperty(ba, "__esModule", { value: !0 });
const py = F, my = {
  keyword: ["then", "else"],
  schemaType: ["object", "boolean"],
  code({ keyword: e, parentSchema: t, it: r }) {
    t.if === void 0 && (0, py.checkStrictMode)(r, `"${e}" without "if" is ignored`);
  }
};
ba.default = my;
Object.defineProperty(fa, "__esModule", { value: !0 });
const yy = qr, $y = ha, gy = Gr, _y = pa, vy = ma, Ey = Ps, wy = ya, Sy = Ns, by = $a, Py = ga, Ny = _a, Ry = va, Ty = Ea, Oy = wa, Iy = Sa, jy = ba;
function Ay(e = !1) {
  const t = [
    // any
    Ny.default,
    Ry.default,
    Ty.default,
    Oy.default,
    Iy.default,
    jy.default,
    // object
    wy.default,
    Sy.default,
    Ey.default,
    by.default,
    Py.default
  ];
  return e ? t.push($y.default, _y.default) : t.push(yy.default, gy.default), t.push(vy.default), t;
}
fa.default = Ay;
var Pa = {}, Kr = {};
Object.defineProperty(Kr, "__esModule", { value: !0 });
Kr.dynamicAnchor = void 0;
const Ys = Z, Cy = We, uc = Fe, ky = Rt, Dy = {
  keyword: "$dynamicAnchor",
  schemaType: "string",
  code: (e) => $u(e, e.schema)
};
function $u(e, t) {
  const { gen: r, it: n } = e;
  n.schemaEnv.root.dynamicAnchors[t] = !0;
  const s = (0, Ys._)`${Cy.default.dynamicAnchors}${(0, Ys.getProperty)(t)}`, o = n.errSchemaPath === "#" ? n.validateName : My(e);
  r.if((0, Ys._)`!${s}`, () => r.assign(s, o));
}
Kr.dynamicAnchor = $u;
function My(e) {
  const { schemaEnv: t, schema: r, self: n } = e.it, { root: s, baseId: o, localRefs: a, meta: i } = t.root, { schemaId: c } = n.opts, d = new uc.SchemaEnv({ schema: r, schemaId: c, root: s, baseId: o, localRefs: a, meta: i });
  return uc.compileSchema.call(n, d), (0, ky.getValidate)(e, d);
}
Kr.default = Dy;
var Hr = {};
Object.defineProperty(Hr, "__esModule", { value: !0 });
Hr.dynamicRef = void 0;
const dc = Z, Ly = We, fc = Rt, Fy = {
  keyword: "$dynamicRef",
  schemaType: "string",
  code: (e) => gu(e, e.schema)
};
function gu(e, t) {
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
      const d = r.let("_v", (0, dc._)`${Ly.default.dynamicAnchors}${(0, dc.getProperty)(o)}`);
      r.if(d, i(d, c), i(s.validateName, c));
    } else
      i(s.validateName, c)();
  }
  function i(c, d) {
    return d ? () => r.block(() => {
      (0, fc.callRef)(e, c), r.let(d, !0);
    }) : () => (0, fc.callRef)(e, c);
  }
}
Hr.dynamicRef = gu;
Hr.default = Fy;
var Na = {};
Object.defineProperty(Na, "__esModule", { value: !0 });
const Vy = Kr, Uy = F, zy = {
  keyword: "$recursiveAnchor",
  schemaType: "boolean",
  code(e) {
    e.schema ? (0, Vy.dynamicAnchor)(e, "") : (0, Uy.checkStrictMode)(e.it, "$recursiveAnchor: false is ignored");
  }
};
Na.default = zy;
var Ra = {};
Object.defineProperty(Ra, "__esModule", { value: !0 });
const qy = Hr, Gy = {
  keyword: "$recursiveRef",
  schemaType: "string",
  code: (e) => (0, qy.dynamicRef)(e, e.schema)
};
Ra.default = Gy;
Object.defineProperty(Pa, "__esModule", { value: !0 });
const Ky = Kr, Hy = Hr, By = Na, Wy = Ra, Jy = [Ky.default, Hy.default, By.default, Wy.default];
Pa.default = Jy;
var Ta = {}, Oa = {};
Object.defineProperty(Oa, "__esModule", { value: !0 });
const hc = Ps, Xy = {
  keyword: "dependentRequired",
  type: "object",
  schemaType: "object",
  error: hc.error,
  code: (e) => (0, hc.validatePropertyDeps)(e)
};
Oa.default = Xy;
var Ia = {};
Object.defineProperty(Ia, "__esModule", { value: !0 });
const Yy = Ps, xy = {
  keyword: "dependentSchemas",
  type: "object",
  schemaType: "object",
  code: (e) => (0, Yy.validateSchemaDeps)(e)
};
Ia.default = xy;
var ja = {};
Object.defineProperty(ja, "__esModule", { value: !0 });
const Qy = F, Zy = {
  keyword: ["maxContains", "minContains"],
  type: "array",
  schemaType: "number",
  code({ keyword: e, parentSchema: t, it: r }) {
    t.contains === void 0 && (0, Qy.checkStrictMode)(r, `"${e}" without "contains" is ignored`);
  }
};
ja.default = Zy;
Object.defineProperty(Ta, "__esModule", { value: !0 });
const e$ = Oa, t$ = Ia, r$ = ja, n$ = [e$.default, t$.default, r$.default];
Ta.default = n$;
var Aa = {}, Ca = {};
Object.defineProperty(Ca, "__esModule", { value: !0 });
const Lt = Z, pc = F, s$ = We, o$ = {
  message: "must NOT have unevaluated properties",
  params: ({ params: e }) => (0, Lt._)`{unevaluatedProperty: ${e.unevaluatedProperty}}`
}, a$ = {
  keyword: "unevaluatedProperties",
  type: "object",
  schemaType: ["boolean", "object"],
  trackErrors: !0,
  error: o$,
  code(e) {
    const { gen: t, schema: r, data: n, errsCount: s, it: o } = e;
    if (!s)
      throw new Error("ajv implementation error");
    const { allErrors: a, props: i } = o;
    i instanceof Lt.Name ? t.if((0, Lt._)`${i} !== true`, () => t.forIn("key", n, (f) => t.if(d(i, f), () => c(f)))) : i !== !0 && t.forIn("key", n, (f) => i === void 0 ? c(f) : t.if(u(i, f), () => c(f))), o.props = !0, e.ok((0, Lt._)`${s} === ${s$.default.errors}`);
    function c(f) {
      if (r === !1) {
        e.setParams({ unevaluatedProperty: f }), e.error(), a || t.break();
        return;
      }
      if (!(0, pc.alwaysValidSchema)(o, r)) {
        const _ = t.name("valid");
        e.subschema({
          keyword: "unevaluatedProperties",
          dataProp: f,
          dataPropType: pc.Type.Str
        }, _), a || t.if((0, Lt.not)(_), () => t.break());
      }
    }
    function d(f, _) {
      return (0, Lt._)`!${f} || !${f}[${_}]`;
    }
    function u(f, _) {
      const y = [];
      for (const w in f)
        f[w] === !0 && y.push((0, Lt._)`${_} !== ${w}`);
      return (0, Lt.and)(...y);
    }
  }
};
Ca.default = a$;
var ka = {};
Object.defineProperty(ka, "__esModule", { value: !0 });
const fr = Z, mc = F, i$ = {
  message: ({ params: { len: e } }) => (0, fr.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, fr._)`{limit: ${e}}`
}, c$ = {
  keyword: "unevaluatedItems",
  type: "array",
  schemaType: ["boolean", "object"],
  error: i$,
  code(e) {
    const { gen: t, schema: r, data: n, it: s } = e, o = s.items || 0;
    if (o === !0)
      return;
    const a = t.const("len", (0, fr._)`${n}.length`);
    if (r === !1)
      e.setParams({ len: o }), e.fail((0, fr._)`${a} > ${o}`);
    else if (typeof r == "object" && !(0, mc.alwaysValidSchema)(s, r)) {
      const c = t.var("valid", (0, fr._)`${a} <= ${o}`);
      t.if((0, fr.not)(c), () => i(c, o)), e.ok(c);
    }
    s.items = !0;
    function i(c, d) {
      t.forRange("i", d, a, (u) => {
        e.subschema({ keyword: "unevaluatedItems", dataProp: u, dataPropType: mc.Type.Num }, c), s.allErrors || t.if((0, fr.not)(c), () => t.break());
      });
    }
  }
};
ka.default = c$;
Object.defineProperty(Aa, "__esModule", { value: !0 });
const l$ = Ca, u$ = ka, d$ = [l$.default, u$.default];
Aa.default = d$;
var Da = {}, Ma = {};
Object.defineProperty(Ma, "__esModule", { value: !0 });
const $e = Z, f$ = {
  message: ({ schemaCode: e }) => (0, $e.str)`must match format "${e}"`,
  params: ({ schemaCode: e }) => (0, $e._)`{format: ${e}}`
}, h$ = {
  keyword: "format",
  type: ["number", "string"],
  schemaType: "string",
  $data: !0,
  error: f$,
  code(e, t) {
    const { gen: r, data: n, $data: s, schema: o, schemaCode: a, it: i } = e, { opts: c, errSchemaPath: d, schemaEnv: u, self: f } = i;
    if (!c.validateFormats)
      return;
    s ? _() : y();
    function _() {
      const w = r.scopeValue("formats", {
        ref: f.formats,
        code: c.code.formats
      }), g = r.const("fDef", (0, $e._)`${w}[${a}]`), $ = r.let("fType"), p = r.let("format");
      r.if((0, $e._)`typeof ${g} == "object" && !(${g} instanceof RegExp)`, () => r.assign($, (0, $e._)`${g}.type || "string"`).assign(p, (0, $e._)`${g}.validate`), () => r.assign($, (0, $e._)`"string"`).assign(p, g)), e.fail$data((0, $e.or)(E(), N()));
      function E() {
        return c.strictSchema === !1 ? $e.nil : (0, $e._)`${a} && !${p}`;
      }
      function N() {
        const R = u.$async ? (0, $e._)`(${g}.async ? await ${p}(${n}) : ${p}(${n}))` : (0, $e._)`${p}(${n})`, T = (0, $e._)`(typeof ${p} == "function" ? ${R} : ${p}.test(${n}))`;
        return (0, $e._)`${p} && ${p} !== true && ${$} === ${t} && !${T}`;
      }
    }
    function y() {
      const w = f.formats[o];
      if (!w) {
        E();
        return;
      }
      if (w === !0)
        return;
      const [g, $, p] = N(w);
      g === t && e.pass(R());
      function E() {
        if (c.strictSchema === !1) {
          f.logger.warn(T());
          return;
        }
        throw new Error(T());
        function T() {
          return `unknown format "${o}" ignored in schema at path "${d}"`;
        }
      }
      function N(T) {
        const C = T instanceof RegExp ? (0, $e.regexpCode)(T) : c.code.formats ? (0, $e._)`${c.code.formats}${(0, $e.getProperty)(o)}` : void 0, k = r.scopeValue("formats", { key: o, ref: T, code: C });
        return typeof T == "object" && !(T instanceof RegExp) ? [T.type || "string", T.validate, (0, $e._)`${k}.validate`] : ["string", T, k];
      }
      function R() {
        if (typeof w == "object" && !(w instanceof RegExp) && w.async) {
          if (!u.$async)
            throw new Error("async format in sync schema");
          return (0, $e._)`await ${p}(${n})`;
        }
        return typeof $ == "function" ? (0, $e._)`${p}(${n})` : (0, $e._)`${p}.test(${n})`;
      }
    }
  }
};
Ma.default = h$;
Object.defineProperty(Da, "__esModule", { value: !0 });
const p$ = Ma, m$ = [p$.default];
Da.default = m$;
var Fr = {};
Object.defineProperty(Fr, "__esModule", { value: !0 });
Fr.contentVocabulary = Fr.metadataVocabulary = void 0;
Fr.metadataVocabulary = [
  "title",
  "description",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
  "examples"
];
Fr.contentVocabulary = [
  "contentMediaType",
  "contentEncoding",
  "contentSchema"
];
Object.defineProperty(xo, "__esModule", { value: !0 });
const y$ = Qo, $$ = ea, g$ = fa, _$ = Pa, v$ = Ta, E$ = Aa, w$ = Da, yc = Fr, S$ = [
  _$.default,
  y$.default,
  $$.default,
  (0, g$.default)(!0),
  w$.default,
  yc.metadataVocabulary,
  yc.contentVocabulary,
  v$.default,
  E$.default
];
xo.default = S$;
var La = {}, Rs = {};
Object.defineProperty(Rs, "__esModule", { value: !0 });
Rs.DiscrError = void 0;
var $c;
(function(e) {
  e.Tag = "tag", e.Mapping = "mapping";
})($c || (Rs.DiscrError = $c = {}));
Object.defineProperty(La, "__esModule", { value: !0 });
const Rr = Z, vo = Rs, gc = Fe, b$ = zr, P$ = F, N$ = {
  message: ({ params: { discrError: e, tagName: t } }) => e === vo.DiscrError.Tag ? `tag "${t}" must be string` : `value of tag "${t}" must be in oneOf`,
  params: ({ params: { discrError: e, tag: t, tagName: r } }) => (0, Rr._)`{error: ${e}, tag: ${r}, tagValue: ${t}}`
}, R$ = {
  keyword: "discriminator",
  type: "object",
  schemaType: "object",
  error: N$,
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
    const c = t.let("valid", !1), d = t.const("tag", (0, Rr._)`${r}${(0, Rr.getProperty)(i)}`);
    t.if((0, Rr._)`typeof ${d} == "string"`, () => u(), () => e.error(!1, { discrError: vo.DiscrError.Tag, tag: d, tagName: i })), e.ok(c);
    function u() {
      const y = _();
      t.if(!1);
      for (const w in y)
        t.elseIf((0, Rr._)`${d} === ${w}`), t.assign(c, f(y[w]));
      t.else(), e.error(!1, { discrError: vo.DiscrError.Mapping, tag: d, tagName: i }), t.endIf();
    }
    function f(y) {
      const w = t.name("valid"), g = e.subschema({ keyword: "oneOf", schemaProp: y }, w);
      return e.mergeEvaluated(g, Rr.Name), w;
    }
    function _() {
      var y;
      const w = {}, g = p(s);
      let $ = !0;
      for (let R = 0; R < a.length; R++) {
        let T = a[R];
        if (T != null && T.$ref && !(0, P$.schemaHasRulesButRef)(T, o.self.RULES)) {
          const k = T.$ref;
          if (T = gc.resolveRef.call(o.self, o.schemaEnv.root, o.baseId, k), T instanceof gc.SchemaEnv && (T = T.schema), T === void 0)
            throw new b$.default(o.opts.uriResolver, o.baseId, k);
        }
        const C = (y = T == null ? void 0 : T.properties) === null || y === void 0 ? void 0 : y[i];
        if (typeof C != "object")
          throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${i}"`);
        $ = $ && (g || p(T)), E(C, R);
      }
      if (!$)
        throw new Error(`discriminator: "${i}" must be required`);
      return w;
      function p({ required: R }) {
        return Array.isArray(R) && R.includes(i);
      }
      function E(R, T) {
        if (R.const)
          N(R.const, T);
        else if (R.enum)
          for (const C of R.enum)
            N(C, T);
        else
          throw new Error(`discriminator: "properties/${i}" must have "const" or "enum"`);
      }
      function N(R, T) {
        if (typeof R != "string" || R in w)
          throw new Error(`discriminator: "${i}" values must be unique strings`);
        w[R] = T;
      }
    }
  }
};
La.default = R$;
var Fa = {};
const T$ = "https://json-schema.org/draft/2020-12/schema", O$ = "https://json-schema.org/draft/2020-12/schema", I$ = {
  "https://json-schema.org/draft/2020-12/vocab/core": !0,
  "https://json-schema.org/draft/2020-12/vocab/applicator": !0,
  "https://json-schema.org/draft/2020-12/vocab/unevaluated": !0,
  "https://json-schema.org/draft/2020-12/vocab/validation": !0,
  "https://json-schema.org/draft/2020-12/vocab/meta-data": !0,
  "https://json-schema.org/draft/2020-12/vocab/format-annotation": !0,
  "https://json-schema.org/draft/2020-12/vocab/content": !0
}, j$ = "meta", A$ = "Core and Validation specifications meta-schema", C$ = [
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
], k$ = [
  "object",
  "boolean"
], D$ = "This meta-schema also defines keywords that have appeared in previous drafts in order to prevent incompatible extensions as they remain in common use.", M$ = {
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
}, L$ = {
  $schema: T$,
  $id: O$,
  $vocabulary: I$,
  $dynamicAnchor: j$,
  title: A$,
  allOf: C$,
  type: k$,
  $comment: D$,
  properties: M$
}, F$ = "https://json-schema.org/draft/2020-12/schema", V$ = "https://json-schema.org/draft/2020-12/meta/applicator", U$ = {
  "https://json-schema.org/draft/2020-12/vocab/applicator": !0
}, z$ = "meta", q$ = "Applicator vocabulary meta-schema", G$ = [
  "object",
  "boolean"
], K$ = {
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
}, H$ = {
  schemaArray: {
    type: "array",
    minItems: 1,
    items: {
      $dynamicRef: "#meta"
    }
  }
}, B$ = {
  $schema: F$,
  $id: V$,
  $vocabulary: U$,
  $dynamicAnchor: z$,
  title: q$,
  type: G$,
  properties: K$,
  $defs: H$
}, W$ = "https://json-schema.org/draft/2020-12/schema", J$ = "https://json-schema.org/draft/2020-12/meta/unevaluated", X$ = {
  "https://json-schema.org/draft/2020-12/vocab/unevaluated": !0
}, Y$ = "meta", x$ = "Unevaluated applicator vocabulary meta-schema", Q$ = [
  "object",
  "boolean"
], Z$ = {
  unevaluatedItems: {
    $dynamicRef: "#meta"
  },
  unevaluatedProperties: {
    $dynamicRef: "#meta"
  }
}, eg = {
  $schema: W$,
  $id: J$,
  $vocabulary: X$,
  $dynamicAnchor: Y$,
  title: x$,
  type: Q$,
  properties: Z$
}, tg = "https://json-schema.org/draft/2020-12/schema", rg = "https://json-schema.org/draft/2020-12/meta/content", ng = {
  "https://json-schema.org/draft/2020-12/vocab/content": !0
}, sg = "meta", og = "Content vocabulary meta-schema", ag = [
  "object",
  "boolean"
], ig = {
  contentEncoding: {
    type: "string"
  },
  contentMediaType: {
    type: "string"
  },
  contentSchema: {
    $dynamicRef: "#meta"
  }
}, cg = {
  $schema: tg,
  $id: rg,
  $vocabulary: ng,
  $dynamicAnchor: sg,
  title: og,
  type: ag,
  properties: ig
}, lg = "https://json-schema.org/draft/2020-12/schema", ug = "https://json-schema.org/draft/2020-12/meta/core", dg = {
  "https://json-schema.org/draft/2020-12/vocab/core": !0
}, fg = "meta", hg = "Core vocabulary meta-schema", pg = [
  "object",
  "boolean"
], mg = {
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
}, yg = {
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
}, $g = {
  $schema: lg,
  $id: ug,
  $vocabulary: dg,
  $dynamicAnchor: fg,
  title: hg,
  type: pg,
  properties: mg,
  $defs: yg
}, gg = "https://json-schema.org/draft/2020-12/schema", _g = "https://json-schema.org/draft/2020-12/meta/format-annotation", vg = {
  "https://json-schema.org/draft/2020-12/vocab/format-annotation": !0
}, Eg = "meta", wg = "Format vocabulary meta-schema for annotation results", Sg = [
  "object",
  "boolean"
], bg = {
  format: {
    type: "string"
  }
}, Pg = {
  $schema: gg,
  $id: _g,
  $vocabulary: vg,
  $dynamicAnchor: Eg,
  title: wg,
  type: Sg,
  properties: bg
}, Ng = "https://json-schema.org/draft/2020-12/schema", Rg = "https://json-schema.org/draft/2020-12/meta/meta-data", Tg = {
  "https://json-schema.org/draft/2020-12/vocab/meta-data": !0
}, Og = "meta", Ig = "Meta-data vocabulary meta-schema", jg = [
  "object",
  "boolean"
], Ag = {
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
}, Cg = {
  $schema: Ng,
  $id: Rg,
  $vocabulary: Tg,
  $dynamicAnchor: Og,
  title: Ig,
  type: jg,
  properties: Ag
}, kg = "https://json-schema.org/draft/2020-12/schema", Dg = "https://json-schema.org/draft/2020-12/meta/validation", Mg = {
  "https://json-schema.org/draft/2020-12/vocab/validation": !0
}, Lg = "meta", Fg = "Validation vocabulary meta-schema", Vg = [
  "object",
  "boolean"
], Ug = {
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
}, zg = {
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
}, qg = {
  $schema: kg,
  $id: Dg,
  $vocabulary: Mg,
  $dynamicAnchor: Lg,
  title: Fg,
  type: Vg,
  properties: Ug,
  $defs: zg
};
Object.defineProperty(Fa, "__esModule", { value: !0 });
const Gg = L$, Kg = B$, Hg = eg, Bg = cg, Wg = $g, Jg = Pg, Xg = Cg, Yg = qg, xg = ["/properties"];
function Qg(e) {
  return [
    Gg,
    Kg,
    Hg,
    Bg,
    Wg,
    t(this, Jg),
    Xg,
    t(this, Yg)
  ].forEach((r) => this.addMetaSchema(r, void 0, !1)), this;
  function t(r, n) {
    return e ? r.$dataMetaSchema(n, xg) : n;
  }
}
Fa.default = Qg;
(function(e, t) {
  Object.defineProperty(t, "__esModule", { value: !0 }), t.MissingRefError = t.ValidationError = t.CodeGen = t.Name = t.nil = t.stringify = t.str = t._ = t.KeywordCxt = t.Ajv2020 = void 0;
  const r = vl, n = xo, s = La, o = Fa, a = "https://json-schema.org/draft/2020-12/schema";
  class i extends r.default {
    constructor(y = {}) {
      super({
        ...y,
        dynamicRef: !0,
        next: !0,
        unevaluated: !0
      });
    }
    _addVocabularies() {
      super._addVocabularies(), n.default.forEach((y) => this.addVocabulary(y)), this.opts.discriminator && this.addKeyword(s.default);
    }
    _addDefaultMetaSchema() {
      super._addDefaultMetaSchema();
      const { $data: y, meta: w } = this.opts;
      w && (o.default.call(this, y), this.refs["http://json-schema.org/schema"] = a);
    }
    defaultMeta() {
      return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(a) ? a : void 0);
    }
  }
  t.Ajv2020 = i, e.exports = t = i, e.exports.Ajv2020 = i, Object.defineProperty(t, "__esModule", { value: !0 }), t.default = i;
  var c = ot;
  Object.defineProperty(t, "KeywordCxt", { enumerable: !0, get: function() {
    return c.KeywordCxt;
  } });
  var d = Z;
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
  var u = Bo();
  Object.defineProperty(t, "ValidationError", { enumerable: !0, get: function() {
    return u.default;
  } });
  var f = zr;
  Object.defineProperty(t, "MissingRefError", { enumerable: !0, get: function() {
    return f.default;
  } });
})(ho, ho.exports);
var Zg = ho.exports, Eo = { exports: {} }, _u = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.formatNames = e.fastFormats = e.fullFormats = void 0;
  function t(L, z) {
    return { validate: L, compare: z };
  }
  e.fullFormats = {
    // date: http://tools.ietf.org/html/rfc3339#section-5.6
    date: t(o, a),
    // date-time: http://tools.ietf.org/html/rfc3339#section-5.6
    time: t(c(!0), d),
    "date-time": t(_(!0), y),
    "iso-time": t(c(), u),
    "iso-date-time": t(_(), w),
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
    regex: me,
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
    byte: N,
    // signed 32 bit integer
    int32: { type: "number", validate: C },
    // signed 64 bit integer
    int64: { type: "number", validate: k },
    // C-type float
    float: { type: "number", validate: ce },
    // C-type double
    double: { type: "number", validate: ce },
    // hint to the UI to hide input strings
    password: !0,
    // unchecked string payload
    binary: !0
  }, e.fastFormats = {
    ...e.fullFormats,
    date: t(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, a),
    time: t(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, d),
    "date-time": t(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, y),
    "iso-time": t(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, u),
    "iso-date-time": t(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, w),
    // uri: https://github.com/mafintosh/is-my-json-valid/blob/master/formats.js
    uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
    "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
    // email (sources from jsen validator):
    // http://stackoverflow.com/questions/201323/using-a-regular-expression-to-validate-an-email-address#answer-8829363
    // http://www.w3.org/TR/html5/forms.html#valid-e-mail-address (search for 'wilful violation')
    email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
  }, e.formatNames = Object.keys(e.fullFormats);
  function r(L) {
    return L % 4 === 0 && (L % 100 !== 0 || L % 400 === 0);
  }
  const n = /^(\d\d\d\d)-(\d\d)-(\d\d)$/, s = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function o(L) {
    const z = n.exec(L);
    if (!z)
      return !1;
    const ae = +z[1], O = +z[2], A = +z[3];
    return O >= 1 && O <= 12 && A >= 1 && A <= (O === 2 && r(ae) ? 29 : s[O]);
  }
  function a(L, z) {
    if (L && z)
      return L > z ? 1 : L < z ? -1 : 0;
  }
  const i = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
  function c(L) {
    return function(ae) {
      const O = i.exec(ae);
      if (!O)
        return !1;
      const A = +O[1], V = +O[2], D = +O[3], G = O[4], M = O[5] === "-" ? -1 : 1, P = +(O[6] || 0), m = +(O[7] || 0);
      if (P > 23 || m > 59 || L && !G)
        return !1;
      if (A <= 23 && V <= 59 && D < 60)
        return !0;
      const S = V - m * M, v = A - P * M - (S < 0 ? 1 : 0);
      return (v === 23 || v === -1) && (S === 59 || S === -1) && D < 61;
    };
  }
  function d(L, z) {
    if (!(L && z))
      return;
    const ae = (/* @__PURE__ */ new Date("2020-01-01T" + L)).valueOf(), O = (/* @__PURE__ */ new Date("2020-01-01T" + z)).valueOf();
    if (ae && O)
      return ae - O;
  }
  function u(L, z) {
    if (!(L && z))
      return;
    const ae = i.exec(L), O = i.exec(z);
    if (ae && O)
      return L = ae[1] + ae[2] + ae[3], z = O[1] + O[2] + O[3], L > z ? 1 : L < z ? -1 : 0;
  }
  const f = /t|\s/i;
  function _(L) {
    const z = c(L);
    return function(O) {
      const A = O.split(f);
      return A.length === 2 && o(A[0]) && z(A[1]);
    };
  }
  function y(L, z) {
    if (!(L && z))
      return;
    const ae = new Date(L).valueOf(), O = new Date(z).valueOf();
    if (ae && O)
      return ae - O;
  }
  function w(L, z) {
    if (!(L && z))
      return;
    const [ae, O] = L.split(f), [A, V] = z.split(f), D = a(ae, A);
    if (D !== void 0)
      return D || d(O, V);
  }
  const g = /\/|:/, $ = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
  function p(L) {
    return g.test(L) && $.test(L);
  }
  const E = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
  function N(L) {
    return E.lastIndex = 0, E.test(L);
  }
  const R = -2147483648, T = 2 ** 31 - 1;
  function C(L) {
    return Number.isInteger(L) && L <= T && L >= R;
  }
  function k(L) {
    return Number.isInteger(L);
  }
  function ce() {
    return !0;
  }
  const le = /[^\\]\\Z/;
  function me(L) {
    if (le.test(L))
      return !1;
    try {
      return new RegExp(L), !0;
    } catch {
      return !1;
    }
  }
})(_u);
var vu = {}, wo = { exports: {} }, Eu = {}, at = {}, Vr = {}, wn = {}, ne = {}, _n = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.regexpCode = e.getEsmExportName = e.getProperty = e.safeStringify = e.stringify = e.strConcat = e.addCodeArg = e.str = e._ = e.nil = e._Code = e.Name = e.IDENTIFIER = e._CodeOrName = void 0;
  class t {
  }
  e._CodeOrName = t, e.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
  class r extends t {
    constructor(E) {
      if (super(), !e.IDENTIFIER.test(E))
        throw new Error("CodeGen: name must be a valid identifier");
      this.str = E;
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
    constructor(E) {
      super(), this._items = typeof E == "string" ? [E] : E;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      if (this._items.length > 1)
        return !1;
      const E = this._items[0];
      return E === "" || E === '""';
    }
    get str() {
      var E;
      return (E = this._str) !== null && E !== void 0 ? E : this._str = this._items.reduce((N, R) => `${N}${R}`, "");
    }
    get names() {
      var E;
      return (E = this._names) !== null && E !== void 0 ? E : this._names = this._items.reduce((N, R) => (R instanceof r && (N[R.str] = (N[R.str] || 0) + 1), N), {});
    }
  }
  e._Code = n, e.nil = new n("");
  function s(p, ...E) {
    const N = [p[0]];
    let R = 0;
    for (; R < E.length; )
      i(N, E[R]), N.push(p[++R]);
    return new n(N);
  }
  e._ = s;
  const o = new n("+");
  function a(p, ...E) {
    const N = [y(p[0])];
    let R = 0;
    for (; R < E.length; )
      N.push(o), i(N, E[R]), N.push(o, y(p[++R]));
    return c(N), new n(N);
  }
  e.str = a;
  function i(p, E) {
    E instanceof n ? p.push(...E._items) : E instanceof r ? p.push(E) : p.push(f(E));
  }
  e.addCodeArg = i;
  function c(p) {
    let E = 1;
    for (; E < p.length - 1; ) {
      if (p[E] === o) {
        const N = d(p[E - 1], p[E + 1]);
        if (N !== void 0) {
          p.splice(E - 1, 3, N);
          continue;
        }
        p[E++] = "+";
      }
      E++;
    }
  }
  function d(p, E) {
    if (E === '""')
      return p;
    if (p === '""')
      return E;
    if (typeof p == "string")
      return E instanceof r || p[p.length - 1] !== '"' ? void 0 : typeof E != "string" ? `${p.slice(0, -1)}${E}"` : E[0] === '"' ? p.slice(0, -1) + E.slice(1) : void 0;
    if (typeof E == "string" && E[0] === '"' && !(p instanceof r))
      return `"${p}${E.slice(1)}`;
  }
  function u(p, E) {
    return E.emptyStr() ? p : p.emptyStr() ? E : a`${p}${E}`;
  }
  e.strConcat = u;
  function f(p) {
    return typeof p == "number" || typeof p == "boolean" || p === null ? p : y(Array.isArray(p) ? p.join(",") : p);
  }
  function _(p) {
    return new n(y(p));
  }
  e.stringify = _;
  function y(p) {
    return JSON.stringify(p).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  e.safeStringify = y;
  function w(p) {
    return typeof p == "string" && e.IDENTIFIER.test(p) ? new n(`.${p}`) : s`[${p}]`;
  }
  e.getProperty = w;
  function g(p) {
    if (typeof p == "string" && e.IDENTIFIER.test(p))
      return new n(`${p}`);
    throw new Error(`CodeGen: invalid export name: ${p}, use explicit $id name mapping`);
  }
  e.getEsmExportName = g;
  function $(p) {
    return new n(p.toString());
  }
  e.regexpCode = $;
})(_n);
var So = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.ValueScope = e.ValueScopeName = e.Scope = e.varKinds = e.UsedValueState = void 0;
  const t = _n;
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
      const _ = this.toName(d), { prefix: y } = _, w = (f = u.key) !== null && f !== void 0 ? f : u.ref;
      let g = this._values[y];
      if (g) {
        const E = g.get(w);
        if (E)
          return E;
      } else
        g = this._values[y] = /* @__PURE__ */ new Map();
      g.set(w, _);
      const $ = this._scope[y] || (this._scope[y] = []), p = $.length;
      return $[p] = u.ref, _.setValue(u, { property: y, itemIndex: p }), _;
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
      return this._reduceValues(d, (_) => {
        if (_.value === void 0)
          throw new Error(`CodeGen: name "${_}" has no value`);
        return _.value.code;
      }, u, f);
    }
    _reduceValues(d, u, f = {}, _) {
      let y = t.nil;
      for (const w in d) {
        const g = d[w];
        if (!g)
          continue;
        const $ = f[w] = f[w] || /* @__PURE__ */ new Map();
        g.forEach((p) => {
          if ($.has(p))
            return;
          $.set(p, n.Started);
          let E = u(p);
          if (E) {
            const N = this.opts.es5 ? e.varKinds.var : e.varKinds.const;
            y = (0, t._)`${y}${N} ${p} = ${E};${this.opts._n}`;
          } else if (E = _ == null ? void 0 : _(p))
            y = (0, t._)`${y}${E}${this.opts._n}`;
          else
            throw new r(p);
          $.set(p, n.Completed);
        });
      }
      return y;
    }
  }
  e.ValueScope = i;
})(So);
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.or = e.and = e.not = e.CodeGen = e.operators = e.varKinds = e.ValueScopeName = e.ValueScope = e.Scope = e.Name = e.regexpCode = e.stringify = e.getProperty = e.nil = e.strConcat = e.str = e._ = void 0;
  const t = _n, r = So;
  var n = _n;
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
  var s = So;
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
      const b = l ? r.varKinds.var : this.varKind, I = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
      return `${b} ${this.name}${I};` + h;
    }
    optimizeNames(l, h) {
      if (l[this.name.str])
        return this.rhs && (this.rhs = O(this.rhs, l, h)), this;
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
        return this.rhs = O(this.rhs, l, h), this;
    }
    get names() {
      const l = this.lhs instanceof t.Name ? {} : { ...this.lhs.names };
      return ae(l, this.rhs);
    }
  }
  class c extends i {
    constructor(l, h, b, I) {
      super(l, b, I), this.op = h;
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
  class _ extends o {
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
      return this.code = O(this.code, l, h), this;
    }
    get names() {
      return this.code instanceof t._CodeOrName ? this.code.names : {};
    }
  }
  class y extends o {
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
      let I = b.length;
      for (; I--; ) {
        const j = b[I];
        j.optimizeNames(l, h) || (A(l, j.names), b.splice(I, 1));
      }
      return b.length > 0 ? this : void 0;
    }
    get names() {
      return this.nodes.reduce((l, h) => z(l, h.names), {});
    }
  }
  class w extends y {
    render(l) {
      return "{" + l._n + super.render(l) + "}" + l._n;
    }
  }
  class g extends y {
  }
  class $ extends w {
  }
  $.kind = "else";
  class p extends w {
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
        h = this.else = Array.isArray(b) ? new $(b) : b;
      }
      if (h)
        return l === !1 ? h instanceof p ? h : h.nodes : this.nodes.length ? this : new p(V(l), h instanceof p ? [h] : h.nodes);
      if (!(l === !1 || !this.nodes.length))
        return this;
    }
    optimizeNames(l, h) {
      var b;
      if (this.else = (b = this.else) === null || b === void 0 ? void 0 : b.optimizeNames(l, h), !!(super.optimizeNames(l, h) || this.else))
        return this.condition = O(this.condition, l, h), this;
    }
    get names() {
      const l = super.names;
      return ae(l, this.condition), this.else && z(l, this.else.names), l;
    }
  }
  p.kind = "if";
  class E extends w {
  }
  E.kind = "for";
  class N extends E {
    constructor(l) {
      super(), this.iteration = l;
    }
    render(l) {
      return `for(${this.iteration})` + super.render(l);
    }
    optimizeNames(l, h) {
      if (super.optimizeNames(l, h))
        return this.iteration = O(this.iteration, l, h), this;
    }
    get names() {
      return z(super.names, this.iteration.names);
    }
  }
  class R extends E {
    constructor(l, h, b, I) {
      super(), this.varKind = l, this.name = h, this.from = b, this.to = I;
    }
    render(l) {
      const h = l.es5 ? r.varKinds.var : this.varKind, { name: b, from: I, to: j } = this;
      return `for(${h} ${b}=${I}; ${b}<${j}; ${b}++)` + super.render(l);
    }
    get names() {
      const l = ae(super.names, this.from);
      return ae(l, this.to);
    }
  }
  class T extends E {
    constructor(l, h, b, I) {
      super(), this.loop = l, this.varKind = h, this.name = b, this.iterable = I;
    }
    render(l) {
      return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(l);
    }
    optimizeNames(l, h) {
      if (super.optimizeNames(l, h))
        return this.iterable = O(this.iterable, l, h), this;
    }
    get names() {
      return z(super.names, this.iterable.names);
    }
  }
  class C extends w {
    constructor(l, h, b) {
      super(), this.name = l, this.args = h, this.async = b;
    }
    render(l) {
      return `${this.async ? "async " : ""}function ${this.name}(${this.args})` + super.render(l);
    }
  }
  C.kind = "func";
  class k extends y {
    render(l) {
      return "return " + super.render(l);
    }
  }
  k.kind = "return";
  class ce extends w {
    render(l) {
      let h = "try" + super.render(l);
      return this.catch && (h += this.catch.render(l)), this.finally && (h += this.finally.render(l)), h;
    }
    optimizeNodes() {
      var l, h;
      return super.optimizeNodes(), (l = this.catch) === null || l === void 0 || l.optimizeNodes(), (h = this.finally) === null || h === void 0 || h.optimizeNodes(), this;
    }
    optimizeNames(l, h) {
      var b, I;
      return super.optimizeNames(l, h), (b = this.catch) === null || b === void 0 || b.optimizeNames(l, h), (I = this.finally) === null || I === void 0 || I.optimizeNames(l, h), this;
    }
    get names() {
      const l = super.names;
      return this.catch && z(l, this.catch.names), this.finally && z(l, this.finally.names), l;
    }
  }
  class le extends w {
    constructor(l) {
      super(), this.error = l;
    }
    render(l) {
      return `catch(${this.error})` + super.render(l);
    }
  }
  le.kind = "catch";
  class me extends w {
    render(l) {
      return "finally" + super.render(l);
    }
  }
  me.kind = "finally";
  class L {
    constructor(l, h = {}) {
      this._values = {}, this._blockStarts = [], this._constants = {}, this.opts = { ...h, _n: h.lines ? `
` : "" }, this._extScope = l, this._scope = new r.Scope({ parent: l }), this._nodes = [new g()];
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
    _def(l, h, b, I) {
      const j = this._scope.toName(h);
      return b !== void 0 && I && (this._constants[j.str] = b), this._leafNode(new a(l, j, b)), j;
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
      return typeof l == "function" ? l() : l !== t.nil && this._leafNode(new _(l)), this;
    }
    // returns code for object literal for the passed argument list of key-value pairs
    object(...l) {
      const h = ["{"];
      for (const [b, I] of l)
        h.length > 1 && h.push(","), h.push(b), (b !== I || this.opts.es5) && (h.push(":"), (0, t.addCodeArg)(h, I));
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
      return this._elseNode(new $());
    }
    // end `if` statement (needed if gen.if was used only with condition)
    endIf() {
      return this._endBlockNode(p, $);
    }
    _for(l, h) {
      return this._blockNode(l), h && this.code(h).endFor(), this;
    }
    // a generic `for` clause (or statement if `forBody` is passed)
    for(l, h) {
      return this._for(new N(l), h);
    }
    // `for` statement for a range of values
    forRange(l, h, b, I, j = this.opts.es5 ? r.varKinds.var : r.varKinds.let) {
      const H = this._scope.toName(l);
      return this._for(new R(j, H, h, b), () => I(H));
    }
    // `for-of` statement (in es5 mode replace with a normal for loop)
    forOf(l, h, b, I = r.varKinds.const) {
      const j = this._scope.toName(l);
      if (this.opts.es5) {
        const H = h instanceof t.Name ? h : this.var("_arr", h);
        return this.forRange("_i", 0, (0, t._)`${H}.length`, (K) => {
          this.var(j, (0, t._)`${H}[${K}]`), b(j);
        });
      }
      return this._for(new T("of", I, j, h), () => b(j));
    }
    // `for-in` statement.
    // With option `ownProperties` replaced with a `for-of` loop for object keys
    forIn(l, h, b, I = this.opts.es5 ? r.varKinds.var : r.varKinds.const) {
      if (this.opts.ownProperties)
        return this.forOf(l, (0, t._)`Object.keys(${h})`, b);
      const j = this._scope.toName(l);
      return this._for(new T("in", I, j, h), () => b(j));
    }
    // end `for` loop
    endFor() {
      return this._endBlockNode(E);
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
      const h = new k();
      if (this._blockNode(h), this.code(l), h.nodes.length !== 1)
        throw new Error('CodeGen: "return" should have one node');
      return this._endBlockNode(k);
    }
    // `try` statement
    try(l, h, b) {
      if (!h && !b)
        throw new Error('CodeGen: "try" without "catch" and "finally"');
      const I = new ce();
      if (this._blockNode(I), this.code(l), h) {
        const j = this.name("e");
        this._currNode = I.catch = new le(j), h(j);
      }
      return b && (this._currNode = I.finally = new me(), this.code(b)), this._endBlockNode(le, me);
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
    func(l, h = t.nil, b, I) {
      return this._blockNode(new C(l, h, b)), I && this.code(I).endFunc(), this;
    }
    // end function definition
    endFunc() {
      return this._endBlockNode(C);
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
  e.CodeGen = L;
  function z(v, l) {
    for (const h in l)
      v[h] = (v[h] || 0) + (l[h] || 0);
    return v;
  }
  function ae(v, l) {
    return l instanceof t._CodeOrName ? z(v, l.names) : v;
  }
  function O(v, l, h) {
    if (v instanceof t.Name)
      return b(v);
    if (!I(v))
      return v;
    return new t._Code(v._items.reduce((j, H) => (H instanceof t.Name && (H = b(H)), H instanceof t._Code ? j.push(...H._items) : j.push(H), j), []));
    function b(j) {
      const H = h[j.str];
      return H === void 0 || l[j.str] !== 1 ? j : (delete l[j.str], H);
    }
    function I(j) {
      return j instanceof t._Code && j._items.some((H) => H instanceof t.Name && l[H.str] === 1 && h[H.str] !== void 0);
    }
  }
  function A(v, l) {
    for (const h in l)
      v[h] = (v[h] || 0) - (l[h] || 0);
  }
  function V(v) {
    return typeof v == "boolean" || typeof v == "number" || v === null ? !v : (0, t._)`!${S(v)}`;
  }
  e.not = V;
  const D = m(e.operators.AND);
  function G(...v) {
    return v.reduce(D);
  }
  e.and = G;
  const M = m(e.operators.OR);
  function P(...v) {
    return v.reduce(M);
  }
  e.or = P;
  function m(v) {
    return (l, h) => l === t.nil ? h : h === t.nil ? l : (0, t._)`${S(l)} ${v} ${S(h)}`;
  }
  function S(v) {
    return v instanceof t.Name ? v : (0, t._)`(${v})`;
  }
})(ne);
var U = {};
Object.defineProperty(U, "__esModule", { value: !0 });
U.checkStrictMode = U.getErrorPath = U.Type = U.useFunc = U.setEvaluated = U.evaluatedPropsToName = U.mergeEvaluated = U.eachItem = U.unescapeJsonPointer = U.escapeJsonPointer = U.escapeFragment = U.unescapeFragment = U.schemaRefOrVal = U.schemaHasRulesButRef = U.schemaHasRules = U.checkUnknownRules = U.alwaysValidSchema = U.toHash = void 0;
const de = ne, e_ = _n;
function t_(e) {
  const t = {};
  for (const r of e)
    t[r] = !0;
  return t;
}
U.toHash = t_;
function r_(e, t) {
  return typeof t == "boolean" ? t : Object.keys(t).length === 0 ? !0 : (wu(e, t), !Su(t, e.self.RULES.all));
}
U.alwaysValidSchema = r_;
function wu(e, t = e.schema) {
  const { opts: r, self: n } = e;
  if (!r.strictSchema || typeof t == "boolean")
    return;
  const s = n.RULES.keywords;
  for (const o in t)
    s[o] || Nu(e, `unknown keyword: "${o}"`);
}
U.checkUnknownRules = wu;
function Su(e, t) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (t[r])
      return !0;
  return !1;
}
U.schemaHasRules = Su;
function n_(e, t) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (r !== "$ref" && t.all[r])
      return !0;
  return !1;
}
U.schemaHasRulesButRef = n_;
function s_({ topSchemaRef: e, schemaPath: t }, r, n, s) {
  if (!s) {
    if (typeof r == "number" || typeof r == "boolean")
      return r;
    if (typeof r == "string")
      return (0, de._)`${r}`;
  }
  return (0, de._)`${e}${t}${(0, de.getProperty)(n)}`;
}
U.schemaRefOrVal = s_;
function o_(e) {
  return bu(decodeURIComponent(e));
}
U.unescapeFragment = o_;
function a_(e) {
  return encodeURIComponent(Va(e));
}
U.escapeFragment = a_;
function Va(e) {
  return typeof e == "number" ? `${e}` : e.replace(/~/g, "~0").replace(/\//g, "~1");
}
U.escapeJsonPointer = Va;
function bu(e) {
  return e.replace(/~1/g, "/").replace(/~0/g, "~");
}
U.unescapeJsonPointer = bu;
function i_(e, t) {
  if (Array.isArray(e))
    for (const r of e)
      t(r);
  else
    t(e);
}
U.eachItem = i_;
function _c({ mergeNames: e, mergeToName: t, mergeValues: r, resultToName: n }) {
  return (s, o, a, i) => {
    const c = a === void 0 ? o : a instanceof de.Name ? (o instanceof de.Name ? e(s, o, a) : t(s, o, a), a) : o instanceof de.Name ? (t(s, a, o), o) : r(o, a);
    return i === de.Name && !(c instanceof de.Name) ? n(s, c) : c;
  };
}
U.mergeEvaluated = {
  props: _c({
    mergeNames: (e, t, r) => e.if((0, de._)`${r} !== true && ${t} !== undefined`, () => {
      e.if((0, de._)`${t} === true`, () => e.assign(r, !0), () => e.assign(r, (0, de._)`${r} || {}`).code((0, de._)`Object.assign(${r}, ${t})`));
    }),
    mergeToName: (e, t, r) => e.if((0, de._)`${r} !== true`, () => {
      t === !0 ? e.assign(r, !0) : (e.assign(r, (0, de._)`${r} || {}`), Ua(e, r, t));
    }),
    mergeValues: (e, t) => e === !0 ? !0 : { ...e, ...t },
    resultToName: Pu
  }),
  items: _c({
    mergeNames: (e, t, r) => e.if((0, de._)`${r} !== true && ${t} !== undefined`, () => e.assign(r, (0, de._)`${t} === true ? true : ${r} > ${t} ? ${r} : ${t}`)),
    mergeToName: (e, t, r) => e.if((0, de._)`${r} !== true`, () => e.assign(r, t === !0 ? !0 : (0, de._)`${r} > ${t} ? ${r} : ${t}`)),
    mergeValues: (e, t) => e === !0 ? !0 : Math.max(e, t),
    resultToName: (e, t) => e.var("items", t)
  })
};
function Pu(e, t) {
  if (t === !0)
    return e.var("props", !0);
  const r = e.var("props", (0, de._)`{}`);
  return t !== void 0 && Ua(e, r, t), r;
}
U.evaluatedPropsToName = Pu;
function Ua(e, t, r) {
  Object.keys(r).forEach((n) => e.assign((0, de._)`${t}${(0, de.getProperty)(n)}`, !0));
}
U.setEvaluated = Ua;
const vc = {};
function c_(e, t) {
  return e.scopeValue("func", {
    ref: t,
    code: vc[t.code] || (vc[t.code] = new e_._Code(t.code))
  });
}
U.useFunc = c_;
var bo;
(function(e) {
  e[e.Num = 0] = "Num", e[e.Str = 1] = "Str";
})(bo || (U.Type = bo = {}));
function l_(e, t, r) {
  if (e instanceof de.Name) {
    const n = t === bo.Num;
    return r ? n ? (0, de._)`"[" + ${e} + "]"` : (0, de._)`"['" + ${e} + "']"` : n ? (0, de._)`"/" + ${e}` : (0, de._)`"/" + ${e}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
  }
  return r ? (0, de.getProperty)(e).toString() : "/" + Va(e);
}
U.getErrorPath = l_;
function Nu(e, t, r = e.opts.strictSchema) {
  if (r) {
    if (t = `strict mode: ${t}`, r === !0)
      throw new Error(t);
    e.self.logger.warn(t);
  }
}
U.checkStrictMode = Nu;
var gt = {};
Object.defineProperty(gt, "__esModule", { value: !0 });
const je = ne, u_ = {
  // validation function arguments
  data: new je.Name("data"),
  // data passed to validation function
  // args passed from referencing schema
  valCxt: new je.Name("valCxt"),
  // validation/data context - should not be used directly, it is destructured to the names below
  instancePath: new je.Name("instancePath"),
  parentData: new je.Name("parentData"),
  parentDataProperty: new je.Name("parentDataProperty"),
  rootData: new je.Name("rootData"),
  // root data - same as the data passed to the first/top validation function
  dynamicAnchors: new je.Name("dynamicAnchors"),
  // used to support recursiveRef and dynamicRef
  // function scoped variables
  vErrors: new je.Name("vErrors"),
  // null or array of validation errors
  errors: new je.Name("errors"),
  // counter of validation errors
  this: new je.Name("this"),
  // "globals"
  self: new je.Name("self"),
  scope: new je.Name("scope"),
  // JTD serialize/parse name for JSON string and position
  json: new je.Name("json"),
  jsonPos: new je.Name("jsonPos"),
  jsonLen: new je.Name("jsonLen"),
  jsonPart: new je.Name("jsonPart")
};
gt.default = u_;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.extendErrors = e.resetErrorsCount = e.reportExtraError = e.reportError = e.keyword$DataError = e.keywordError = void 0;
  const t = ne, r = U, n = gt;
  e.keywordError = {
    message: ({ keyword: $ }) => (0, t.str)`must pass "${$}" keyword validation`
  }, e.keyword$DataError = {
    message: ({ keyword: $, schemaType: p }) => p ? (0, t.str)`"${$}" keyword must be ${p} ($data)` : (0, t.str)`"${$}" keyword is invalid ($data)`
  };
  function s($, p = e.keywordError, E, N) {
    const { it: R } = $, { gen: T, compositeRule: C, allErrors: k } = R, ce = f($, p, E);
    N ?? (C || k) ? c(T, ce) : d(R, (0, t._)`[${ce}]`);
  }
  e.reportError = s;
  function o($, p = e.keywordError, E) {
    const { it: N } = $, { gen: R, compositeRule: T, allErrors: C } = N, k = f($, p, E);
    c(R, k), T || C || d(N, n.default.vErrors);
  }
  e.reportExtraError = o;
  function a($, p) {
    $.assign(n.default.errors, p), $.if((0, t._)`${n.default.vErrors} !== null`, () => $.if(p, () => $.assign((0, t._)`${n.default.vErrors}.length`, p), () => $.assign(n.default.vErrors, null)));
  }
  e.resetErrorsCount = a;
  function i({ gen: $, keyword: p, schemaValue: E, data: N, errsCount: R, it: T }) {
    if (R === void 0)
      throw new Error("ajv implementation error");
    const C = $.name("err");
    $.forRange("i", R, n.default.errors, (k) => {
      $.const(C, (0, t._)`${n.default.vErrors}[${k}]`), $.if((0, t._)`${C}.instancePath === undefined`, () => $.assign((0, t._)`${C}.instancePath`, (0, t.strConcat)(n.default.instancePath, T.errorPath))), $.assign((0, t._)`${C}.schemaPath`, (0, t.str)`${T.errSchemaPath}/${p}`), T.opts.verbose && ($.assign((0, t._)`${C}.schema`, E), $.assign((0, t._)`${C}.data`, N));
    });
  }
  e.extendErrors = i;
  function c($, p) {
    const E = $.const("err", p);
    $.if((0, t._)`${n.default.vErrors} === null`, () => $.assign(n.default.vErrors, (0, t._)`[${E}]`), (0, t._)`${n.default.vErrors}.push(${E})`), $.code((0, t._)`${n.default.errors}++`);
  }
  function d($, p) {
    const { gen: E, validateName: N, schemaEnv: R } = $;
    R.$async ? E.throw((0, t._)`new ${$.ValidationError}(${p})`) : (E.assign((0, t._)`${N}.errors`, p), E.return(!1));
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
  function f($, p, E) {
    const { createErrors: N } = $.it;
    return N === !1 ? (0, t._)`{}` : _($, p, E);
  }
  function _($, p, E = {}) {
    const { gen: N, it: R } = $, T = [
      y(R, E),
      w($, E)
    ];
    return g($, p, T), N.object(...T);
  }
  function y({ errorPath: $ }, { instancePath: p }) {
    const E = p ? (0, t.str)`${$}${(0, r.getErrorPath)(p, r.Type.Str)}` : $;
    return [n.default.instancePath, (0, t.strConcat)(n.default.instancePath, E)];
  }
  function w({ keyword: $, it: { errSchemaPath: p } }, { schemaPath: E, parentSchema: N }) {
    let R = N ? p : (0, t.str)`${p}/${$}`;
    return E && (R = (0, t.str)`${R}${(0, r.getErrorPath)(E, r.Type.Str)}`), [u.schemaPath, R];
  }
  function g($, { params: p, message: E }, N) {
    const { keyword: R, data: T, schemaValue: C, it: k } = $, { opts: ce, propertyName: le, topSchemaRef: me, schemaPath: L } = k;
    N.push([u.keyword, R], [u.params, typeof p == "function" ? p($) : p || (0, t._)`{}`]), ce.messages && N.push([u.message, typeof E == "function" ? E($) : E]), ce.verbose && N.push([u.schema, C], [u.parentSchema, (0, t._)`${me}${L}`], [n.default.data, T]), le && N.push([u.propertyName, le]);
  }
})(wn);
Object.defineProperty(Vr, "__esModule", { value: !0 });
Vr.boolOrEmptySchema = Vr.topBoolOrEmptySchema = void 0;
const d_ = wn, f_ = ne, h_ = gt, p_ = {
  message: "boolean schema is false"
};
function m_(e) {
  const { gen: t, schema: r, validateName: n } = e;
  r === !1 ? Ru(e, !1) : typeof r == "object" && r.$async === !0 ? t.return(h_.default.data) : (t.assign((0, f_._)`${n}.errors`, null), t.return(!0));
}
Vr.topBoolOrEmptySchema = m_;
function y_(e, t) {
  const { gen: r, schema: n } = e;
  n === !1 ? (r.var(t, !1), Ru(e)) : r.var(t, !0);
}
Vr.boolOrEmptySchema = y_;
function Ru(e, t) {
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
  (0, d_.reportError)(s, p_, void 0, t);
}
var we = {}, vr = {};
Object.defineProperty(vr, "__esModule", { value: !0 });
vr.getRules = vr.isJSONType = void 0;
const $_ = ["string", "number", "integer", "boolean", "null", "object", "array"], g_ = new Set($_);
function __(e) {
  return typeof e == "string" && g_.has(e);
}
vr.isJSONType = __;
function v_() {
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
vr.getRules = v_;
var St = {};
Object.defineProperty(St, "__esModule", { value: !0 });
St.shouldUseRule = St.shouldUseGroup = St.schemaHasRulesForType = void 0;
function E_({ schema: e, self: t }, r) {
  const n = t.RULES.types[r];
  return n && n !== !0 && Tu(e, n);
}
St.schemaHasRulesForType = E_;
function Tu(e, t) {
  return t.rules.some((r) => Ou(e, r));
}
St.shouldUseGroup = Tu;
function Ou(e, t) {
  var r;
  return e[t.keyword] !== void 0 || ((r = t.definition.implements) === null || r === void 0 ? void 0 : r.some((n) => e[n] !== void 0));
}
St.shouldUseRule = Ou;
Object.defineProperty(we, "__esModule", { value: !0 });
we.reportTypeError = we.checkDataTypes = we.checkDataType = we.coerceAndCheckDataType = we.getJSONTypes = we.getSchemaTypes = we.DataType = void 0;
const w_ = vr, S_ = St, b_ = wn, re = ne, Iu = U;
var kr;
(function(e) {
  e[e.Correct = 0] = "Correct", e[e.Wrong = 1] = "Wrong";
})(kr || (we.DataType = kr = {}));
function P_(e) {
  const t = ju(e.type);
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
we.getSchemaTypes = P_;
function ju(e) {
  const t = Array.isArray(e) ? e : e ? [e] : [];
  if (t.every(w_.isJSONType))
    return t;
  throw new Error("type must be JSONType or JSONType[]: " + t.join(","));
}
we.getJSONTypes = ju;
function N_(e, t) {
  const { gen: r, data: n, opts: s } = e, o = R_(t, s.coerceTypes), a = t.length > 0 && !(o.length === 0 && t.length === 1 && (0, S_.schemaHasRulesForType)(e, t[0]));
  if (a) {
    const i = za(t, n, s.strictNumbers, kr.Wrong);
    r.if(i, () => {
      o.length ? T_(e, t, o) : qa(e);
    });
  }
  return a;
}
we.coerceAndCheckDataType = N_;
const Au = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
function R_(e, t) {
  return t ? e.filter((r) => Au.has(r) || t === "array" && r === "array") : [];
}
function T_(e, t, r) {
  const { gen: n, data: s, opts: o } = e, a = n.let("dataType", (0, re._)`typeof ${s}`), i = n.let("coerced", (0, re._)`undefined`);
  o.coerceTypes === "array" && n.if((0, re._)`${a} == 'object' && Array.isArray(${s}) && ${s}.length == 1`, () => n.assign(s, (0, re._)`${s}[0]`).assign(a, (0, re._)`typeof ${s}`).if(za(t, s, o.strictNumbers), () => n.assign(i, s))), n.if((0, re._)`${i} !== undefined`);
  for (const d of r)
    (Au.has(d) || d === "array" && o.coerceTypes === "array") && c(d);
  n.else(), qa(e), n.endIf(), n.if((0, re._)`${i} !== undefined`, () => {
    n.assign(s, i), O_(e, i);
  });
  function c(d) {
    switch (d) {
      case "string":
        n.elseIf((0, re._)`${a} == "number" || ${a} == "boolean"`).assign(i, (0, re._)`"" + ${s}`).elseIf((0, re._)`${s} === null`).assign(i, (0, re._)`""`);
        return;
      case "number":
        n.elseIf((0, re._)`${a} == "boolean" || ${s} === null
              || (${a} == "string" && ${s} && ${s} == +${s})`).assign(i, (0, re._)`+${s}`);
        return;
      case "integer":
        n.elseIf((0, re._)`${a} === "boolean" || ${s} === null
              || (${a} === "string" && ${s} && ${s} == +${s} && !(${s} % 1))`).assign(i, (0, re._)`+${s}`);
        return;
      case "boolean":
        n.elseIf((0, re._)`${s} === "false" || ${s} === 0 || ${s} === null`).assign(i, !1).elseIf((0, re._)`${s} === "true" || ${s} === 1`).assign(i, !0);
        return;
      case "null":
        n.elseIf((0, re._)`${s} === "" || ${s} === 0 || ${s} === false`), n.assign(i, null);
        return;
      case "array":
        n.elseIf((0, re._)`${a} === "string" || ${a} === "number"
              || ${a} === "boolean" || ${s} === null`).assign(i, (0, re._)`[${s}]`);
    }
  }
}
function O_({ gen: e, parentData: t, parentDataProperty: r }, n) {
  e.if((0, re._)`${t} !== undefined`, () => e.assign((0, re._)`${t}[${r}]`, n));
}
function Po(e, t, r, n = kr.Correct) {
  const s = n === kr.Correct ? re.operators.EQ : re.operators.NEQ;
  let o;
  switch (e) {
    case "null":
      return (0, re._)`${t} ${s} null`;
    case "array":
      o = (0, re._)`Array.isArray(${t})`;
      break;
    case "object":
      o = (0, re._)`${t} && typeof ${t} == "object" && !Array.isArray(${t})`;
      break;
    case "integer":
      o = a((0, re._)`!(${t} % 1) && !isNaN(${t})`);
      break;
    case "number":
      o = a();
      break;
    default:
      return (0, re._)`typeof ${t} ${s} ${e}`;
  }
  return n === kr.Correct ? o : (0, re.not)(o);
  function a(i = re.nil) {
    return (0, re.and)((0, re._)`typeof ${t} == "number"`, i, r ? (0, re._)`isFinite(${t})` : re.nil);
  }
}
we.checkDataType = Po;
function za(e, t, r, n) {
  if (e.length === 1)
    return Po(e[0], t, r, n);
  let s;
  const o = (0, Iu.toHash)(e);
  if (o.array && o.object) {
    const a = (0, re._)`typeof ${t} != "object"`;
    s = o.null ? a : (0, re._)`!${t} || ${a}`, delete o.null, delete o.array, delete o.object;
  } else
    s = re.nil;
  o.number && delete o.integer;
  for (const a in o)
    s = (0, re.and)(s, Po(a, t, r, n));
  return s;
}
we.checkDataTypes = za;
const I_ = {
  message: ({ schema: e }) => `must be ${e}`,
  params: ({ schema: e, schemaValue: t }) => typeof e == "string" ? (0, re._)`{type: ${e}}` : (0, re._)`{type: ${t}}`
};
function qa(e) {
  const t = j_(e);
  (0, b_.reportError)(t, I_);
}
we.reportTypeError = qa;
function j_(e) {
  const { gen: t, data: r, schema: n } = e, s = (0, Iu.schemaRefOrVal)(e, n, "type");
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
var Ts = {};
Object.defineProperty(Ts, "__esModule", { value: !0 });
Ts.assignDefaults = void 0;
const br = ne, A_ = U;
function C_(e, t) {
  const { properties: r, items: n } = e.schema;
  if (t === "object" && r)
    for (const s in r)
      Ec(e, s, r[s].default);
  else t === "array" && Array.isArray(n) && n.forEach((s, o) => Ec(e, o, s.default));
}
Ts.assignDefaults = C_;
function Ec(e, t, r) {
  const { gen: n, compositeRule: s, data: o, opts: a } = e;
  if (r === void 0)
    return;
  const i = (0, br._)`${o}${(0, br.getProperty)(t)}`;
  if (s) {
    (0, A_.checkStrictMode)(e, `default is ignored for: ${i}`);
    return;
  }
  let c = (0, br._)`${i} === undefined`;
  a.useDefaults === "empty" && (c = (0, br._)`${c} || ${i} === null || ${i} === ""`), n.if(c, (0, br._)`${i} = ${(0, br.stringify)(r)}`);
}
var $t = {}, oe = {};
Object.defineProperty(oe, "__esModule", { value: !0 });
oe.validateUnion = oe.validateArray = oe.usePattern = oe.callValidateCode = oe.schemaProperties = oe.allSchemaProperties = oe.noPropertyInData = oe.propertyInData = oe.isOwnProperty = oe.hasPropFunc = oe.reportMissingProp = oe.checkMissingProp = oe.checkReportMissingProp = void 0;
const he = ne, Ga = U, Ct = gt, k_ = U;
function D_(e, t) {
  const { gen: r, data: n, it: s } = e;
  r.if(Ha(r, n, t, s.opts.ownProperties), () => {
    e.setParams({ missingProperty: (0, he._)`${t}` }, !0), e.error();
  });
}
oe.checkReportMissingProp = D_;
function M_({ gen: e, data: t, it: { opts: r } }, n, s) {
  return (0, he.or)(...n.map((o) => (0, he.and)(Ha(e, t, o, r.ownProperties), (0, he._)`${s} = ${o}`)));
}
oe.checkMissingProp = M_;
function L_(e, t) {
  e.setParams({ missingProperty: t }, !0), e.error();
}
oe.reportMissingProp = L_;
function Cu(e) {
  return e.scopeValue("func", {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    ref: Object.prototype.hasOwnProperty,
    code: (0, he._)`Object.prototype.hasOwnProperty`
  });
}
oe.hasPropFunc = Cu;
function Ka(e, t, r) {
  return (0, he._)`${Cu(e)}.call(${t}, ${r})`;
}
oe.isOwnProperty = Ka;
function F_(e, t, r, n) {
  const s = (0, he._)`${t}${(0, he.getProperty)(r)} !== undefined`;
  return n ? (0, he._)`${s} && ${Ka(e, t, r)}` : s;
}
oe.propertyInData = F_;
function Ha(e, t, r, n) {
  const s = (0, he._)`${t}${(0, he.getProperty)(r)} === undefined`;
  return n ? (0, he.or)(s, (0, he.not)(Ka(e, t, r))) : s;
}
oe.noPropertyInData = Ha;
function ku(e) {
  return e ? Object.keys(e).filter((t) => t !== "__proto__") : [];
}
oe.allSchemaProperties = ku;
function V_(e, t) {
  return ku(t).filter((r) => !(0, Ga.alwaysValidSchema)(e, t[r]));
}
oe.schemaProperties = V_;
function U_({ schemaCode: e, data: t, it: { gen: r, topSchemaRef: n, schemaPath: s, errorPath: o }, it: a }, i, c, d) {
  const u = d ? (0, he._)`${e}, ${t}, ${n}${s}` : t, f = [
    [Ct.default.instancePath, (0, he.strConcat)(Ct.default.instancePath, o)],
    [Ct.default.parentData, a.parentData],
    [Ct.default.parentDataProperty, a.parentDataProperty],
    [Ct.default.rootData, Ct.default.rootData]
  ];
  a.opts.dynamicRef && f.push([Ct.default.dynamicAnchors, Ct.default.dynamicAnchors]);
  const _ = (0, he._)`${u}, ${r.object(...f)}`;
  return c !== he.nil ? (0, he._)`${i}.call(${c}, ${_})` : (0, he._)`${i}(${_})`;
}
oe.callValidateCode = U_;
const z_ = (0, he._)`new RegExp`;
function q_({ gen: e, it: { opts: t } }, r) {
  const n = t.unicodeRegExp ? "u" : "", { regExp: s } = t.code, o = s(r, n);
  return e.scopeValue("pattern", {
    key: o.toString(),
    ref: o,
    code: (0, he._)`${s.code === "new RegExp" ? z_ : (0, k_.useFunc)(e, s)}(${r}, ${n})`
  });
}
oe.usePattern = q_;
function G_(e) {
  const { gen: t, data: r, keyword: n, it: s } = e, o = t.name("valid");
  if (s.allErrors) {
    const i = t.let("valid", !0);
    return a(() => t.assign(i, !1)), i;
  }
  return t.var(o, !0), a(() => t.break()), o;
  function a(i) {
    const c = t.const("len", (0, he._)`${r}.length`);
    t.forRange("i", 0, c, (d) => {
      e.subschema({
        keyword: n,
        dataProp: d,
        dataPropType: Ga.Type.Num
      }, o), t.if((0, he.not)(o), i);
    });
  }
}
oe.validateArray = G_;
function K_(e) {
  const { gen: t, schema: r, keyword: n, it: s } = e;
  if (!Array.isArray(r))
    throw new Error("ajv implementation error");
  if (r.some((c) => (0, Ga.alwaysValidSchema)(s, c)) && !s.opts.unevaluated)
    return;
  const a = t.let("valid", !1), i = t.name("_valid");
  t.block(() => r.forEach((c, d) => {
    const u = e.subschema({
      keyword: n,
      schemaProp: d,
      compositeRule: !0
    }, i);
    t.assign(a, (0, he._)`${a} || ${i}`), e.mergeValidEvaluated(u, i) || t.if((0, he.not)(a));
  })), e.result(a, () => e.reset(), () => e.error(!0));
}
oe.validateUnion = K_;
Object.defineProperty($t, "__esModule", { value: !0 });
$t.validateKeywordUsage = $t.validSchemaType = $t.funcKeywordCode = $t.macroKeywordCode = void 0;
const Le = ne, hr = gt, H_ = oe, B_ = wn;
function W_(e, t) {
  const { gen: r, keyword: n, schema: s, parentSchema: o, it: a } = e, i = t.macro.call(a.self, s, o, a), c = Du(r, n, i);
  a.opts.validateSchema !== !1 && a.self.validateSchema(i, !0);
  const d = r.name("valid");
  e.subschema({
    schema: i,
    schemaPath: Le.nil,
    errSchemaPath: `${a.errSchemaPath}/${n}`,
    topSchemaRef: c,
    compositeRule: !0
  }, d), e.pass(d, () => e.error(!0));
}
$t.macroKeywordCode = W_;
function J_(e, t) {
  var r;
  const { gen: n, keyword: s, schema: o, parentSchema: a, $data: i, it: c } = e;
  Y_(c, t);
  const d = !i && t.compile ? t.compile.call(c.self, o, a, c) : t.validate, u = Du(n, s, d), f = n.let("valid");
  e.block$data(f, _), e.ok((r = t.valid) !== null && r !== void 0 ? r : f);
  function _() {
    if (t.errors === !1)
      g(), t.modifying && wc(e), $(() => e.error());
    else {
      const p = t.async ? y() : w();
      t.modifying && wc(e), $(() => X_(e, p));
    }
  }
  function y() {
    const p = n.let("ruleErrs", null);
    return n.try(() => g((0, Le._)`await `), (E) => n.assign(f, !1).if((0, Le._)`${E} instanceof ${c.ValidationError}`, () => n.assign(p, (0, Le._)`${E}.errors`), () => n.throw(E))), p;
  }
  function w() {
    const p = (0, Le._)`${u}.errors`;
    return n.assign(p, null), g(Le.nil), p;
  }
  function g(p = t.async ? (0, Le._)`await ` : Le.nil) {
    const E = c.opts.passContext ? hr.default.this : hr.default.self, N = !("compile" in t && !i || t.schema === !1);
    n.assign(f, (0, Le._)`${p}${(0, H_.callValidateCode)(e, u, E, N)}`, t.modifying);
  }
  function $(p) {
    var E;
    n.if((0, Le.not)((E = t.valid) !== null && E !== void 0 ? E : f), p);
  }
}
$t.funcKeywordCode = J_;
function wc(e) {
  const { gen: t, data: r, it: n } = e;
  t.if(n.parentData, () => t.assign(r, (0, Le._)`${n.parentData}[${n.parentDataProperty}]`));
}
function X_(e, t) {
  const { gen: r } = e;
  r.if((0, Le._)`Array.isArray(${t})`, () => {
    r.assign(hr.default.vErrors, (0, Le._)`${hr.default.vErrors} === null ? ${t} : ${hr.default.vErrors}.concat(${t})`).assign(hr.default.errors, (0, Le._)`${hr.default.vErrors}.length`), (0, B_.extendErrors)(e);
  }, () => e.error());
}
function Y_({ schemaEnv: e }, t) {
  if (t.async && !e.$async)
    throw new Error("async keyword in sync schema");
}
function Du(e, t, r) {
  if (r === void 0)
    throw new Error(`keyword "${t}" failed to compile`);
  return e.scopeValue("keyword", typeof r == "function" ? { ref: r } : { ref: r, code: (0, Le.stringify)(r) });
}
function x_(e, t, r = !1) {
  return !t.length || t.some((n) => n === "array" ? Array.isArray(e) : n === "object" ? e && typeof e == "object" && !Array.isArray(e) : typeof e == n || r && typeof e > "u");
}
$t.validSchemaType = x_;
function Q_({ schema: e, opts: t, self: r, errSchemaPath: n }, s, o) {
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
$t.validateKeywordUsage = Q_;
var Kt = {};
Object.defineProperty(Kt, "__esModule", { value: !0 });
Kt.extendSubschemaMode = Kt.extendSubschemaData = Kt.getSubschema = void 0;
const ht = ne, Mu = U;
function Z_(e, { keyword: t, schemaProp: r, schema: n, schemaPath: s, errSchemaPath: o, topSchemaRef: a }) {
  if (t !== void 0 && n !== void 0)
    throw new Error('both "keyword" and "schema" passed, only one allowed');
  if (t !== void 0) {
    const i = e.schema[t];
    return r === void 0 ? {
      schema: i,
      schemaPath: (0, ht._)`${e.schemaPath}${(0, ht.getProperty)(t)}`,
      errSchemaPath: `${e.errSchemaPath}/${t}`
    } : {
      schema: i[r],
      schemaPath: (0, ht._)`${e.schemaPath}${(0, ht.getProperty)(t)}${(0, ht.getProperty)(r)}`,
      errSchemaPath: `${e.errSchemaPath}/${t}/${(0, Mu.escapeFragment)(r)}`
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
Kt.getSubschema = Z_;
function e0(e, t, { dataProp: r, dataPropType: n, data: s, dataTypes: o, propertyName: a }) {
  if (s !== void 0 && r !== void 0)
    throw new Error('both "data" and "dataProp" passed, only one allowed');
  const { gen: i } = t;
  if (r !== void 0) {
    const { errorPath: d, dataPathArr: u, opts: f } = t, _ = i.let("data", (0, ht._)`${t.data}${(0, ht.getProperty)(r)}`, !0);
    c(_), e.errorPath = (0, ht.str)`${d}${(0, Mu.getErrorPath)(r, n, f.jsPropertySyntax)}`, e.parentDataProperty = (0, ht._)`${r}`, e.dataPathArr = [...u, e.parentDataProperty];
  }
  if (s !== void 0) {
    const d = s instanceof ht.Name ? s : i.let("data", s, !0);
    c(d), a !== void 0 && (e.propertyName = a);
  }
  o && (e.dataTypes = o);
  function c(d) {
    e.data = d, e.dataLevel = t.dataLevel + 1, e.dataTypes = [], t.definedProperties = /* @__PURE__ */ new Set(), e.parentData = t.data, e.dataNames = [...t.dataNames, d];
  }
}
Kt.extendSubschemaData = e0;
function t0(e, { jtdDiscriminator: t, jtdMetadata: r, compositeRule: n, createErrors: s, allErrors: o }) {
  n !== void 0 && (e.compositeRule = n), s !== void 0 && (e.createErrors = s), o !== void 0 && (e.allErrors = o), e.jtdDiscriminator = t, e.jtdMetadata = r;
}
Kt.extendSubschemaMode = t0;
var Re = {}, Lu = { exports: {} }, qt = Lu.exports = function(e, t, r) {
  typeof t == "function" && (r = t, t = {}), r = t.cb || r;
  var n = typeof r == "function" ? r : r.pre || function() {
  }, s = r.post || function() {
  };
  rs(t, n, s, e, "", e);
};
qt.keywords = {
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
qt.arrayKeywords = {
  items: !0,
  allOf: !0,
  anyOf: !0,
  oneOf: !0
};
qt.propsKeywords = {
  $defs: !0,
  definitions: !0,
  properties: !0,
  patternProperties: !0,
  dependencies: !0
};
qt.skipKeywords = {
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
function rs(e, t, r, n, s, o, a, i, c, d) {
  if (n && typeof n == "object" && !Array.isArray(n)) {
    t(n, s, o, a, i, c, d);
    for (var u in n) {
      var f = n[u];
      if (Array.isArray(f)) {
        if (u in qt.arrayKeywords)
          for (var _ = 0; _ < f.length; _++)
            rs(e, t, r, f[_], s + "/" + u + "/" + _, o, s, u, n, _);
      } else if (u in qt.propsKeywords) {
        if (f && typeof f == "object")
          for (var y in f)
            rs(e, t, r, f[y], s + "/" + u + "/" + r0(y), o, s, u, n, y);
      } else (u in qt.keywords || e.allKeys && !(u in qt.skipKeywords)) && rs(e, t, r, f, s + "/" + u, o, s, u, n);
    }
    r(n, s, o, a, i, c, d);
  }
}
function r0(e) {
  return e.replace(/~/g, "~0").replace(/\//g, "~1");
}
var n0 = Lu.exports;
Object.defineProperty(Re, "__esModule", { value: !0 });
Re.getSchemaRefs = Re.resolveUrl = Re.normalizeId = Re._getFullPath = Re.getFullPath = Re.inlineRef = void 0;
const s0 = U, o0 = Es, a0 = n0, i0 = /* @__PURE__ */ new Set([
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
function c0(e, t = !0) {
  return typeof e == "boolean" ? !0 : t === !0 ? !No(e) : t ? Fu(e) <= t : !1;
}
Re.inlineRef = c0;
const l0 = /* @__PURE__ */ new Set([
  "$ref",
  "$recursiveRef",
  "$recursiveAnchor",
  "$dynamicRef",
  "$dynamicAnchor"
]);
function No(e) {
  for (const t in e) {
    if (l0.has(t))
      return !0;
    const r = e[t];
    if (Array.isArray(r) && r.some(No) || typeof r == "object" && No(r))
      return !0;
  }
  return !1;
}
function Fu(e) {
  let t = 0;
  for (const r in e) {
    if (r === "$ref")
      return 1 / 0;
    if (t++, !i0.has(r) && (typeof e[r] == "object" && (0, s0.eachItem)(e[r], (n) => t += Fu(n)), t === 1 / 0))
      return 1 / 0;
  }
  return t;
}
function Vu(e, t = "", r) {
  r !== !1 && (t = Dr(t));
  const n = e.parse(t);
  return Uu(e, n);
}
Re.getFullPath = Vu;
function Uu(e, t) {
  return e.serialize(t).split("#")[0] + "#";
}
Re._getFullPath = Uu;
const u0 = /#\/?$/;
function Dr(e) {
  return e ? e.replace(u0, "") : "";
}
Re.normalizeId = Dr;
function d0(e, t, r) {
  return r = Dr(r), e.resolve(t, r);
}
Re.resolveUrl = d0;
const f0 = /^[a-z_][-a-z0-9._]*$/i;
function h0(e, t) {
  if (typeof e == "boolean")
    return {};
  const { schemaId: r, uriResolver: n } = this.opts, s = Dr(e[r] || t), o = { "": s }, a = Vu(n, s, !1), i = {}, c = /* @__PURE__ */ new Set();
  return a0(e, { allKeys: !0 }, (f, _, y, w) => {
    if (w === void 0)
      return;
    const g = a + _;
    let $ = o[w];
    typeof f[r] == "string" && ($ = p.call(this, f[r])), E.call(this, f.$anchor), E.call(this, f.$dynamicAnchor), o[_] = $;
    function p(N) {
      const R = this.opts.uriResolver.resolve;
      if (N = Dr($ ? R($, N) : N), c.has(N))
        throw u(N);
      c.add(N);
      let T = this.refs[N];
      return typeof T == "string" && (T = this.refs[T]), typeof T == "object" ? d(f, T.schema, N) : N !== Dr(g) && (N[0] === "#" ? (d(f, i[N], N), i[N] = f) : this.refs[N] = g), N;
    }
    function E(N) {
      if (typeof N == "string") {
        if (!f0.test(N))
          throw new Error(`invalid anchor "${N}"`);
        p.call(this, `#${N}`);
      }
    }
  }), i;
  function d(f, _, y) {
    if (_ !== void 0 && !o0(f, _))
      throw u(y);
  }
  function u(f) {
    return new Error(`reference "${f}" resolves to more than one schema`);
  }
}
Re.getSchemaRefs = h0;
Object.defineProperty(at, "__esModule", { value: !0 });
at.getData = at.KeywordCxt = at.validateFunctionCode = void 0;
const zu = Vr, Sc = we, Ba = St, hs = we, p0 = Ts, hn = $t, xs = Kt, W = ne, Y = gt, m0 = Re, bt = U, tn = wn;
function y0(e) {
  if (Ku(e) && (Hu(e), Gu(e))) {
    _0(e);
    return;
  }
  qu(e, () => (0, zu.topBoolOrEmptySchema)(e));
}
at.validateFunctionCode = y0;
function qu({ gen: e, validateName: t, schema: r, schemaEnv: n, opts: s }, o) {
  s.code.es5 ? e.func(t, (0, W._)`${Y.default.data}, ${Y.default.valCxt}`, n.$async, () => {
    e.code((0, W._)`"use strict"; ${bc(r, s)}`), g0(e, s), e.code(o);
  }) : e.func(t, (0, W._)`${Y.default.data}, ${$0(s)}`, n.$async, () => e.code(bc(r, s)).code(o));
}
function $0(e) {
  return (0, W._)`{${Y.default.instancePath}="", ${Y.default.parentData}, ${Y.default.parentDataProperty}, ${Y.default.rootData}=${Y.default.data}${e.dynamicRef ? (0, W._)`, ${Y.default.dynamicAnchors}={}` : W.nil}}={}`;
}
function g0(e, t) {
  e.if(Y.default.valCxt, () => {
    e.var(Y.default.instancePath, (0, W._)`${Y.default.valCxt}.${Y.default.instancePath}`), e.var(Y.default.parentData, (0, W._)`${Y.default.valCxt}.${Y.default.parentData}`), e.var(Y.default.parentDataProperty, (0, W._)`${Y.default.valCxt}.${Y.default.parentDataProperty}`), e.var(Y.default.rootData, (0, W._)`${Y.default.valCxt}.${Y.default.rootData}`), t.dynamicRef && e.var(Y.default.dynamicAnchors, (0, W._)`${Y.default.valCxt}.${Y.default.dynamicAnchors}`);
  }, () => {
    e.var(Y.default.instancePath, (0, W._)`""`), e.var(Y.default.parentData, (0, W._)`undefined`), e.var(Y.default.parentDataProperty, (0, W._)`undefined`), e.var(Y.default.rootData, Y.default.data), t.dynamicRef && e.var(Y.default.dynamicAnchors, (0, W._)`{}`);
  });
}
function _0(e) {
  const { schema: t, opts: r, gen: n } = e;
  qu(e, () => {
    r.$comment && t.$comment && Wu(e), b0(e), n.let(Y.default.vErrors, null), n.let(Y.default.errors, 0), r.unevaluated && v0(e), Bu(e), R0(e);
  });
}
function v0(e) {
  const { gen: t, validateName: r } = e;
  e.evaluated = t.const("evaluated", (0, W._)`${r}.evaluated`), t.if((0, W._)`${e.evaluated}.dynamicProps`, () => t.assign((0, W._)`${e.evaluated}.props`, (0, W._)`undefined`)), t.if((0, W._)`${e.evaluated}.dynamicItems`, () => t.assign((0, W._)`${e.evaluated}.items`, (0, W._)`undefined`));
}
function bc(e, t) {
  const r = typeof e == "object" && e[t.schemaId];
  return r && (t.code.source || t.code.process) ? (0, W._)`/*# sourceURL=${r} */` : W.nil;
}
function E0(e, t) {
  if (Ku(e) && (Hu(e), Gu(e))) {
    w0(e, t);
    return;
  }
  (0, zu.boolOrEmptySchema)(e, t);
}
function Gu({ schema: e, self: t }) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (t.RULES.all[r])
      return !0;
  return !1;
}
function Ku(e) {
  return typeof e.schema != "boolean";
}
function w0(e, t) {
  const { schema: r, gen: n, opts: s } = e;
  s.$comment && r.$comment && Wu(e), P0(e), N0(e);
  const o = n.const("_errs", Y.default.errors);
  Bu(e, o), n.var(t, (0, W._)`${o} === ${Y.default.errors}`);
}
function Hu(e) {
  (0, bt.checkUnknownRules)(e), S0(e);
}
function Bu(e, t) {
  if (e.opts.jtd)
    return Pc(e, [], !1, t);
  const r = (0, Sc.getSchemaTypes)(e.schema), n = (0, Sc.coerceAndCheckDataType)(e, r);
  Pc(e, r, !n, t);
}
function S0(e) {
  const { schema: t, errSchemaPath: r, opts: n, self: s } = e;
  t.$ref && n.ignoreKeywordsWithRef && (0, bt.schemaHasRulesButRef)(t, s.RULES) && s.logger.warn(`$ref: keywords ignored in schema at path "${r}"`);
}
function b0(e) {
  const { schema: t, opts: r } = e;
  t.default !== void 0 && r.useDefaults && r.strictSchema && (0, bt.checkStrictMode)(e, "default is ignored in the schema root");
}
function P0(e) {
  const t = e.schema[e.opts.schemaId];
  t && (e.baseId = (0, m0.resolveUrl)(e.opts.uriResolver, e.baseId, t));
}
function N0(e) {
  if (e.schema.$async && !e.schemaEnv.$async)
    throw new Error("async schema in sync schema");
}
function Wu({ gen: e, schemaEnv: t, schema: r, errSchemaPath: n, opts: s }) {
  const o = r.$comment;
  if (s.$comment === !0)
    e.code((0, W._)`${Y.default.self}.logger.log(${o})`);
  else if (typeof s.$comment == "function") {
    const a = (0, W.str)`${n}/$comment`, i = e.scopeValue("root", { ref: t.root });
    e.code((0, W._)`${Y.default.self}.opts.$comment(${o}, ${a}, ${i}.schema)`);
  }
}
function R0(e) {
  const { gen: t, schemaEnv: r, validateName: n, ValidationError: s, opts: o } = e;
  r.$async ? t.if((0, W._)`${Y.default.errors} === 0`, () => t.return(Y.default.data), () => t.throw((0, W._)`new ${s}(${Y.default.vErrors})`)) : (t.assign((0, W._)`${n}.errors`, Y.default.vErrors), o.unevaluated && T0(e), t.return((0, W._)`${Y.default.errors} === 0`));
}
function T0({ gen: e, evaluated: t, props: r, items: n }) {
  r instanceof W.Name && e.assign((0, W._)`${t}.props`, r), n instanceof W.Name && e.assign((0, W._)`${t}.items`, n);
}
function Pc(e, t, r, n) {
  const { gen: s, schema: o, data: a, allErrors: i, opts: c, self: d } = e, { RULES: u } = d;
  if (o.$ref && (c.ignoreKeywordsWithRef || !(0, bt.schemaHasRulesButRef)(o, u))) {
    s.block(() => Yu(e, "$ref", u.all.$ref.definition));
    return;
  }
  c.jtd || O0(e, t), s.block(() => {
    for (const _ of u.rules)
      f(_);
    f(u.post);
  });
  function f(_) {
    (0, Ba.shouldUseGroup)(o, _) && (_.type ? (s.if((0, hs.checkDataType)(_.type, a, c.strictNumbers)), Nc(e, _), t.length === 1 && t[0] === _.type && r && (s.else(), (0, hs.reportTypeError)(e)), s.endIf()) : Nc(e, _), i || s.if((0, W._)`${Y.default.errors} === ${n || 0}`));
  }
}
function Nc(e, t) {
  const { gen: r, schema: n, opts: { useDefaults: s } } = e;
  s && (0, p0.assignDefaults)(e, t.type), r.block(() => {
    for (const o of t.rules)
      (0, Ba.shouldUseRule)(n, o) && Yu(e, o.keyword, o.definition, t.type);
  });
}
function O0(e, t) {
  e.schemaEnv.meta || !e.opts.strictTypes || (I0(e, t), e.opts.allowUnionTypes || j0(e, t), A0(e, e.dataTypes));
}
function I0(e, t) {
  if (t.length) {
    if (!e.dataTypes.length) {
      e.dataTypes = t;
      return;
    }
    t.forEach((r) => {
      Ju(e.dataTypes, r) || Wa(e, `type "${r}" not allowed by context "${e.dataTypes.join(",")}"`);
    }), k0(e, t);
  }
}
function j0(e, t) {
  t.length > 1 && !(t.length === 2 && t.includes("null")) && Wa(e, "use allowUnionTypes to allow union type keyword");
}
function A0(e, t) {
  const r = e.self.RULES.all;
  for (const n in r) {
    const s = r[n];
    if (typeof s == "object" && (0, Ba.shouldUseRule)(e.schema, s)) {
      const { type: o } = s.definition;
      o.length && !o.some((a) => C0(t, a)) && Wa(e, `missing type "${o.join(",")}" for keyword "${n}"`);
    }
  }
}
function C0(e, t) {
  return e.includes(t) || t === "number" && e.includes("integer");
}
function Ju(e, t) {
  return e.includes(t) || t === "integer" && e.includes("number");
}
function k0(e, t) {
  const r = [];
  for (const n of e.dataTypes)
    Ju(t, n) ? r.push(n) : t.includes("integer") && n === "number" && r.push("integer");
  e.dataTypes = r;
}
function Wa(e, t) {
  const r = e.schemaEnv.baseId + e.errSchemaPath;
  t += ` at "${r}" (strictTypes)`, (0, bt.checkStrictMode)(e, t, e.opts.strictTypes);
}
class Xu {
  constructor(t, r, n) {
    if ((0, hn.validateKeywordUsage)(t, r, n), this.gen = t.gen, this.allErrors = t.allErrors, this.keyword = n, this.data = t.data, this.schema = t.schema[n], this.$data = r.$data && t.opts.$data && this.schema && this.schema.$data, this.schemaValue = (0, bt.schemaRefOrVal)(t, this.schema, n, this.$data), this.schemaType = r.schemaType, this.parentSchema = t.schema, this.params = {}, this.it = t, this.def = r, this.$data)
      this.schemaCode = t.gen.const("vSchema", xu(this.$data, t));
    else if (this.schemaCode = this.schemaValue, !(0, hn.validSchemaType)(this.schema, r.schemaType, r.allowUndefined))
      throw new Error(`${n} value must be ${JSON.stringify(r.schemaType)}`);
    ("code" in r ? r.trackErrors : r.errors !== !1) && (this.errsCount = t.gen.const("_errs", Y.default.errors));
  }
  result(t, r, n) {
    this.failResult((0, W.not)(t), r, n);
  }
  failResult(t, r, n) {
    this.gen.if(t), n ? n() : this.error(), r ? (this.gen.else(), r(), this.allErrors && this.gen.endIf()) : this.allErrors ? this.gen.endIf() : this.gen.else();
  }
  pass(t, r) {
    this.failResult((0, W.not)(t), void 0, r);
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
    this.fail((0, W._)`${r} !== undefined && (${(0, W.or)(this.invalid$data(), t)})`);
  }
  error(t, r, n) {
    if (r) {
      this.setParams(r), this._error(t, n), this.setParams({});
      return;
    }
    this._error(t, n);
  }
  _error(t, r) {
    (t ? tn.reportExtraError : tn.reportError)(this, this.def.error, r);
  }
  $dataError() {
    (0, tn.reportError)(this, this.def.$dataError || tn.keyword$DataError);
  }
  reset() {
    if (this.errsCount === void 0)
      throw new Error('add "trackErrors" to keyword definition');
    (0, tn.resetErrorsCount)(this.gen, this.errsCount);
  }
  ok(t) {
    this.allErrors || this.gen.if(t);
  }
  setParams(t, r) {
    r ? Object.assign(this.params, t) : this.params = t;
  }
  block$data(t, r, n = W.nil) {
    this.gen.block(() => {
      this.check$data(t, n), r();
    });
  }
  check$data(t = W.nil, r = W.nil) {
    if (!this.$data)
      return;
    const { gen: n, schemaCode: s, schemaType: o, def: a } = this;
    n.if((0, W.or)((0, W._)`${s} === undefined`, r)), t !== W.nil && n.assign(t, !0), (o.length || a.validateSchema) && (n.elseIf(this.invalid$data()), this.$dataError(), t !== W.nil && n.assign(t, !1)), n.else();
  }
  invalid$data() {
    const { gen: t, schemaCode: r, schemaType: n, def: s, it: o } = this;
    return (0, W.or)(a(), i());
    function a() {
      if (n.length) {
        if (!(r instanceof W.Name))
          throw new Error("ajv implementation error");
        const c = Array.isArray(n) ? n : [n];
        return (0, W._)`${(0, hs.checkDataTypes)(c, r, o.opts.strictNumbers, hs.DataType.Wrong)}`;
      }
      return W.nil;
    }
    function i() {
      if (s.validateSchema) {
        const c = t.scopeValue("validate$data", { ref: s.validateSchema });
        return (0, W._)`!${c}(${r})`;
      }
      return W.nil;
    }
  }
  subschema(t, r) {
    const n = (0, xs.getSubschema)(this.it, t);
    (0, xs.extendSubschemaData)(n, this.it, t), (0, xs.extendSubschemaMode)(n, t);
    const s = { ...this.it, ...n, items: void 0, props: void 0 };
    return E0(s, r), s;
  }
  mergeEvaluated(t, r) {
    const { it: n, gen: s } = this;
    n.opts.unevaluated && (n.props !== !0 && t.props !== void 0 && (n.props = bt.mergeEvaluated.props(s, t.props, n.props, r)), n.items !== !0 && t.items !== void 0 && (n.items = bt.mergeEvaluated.items(s, t.items, n.items, r)));
  }
  mergeValidEvaluated(t, r) {
    const { it: n, gen: s } = this;
    if (n.opts.unevaluated && (n.props !== !0 || n.items !== !0))
      return s.if(r, () => this.mergeEvaluated(t, W.Name)), !0;
  }
}
at.KeywordCxt = Xu;
function Yu(e, t, r, n) {
  const s = new Xu(e, r, t);
  "code" in r ? r.code(s, n) : s.$data && r.validate ? (0, hn.funcKeywordCode)(s, r) : "macro" in r ? (0, hn.macroKeywordCode)(s, r) : (r.compile || r.validate) && (0, hn.funcKeywordCode)(s, r);
}
const D0 = /^\/(?:[^~]|~0|~1)*$/, M0 = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
function xu(e, { dataLevel: t, dataNames: r, dataPathArr: n }) {
  let s, o;
  if (e === "")
    return Y.default.rootData;
  if (e[0] === "/") {
    if (!D0.test(e))
      throw new Error(`Invalid JSON-pointer: ${e}`);
    s = e, o = Y.default.rootData;
  } else {
    const d = M0.exec(e);
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
    d && (o = (0, W._)`${o}${(0, W.getProperty)((0, bt.unescapeJsonPointer)(d))}`, a = (0, W._)`${a} && ${o}`);
  return a;
  function c(d, u) {
    return `Cannot access ${d} ${u} levels up, current level is ${t}`;
  }
}
at.getData = xu;
var Sn = {};
Object.defineProperty(Sn, "__esModule", { value: !0 });
class L0 extends Error {
  constructor(t) {
    super("validation failed"), this.errors = t, this.ajv = this.validation = !0;
  }
}
Sn.default = L0;
var Br = {};
Object.defineProperty(Br, "__esModule", { value: !0 });
const Qs = Re;
class F0 extends Error {
  constructor(t, r, n, s) {
    super(s || `can't resolve reference ${n} from id ${r}`), this.missingRef = (0, Qs.resolveUrl)(t, r, n), this.missingSchema = (0, Qs.normalizeId)((0, Qs.getFullPath)(t, this.missingRef));
  }
}
Br.default = F0;
var Ge = {};
Object.defineProperty(Ge, "__esModule", { value: !0 });
Ge.resolveSchema = Ge.getCompilingSchema = Ge.resolveRef = Ge.compileSchema = Ge.SchemaEnv = void 0;
const Ze = ne, V0 = Sn, cr = gt, st = Re, Rc = U, U0 = at;
class Os {
  constructor(t) {
    var r;
    this.refs = {}, this.dynamicAnchors = {};
    let n;
    typeof t.schema == "object" && (n = t.schema), this.schema = t.schema, this.schemaId = t.schemaId, this.root = t.root || this, this.baseId = (r = t.baseId) !== null && r !== void 0 ? r : (0, st.normalizeId)(n == null ? void 0 : n[t.schemaId || "$id"]), this.schemaPath = t.schemaPath, this.localRefs = t.localRefs, this.meta = t.meta, this.$async = n == null ? void 0 : n.$async, this.refs = {};
  }
}
Ge.SchemaEnv = Os;
function Ja(e) {
  const t = Qu.call(this, e);
  if (t)
    return t;
  const r = (0, st.getFullPath)(this.opts.uriResolver, e.root.baseId), { es5: n, lines: s } = this.opts.code, { ownProperties: o } = this.opts, a = new Ze.CodeGen(this.scope, { es5: n, lines: s, ownProperties: o });
  let i;
  e.$async && (i = a.scopeValue("Error", {
    ref: V0.default,
    code: (0, Ze._)`require("ajv/dist/runtime/validation_error").default`
  }));
  const c = a.scopeName("validate");
  e.validateName = c;
  const d = {
    gen: a,
    allErrors: this.opts.allErrors,
    data: cr.default.data,
    parentData: cr.default.parentData,
    parentDataProperty: cr.default.parentDataProperty,
    dataNames: [cr.default.data],
    dataPathArr: [Ze.nil],
    // TODO can its length be used as dataLevel if nil is removed?
    dataLevel: 0,
    dataTypes: [],
    definedProperties: /* @__PURE__ */ new Set(),
    topSchemaRef: a.scopeValue("schema", this.opts.code.source === !0 ? { ref: e.schema, code: (0, Ze.stringify)(e.schema) } : { ref: e.schema }),
    validateName: c,
    ValidationError: i,
    schema: e.schema,
    schemaEnv: e,
    rootId: r,
    baseId: e.baseId || r,
    schemaPath: Ze.nil,
    errSchemaPath: e.schemaPath || (this.opts.jtd ? "" : "#"),
    errorPath: (0, Ze._)`""`,
    opts: this.opts,
    self: this
  };
  let u;
  try {
    this._compilations.add(e), (0, U0.validateFunctionCode)(d), a.optimize(this.opts.code.optimize);
    const f = a.toString();
    u = `${a.scopeRefs(cr.default.scope)}return ${f}`, this.opts.code.process && (u = this.opts.code.process(u, e));
    const y = new Function(`${cr.default.self}`, `${cr.default.scope}`, u)(this, this.scope.get());
    if (this.scope.value(c, { ref: y }), y.errors = null, y.schema = e.schema, y.schemaEnv = e, e.$async && (y.$async = !0), this.opts.code.source === !0 && (y.source = { validateName: c, validateCode: f, scopeValues: a._values }), this.opts.unevaluated) {
      const { props: w, items: g } = d;
      y.evaluated = {
        props: w instanceof Ze.Name ? void 0 : w,
        items: g instanceof Ze.Name ? void 0 : g,
        dynamicProps: w instanceof Ze.Name,
        dynamicItems: g instanceof Ze.Name
      }, y.source && (y.source.evaluated = (0, Ze.stringify)(y.evaluated));
    }
    return e.validate = y, e;
  } catch (f) {
    throw delete e.validate, delete e.validateName, u && this.logger.error("Error compiling schema, function code:", u), f;
  } finally {
    this._compilations.delete(e);
  }
}
Ge.compileSchema = Ja;
function z0(e, t, r) {
  var n;
  r = (0, st.resolveUrl)(this.opts.uriResolver, t, r);
  const s = e.refs[r];
  if (s)
    return s;
  let o = K0.call(this, e, r);
  if (o === void 0) {
    const a = (n = e.localRefs) === null || n === void 0 ? void 0 : n[r], { schemaId: i } = this.opts;
    a && (o = new Os({ schema: a, schemaId: i, root: e, baseId: t }));
  }
  if (o !== void 0)
    return e.refs[r] = q0.call(this, o);
}
Ge.resolveRef = z0;
function q0(e) {
  return (0, st.inlineRef)(e.schema, this.opts.inlineRefs) ? e.schema : e.validate ? e : Ja.call(this, e);
}
function Qu(e) {
  for (const t of this._compilations)
    if (G0(t, e))
      return t;
}
Ge.getCompilingSchema = Qu;
function G0(e, t) {
  return e.schema === t.schema && e.root === t.root && e.baseId === t.baseId;
}
function K0(e, t) {
  let r;
  for (; typeof (r = this.refs[t]) == "string"; )
    t = r;
  return r || this.schemas[t] || Is.call(this, e, t);
}
function Is(e, t) {
  const r = this.opts.uriResolver.parse(t), n = (0, st._getFullPath)(this.opts.uriResolver, r);
  let s = (0, st.getFullPath)(this.opts.uriResolver, e.baseId, void 0);
  if (Object.keys(e.schema).length > 0 && n === s)
    return Zs.call(this, r, e);
  const o = (0, st.normalizeId)(n), a = this.refs[o] || this.schemas[o];
  if (typeof a == "string") {
    const i = Is.call(this, e, a);
    return typeof (i == null ? void 0 : i.schema) != "object" ? void 0 : Zs.call(this, r, i);
  }
  if (typeof (a == null ? void 0 : a.schema) == "object") {
    if (a.validate || Ja.call(this, a), o === (0, st.normalizeId)(t)) {
      const { schema: i } = a, { schemaId: c } = this.opts, d = i[c];
      return d && (s = (0, st.resolveUrl)(this.opts.uriResolver, s, d)), new Os({ schema: i, schemaId: c, root: e, baseId: s });
    }
    return Zs.call(this, r, a);
  }
}
Ge.resolveSchema = Is;
const H0 = /* @__PURE__ */ new Set([
  "properties",
  "patternProperties",
  "enum",
  "dependencies",
  "definitions"
]);
function Zs(e, { baseId: t, schema: r, root: n }) {
  var s;
  if (((s = e.fragment) === null || s === void 0 ? void 0 : s[0]) !== "/")
    return;
  for (const i of e.fragment.slice(1).split("/")) {
    if (typeof r == "boolean")
      return;
    const c = r[(0, Rc.unescapeFragment)(i)];
    if (c === void 0)
      return;
    r = c;
    const d = typeof r == "object" && r[this.opts.schemaId];
    !H0.has(i) && d && (t = (0, st.resolveUrl)(this.opts.uriResolver, t, d));
  }
  let o;
  if (typeof r != "boolean" && r.$ref && !(0, Rc.schemaHasRulesButRef)(r, this.RULES)) {
    const i = (0, st.resolveUrl)(this.opts.uriResolver, t, r.$ref);
    o = Is.call(this, n, i);
  }
  const { schemaId: a } = this.opts;
  if (o = o || new Os({ schema: r, schemaId: a, root: n, baseId: t }), o.schema !== o.root.schema)
    return o;
}
const B0 = "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#", W0 = "Meta-schema for $data reference (JSON AnySchema extension proposal)", J0 = "object", X0 = [
  "$data"
], Y0 = {
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
}, x0 = !1, Q0 = {
  $id: B0,
  description: W0,
  type: J0,
  required: X0,
  properties: Y0,
  additionalProperties: x0
};
var Xa = {};
Object.defineProperty(Xa, "__esModule", { value: !0 });
const Zu = cu;
Zu.code = 'require("ajv/dist/runtime/uri").default';
Xa.default = Zu;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.CodeGen = e.Name = e.nil = e.stringify = e.str = e._ = e.KeywordCxt = void 0;
  var t = at;
  Object.defineProperty(e, "KeywordCxt", { enumerable: !0, get: function() {
    return t.KeywordCxt;
  } });
  var r = ne;
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
  const n = Sn, s = Br, o = vr, a = Ge, i = ne, c = Re, d = we, u = U, f = Q0, _ = Xa, y = (P, m) => new RegExp(P, m);
  y.code = "new RegExp";
  const w = ["removeAdditional", "useDefaults", "coerceTypes"], g = /* @__PURE__ */ new Set([
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
  ]), $ = {
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
  }, E = 200;
  function N(P) {
    var m, S, v, l, h, b, I, j, H, K, ie, Ke, Ht, Bt, Wt, Jt, Xt, Yt, xt, Qt, Zt, er, tr, rr, nr;
    const xe = P.strict, sr = (m = P.code) === null || m === void 0 ? void 0 : m.optimize, Yr = sr === !0 || sr === void 0 ? 1 : sr || 0, xr = (v = (S = P.code) === null || S === void 0 ? void 0 : S.regExp) !== null && v !== void 0 ? v : y, Vs = (l = P.uriResolver) !== null && l !== void 0 ? l : _.default;
    return {
      strictSchema: (b = (h = P.strictSchema) !== null && h !== void 0 ? h : xe) !== null && b !== void 0 ? b : !0,
      strictNumbers: (j = (I = P.strictNumbers) !== null && I !== void 0 ? I : xe) !== null && j !== void 0 ? j : !0,
      strictTypes: (K = (H = P.strictTypes) !== null && H !== void 0 ? H : xe) !== null && K !== void 0 ? K : "log",
      strictTuples: (Ke = (ie = P.strictTuples) !== null && ie !== void 0 ? ie : xe) !== null && Ke !== void 0 ? Ke : "log",
      strictRequired: (Bt = (Ht = P.strictRequired) !== null && Ht !== void 0 ? Ht : xe) !== null && Bt !== void 0 ? Bt : !1,
      code: P.code ? { ...P.code, optimize: Yr, regExp: xr } : { optimize: Yr, regExp: xr },
      loopRequired: (Wt = P.loopRequired) !== null && Wt !== void 0 ? Wt : E,
      loopEnum: (Jt = P.loopEnum) !== null && Jt !== void 0 ? Jt : E,
      meta: (Xt = P.meta) !== null && Xt !== void 0 ? Xt : !0,
      messages: (Yt = P.messages) !== null && Yt !== void 0 ? Yt : !0,
      inlineRefs: (xt = P.inlineRefs) !== null && xt !== void 0 ? xt : !0,
      schemaId: (Qt = P.schemaId) !== null && Qt !== void 0 ? Qt : "$id",
      addUsedSchema: (Zt = P.addUsedSchema) !== null && Zt !== void 0 ? Zt : !0,
      validateSchema: (er = P.validateSchema) !== null && er !== void 0 ? er : !0,
      validateFormats: (tr = P.validateFormats) !== null && tr !== void 0 ? tr : !0,
      unicodeRegExp: (rr = P.unicodeRegExp) !== null && rr !== void 0 ? rr : !0,
      int32range: (nr = P.int32range) !== null && nr !== void 0 ? nr : !0,
      uriResolver: Vs
    };
  }
  class R {
    constructor(m = {}) {
      this.schemas = {}, this.refs = {}, this.formats = {}, this._compilations = /* @__PURE__ */ new Set(), this._loading = {}, this._cache = /* @__PURE__ */ new Map(), m = this.opts = { ...m, ...N(m) };
      const { es5: S, lines: v } = this.opts.code;
      this.scope = new i.ValueScope({ scope: {}, prefixes: g, es5: S, lines: v }), this.logger = z(m.logger);
      const l = m.validateFormats;
      m.validateFormats = !1, this.RULES = (0, o.getRules)(), T.call(this, $, m, "NOT SUPPORTED"), T.call(this, p, m, "DEPRECATED", "warn"), this._metaOpts = me.call(this), m.formats && ce.call(this), this._addVocabularies(), this._addDefaultMetaSchema(), m.keywords && le.call(this, m.keywords), typeof m.meta == "object" && this.addMetaSchema(m.meta), k.call(this), m.validateFormats = l;
    }
    _addVocabularies() {
      this.addKeyword("$async");
    }
    _addDefaultMetaSchema() {
      const { $data: m, meta: S, schemaId: v } = this.opts;
      let l = f;
      v === "id" && (l = { ...f }, l.id = l.$id, delete l.$id), S && m && this.addMetaSchema(l, l[v], !1);
    }
    defaultMeta() {
      const { meta: m, schemaId: S } = this.opts;
      return this.opts.defaultMeta = typeof m == "object" ? m[S] || m : void 0;
    }
    validate(m, S) {
      let v;
      if (typeof m == "string") {
        if (v = this.getSchema(m), !v)
          throw new Error(`no schema with key or ref "${m}"`);
      } else
        v = this.compile(m);
      const l = v(S);
      return "$async" in v || (this.errors = v.errors), l;
    }
    compile(m, S) {
      const v = this._addSchema(m, S);
      return v.validate || this._compileSchemaEnv(v);
    }
    compileAsync(m, S) {
      if (typeof this.opts.loadSchema != "function")
        throw new Error("options.loadSchema should be a function");
      const { loadSchema: v } = this.opts;
      return l.call(this, m, S);
      async function l(K, ie) {
        await h.call(this, K.$schema);
        const Ke = this._addSchema(K, ie);
        return Ke.validate || b.call(this, Ke);
      }
      async function h(K) {
        K && !this.getSchema(K) && await l.call(this, { $ref: K }, !0);
      }
      async function b(K) {
        try {
          return this._compileSchemaEnv(K);
        } catch (ie) {
          if (!(ie instanceof s.default))
            throw ie;
          return I.call(this, ie), await j.call(this, ie.missingSchema), b.call(this, K);
        }
      }
      function I({ missingSchema: K, missingRef: ie }) {
        if (this.refs[K])
          throw new Error(`AnySchema ${K} is loaded but ${ie} cannot be resolved`);
      }
      async function j(K) {
        const ie = await H.call(this, K);
        this.refs[K] || await h.call(this, ie.$schema), this.refs[K] || this.addSchema(ie, K, S);
      }
      async function H(K) {
        const ie = this._loading[K];
        if (ie)
          return ie;
        try {
          return await (this._loading[K] = v(K));
        } finally {
          delete this._loading[K];
        }
      }
    }
    // Adds schema to the instance
    addSchema(m, S, v, l = this.opts.validateSchema) {
      if (Array.isArray(m)) {
        for (const b of m)
          this.addSchema(b, void 0, v, l);
        return this;
      }
      let h;
      if (typeof m == "object") {
        const { schemaId: b } = this.opts;
        if (h = m[b], h !== void 0 && typeof h != "string")
          throw new Error(`schema ${b} must be string`);
      }
      return S = (0, c.normalizeId)(S || h), this._checkUnique(S), this.schemas[S] = this._addSchema(m, v, S, l, !0), this;
    }
    // Add schema that will be used to validate other schemas
    // options in META_IGNORE_OPTIONS are alway set to false
    addMetaSchema(m, S, v = this.opts.validateSchema) {
      return this.addSchema(m, S, !0, v), this;
    }
    //  Validate schema against its meta-schema
    validateSchema(m, S) {
      if (typeof m == "boolean")
        return !0;
      let v;
      if (v = m.$schema, v !== void 0 && typeof v != "string")
        throw new Error("$schema must be a string");
      if (v = v || this.opts.defaultMeta || this.defaultMeta(), !v)
        return this.logger.warn("meta-schema not available"), this.errors = null, !0;
      const l = this.validate(v, m);
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
    getSchema(m) {
      let S;
      for (; typeof (S = C.call(this, m)) == "string"; )
        m = S;
      if (S === void 0) {
        const { schemaId: v } = this.opts, l = new a.SchemaEnv({ schema: {}, schemaId: v });
        if (S = a.resolveSchema.call(this, l, m), !S)
          return;
        this.refs[m] = S;
      }
      return S.validate || this._compileSchemaEnv(S);
    }
    // Remove cached schema(s).
    // If no parameter is passed all schemas but meta-schemas are removed.
    // If RegExp is passed all schemas with key/id matching pattern but meta-schemas are removed.
    // Even if schema is referenced by other schemas it still can be removed as other schemas have local references.
    removeSchema(m) {
      if (m instanceof RegExp)
        return this._removeAllSchemas(this.schemas, m), this._removeAllSchemas(this.refs, m), this;
      switch (typeof m) {
        case "undefined":
          return this._removeAllSchemas(this.schemas), this._removeAllSchemas(this.refs), this._cache.clear(), this;
        case "string": {
          const S = C.call(this, m);
          return typeof S == "object" && this._cache.delete(S.schema), delete this.schemas[m], delete this.refs[m], this;
        }
        case "object": {
          const S = m;
          this._cache.delete(S);
          let v = m[this.opts.schemaId];
          return v && (v = (0, c.normalizeId)(v), delete this.schemas[v], delete this.refs[v]), this;
        }
        default:
          throw new Error("ajv.removeSchema: invalid parameter");
      }
    }
    // add "vocabulary" - a collection of keywords
    addVocabulary(m) {
      for (const S of m)
        this.addKeyword(S);
      return this;
    }
    addKeyword(m, S) {
      let v;
      if (typeof m == "string")
        v = m, typeof S == "object" && (this.logger.warn("these parameters are deprecated, see docs for addKeyword"), S.keyword = v);
      else if (typeof m == "object" && S === void 0) {
        if (S = m, v = S.keyword, Array.isArray(v) && !v.length)
          throw new Error("addKeywords: keyword must be string or non-empty array");
      } else
        throw new Error("invalid addKeywords parameters");
      if (O.call(this, v, S), !S)
        return (0, u.eachItem)(v, (h) => A.call(this, h)), this;
      D.call(this, S);
      const l = {
        ...S,
        type: (0, d.getJSONTypes)(S.type),
        schemaType: (0, d.getJSONTypes)(S.schemaType)
      };
      return (0, u.eachItem)(v, l.type.length === 0 ? (h) => A.call(this, h, l) : (h) => l.type.forEach((b) => A.call(this, h, l, b))), this;
    }
    getKeyword(m) {
      const S = this.RULES.all[m];
      return typeof S == "object" ? S.definition : !!S;
    }
    // Remove keyword
    removeKeyword(m) {
      const { RULES: S } = this;
      delete S.keywords[m], delete S.all[m];
      for (const v of S.rules) {
        const l = v.rules.findIndex((h) => h.keyword === m);
        l >= 0 && v.rules.splice(l, 1);
      }
      return this;
    }
    // Add format
    addFormat(m, S) {
      return typeof S == "string" && (S = new RegExp(S)), this.formats[m] = S, this;
    }
    errorsText(m = this.errors, { separator: S = ", ", dataVar: v = "data" } = {}) {
      return !m || m.length === 0 ? "No errors" : m.map((l) => `${v}${l.instancePath} ${l.message}`).reduce((l, h) => l + S + h);
    }
    $dataMetaSchema(m, S) {
      const v = this.RULES.all;
      m = JSON.parse(JSON.stringify(m));
      for (const l of S) {
        const h = l.split("/").slice(1);
        let b = m;
        for (const I of h)
          b = b[I];
        for (const I in v) {
          const j = v[I];
          if (typeof j != "object")
            continue;
          const { $data: H } = j.definition, K = b[I];
          H && K && (b[I] = M(K));
        }
      }
      return m;
    }
    _removeAllSchemas(m, S) {
      for (const v in m) {
        const l = m[v];
        (!S || S.test(v)) && (typeof l == "string" ? delete m[v] : l && !l.meta && (this._cache.delete(l.schema), delete m[v]));
      }
    }
    _addSchema(m, S, v, l = this.opts.validateSchema, h = this.opts.addUsedSchema) {
      let b;
      const { schemaId: I } = this.opts;
      if (typeof m == "object")
        b = m[I];
      else {
        if (this.opts.jtd)
          throw new Error("schema must be object");
        if (typeof m != "boolean")
          throw new Error("schema must be object or boolean");
      }
      let j = this._cache.get(m);
      if (j !== void 0)
        return j;
      v = (0, c.normalizeId)(b || v);
      const H = c.getSchemaRefs.call(this, m, v);
      return j = new a.SchemaEnv({ schema: m, schemaId: I, meta: S, baseId: v, localRefs: H }), this._cache.set(j.schema, j), h && !v.startsWith("#") && (v && this._checkUnique(v), this.refs[v] = j), l && this.validateSchema(m, !0), j;
    }
    _checkUnique(m) {
      if (this.schemas[m] || this.refs[m])
        throw new Error(`schema with key or id "${m}" already exists`);
    }
    _compileSchemaEnv(m) {
      if (m.meta ? this._compileMetaSchema(m) : a.compileSchema.call(this, m), !m.validate)
        throw new Error("ajv implementation error");
      return m.validate;
    }
    _compileMetaSchema(m) {
      const S = this.opts;
      this.opts = this._metaOpts;
      try {
        a.compileSchema.call(this, m);
      } finally {
        this.opts = S;
      }
    }
  }
  R.ValidationError = n.default, R.MissingRefError = s.default, e.default = R;
  function T(P, m, S, v = "error") {
    for (const l in P) {
      const h = l;
      h in m && this.logger[v](`${S}: option ${l}. ${P[h]}`);
    }
  }
  function C(P) {
    return P = (0, c.normalizeId)(P), this.schemas[P] || this.refs[P];
  }
  function k() {
    const P = this.opts.schemas;
    if (P)
      if (Array.isArray(P))
        this.addSchema(P);
      else
        for (const m in P)
          this.addSchema(P[m], m);
  }
  function ce() {
    for (const P in this.opts.formats) {
      const m = this.opts.formats[P];
      m && this.addFormat(P, m);
    }
  }
  function le(P) {
    if (Array.isArray(P)) {
      this.addVocabulary(P);
      return;
    }
    this.logger.warn("keywords option as map is deprecated, pass array");
    for (const m in P) {
      const S = P[m];
      S.keyword || (S.keyword = m), this.addKeyword(S);
    }
  }
  function me() {
    const P = { ...this.opts };
    for (const m of w)
      delete P[m];
    return P;
  }
  const L = { log() {
  }, warn() {
  }, error() {
  } };
  function z(P) {
    if (P === !1)
      return L;
    if (P === void 0)
      return console;
    if (P.log && P.warn && P.error)
      return P;
    throw new Error("logger must implement log, warn and error methods");
  }
  const ae = /^[a-z_$][a-z0-9_$:-]*$/i;
  function O(P, m) {
    const { RULES: S } = this;
    if ((0, u.eachItem)(P, (v) => {
      if (S.keywords[v])
        throw new Error(`Keyword ${v} is already defined`);
      if (!ae.test(v))
        throw new Error(`Keyword ${v} has invalid name`);
    }), !!m && m.$data && !("code" in m || "validate" in m))
      throw new Error('$data keyword must have "code" or "validate" function');
  }
  function A(P, m, S) {
    var v;
    const l = m == null ? void 0 : m.post;
    if (S && l)
      throw new Error('keyword with "post" flag cannot have "type"');
    const { RULES: h } = this;
    let b = l ? h.post : h.rules.find(({ type: j }) => j === S);
    if (b || (b = { type: S, rules: [] }, h.rules.push(b)), h.keywords[P] = !0, !m)
      return;
    const I = {
      keyword: P,
      definition: {
        ...m,
        type: (0, d.getJSONTypes)(m.type),
        schemaType: (0, d.getJSONTypes)(m.schemaType)
      }
    };
    m.before ? V.call(this, b, I, m.before) : b.rules.push(I), h.all[P] = I, (v = m.implements) === null || v === void 0 || v.forEach((j) => this.addKeyword(j));
  }
  function V(P, m, S) {
    const v = P.rules.findIndex((l) => l.keyword === S);
    v >= 0 ? P.rules.splice(v, 0, m) : (P.rules.push(m), this.logger.warn(`rule ${S} is not defined`));
  }
  function D(P) {
    let { metaSchema: m } = P;
    m !== void 0 && (P.$data && this.opts.$data && (m = M(m)), P.validateSchema = this.compile(m, !0));
  }
  const G = {
    $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
  };
  function M(P) {
    return { anyOf: [P, G] };
  }
})(Eu);
var Ya = {}, xa = {}, Qa = {};
Object.defineProperty(Qa, "__esModule", { value: !0 });
const Z0 = {
  keyword: "id",
  code() {
    throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
  }
};
Qa.default = Z0;
var Er = {};
Object.defineProperty(Er, "__esModule", { value: !0 });
Er.callRef = Er.getValidate = void 0;
const ev = Br, Tc = oe, qe = ne, Pr = gt, Oc = Ge, Ln = U, tv = {
  keyword: "$ref",
  schemaType: "string",
  code(e) {
    const { gen: t, schema: r, it: n } = e, { baseId: s, schemaEnv: o, validateName: a, opts: i, self: c } = n, { root: d } = o;
    if ((r === "#" || r === "#/") && s === d.baseId)
      return f();
    const u = Oc.resolveRef.call(c, d, s, r);
    if (u === void 0)
      throw new ev.default(n.opts.uriResolver, s, r);
    if (u instanceof Oc.SchemaEnv)
      return _(u);
    return y(u);
    function f() {
      if (o === d)
        return ns(e, a, o, o.$async);
      const w = t.scopeValue("root", { ref: d });
      return ns(e, (0, qe._)`${w}.validate`, d, d.$async);
    }
    function _(w) {
      const g = ed(e, w);
      ns(e, g, w, w.$async);
    }
    function y(w) {
      const g = t.scopeValue("schema", i.code.source === !0 ? { ref: w, code: (0, qe.stringify)(w) } : { ref: w }), $ = t.name("valid"), p = e.subschema({
        schema: w,
        dataTypes: [],
        schemaPath: qe.nil,
        topSchemaRef: g,
        errSchemaPath: r
      }, $);
      e.mergeEvaluated(p), e.ok($);
    }
  }
};
function ed(e, t) {
  const { gen: r } = e;
  return t.validate ? r.scopeValue("validate", { ref: t.validate }) : (0, qe._)`${r.scopeValue("wrapper", { ref: t })}.validate`;
}
Er.getValidate = ed;
function ns(e, t, r, n) {
  const { gen: s, it: o } = e, { allErrors: a, schemaEnv: i, opts: c } = o, d = c.passContext ? Pr.default.this : qe.nil;
  n ? u() : f();
  function u() {
    if (!i.$async)
      throw new Error("async schema referenced by sync schema");
    const w = s.let("valid");
    s.try(() => {
      s.code((0, qe._)`await ${(0, Tc.callValidateCode)(e, t, d)}`), y(t), a || s.assign(w, !0);
    }, (g) => {
      s.if((0, qe._)`!(${g} instanceof ${o.ValidationError})`, () => s.throw(g)), _(g), a || s.assign(w, !1);
    }), e.ok(w);
  }
  function f() {
    e.result((0, Tc.callValidateCode)(e, t, d), () => y(t), () => _(t));
  }
  function _(w) {
    const g = (0, qe._)`${w}.errors`;
    s.assign(Pr.default.vErrors, (0, qe._)`${Pr.default.vErrors} === null ? ${g} : ${Pr.default.vErrors}.concat(${g})`), s.assign(Pr.default.errors, (0, qe._)`${Pr.default.vErrors}.length`);
  }
  function y(w) {
    var g;
    if (!o.opts.unevaluated)
      return;
    const $ = (g = r == null ? void 0 : r.validate) === null || g === void 0 ? void 0 : g.evaluated;
    if (o.props !== !0)
      if ($ && !$.dynamicProps)
        $.props !== void 0 && (o.props = Ln.mergeEvaluated.props(s, $.props, o.props));
      else {
        const p = s.var("props", (0, qe._)`${w}.evaluated.props`);
        o.props = Ln.mergeEvaluated.props(s, p, o.props, qe.Name);
      }
    if (o.items !== !0)
      if ($ && !$.dynamicItems)
        $.items !== void 0 && (o.items = Ln.mergeEvaluated.items(s, $.items, o.items));
      else {
        const p = s.var("items", (0, qe._)`${w}.evaluated.items`);
        o.items = Ln.mergeEvaluated.items(s, p, o.items, qe.Name);
      }
  }
}
Er.callRef = ns;
Er.default = tv;
Object.defineProperty(xa, "__esModule", { value: !0 });
const rv = Qa, nv = Er, sv = [
  "$schema",
  "$id",
  "$defs",
  "$vocabulary",
  { keyword: "$comment" },
  "definitions",
  rv.default,
  nv.default
];
xa.default = sv;
var Za = {}, ei = {};
Object.defineProperty(ei, "__esModule", { value: !0 });
const ps = ne, kt = ps.operators, ms = {
  maximum: { okStr: "<=", ok: kt.LTE, fail: kt.GT },
  minimum: { okStr: ">=", ok: kt.GTE, fail: kt.LT },
  exclusiveMaximum: { okStr: "<", ok: kt.LT, fail: kt.GTE },
  exclusiveMinimum: { okStr: ">", ok: kt.GT, fail: kt.LTE }
}, ov = {
  message: ({ keyword: e, schemaCode: t }) => (0, ps.str)`must be ${ms[e].okStr} ${t}`,
  params: ({ keyword: e, schemaCode: t }) => (0, ps._)`{comparison: ${ms[e].okStr}, limit: ${t}}`
}, av = {
  keyword: Object.keys(ms),
  type: "number",
  schemaType: "number",
  $data: !0,
  error: ov,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e;
    e.fail$data((0, ps._)`${r} ${ms[t].fail} ${n} || isNaN(${r})`);
  }
};
ei.default = av;
var ti = {};
Object.defineProperty(ti, "__esModule", { value: !0 });
const pn = ne, iv = {
  message: ({ schemaCode: e }) => (0, pn.str)`must be multiple of ${e}`,
  params: ({ schemaCode: e }) => (0, pn._)`{multipleOf: ${e}}`
}, cv = {
  keyword: "multipleOf",
  type: "number",
  schemaType: "number",
  $data: !0,
  error: iv,
  code(e) {
    const { gen: t, data: r, schemaCode: n, it: s } = e, o = s.opts.multipleOfPrecision, a = t.let("res"), i = o ? (0, pn._)`Math.abs(Math.round(${a}) - ${a}) > 1e-${o}` : (0, pn._)`${a} !== parseInt(${a})`;
    e.fail$data((0, pn._)`(${n} === 0 || (${a} = ${r}/${n}, ${i}))`);
  }
};
ti.default = cv;
var ri = {}, ni = {};
Object.defineProperty(ni, "__esModule", { value: !0 });
function td(e) {
  const t = e.length;
  let r = 0, n = 0, s;
  for (; n < t; )
    r++, s = e.charCodeAt(n++), s >= 55296 && s <= 56319 && n < t && (s = e.charCodeAt(n), (s & 64512) === 56320 && n++);
  return r;
}
ni.default = td;
td.code = 'require("ajv/dist/runtime/ucs2length").default';
Object.defineProperty(ri, "__esModule", { value: !0 });
const pr = ne, lv = U, uv = ni, dv = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxLength" ? "more" : "fewer";
    return (0, pr.str)`must NOT have ${r} than ${t} characters`;
  },
  params: ({ schemaCode: e }) => (0, pr._)`{limit: ${e}}`
}, fv = {
  keyword: ["maxLength", "minLength"],
  type: "string",
  schemaType: "number",
  $data: !0,
  error: dv,
  code(e) {
    const { keyword: t, data: r, schemaCode: n, it: s } = e, o = t === "maxLength" ? pr.operators.GT : pr.operators.LT, a = s.opts.unicode === !1 ? (0, pr._)`${r}.length` : (0, pr._)`${(0, lv.useFunc)(e.gen, uv.default)}(${r})`;
    e.fail$data((0, pr._)`${a} ${o} ${n}`);
  }
};
ri.default = fv;
var si = {};
Object.defineProperty(si, "__esModule", { value: !0 });
const hv = oe, ys = ne, pv = {
  message: ({ schemaCode: e }) => (0, ys.str)`must match pattern "${e}"`,
  params: ({ schemaCode: e }) => (0, ys._)`{pattern: ${e}}`
}, mv = {
  keyword: "pattern",
  type: "string",
  schemaType: "string",
  $data: !0,
  error: pv,
  code(e) {
    const { data: t, $data: r, schema: n, schemaCode: s, it: o } = e, a = o.opts.unicodeRegExp ? "u" : "", i = r ? (0, ys._)`(new RegExp(${s}, ${a}))` : (0, hv.usePattern)(e, n);
    e.fail$data((0, ys._)`!${i}.test(${t})`);
  }
};
si.default = mv;
var oi = {};
Object.defineProperty(oi, "__esModule", { value: !0 });
const mn = ne, yv = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxProperties" ? "more" : "fewer";
    return (0, mn.str)`must NOT have ${r} than ${t} properties`;
  },
  params: ({ schemaCode: e }) => (0, mn._)`{limit: ${e}}`
}, $v = {
  keyword: ["maxProperties", "minProperties"],
  type: "object",
  schemaType: "number",
  $data: !0,
  error: yv,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e, s = t === "maxProperties" ? mn.operators.GT : mn.operators.LT;
    e.fail$data((0, mn._)`Object.keys(${r}).length ${s} ${n}`);
  }
};
oi.default = $v;
var ai = {};
Object.defineProperty(ai, "__esModule", { value: !0 });
const rn = oe, yn = ne, gv = U, _v = {
  message: ({ params: { missingProperty: e } }) => (0, yn.str)`must have required property '${e}'`,
  params: ({ params: { missingProperty: e } }) => (0, yn._)`{missingProperty: ${e}}`
}, vv = {
  keyword: "required",
  type: "object",
  schemaType: "array",
  $data: !0,
  error: _v,
  code(e) {
    const { gen: t, schema: r, schemaCode: n, data: s, $data: o, it: a } = e, { opts: i } = a;
    if (!o && r.length === 0)
      return;
    const c = r.length >= i.loopRequired;
    if (a.allErrors ? d() : u(), i.strictRequired) {
      const y = e.parentSchema.properties, { definedProperties: w } = e.it;
      for (const g of r)
        if ((y == null ? void 0 : y[g]) === void 0 && !w.has(g)) {
          const $ = a.schemaEnv.baseId + a.errSchemaPath, p = `required property "${g}" is not defined at "${$}" (strictRequired)`;
          (0, gv.checkStrictMode)(a, p, a.opts.strictRequired);
        }
    }
    function d() {
      if (c || o)
        e.block$data(yn.nil, f);
      else
        for (const y of r)
          (0, rn.checkReportMissingProp)(e, y);
    }
    function u() {
      const y = t.let("missing");
      if (c || o) {
        const w = t.let("valid", !0);
        e.block$data(w, () => _(y, w)), e.ok(w);
      } else
        t.if((0, rn.checkMissingProp)(e, r, y)), (0, rn.reportMissingProp)(e, y), t.else();
    }
    function f() {
      t.forOf("prop", n, (y) => {
        e.setParams({ missingProperty: y }), t.if((0, rn.noPropertyInData)(t, s, y, i.ownProperties), () => e.error());
      });
    }
    function _(y, w) {
      e.setParams({ missingProperty: y }), t.forOf(y, n, () => {
        t.assign(w, (0, rn.propertyInData)(t, s, y, i.ownProperties)), t.if((0, yn.not)(w), () => {
          e.error(), t.break();
        });
      }, yn.nil);
    }
  }
};
ai.default = vv;
var ii = {};
Object.defineProperty(ii, "__esModule", { value: !0 });
const $n = ne, Ev = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxItems" ? "more" : "fewer";
    return (0, $n.str)`must NOT have ${r} than ${t} items`;
  },
  params: ({ schemaCode: e }) => (0, $n._)`{limit: ${e}}`
}, wv = {
  keyword: ["maxItems", "minItems"],
  type: "array",
  schemaType: "number",
  $data: !0,
  error: Ev,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e, s = t === "maxItems" ? $n.operators.GT : $n.operators.LT;
    e.fail$data((0, $n._)`${r}.length ${s} ${n}`);
  }
};
ii.default = wv;
var ci = {}, bn = {};
Object.defineProperty(bn, "__esModule", { value: !0 });
const rd = Es;
rd.code = 'require("ajv/dist/runtime/equal").default';
bn.default = rd;
Object.defineProperty(ci, "__esModule", { value: !0 });
const eo = we, Pe = ne, Sv = U, bv = bn, Pv = {
  message: ({ params: { i: e, j: t } }) => (0, Pe.str)`must NOT have duplicate items (items ## ${t} and ${e} are identical)`,
  params: ({ params: { i: e, j: t } }) => (0, Pe._)`{i: ${e}, j: ${t}}`
}, Nv = {
  keyword: "uniqueItems",
  type: "array",
  schemaType: "boolean",
  $data: !0,
  error: Pv,
  code(e) {
    const { gen: t, data: r, $data: n, schema: s, parentSchema: o, schemaCode: a, it: i } = e;
    if (!n && !s)
      return;
    const c = t.let("valid"), d = o.items ? (0, eo.getSchemaTypes)(o.items) : [];
    e.block$data(c, u, (0, Pe._)`${a} === false`), e.ok(c);
    function u() {
      const w = t.let("i", (0, Pe._)`${r}.length`), g = t.let("j");
      e.setParams({ i: w, j: g }), t.assign(c, !0), t.if((0, Pe._)`${w} > 1`, () => (f() ? _ : y)(w, g));
    }
    function f() {
      return d.length > 0 && !d.some((w) => w === "object" || w === "array");
    }
    function _(w, g) {
      const $ = t.name("item"), p = (0, eo.checkDataTypes)(d, $, i.opts.strictNumbers, eo.DataType.Wrong), E = t.const("indices", (0, Pe._)`{}`);
      t.for((0, Pe._)`;${w}--;`, () => {
        t.let($, (0, Pe._)`${r}[${w}]`), t.if(p, (0, Pe._)`continue`), d.length > 1 && t.if((0, Pe._)`typeof ${$} == "string"`, (0, Pe._)`${$} += "_"`), t.if((0, Pe._)`typeof ${E}[${$}] == "number"`, () => {
          t.assign(g, (0, Pe._)`${E}[${$}]`), e.error(), t.assign(c, !1).break();
        }).code((0, Pe._)`${E}[${$}] = ${w}`);
      });
    }
    function y(w, g) {
      const $ = (0, Sv.useFunc)(t, bv.default), p = t.name("outer");
      t.label(p).for((0, Pe._)`;${w}--;`, () => t.for((0, Pe._)`${g} = ${w}; ${g}--;`, () => t.if((0, Pe._)`${$}(${r}[${w}], ${r}[${g}])`, () => {
        e.error(), t.assign(c, !1).break(p);
      })));
    }
  }
};
ci.default = Nv;
var li = {};
Object.defineProperty(li, "__esModule", { value: !0 });
const Ro = ne, Rv = U, Tv = bn, Ov = {
  message: "must be equal to constant",
  params: ({ schemaCode: e }) => (0, Ro._)`{allowedValue: ${e}}`
}, Iv = {
  keyword: "const",
  $data: !0,
  error: Ov,
  code(e) {
    const { gen: t, data: r, $data: n, schemaCode: s, schema: o } = e;
    n || o && typeof o == "object" ? e.fail$data((0, Ro._)`!${(0, Rv.useFunc)(t, Tv.default)}(${r}, ${s})`) : e.fail((0, Ro._)`${o} !== ${r}`);
  }
};
li.default = Iv;
var ui = {};
Object.defineProperty(ui, "__esModule", { value: !0 });
const an = ne, jv = U, Av = bn, Cv = {
  message: "must be equal to one of the allowed values",
  params: ({ schemaCode: e }) => (0, an._)`{allowedValues: ${e}}`
}, kv = {
  keyword: "enum",
  schemaType: "array",
  $data: !0,
  error: Cv,
  code(e) {
    const { gen: t, data: r, $data: n, schema: s, schemaCode: o, it: a } = e;
    if (!n && s.length === 0)
      throw new Error("enum must have non-empty array");
    const i = s.length >= a.opts.loopEnum;
    let c;
    const d = () => c ?? (c = (0, jv.useFunc)(t, Av.default));
    let u;
    if (i || n)
      u = t.let("valid"), e.block$data(u, f);
    else {
      if (!Array.isArray(s))
        throw new Error("ajv implementation error");
      const y = t.const("vSchema", o);
      u = (0, an.or)(...s.map((w, g) => _(y, g)));
    }
    e.pass(u);
    function f() {
      t.assign(u, !1), t.forOf("v", o, (y) => t.if((0, an._)`${d()}(${r}, ${y})`, () => t.assign(u, !0).break()));
    }
    function _(y, w) {
      const g = s[w];
      return typeof g == "object" && g !== null ? (0, an._)`${d()}(${r}, ${y}[${w}])` : (0, an._)`${r} === ${g}`;
    }
  }
};
ui.default = kv;
Object.defineProperty(Za, "__esModule", { value: !0 });
const Dv = ei, Mv = ti, Lv = ri, Fv = si, Vv = oi, Uv = ai, zv = ii, qv = ci, Gv = li, Kv = ui, Hv = [
  // number
  Dv.default,
  Mv.default,
  // string
  Lv.default,
  Fv.default,
  // object
  Vv.default,
  Uv.default,
  // array
  zv.default,
  qv.default,
  // any
  { keyword: "type", schemaType: ["string", "array"] },
  { keyword: "nullable", schemaType: "boolean" },
  Gv.default,
  Kv.default
];
Za.default = Hv;
var di = {}, Wr = {};
Object.defineProperty(Wr, "__esModule", { value: !0 });
Wr.validateAdditionalItems = void 0;
const mr = ne, To = U, Bv = {
  message: ({ params: { len: e } }) => (0, mr.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, mr._)`{limit: ${e}}`
}, Wv = {
  keyword: "additionalItems",
  type: "array",
  schemaType: ["boolean", "object"],
  before: "uniqueItems",
  error: Bv,
  code(e) {
    const { parentSchema: t, it: r } = e, { items: n } = t;
    if (!Array.isArray(n)) {
      (0, To.checkStrictMode)(r, '"additionalItems" is ignored when "items" is not an array of schemas');
      return;
    }
    nd(e, n);
  }
};
function nd(e, t) {
  const { gen: r, schema: n, data: s, keyword: o, it: a } = e;
  a.items = !0;
  const i = r.const("len", (0, mr._)`${s}.length`);
  if (n === !1)
    e.setParams({ len: t.length }), e.pass((0, mr._)`${i} <= ${t.length}`);
  else if (typeof n == "object" && !(0, To.alwaysValidSchema)(a, n)) {
    const d = r.var("valid", (0, mr._)`${i} <= ${t.length}`);
    r.if((0, mr.not)(d), () => c(d)), e.ok(d);
  }
  function c(d) {
    r.forRange("i", t.length, i, (u) => {
      e.subschema({ keyword: o, dataProp: u, dataPropType: To.Type.Num }, d), a.allErrors || r.if((0, mr.not)(d), () => r.break());
    });
  }
}
Wr.validateAdditionalItems = nd;
Wr.default = Wv;
var fi = {}, Jr = {};
Object.defineProperty(Jr, "__esModule", { value: !0 });
Jr.validateTuple = void 0;
const Ic = ne, ss = U, Jv = oe, Xv = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "array", "boolean"],
  before: "uniqueItems",
  code(e) {
    const { schema: t, it: r } = e;
    if (Array.isArray(t))
      return sd(e, "additionalItems", t);
    r.items = !0, !(0, ss.alwaysValidSchema)(r, t) && e.ok((0, Jv.validateArray)(e));
  }
};
function sd(e, t, r = e.schema) {
  const { gen: n, parentSchema: s, data: o, keyword: a, it: i } = e;
  u(s), i.opts.unevaluated && r.length && i.items !== !0 && (i.items = ss.mergeEvaluated.items(n, r.length, i.items));
  const c = n.name("valid"), d = n.const("len", (0, Ic._)`${o}.length`);
  r.forEach((f, _) => {
    (0, ss.alwaysValidSchema)(i, f) || (n.if((0, Ic._)`${d} > ${_}`, () => e.subschema({
      keyword: a,
      schemaProp: _,
      dataProp: _
    }, c)), e.ok(c));
  });
  function u(f) {
    const { opts: _, errSchemaPath: y } = i, w = r.length, g = w === f.minItems && (w === f.maxItems || f[t] === !1);
    if (_.strictTuples && !g) {
      const $ = `"${a}" is ${w}-tuple, but minItems or maxItems/${t} are not specified or different at path "${y}"`;
      (0, ss.checkStrictMode)(i, $, _.strictTuples);
    }
  }
}
Jr.validateTuple = sd;
Jr.default = Xv;
Object.defineProperty(fi, "__esModule", { value: !0 });
const Yv = Jr, xv = {
  keyword: "prefixItems",
  type: "array",
  schemaType: ["array"],
  before: "uniqueItems",
  code: (e) => (0, Yv.validateTuple)(e, "items")
};
fi.default = xv;
var hi = {};
Object.defineProperty(hi, "__esModule", { value: !0 });
const jc = ne, Qv = U, Zv = oe, eE = Wr, tE = {
  message: ({ params: { len: e } }) => (0, jc.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, jc._)`{limit: ${e}}`
}, rE = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  error: tE,
  code(e) {
    const { schema: t, parentSchema: r, it: n } = e, { prefixItems: s } = r;
    n.items = !0, !(0, Qv.alwaysValidSchema)(n, t) && (s ? (0, eE.validateAdditionalItems)(e, s) : e.ok((0, Zv.validateArray)(e)));
  }
};
hi.default = rE;
var pi = {};
Object.defineProperty(pi, "__esModule", { value: !0 });
const Ye = ne, Fn = U, nE = {
  message: ({ params: { min: e, max: t } }) => t === void 0 ? (0, Ye.str)`must contain at least ${e} valid item(s)` : (0, Ye.str)`must contain at least ${e} and no more than ${t} valid item(s)`,
  params: ({ params: { min: e, max: t } }) => t === void 0 ? (0, Ye._)`{minContains: ${e}}` : (0, Ye._)`{minContains: ${e}, maxContains: ${t}}`
}, sE = {
  keyword: "contains",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  trackErrors: !0,
  error: nE,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, it: o } = e;
    let a, i;
    const { minContains: c, maxContains: d } = n;
    o.opts.next ? (a = c === void 0 ? 1 : c, i = d) : a = 1;
    const u = t.const("len", (0, Ye._)`${s}.length`);
    if (e.setParams({ min: a, max: i }), i === void 0 && a === 0) {
      (0, Fn.checkStrictMode)(o, '"minContains" == 0 without "maxContains": "contains" keyword ignored');
      return;
    }
    if (i !== void 0 && a > i) {
      (0, Fn.checkStrictMode)(o, '"minContains" > "maxContains" is always invalid'), e.fail();
      return;
    }
    if ((0, Fn.alwaysValidSchema)(o, r)) {
      let g = (0, Ye._)`${u} >= ${a}`;
      i !== void 0 && (g = (0, Ye._)`${g} && ${u} <= ${i}`), e.pass(g);
      return;
    }
    o.items = !0;
    const f = t.name("valid");
    i === void 0 && a === 1 ? y(f, () => t.if(f, () => t.break())) : a === 0 ? (t.let(f, !0), i !== void 0 && t.if((0, Ye._)`${s}.length > 0`, _)) : (t.let(f, !1), _()), e.result(f, () => e.reset());
    function _() {
      const g = t.name("_valid"), $ = t.let("count", 0);
      y(g, () => t.if(g, () => w($)));
    }
    function y(g, $) {
      t.forRange("i", 0, u, (p) => {
        e.subschema({
          keyword: "contains",
          dataProp: p,
          dataPropType: Fn.Type.Num,
          compositeRule: !0
        }, g), $();
      });
    }
    function w(g) {
      t.code((0, Ye._)`${g}++`), i === void 0 ? t.if((0, Ye._)`${g} >= ${a}`, () => t.assign(f, !0).break()) : (t.if((0, Ye._)`${g} > ${i}`, () => t.assign(f, !1).break()), a === 1 ? t.assign(f, !0) : t.if((0, Ye._)`${g} >= ${a}`, () => t.assign(f, !0)));
    }
  }
};
pi.default = sE;
var od = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.validateSchemaDeps = e.validatePropertyDeps = e.error = void 0;
  const t = ne, r = U, n = oe;
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
      const _ = Array.isArray(c[f]) ? d : u;
      _[f] = c[f];
    }
    return [d, u];
  }
  function a(c, d = c.schema) {
    const { gen: u, data: f, it: _ } = c;
    if (Object.keys(d).length === 0)
      return;
    const y = u.let("missing");
    for (const w in d) {
      const g = d[w];
      if (g.length === 0)
        continue;
      const $ = (0, n.propertyInData)(u, f, w, _.opts.ownProperties);
      c.setParams({
        property: w,
        depsCount: g.length,
        deps: g.join(", ")
      }), _.allErrors ? u.if($, () => {
        for (const p of g)
          (0, n.checkReportMissingProp)(c, p);
      }) : (u.if((0, t._)`${$} && (${(0, n.checkMissingProp)(c, g, y)})`), (0, n.reportMissingProp)(c, y), u.else());
    }
  }
  e.validatePropertyDeps = a;
  function i(c, d = c.schema) {
    const { gen: u, data: f, keyword: _, it: y } = c, w = u.name("valid");
    for (const g in d)
      (0, r.alwaysValidSchema)(y, d[g]) || (u.if(
        (0, n.propertyInData)(u, f, g, y.opts.ownProperties),
        () => {
          const $ = c.subschema({ keyword: _, schemaProp: g }, w);
          c.mergeValidEvaluated($, w);
        },
        () => u.var(w, !0)
        // TODO var
      ), c.ok(w));
  }
  e.validateSchemaDeps = i, e.default = s;
})(od);
var mi = {};
Object.defineProperty(mi, "__esModule", { value: !0 });
const ad = ne, oE = U, aE = {
  message: "property name must be valid",
  params: ({ params: e }) => (0, ad._)`{propertyName: ${e.propertyName}}`
}, iE = {
  keyword: "propertyNames",
  type: "object",
  schemaType: ["object", "boolean"],
  error: aE,
  code(e) {
    const { gen: t, schema: r, data: n, it: s } = e;
    if ((0, oE.alwaysValidSchema)(s, r))
      return;
    const o = t.name("valid");
    t.forIn("key", n, (a) => {
      e.setParams({ propertyName: a }), e.subschema({
        keyword: "propertyNames",
        data: a,
        dataTypes: ["string"],
        propertyName: a,
        compositeRule: !0
      }, o), t.if((0, ad.not)(o), () => {
        e.error(!0), s.allErrors || t.break();
      });
    }), e.ok(o);
  }
};
mi.default = iE;
var js = {};
Object.defineProperty(js, "__esModule", { value: !0 });
const Vn = oe, tt = ne, cE = gt, Un = U, lE = {
  message: "must NOT have additional properties",
  params: ({ params: e }) => (0, tt._)`{additionalProperty: ${e.additionalProperty}}`
}, uE = {
  keyword: "additionalProperties",
  type: ["object"],
  schemaType: ["boolean", "object"],
  allowUndefined: !0,
  trackErrors: !0,
  error: lE,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, errsCount: o, it: a } = e;
    if (!o)
      throw new Error("ajv implementation error");
    const { allErrors: i, opts: c } = a;
    if (a.props = !0, c.removeAdditional !== "all" && (0, Un.alwaysValidSchema)(a, r))
      return;
    const d = (0, Vn.allSchemaProperties)(n.properties), u = (0, Vn.allSchemaProperties)(n.patternProperties);
    f(), e.ok((0, tt._)`${o} === ${cE.default.errors}`);
    function f() {
      t.forIn("key", s, ($) => {
        !d.length && !u.length ? w($) : t.if(_($), () => w($));
      });
    }
    function _($) {
      let p;
      if (d.length > 8) {
        const E = (0, Un.schemaRefOrVal)(a, n.properties, "properties");
        p = (0, Vn.isOwnProperty)(t, E, $);
      } else d.length ? p = (0, tt.or)(...d.map((E) => (0, tt._)`${$} === ${E}`)) : p = tt.nil;
      return u.length && (p = (0, tt.or)(p, ...u.map((E) => (0, tt._)`${(0, Vn.usePattern)(e, E)}.test(${$})`))), (0, tt.not)(p);
    }
    function y($) {
      t.code((0, tt._)`delete ${s}[${$}]`);
    }
    function w($) {
      if (c.removeAdditional === "all" || c.removeAdditional && r === !1) {
        y($);
        return;
      }
      if (r === !1) {
        e.setParams({ additionalProperty: $ }), e.error(), i || t.break();
        return;
      }
      if (typeof r == "object" && !(0, Un.alwaysValidSchema)(a, r)) {
        const p = t.name("valid");
        c.removeAdditional === "failing" ? (g($, p, !1), t.if((0, tt.not)(p), () => {
          e.reset(), y($);
        })) : (g($, p), i || t.if((0, tt.not)(p), () => t.break()));
      }
    }
    function g($, p, E) {
      const N = {
        keyword: "additionalProperties",
        dataProp: $,
        dataPropType: Un.Type.Str
      };
      E === !1 && Object.assign(N, {
        compositeRule: !0,
        createErrors: !1,
        allErrors: !1
      }), e.subschema(N, p);
    }
  }
};
js.default = uE;
var yi = {};
Object.defineProperty(yi, "__esModule", { value: !0 });
const dE = at, Ac = oe, to = U, Cc = js, fE = {
  keyword: "properties",
  type: "object",
  schemaType: "object",
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, it: o } = e;
    o.opts.removeAdditional === "all" && n.additionalProperties === void 0 && Cc.default.code(new dE.KeywordCxt(o, Cc.default, "additionalProperties"));
    const a = (0, Ac.allSchemaProperties)(r);
    for (const f of a)
      o.definedProperties.add(f);
    o.opts.unevaluated && a.length && o.props !== !0 && (o.props = to.mergeEvaluated.props(t, (0, to.toHash)(a), o.props));
    const i = a.filter((f) => !(0, to.alwaysValidSchema)(o, r[f]));
    if (i.length === 0)
      return;
    const c = t.name("valid");
    for (const f of i)
      d(f) ? u(f) : (t.if((0, Ac.propertyInData)(t, s, f, o.opts.ownProperties)), u(f), o.allErrors || t.else().var(c, !0), t.endIf()), e.it.definedProperties.add(f), e.ok(c);
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
yi.default = fE;
var $i = {};
Object.defineProperty($i, "__esModule", { value: !0 });
const kc = oe, zn = ne, Dc = U, Mc = U, hE = {
  keyword: "patternProperties",
  type: "object",
  schemaType: "object",
  code(e) {
    const { gen: t, schema: r, data: n, parentSchema: s, it: o } = e, { opts: a } = o, i = (0, kc.allSchemaProperties)(r), c = i.filter((g) => (0, Dc.alwaysValidSchema)(o, r[g]));
    if (i.length === 0 || c.length === i.length && (!o.opts.unevaluated || o.props === !0))
      return;
    const d = a.strictSchema && !a.allowMatchingProperties && s.properties, u = t.name("valid");
    o.props !== !0 && !(o.props instanceof zn.Name) && (o.props = (0, Mc.evaluatedPropsToName)(t, o.props));
    const { props: f } = o;
    _();
    function _() {
      for (const g of i)
        d && y(g), o.allErrors ? w(g) : (t.var(u, !0), w(g), t.if(u));
    }
    function y(g) {
      for (const $ in d)
        new RegExp(g).test($) && (0, Dc.checkStrictMode)(o, `property ${$} matches pattern ${g} (use allowMatchingProperties)`);
    }
    function w(g) {
      t.forIn("key", n, ($) => {
        t.if((0, zn._)`${(0, kc.usePattern)(e, g)}.test(${$})`, () => {
          const p = c.includes(g);
          p || e.subschema({
            keyword: "patternProperties",
            schemaProp: g,
            dataProp: $,
            dataPropType: Mc.Type.Str
          }, u), o.opts.unevaluated && f !== !0 ? t.assign((0, zn._)`${f}[${$}]`, !0) : !p && !o.allErrors && t.if((0, zn.not)(u), () => t.break());
        });
      });
    }
  }
};
$i.default = hE;
var gi = {};
Object.defineProperty(gi, "__esModule", { value: !0 });
const pE = U, mE = {
  keyword: "not",
  schemaType: ["object", "boolean"],
  trackErrors: !0,
  code(e) {
    const { gen: t, schema: r, it: n } = e;
    if ((0, pE.alwaysValidSchema)(n, r)) {
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
gi.default = mE;
var _i = {};
Object.defineProperty(_i, "__esModule", { value: !0 });
const yE = oe, $E = {
  keyword: "anyOf",
  schemaType: "array",
  trackErrors: !0,
  code: yE.validateUnion,
  error: { message: "must match a schema in anyOf" }
};
_i.default = $E;
var vi = {};
Object.defineProperty(vi, "__esModule", { value: !0 });
const os = ne, gE = U, _E = {
  message: "must match exactly one schema in oneOf",
  params: ({ params: e }) => (0, os._)`{passingSchemas: ${e.passing}}`
}, vE = {
  keyword: "oneOf",
  schemaType: "array",
  trackErrors: !0,
  error: _E,
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
        let _;
        (0, gE.alwaysValidSchema)(s, u) ? t.var(c, !0) : _ = e.subschema({
          keyword: "oneOf",
          schemaProp: f,
          compositeRule: !0
        }, c), f > 0 && t.if((0, os._)`${c} && ${a}`).assign(a, !1).assign(i, (0, os._)`[${i}, ${f}]`).else(), t.if(c, () => {
          t.assign(a, !0), t.assign(i, f), _ && e.mergeEvaluated(_, os.Name);
        });
      });
    }
  }
};
vi.default = vE;
var Ei = {};
Object.defineProperty(Ei, "__esModule", { value: !0 });
const EE = U, wE = {
  keyword: "allOf",
  schemaType: "array",
  code(e) {
    const { gen: t, schema: r, it: n } = e;
    if (!Array.isArray(r))
      throw new Error("ajv implementation error");
    const s = t.name("valid");
    r.forEach((o, a) => {
      if ((0, EE.alwaysValidSchema)(n, o))
        return;
      const i = e.subschema({ keyword: "allOf", schemaProp: a }, s);
      e.ok(s), e.mergeEvaluated(i);
    });
  }
};
Ei.default = wE;
var wi = {};
Object.defineProperty(wi, "__esModule", { value: !0 });
const $s = ne, id = U, SE = {
  message: ({ params: e }) => (0, $s.str)`must match "${e.ifClause}" schema`,
  params: ({ params: e }) => (0, $s._)`{failingKeyword: ${e.ifClause}}`
}, bE = {
  keyword: "if",
  schemaType: ["object", "boolean"],
  trackErrors: !0,
  error: SE,
  code(e) {
    const { gen: t, parentSchema: r, it: n } = e;
    r.then === void 0 && r.else === void 0 && (0, id.checkStrictMode)(n, '"if" without "then" and "else" is ignored');
    const s = Lc(n, "then"), o = Lc(n, "else");
    if (!s && !o)
      return;
    const a = t.let("valid", !0), i = t.name("_valid");
    if (c(), e.reset(), s && o) {
      const u = t.let("ifClause");
      e.setParams({ ifClause: u }), t.if(i, d("then", u), d("else", u));
    } else s ? t.if(i, d("then")) : t.if((0, $s.not)(i), d("else"));
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
        const _ = e.subschema({ keyword: u }, i);
        t.assign(a, i), e.mergeValidEvaluated(_, a), f ? t.assign(f, (0, $s._)`${u}`) : e.setParams({ ifClause: u });
      };
    }
  }
};
function Lc(e, t) {
  const r = e.schema[t];
  return r !== void 0 && !(0, id.alwaysValidSchema)(e, r);
}
wi.default = bE;
var Si = {};
Object.defineProperty(Si, "__esModule", { value: !0 });
const PE = U, NE = {
  keyword: ["then", "else"],
  schemaType: ["object", "boolean"],
  code({ keyword: e, parentSchema: t, it: r }) {
    t.if === void 0 && (0, PE.checkStrictMode)(r, `"${e}" without "if" is ignored`);
  }
};
Si.default = NE;
Object.defineProperty(di, "__esModule", { value: !0 });
const RE = Wr, TE = fi, OE = Jr, IE = hi, jE = pi, AE = od, CE = mi, kE = js, DE = yi, ME = $i, LE = gi, FE = _i, VE = vi, UE = Ei, zE = wi, qE = Si;
function GE(e = !1) {
  const t = [
    // any
    LE.default,
    FE.default,
    VE.default,
    UE.default,
    zE.default,
    qE.default,
    // object
    CE.default,
    kE.default,
    AE.default,
    DE.default,
    ME.default
  ];
  return e ? t.push(TE.default, IE.default) : t.push(RE.default, OE.default), t.push(jE.default), t;
}
di.default = GE;
var bi = {}, Pi = {};
Object.defineProperty(Pi, "__esModule", { value: !0 });
const ge = ne, KE = {
  message: ({ schemaCode: e }) => (0, ge.str)`must match format "${e}"`,
  params: ({ schemaCode: e }) => (0, ge._)`{format: ${e}}`
}, HE = {
  keyword: "format",
  type: ["number", "string"],
  schemaType: "string",
  $data: !0,
  error: KE,
  code(e, t) {
    const { gen: r, data: n, $data: s, schema: o, schemaCode: a, it: i } = e, { opts: c, errSchemaPath: d, schemaEnv: u, self: f } = i;
    if (!c.validateFormats)
      return;
    s ? _() : y();
    function _() {
      const w = r.scopeValue("formats", {
        ref: f.formats,
        code: c.code.formats
      }), g = r.const("fDef", (0, ge._)`${w}[${a}]`), $ = r.let("fType"), p = r.let("format");
      r.if((0, ge._)`typeof ${g} == "object" && !(${g} instanceof RegExp)`, () => r.assign($, (0, ge._)`${g}.type || "string"`).assign(p, (0, ge._)`${g}.validate`), () => r.assign($, (0, ge._)`"string"`).assign(p, g)), e.fail$data((0, ge.or)(E(), N()));
      function E() {
        return c.strictSchema === !1 ? ge.nil : (0, ge._)`${a} && !${p}`;
      }
      function N() {
        const R = u.$async ? (0, ge._)`(${g}.async ? await ${p}(${n}) : ${p}(${n}))` : (0, ge._)`${p}(${n})`, T = (0, ge._)`(typeof ${p} == "function" ? ${R} : ${p}.test(${n}))`;
        return (0, ge._)`${p} && ${p} !== true && ${$} === ${t} && !${T}`;
      }
    }
    function y() {
      const w = f.formats[o];
      if (!w) {
        E();
        return;
      }
      if (w === !0)
        return;
      const [g, $, p] = N(w);
      g === t && e.pass(R());
      function E() {
        if (c.strictSchema === !1) {
          f.logger.warn(T());
          return;
        }
        throw new Error(T());
        function T() {
          return `unknown format "${o}" ignored in schema at path "${d}"`;
        }
      }
      function N(T) {
        const C = T instanceof RegExp ? (0, ge.regexpCode)(T) : c.code.formats ? (0, ge._)`${c.code.formats}${(0, ge.getProperty)(o)}` : void 0, k = r.scopeValue("formats", { key: o, ref: T, code: C });
        return typeof T == "object" && !(T instanceof RegExp) ? [T.type || "string", T.validate, (0, ge._)`${k}.validate`] : ["string", T, k];
      }
      function R() {
        if (typeof w == "object" && !(w instanceof RegExp) && w.async) {
          if (!u.$async)
            throw new Error("async format in sync schema");
          return (0, ge._)`await ${p}(${n})`;
        }
        return typeof $ == "function" ? (0, ge._)`${p}(${n})` : (0, ge._)`${p}.test(${n})`;
      }
    }
  }
};
Pi.default = HE;
Object.defineProperty(bi, "__esModule", { value: !0 });
const BE = Pi, WE = [BE.default];
bi.default = WE;
var Ur = {};
Object.defineProperty(Ur, "__esModule", { value: !0 });
Ur.contentVocabulary = Ur.metadataVocabulary = void 0;
Ur.metadataVocabulary = [
  "title",
  "description",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
  "examples"
];
Ur.contentVocabulary = [
  "contentMediaType",
  "contentEncoding",
  "contentSchema"
];
Object.defineProperty(Ya, "__esModule", { value: !0 });
const JE = xa, XE = Za, YE = di, xE = bi, Fc = Ur, QE = [
  JE.default,
  XE.default,
  (0, YE.default)(),
  xE.default,
  Fc.metadataVocabulary,
  Fc.contentVocabulary
];
Ya.default = QE;
var Ni = {}, As = {};
Object.defineProperty(As, "__esModule", { value: !0 });
As.DiscrError = void 0;
var Vc;
(function(e) {
  e.Tag = "tag", e.Mapping = "mapping";
})(Vc || (As.DiscrError = Vc = {}));
Object.defineProperty(Ni, "__esModule", { value: !0 });
const Tr = ne, Oo = As, Uc = Ge, ZE = Br, ew = U, tw = {
  message: ({ params: { discrError: e, tagName: t } }) => e === Oo.DiscrError.Tag ? `tag "${t}" must be string` : `value of tag "${t}" must be in oneOf`,
  params: ({ params: { discrError: e, tag: t, tagName: r } }) => (0, Tr._)`{error: ${e}, tag: ${r}, tagValue: ${t}}`
}, rw = {
  keyword: "discriminator",
  type: "object",
  schemaType: "object",
  error: tw,
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
    const c = t.let("valid", !1), d = t.const("tag", (0, Tr._)`${r}${(0, Tr.getProperty)(i)}`);
    t.if((0, Tr._)`typeof ${d} == "string"`, () => u(), () => e.error(!1, { discrError: Oo.DiscrError.Tag, tag: d, tagName: i })), e.ok(c);
    function u() {
      const y = _();
      t.if(!1);
      for (const w in y)
        t.elseIf((0, Tr._)`${d} === ${w}`), t.assign(c, f(y[w]));
      t.else(), e.error(!1, { discrError: Oo.DiscrError.Mapping, tag: d, tagName: i }), t.endIf();
    }
    function f(y) {
      const w = t.name("valid"), g = e.subschema({ keyword: "oneOf", schemaProp: y }, w);
      return e.mergeEvaluated(g, Tr.Name), w;
    }
    function _() {
      var y;
      const w = {}, g = p(s);
      let $ = !0;
      for (let R = 0; R < a.length; R++) {
        let T = a[R];
        if (T != null && T.$ref && !(0, ew.schemaHasRulesButRef)(T, o.self.RULES)) {
          const k = T.$ref;
          if (T = Uc.resolveRef.call(o.self, o.schemaEnv.root, o.baseId, k), T instanceof Uc.SchemaEnv && (T = T.schema), T === void 0)
            throw new ZE.default(o.opts.uriResolver, o.baseId, k);
        }
        const C = (y = T == null ? void 0 : T.properties) === null || y === void 0 ? void 0 : y[i];
        if (typeof C != "object")
          throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${i}"`);
        $ = $ && (g || p(T)), E(C, R);
      }
      if (!$)
        throw new Error(`discriminator: "${i}" must be required`);
      return w;
      function p({ required: R }) {
        return Array.isArray(R) && R.includes(i);
      }
      function E(R, T) {
        if (R.const)
          N(R.const, T);
        else if (R.enum)
          for (const C of R.enum)
            N(C, T);
        else
          throw new Error(`discriminator: "properties/${i}" must have "const" or "enum"`);
      }
      function N(R, T) {
        if (typeof R != "string" || R in w)
          throw new Error(`discriminator: "${i}" values must be unique strings`);
        w[R] = T;
      }
    }
  }
};
Ni.default = rw;
const nw = "http://json-schema.org/draft-07/schema#", sw = "http://json-schema.org/draft-07/schema#", ow = "Core schema meta-schema", aw = {
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
}, iw = [
  "object",
  "boolean"
], cw = {
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
}, lw = {
  $schema: nw,
  $id: sw,
  title: ow,
  definitions: aw,
  type: iw,
  properties: cw,
  default: !0
};
(function(e, t) {
  Object.defineProperty(t, "__esModule", { value: !0 }), t.MissingRefError = t.ValidationError = t.CodeGen = t.Name = t.nil = t.stringify = t.str = t._ = t.KeywordCxt = t.Ajv = void 0;
  const r = Eu, n = Ya, s = Ni, o = lw, a = ["/properties"], i = "http://json-schema.org/draft-07/schema";
  class c extends r.default {
    _addVocabularies() {
      super._addVocabularies(), n.default.forEach((w) => this.addVocabulary(w)), this.opts.discriminator && this.addKeyword(s.default);
    }
    _addDefaultMetaSchema() {
      if (super._addDefaultMetaSchema(), !this.opts.meta)
        return;
      const w = this.opts.$data ? this.$dataMetaSchema(o, a) : o;
      this.addMetaSchema(w, i, !1), this.refs["http://json-schema.org/schema"] = i;
    }
    defaultMeta() {
      return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(i) ? i : void 0);
    }
  }
  t.Ajv = c, e.exports = t = c, e.exports.Ajv = c, Object.defineProperty(t, "__esModule", { value: !0 }), t.default = c;
  var d = at;
  Object.defineProperty(t, "KeywordCxt", { enumerable: !0, get: function() {
    return d.KeywordCxt;
  } });
  var u = ne;
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
  var f = Sn;
  Object.defineProperty(t, "ValidationError", { enumerable: !0, get: function() {
    return f.default;
  } });
  var _ = Br;
  Object.defineProperty(t, "MissingRefError", { enumerable: !0, get: function() {
    return _.default;
  } });
})(wo, wo.exports);
var uw = wo.exports;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.formatLimitDefinition = void 0;
  const t = uw, r = ne, n = r.operators, s = {
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
      const { gen: c, data: d, schemaCode: u, keyword: f, it: _ } = i, { opts: y, self: w } = _;
      if (!y.validateFormats)
        return;
      const g = new t.KeywordCxt(_, w.RULES.all.format.definition, "format");
      g.$data ? $() : p();
      function $() {
        const N = c.scopeValue("formats", {
          ref: w.formats,
          code: y.code.formats
        }), R = c.const("fmt", (0, r._)`${N}[${g.schemaCode}]`);
        i.fail$data((0, r.or)((0, r._)`typeof ${R} != "object"`, (0, r._)`${R} instanceof RegExp`, (0, r._)`typeof ${R}.compare != "function"`, E(R)));
      }
      function p() {
        const N = g.schema, R = w.formats[N];
        if (!R || R === !0)
          return;
        if (typeof R != "object" || R instanceof RegExp || typeof R.compare != "function")
          throw new Error(`"${f}": format "${N}" does not define "compare" function`);
        const T = c.scopeValue("formats", {
          key: N,
          ref: R,
          code: y.code.formats ? (0, r._)`${y.code.formats}${(0, r.getProperty)(N)}` : void 0
        });
        i.fail$data(E(T));
      }
      function E(N) {
        return (0, r._)`${N}.compare(${d}, ${u}) ${s[f].fail} 0`;
      }
    },
    dependencies: ["format"]
  };
  const a = (i) => (i.addKeyword(e.formatLimitDefinition), i);
  e.default = a;
})(vu);
(function(e, t) {
  Object.defineProperty(t, "__esModule", { value: !0 });
  const r = _u, n = vu, s = ne, o = new s.Name("fullFormats"), a = new s.Name("fastFormats"), i = (d, u = { keywords: !0 }) => {
    if (Array.isArray(u))
      return c(d, u, r.fullFormats, o), d;
    const [f, _] = u.mode === "fast" ? [r.fastFormats, a] : [r.fullFormats, o], y = u.formats || r.formatNames;
    return c(d, y, f, _), u.keywords && (0, n.default)(d), d;
  };
  i.get = (d, u = "full") => {
    const _ = (u === "fast" ? r.fastFormats : r.fullFormats)[d];
    if (!_)
      throw new Error(`Unknown format "${d}"`);
    return _;
  };
  function c(d, u, f, _) {
    var y, w;
    (y = (w = d.opts.code).formats) !== null && y !== void 0 || (w.formats = (0, s._)`require("ajv-formats/dist/formats").${_}`);
    for (const g of u)
      d.addFormat(g, f[g]);
  }
  e.exports = t = i, Object.defineProperty(t, "__esModule", { value: !0 }), t.default = i;
})(Eo, Eo.exports);
var dw = Eo.exports;
const fw = /* @__PURE__ */ _l(dw), hw = (e, t, r, n) => {
  if (r === "length" || r === "prototype" || r === "arguments" || r === "caller")
    return;
  const s = Object.getOwnPropertyDescriptor(e, r), o = Object.getOwnPropertyDescriptor(t, r);
  !pw(s, o) && n || Object.defineProperty(e, r, o);
}, pw = function(e, t) {
  return e === void 0 || e.configurable || e.writable === t.writable && e.enumerable === t.enumerable && e.configurable === t.configurable && (e.writable || e.value === t.value);
}, mw = (e, t) => {
  const r = Object.getPrototypeOf(t);
  r !== Object.getPrototypeOf(e) && Object.setPrototypeOf(e, r);
}, yw = (e, t) => `/* Wrapped ${e}*/
${t}`, $w = Object.getOwnPropertyDescriptor(Function.prototype, "toString"), gw = Object.getOwnPropertyDescriptor(Function.prototype.toString, "name"), _w = (e, t, r) => {
  const n = r === "" ? "" : `with ${r.trim()}() `, s = yw.bind(null, n, t.toString());
  Object.defineProperty(s, "name", gw);
  const { writable: o, enumerable: a, configurable: i } = $w;
  Object.defineProperty(e, "toString", { value: s, writable: o, enumerable: a, configurable: i });
};
function vw(e, t, { ignoreNonConfigurable: r = !1 } = {}) {
  const { name: n } = e;
  for (const s of Reflect.ownKeys(t))
    hw(e, t, s, r);
  return mw(e, t), _w(e, t, n), e;
}
const zc = (e, t = {}) => {
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
    const f = this, _ = () => {
      a = void 0, i && (clearTimeout(i), i = void 0), o && (c = e.apply(f, u));
    }, y = () => {
      i = void 0, a && (clearTimeout(a), a = void 0), o && (c = e.apply(f, u));
    }, w = s && !a;
    return clearTimeout(a), a = setTimeout(_, r), n > 0 && n !== Number.POSITIVE_INFINITY && !i && (i = setTimeout(y, n)), w && (c = e.apply(f, u)), c;
  };
  return vw(d, e), d.cancel = () => {
    a && (clearTimeout(a), a = void 0), i && (clearTimeout(i), i = void 0);
  }, d;
};
var Io = { exports: {} };
const Ew = "2.0.0", cd = 256, ww = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
9007199254740991, Sw = 16, bw = cd - 6, Pw = [
  "major",
  "premajor",
  "minor",
  "preminor",
  "patch",
  "prepatch",
  "prerelease"
];
var Cs = {
  MAX_LENGTH: cd,
  MAX_SAFE_COMPONENT_LENGTH: Sw,
  MAX_SAFE_BUILD_LENGTH: bw,
  MAX_SAFE_INTEGER: ww,
  RELEASE_TYPES: Pw,
  SEMVER_SPEC_VERSION: Ew,
  FLAG_INCLUDE_PRERELEASE: 1,
  FLAG_LOOSE: 2
};
const Nw = typeof process == "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...e) => console.error("SEMVER", ...e) : () => {
};
var ks = Nw;
(function(e, t) {
  const {
    MAX_SAFE_COMPONENT_LENGTH: r,
    MAX_SAFE_BUILD_LENGTH: n,
    MAX_LENGTH: s
  } = Cs, o = ks;
  t = e.exports = {};
  const a = t.re = [], i = t.safeRe = [], c = t.src = [], d = t.safeSrc = [], u = t.t = {};
  let f = 0;
  const _ = "[a-zA-Z0-9-]", y = [
    ["\\s", 1],
    ["\\d", s],
    [_, n]
  ], w = ($) => {
    for (const [p, E] of y)
      $ = $.split(`${p}*`).join(`${p}{0,${E}}`).split(`${p}+`).join(`${p}{1,${E}}`);
    return $;
  }, g = ($, p, E) => {
    const N = w(p), R = f++;
    o($, R, p), u[$] = R, c[R] = p, d[R] = N, a[R] = new RegExp(p, E ? "g" : void 0), i[R] = new RegExp(N, E ? "g" : void 0);
  };
  g("NUMERICIDENTIFIER", "0|[1-9]\\d*"), g("NUMERICIDENTIFIERLOOSE", "\\d+"), g("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${_}*`), g("MAINVERSION", `(${c[u.NUMERICIDENTIFIER]})\\.(${c[u.NUMERICIDENTIFIER]})\\.(${c[u.NUMERICIDENTIFIER]})`), g("MAINVERSIONLOOSE", `(${c[u.NUMERICIDENTIFIERLOOSE]})\\.(${c[u.NUMERICIDENTIFIERLOOSE]})\\.(${c[u.NUMERICIDENTIFIERLOOSE]})`), g("PRERELEASEIDENTIFIER", `(?:${c[u.NONNUMERICIDENTIFIER]}|${c[u.NUMERICIDENTIFIER]})`), g("PRERELEASEIDENTIFIERLOOSE", `(?:${c[u.NONNUMERICIDENTIFIER]}|${c[u.NUMERICIDENTIFIERLOOSE]})`), g("PRERELEASE", `(?:-(${c[u.PRERELEASEIDENTIFIER]}(?:\\.${c[u.PRERELEASEIDENTIFIER]})*))`), g("PRERELEASELOOSE", `(?:-?(${c[u.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${c[u.PRERELEASEIDENTIFIERLOOSE]})*))`), g("BUILDIDENTIFIER", `${_}+`), g("BUILD", `(?:\\+(${c[u.BUILDIDENTIFIER]}(?:\\.${c[u.BUILDIDENTIFIER]})*))`), g("FULLPLAIN", `v?${c[u.MAINVERSION]}${c[u.PRERELEASE]}?${c[u.BUILD]}?`), g("FULL", `^${c[u.FULLPLAIN]}$`), g("LOOSEPLAIN", `[v=\\s]*${c[u.MAINVERSIONLOOSE]}${c[u.PRERELEASELOOSE]}?${c[u.BUILD]}?`), g("LOOSE", `^${c[u.LOOSEPLAIN]}$`), g("GTLT", "((?:<|>)?=?)"), g("XRANGEIDENTIFIERLOOSE", `${c[u.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`), g("XRANGEIDENTIFIER", `${c[u.NUMERICIDENTIFIER]}|x|X|\\*`), g("XRANGEPLAIN", `[v=\\s]*(${c[u.XRANGEIDENTIFIER]})(?:\\.(${c[u.XRANGEIDENTIFIER]})(?:\\.(${c[u.XRANGEIDENTIFIER]})(?:${c[u.PRERELEASE]})?${c[u.BUILD]}?)?)?`), g("XRANGEPLAINLOOSE", `[v=\\s]*(${c[u.XRANGEIDENTIFIERLOOSE]})(?:\\.(${c[u.XRANGEIDENTIFIERLOOSE]})(?:\\.(${c[u.XRANGEIDENTIFIERLOOSE]})(?:${c[u.PRERELEASELOOSE]})?${c[u.BUILD]}?)?)?`), g("XRANGE", `^${c[u.GTLT]}\\s*${c[u.XRANGEPLAIN]}$`), g("XRANGELOOSE", `^${c[u.GTLT]}\\s*${c[u.XRANGEPLAINLOOSE]}$`), g("COERCEPLAIN", `(^|[^\\d])(\\d{1,${r}})(?:\\.(\\d{1,${r}}))?(?:\\.(\\d{1,${r}}))?`), g("COERCE", `${c[u.COERCEPLAIN]}(?:$|[^\\d])`), g("COERCEFULL", c[u.COERCEPLAIN] + `(?:${c[u.PRERELEASE]})?(?:${c[u.BUILD]})?(?:$|[^\\d])`), g("COERCERTL", c[u.COERCE], !0), g("COERCERTLFULL", c[u.COERCEFULL], !0), g("LONETILDE", "(?:~>?)"), g("TILDETRIM", `(\\s*)${c[u.LONETILDE]}\\s+`, !0), t.tildeTrimReplace = "$1~", g("TILDE", `^${c[u.LONETILDE]}${c[u.XRANGEPLAIN]}$`), g("TILDELOOSE", `^${c[u.LONETILDE]}${c[u.XRANGEPLAINLOOSE]}$`), g("LONECARET", "(?:\\^)"), g("CARETTRIM", `(\\s*)${c[u.LONECARET]}\\s+`, !0), t.caretTrimReplace = "$1^", g("CARET", `^${c[u.LONECARET]}${c[u.XRANGEPLAIN]}$`), g("CARETLOOSE", `^${c[u.LONECARET]}${c[u.XRANGEPLAINLOOSE]}$`), g("COMPARATORLOOSE", `^${c[u.GTLT]}\\s*(${c[u.LOOSEPLAIN]})$|^$`), g("COMPARATOR", `^${c[u.GTLT]}\\s*(${c[u.FULLPLAIN]})$|^$`), g("COMPARATORTRIM", `(\\s*)${c[u.GTLT]}\\s*(${c[u.LOOSEPLAIN]}|${c[u.XRANGEPLAIN]})`, !0), t.comparatorTrimReplace = "$1$2$3", g("HYPHENRANGE", `^\\s*(${c[u.XRANGEPLAIN]})\\s+-\\s+(${c[u.XRANGEPLAIN]})\\s*$`), g("HYPHENRANGELOOSE", `^\\s*(${c[u.XRANGEPLAINLOOSE]})\\s+-\\s+(${c[u.XRANGEPLAINLOOSE]})\\s*$`), g("STAR", "(<|>)?=?\\s*\\*"), g("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$"), g("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
})(Io, Io.exports);
var Pn = Io.exports;
const Rw = Object.freeze({ loose: !0 }), Tw = Object.freeze({}), Ow = (e) => e ? typeof e != "object" ? Rw : e : Tw;
var Ri = Ow;
const qc = /^[0-9]+$/, ld = (e, t) => {
  if (typeof e == "number" && typeof t == "number")
    return e === t ? 0 : e < t ? -1 : 1;
  const r = qc.test(e), n = qc.test(t);
  return r && n && (e = +e, t = +t), e === t ? 0 : r && !n ? -1 : n && !r ? 1 : e < t ? -1 : 1;
}, Iw = (e, t) => ld(t, e);
var ud = {
  compareIdentifiers: ld,
  rcompareIdentifiers: Iw
};
const qn = ks, { MAX_LENGTH: Gc, MAX_SAFE_INTEGER: Gn } = Cs, { safeRe: Kn, t: Hn } = Pn, jw = Ri, { compareIdentifiers: ro } = ud;
let Aw = class ut {
  constructor(t, r) {
    if (r = jw(r), t instanceof ut) {
      if (t.loose === !!r.loose && t.includePrerelease === !!r.includePrerelease)
        return t;
      t = t.version;
    } else if (typeof t != "string")
      throw new TypeError(`Invalid version. Must be a string. Got type "${typeof t}".`);
    if (t.length > Gc)
      throw new TypeError(
        `version is longer than ${Gc} characters`
      );
    qn("SemVer", t, r), this.options = r, this.loose = !!r.loose, this.includePrerelease = !!r.includePrerelease;
    const n = t.trim().match(r.loose ? Kn[Hn.LOOSE] : Kn[Hn.FULL]);
    if (!n)
      throw new TypeError(`Invalid Version: ${t}`);
    if (this.raw = t, this.major = +n[1], this.minor = +n[2], this.patch = +n[3], this.major > Gn || this.major < 0)
      throw new TypeError("Invalid major version");
    if (this.minor > Gn || this.minor < 0)
      throw new TypeError("Invalid minor version");
    if (this.patch > Gn || this.patch < 0)
      throw new TypeError("Invalid patch version");
    n[4] ? this.prerelease = n[4].split(".").map((s) => {
      if (/^[0-9]+$/.test(s)) {
        const o = +s;
        if (o >= 0 && o < Gn)
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
    if (qn("SemVer.compare", this.version, this.options, t), !(t instanceof ut)) {
      if (typeof t == "string" && t === this.version)
        return 0;
      t = new ut(t, this.options);
    }
    return t.version === this.version ? 0 : this.compareMain(t) || this.comparePre(t);
  }
  compareMain(t) {
    return t instanceof ut || (t = new ut(t, this.options)), this.major < t.major ? -1 : this.major > t.major ? 1 : this.minor < t.minor ? -1 : this.minor > t.minor ? 1 : this.patch < t.patch ? -1 : this.patch > t.patch ? 1 : 0;
  }
  comparePre(t) {
    if (t instanceof ut || (t = new ut(t, this.options)), this.prerelease.length && !t.prerelease.length)
      return -1;
    if (!this.prerelease.length && t.prerelease.length)
      return 1;
    if (!this.prerelease.length && !t.prerelease.length)
      return 0;
    let r = 0;
    do {
      const n = this.prerelease[r], s = t.prerelease[r];
      if (qn("prerelease compare", r, n, s), n === void 0 && s === void 0)
        return 0;
      if (s === void 0)
        return 1;
      if (n === void 0)
        return -1;
      if (n === s)
        continue;
      return ro(n, s);
    } while (++r);
  }
  compareBuild(t) {
    t instanceof ut || (t = new ut(t, this.options));
    let r = 0;
    do {
      const n = this.build[r], s = t.build[r];
      if (qn("build compare", r, n, s), n === void 0 && s === void 0)
        return 0;
      if (s === void 0)
        return 1;
      if (n === void 0)
        return -1;
      if (n === s)
        continue;
      return ro(n, s);
    } while (++r);
  }
  // preminor will bump the version up to the next minor release, and immediately
  // down to pre-release. premajor and prepatch work the same way.
  inc(t, r, n) {
    if (t.startsWith("pre")) {
      if (!r && n === !1)
        throw new Error("invalid increment argument: identifier is empty");
      if (r) {
        const s = `-${r}`.match(this.options.loose ? Kn[Hn.PRERELEASELOOSE] : Kn[Hn.PRERELEASE]);
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
          n === !1 && (o = [r]), ro(this.prerelease[0], r) === 0 ? isNaN(this.prerelease[1]) && (this.prerelease = o) : this.prerelease = o;
        }
        break;
      }
      default:
        throw new Error(`invalid increment argument: ${t}`);
    }
    return this.raw = this.format(), this.build.length && (this.raw += `+${this.build.join(".")}`), this;
  }
};
var Ve = Aw;
const Kc = Ve, Cw = (e, t, r = !1) => {
  if (e instanceof Kc)
    return e;
  try {
    return new Kc(e, t);
  } catch (n) {
    if (!r)
      return null;
    throw n;
  }
};
var Xr = Cw;
const kw = Xr, Dw = (e, t) => {
  const r = kw(e, t);
  return r ? r.version : null;
};
var Mw = Dw;
const Lw = Xr, Fw = (e, t) => {
  const r = Lw(e.trim().replace(/^[=v]+/, ""), t);
  return r ? r.version : null;
};
var Vw = Fw;
const Hc = Ve, Uw = (e, t, r, n, s) => {
  typeof r == "string" && (s = n, n = r, r = void 0);
  try {
    return new Hc(
      e instanceof Hc ? e.version : e,
      r
    ).inc(t, n, s).version;
  } catch {
    return null;
  }
};
var zw = Uw;
const Bc = Xr, qw = (e, t) => {
  const r = Bc(e, null, !0), n = Bc(t, null, !0), s = r.compare(n);
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
var Gw = qw;
const Kw = Ve, Hw = (e, t) => new Kw(e, t).major;
var Bw = Hw;
const Ww = Ve, Jw = (e, t) => new Ww(e, t).minor;
var Xw = Jw;
const Yw = Ve, xw = (e, t) => new Yw(e, t).patch;
var Qw = xw;
const Zw = Xr, eS = (e, t) => {
  const r = Zw(e, t);
  return r && r.prerelease.length ? r.prerelease : null;
};
var tS = eS;
const Wc = Ve, rS = (e, t, r) => new Wc(e, r).compare(new Wc(t, r));
var it = rS;
const nS = it, sS = (e, t, r) => nS(t, e, r);
var oS = sS;
const aS = it, iS = (e, t) => aS(e, t, !0);
var cS = iS;
const Jc = Ve, lS = (e, t, r) => {
  const n = new Jc(e, r), s = new Jc(t, r);
  return n.compare(s) || n.compareBuild(s);
};
var Ti = lS;
const uS = Ti, dS = (e, t) => e.sort((r, n) => uS(r, n, t));
var fS = dS;
const hS = Ti, pS = (e, t) => e.sort((r, n) => hS(n, r, t));
var mS = pS;
const yS = it, $S = (e, t, r) => yS(e, t, r) > 0;
var Ds = $S;
const gS = it, _S = (e, t, r) => gS(e, t, r) < 0;
var Oi = _S;
const vS = it, ES = (e, t, r) => vS(e, t, r) === 0;
var dd = ES;
const wS = it, SS = (e, t, r) => wS(e, t, r) !== 0;
var fd = SS;
const bS = it, PS = (e, t, r) => bS(e, t, r) >= 0;
var Ii = PS;
const NS = it, RS = (e, t, r) => NS(e, t, r) <= 0;
var ji = RS;
const TS = dd, OS = fd, IS = Ds, jS = Ii, AS = Oi, CS = ji, kS = (e, t, r, n) => {
  switch (t) {
    case "===":
      return typeof e == "object" && (e = e.version), typeof r == "object" && (r = r.version), e === r;
    case "!==":
      return typeof e == "object" && (e = e.version), typeof r == "object" && (r = r.version), e !== r;
    case "":
    case "=":
    case "==":
      return TS(e, r, n);
    case "!=":
      return OS(e, r, n);
    case ">":
      return IS(e, r, n);
    case ">=":
      return jS(e, r, n);
    case "<":
      return AS(e, r, n);
    case "<=":
      return CS(e, r, n);
    default:
      throw new TypeError(`Invalid operator: ${t}`);
  }
};
var hd = kS;
const DS = Ve, MS = Xr, { safeRe: Bn, t: Wn } = Pn, LS = (e, t) => {
  if (e instanceof DS)
    return e;
  if (typeof e == "number" && (e = String(e)), typeof e != "string")
    return null;
  t = t || {};
  let r = null;
  if (!t.rtl)
    r = e.match(t.includePrerelease ? Bn[Wn.COERCEFULL] : Bn[Wn.COERCE]);
  else {
    const c = t.includePrerelease ? Bn[Wn.COERCERTLFULL] : Bn[Wn.COERCERTL];
    let d;
    for (; (d = c.exec(e)) && (!r || r.index + r[0].length !== e.length); )
      (!r || d.index + d[0].length !== r.index + r[0].length) && (r = d), c.lastIndex = d.index + d[1].length + d[2].length;
    c.lastIndex = -1;
  }
  if (r === null)
    return null;
  const n = r[2], s = r[3] || "0", o = r[4] || "0", a = t.includePrerelease && r[5] ? `-${r[5]}` : "", i = t.includePrerelease && r[6] ? `+${r[6]}` : "";
  return MS(`${n}.${s}.${o}${a}${i}`, t);
};
var FS = LS;
class VS {
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
var US = VS, no, Xc;
function ct() {
  if (Xc) return no;
  Xc = 1;
  const e = /\s+/g;
  class t {
    constructor(A, V) {
      if (V = s(V), A instanceof t)
        return A.loose === !!V.loose && A.includePrerelease === !!V.includePrerelease ? A : new t(A.raw, V);
      if (A instanceof o)
        return this.raw = A.value, this.set = [[A]], this.formatted = void 0, this;
      if (this.options = V, this.loose = !!V.loose, this.includePrerelease = !!V.includePrerelease, this.raw = A.trim().replace(e, " "), this.set = this.raw.split("||").map((D) => this.parseRange(D.trim())).filter((D) => D.length), !this.set.length)
        throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
      if (this.set.length > 1) {
        const D = this.set[0];
        if (this.set = this.set.filter((G) => !g(G[0])), this.set.length === 0)
          this.set = [D];
        else if (this.set.length > 1) {
          for (const G of this.set)
            if (G.length === 1 && $(G[0])) {
              this.set = [G];
              break;
            }
        }
      }
      this.formatted = void 0;
    }
    get range() {
      if (this.formatted === void 0) {
        this.formatted = "";
        for (let A = 0; A < this.set.length; A++) {
          A > 0 && (this.formatted += "||");
          const V = this.set[A];
          for (let D = 0; D < V.length; D++)
            D > 0 && (this.formatted += " "), this.formatted += V[D].toString().trim();
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
    parseRange(A) {
      const D = ((this.options.includePrerelease && y) | (this.options.loose && w)) + ":" + A, G = n.get(D);
      if (G)
        return G;
      const M = this.options.loose, P = M ? c[d.HYPHENRANGELOOSE] : c[d.HYPHENRANGE];
      A = A.replace(P, z(this.options.includePrerelease)), a("hyphen replace", A), A = A.replace(c[d.COMPARATORTRIM], u), a("comparator trim", A), A = A.replace(c[d.TILDETRIM], f), a("tilde trim", A), A = A.replace(c[d.CARETTRIM], _), a("caret trim", A);
      let m = A.split(" ").map((h) => E(h, this.options)).join(" ").split(/\s+/).map((h) => L(h, this.options));
      M && (m = m.filter((h) => (a("loose invalid filter", h, this.options), !!h.match(c[d.COMPARATORLOOSE])))), a("range list", m);
      const S = /* @__PURE__ */ new Map(), v = m.map((h) => new o(h, this.options));
      for (const h of v) {
        if (g(h))
          return [h];
        S.set(h.value, h);
      }
      S.size > 1 && S.has("") && S.delete("");
      const l = [...S.values()];
      return n.set(D, l), l;
    }
    intersects(A, V) {
      if (!(A instanceof t))
        throw new TypeError("a Range is required");
      return this.set.some((D) => p(D, V) && A.set.some((G) => p(G, V) && D.every((M) => G.every((P) => M.intersects(P, V)))));
    }
    // if ANY of the sets match ALL of its comparators, then pass
    test(A) {
      if (!A)
        return !1;
      if (typeof A == "string")
        try {
          A = new i(A, this.options);
        } catch {
          return !1;
        }
      for (let V = 0; V < this.set.length; V++)
        if (ae(this.set[V], A, this.options))
          return !0;
      return !1;
    }
  }
  no = t;
  const r = US, n = new r(), s = Ri, o = Ms(), a = ks, i = Ve, {
    safeRe: c,
    t: d,
    comparatorTrimReplace: u,
    tildeTrimReplace: f,
    caretTrimReplace: _
  } = Pn, { FLAG_INCLUDE_PRERELEASE: y, FLAG_LOOSE: w } = Cs, g = (O) => O.value === "<0.0.0-0", $ = (O) => O.value === "", p = (O, A) => {
    let V = !0;
    const D = O.slice();
    let G = D.pop();
    for (; V && D.length; )
      V = D.every((M) => G.intersects(M, A)), G = D.pop();
    return V;
  }, E = (O, A) => (O = O.replace(c[d.BUILD], ""), a("comp", O, A), O = C(O, A), a("caret", O), O = R(O, A), a("tildes", O), O = ce(O, A), a("xrange", O), O = me(O, A), a("stars", O), O), N = (O) => !O || O.toLowerCase() === "x" || O === "*", R = (O, A) => O.trim().split(/\s+/).map((V) => T(V, A)).join(" "), T = (O, A) => {
    const V = A.loose ? c[d.TILDELOOSE] : c[d.TILDE];
    return O.replace(V, (D, G, M, P, m) => {
      a("tilde", O, D, G, M, P, m);
      let S;
      return N(G) ? S = "" : N(M) ? S = `>=${G}.0.0 <${+G + 1}.0.0-0` : N(P) ? S = `>=${G}.${M}.0 <${G}.${+M + 1}.0-0` : m ? (a("replaceTilde pr", m), S = `>=${G}.${M}.${P}-${m} <${G}.${+M + 1}.0-0`) : S = `>=${G}.${M}.${P} <${G}.${+M + 1}.0-0`, a("tilde return", S), S;
    });
  }, C = (O, A) => O.trim().split(/\s+/).map((V) => k(V, A)).join(" "), k = (O, A) => {
    a("caret", O, A);
    const V = A.loose ? c[d.CARETLOOSE] : c[d.CARET], D = A.includePrerelease ? "-0" : "";
    return O.replace(V, (G, M, P, m, S) => {
      a("caret", O, G, M, P, m, S);
      let v;
      return N(M) ? v = "" : N(P) ? v = `>=${M}.0.0${D} <${+M + 1}.0.0-0` : N(m) ? M === "0" ? v = `>=${M}.${P}.0${D} <${M}.${+P + 1}.0-0` : v = `>=${M}.${P}.0${D} <${+M + 1}.0.0-0` : S ? (a("replaceCaret pr", S), M === "0" ? P === "0" ? v = `>=${M}.${P}.${m}-${S} <${M}.${P}.${+m + 1}-0` : v = `>=${M}.${P}.${m}-${S} <${M}.${+P + 1}.0-0` : v = `>=${M}.${P}.${m}-${S} <${+M + 1}.0.0-0`) : (a("no pr"), M === "0" ? P === "0" ? v = `>=${M}.${P}.${m}${D} <${M}.${P}.${+m + 1}-0` : v = `>=${M}.${P}.${m}${D} <${M}.${+P + 1}.0-0` : v = `>=${M}.${P}.${m} <${+M + 1}.0.0-0`), a("caret return", v), v;
    });
  }, ce = (O, A) => (a("replaceXRanges", O, A), O.split(/\s+/).map((V) => le(V, A)).join(" ")), le = (O, A) => {
    O = O.trim();
    const V = A.loose ? c[d.XRANGELOOSE] : c[d.XRANGE];
    return O.replace(V, (D, G, M, P, m, S) => {
      a("xRange", O, D, G, M, P, m, S);
      const v = N(M), l = v || N(P), h = l || N(m), b = h;
      return G === "=" && b && (G = ""), S = A.includePrerelease ? "-0" : "", v ? G === ">" || G === "<" ? D = "<0.0.0-0" : D = "*" : G && b ? (l && (P = 0), m = 0, G === ">" ? (G = ">=", l ? (M = +M + 1, P = 0, m = 0) : (P = +P + 1, m = 0)) : G === "<=" && (G = "<", l ? M = +M + 1 : P = +P + 1), G === "<" && (S = "-0"), D = `${G + M}.${P}.${m}${S}`) : l ? D = `>=${M}.0.0${S} <${+M + 1}.0.0-0` : h && (D = `>=${M}.${P}.0${S} <${M}.${+P + 1}.0-0`), a("xRange return", D), D;
    });
  }, me = (O, A) => (a("replaceStars", O, A), O.trim().replace(c[d.STAR], "")), L = (O, A) => (a("replaceGTE0", O, A), O.trim().replace(c[A.includePrerelease ? d.GTE0PRE : d.GTE0], "")), z = (O) => (A, V, D, G, M, P, m, S, v, l, h, b) => (N(D) ? V = "" : N(G) ? V = `>=${D}.0.0${O ? "-0" : ""}` : N(M) ? V = `>=${D}.${G}.0${O ? "-0" : ""}` : P ? V = `>=${V}` : V = `>=${V}${O ? "-0" : ""}`, N(v) ? S = "" : N(l) ? S = `<${+v + 1}.0.0-0` : N(h) ? S = `<${v}.${+l + 1}.0-0` : b ? S = `<=${v}.${l}.${h}-${b}` : O ? S = `<${v}.${l}.${+h + 1}-0` : S = `<=${S}`, `${V} ${S}`.trim()), ae = (O, A, V) => {
    for (let D = 0; D < O.length; D++)
      if (!O[D].test(A))
        return !1;
    if (A.prerelease.length && !V.includePrerelease) {
      for (let D = 0; D < O.length; D++)
        if (a(O[D].semver), O[D].semver !== o.ANY && O[D].semver.prerelease.length > 0) {
          const G = O[D].semver;
          if (G.major === A.major && G.minor === A.minor && G.patch === A.patch)
            return !0;
        }
      return !1;
    }
    return !0;
  };
  return no;
}
var so, Yc;
function Ms() {
  if (Yc) return so;
  Yc = 1;
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
      const f = this.options.loose ? n[s.COMPARATORLOOSE] : n[s.COMPARATOR], _ = u.match(f);
      if (!_)
        throw new TypeError(`Invalid comparator: ${u}`);
      this.operator = _[1] !== void 0 ? _[1] : "", this.operator === "=" && (this.operator = ""), _[2] ? this.semver = new i(_[2], this.options.loose) : this.semver = e;
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
  so = t;
  const r = Ri, { safeRe: n, t: s } = Pn, o = hd, a = ks, i = Ve, c = ct();
  return so;
}
const zS = ct(), qS = (e, t, r) => {
  try {
    t = new zS(t, r);
  } catch {
    return !1;
  }
  return t.test(e);
};
var Ls = qS;
const GS = ct(), KS = (e, t) => new GS(e, t).set.map((r) => r.map((n) => n.value).join(" ").trim().split(" "));
var HS = KS;
const BS = Ve, WS = ct(), JS = (e, t, r) => {
  let n = null, s = null, o = null;
  try {
    o = new WS(t, r);
  } catch {
    return null;
  }
  return e.forEach((a) => {
    o.test(a) && (!n || s.compare(a) === -1) && (n = a, s = new BS(n, r));
  }), n;
};
var XS = JS;
const YS = Ve, xS = ct(), QS = (e, t, r) => {
  let n = null, s = null, o = null;
  try {
    o = new xS(t, r);
  } catch {
    return null;
  }
  return e.forEach((a) => {
    o.test(a) && (!n || s.compare(a) === 1) && (n = a, s = new YS(n, r));
  }), n;
};
var ZS = QS;
const oo = Ve, eb = ct(), xc = Ds, tb = (e, t) => {
  e = new eb(e, t);
  let r = new oo("0.0.0");
  if (e.test(r) || (r = new oo("0.0.0-0"), e.test(r)))
    return r;
  r = null;
  for (let n = 0; n < e.set.length; ++n) {
    const s = e.set[n];
    let o = null;
    s.forEach((a) => {
      const i = new oo(a.semver.version);
      switch (a.operator) {
        case ">":
          i.prerelease.length === 0 ? i.patch++ : i.prerelease.push(0), i.raw = i.format();
        case "":
        case ">=":
          (!o || xc(i, o)) && (o = i);
          break;
        case "<":
        case "<=":
          break;
        default:
          throw new Error(`Unexpected operation: ${a.operator}`);
      }
    }), o && (!r || xc(r, o)) && (r = o);
  }
  return r && e.test(r) ? r : null;
};
var rb = tb;
const nb = ct(), sb = (e, t) => {
  try {
    return new nb(e, t).range || "*";
  } catch {
    return null;
  }
};
var ob = sb;
const ab = Ve, pd = Ms(), { ANY: ib } = pd, cb = ct(), lb = Ls, Qc = Ds, Zc = Oi, ub = ji, db = Ii, fb = (e, t, r, n) => {
  e = new ab(e, n), t = new cb(t, n);
  let s, o, a, i, c;
  switch (r) {
    case ">":
      s = Qc, o = ub, a = Zc, i = ">", c = ">=";
      break;
    case "<":
      s = Zc, o = db, a = Qc, i = "<", c = "<=";
      break;
    default:
      throw new TypeError('Must provide a hilo val of "<" or ">"');
  }
  if (lb(e, t, n))
    return !1;
  for (let d = 0; d < t.set.length; ++d) {
    const u = t.set[d];
    let f = null, _ = null;
    if (u.forEach((y) => {
      y.semver === ib && (y = new pd(">=0.0.0")), f = f || y, _ = _ || y, s(y.semver, f.semver, n) ? f = y : a(y.semver, _.semver, n) && (_ = y);
    }), f.operator === i || f.operator === c || (!_.operator || _.operator === i) && o(e, _.semver))
      return !1;
    if (_.operator === c && a(e, _.semver))
      return !1;
  }
  return !0;
};
var Ai = fb;
const hb = Ai, pb = (e, t, r) => hb(e, t, ">", r);
var mb = pb;
const yb = Ai, $b = (e, t, r) => yb(e, t, "<", r);
var gb = $b;
const el = ct(), _b = (e, t, r) => (e = new el(e, r), t = new el(t, r), e.intersects(t, r));
var vb = _b;
const Eb = Ls, wb = it;
var Sb = (e, t, r) => {
  const n = [];
  let s = null, o = null;
  const a = e.sort((u, f) => wb(u, f, r));
  for (const u of a)
    Eb(u, t, r) ? (o = u, s || (s = u)) : (o && n.push([s, o]), o = null, s = null);
  s && n.push([s, null]);
  const i = [];
  for (const [u, f] of n)
    u === f ? i.push(u) : !f && u === a[0] ? i.push("*") : f ? u === a[0] ? i.push(`<=${f}`) : i.push(`${u} - ${f}`) : i.push(`>=${u}`);
  const c = i.join(" || "), d = typeof t.raw == "string" ? t.raw : String(t);
  return c.length < d.length ? c : t;
};
const tl = ct(), Ci = Ms(), { ANY: ao } = Ci, nn = Ls, ki = it, bb = (e, t, r = {}) => {
  if (e === t)
    return !0;
  e = new tl(e, r), t = new tl(t, r);
  let n = !1;
  e: for (const s of e.set) {
    for (const o of t.set) {
      const a = Nb(s, o, r);
      if (n = n || a !== null, a)
        continue e;
    }
    if (n)
      return !1;
  }
  return !0;
}, Pb = [new Ci(">=0.0.0-0")], rl = [new Ci(">=0.0.0")], Nb = (e, t, r) => {
  if (e === t)
    return !0;
  if (e.length === 1 && e[0].semver === ao) {
    if (t.length === 1 && t[0].semver === ao)
      return !0;
    r.includePrerelease ? e = Pb : e = rl;
  }
  if (t.length === 1 && t[0].semver === ao) {
    if (r.includePrerelease)
      return !0;
    t = rl;
  }
  const n = /* @__PURE__ */ new Set();
  let s, o;
  for (const y of e)
    y.operator === ">" || y.operator === ">=" ? s = nl(s, y, r) : y.operator === "<" || y.operator === "<=" ? o = sl(o, y, r) : n.add(y.semver);
  if (n.size > 1)
    return null;
  let a;
  if (s && o) {
    if (a = ki(s.semver, o.semver, r), a > 0)
      return null;
    if (a === 0 && (s.operator !== ">=" || o.operator !== "<="))
      return null;
  }
  for (const y of n) {
    if (s && !nn(y, String(s), r) || o && !nn(y, String(o), r))
      return null;
    for (const w of t)
      if (!nn(y, String(w), r))
        return !1;
    return !0;
  }
  let i, c, d, u, f = o && !r.includePrerelease && o.semver.prerelease.length ? o.semver : !1, _ = s && !r.includePrerelease && s.semver.prerelease.length ? s.semver : !1;
  f && f.prerelease.length === 1 && o.operator === "<" && f.prerelease[0] === 0 && (f = !1);
  for (const y of t) {
    if (u = u || y.operator === ">" || y.operator === ">=", d = d || y.operator === "<" || y.operator === "<=", s) {
      if (_ && y.semver.prerelease && y.semver.prerelease.length && y.semver.major === _.major && y.semver.minor === _.minor && y.semver.patch === _.patch && (_ = !1), y.operator === ">" || y.operator === ">=") {
        if (i = nl(s, y, r), i === y && i !== s)
          return !1;
      } else if (s.operator === ">=" && !nn(s.semver, String(y), r))
        return !1;
    }
    if (o) {
      if (f && y.semver.prerelease && y.semver.prerelease.length && y.semver.major === f.major && y.semver.minor === f.minor && y.semver.patch === f.patch && (f = !1), y.operator === "<" || y.operator === "<=") {
        if (c = sl(o, y, r), c === y && c !== o)
          return !1;
      } else if (o.operator === "<=" && !nn(o.semver, String(y), r))
        return !1;
    }
    if (!y.operator && (o || s) && a !== 0)
      return !1;
  }
  return !(s && d && !o && a !== 0 || o && u && !s && a !== 0 || _ || f);
}, nl = (e, t, r) => {
  if (!e)
    return t;
  const n = ki(e.semver, t.semver, r);
  return n > 0 ? e : n < 0 || t.operator === ">" && e.operator === ">=" ? t : e;
}, sl = (e, t, r) => {
  if (!e)
    return t;
  const n = ki(e.semver, t.semver, r);
  return n < 0 ? e : n > 0 || t.operator === "<" && e.operator === "<=" ? t : e;
};
var Rb = bb;
const io = Pn, ol = Cs, Tb = Ve, al = ud, Ob = Xr, Ib = Mw, jb = Vw, Ab = zw, Cb = Gw, kb = Bw, Db = Xw, Mb = Qw, Lb = tS, Fb = it, Vb = oS, Ub = cS, zb = Ti, qb = fS, Gb = mS, Kb = Ds, Hb = Oi, Bb = dd, Wb = fd, Jb = Ii, Xb = ji, Yb = hd, xb = FS, Qb = Ms(), Zb = ct(), eP = Ls, tP = HS, rP = XS, nP = ZS, sP = rb, oP = ob, aP = Ai, iP = mb, cP = gb, lP = vb, uP = Sb, dP = Rb;
var fP = {
  parse: Ob,
  valid: Ib,
  clean: jb,
  inc: Ab,
  diff: Cb,
  major: kb,
  minor: Db,
  patch: Mb,
  prerelease: Lb,
  compare: Fb,
  rcompare: Vb,
  compareLoose: Ub,
  compareBuild: zb,
  sort: qb,
  rsort: Gb,
  gt: Kb,
  lt: Hb,
  eq: Bb,
  neq: Wb,
  gte: Jb,
  lte: Xb,
  cmp: Yb,
  coerce: xb,
  Comparator: Qb,
  Range: Zb,
  satisfies: eP,
  toComparators: tP,
  maxSatisfying: rP,
  minSatisfying: nP,
  minVersion: sP,
  validRange: oP,
  outside: aP,
  gtr: iP,
  ltr: cP,
  intersects: lP,
  simplifyRange: uP,
  subset: dP,
  SemVer: Tb,
  re: io.re,
  src: io.src,
  tokens: io.t,
  SEMVER_SPEC_VERSION: ol.SEMVER_SPEC_VERSION,
  RELEASE_TYPES: ol.RELEASE_TYPES,
  compareIdentifiers: al.compareIdentifiers,
  rcompareIdentifiers: al.rcompareIdentifiers
};
const Nr = /* @__PURE__ */ _l(fP), hP = Object.prototype.toString, pP = "[object Uint8Array]", mP = "[object ArrayBuffer]";
function md(e, t, r) {
  return e ? e.constructor === t ? !0 : hP.call(e) === r : !1;
}
function yd(e) {
  return md(e, Uint8Array, pP);
}
function yP(e) {
  return md(e, ArrayBuffer, mP);
}
function $P(e) {
  return yd(e) || yP(e);
}
function gP(e) {
  if (!yd(e))
    throw new TypeError(`Expected \`Uint8Array\`, got \`${typeof e}\``);
}
function _P(e) {
  if (!$P(e))
    throw new TypeError(`Expected \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof e}\``);
}
function co(e, t) {
  if (e.length === 0)
    return new Uint8Array(0);
  t ?? (t = e.reduce((s, o) => s + o.length, 0));
  const r = new Uint8Array(t);
  let n = 0;
  for (const s of e)
    gP(s), r.set(s, n), n += s.length;
  return r;
}
const Jn = {
  utf8: new globalThis.TextDecoder("utf8")
};
function Xn(e, t = "utf8") {
  return _P(e), Jn[t] ?? (Jn[t] = new globalThis.TextDecoder(t)), Jn[t].decode(e);
}
function vP(e) {
  if (typeof e != "string")
    throw new TypeError(`Expected \`string\`, got \`${typeof e}\``);
}
const EP = new globalThis.TextEncoder();
function Yn(e) {
  return vP(e), EP.encode(e);
}
Array.from({ length: 256 }, (e, t) => t.toString(16).padStart(2, "0"));
const lo = "aes-256-cbc", Dt = () => /* @__PURE__ */ Object.create(null), il = (e) => e !== void 0, uo = (e, t) => {
  const r = /* @__PURE__ */ new Set([
    "undefined",
    "symbol",
    "function"
  ]), n = typeof t;
  if (r.has(n))
    throw new TypeError(`Setting a value of type \`${n}\` for key \`${e}\` is not allowed as it's not supported by JSON`);
}, Ft = "__internal__", fo = `${Ft}.migrations.version`;
var Ut, rt, Ue, Je, yr, $r, Mr, dt, Se, $d, gd, _d, vd, Ed, wd, Sd, bd;
class wP {
  constructor(t = {}) {
    lt(this, Se);
    Qr(this, "path");
    Qr(this, "events");
    lt(this, Ut);
    lt(this, rt);
    lt(this, Ue);
    lt(this, Je, {});
    lt(this, yr, !1);
    lt(this, $r);
    lt(this, Mr);
    lt(this, dt);
    Qr(this, "_deserialize", (t) => JSON.parse(t));
    Qr(this, "_serialize", (t) => JSON.stringify(t, void 0, "	"));
    const r = _t(this, Se, $d).call(this, t);
    He(this, Ue, r), _t(this, Se, gd).call(this, r), _t(this, Se, vd).call(this, r), _t(this, Se, Ed).call(this, r), this.events = new EventTarget(), He(this, rt, r.encryptionKey), this.path = _t(this, Se, wd).call(this, r), _t(this, Se, Sd).call(this, r), r.watch && this._watch();
  }
  get(t, r) {
    if (x(this, Ue).accessPropertiesByDotNotation)
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
      throw new TypeError(`Please don't use the ${Ft} key, as it's used to manage this module internal operations.`);
    const { store: n } = this, s = (o, a) => {
      if (uo(o, a), x(this, Ue).accessPropertiesByDotNotation)
        Tn(n, o, a);
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
    return x(this, Ue).accessPropertiesByDotNotation ? Gs(this.store, t) : t in this.store;
  }
  appendToArray(t, r) {
    uo(t, r);
    const n = x(this, Ue).accessPropertiesByDotNotation ? this._get(t, []) : t in this.store ? this.store[t] : [];
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
      il(x(this, Je)[r]) && this.set(r, x(this, Je)[r]);
  }
  delete(t) {
    const { store: r } = this;
    x(this, Ue).accessPropertiesByDotNotation ? Jd(r, t) : delete r[t], this.store = r;
  }
  /**
      Delete all items.
  
      This resets known items to their default values, if defined by the `defaults` or `schema` option.
      */
  clear() {
    const t = Dt();
    for (const r of Object.keys(x(this, Je)))
      il(x(this, Je)[r]) && (uo(r, x(this, Je)[r]), x(this, Ue).accessPropertiesByDotNotation ? Tn(t, r, x(this, Je)[r]) : t[r] = x(this, Je)[r]);
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
      const r = Q.readFileSync(this.path, x(this, rt) ? null : "utf8"), n = this._decryptData(r), s = this._deserialize(n);
      return x(this, yr) || this._validate(s), Object.assign(Dt(), s);
    } catch (r) {
      if ((r == null ? void 0 : r.code) === "ENOENT")
        return this._ensureDirectory(), Dt();
      if (x(this, Ue).clearInvalidConfig) {
        const n = r;
        if (n.name === "SyntaxError" || (t = n.message) != null && t.startsWith("Config schema violation:"))
          return Dt();
      }
      throw r;
    }
  }
  set store(t) {
    if (this._ensureDirectory(), !Gs(t, Ft))
      try {
        const r = Q.readFileSync(this.path, x(this, rt) ? null : "utf8"), n = this._decryptData(r), s = this._deserialize(n);
        Gs(s, Ft) && Tn(t, Ft, Vi(s, Ft));
      } catch {
      }
    x(this, yr) || this._validate(t), this._write(t), this.events.dispatchEvent(new Event("change"));
  }
  *[Symbol.iterator]() {
    for (const [t, r] of Object.entries(this.store))
      this._isReservedKeyPath(t) || (yield [t, r]);
  }
  /**
  Close the file watcher if one exists. This is useful in tests to prevent the process from hanging.
  */
  _closeWatcher() {
    x(this, $r) && (x(this, $r).close(), He(this, $r, void 0)), x(this, Mr) && (Q.unwatchFile(this.path), He(this, Mr, !1)), He(this, dt, void 0);
  }
  _decryptData(t) {
    if (!x(this, rt))
      return typeof t == "string" ? t : Xn(t);
    try {
      const r = t.slice(0, 16), n = ar.pbkdf2Sync(x(this, rt), r, 1e4, 32, "sha512"), s = ar.createDecipheriv(lo, n, r), o = t.slice(17), a = typeof o == "string" ? Yn(o) : o;
      return Xn(co([s.update(a), s.final()]));
    } catch {
      try {
        const r = t.slice(0, 16), n = ar.pbkdf2Sync(x(this, rt), r.toString(), 1e4, 32, "sha512"), s = ar.createDecipheriv(lo, n, r), o = t.slice(17), a = typeof o == "string" ? Yn(o) : o;
        return Xn(co([s.update(a), s.final()]));
      } catch {
      }
    }
    return typeof t == "string" ? t : Xn(t);
  }
  _handleStoreChange(t) {
    let r = this.store;
    const n = () => {
      const s = r, o = this.store;
      Li(o, s) || (r = o, t.call(this, o, s));
    };
    return this.events.addEventListener("change", n), () => {
      this.events.removeEventListener("change", n);
    };
  }
  _handleValueChange(t, r) {
    let n = t();
    const s = () => {
      const o = n, a = t();
      Li(a, o) || (n = a, r.call(this, a, o));
    };
    return this.events.addEventListener("change", s), () => {
      this.events.removeEventListener("change", s);
    };
  }
  _validate(t) {
    if (!x(this, Ut) || x(this, Ut).call(this, t) || !x(this, Ut).errors)
      return;
    const n = x(this, Ut).errors.map(({ instancePath: s, message: o = "" }) => `\`${s.slice(1)}\` ${o}`);
    throw new Error("Config schema violation: " + n.join("; "));
  }
  _ensureDirectory() {
    Q.mkdirSync(q.dirname(this.path), { recursive: !0 });
  }
  _write(t) {
    let r = this._serialize(t);
    if (x(this, rt)) {
      const n = ar.randomBytes(16), s = ar.pbkdf2Sync(x(this, rt), n, 1e4, 32, "sha512"), o = ar.createCipheriv(lo, s, n);
      r = co([n, Yn(":"), o.update(Yn(r)), o.final()]);
    }
    if (pe.env.SNAP)
      Q.writeFileSync(this.path, r, { mode: x(this, Ue).configFileMode });
    else
      try {
        gl(this.path, r, { mode: x(this, Ue).configFileMode });
      } catch (n) {
        if ((n == null ? void 0 : n.code) === "EXDEV") {
          Q.writeFileSync(this.path, r, { mode: x(this, Ue).configFileMode });
          return;
        }
        throw n;
      }
  }
  _watch() {
    if (this._ensureDirectory(), Q.existsSync(this.path) || this._write(Dt()), pe.platform === "win32" || pe.platform === "darwin") {
      x(this, dt) ?? He(this, dt, zc(() => {
        this.events.dispatchEvent(new Event("change"));
      }, { wait: 100 }));
      const t = q.dirname(this.path), r = q.basename(this.path);
      He(this, $r, Q.watch(t, { persistent: !1, encoding: "utf8" }, (n, s) => {
        s && s !== r || typeof x(this, dt) == "function" && x(this, dt).call(this);
      }));
    } else
      x(this, dt) ?? He(this, dt, zc(() => {
        this.events.dispatchEvent(new Event("change"));
      }, { wait: 1e3 })), Q.watchFile(this.path, { persistent: !1 }, (t, r) => {
        typeof x(this, dt) == "function" && x(this, dt).call(this);
      }), He(this, Mr, !0);
  }
  _migrate(t, r, n) {
    let s = this._get(fo, "0.0.0");
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
        c == null || c(this), this._set(fo, i), s = i, a = structuredClone(this.store);
      } catch (c) {
        this.store = a;
        try {
          this._write(a);
        } catch {
        }
        const d = c instanceof Error ? c.message : String(c);
        throw new Error(`Something went wrong during the migration! Changes applied to the store until this failed migration will be restored. ${d}`);
      }
    (this._isVersionInRangeFormat(s) || !Nr.eq(s, r)) && this._set(fo, r);
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
    return t === Ft || t.startsWith(`${Ft}.`);
  }
  _isVersionInRangeFormat(t) {
    return Nr.clean(t) === null;
  }
  _shouldPerformMigration(t, r, n) {
    return this._isVersionInRangeFormat(t) ? r !== "0.0.0" && Nr.satisfies(r, t) ? !1 : Nr.satisfies(n, t) : !(Nr.lte(t, r) || Nr.gt(t, n));
  }
  _get(t, r) {
    return Vi(this.store, t, r);
  }
  _set(t, r) {
    const { store: n } = this;
    Tn(n, t, r), this.store = n;
  }
}
Ut = new WeakMap(), rt = new WeakMap(), Ue = new WeakMap(), Je = new WeakMap(), yr = new WeakMap(), $r = new WeakMap(), Mr = new WeakMap(), dt = new WeakMap(), Se = new WeakSet(), $d = function(t) {
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
    r.cwd = Qd(r.projectName, { suffix: r.projectSuffix }).config;
  }
  return typeof r.fileExtension == "string" && (r.fileExtension = r.fileExtension.replace(/^\.+/, "")), r;
}, gd = function(t) {
  if (!(t.schema ?? t.ajvOptions ?? t.rootSchema))
    return;
  if (t.schema && typeof t.schema != "object")
    throw new TypeError("The `schema` option must be an object.");
  const r = fw.default, n = new Zg.Ajv2020({
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
  He(this, Ut, n.compile(s)), _t(this, Se, _d).call(this, t.schema);
}, _d = function(t) {
  const r = Object.entries(t ?? {});
  for (const [n, s] of r) {
    if (!s || typeof s != "object" || !Object.hasOwn(s, "default"))
      continue;
    const { default: o } = s;
    o !== void 0 && (x(this, Je)[n] = o);
  }
}, vd = function(t) {
  t.defaults && Object.assign(x(this, Je), t.defaults);
}, Ed = function(t) {
  t.serialize && (this._serialize = t.serialize), t.deserialize && (this._deserialize = t.deserialize);
}, wd = function(t) {
  const r = typeof t.fileExtension == "string" ? t.fileExtension : void 0, n = r ? `.${r}` : "";
  return q.resolve(t.cwd, `${t.configName ?? "config"}${n}`);
}, Sd = function(t) {
  if (t.migrations) {
    _t(this, Se, bd).call(this, t), this._validate(this.store);
    return;
  }
  const r = this.store, n = Object.assign(Dt(), t.defaults ?? {}, r);
  this._validate(n);
  try {
    Fi.deepEqual(r, n);
  } catch {
    this.store = n;
  }
}, bd = function(t) {
  const { migrations: r, projectVersion: n } = t;
  if (r) {
    if (!n)
      throw new Error("Please specify the `projectVersion` option.");
    He(this, yr, !0);
    try {
      const s = this.store, o = Object.assign(Dt(), t.defaults ?? {}, s);
      try {
        Fi.deepEqual(s, o);
      } catch {
        this._write(o);
      }
      this._migrate(r, n, t.beforeEachMigration);
    } finally {
      He(this, yr, !1);
    }
  }
};
const { app: as, ipcMain: jo, shell: SP } = ul;
let cl = !1;
const ll = () => {
  if (!jo || !as)
    throw new Error("Electron Store: You need to call `.initRenderer()` from the main process.");
  const e = {
    defaultCwd: as.getPath("userData"),
    appVersion: as.getVersion()
  };
  return cl || (jo.on("electron-store-get-data", (t) => {
    t.returnValue = e;
  }), cl = !0), e;
};
class Pd extends wP {
  constructor(t) {
    let r, n;
    if (pe.type === "renderer") {
      const s = ul.ipcRenderer.sendSync("electron-store-get-data");
      if (!s)
        throw new Error("Electron Store: You need to call `.initRenderer()` from the main process.");
      ({ defaultCwd: r, appVersion: n } = s);
    } else jo && as && ({ defaultCwd: r, appVersion: n } = ll());
    t = {
      name: "config",
      ...t
    }, t.projectVersion || (t.projectVersion = n), t.cwd ? t.cwd = q.isAbsolute(t.cwd) ? t.cwd : q.join(r, t.cwd) : t.cwd = r, t.configName = t.name, delete t.name, super(t);
  }
  static initRenderer() {
    ll();
  }
  async openInEditor() {
    const t = await SP.openPath(this.path);
    if (t)
      throw new Error(t);
  }
}
const Fs = new Pd({
  defaults: {
    libraryPath: q.join(Pt.getPath("userData")),
    aiSettings: {
      faceDetectionThreshold: 0.6,
      faceBlurThreshold: 20,
      vlmTemperature: 0.2,
      vlmMaxTokens: 100
    }
  }
});
function Ao() {
  return Fs.get("libraryPath");
}
function bP(e) {
  Fs.set("libraryPath", e);
}
function Nd() {
  return Fs.get("aiSettings");
}
function PP(e) {
  Fs.set("aiSettings", e);
}
const gs = new Pd(), NP = Fd(import.meta.url), Rd = q.dirname(NP), pt = Ao();
console.log(`[Main] Library Path: ${pt}`);
process.env.APP_ROOT = q.join(Rd, "..");
const Co = process.env.VITE_DEV_SERVER_URL, YP = q.join(process.env.APP_ROOT, "dist-electron"), Td = q.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = Co ? q.join(process.env.APP_ROOT, "public") : Td;
let _e, jr = null, ve = null;
const ye = /* @__PURE__ */ new Map();
function RP() {
  let e, t;
  if (Pt.isPackaged)
    e = q.join(process.resourcesPath, "python-bin", "smart-photo-ai", "smart-photo-ai.exe"), t = [], console.log(`[Main] Starting Bundled Python Backend (Prod): ${e}`);
  else {
    e = q.join(process.env.APP_ROOT, "src", "python", ".venv", "Scripts", "python.exe");
    const r = q.join(process.env.APP_ROOT, "src", "python", "main.py");
    t = [r], console.log(`[Main] Starting Python Backend (Dev): ${e} ${r}`);
  }
  ve = Md(e, t, {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
      LIBRARY_PATH: pt,
      PYTORCH_CUDA_ALLOC_CONF: "expandable_segments:True"
    }
  }), ve.stdout && (setTimeout(() => TP(), 2e3), Ld({ input: ve.stdout }).on("line", async (n) => {
    var s;
    try {
      const o = JSON.parse(n);
      console.log("[Python]", o), _e && (o.type === "scan_result" || o.type === "tags_result") && _e.webContents.send("ai:scan-result", o), o.type === "cluster_result" && console.log(`[Main] Received Cluster Result for ${o.photoId}. Clusters: ${(s = o.clusters) == null ? void 0 : s.length}`);
      const a = o.photoId || o.reqId || o.payload && o.payload.reqId;
      if (_e && (o.type === "download_progress" || o.type === "download_result") && _e.webContents.send("ai:model-progress", o), a && ye.has(a)) {
        const i = ye.get(a);
        o.error ? i == null || i.reject(o.error) : i == null || i.resolve(o), ye.delete(a);
      }
      if ((o.type === "scan_result" || o.type === "tags_result") && o.error && o.photoId)
        try {
          const { getDB: i } = await Promise.resolve().then(() => ee), d = i().prepare("INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, (SELECT file_path FROM photos WHERE id = ?), ?, ?)"), u = o.type === "scan_result" ? "Face Scan" : "Smart Tags";
          d.run(o.photoId, o.photoId, o.error, u), console.log(`[Main] Logged scan error for ${o.photoId}`);
        } catch (i) {
          console.error("[Main] Failed to log auto-error:", i);
        }
    } catch {
      console.log("[Python Raw]", n);
    }
  })), ve.stderr && ve.stderr.on("data", (r) => {
    const n = r.toString();
    n.toLowerCase().includes("error") || n.toLowerCase().includes("exception") ? console.error(`[Python Error]: ${n}`) : console.log(`[Python Log]: ${n}`);
  }), ve.on("close", (r) => {
    console.log(`[Main] Python process exited with code ${r}`), ve = null;
  });
}
function Mt(e) {
  ve && ve.stdin ? ve.stdin.write(JSON.stringify(e) + `
`) : console.error("[Main] Python process not running. Queuing or dropping command.", e.type);
}
function TP() {
  if (ve && ve.stdin) {
    const t = { type: "update_config", payload: { config: Nd() } };
    ve.stdin.write(JSON.stringify(t) + `
`);
  }
}
function OP() {
  jr = new ko({
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
  }), jr.loadFile(q.join(process.env.VITE_PUBLIC, "splash.html")), jr.on("closed", () => jr = null);
}
function Od() {
  _e = new ko({
    icon: q.join(process.env.VITE_PUBLIC, "icon.png"),
    width: 1200,
    height: 800,
    show: !1,
    // Hide initially
    backgroundColor: "#111827",
    // Set dark background
    webPreferences: {
      preload: q.join(Rd, "preload.mjs"),
      webSecurity: !1
    }
  }), _e.once("ready-to-show", () => {
    _e == null || _e.show(), jr && jr.close();
  }), _e.webContents.on("did-finish-load", () => {
    _e == null || _e.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), Co ? _e.loadURL(Co) : _e.loadFile(q.join(Td, "index.html"));
}
Pt.on("window-all-closed", () => {
  ve && ve.kill(), process.platform !== "darwin" && (Pt.quit(), _e = null);
});
Pt.on("activate", () => {
  ko.getAllWindows().length === 0 && Od();
});
Pt.whenReady().then(async () => {
  try {
    await Ce.mkdir(pt, { recursive: !0 });
  } catch (t) {
    console.error(`[Main] Failed to create library path: ${pt}`, t);
  }
  fl(pt), RP(), Cd.handle("local-resource", (t) => {
    let r = t.url.replace("local-resource://", "");
    const n = r.indexOf("?");
    n !== -1 && (r = r.substring(0, n));
    const s = decodeURIComponent(r);
    return kd.fetch(Vd(s).toString());
  }), OP(), Od(), J.handle("app:focusWindow", () => _e ? (_e.isMinimized() && _e.restore(), _e.focus(), !0) : !1), J.handle("scan-directory", async (t, r) => await Hd(r, pt, (n) => {
    t.sender.send("scan-progress", n);
  })), J.handle("dialog:openDirectory", async () => {
    const { canceled: t, filePaths: r } = await Dd.showOpenDialog({
      properties: ["openDirectory"]
    });
    return t ? null : r[0];
  }), J.handle("read-file-buffer", async (t, r) => {
    const n = await import("node:fs/promises");
    try {
      return await n.readFile(r);
    } catch (s) {
      throw console.error("Failed to read file:", r, s), s;
    }
  }), J.handle("ai:getSettings", () => Nd()), J.handle("ai:saveSettings", (t, r) => {
    if (PP(r), ve && ve.stdin) {
      const n = { type: "update_config", payload: { config: r } };
      ve.stdin.write(JSON.stringify(n) + `
`);
    }
    return !0;
  }), J.handle("ai:downloadModel", async (t, { modelName: r }) => (console.log(`[Main] Requesting model download: ${r}`), new Promise((n, s) => {
    const o = Math.floor(Math.random() * 1e6);
    ye.set(o, {
      resolve: (a) => n(a),
      reject: s
    }), Mt({
      type: "download_model",
      payload: {
        reqId: o,
        modelName: r
      }
    }), setTimeout(() => {
      ye.has(o) && (ye.delete(o), s("Model download timed out"));
    }, 18e5);
  }))), J.handle("ai:getSystemStatus", async () => new Promise((t, r) => {
    const n = Math.floor(Math.random() * 1e6);
    ye.set(n, {
      resolve: (s) => t(s.status || {}),
      reject: r
    }), Mt({
      type: "get_system_status",
      payload: { reqId: n }
    }), setTimeout(() => {
      ye.has(n) && (ye.delete(n), r("Get system status timed out"));
    }, 1e4);
  })), J.handle("face:getBlurry", async (t, { personId: r, threshold: n, scope: s }) => {
    const { getDB: o } = await Promise.resolve().then(() => ee), a = o();
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
    return c.push(d), a.prepare(i).all(...c).map((_) => {
      let y = null;
      if (_.metadata_json)
        try {
          const w = JSON.parse(_.metadata_json);
          y = w.ImageWidth || w.SourceImageWidth || w.ExifImageWidth;
        } catch {
        }
      return {
        ..._,
        box: JSON.parse(_.box_json),
        original_width: y
      };
    });
  }), J.handle("debug:getBlurStats", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ee), r = t();
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
  }), J.handle("db:getPhotosMissingBlurScores", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ee), r = t();
    try {
      return { success: !0, photoIds: r.prepare("SELECT DISTINCT photo_id FROM faces WHERE blur_score IS NULL").all().map((o) => o.photo_id) };
    } catch (n) {
      return { success: !1, error: String(n) };
    }
  }), J.handle("settings:getPreviewStats", async () => {
    try {
      const t = q.join(Ao(), "previews");
      try {
        await Ce.access(t);
      } catch {
        return { success: !0, count: 0, size: 0 };
      }
      let r = 0, n = 0;
      const s = await Ce.readdir(t);
      for (const o of s)
        if (!o.startsWith("."))
          try {
            const a = await Ce.stat(q.join(t, o));
            a.isFile() && (r++, n += a.size);
          } catch {
          }
      return { success: !0, count: r, size: n };
    } catch (t) {
      return { success: !1, error: String(t) };
    }
  }), J.handle("settings:cleanupPreviews", async (t, { days: r }) => {
    try {
      const n = q.join(Ao(), "previews");
      try {
        await Ce.access(n);
      } catch {
        return { success: !0, deletedCount: 0, deletedSize: 0 };
      }
      const s = Date.now(), o = r * 24 * 60 * 60 * 1e3;
      let a = 0, i = 0;
      const c = await Ce.readdir(n);
      for (const d of c) {
        if (d.startsWith(".")) continue;
        const u = q.join(n, d);
        try {
          const f = await Ce.stat(u);
          s - f.mtimeMs > o && (await Ce.unlink(u), a++, i += f.size);
        } catch {
        }
      }
      return { success: !0, deletedCount: a, deletedSize: i };
    } catch (n) {
      return { success: !1, error: String(n) };
    }
  }), J.handle("face:deleteFaces", async (t, r) => {
    const { getDB: n } = await Promise.resolve().then(() => ee), s = n(), o = r.map(() => "?").join(",");
    return s.prepare(`DELETE FROM faces WHERE id IN (${o})`).run(...r), !0;
  }), J.handle("ai:scanImage", async (t, { photoId: r }) => {
    const { getDB: n } = await Promise.resolve().then(() => ee), s = n();
    console.log(`[Main] Requesting AI scan for ${r}`);
    try {
      const a = s.prepare("SELECT file_path FROM photos WHERE id = ?").get(r);
      if (a && a.file_path) {
        const i = q.join(pt, "previews");
        return await Ce.mkdir(i, { recursive: !0 }), Mt({
          type: "scan_image",
          payload: {
            photoId: r,
            filePath: a.file_path,
            previewStorageDir: i
          }
        }), new Promise((c, d) => {
          ye.set(r, { resolve: c, reject: d }), setTimeout(() => {
            ye.has(r) && (ye.delete(r), d("Scan timed out"));
          }, 3e5);
        });
      } else
        return console.error("[Main] Photo not found or no path:", r), { success: !1, error: "Photo not found" };
    } catch (o) {
      return console.error("[Main] Failed to lookup photo for AI:", o), { success: !1, error: o };
    }
  }), J.handle("ai:generateTags", async (t, { photoId: r }) => {
    const { getDB: n } = await Promise.resolve().then(() => ee), s = n();
    console.log(`[Main] Requesting Tags (VLM) for ${r}`);
    try {
      const a = s.prepare("SELECT file_path FROM photos WHERE id = ?").get(r);
      return a && a.file_path ? (Mt({ type: "generate_tags", payload: { photoId: r, filePath: a.file_path } }), { success: !0 }) : { success: !1, error: "Photo not found" };
    } catch (o) {
      return console.error("[Main] Failed to lookup photo for VLM:", o), { success: !1, error: o };
    }
  }), J.handle("ai:enhanceImage", async (t, { photoId: r, task: n, modelName: s }) => {
    const { getDB: o } = await Promise.resolve().then(() => ee), a = o();
    console.log(`[Main] Enhance Request: ${r} [${n}]`);
    try {
      const c = a.prepare("SELECT file_path FROM photos WHERE id = ?").get(r);
      if (!c || !c.file_path) return { success: !1, error: "Photo not found" };
      const d = q.extname(c.file_path), u = q.basename(c.file_path, d), f = n === "upscale" ? "_upscaled" : "_restored", _ = q.join(q.dirname(c.file_path), `${u}${f}.jpg`);
      return new Promise((y, w) => {
        const g = Math.floor(Math.random() * 1e6);
        ye.set(g, {
          resolve: ($) => {
            $.success ? y({ success: !0, outPath: $.outPath }) : y({ success: !1, error: $.error });
          },
          reject: w
        }), Mt({
          type: "enhance_image",
          payload: {
            reqId: g,
            // We piggyback on generic promise handler
            filePath: c.file_path,
            outPath: _,
            task: n,
            modelName: s
          }
        }), setTimeout(() => {
          ye.has(g) && (ye.delete(g), w("Enhancement timed out"));
        }, 6e5);
      });
    } catch (i) {
      return console.error("Enhance failed:", i), { success: !1, error: String(i) };
    }
  }), J.handle("ai:rebuildIndex", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ee), r = t();
    console.log("[Main] Rebuilding Vector Index...");
    try {
      const n = r.prepare("SELECT id, descriptor_json FROM faces WHERE descriptor_json IS NOT NULL").all(), s = n.map((a) => JSON.parse(a.descriptor_json)), o = n.map((a) => a.id);
      return s.length === 0 ? { success: !0, count: 0 } : new Promise((a, i) => {
        const c = Math.floor(Math.random() * 1e6);
        ye.set(c, {
          resolve: (d) => a({ success: !0, count: d.count }),
          reject: i
        }), Mt({
          type: "rebuild_index",
          payload: {
            reqId: c,
            descriptors: s,
            ids: o
          }
        });
      });
    } catch (n) {
      return console.error("Failed to rebuild index:", n), { success: !1, error: String(n) };
    }
  }), J.handle("ai:command", async (t, r) => {
    try {
      const n = Math.floor(Math.random() * 1e7);
      return r.payload || (r.payload = {}), r.payload.reqId = n, new Promise((s, o) => {
        ye.set(n, { resolve: s, reject: o }), Mt(r), setTimeout(() => {
          ye.has(n) && (ye.delete(n), o("Command timed out"));
        }, 3e4);
      });
    } catch (n) {
      return console.error("AI Command Failed:", n), { error: n };
    }
  }), J.handle("ai:clusterFaces", async (t, { faceIds: r, eps: n, min_samples: s } = {}) => {
    const { getDB: o } = await Promise.resolve().then(() => ee), a = o();
    try {
      let i;
      if (r && r.length > 0) {
        const u = r.map(() => "?").join(",");
        i = a.prepare(`SELECT id, descriptor_json FROM faces WHERE id IN (${u})`).all(...r);
      } else
        i = a.prepare("SELECT id, descriptor_json FROM faces WHERE person_id IS NULL AND is_ignored = 0").all();
      const c = i.map((u) => JSON.parse(u.descriptor_json)), d = i.map((u) => u.id);
      return c.length === 0 ? { success: !0, clusters: [] } : new Promise((u, f) => {
        const _ = Math.floor(Math.random() * 1e6);
        ye.set(_, { resolve: (y) => u({ success: !0, clusters: y.clusters }), reject: f }), Mt({
          type: "cluster_faces",
          payload: {
            photoId: _,
            // Abuse photoId as requestId
            descriptors: c,
            ids: d,
            eps: n,
            min_samples: s
          }
        }), setTimeout(() => {
          ye.has(_) && (ye.delete(_), f("Clustering timed out"));
        }, 3e5);
      });
    } catch (i) {
      return console.error("Failed to cluster faces:", i), { success: !1, error: i };
    }
  }), J.handle("db:addTags", async (t, { photoId: r, tags: n }) => {
    const { getDB: s } = await Promise.resolve().then(() => ee), o = s(), a = o.prepare("INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING"), i = o.prepare("SELECT id FROM tags WHERE name = ?"), c = o.prepare(`
      INSERT INTO photo_tags (photo_id, tag_id, source) 
      VALUES (@photoId, @tagId, 'AI') 
      ON CONFLICT(photo_id, tag_id) DO NOTHING
    `), d = o.transaction((u, f) => {
      for (const _ of f) {
        a.run(_);
        const y = i.get(_);
        y && c.run({ photoId: u, tagId: y.id });
      }
    });
    try {
      return d(r, n), { success: !0 };
    } catch (u) {
      return console.error("Failed to add tags:", u), { success: !1, error: u };
    }
  }), J.handle("db:getTags", async (t, r) => {
    const { getDB: n } = await Promise.resolve().then(() => ee), o = n().prepare(`
      SELECT t.name FROM tags t
      JOIN photo_tags pt ON pt.tag_id = t.id
      WHERE pt.photo_id = ?
    `);
    try {
      return o.all(r).map((i) => i.name);
    } catch (a) {
      return console.error("Failed to get tags:", a), [];
    }
  }), J.handle("db:clearAITags", async (t) => {
    const { getDB: r } = await Promise.resolve().then(() => ee), n = r();
    try {
      return n.exec(`
        DELETE FROM photo_tags WHERE source = 'AI';
        DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM photo_tags);
      `), console.log("Cleared all AI tags."), { success: !0 };
    } catch (s) {
      return console.error("Failed to clear AI tags:", s), { success: !1, error: s };
    }
  }), J.handle("db:getPhoto", async (t, r) => {
    const { getDB: n } = await Promise.resolve().then(() => ee), s = n();
    try {
      return s.prepare("SELECT * FROM photos WHERE id = ?").get(r) || null;
    } catch (o) {
      return console.error("Failed to get photo:", o), null;
    }
  }), J.handle("db:getPhotos", async (t, { limit: r = 50, offset: n = 0, filter: s = {} } = {}) => {
    const { getDB: o } = await Promise.resolve().then(() => ee), a = o();
    try {
      let i = "SELECT p.* FROM photos p";
      const c = [], d = [];
      if (s.untagged && d.push("p.id NOT IN (SELECT photo_id FROM photo_tags)"), s.folder && (d.push("p.file_path LIKE ?"), c.push(`${s.folder}%`)), s.tags && Array.isArray(s.tags) && s.tags.length > 0)
        if (s.tagsMatchAll) {
          const y = s.tags.map(() => "?").join(",");
          d.push(`p.id IN (
             SELECT pt.photo_id FROM photo_tags pt
             JOIN tags t ON pt.tag_id = t.id
             WHERE t.name IN (${y})
             GROUP BY pt.photo_id
             HAVING COUNT(DISTINCT t.name) = ?
           )`), c.push(...s.tags), c.push(s.tags.length);
        } else {
          const y = s.tags.map(() => "?").join(",");
          d.push(`p.id IN (
             SELECT pt.photo_id FROM photo_tags pt
             JOIN tags t ON pt.tag_id = t.id
             WHERE t.name IN (${y})
           )`), c.push(...s.tags);
        }
      else s.tag && (d.push(`p.id IN (
          SELECT pt.photo_id FROM photo_tags pt
          JOIN tags t ON pt.tag_id = t.id
          WHERE t.name = ?
        )`), c.push(s.tag));
      if (s.search) {
        const _ = `%${s.search}%`;
        d.push(`p.id IN (
            SELECT pt.photo_id FROM photo_tags pt
            JOIN tags t ON pt.tag_id = t.id
            WHERE t.name LIKE ?
        )`), c.push(_);
      }
      if (s.people && Array.isArray(s.people) && s.people.length > 0) {
        const _ = s.peopleMatchAll, y = s.people.map(() => "?").join(",");
        _ ? (d.push(`p.id IN (
              SELECT f.photo_id FROM faces f
              WHERE f.person_id IN (${y})
              GROUP BY f.photo_id
              HAVING COUNT(DISTINCT f.person_id) = ?
            )`), c.push(...s.people), c.push(s.people.length)) : (d.push(`p.id IN (
              SELECT f.photo_id FROM faces f
              WHERE f.person_id IN (${y})
            )`), c.push(...s.people));
      }
      return d.length > 0 && (i += " WHERE " + d.join(" AND ")), i += " ORDER BY created_at DESC LIMIT ? OFFSET ?", c.push(r, n), a.prepare(i).all(...c);
    } catch (i) {
      return console.error("Failed to get photos:", i), [];
    }
  }), J.handle("os:createAlbum", async (t, { photoIds: r, targetDir: n }) => {
    const { getDB: s } = await Promise.resolve().then(() => ee), o = s();
    if (console.log(`[Main] Creating album with ${r == null ? void 0 : r.length} photos in ${n}`), !r || !r.length || !n)
      return { success: !1, error: "Invalid arguments" };
    try {
      const a = r.map(() => "?").join(","), i = o.prepare(`SELECT file_path FROM photos WHERE id IN (${a})`).all(...r);
      let c = 0, d = 0;
      await Ce.mkdir(n, { recursive: !0 });
      for (const u of i) {
        const f = u.file_path, _ = q.basename(f), y = q.join(n, _);
        try {
          await Ce.copyFile(f, y), c++;
        } catch (w) {
          console.error(`Failed to copy ${f} to ${y}`, w), d++;
        }
      }
      return { success: !0, successCount: c, failCount: d };
    } catch (a) {
      return console.error("Create Album failed", a), { success: !1, error: a };
    }
  }), J.handle("db:getPhotosForRescan", async (t, { filter: r = {} } = {}) => {
    const { getDB: n } = await Promise.resolve().then(() => ee), s = n();
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
  }), J.handle("db:getAllTags", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ee), r = t();
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
  }), J.handle("db:removeTag", async (t, { photoId: r, tag: n }) => {
    const { getDB: s } = await Promise.resolve().then(() => ee), o = s();
    try {
      return o.prepare(`
        DELETE FROM photo_tags 
        WHERE photo_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)
      `).run(r, n), { success: !0 };
    } catch (a) {
      return console.error("Failed to remove tag:", a), { success: !1, error: a };
    }
  }), J.handle("db:renamePerson", async (t, { personId: r, newName: n }) => {
    const { getDB: s } = await Promise.resolve().then(() => ee), o = s(), a = n.trim();
    if (!a) return { success: !1, error: "Name cannot be empty" };
    try {
      const i = o.prepare("SELECT id FROM people WHERE name = ? COLLATE NOCASE").get(a);
      return i ? i.id === r ? { success: !0 } : (console.log(`[Main] Merging person ${r} into ${i.id} (${a})`), o.transaction(() => {
        o.prepare("UPDATE faces SET person_id = ? WHERE person_id = ?").run(i.id, r), o.prepare("DELETE FROM people WHERE id = ?").run(r);
      })(), { success: !0, merged: !0, targetId: i.id }) : (console.log(`[Main] Renaming person ${r} to ${a}`), o.prepare("UPDATE people SET name = ? WHERE id = ?").run(a, r), { success: !0, merged: !1 });
    } catch (i) {
      return console.error("Failed to rename person:", i), { success: !1, error: String(i) };
    }
  }), J.handle("db:updateFaces", async (t, { photoId: r, faces: n, previewPath: s, width: o, height: a, globalBlurScore: i }) => {
    const { getDB: c } = await Promise.resolve().then(() => ee), d = c();
    try {
      const u = d.prepare("SELECT id, box_json, person_id FROM faces WHERE photo_id = ?"), f = d.prepare("UPDATE faces SET box_json = ?, descriptor_json = ?, blur_score = ? WHERE id = ?"), _ = d.prepare("INSERT INTO faces (photo_id, box_json, descriptor_json, person_id, blur_score) VALUES (?, ?, ?, ?, ?)"), y = d.prepare("DELETE FROM faces WHERE id = ?"), w = d.prepare("SELECT id, descriptor_mean_json FROM people WHERE descriptor_mean_json IS NOT NULL"), g = d.prepare("SELECT person_id, descriptor_json FROM faces WHERE person_id IS NOT NULL"), $ = d.prepare("UPDATE photos SET preview_cache_path = ? WHERE id = ?"), p = d.prepare("UPDATE photos SET width = ?, height = ? WHERE id = ?"), E = d.prepare("UPDATE photos SET blur_score = ? WHERE id = ?");
      return d.transaction(() => {
        s && $.run(s, r), o && a && p.run(o, a, r), i != null && E.run(i, r);
        const R = u.all(r), T = /* @__PURE__ */ new Set(), C = /* @__PURE__ */ new Set();
        for (const k of n) {
          const ce = k.box;
          let le = null, me = 0;
          for (const L of R) {
            if (T.has(L.id)) continue;
            const z = JSON.parse(L.box_json), ae = Math.max(ce.x, z.x), O = Math.max(ce.y, z.y), A = Math.min(ce.x + k.box.width, z.x + z.width), V = Math.min(ce.y + k.box.height, z.y + z.height), D = Math.max(0, A - ae) * Math.max(0, V - O);
            if (D > 0) {
              const G = ce.width * ce.height, M = z.width * z.height, P = D / (G + M - D);
              P > 0.25 && P > me && (me = P, le = L.id);
            }
          }
          if (le) {
            f.run(JSON.stringify(ce), JSON.stringify(k.descriptor), k.blur_score || null, le), T.add(le);
            const L = R.find((z) => z.id === le);
            L && L.person_id && C.add(L.person_id);
          } else {
            let L = null, z = 0.45;
            const ae = w.all();
            for (const O of ae) {
              const A = JSON.parse(O.descriptor_mean_json);
              let V = 0, D = 0, G = 0;
              if (k.descriptor.length !== A.length) continue;
              for (let m = 0; m < k.descriptor.length; m++)
                V += k.descriptor[m] * A[m], D += k.descriptor[m] ** 2, G += A[m] ** 2;
              const M = Math.sqrt(D) * Math.sqrt(G), P = M === 0 ? 1 : 1 - V / M;
              P < z && (z = P, L = O.id);
            }
            if (!L) {
              const O = g.all();
              for (const A of O) {
                const V = JSON.parse(A.descriptor_json);
                let D = 0, G = 0, M = 0;
                if (k.descriptor.length !== V.length) continue;
                for (let S = 0; S < k.descriptor.length; S++)
                  D += k.descriptor[S] * V[S], G += k.descriptor[S] ** 2, M += V[S] ** 2;
                const P = Math.sqrt(G) * Math.sqrt(M), m = P === 0 ? 1 : 1 - D / P;
                m < z && (z = m, L = A.person_id);
              }
            }
            _.run(r, JSON.stringify(ce), JSON.stringify(k.descriptor), L, k.blur_score || null), L && C.add(L);
          }
        }
        for (const k of R)
          T.has(k.id) || (y.run(k.id), k.person_id && C.add(k.person_id));
        for (const k of C)
          e(d, k);
      })(), { success: !0 };
    } catch (u) {
      return console.error("Failed to update faces:", u), { success: !1, error: u };
    }
  }), J.handle("db:getFaces", async (t, r) => {
    const { getDB: n } = await Promise.resolve().then(() => ee), s = n();
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
  }), J.handle("db:getPeople", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ee), r = t();
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
  }), J.handle("db:getAllFaces", async (t, { limit: r = 100, offset: n = 0, filter: s = {} } = {}) => {
    const { getDB: o } = await Promise.resolve().then(() => ee), a = o();
    try {
      let i = `
        SELECT f.*, p.file_path, p.preview_cache_path, p.width, p.height 
        FROM faces f
        JOIN photos p ON f.photo_id = p.id
      `;
      const c = [], d = [];
      return s.unnamed && d.push("f.person_id IS NULL"), s.personId && (d.push("f.person_id = ?"), c.push(s.personId)), d.length > 0 && (i += " WHERE " + d.join(" AND ")), i.includes("is_ignored") || (i += d.length > 0 ? " AND is_ignored = 0" : " WHERE is_ignored = 0"), i += " ORDER BY p.created_at DESC LIMIT ? OFFSET ?", c.push(r, n), a.prepare(i).all(...c).map((_) => ({
        ..._,
        box: JSON.parse(_.box_json),
        descriptor: JSON.parse(_.descriptor_json)
      }));
    } catch (i) {
      return console.error("Failed to get all faces:", i), [];
    }
  }), J.handle("db:assignPerson", async (t, { faceId: r, personName: n }) => {
    const { getDB: s } = await Promise.resolve().then(() => ee), o = s(), a = o.prepare("INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING"), i = o.prepare("SELECT id FROM people WHERE name = ?"), c = o.prepare("SELECT person_id FROM faces WHERE id = ?"), d = o.prepare("UPDATE faces SET person_id = ? WHERE id = ?"), u = o.transaction(() => {
      const f = c.get(r), _ = f ? f.person_id : null;
      a.run(n);
      const y = i.get(n);
      return d.run(y.id, r), e(o, y.id), _ && e(o, _), y;
    });
    try {
      return { success: !0, person: u() };
    } catch (f) {
      return console.error("Failed to assign person:", f), { success: !1, error: f };
    }
  }), J.handle("db:getLibraryStats", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ee), r = t(), n = await import("node:path");
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
  }), J.handle("db:deleteFaces", async (t, r) => {
    const { getDB: n } = await Promise.resolve().then(() => ee), s = n();
    try {
      if (!r || r.length === 0) return { success: !0 };
      const o = r.map(() => "?").join(","), i = s.prepare(`SELECT DISTINCT person_id FROM faces WHERE id IN (${o}) AND person_id IS NOT NULL`).all(...r).map((u) => u.person_id), c = s.prepare(`DELETE FROM faces WHERE id IN (${o})`);
      return s.transaction(() => {
        c.run(...r);
        for (const u of i)
          e(s, u);
      })(), { success: !0 };
    } catch (o) {
      return console.error("Failed to delete faces:", o), { success: !1, error: o };
    }
  }), J.handle("db:reassignFaces", async (t, { faceIds: r, personName: n }) => {
    const { getDB: s } = await Promise.resolve().then(() => ee), o = s(), a = o.prepare("INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING"), i = o.prepare("SELECT id FROM people WHERE name = ?");
    n && a.run(n);
    const c = i.get(n);
    if (!c)
      return { success: !1, error: "Target person could not be created" };
    try {
      if (!r || r.length === 0) return { success: !0 };
      const d = r.map(() => "?").join(","), f = o.prepare(`SELECT DISTINCT person_id FROM faces WHERE id IN (${d}) AND person_id IS NOT NULL`).all(...r).map((w) => w.person_id), _ = o.prepare(`UPDATE faces SET person_id = ? WHERE id IN (${d})`);
      return o.transaction(() => {
        _.run(c.id, ...r), e(o, c.id);
        for (const w of f)
          e(o, w);
      })(), { success: !0, person: c };
    } catch (d) {
      return console.error("Failed to reassign faces:", d), { success: !1, error: d };
    }
  }), J.handle("db:getScanErrors", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ee), r = t();
    try {
      return r.prepare("SELECT * FROM scan_errors ORDER BY timestamp DESC").all();
    } catch (n) {
      return console.error("Failed to get scan errors:", n), [];
    }
  }), J.handle("db:clearScanErrors", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ee), r = t();
    try {
      return r.exec("DELETE FROM scan_errors"), { success: !0 };
    } catch (n) {
      return { success: !1, error: n };
    }
  }), J.handle("db:retryScanErrors", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ee), r = t();
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
J.handle("settings:getLibraryPath", () => pt);
J.handle("settings:moveLibrary", async (e, t) => {
  console.log(`[Main] Configuring move library to: ${t}`);
  try {
    if (!(await Ce.stat(t)).isDirectory()) return { success: !1, error: "Target is not a directory" };
  } catch {
    return { success: !1, error: "Target directory does not exist" };
  }
  const { closeDB: r } = await Promise.resolve().then(() => ee);
  try {
    r(), ve && ve.kill(), console.log("[Main] Moving files...");
    const n = ["library.db", "previews", "vectors.index", "id_map.pkl", "library.db-shm", "library.db-wal"];
    await new Promise((s) => setTimeout(s, 1e3));
    for (const s of n) {
      const o = q.join(pt, s), a = q.join(t, s);
      try {
        await Ce.access(o), console.log(`Copying ${o} -> ${a}`), await Ce.cp(o, a, { recursive: !0, force: !0 });
      } catch (i) {
        if (i.code === "ENOENT")
          continue;
        throw console.error(`Failed to copy ${s}:`, i), new Error(`Failed to copy ${s}: ${i.message}`);
      }
    }
    try {
      await Ce.access(q.join(t, "library.db"));
    } catch {
    }
    bP(t), console.log("Cleaning up old files...");
    for (const s of n) {
      const o = q.join(pt, s);
      try {
        await Ce.rm(o, { recursive: !0, force: !0 });
      } catch (a) {
        console.error(`Failed to cleanup ${o}:`, a);
      }
    }
    return console.log("[Main] Restarting application..."), Pt.relaunch(), Pt.exit(0), { success: !0 };
  } catch (n) {
    return console.error("[Main] Move failed:", n), { success: !1, error: n };
  }
});
J.handle("db:unassignFaces", async (e, t) => {
  const { getDB: r } = await Promise.resolve().then(() => ee), n = r();
  try {
    if (!t || t.length === 0) return { success: !0 };
    const s = t.map(() => "?").join(",");
    return n.prepare(`UPDATE faces SET person_id = NULL WHERE id IN (${s})`).run(...t), { success: !0 };
  } catch (s) {
    return console.error("Failed to unassign faces:", s), { success: !1, error: s };
  }
});
J.handle("db:getPerson", async (e, t) => {
  const { getDB: r } = await Promise.resolve().then(() => ee), n = r();
  try {
    return n.prepare("SELECT * FROM people WHERE id = ?").get(t) || null;
  } catch (s) {
    return console.error("Failed to get person:", s), null;
  }
});
J.handle("db:getFolders", async () => {
  const { getDB: e } = await Promise.resolve().then(() => ee), t = await import("node:path"), r = e();
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
J.handle("db:ignoreFace", async (e, t) => {
  const { getDB: r } = await Promise.resolve().then(() => ee), n = r();
  try {
    const o = n.prepare("SELECT person_id FROM faces WHERE id = ?").get(t), a = n.prepare("UPDATE faces SET is_ignored = 1 WHERE id = ?");
    return n.transaction(() => {
      a.run(t), o && o.person_id && Id(n, o.person_id);
    })(), { success: !0 };
  } catch (s) {
    return { success: !1, error: s };
  }
});
J.handle("db:ignoreFaces", async (e, t) => {
  const { getDB: r } = await Promise.resolve().then(() => ee), n = r();
  try {
    if (!t || t.length === 0) return { success: !0 };
    const s = t.map(() => "?").join(","), o = n.prepare(`UPDATE faces SET is_ignored = 1 WHERE id IN (${s})`), i = n.prepare(`SELECT DISTINCT person_id FROM faces WHERE id IN (${s}) AND person_id IS NOT NULL`).all(...t).map((d) => d.person_id);
    return n.transaction(() => {
      o.run(...t);
      for (const d of i)
        Id(n, d);
    })(), { success: !0 };
  } catch (s) {
    return console.error("Failed to ignore faces:", s), { success: !1, error: s };
  }
});
const Id = (e, t) => {
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
J.handle("db:removeDuplicateFaces", async () => {
  const { getDB: e } = await Promise.resolve().then(() => ee), t = e();
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
        const _ = JSON.parse(f.box_json);
        let y = !1;
        for (const w of c) {
          const g = JSON.parse(w.box_json), $ = Math.max(_.x, g.x), p = Math.max(_.y, g.y), E = Math.min(_.x + _.width, g.x + g.width), N = Math.min(_.y + _.height, g.y + g.height), R = Math.max(0, E - $) * Math.max(0, N - p);
          if (R > 0) {
            const T = _.width * _.height, C = g.width * g.height;
            if (R / (T + C - R) > 0.5) {
              y = !0, f.person_id && w.person_id;
              break;
            }
          }
        }
        y || c.push(f);
      }
      const d = i.sort((f, _) => f.person_id && !_.person_id ? -1 : !f.person_id && _.person_id ? 1 : f.id - _.id), u = [];
      for (const f of d) {
        const _ = JSON.parse(f.box_json);
        let y = !1;
        for (const w of u) {
          const g = JSON.parse(w.box_json), $ = Math.max(_.x, g.x), p = Math.max(_.y, g.y), E = Math.min(_.x + _.width, g.x + g.width), N = Math.min(_.y + _.height, g.y + g.height), R = Math.max(0, E - $) * Math.max(0, N - p);
          if (R > 0) {
            const T = _.width * _.height, C = g.width * g.height;
            if (R / (T + C - R) > 0.5) {
              y = !0;
              break;
            }
          }
        }
        y ? (s.run(f.id), n++) : u.push(f);
      }
    }
    return console.log(`Deduplication complete. Removed ${n} faces.`), { success: !0, removedCount: n };
  } catch (r) {
    return console.error("Failed to remove duplicates:", r), { success: !1, error: r };
  }
});
J.handle("db:getAllUnassignedFaceDescriptors", async () => {
  const { getDB: e } = await Promise.resolve().then(() => ee), t = e();
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
J.handle("db:factoryReset", async () => {
  const { getDB: e } = await Promise.resolve().then(() => ee), t = await import("node:fs/promises"), r = await import("node:path"), n = e();
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
    const s = Pt.getPath("userData"), o = r.join(s, "previews");
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
J.handle("settings:getQueueConfig", async () => ({
  batchSize: gs.get("queue.batchSize", 0),
  cooldownSeconds: gs.get("queue.cooldownSeconds", 60)
}));
J.handle("settings:setQueueConfig", async (e, t) => (gs.set("queue.batchSize", t.batchSize), gs.set("queue.cooldownSeconds", t.cooldownSeconds), { success: !0 }));
J.handle("db:getUnprocessedItems", async () => {
  const { getDB: e } = await Promise.resolve().then(() => ee), t = e();
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
export {
  YP as MAIN_DIST,
  Td as RENDERER_DIST,
  Co as VITE_DEV_SERVER_URL
};
