var Bd = Object.defineProperty;
var Ki = (e) => {
  throw TypeError(e);
};
var Wd = (e, t, r) => t in e ? Bd(e, t, { enumerable: !0, configurable: !0, writable: !0, value: r }) : e[t] = r;
var en = (e, t, r) => Wd(e, typeof t != "symbol" ? t + "" : t, r), Gs = (e, t, r) => t.has(e) || Ki("Cannot " + r);
var Z = (e, t, r) => (Gs(e, t, "read from private field"), r ? r.call(e) : t.get(e)), dt = (e, t, r) => t.has(e) ? Ki("Cannot add the same private member more than once") : t instanceof WeakSet ? t.add(e) : t.set(e, r), Be = (e, t, r, n) => (Gs(e, t, "write to private field"), n ? n.call(e, r) : t.set(e, r), r), Et = (e, t, r) => (Gs(e, t, "access private method"), r);
import bl, { app as ct, BrowserWindow as qo, protocol as Jd, net as Xd, ipcMain as J, dialog as Yd, shell as Pl } from "electron";
import { spawn as xd } from "node:child_process";
import { createInterface as Qd } from "node:readline";
import { fileURLToPath as Zd, pathToFileURL as ef } from "node:url";
import tf from "better-sqlite3";
import z from "node:path";
import Y, { promises as ar } from "node:fs";
import ir, { createHash as rf } from "node:crypto";
import { ExifTool as nf } from "exiftool-vendored";
import Hi from "sharp";
import me from "node:process";
import { promisify as Oe, isDeepStrictEqual as Bi } from "node:util";
import Wi from "node:assert";
import Nl from "node:os";
import "node:events";
import "node:stream";
import * as ke from "node:fs/promises";
const Eo = z.join(ct.getPath("userData"), "logs");
Y.existsSync(Eo) || Y.mkdirSync(Eo, { recursive: !0 });
const ur = z.join(Eo, "main.log"), sf = 5 * 1024 * 1024;
let un = Y.createWriteStream(ur, { flags: "a" });
function Ks() {
  try {
    if (Y.existsSync(ur) && Y.statSync(ur).size > sf) {
      un.end();
      const t = ur + ".old";
      Y.existsSync(t) && Y.unlinkSync(t), Y.renameSync(ur, t), un = Y.createWriteStream(ur, { flags: "a" });
    }
  } catch (e) {
    console.error("Failed to rotate logs:", e);
  }
}
function of() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function Hs(e, ...t) {
  const r = t.map((n) => typeof n == "object" ? JSON.stringify(n) : String(n)).join(" ");
  return `[${of()}] [${e}] ${r}
`;
}
const X = {
  info: (...e) => {
    Ks();
    const t = Hs("INFO", ...e);
    console.log(...e), un.write(t);
  },
  warn: (...e) => {
    Ks();
    const t = Hs("WARN", ...e);
    console.warn(...e), un.write(t);
  },
  error: (...e) => {
    Ks();
    const t = Hs("ERROR", ...e);
    console.error(...e), un.write(t);
  },
  getLogPath: () => ur
};
let Me;
function Rl(e) {
  const t = z.join(e, "library.db");
  X.info("Initializing Database at:", t), Me = new tf(t), Me.pragma("journal_mode = WAL"), Me.exec(`
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
    Me.exec("ALTER TABLE faces ADD COLUMN blur_score REAL");
  } catch {
  }
  try {
    Me.exec("ALTER TABLE faces ADD COLUMN is_ignored BOOLEAN DEFAULT 0");
  } catch {
  }
  try {
    Me.exec("ALTER TABLE people ADD COLUMN descriptor_mean_json TEXT");
  } catch {
  }
  try {
    Me.exec("ALTER TABLE photos ADD COLUMN blur_score REAL");
  } catch {
  }
  try {
    console.log('Running migration: Cleanup "AI Description" tag...');
    const r = Me.prepare("SELECT id FROM tags WHERE name = ?").get("AI Description");
    r && (Me.prepare("DELETE FROM photo_tags WHERE tag_id = ?").run(r.id), Me.prepare("DELETE FROM tags WHERE id = ?").run(r.id), X.info('Migration complete: "AI Description" tag removed.'));
  } catch (r) {
    X.error("Migration failed:", r);
  }
  X.info("Database schema ensured.");
}
function Tl() {
  if (!Me)
    throw new Error("Database not initialized");
  return Me;
}
function af() {
  Me && (X.info("Closing Database connection."), Me.close(), Me = void 0);
}
const ee = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  closeDB: af,
  getDB: Tl,
  initDB: Rl
}, Symbol.toStringTag, { value: "Module" }));
let Bs = null, Rn = null;
async function Tn() {
  return Bs || Rn || (Rn = (async () => {
    try {
      X.info("Initializing ExifTool...");
      const e = new nf({
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
      return X.info(`ExifTool started successfully. Version: ${r}`), Bs = e, e;
    } catch (e) {
      return X.error("FAILED to initialize ExifTool. RAW support will be disabled.", e), null;
    }
  })(), Rn);
}
const cf = [".jpg", ".jpeg", ".png", ".arw", ".cr2", ".nef", ".dng", ".orf", ".rw2", ".tif", ".tiff"];
async function lf(e, t, r) {
  const n = Tl(), s = [];
  let o = 0;
  const a = z.join(t, "previews");
  await ar.mkdir(a, { recursive: !0 });
  const i = n.prepare(`
    INSERT INTO photos (file_path, preview_cache_path, created_at, metadata_json) 
    VALUES (@file_path, @preview_cache_path, @created_at, @metadata_json)
    ON CONFLICT(file_path) DO NOTHING
  `), c = n.prepare("SELECT * FROM photos WHERE file_path = ?");
  async function d(y) {
    const w = z.basename(y), $ = `${rf("md5").update(y).digest("hex")}.jpg`, p = z.join(a, $);
    try {
      try {
        return await ar.access(p), p;
      } catch {
        const E = z.extname(y).toLowerCase();
        if (![".jpg", ".jpeg", ".png"].includes(E)) {
          let R = !1;
          if (![".tif", ".tiff"].includes(E))
            try {
              const T = await Tn();
              if (T) {
                const C = `${p}.tmp`, k = new Promise(
                  (le, ue) => setTimeout(() => ue(new Error("Preview extraction timed out")), 15e3)
                );
                await Promise.race([
                  T.extractPreview(y, C),
                  k
                ]), await ar.access(C), await Hi(C).rotate().resize(1200, 1200, { fit: "inside", withoutEnlargement: !0 }).jpeg({ quality: 80 }).toFile(p);
                try {
                  await ar.unlink(C);
                } catch {
                }
                X.info(`Extracted and normalized preview for ${w}`), R = !0;
              }
            } catch {
              try {
                await ar.unlink(`${p}.tmp`);
              } catch {
              }
            }
          if (!R)
            try {
              X.info(`Generating preview with Sharp for ${w}...`), await Hi(y).rotate().resize(1200, 1200, { fit: "inside", withoutEnlargement: !0 }).jpeg({ quality: 80 }).toFile(p), X.info(`Generated preview with Sharp for ${w}`), R = !0;
            } catch (T) {
              X.error(`Sharp conversion failed for ${w}:`, T);
            }
          if (R) return p;
        }
      }
    } catch (E) {
      X.error(`Failed to extract/generate preview for ${y}`, E);
    }
    return null;
  }
  let u = 0;
  const f = {};
  async function _(y) {
    try {
      X.info(`Scanning directory: ${y}`);
      const w = await ar.readdir(y, { withFileTypes: !0 });
      X.info(`Found ${w.length} entries in ${y}`);
      for (const g of w) {
        const $ = z.join(y, g.name);
        if (g.isDirectory())
          g.name.startsWith(".") || await _($);
        else if (g.isFile()) {
          u++;
          const p = z.extname(g.name).toLowerCase();
          if (cf.includes(p)) {
            let E = c.get($), N = !1;
            if (E) {
              const R = ![".jpg", ".jpeg", ".png"].includes(p);
              let T = !1;
              if (R) {
                if (E.preview_cache_path)
                  try {
                    await ar.access(E.preview_cache_path);
                  } catch {
                    T = !0;
                  }
                else
                  T = !0;
                if (T && await Tn()) {
                  const k = await d($);
                  k && (n.prepare("UPDATE photos SET preview_cache_path = ? WHERE id = ?").run(k, E.id), E.preview_cache_path = k, N = !0);
                }
              }
              if (!E.metadata_json || E.metadata_json === "{}")
                try {
                  const C = await Tn();
                  if (C) {
                    const k = await C.read($);
                    n.prepare("UPDATE photos SET metadata_json = ? WHERE id = ?").run(JSON.stringify(k), E.id), E.metadata_json = JSON.stringify(k), N = !0;
                  }
                } catch (C) {
                  X.error(`Failed to backfill metadata for ${$}`, C);
                }
            }
            if (!E) {
              X.info(`[Scanner] New photo found: ${g.name}`);
              const R = await d($);
              try {
                let T = {};
                try {
                  const C = await Tn();
                  C && (T = await C.read($));
                } catch (C) {
                  X.error(`Failed to read metadata for ${$}`, C);
                }
                i.run({
                  file_path: $,
                  preview_cache_path: R,
                  created_at: (/* @__PURE__ */ new Date()).toISOString(),
                  metadata_json: JSON.stringify(T)
                }), E = c.get($);
              } catch (T) {
                X.error("Insert failed", T);
              }
            }
            E && (s.push(E), o++, (o % 10 === 0 || N) && (r && r(o), await new Promise((R) => setTimeout(R, 0))));
          } else
            f[p] = (f[p] || 0) + 1;
        }
      }
    } catch (w) {
      X.error(`Error scanning ${y}:`, w);
    }
  }
  return await _(e), X.info(`[Scanner] Total files: ${u}, Processed: ${o}, Returned: ${s.length}`), X.info("[Scanner] Skipped Extensions:", f), s;
}
const vr = (e) => {
  const t = typeof e;
  return e !== null && (t === "object" || t === "function");
}, Ol = /* @__PURE__ */ new Set([
  "__proto__",
  "prototype",
  "constructor"
]), Il = 1e6, uf = (e) => e >= "0" && e <= "9";
function jl(e) {
  if (e === "0")
    return !0;
  if (/^[1-9]\d*$/.test(e)) {
    const t = Number.parseInt(e, 10);
    return t <= Number.MAX_SAFE_INTEGER && t <= Il;
  }
  return !1;
}
function Ws(e, t) {
  return Ol.has(e) ? !1 : (e && jl(e) ? t.push(Number.parseInt(e, 10)) : t.push(e), !0);
}
function df(e) {
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
        if (!Ws(r, t))
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
          if ((r || n === "property") && !Ws(r, t))
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
            !Number.isNaN(i) && Number.isFinite(i) && i >= 0 && i <= Number.MAX_SAFE_INTEGER && i <= Il && r === String(i) ? t.push(i) : t.push(r), r = "", n = "indexEnd";
          }
          break;
        }
        if (n === "indexEnd")
          throw new Error(`Invalid character '${a}' after an index at position ${o}`);
        r += a;
        break;
      }
      default: {
        if (n === "index" && !uf(a))
          throw new Error(`Invalid character '${a}' in an index at position ${o}`);
        if (n === "indexEnd")
          throw new Error(`Invalid character '${a}' after an index at position ${o}`);
        n === "start" && (n = "property"), r += a;
      }
    }
  }
  switch (s && (r += "\\"), n) {
    case "property": {
      if (!Ws(r, t))
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
function ws(e) {
  if (typeof e == "string")
    return df(e);
  if (Array.isArray(e)) {
    const t = [];
    for (const [r, n] of e.entries()) {
      if (typeof n != "string" && typeof n != "number")
        throw new TypeError(`Expected a string or number for path segment at index ${r}, got ${typeof n}`);
      if (typeof n == "number" && !Number.isFinite(n))
        throw new TypeError(`Path segment at index ${r} must be a finite number, got ${n}`);
      if (Ol.has(n))
        return [];
      typeof n == "string" && jl(n) ? t.push(Number.parseInt(n, 10)) : t.push(n);
    }
    return t;
  }
  return [];
}
function Ji(e, t, r) {
  if (!vr(e) || typeof t != "string" && !Array.isArray(t))
    return r === void 0 ? e : r;
  const n = ws(t);
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
function On(e, t, r) {
  if (!vr(e) || typeof t != "string" && !Array.isArray(t))
    return e;
  const n = e, s = ws(t);
  if (s.length === 0)
    return e;
  for (let o = 0; o < s.length; o++) {
    const a = s[o];
    if (o === s.length - 1)
      e[a] = r;
    else if (!vr(e[a])) {
      const c = typeof s[o + 1] == "number";
      e[a] = c ? [] : {};
    }
    e = e[a];
  }
  return n;
}
function ff(e, t) {
  if (!vr(e) || typeof t != "string" && !Array.isArray(t))
    return !1;
  const r = ws(t);
  if (r.length === 0)
    return !1;
  for (let n = 0; n < r.length; n++) {
    const s = r[n];
    if (n === r.length - 1)
      return Object.hasOwn(e, s) ? (delete e[s], !0) : !1;
    if (e = e[s], !vr(e))
      return !1;
  }
}
function Js(e, t) {
  if (!vr(e) || typeof t != "string" && !Array.isArray(t))
    return !1;
  const r = ws(t);
  if (r.length === 0)
    return !1;
  for (const n of r) {
    if (!vr(e) || !(n in e))
      return !1;
    e = e[n];
  }
  return !0;
}
const Ut = Nl.homedir(), Go = Nl.tmpdir(), { env: jr } = me, hf = (e) => {
  const t = z.join(Ut, "Library");
  return {
    data: z.join(t, "Application Support", e),
    config: z.join(t, "Preferences", e),
    cache: z.join(t, "Caches", e),
    log: z.join(t, "Logs", e),
    temp: z.join(Go, e)
  };
}, pf = (e) => {
  const t = jr.APPDATA || z.join(Ut, "AppData", "Roaming"), r = jr.LOCALAPPDATA || z.join(Ut, "AppData", "Local");
  return {
    // Data/config/cache/log are invented by me as Windows isn't opinionated about this
    data: z.join(r, e, "Data"),
    config: z.join(t, e, "Config"),
    cache: z.join(r, e, "Cache"),
    log: z.join(r, e, "Log"),
    temp: z.join(Go, e)
  };
}, mf = (e) => {
  const t = z.basename(Ut);
  return {
    data: z.join(jr.XDG_DATA_HOME || z.join(Ut, ".local", "share"), e),
    config: z.join(jr.XDG_CONFIG_HOME || z.join(Ut, ".config"), e),
    cache: z.join(jr.XDG_CACHE_HOME || z.join(Ut, ".cache"), e),
    // https://wiki.debian.org/XDGBaseDirectorySpecification#state
    log: z.join(jr.XDG_STATE_HOME || z.join(Ut, ".local", "state"), e),
    temp: z.join(Go, t, e)
  };
};
function yf(e, { suffix: t = "nodejs" } = {}) {
  if (typeof e != "string")
    throw new TypeError(`Expected a string, got ${typeof e}`);
  return t && (e += `-${t}`), me.platform === "darwin" ? hf(e) : me.platform === "win32" ? pf(e) : mf(e);
}
const Ot = (e, t) => {
  const { onError: r } = t;
  return function(...s) {
    return e.apply(void 0, s).catch(r);
  };
}, wt = (e, t) => {
  const { onError: r } = t;
  return function(...s) {
    try {
      return e.apply(void 0, s);
    } catch (o) {
      return r(o);
    }
  };
}, $f = 250, It = (e, t) => {
  const { isRetriable: r } = t;
  return function(s) {
    const { timeout: o } = s, a = s.interval ?? $f, i = Date.now() + o;
    return function c(...d) {
      return e.apply(void 0, d).catch((u) => {
        if (!r(u) || Date.now() >= i)
          throw u;
        const f = Math.round(a * Math.random());
        return f > 0 ? new Promise((y) => setTimeout(y, f)).then(() => c.apply(void 0, d)) : c.apply(void 0, d);
      });
    };
  };
}, jt = (e, t) => {
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
}, Ar = {
  /* API */
  isChangeErrorOk: (e) => {
    if (!Ar.isNodeError(e))
      return !1;
    const { code: t } = e;
    return t === "ENOSYS" || !gf && (t === "EINVAL" || t === "EPERM");
  },
  isNodeError: (e) => e instanceof Error,
  isRetriableError: (e) => {
    if (!Ar.isNodeError(e))
      return !1;
    const { code: t } = e;
    return t === "EMFILE" || t === "ENFILE" || t === "EAGAIN" || t === "EBUSY" || t === "EACCESS" || t === "EACCES" || t === "EACCS" || t === "EPERM";
  },
  onChangeError: (e) => {
    if (!Ar.isNodeError(e))
      throw e;
    if (!Ar.isChangeErrorOk(e))
      throw e;
  }
}, In = {
  onError: Ar.onChangeError
}, We = {
  onError: () => {
  }
}, gf = me.getuid ? !me.getuid() : !1, Ie = {
  isRetriable: Ar.isRetriableError
}, Ce = {
  attempt: {
    /* ASYNC */
    chmod: Ot(Oe(Y.chmod), In),
    chown: Ot(Oe(Y.chown), In),
    close: Ot(Oe(Y.close), We),
    fsync: Ot(Oe(Y.fsync), We),
    mkdir: Ot(Oe(Y.mkdir), We),
    realpath: Ot(Oe(Y.realpath), We),
    stat: Ot(Oe(Y.stat), We),
    unlink: Ot(Oe(Y.unlink), We),
    /* SYNC */
    chmodSync: wt(Y.chmodSync, In),
    chownSync: wt(Y.chownSync, In),
    closeSync: wt(Y.closeSync, We),
    existsSync: wt(Y.existsSync, We),
    fsyncSync: wt(Y.fsync, We),
    mkdirSync: wt(Y.mkdirSync, We),
    realpathSync: wt(Y.realpathSync, We),
    statSync: wt(Y.statSync, We),
    unlinkSync: wt(Y.unlinkSync, We)
  },
  retry: {
    /* ASYNC */
    close: It(Oe(Y.close), Ie),
    fsync: It(Oe(Y.fsync), Ie),
    open: It(Oe(Y.open), Ie),
    readFile: It(Oe(Y.readFile), Ie),
    rename: It(Oe(Y.rename), Ie),
    stat: It(Oe(Y.stat), Ie),
    write: It(Oe(Y.write), Ie),
    writeFile: It(Oe(Y.writeFile), Ie),
    /* SYNC */
    closeSync: jt(Y.closeSync, Ie),
    fsyncSync: jt(Y.fsyncSync, Ie),
    openSync: jt(Y.openSync, Ie),
    readFileSync: jt(Y.readFileSync, Ie),
    renameSync: jt(Y.renameSync, Ie),
    statSync: jt(Y.statSync, Ie),
    writeSync: jt(Y.writeSync, Ie),
    writeFileSync: jt(Y.writeFileSync, Ie)
  }
}, _f = "utf8", Xi = 438, vf = 511, Ef = {}, wf = me.geteuid ? me.geteuid() : -1, Sf = me.getegid ? me.getegid() : -1, bf = 1e3, Pf = !!me.getuid;
me.getuid && me.getuid();
const Yi = 128, Nf = (e) => e instanceof Error && "code" in e, xi = (e) => typeof e == "string", Xs = (e) => e === void 0, Rf = me.platform === "linux", Al = me.platform === "win32", Ko = ["SIGHUP", "SIGINT", "SIGTERM"];
Al || Ko.push("SIGALRM", "SIGABRT", "SIGVTALRM", "SIGXCPU", "SIGXFSZ", "SIGUSR2", "SIGTRAP", "SIGSYS", "SIGQUIT", "SIGIOT");
Rf && Ko.push("SIGIO", "SIGPOLL", "SIGPWR", "SIGSTKFLT");
class Tf {
  /* CONSTRUCTOR */
  constructor() {
    this.callbacks = /* @__PURE__ */ new Set(), this.exited = !1, this.exit = (t) => {
      if (!this.exited) {
        this.exited = !0;
        for (const r of this.callbacks)
          r();
        t && (Al && t !== "SIGINT" && t !== "SIGTERM" && t !== "SIGKILL" ? me.kill(me.pid, "SIGTERM") : me.kill(me.pid, t));
      }
    }, this.hook = () => {
      me.once("exit", () => this.exit());
      for (const t of Ko)
        try {
          me.once(t, () => this.exit(t));
        } catch {
        }
    }, this.register = (t) => (this.callbacks.add(t), () => {
      this.callbacks.delete(t);
    }), this.hook();
  }
}
const Of = new Tf(), If = Of.register, De = {
  /* VARIABLES */
  store: {},
  // filePath => purge
  /* API */
  create: (e) => {
    const t = `000000${Math.floor(Math.random() * 16777215).toString(16)}`.slice(-6), s = `.tmp-${Date.now().toString().slice(-10)}${t}`;
    return `${e}${s}`;
  },
  get: (e, t, r = !0) => {
    const n = De.truncate(t(e));
    return n in De.store ? De.get(e, t, r) : (De.store[n] = r, [n, () => delete De.store[n]]);
  },
  purge: (e) => {
    De.store[e] && (delete De.store[e], Ce.attempt.unlink(e));
  },
  purgeSync: (e) => {
    De.store[e] && (delete De.store[e], Ce.attempt.unlinkSync(e));
  },
  purgeSyncAll: () => {
    for (const e in De.store)
      De.purgeSync(e);
  },
  truncate: (e) => {
    const t = z.basename(e);
    if (t.length <= Yi)
      return e;
    const r = /^(\.?)(.*?)((?:\.[^.]+)?(?:\.tmp-\d{10}[a-f0-9]{6})?)$/.exec(t);
    if (!r)
      return e;
    const n = t.length - Yi;
    return `${e.slice(0, -t.length)}${r[1]}${r[2].slice(0, -n)}${r[3]}`;
  }
};
If(De.purgeSyncAll);
function Cl(e, t, r = Ef) {
  if (xi(r))
    return Cl(e, t, { encoding: r });
  const s = { timeout: r.timeout ?? bf };
  let o = null, a = null, i = null;
  try {
    const c = Ce.attempt.realpathSync(e), d = !!c;
    e = c || e, [a, o] = De.get(e, r.tmpCreate || De.create, r.tmpPurge !== !1);
    const u = Pf && Xs(r.chown), f = Xs(r.mode);
    if (d && (u || f)) {
      const _ = Ce.attempt.statSync(e);
      _ && (r = { ...r }, u && (r.chown = { uid: _.uid, gid: _.gid }), f && (r.mode = _.mode));
    }
    if (!d) {
      const _ = z.dirname(e);
      Ce.attempt.mkdirSync(_, {
        mode: vf,
        recursive: !0
      });
    }
    i = Ce.retry.openSync(s)(a, "w", r.mode || Xi), r.tmpCreated && r.tmpCreated(a), xi(t) ? Ce.retry.writeSync(s)(i, t, 0, r.encoding || _f) : Xs(t) || Ce.retry.writeSync(s)(i, t, 0, t.length, 0), r.fsync !== !1 && (r.fsyncWait !== !1 ? Ce.retry.fsyncSync(s)(i) : Ce.attempt.fsync(i)), Ce.retry.closeSync(s)(i), i = null, r.chown && (r.chown.uid !== wf || r.chown.gid !== Sf) && Ce.attempt.chownSync(a, r.chown.uid, r.chown.gid), r.mode && r.mode !== Xi && Ce.attempt.chmodSync(a, r.mode);
    try {
      Ce.retry.renameSync(s)(a, e);
    } catch (_) {
      if (!Nf(_) || _.code !== "ENAMETOOLONG")
        throw _;
      Ce.retry.renameSync(s)(a, De.truncate(e));
    }
    o(), a = null;
  } finally {
    i && Ce.attempt.closeSync(i), a && De.purge(a);
  }
}
function kl(e) {
  return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, "default") ? e.default : e;
}
var wo = { exports: {} }, Dl = {}, at = {}, Vr = {}, wn = {}, Ys = {}, xs = {}, Qi;
function ls() {
  return Qi || (Qi = 1, function(e) {
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
  }(xs)), xs;
}
var Qs = {}, Zi;
function ec() {
  return Zi || (Zi = 1, function(e) {
    Object.defineProperty(e, "__esModule", { value: !0 }), e.ValueScope = e.ValueScopeName = e.Scope = e.varKinds = e.UsedValueState = void 0;
    const t = ls();
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
  }(Qs)), Qs;
}
var tc;
function ne() {
  return tc || (tc = 1, function(e) {
    Object.defineProperty(e, "__esModule", { value: !0 }), e.or = e.and = e.not = e.CodeGen = e.operators = e.varKinds = e.ValueScopeName = e.ValueScope = e.Scope = e.Name = e.regexpCode = e.stringify = e.getProperty = e.nil = e.strConcat = e.str = e._ = void 0;
    const t = ls(), r = ec();
    var n = ls();
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
    var s = ec();
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
        return ie(l, this.rhs);
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
        return this.nodes.reduce((l, h) => q(l, h.names), {});
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
        return ie(l, this.condition), this.else && q(l, this.else.names), l;
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
        return q(super.names, this.iteration.names);
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
        const l = ie(super.names, this.from);
        return ie(l, this.to);
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
        return q(super.names, this.iterable.names);
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
    class le extends w {
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
        return this.catch && q(l, this.catch.names), this.finally && q(l, this.finally.names), l;
      }
    }
    class ue extends w {
      constructor(l) {
        super(), this.error = l;
      }
      render(l) {
        return `catch(${this.error})` + super.render(l);
      }
    }
    ue.kind = "catch";
    class ye extends w {
      render(l) {
        return "finally" + super.render(l);
      }
    }
    ye.kind = "finally";
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
        const I = new le();
        if (this._blockNode(I), this.code(l), h) {
          const j = this.name("e");
          this._currNode = I.catch = new ue(j), h(j);
        }
        return b && (this._currNode = I.finally = new ye(), this.code(b)), this._endBlockNode(ue, ye);
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
    function q(v, l) {
      for (const h in l)
        v[h] = (v[h] || 0) + (l[h] || 0);
      return v;
    }
    function ie(v, l) {
      return l instanceof t._CodeOrName ? q(v, l.names) : v;
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
  }(Ys)), Ys;
}
var F = {};
Object.defineProperty(F, "__esModule", { value: !0 });
F.checkStrictMode = F.getErrorPath = F.Type = F.useFunc = F.setEvaluated = F.evaluatedPropsToName = F.mergeEvaluated = F.eachItem = F.unescapeJsonPointer = F.escapeJsonPointer = F.escapeFragment = F.unescapeFragment = F.schemaRefOrVal = F.schemaHasRulesButRef = F.schemaHasRules = F.checkUnknownRules = F.alwaysValidSchema = F.toHash = void 0;
const de = ne(), jf = ls();
function Af(e) {
  const t = {};
  for (const r of e)
    t[r] = !0;
  return t;
}
F.toHash = Af;
function Cf(e, t) {
  return typeof t == "boolean" ? t : Object.keys(t).length === 0 ? !0 : (Ml(e, t), !Ll(t, e.self.RULES.all));
}
F.alwaysValidSchema = Cf;
function Ml(e, t = e.schema) {
  const { opts: r, self: n } = e;
  if (!r.strictSchema || typeof t == "boolean")
    return;
  const s = n.RULES.keywords;
  for (const o in t)
    s[o] || Ul(e, `unknown keyword: "${o}"`);
}
F.checkUnknownRules = Ml;
function Ll(e, t) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (t[r])
      return !0;
  return !1;
}
F.schemaHasRules = Ll;
function kf(e, t) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (r !== "$ref" && t.all[r])
      return !0;
  return !1;
}
F.schemaHasRulesButRef = kf;
function Df({ topSchemaRef: e, schemaPath: t }, r, n, s) {
  if (!s) {
    if (typeof r == "number" || typeof r == "boolean")
      return r;
    if (typeof r == "string")
      return (0, de._)`${r}`;
  }
  return (0, de._)`${e}${t}${(0, de.getProperty)(n)}`;
}
F.schemaRefOrVal = Df;
function Mf(e) {
  return Fl(decodeURIComponent(e));
}
F.unescapeFragment = Mf;
function Lf(e) {
  return encodeURIComponent(Ho(e));
}
F.escapeFragment = Lf;
function Ho(e) {
  return typeof e == "number" ? `${e}` : e.replace(/~/g, "~0").replace(/\//g, "~1");
}
F.escapeJsonPointer = Ho;
function Fl(e) {
  return e.replace(/~1/g, "/").replace(/~0/g, "~");
}
F.unescapeJsonPointer = Fl;
function Ff(e, t) {
  if (Array.isArray(e))
    for (const r of e)
      t(r);
  else
    t(e);
}
F.eachItem = Ff;
function rc({ mergeNames: e, mergeToName: t, mergeValues: r, resultToName: n }) {
  return (s, o, a, i) => {
    const c = a === void 0 ? o : a instanceof de.Name ? (o instanceof de.Name ? e(s, o, a) : t(s, o, a), a) : o instanceof de.Name ? (t(s, a, o), o) : r(o, a);
    return i === de.Name && !(c instanceof de.Name) ? n(s, c) : c;
  };
}
F.mergeEvaluated = {
  props: rc({
    mergeNames: (e, t, r) => e.if((0, de._)`${r} !== true && ${t} !== undefined`, () => {
      e.if((0, de._)`${t} === true`, () => e.assign(r, !0), () => e.assign(r, (0, de._)`${r} || {}`).code((0, de._)`Object.assign(${r}, ${t})`));
    }),
    mergeToName: (e, t, r) => e.if((0, de._)`${r} !== true`, () => {
      t === !0 ? e.assign(r, !0) : (e.assign(r, (0, de._)`${r} || {}`), Bo(e, r, t));
    }),
    mergeValues: (e, t) => e === !0 ? !0 : { ...e, ...t },
    resultToName: Vl
  }),
  items: rc({
    mergeNames: (e, t, r) => e.if((0, de._)`${r} !== true && ${t} !== undefined`, () => e.assign(r, (0, de._)`${t} === true ? true : ${r} > ${t} ? ${r} : ${t}`)),
    mergeToName: (e, t, r) => e.if((0, de._)`${r} !== true`, () => e.assign(r, t === !0 ? !0 : (0, de._)`${r} > ${t} ? ${r} : ${t}`)),
    mergeValues: (e, t) => e === !0 ? !0 : Math.max(e, t),
    resultToName: (e, t) => e.var("items", t)
  })
};
function Vl(e, t) {
  if (t === !0)
    return e.var("props", !0);
  const r = e.var("props", (0, de._)`{}`);
  return t !== void 0 && Bo(e, r, t), r;
}
F.evaluatedPropsToName = Vl;
function Bo(e, t, r) {
  Object.keys(r).forEach((n) => e.assign((0, de._)`${t}${(0, de.getProperty)(n)}`, !0));
}
F.setEvaluated = Bo;
const nc = {};
function Vf(e, t) {
  return e.scopeValue("func", {
    ref: t,
    code: nc[t.code] || (nc[t.code] = new jf._Code(t.code))
  });
}
F.useFunc = Vf;
var So;
(function(e) {
  e[e.Num = 0] = "Num", e[e.Str = 1] = "Str";
})(So || (F.Type = So = {}));
function Uf(e, t, r) {
  if (e instanceof de.Name) {
    const n = t === So.Num;
    return r ? n ? (0, de._)`"[" + ${e} + "]"` : (0, de._)`"['" + ${e} + "']"` : n ? (0, de._)`"/" + ${e}` : (0, de._)`"/" + ${e}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
  }
  return r ? (0, de.getProperty)(e).toString() : "/" + Ho(e);
}
F.getErrorPath = Uf;
function Ul(e, t, r = e.opts.strictSchema) {
  if (r) {
    if (t = `strict mode: ${t}`, r === !0)
      throw new Error(t);
    e.self.logger.warn(t);
  }
}
F.checkStrictMode = Ul;
var Je = {};
Object.defineProperty(Je, "__esModule", { value: !0 });
const je = ne(), zf = {
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
Je.default = zf;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.extendErrors = e.resetErrorsCount = e.reportExtraError = e.reportError = e.keyword$DataError = e.keywordError = void 0;
  const t = ne(), r = F, n = Je;
  e.keywordError = {
    message: ({ keyword: $ }) => (0, t.str)`must pass "${$}" keyword validation`
  }, e.keyword$DataError = {
    message: ({ keyword: $, schemaType: p }) => p ? (0, t.str)`"${$}" keyword must be ${p} ($data)` : (0, t.str)`"${$}" keyword is invalid ($data)`
  };
  function s($, p = e.keywordError, E, N) {
    const { it: R } = $, { gen: T, compositeRule: C, allErrors: k } = R, le = f($, p, E);
    N ?? (C || k) ? c(T, le) : d(R, (0, t._)`[${le}]`);
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
    const { keyword: R, data: T, schemaValue: C, it: k } = $, { opts: le, propertyName: ue, topSchemaRef: ye, schemaPath: L } = k;
    N.push([u.keyword, R], [u.params, typeof p == "function" ? p($) : p || (0, t._)`{}`]), le.messages && N.push([u.message, typeof E == "function" ? E($) : E]), le.verbose && N.push([u.schema, C], [u.parentSchema, (0, t._)`${ye}${L}`], [n.default.data, T]), ue && N.push([u.propertyName, ue]);
  }
})(wn);
Object.defineProperty(Vr, "__esModule", { value: !0 });
Vr.boolOrEmptySchema = Vr.topBoolOrEmptySchema = void 0;
const qf = wn, Gf = ne(), Kf = Je, Hf = {
  message: "boolean schema is false"
};
function Bf(e) {
  const { gen: t, schema: r, validateName: n } = e;
  r === !1 ? zl(e, !1) : typeof r == "object" && r.$async === !0 ? t.return(Kf.default.data) : (t.assign((0, Gf._)`${n}.errors`, null), t.return(!0));
}
Vr.topBoolOrEmptySchema = Bf;
function Wf(e, t) {
  const { gen: r, schema: n } = e;
  n === !1 ? (r.var(t, !1), zl(e)) : r.var(t, !0);
}
Vr.boolOrEmptySchema = Wf;
function zl(e, t) {
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
  (0, qf.reportError)(s, Hf, void 0, t);
}
var we = {}, Er = {};
Object.defineProperty(Er, "__esModule", { value: !0 });
Er.getRules = Er.isJSONType = void 0;
const Jf = ["string", "number", "integer", "boolean", "null", "object", "array"], Xf = new Set(Jf);
function Yf(e) {
  return typeof e == "string" && Xf.has(e);
}
Er.isJSONType = Yf;
function xf() {
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
Er.getRules = xf;
var St = {};
Object.defineProperty(St, "__esModule", { value: !0 });
St.shouldUseRule = St.shouldUseGroup = St.schemaHasRulesForType = void 0;
function Qf({ schema: e, self: t }, r) {
  const n = t.RULES.types[r];
  return n && n !== !0 && ql(e, n);
}
St.schemaHasRulesForType = Qf;
function ql(e, t) {
  return t.rules.some((r) => Gl(e, r));
}
St.shouldUseGroup = ql;
function Gl(e, t) {
  var r;
  return e[t.keyword] !== void 0 || ((r = t.definition.implements) === null || r === void 0 ? void 0 : r.some((n) => e[n] !== void 0));
}
St.shouldUseRule = Gl;
Object.defineProperty(we, "__esModule", { value: !0 });
we.reportTypeError = we.checkDataTypes = we.checkDataType = we.coerceAndCheckDataType = we.getJSONTypes = we.getSchemaTypes = we.DataType = void 0;
const Zf = Er, eh = St, th = wn, te = ne(), Kl = F;
var kr;
(function(e) {
  e[e.Correct = 0] = "Correct", e[e.Wrong = 1] = "Wrong";
})(kr || (we.DataType = kr = {}));
function rh(e) {
  const t = Hl(e.type);
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
we.getSchemaTypes = rh;
function Hl(e) {
  const t = Array.isArray(e) ? e : e ? [e] : [];
  if (t.every(Zf.isJSONType))
    return t;
  throw new Error("type must be JSONType or JSONType[]: " + t.join(","));
}
we.getJSONTypes = Hl;
function nh(e, t) {
  const { gen: r, data: n, opts: s } = e, o = sh(t, s.coerceTypes), a = t.length > 0 && !(o.length === 0 && t.length === 1 && (0, eh.schemaHasRulesForType)(e, t[0]));
  if (a) {
    const i = Wo(t, n, s.strictNumbers, kr.Wrong);
    r.if(i, () => {
      o.length ? oh(e, t, o) : Jo(e);
    });
  }
  return a;
}
we.coerceAndCheckDataType = nh;
const Bl = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
function sh(e, t) {
  return t ? e.filter((r) => Bl.has(r) || t === "array" && r === "array") : [];
}
function oh(e, t, r) {
  const { gen: n, data: s, opts: o } = e, a = n.let("dataType", (0, te._)`typeof ${s}`), i = n.let("coerced", (0, te._)`undefined`);
  o.coerceTypes === "array" && n.if((0, te._)`${a} == 'object' && Array.isArray(${s}) && ${s}.length == 1`, () => n.assign(s, (0, te._)`${s}[0]`).assign(a, (0, te._)`typeof ${s}`).if(Wo(t, s, o.strictNumbers), () => n.assign(i, s))), n.if((0, te._)`${i} !== undefined`);
  for (const d of r)
    (Bl.has(d) || d === "array" && o.coerceTypes === "array") && c(d);
  n.else(), Jo(e), n.endIf(), n.if((0, te._)`${i} !== undefined`, () => {
    n.assign(s, i), ah(e, i);
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
function ah({ gen: e, parentData: t, parentDataProperty: r }, n) {
  e.if((0, te._)`${t} !== undefined`, () => e.assign((0, te._)`${t}[${r}]`, n));
}
function bo(e, t, r, n = kr.Correct) {
  const s = n === kr.Correct ? te.operators.EQ : te.operators.NEQ;
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
  return n === kr.Correct ? o : (0, te.not)(o);
  function a(i = te.nil) {
    return (0, te.and)((0, te._)`typeof ${t} == "number"`, i, r ? (0, te._)`isFinite(${t})` : te.nil);
  }
}
we.checkDataType = bo;
function Wo(e, t, r, n) {
  if (e.length === 1)
    return bo(e[0], t, r, n);
  let s;
  const o = (0, Kl.toHash)(e);
  if (o.array && o.object) {
    const a = (0, te._)`typeof ${t} != "object"`;
    s = o.null ? a : (0, te._)`!${t} || ${a}`, delete o.null, delete o.array, delete o.object;
  } else
    s = te.nil;
  o.number && delete o.integer;
  for (const a in o)
    s = (0, te.and)(s, bo(a, t, r, n));
  return s;
}
we.checkDataTypes = Wo;
const ih = {
  message: ({ schema: e }) => `must be ${e}`,
  params: ({ schema: e, schemaValue: t }) => typeof e == "string" ? (0, te._)`{type: ${e}}` : (0, te._)`{type: ${t}}`
};
function Jo(e) {
  const t = ch(e);
  (0, th.reportError)(t, ih);
}
we.reportTypeError = Jo;
function ch(e) {
  const { gen: t, data: r, schema: n } = e, s = (0, Kl.schemaRefOrVal)(e, n, "type");
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
var Ss = {};
Object.defineProperty(Ss, "__esModule", { value: !0 });
Ss.assignDefaults = void 0;
const br = ne(), lh = F;
function uh(e, t) {
  const { properties: r, items: n } = e.schema;
  if (t === "object" && r)
    for (const s in r)
      sc(e, s, r[s].default);
  else t === "array" && Array.isArray(n) && n.forEach((s, o) => sc(e, o, s.default));
}
Ss.assignDefaults = uh;
function sc(e, t, r) {
  const { gen: n, compositeRule: s, data: o, opts: a } = e;
  if (r === void 0)
    return;
  const i = (0, br._)`${o}${(0, br.getProperty)(t)}`;
  if (s) {
    (0, lh.checkStrictMode)(e, `default is ignored for: ${i}`);
    return;
  }
  let c = (0, br._)`${i} === undefined`;
  a.useDefaults === "empty" && (c = (0, br._)`${c} || ${i} === null || ${i} === ""`), n.if(c, (0, br._)`${i} = ${(0, br.stringify)(r)}`);
}
var $t = {}, oe = {};
Object.defineProperty(oe, "__esModule", { value: !0 });
oe.validateUnion = oe.validateArray = oe.usePattern = oe.callValidateCode = oe.schemaProperties = oe.allSchemaProperties = oe.noPropertyInData = oe.propertyInData = oe.isOwnProperty = oe.hasPropFunc = oe.reportMissingProp = oe.checkMissingProp = oe.checkReportMissingProp = void 0;
const he = ne(), Xo = F, At = Je, dh = F;
function fh(e, t) {
  const { gen: r, data: n, it: s } = e;
  r.if(xo(r, n, t, s.opts.ownProperties), () => {
    e.setParams({ missingProperty: (0, he._)`${t}` }, !0), e.error();
  });
}
oe.checkReportMissingProp = fh;
function hh({ gen: e, data: t, it: { opts: r } }, n, s) {
  return (0, he.or)(...n.map((o) => (0, he.and)(xo(e, t, o, r.ownProperties), (0, he._)`${s} = ${o}`)));
}
oe.checkMissingProp = hh;
function ph(e, t) {
  e.setParams({ missingProperty: t }, !0), e.error();
}
oe.reportMissingProp = ph;
function Wl(e) {
  return e.scopeValue("func", {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    ref: Object.prototype.hasOwnProperty,
    code: (0, he._)`Object.prototype.hasOwnProperty`
  });
}
oe.hasPropFunc = Wl;
function Yo(e, t, r) {
  return (0, he._)`${Wl(e)}.call(${t}, ${r})`;
}
oe.isOwnProperty = Yo;
function mh(e, t, r, n) {
  const s = (0, he._)`${t}${(0, he.getProperty)(r)} !== undefined`;
  return n ? (0, he._)`${s} && ${Yo(e, t, r)}` : s;
}
oe.propertyInData = mh;
function xo(e, t, r, n) {
  const s = (0, he._)`${t}${(0, he.getProperty)(r)} === undefined`;
  return n ? (0, he.or)(s, (0, he.not)(Yo(e, t, r))) : s;
}
oe.noPropertyInData = xo;
function Jl(e) {
  return e ? Object.keys(e).filter((t) => t !== "__proto__") : [];
}
oe.allSchemaProperties = Jl;
function yh(e, t) {
  return Jl(t).filter((r) => !(0, Xo.alwaysValidSchema)(e, t[r]));
}
oe.schemaProperties = yh;
function $h({ schemaCode: e, data: t, it: { gen: r, topSchemaRef: n, schemaPath: s, errorPath: o }, it: a }, i, c, d) {
  const u = d ? (0, he._)`${e}, ${t}, ${n}${s}` : t, f = [
    [At.default.instancePath, (0, he.strConcat)(At.default.instancePath, o)],
    [At.default.parentData, a.parentData],
    [At.default.parentDataProperty, a.parentDataProperty],
    [At.default.rootData, At.default.rootData]
  ];
  a.opts.dynamicRef && f.push([At.default.dynamicAnchors, At.default.dynamicAnchors]);
  const _ = (0, he._)`${u}, ${r.object(...f)}`;
  return c !== he.nil ? (0, he._)`${i}.call(${c}, ${_})` : (0, he._)`${i}(${_})`;
}
oe.callValidateCode = $h;
const gh = (0, he._)`new RegExp`;
function _h({ gen: e, it: { opts: t } }, r) {
  const n = t.unicodeRegExp ? "u" : "", { regExp: s } = t.code, o = s(r, n);
  return e.scopeValue("pattern", {
    key: o.toString(),
    ref: o,
    code: (0, he._)`${s.code === "new RegExp" ? gh : (0, dh.useFunc)(e, s)}(${r}, ${n})`
  });
}
oe.usePattern = _h;
function vh(e) {
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
        dataPropType: Xo.Type.Num
      }, o), t.if((0, he.not)(o), i);
    });
  }
}
oe.validateArray = vh;
function Eh(e) {
  const { gen: t, schema: r, keyword: n, it: s } = e;
  if (!Array.isArray(r))
    throw new Error("ajv implementation error");
  if (r.some((c) => (0, Xo.alwaysValidSchema)(s, c)) && !s.opts.unevaluated)
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
oe.validateUnion = Eh;
Object.defineProperty($t, "__esModule", { value: !0 });
$t.validateKeywordUsage = $t.validSchemaType = $t.funcKeywordCode = $t.macroKeywordCode = void 0;
const Le = ne(), dr = Je, wh = oe, Sh = wn;
function bh(e, t) {
  const { gen: r, keyword: n, schema: s, parentSchema: o, it: a } = e, i = t.macro.call(a.self, s, o, a), c = Xl(r, n, i);
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
$t.macroKeywordCode = bh;
function Ph(e, t) {
  var r;
  const { gen: n, keyword: s, schema: o, parentSchema: a, $data: i, it: c } = e;
  Rh(c, t);
  const d = !i && t.compile ? t.compile.call(c.self, o, a, c) : t.validate, u = Xl(n, s, d), f = n.let("valid");
  e.block$data(f, _), e.ok((r = t.valid) !== null && r !== void 0 ? r : f);
  function _() {
    if (t.errors === !1)
      g(), t.modifying && oc(e), $(() => e.error());
    else {
      const p = t.async ? y() : w();
      t.modifying && oc(e), $(() => Nh(e, p));
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
    const E = c.opts.passContext ? dr.default.this : dr.default.self, N = !("compile" in t && !i || t.schema === !1);
    n.assign(f, (0, Le._)`${p}${(0, wh.callValidateCode)(e, u, E, N)}`, t.modifying);
  }
  function $(p) {
    var E;
    n.if((0, Le.not)((E = t.valid) !== null && E !== void 0 ? E : f), p);
  }
}
$t.funcKeywordCode = Ph;
function oc(e) {
  const { gen: t, data: r, it: n } = e;
  t.if(n.parentData, () => t.assign(r, (0, Le._)`${n.parentData}[${n.parentDataProperty}]`));
}
function Nh(e, t) {
  const { gen: r } = e;
  r.if((0, Le._)`Array.isArray(${t})`, () => {
    r.assign(dr.default.vErrors, (0, Le._)`${dr.default.vErrors} === null ? ${t} : ${dr.default.vErrors}.concat(${t})`).assign(dr.default.errors, (0, Le._)`${dr.default.vErrors}.length`), (0, Sh.extendErrors)(e);
  }, () => e.error());
}
function Rh({ schemaEnv: e }, t) {
  if (t.async && !e.$async)
    throw new Error("async keyword in sync schema");
}
function Xl(e, t, r) {
  if (r === void 0)
    throw new Error(`keyword "${t}" failed to compile`);
  return e.scopeValue("keyword", typeof r == "function" ? { ref: r } : { ref: r, code: (0, Le.stringify)(r) });
}
function Th(e, t, r = !1) {
  return !t.length || t.some((n) => n === "array" ? Array.isArray(e) : n === "object" ? e && typeof e == "object" && !Array.isArray(e) : typeof e == n || r && typeof e > "u");
}
$t.validSchemaType = Th;
function Oh({ schema: e, opts: t, self: r, errSchemaPath: n }, s, o) {
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
$t.validateKeywordUsage = Oh;
var Kt = {};
Object.defineProperty(Kt, "__esModule", { value: !0 });
Kt.extendSubschemaMode = Kt.extendSubschemaData = Kt.getSubschema = void 0;
const pt = ne(), Yl = F;
function Ih(e, { keyword: t, schemaProp: r, schema: n, schemaPath: s, errSchemaPath: o, topSchemaRef: a }) {
  if (t !== void 0 && n !== void 0)
    throw new Error('both "keyword" and "schema" passed, only one allowed');
  if (t !== void 0) {
    const i = e.schema[t];
    return r === void 0 ? {
      schema: i,
      schemaPath: (0, pt._)`${e.schemaPath}${(0, pt.getProperty)(t)}`,
      errSchemaPath: `${e.errSchemaPath}/${t}`
    } : {
      schema: i[r],
      schemaPath: (0, pt._)`${e.schemaPath}${(0, pt.getProperty)(t)}${(0, pt.getProperty)(r)}`,
      errSchemaPath: `${e.errSchemaPath}/${t}/${(0, Yl.escapeFragment)(r)}`
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
Kt.getSubschema = Ih;
function jh(e, t, { dataProp: r, dataPropType: n, data: s, dataTypes: o, propertyName: a }) {
  if (s !== void 0 && r !== void 0)
    throw new Error('both "data" and "dataProp" passed, only one allowed');
  const { gen: i } = t;
  if (r !== void 0) {
    const { errorPath: d, dataPathArr: u, opts: f } = t, _ = i.let("data", (0, pt._)`${t.data}${(0, pt.getProperty)(r)}`, !0);
    c(_), e.errorPath = (0, pt.str)`${d}${(0, Yl.getErrorPath)(r, n, f.jsPropertySyntax)}`, e.parentDataProperty = (0, pt._)`${r}`, e.dataPathArr = [...u, e.parentDataProperty];
  }
  if (s !== void 0) {
    const d = s instanceof pt.Name ? s : i.let("data", s, !0);
    c(d), a !== void 0 && (e.propertyName = a);
  }
  o && (e.dataTypes = o);
  function c(d) {
    e.data = d, e.dataLevel = t.dataLevel + 1, e.dataTypes = [], t.definedProperties = /* @__PURE__ */ new Set(), e.parentData = t.data, e.dataNames = [...t.dataNames, d];
  }
}
Kt.extendSubschemaData = jh;
function Ah(e, { jtdDiscriminator: t, jtdMetadata: r, compositeRule: n, createErrors: s, allErrors: o }) {
  n !== void 0 && (e.compositeRule = n), s !== void 0 && (e.createErrors = s), o !== void 0 && (e.allErrors = o), e.jtdDiscriminator = t, e.jtdMetadata = r;
}
Kt.extendSubschemaMode = Ah;
var Re = {}, bs = function e(t, r) {
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
}, xl = { exports: {} }, qt = xl.exports = function(e, t, r) {
  typeof t == "function" && (r = t, t = {}), r = t.cb || r;
  var n = typeof r == "function" ? r : r.pre || function() {
  }, s = r.post || function() {
  };
  Zn(t, n, s, e, "", e);
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
function Zn(e, t, r, n, s, o, a, i, c, d) {
  if (n && typeof n == "object" && !Array.isArray(n)) {
    t(n, s, o, a, i, c, d);
    for (var u in n) {
      var f = n[u];
      if (Array.isArray(f)) {
        if (u in qt.arrayKeywords)
          for (var _ = 0; _ < f.length; _++)
            Zn(e, t, r, f[_], s + "/" + u + "/" + _, o, s, u, n, _);
      } else if (u in qt.propsKeywords) {
        if (f && typeof f == "object")
          for (var y in f)
            Zn(e, t, r, f[y], s + "/" + u + "/" + Ch(y), o, s, u, n, y);
      } else (u in qt.keywords || e.allKeys && !(u in qt.skipKeywords)) && Zn(e, t, r, f, s + "/" + u, o, s, u, n);
    }
    r(n, s, o, a, i, c, d);
  }
}
function Ch(e) {
  return e.replace(/~/g, "~0").replace(/\//g, "~1");
}
var kh = xl.exports;
Object.defineProperty(Re, "__esModule", { value: !0 });
Re.getSchemaRefs = Re.resolveUrl = Re.normalizeId = Re._getFullPath = Re.getFullPath = Re.inlineRef = void 0;
const Dh = F, Mh = bs, Lh = kh, Fh = /* @__PURE__ */ new Set([
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
function Vh(e, t = !0) {
  return typeof e == "boolean" ? !0 : t === !0 ? !Po(e) : t ? Ql(e) <= t : !1;
}
Re.inlineRef = Vh;
const Uh = /* @__PURE__ */ new Set([
  "$ref",
  "$recursiveRef",
  "$recursiveAnchor",
  "$dynamicRef",
  "$dynamicAnchor"
]);
function Po(e) {
  for (const t in e) {
    if (Uh.has(t))
      return !0;
    const r = e[t];
    if (Array.isArray(r) && r.some(Po) || typeof r == "object" && Po(r))
      return !0;
  }
  return !1;
}
function Ql(e) {
  let t = 0;
  for (const r in e) {
    if (r === "$ref")
      return 1 / 0;
    if (t++, !Fh.has(r) && (typeof e[r] == "object" && (0, Dh.eachItem)(e[r], (n) => t += Ql(n)), t === 1 / 0))
      return 1 / 0;
  }
  return t;
}
function Zl(e, t = "", r) {
  r !== !1 && (t = Dr(t));
  const n = e.parse(t);
  return eu(e, n);
}
Re.getFullPath = Zl;
function eu(e, t) {
  return e.serialize(t).split("#")[0] + "#";
}
Re._getFullPath = eu;
const zh = /#\/?$/;
function Dr(e) {
  return e ? e.replace(zh, "") : "";
}
Re.normalizeId = Dr;
function qh(e, t, r) {
  return r = Dr(r), e.resolve(t, r);
}
Re.resolveUrl = qh;
const Gh = /^[a-z_][-a-z0-9._]*$/i;
function Kh(e, t) {
  if (typeof e == "boolean")
    return {};
  const { schemaId: r, uriResolver: n } = this.opts, s = Dr(e[r] || t), o = { "": s }, a = Zl(n, s, !1), i = {}, c = /* @__PURE__ */ new Set();
  return Lh(e, { allKeys: !0 }, (f, _, y, w) => {
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
        if (!Gh.test(N))
          throw new Error(`invalid anchor "${N}"`);
        p.call(this, `#${N}`);
      }
    }
  }), i;
  function d(f, _, y) {
    if (_ !== void 0 && !Mh(f, _))
      throw u(y);
  }
  function u(f) {
    return new Error(`reference "${f}" resolves to more than one schema`);
  }
}
Re.getSchemaRefs = Kh;
Object.defineProperty(at, "__esModule", { value: !0 });
at.getData = at.KeywordCxt = at.validateFunctionCode = void 0;
const tu = Vr, ac = we, Qo = St, us = we, Hh = Ss, dn = $t, Zs = Kt, B = ne(), x = Je, Bh = Re, bt = F, tn = wn;
function Wh(e) {
  if (su(e) && (ou(e), nu(e))) {
    Yh(e);
    return;
  }
  ru(e, () => (0, tu.topBoolOrEmptySchema)(e));
}
at.validateFunctionCode = Wh;
function ru({ gen: e, validateName: t, schema: r, schemaEnv: n, opts: s }, o) {
  s.code.es5 ? e.func(t, (0, B._)`${x.default.data}, ${x.default.valCxt}`, n.$async, () => {
    e.code((0, B._)`"use strict"; ${ic(r, s)}`), Xh(e, s), e.code(o);
  }) : e.func(t, (0, B._)`${x.default.data}, ${Jh(s)}`, n.$async, () => e.code(ic(r, s)).code(o));
}
function Jh(e) {
  return (0, B._)`{${x.default.instancePath}="", ${x.default.parentData}, ${x.default.parentDataProperty}, ${x.default.rootData}=${x.default.data}${e.dynamicRef ? (0, B._)`, ${x.default.dynamicAnchors}={}` : B.nil}}={}`;
}
function Xh(e, t) {
  e.if(x.default.valCxt, () => {
    e.var(x.default.instancePath, (0, B._)`${x.default.valCxt}.${x.default.instancePath}`), e.var(x.default.parentData, (0, B._)`${x.default.valCxt}.${x.default.parentData}`), e.var(x.default.parentDataProperty, (0, B._)`${x.default.valCxt}.${x.default.parentDataProperty}`), e.var(x.default.rootData, (0, B._)`${x.default.valCxt}.${x.default.rootData}`), t.dynamicRef && e.var(x.default.dynamicAnchors, (0, B._)`${x.default.valCxt}.${x.default.dynamicAnchors}`);
  }, () => {
    e.var(x.default.instancePath, (0, B._)`""`), e.var(x.default.parentData, (0, B._)`undefined`), e.var(x.default.parentDataProperty, (0, B._)`undefined`), e.var(x.default.rootData, x.default.data), t.dynamicRef && e.var(x.default.dynamicAnchors, (0, B._)`{}`);
  });
}
function Yh(e) {
  const { schema: t, opts: r, gen: n } = e;
  ru(e, () => {
    r.$comment && t.$comment && iu(e), tp(e), n.let(x.default.vErrors, null), n.let(x.default.errors, 0), r.unevaluated && xh(e), au(e), sp(e);
  });
}
function xh(e) {
  const { gen: t, validateName: r } = e;
  e.evaluated = t.const("evaluated", (0, B._)`${r}.evaluated`), t.if((0, B._)`${e.evaluated}.dynamicProps`, () => t.assign((0, B._)`${e.evaluated}.props`, (0, B._)`undefined`)), t.if((0, B._)`${e.evaluated}.dynamicItems`, () => t.assign((0, B._)`${e.evaluated}.items`, (0, B._)`undefined`));
}
function ic(e, t) {
  const r = typeof e == "object" && e[t.schemaId];
  return r && (t.code.source || t.code.process) ? (0, B._)`/*# sourceURL=${r} */` : B.nil;
}
function Qh(e, t) {
  if (su(e) && (ou(e), nu(e))) {
    Zh(e, t);
    return;
  }
  (0, tu.boolOrEmptySchema)(e, t);
}
function nu({ schema: e, self: t }) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (t.RULES.all[r])
      return !0;
  return !1;
}
function su(e) {
  return typeof e.schema != "boolean";
}
function Zh(e, t) {
  const { schema: r, gen: n, opts: s } = e;
  s.$comment && r.$comment && iu(e), rp(e), np(e);
  const o = n.const("_errs", x.default.errors);
  au(e, o), n.var(t, (0, B._)`${o} === ${x.default.errors}`);
}
function ou(e) {
  (0, bt.checkUnknownRules)(e), ep(e);
}
function au(e, t) {
  if (e.opts.jtd)
    return cc(e, [], !1, t);
  const r = (0, ac.getSchemaTypes)(e.schema), n = (0, ac.coerceAndCheckDataType)(e, r);
  cc(e, r, !n, t);
}
function ep(e) {
  const { schema: t, errSchemaPath: r, opts: n, self: s } = e;
  t.$ref && n.ignoreKeywordsWithRef && (0, bt.schemaHasRulesButRef)(t, s.RULES) && s.logger.warn(`$ref: keywords ignored in schema at path "${r}"`);
}
function tp(e) {
  const { schema: t, opts: r } = e;
  t.default !== void 0 && r.useDefaults && r.strictSchema && (0, bt.checkStrictMode)(e, "default is ignored in the schema root");
}
function rp(e) {
  const t = e.schema[e.opts.schemaId];
  t && (e.baseId = (0, Bh.resolveUrl)(e.opts.uriResolver, e.baseId, t));
}
function np(e) {
  if (e.schema.$async && !e.schemaEnv.$async)
    throw new Error("async schema in sync schema");
}
function iu({ gen: e, schemaEnv: t, schema: r, errSchemaPath: n, opts: s }) {
  const o = r.$comment;
  if (s.$comment === !0)
    e.code((0, B._)`${x.default.self}.logger.log(${o})`);
  else if (typeof s.$comment == "function") {
    const a = (0, B.str)`${n}/$comment`, i = e.scopeValue("root", { ref: t.root });
    e.code((0, B._)`${x.default.self}.opts.$comment(${o}, ${a}, ${i}.schema)`);
  }
}
function sp(e) {
  const { gen: t, schemaEnv: r, validateName: n, ValidationError: s, opts: o } = e;
  r.$async ? t.if((0, B._)`${x.default.errors} === 0`, () => t.return(x.default.data), () => t.throw((0, B._)`new ${s}(${x.default.vErrors})`)) : (t.assign((0, B._)`${n}.errors`, x.default.vErrors), o.unevaluated && op(e), t.return((0, B._)`${x.default.errors} === 0`));
}
function op({ gen: e, evaluated: t, props: r, items: n }) {
  r instanceof B.Name && e.assign((0, B._)`${t}.props`, r), n instanceof B.Name && e.assign((0, B._)`${t}.items`, n);
}
function cc(e, t, r, n) {
  const { gen: s, schema: o, data: a, allErrors: i, opts: c, self: d } = e, { RULES: u } = d;
  if (o.$ref && (c.ignoreKeywordsWithRef || !(0, bt.schemaHasRulesButRef)(o, u))) {
    s.block(() => uu(e, "$ref", u.all.$ref.definition));
    return;
  }
  c.jtd || ap(e, t), s.block(() => {
    for (const _ of u.rules)
      f(_);
    f(u.post);
  });
  function f(_) {
    (0, Qo.shouldUseGroup)(o, _) && (_.type ? (s.if((0, us.checkDataType)(_.type, a, c.strictNumbers)), lc(e, _), t.length === 1 && t[0] === _.type && r && (s.else(), (0, us.reportTypeError)(e)), s.endIf()) : lc(e, _), i || s.if((0, B._)`${x.default.errors} === ${n || 0}`));
  }
}
function lc(e, t) {
  const { gen: r, schema: n, opts: { useDefaults: s } } = e;
  s && (0, Hh.assignDefaults)(e, t.type), r.block(() => {
    for (const o of t.rules)
      (0, Qo.shouldUseRule)(n, o) && uu(e, o.keyword, o.definition, t.type);
  });
}
function ap(e, t) {
  e.schemaEnv.meta || !e.opts.strictTypes || (ip(e, t), e.opts.allowUnionTypes || cp(e, t), lp(e, e.dataTypes));
}
function ip(e, t) {
  if (t.length) {
    if (!e.dataTypes.length) {
      e.dataTypes = t;
      return;
    }
    t.forEach((r) => {
      cu(e.dataTypes, r) || Zo(e, `type "${r}" not allowed by context "${e.dataTypes.join(",")}"`);
    }), dp(e, t);
  }
}
function cp(e, t) {
  t.length > 1 && !(t.length === 2 && t.includes("null")) && Zo(e, "use allowUnionTypes to allow union type keyword");
}
function lp(e, t) {
  const r = e.self.RULES.all;
  for (const n in r) {
    const s = r[n];
    if (typeof s == "object" && (0, Qo.shouldUseRule)(e.schema, s)) {
      const { type: o } = s.definition;
      o.length && !o.some((a) => up(t, a)) && Zo(e, `missing type "${o.join(",")}" for keyword "${n}"`);
    }
  }
}
function up(e, t) {
  return e.includes(t) || t === "number" && e.includes("integer");
}
function cu(e, t) {
  return e.includes(t) || t === "integer" && e.includes("number");
}
function dp(e, t) {
  const r = [];
  for (const n of e.dataTypes)
    cu(t, n) ? r.push(n) : t.includes("integer") && n === "number" && r.push("integer");
  e.dataTypes = r;
}
function Zo(e, t) {
  const r = e.schemaEnv.baseId + e.errSchemaPath;
  t += ` at "${r}" (strictTypes)`, (0, bt.checkStrictMode)(e, t, e.opts.strictTypes);
}
let lu = class {
  constructor(t, r, n) {
    if ((0, dn.validateKeywordUsage)(t, r, n), this.gen = t.gen, this.allErrors = t.allErrors, this.keyword = n, this.data = t.data, this.schema = t.schema[n], this.$data = r.$data && t.opts.$data && this.schema && this.schema.$data, this.schemaValue = (0, bt.schemaRefOrVal)(t, this.schema, n, this.$data), this.schemaType = r.schemaType, this.parentSchema = t.schema, this.params = {}, this.it = t, this.def = r, this.$data)
      this.schemaCode = t.gen.const("vSchema", du(this.$data, t));
    else if (this.schemaCode = this.schemaValue, !(0, dn.validSchemaType)(this.schema, r.schemaType, r.allowUndefined))
      throw new Error(`${n} value must be ${JSON.stringify(r.schemaType)}`);
    ("code" in r ? r.trackErrors : r.errors !== !1) && (this.errsCount = t.gen.const("_errs", x.default.errors));
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
        return (0, B._)`${(0, us.checkDataTypes)(c, r, o.opts.strictNumbers, us.DataType.Wrong)}`;
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
    const n = (0, Zs.getSubschema)(this.it, t);
    (0, Zs.extendSubschemaData)(n, this.it, t), (0, Zs.extendSubschemaMode)(n, t);
    const s = { ...this.it, ...n, items: void 0, props: void 0 };
    return Qh(s, r), s;
  }
  mergeEvaluated(t, r) {
    const { it: n, gen: s } = this;
    n.opts.unevaluated && (n.props !== !0 && t.props !== void 0 && (n.props = bt.mergeEvaluated.props(s, t.props, n.props, r)), n.items !== !0 && t.items !== void 0 && (n.items = bt.mergeEvaluated.items(s, t.items, n.items, r)));
  }
  mergeValidEvaluated(t, r) {
    const { it: n, gen: s } = this;
    if (n.opts.unevaluated && (n.props !== !0 || n.items !== !0))
      return s.if(r, () => this.mergeEvaluated(t, B.Name)), !0;
  }
};
at.KeywordCxt = lu;
function uu(e, t, r, n) {
  const s = new lu(e, r, t);
  "code" in r ? r.code(s, n) : s.$data && r.validate ? (0, dn.funcKeywordCode)(s, r) : "macro" in r ? (0, dn.macroKeywordCode)(s, r) : (r.compile || r.validate) && (0, dn.funcKeywordCode)(s, r);
}
const fp = /^\/(?:[^~]|~0|~1)*$/, hp = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
function du(e, { dataLevel: t, dataNames: r, dataPathArr: n }) {
  let s, o;
  if (e === "")
    return x.default.rootData;
  if (e[0] === "/") {
    if (!fp.test(e))
      throw new Error(`Invalid JSON-pointer: ${e}`);
    s = e, o = x.default.rootData;
  } else {
    const d = hp.exec(e);
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
    d && (o = (0, B._)`${o}${(0, B.getProperty)((0, bt.unescapeJsonPointer)(d))}`, a = (0, B._)`${a} && ${o}`);
  return a;
  function c(d, u) {
    return `Cannot access ${d} ${u} levels up, current level is ${t}`;
  }
}
at.getData = du;
var jn = {}, uc;
function ea() {
  if (uc) return jn;
  uc = 1, Object.defineProperty(jn, "__esModule", { value: !0 });
  class e extends Error {
    constructor(r) {
      super("validation failed"), this.errors = r, this.ajv = this.validation = !0;
    }
  }
  return jn.default = e, jn;
}
var Gr = {};
Object.defineProperty(Gr, "__esModule", { value: !0 });
const eo = Re;
let pp = class extends Error {
  constructor(t, r, n, s) {
    super(s || `can't resolve reference ${n} from id ${r}`), this.missingRef = (0, eo.resolveUrl)(t, r, n), this.missingSchema = (0, eo.normalizeId)((0, eo.getFullPath)(t, this.missingRef));
  }
};
Gr.default = pp;
var Ve = {};
Object.defineProperty(Ve, "__esModule", { value: !0 });
Ve.resolveSchema = Ve.getCompilingSchema = Ve.resolveRef = Ve.compileSchema = Ve.SchemaEnv = void 0;
const Ze = ne(), mp = ea(), cr = Je, st = Re, dc = F, yp = at;
let Ps = class {
  constructor(t) {
    var r;
    this.refs = {}, this.dynamicAnchors = {};
    let n;
    typeof t.schema == "object" && (n = t.schema), this.schema = t.schema, this.schemaId = t.schemaId, this.root = t.root || this, this.baseId = (r = t.baseId) !== null && r !== void 0 ? r : (0, st.normalizeId)(n == null ? void 0 : n[t.schemaId || "$id"]), this.schemaPath = t.schemaPath, this.localRefs = t.localRefs, this.meta = t.meta, this.$async = n == null ? void 0 : n.$async, this.refs = {};
  }
};
Ve.SchemaEnv = Ps;
function ta(e) {
  const t = fu.call(this, e);
  if (t)
    return t;
  const r = (0, st.getFullPath)(this.opts.uriResolver, e.root.baseId), { es5: n, lines: s } = this.opts.code, { ownProperties: o } = this.opts, a = new Ze.CodeGen(this.scope, { es5: n, lines: s, ownProperties: o });
  let i;
  e.$async && (i = a.scopeValue("Error", {
    ref: mp.default,
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
    this._compilations.add(e), (0, yp.validateFunctionCode)(d), a.optimize(this.opts.code.optimize);
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
Ve.compileSchema = ta;
function $p(e, t, r) {
  var n;
  r = (0, st.resolveUrl)(this.opts.uriResolver, t, r);
  const s = e.refs[r];
  if (s)
    return s;
  let o = vp.call(this, e, r);
  if (o === void 0) {
    const a = (n = e.localRefs) === null || n === void 0 ? void 0 : n[r], { schemaId: i } = this.opts;
    a && (o = new Ps({ schema: a, schemaId: i, root: e, baseId: t }));
  }
  if (o !== void 0)
    return e.refs[r] = gp.call(this, o);
}
Ve.resolveRef = $p;
function gp(e) {
  return (0, st.inlineRef)(e.schema, this.opts.inlineRefs) ? e.schema : e.validate ? e : ta.call(this, e);
}
function fu(e) {
  for (const t of this._compilations)
    if (_p(t, e))
      return t;
}
Ve.getCompilingSchema = fu;
function _p(e, t) {
  return e.schema === t.schema && e.root === t.root && e.baseId === t.baseId;
}
function vp(e, t) {
  let r;
  for (; typeof (r = this.refs[t]) == "string"; )
    t = r;
  return r || this.schemas[t] || Ns.call(this, e, t);
}
function Ns(e, t) {
  const r = this.opts.uriResolver.parse(t), n = (0, st._getFullPath)(this.opts.uriResolver, r);
  let s = (0, st.getFullPath)(this.opts.uriResolver, e.baseId, void 0);
  if (Object.keys(e.schema).length > 0 && n === s)
    return to.call(this, r, e);
  const o = (0, st.normalizeId)(n), a = this.refs[o] || this.schemas[o];
  if (typeof a == "string") {
    const i = Ns.call(this, e, a);
    return typeof (i == null ? void 0 : i.schema) != "object" ? void 0 : to.call(this, r, i);
  }
  if (typeof (a == null ? void 0 : a.schema) == "object") {
    if (a.validate || ta.call(this, a), o === (0, st.normalizeId)(t)) {
      const { schema: i } = a, { schemaId: c } = this.opts, d = i[c];
      return d && (s = (0, st.resolveUrl)(this.opts.uriResolver, s, d)), new Ps({ schema: i, schemaId: c, root: e, baseId: s });
    }
    return to.call(this, r, a);
  }
}
Ve.resolveSchema = Ns;
const Ep = /* @__PURE__ */ new Set([
  "properties",
  "patternProperties",
  "enum",
  "dependencies",
  "definitions"
]);
function to(e, { baseId: t, schema: r, root: n }) {
  var s;
  if (((s = e.fragment) === null || s === void 0 ? void 0 : s[0]) !== "/")
    return;
  for (const i of e.fragment.slice(1).split("/")) {
    if (typeof r == "boolean")
      return;
    const c = r[(0, dc.unescapeFragment)(i)];
    if (c === void 0)
      return;
    r = c;
    const d = typeof r == "object" && r[this.opts.schemaId];
    !Ep.has(i) && d && (t = (0, st.resolveUrl)(this.opts.uriResolver, t, d));
  }
  let o;
  if (typeof r != "boolean" && r.$ref && !(0, dc.schemaHasRulesButRef)(r, this.RULES)) {
    const i = (0, st.resolveUrl)(this.opts.uriResolver, t, r.$ref);
    o = Ns.call(this, n, i);
  }
  const { schemaId: a } = this.opts;
  if (o = o || new Ps({ schema: r, schemaId: a, root: n, baseId: t }), o.schema !== o.root.schema)
    return o;
}
const wp = "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#", Sp = "Meta-schema for $data reference (JSON AnySchema extension proposal)", bp = "object", Pp = [
  "$data"
], Np = {
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
}, Rp = !1, Tp = {
  $id: wp,
  description: Sp,
  type: bp,
  required: Pp,
  properties: Np,
  additionalProperties: Rp
};
var ra = {}, Rs = { exports: {} };
const Op = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu), hu = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
function pu(e) {
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
const Ip = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
function fc(e) {
  return e.length = 0, !0;
}
function jp(e, t, r) {
  if (e.length) {
    const n = pu(e);
    if (n !== "")
      t.push(n);
    else
      return r.error = !0, !1;
    e.length = 0;
  }
  return !0;
}
function Ap(e) {
  let t = 0;
  const r = { error: !1, address: "", zone: "" }, n = [], s = [];
  let o = !1, a = !1, i = jp;
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
        i = fc;
      } else {
        s.push(d);
        continue;
      }
  }
  return s.length && (i === fc ? r.zone = s.join("") : a ? n.push(s.join("")) : n.push(pu(s))), r.address = n.join(""), r;
}
function mu(e) {
  if (Cp(e, ":") < 2)
    return { host: e, isIPV6: !1 };
  const t = Ap(e);
  if (t.error)
    return { host: e, isIPV6: !1 };
  {
    let r = t.address, n = t.address;
    return t.zone && (r += "%" + t.zone, n += "%25" + t.zone), { host: r, isIPV6: !0, escapedHost: n };
  }
}
function Cp(e, t) {
  let r = 0;
  for (let n = 0; n < e.length; n++)
    e[n] === t && r++;
  return r;
}
function kp(e) {
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
function Dp(e, t) {
  const r = t !== !0 ? escape : unescape;
  return e.scheme !== void 0 && (e.scheme = r(e.scheme)), e.userinfo !== void 0 && (e.userinfo = r(e.userinfo)), e.host !== void 0 && (e.host = r(e.host)), e.path !== void 0 && (e.path = r(e.path)), e.query !== void 0 && (e.query = r(e.query)), e.fragment !== void 0 && (e.fragment = r(e.fragment)), e;
}
function Mp(e) {
  const t = [];
  if (e.userinfo !== void 0 && (t.push(e.userinfo), t.push("@")), e.host !== void 0) {
    let r = unescape(e.host);
    if (!hu(r)) {
      const n = mu(r);
      n.isIPV6 === !0 ? r = `[${n.escapedHost}]` : r = e.host;
    }
    t.push(r);
  }
  return (typeof e.port == "number" || typeof e.port == "string") && (t.push(":"), t.push(String(e.port))), t.length ? t.join("") : void 0;
}
var yu = {
  nonSimpleDomain: Ip,
  recomposeAuthority: Mp,
  normalizeComponentEncoding: Dp,
  removeDotSegments: kp,
  isIPv4: hu,
  isUUID: Op,
  normalizeIPv6: mu
};
const { isUUID: Lp } = yu, Fp = /([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-.:;=@]|%[\da-f]{2})+)/iu;
function $u(e) {
  return e.secure === !0 ? !0 : e.secure === !1 ? !1 : e.scheme ? e.scheme.length === 3 && (e.scheme[0] === "w" || e.scheme[0] === "W") && (e.scheme[1] === "s" || e.scheme[1] === "S") && (e.scheme[2] === "s" || e.scheme[2] === "S") : !1;
}
function gu(e) {
  return e.host || (e.error = e.error || "HTTP URIs must have a host."), e;
}
function _u(e) {
  const t = String(e.scheme).toLowerCase() === "https";
  return (e.port === (t ? 443 : 80) || e.port === "") && (e.port = void 0), e.path || (e.path = "/"), e;
}
function Vp(e) {
  return e.secure = $u(e), e.resourceName = (e.path || "/") + (e.query ? "?" + e.query : ""), e.path = void 0, e.query = void 0, e;
}
function Up(e) {
  if ((e.port === ($u(e) ? 443 : 80) || e.port === "") && (e.port = void 0), typeof e.secure == "boolean" && (e.scheme = e.secure ? "wss" : "ws", e.secure = void 0), e.resourceName) {
    const [t, r] = e.resourceName.split("?");
    e.path = t && t !== "/" ? t : void 0, e.query = r, e.resourceName = void 0;
  }
  return e.fragment = void 0, e;
}
function zp(e, t) {
  if (!e.path)
    return e.error = "URN can not be parsed", e;
  const r = e.path.match(Fp);
  if (r) {
    const n = t.scheme || e.scheme || "urn";
    e.nid = r[1].toLowerCase(), e.nss = r[2];
    const s = `${n}:${t.nid || e.nid}`, o = na(s);
    e.path = void 0, o && (e = o.parse(e, t));
  } else
    e.error = e.error || "URN can not be parsed.";
  return e;
}
function qp(e, t) {
  if (e.nid === void 0)
    throw new Error("URN without nid cannot be serialized");
  const r = t.scheme || e.scheme || "urn", n = e.nid.toLowerCase(), s = `${r}:${t.nid || n}`, o = na(s);
  o && (e = o.serialize(e, t));
  const a = e, i = e.nss;
  return a.path = `${n || t.nid}:${i}`, t.skipEscape = !0, a;
}
function Gp(e, t) {
  const r = e;
  return r.uuid = r.nss, r.nss = void 0, !t.tolerant && (!r.uuid || !Lp(r.uuid)) && (r.error = r.error || "UUID is not valid."), r;
}
function Kp(e) {
  const t = e;
  return t.nss = (e.uuid || "").toLowerCase(), t;
}
const vu = (
  /** @type {SchemeHandler} */
  {
    scheme: "http",
    domainHost: !0,
    parse: gu,
    serialize: _u
  }
), Hp = (
  /** @type {SchemeHandler} */
  {
    scheme: "https",
    domainHost: vu.domainHost,
    parse: gu,
    serialize: _u
  }
), es = (
  /** @type {SchemeHandler} */
  {
    scheme: "ws",
    domainHost: !0,
    parse: Vp,
    serialize: Up
  }
), Bp = (
  /** @type {SchemeHandler} */
  {
    scheme: "wss",
    domainHost: es.domainHost,
    parse: es.parse,
    serialize: es.serialize
  }
), Wp = (
  /** @type {SchemeHandler} */
  {
    scheme: "urn",
    parse: zp,
    serialize: qp,
    skipNormalize: !0
  }
), Jp = (
  /** @type {SchemeHandler} */
  {
    scheme: "urn:uuid",
    parse: Gp,
    serialize: Kp,
    skipNormalize: !0
  }
), ds = (
  /** @type {Record<SchemeName, SchemeHandler>} */
  {
    http: vu,
    https: Hp,
    ws: es,
    wss: Bp,
    urn: Wp,
    "urn:uuid": Jp
  }
);
Object.setPrototypeOf(ds, null);
function na(e) {
  return e && (ds[
    /** @type {SchemeName} */
    e
  ] || ds[
    /** @type {SchemeName} */
    e.toLowerCase()
  ]) || void 0;
}
var Xp = {
  SCHEMES: ds,
  getSchemeHandler: na
};
const { normalizeIPv6: Yp, removeDotSegments: an, recomposeAuthority: xp, normalizeComponentEncoding: An, isIPv4: Qp, nonSimpleDomain: Zp } = yu, { SCHEMES: em, getSchemeHandler: Eu } = Xp;
function tm(e, t) {
  return typeof e == "string" ? e = /** @type {T} */
  gt(Rt(e, t), t) : typeof e == "object" && (e = /** @type {T} */
  Rt(gt(e, t), t)), e;
}
function rm(e, t, r) {
  const n = r ? Object.assign({ scheme: "null" }, r) : { scheme: "null" }, s = wu(Rt(e, n), Rt(t, n), n, !0);
  return n.skipEscape = !0, gt(s, n);
}
function wu(e, t, r, n) {
  const s = {};
  return n || (e = Rt(gt(e, r), r), t = Rt(gt(t, r), r)), r = r || {}, !r.tolerant && t.scheme ? (s.scheme = t.scheme, s.userinfo = t.userinfo, s.host = t.host, s.port = t.port, s.path = an(t.path || ""), s.query = t.query) : (t.userinfo !== void 0 || t.host !== void 0 || t.port !== void 0 ? (s.userinfo = t.userinfo, s.host = t.host, s.port = t.port, s.path = an(t.path || ""), s.query = t.query) : (t.path ? (t.path[0] === "/" ? s.path = an(t.path) : ((e.userinfo !== void 0 || e.host !== void 0 || e.port !== void 0) && !e.path ? s.path = "/" + t.path : e.path ? s.path = e.path.slice(0, e.path.lastIndexOf("/") + 1) + t.path : s.path = t.path, s.path = an(s.path)), s.query = t.query) : (s.path = e.path, t.query !== void 0 ? s.query = t.query : s.query = e.query), s.userinfo = e.userinfo, s.host = e.host, s.port = e.port), s.scheme = e.scheme), s.fragment = t.fragment, s;
}
function nm(e, t, r) {
  return typeof e == "string" ? (e = unescape(e), e = gt(An(Rt(e, r), !0), { ...r, skipEscape: !0 })) : typeof e == "object" && (e = gt(An(e, !0), { ...r, skipEscape: !0 })), typeof t == "string" ? (t = unescape(t), t = gt(An(Rt(t, r), !0), { ...r, skipEscape: !0 })) : typeof t == "object" && (t = gt(An(t, !0), { ...r, skipEscape: !0 })), e.toLowerCase() === t.toLowerCase();
}
function gt(e, t) {
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
  }, n = Object.assign({}, t), s = [], o = Eu(n.scheme || r.scheme);
  o && o.serialize && o.serialize(r, n), r.path !== void 0 && (n.skipEscape ? r.path = unescape(r.path) : (r.path = escape(r.path), r.scheme !== void 0 && (r.path = r.path.split("%3A").join(":")))), n.reference !== "suffix" && r.scheme && s.push(r.scheme, ":");
  const a = xp(r);
  if (a !== void 0 && (n.reference !== "suffix" && s.push("//"), s.push(a), r.path && r.path[0] !== "/" && s.push("/")), r.path !== void 0) {
    let i = r.path;
    !n.absolutePath && (!o || !o.absolutePath) && (i = an(i)), a === void 0 && i[0] === "/" && i[1] === "/" && (i = "/%2F" + i.slice(2)), s.push(i);
  }
  return r.query !== void 0 && s.push("?", r.query), r.fragment !== void 0 && s.push("#", r.fragment), s.join("");
}
const sm = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
function Rt(e, t) {
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
  const o = e.match(sm);
  if (o) {
    if (n.scheme = o[1], n.userinfo = o[3], n.host = o[4], n.port = parseInt(o[5], 10), n.path = o[6] || "", n.query = o[7], n.fragment = o[8], isNaN(n.port) && (n.port = o[5]), n.host)
      if (Qp(n.host) === !1) {
        const c = Yp(n.host);
        n.host = c.host.toLowerCase(), s = c.isIPV6;
      } else
        s = !0;
    n.scheme === void 0 && n.userinfo === void 0 && n.host === void 0 && n.port === void 0 && n.query === void 0 && !n.path ? n.reference = "same-document" : n.scheme === void 0 ? n.reference = "relative" : n.fragment === void 0 ? n.reference = "absolute" : n.reference = "uri", r.reference && r.reference !== "suffix" && r.reference !== n.reference && (n.error = n.error || "URI is not a " + r.reference + " reference.");
    const a = Eu(r.scheme || n.scheme);
    if (!r.unicodeSupport && (!a || !a.unicodeSupport) && n.host && (r.domainHost || a && a.domainHost) && s === !1 && Zp(n.host))
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
const sa = {
  SCHEMES: em,
  normalize: tm,
  resolve: rm,
  resolveComponent: wu,
  equal: nm,
  serialize: gt,
  parse: Rt
};
Rs.exports = sa;
Rs.exports.default = sa;
Rs.exports.fastUri = sa;
var Su = Rs.exports;
Object.defineProperty(ra, "__esModule", { value: !0 });
const bu = Su;
bu.code = 'require("ajv/dist/runtime/uri").default';
ra.default = bu;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.CodeGen = e.Name = e.nil = e.stringify = e.str = e._ = e.KeywordCxt = void 0;
  var t = at;
  Object.defineProperty(e, "KeywordCxt", { enumerable: !0, get: function() {
    return t.KeywordCxt;
  } });
  var r = ne();
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
  const n = ea(), s = Gr, o = Er, a = Ve, i = ne(), c = Re, d = we, u = F, f = Tp, _ = ra, y = (P, m) => new RegExp(P, m);
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
    var m, S, v, l, h, b, I, j, H, K, ce, He, Bt, Wt, Jt, Xt, Yt, xt, Qt, Zt, er, tr, rr, nr, sr;
    const Qe = P.strict, or = (m = P.code) === null || m === void 0 ? void 0 : m.optimize, Qr = or === !0 || or === void 0 ? 1 : or || 0, Zr = (v = (S = P.code) === null || S === void 0 ? void 0 : S.regExp) !== null && v !== void 0 ? v : y, qs = (l = P.uriResolver) !== null && l !== void 0 ? l : _.default;
    return {
      strictSchema: (b = (h = P.strictSchema) !== null && h !== void 0 ? h : Qe) !== null && b !== void 0 ? b : !0,
      strictNumbers: (j = (I = P.strictNumbers) !== null && I !== void 0 ? I : Qe) !== null && j !== void 0 ? j : !0,
      strictTypes: (K = (H = P.strictTypes) !== null && H !== void 0 ? H : Qe) !== null && K !== void 0 ? K : "log",
      strictTuples: (He = (ce = P.strictTuples) !== null && ce !== void 0 ? ce : Qe) !== null && He !== void 0 ? He : "log",
      strictRequired: (Wt = (Bt = P.strictRequired) !== null && Bt !== void 0 ? Bt : Qe) !== null && Wt !== void 0 ? Wt : !1,
      code: P.code ? { ...P.code, optimize: Qr, regExp: Zr } : { optimize: Qr, regExp: Zr },
      loopRequired: (Jt = P.loopRequired) !== null && Jt !== void 0 ? Jt : E,
      loopEnum: (Xt = P.loopEnum) !== null && Xt !== void 0 ? Xt : E,
      meta: (Yt = P.meta) !== null && Yt !== void 0 ? Yt : !0,
      messages: (xt = P.messages) !== null && xt !== void 0 ? xt : !0,
      inlineRefs: (Qt = P.inlineRefs) !== null && Qt !== void 0 ? Qt : !0,
      schemaId: (Zt = P.schemaId) !== null && Zt !== void 0 ? Zt : "$id",
      addUsedSchema: (er = P.addUsedSchema) !== null && er !== void 0 ? er : !0,
      validateSchema: (tr = P.validateSchema) !== null && tr !== void 0 ? tr : !0,
      validateFormats: (rr = P.validateFormats) !== null && rr !== void 0 ? rr : !0,
      unicodeRegExp: (nr = P.unicodeRegExp) !== null && nr !== void 0 ? nr : !0,
      int32range: (sr = P.int32range) !== null && sr !== void 0 ? sr : !0,
      uriResolver: qs
    };
  }
  class R {
    constructor(m = {}) {
      this.schemas = {}, this.refs = {}, this.formats = {}, this._compilations = /* @__PURE__ */ new Set(), this._loading = {}, this._cache = /* @__PURE__ */ new Map(), m = this.opts = { ...m, ...N(m) };
      const { es5: S, lines: v } = this.opts.code;
      this.scope = new i.ValueScope({ scope: {}, prefixes: g, es5: S, lines: v }), this.logger = q(m.logger);
      const l = m.validateFormats;
      m.validateFormats = !1, this.RULES = (0, o.getRules)(), T.call(this, $, m, "NOT SUPPORTED"), T.call(this, p, m, "DEPRECATED", "warn"), this._metaOpts = ye.call(this), m.formats && le.call(this), this._addVocabularies(), this._addDefaultMetaSchema(), m.keywords && ue.call(this, m.keywords), typeof m.meta == "object" && this.addMetaSchema(m.meta), k.call(this), m.validateFormats = l;
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
      async function l(K, ce) {
        await h.call(this, K.$schema);
        const He = this._addSchema(K, ce);
        return He.validate || b.call(this, He);
      }
      async function h(K) {
        K && !this.getSchema(K) && await l.call(this, { $ref: K }, !0);
      }
      async function b(K) {
        try {
          return this._compileSchemaEnv(K);
        } catch (ce) {
          if (!(ce instanceof s.default))
            throw ce;
          return I.call(this, ce), await j.call(this, ce.missingSchema), b.call(this, K);
        }
      }
      function I({ missingSchema: K, missingRef: ce }) {
        if (this.refs[K])
          throw new Error(`AnySchema ${K} is loaded but ${ce} cannot be resolved`);
      }
      async function j(K) {
        const ce = await H.call(this, K);
        this.refs[K] || await h.call(this, ce.$schema), this.refs[K] || this.addSchema(ce, K, S);
      }
      async function H(K) {
        const ce = this._loading[K];
        if (ce)
          return ce;
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
  function le() {
    for (const P in this.opts.formats) {
      const m = this.opts.formats[P];
      m && this.addFormat(P, m);
    }
  }
  function ue(P) {
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
  function ye() {
    const P = { ...this.opts };
    for (const m of w)
      delete P[m];
    return P;
  }
  const L = { log() {
  }, warn() {
  }, error() {
  } };
  function q(P) {
    if (P === !1)
      return L;
    if (P === void 0)
      return console;
    if (P.log && P.warn && P.error)
      return P;
    throw new Error("logger must implement log, warn and error methods");
  }
  const ie = /^[a-z_$][a-z0-9_$:-]*$/i;
  function O(P, m) {
    const { RULES: S } = this;
    if ((0, u.eachItem)(P, (v) => {
      if (S.keywords[v])
        throw new Error(`Keyword ${v} is already defined`);
      if (!ie.test(v))
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
})(Dl);
var oa = {}, aa = {}, ia = {};
Object.defineProperty(ia, "__esModule", { value: !0 });
const om = {
  keyword: "id",
  code() {
    throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
  }
};
ia.default = om;
var Tt = {};
Object.defineProperty(Tt, "__esModule", { value: !0 });
Tt.callRef = Tt.getValidate = void 0;
const am = Gr, hc = oe, qe = ne(), Pr = Je, pc = Ve, Cn = F, im = {
  keyword: "$ref",
  schemaType: "string",
  code(e) {
    const { gen: t, schema: r, it: n } = e, { baseId: s, schemaEnv: o, validateName: a, opts: i, self: c } = n, { root: d } = o;
    if ((r === "#" || r === "#/") && s === d.baseId)
      return f();
    const u = pc.resolveRef.call(c, d, s, r);
    if (u === void 0)
      throw new am.default(n.opts.uriResolver, s, r);
    if (u instanceof pc.SchemaEnv)
      return _(u);
    return y(u);
    function f() {
      if (o === d)
        return ts(e, a, o, o.$async);
      const w = t.scopeValue("root", { ref: d });
      return ts(e, (0, qe._)`${w}.validate`, d, d.$async);
    }
    function _(w) {
      const g = Pu(e, w);
      ts(e, g, w, w.$async);
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
function Pu(e, t) {
  const { gen: r } = e;
  return t.validate ? r.scopeValue("validate", { ref: t.validate }) : (0, qe._)`${r.scopeValue("wrapper", { ref: t })}.validate`;
}
Tt.getValidate = Pu;
function ts(e, t, r, n) {
  const { gen: s, it: o } = e, { allErrors: a, schemaEnv: i, opts: c } = o, d = c.passContext ? Pr.default.this : qe.nil;
  n ? u() : f();
  function u() {
    if (!i.$async)
      throw new Error("async schema referenced by sync schema");
    const w = s.let("valid");
    s.try(() => {
      s.code((0, qe._)`await ${(0, hc.callValidateCode)(e, t, d)}`), y(t), a || s.assign(w, !0);
    }, (g) => {
      s.if((0, qe._)`!(${g} instanceof ${o.ValidationError})`, () => s.throw(g)), _(g), a || s.assign(w, !1);
    }), e.ok(w);
  }
  function f() {
    e.result((0, hc.callValidateCode)(e, t, d), () => y(t), () => _(t));
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
        $.props !== void 0 && (o.props = Cn.mergeEvaluated.props(s, $.props, o.props));
      else {
        const p = s.var("props", (0, qe._)`${w}.evaluated.props`);
        o.props = Cn.mergeEvaluated.props(s, p, o.props, qe.Name);
      }
    if (o.items !== !0)
      if ($ && !$.dynamicItems)
        $.items !== void 0 && (o.items = Cn.mergeEvaluated.items(s, $.items, o.items));
      else {
        const p = s.var("items", (0, qe._)`${w}.evaluated.items`);
        o.items = Cn.mergeEvaluated.items(s, p, o.items, qe.Name);
      }
  }
}
Tt.callRef = ts;
Tt.default = im;
Object.defineProperty(aa, "__esModule", { value: !0 });
const cm = ia, lm = Tt, um = [
  "$schema",
  "$id",
  "$defs",
  "$vocabulary",
  { keyword: "$comment" },
  "definitions",
  cm.default,
  lm.default
];
aa.default = um;
var ca = {}, la = {};
Object.defineProperty(la, "__esModule", { value: !0 });
const fs = ne(), Ct = fs.operators, hs = {
  maximum: { okStr: "<=", ok: Ct.LTE, fail: Ct.GT },
  minimum: { okStr: ">=", ok: Ct.GTE, fail: Ct.LT },
  exclusiveMaximum: { okStr: "<", ok: Ct.LT, fail: Ct.GTE },
  exclusiveMinimum: { okStr: ">", ok: Ct.GT, fail: Ct.LTE }
}, dm = {
  message: ({ keyword: e, schemaCode: t }) => (0, fs.str)`must be ${hs[e].okStr} ${t}`,
  params: ({ keyword: e, schemaCode: t }) => (0, fs._)`{comparison: ${hs[e].okStr}, limit: ${t}}`
}, fm = {
  keyword: Object.keys(hs),
  type: "number",
  schemaType: "number",
  $data: !0,
  error: dm,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e;
    e.fail$data((0, fs._)`${r} ${hs[t].fail} ${n} || isNaN(${r})`);
  }
};
la.default = fm;
var ua = {};
Object.defineProperty(ua, "__esModule", { value: !0 });
const fn = ne(), hm = {
  message: ({ schemaCode: e }) => (0, fn.str)`must be multiple of ${e}`,
  params: ({ schemaCode: e }) => (0, fn._)`{multipleOf: ${e}}`
}, pm = {
  keyword: "multipleOf",
  type: "number",
  schemaType: "number",
  $data: !0,
  error: hm,
  code(e) {
    const { gen: t, data: r, schemaCode: n, it: s } = e, o = s.opts.multipleOfPrecision, a = t.let("res"), i = o ? (0, fn._)`Math.abs(Math.round(${a}) - ${a}) > 1e-${o}` : (0, fn._)`${a} !== parseInt(${a})`;
    e.fail$data((0, fn._)`(${n} === 0 || (${a} = ${r}/${n}, ${i}))`);
  }
};
ua.default = pm;
var da = {}, fa = {};
Object.defineProperty(fa, "__esModule", { value: !0 });
function Nu(e) {
  const t = e.length;
  let r = 0, n = 0, s;
  for (; n < t; )
    r++, s = e.charCodeAt(n++), s >= 55296 && s <= 56319 && n < t && (s = e.charCodeAt(n), (s & 64512) === 56320 && n++);
  return r;
}
fa.default = Nu;
Nu.code = 'require("ajv/dist/runtime/ucs2length").default';
Object.defineProperty(da, "__esModule", { value: !0 });
const fr = ne(), mm = F, ym = fa, $m = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxLength" ? "more" : "fewer";
    return (0, fr.str)`must NOT have ${r} than ${t} characters`;
  },
  params: ({ schemaCode: e }) => (0, fr._)`{limit: ${e}}`
}, gm = {
  keyword: ["maxLength", "minLength"],
  type: "string",
  schemaType: "number",
  $data: !0,
  error: $m,
  code(e) {
    const { keyword: t, data: r, schemaCode: n, it: s } = e, o = t === "maxLength" ? fr.operators.GT : fr.operators.LT, a = s.opts.unicode === !1 ? (0, fr._)`${r}.length` : (0, fr._)`${(0, mm.useFunc)(e.gen, ym.default)}(${r})`;
    e.fail$data((0, fr._)`${a} ${o} ${n}`);
  }
};
da.default = gm;
var ha = {};
Object.defineProperty(ha, "__esModule", { value: !0 });
const _m = oe, ps = ne(), vm = {
  message: ({ schemaCode: e }) => (0, ps.str)`must match pattern "${e}"`,
  params: ({ schemaCode: e }) => (0, ps._)`{pattern: ${e}}`
}, Em = {
  keyword: "pattern",
  type: "string",
  schemaType: "string",
  $data: !0,
  error: vm,
  code(e) {
    const { data: t, $data: r, schema: n, schemaCode: s, it: o } = e, a = o.opts.unicodeRegExp ? "u" : "", i = r ? (0, ps._)`(new RegExp(${s}, ${a}))` : (0, _m.usePattern)(e, n);
    e.fail$data((0, ps._)`!${i}.test(${t})`);
  }
};
ha.default = Em;
var pa = {};
Object.defineProperty(pa, "__esModule", { value: !0 });
const hn = ne(), wm = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxProperties" ? "more" : "fewer";
    return (0, hn.str)`must NOT have ${r} than ${t} properties`;
  },
  params: ({ schemaCode: e }) => (0, hn._)`{limit: ${e}}`
}, Sm = {
  keyword: ["maxProperties", "minProperties"],
  type: "object",
  schemaType: "number",
  $data: !0,
  error: wm,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e, s = t === "maxProperties" ? hn.operators.GT : hn.operators.LT;
    e.fail$data((0, hn._)`Object.keys(${r}).length ${s} ${n}`);
  }
};
pa.default = Sm;
var ma = {};
Object.defineProperty(ma, "__esModule", { value: !0 });
const rn = oe, pn = ne(), bm = F, Pm = {
  message: ({ params: { missingProperty: e } }) => (0, pn.str)`must have required property '${e}'`,
  params: ({ params: { missingProperty: e } }) => (0, pn._)`{missingProperty: ${e}}`
}, Nm = {
  keyword: "required",
  type: "object",
  schemaType: "array",
  $data: !0,
  error: Pm,
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
          (0, bm.checkStrictMode)(a, p, a.opts.strictRequired);
        }
    }
    function d() {
      if (c || o)
        e.block$data(pn.nil, f);
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
        t.assign(w, (0, rn.propertyInData)(t, s, y, i.ownProperties)), t.if((0, pn.not)(w), () => {
          e.error(), t.break();
        });
      }, pn.nil);
    }
  }
};
ma.default = Nm;
var ya = {};
Object.defineProperty(ya, "__esModule", { value: !0 });
const mn = ne(), Rm = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxItems" ? "more" : "fewer";
    return (0, mn.str)`must NOT have ${r} than ${t} items`;
  },
  params: ({ schemaCode: e }) => (0, mn._)`{limit: ${e}}`
}, Tm = {
  keyword: ["maxItems", "minItems"],
  type: "array",
  schemaType: "number",
  $data: !0,
  error: Rm,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e, s = t === "maxItems" ? mn.operators.GT : mn.operators.LT;
    e.fail$data((0, mn._)`${r}.length ${s} ${n}`);
  }
};
ya.default = Tm;
var $a = {}, Sn = {};
Object.defineProperty(Sn, "__esModule", { value: !0 });
const Ru = bs;
Ru.code = 'require("ajv/dist/runtime/equal").default';
Sn.default = Ru;
Object.defineProperty($a, "__esModule", { value: !0 });
const ro = we, Pe = ne(), Om = F, Im = Sn, jm = {
  message: ({ params: { i: e, j: t } }) => (0, Pe.str)`must NOT have duplicate items (items ## ${t} and ${e} are identical)`,
  params: ({ params: { i: e, j: t } }) => (0, Pe._)`{i: ${e}, j: ${t}}`
}, Am = {
  keyword: "uniqueItems",
  type: "array",
  schemaType: "boolean",
  $data: !0,
  error: jm,
  code(e) {
    const { gen: t, data: r, $data: n, schema: s, parentSchema: o, schemaCode: a, it: i } = e;
    if (!n && !s)
      return;
    const c = t.let("valid"), d = o.items ? (0, ro.getSchemaTypes)(o.items) : [];
    e.block$data(c, u, (0, Pe._)`${a} === false`), e.ok(c);
    function u() {
      const w = t.let("i", (0, Pe._)`${r}.length`), g = t.let("j");
      e.setParams({ i: w, j: g }), t.assign(c, !0), t.if((0, Pe._)`${w} > 1`, () => (f() ? _ : y)(w, g));
    }
    function f() {
      return d.length > 0 && !d.some((w) => w === "object" || w === "array");
    }
    function _(w, g) {
      const $ = t.name("item"), p = (0, ro.checkDataTypes)(d, $, i.opts.strictNumbers, ro.DataType.Wrong), E = t.const("indices", (0, Pe._)`{}`);
      t.for((0, Pe._)`;${w}--;`, () => {
        t.let($, (0, Pe._)`${r}[${w}]`), t.if(p, (0, Pe._)`continue`), d.length > 1 && t.if((0, Pe._)`typeof ${$} == "string"`, (0, Pe._)`${$} += "_"`), t.if((0, Pe._)`typeof ${E}[${$}] == "number"`, () => {
          t.assign(g, (0, Pe._)`${E}[${$}]`), e.error(), t.assign(c, !1).break();
        }).code((0, Pe._)`${E}[${$}] = ${w}`);
      });
    }
    function y(w, g) {
      const $ = (0, Om.useFunc)(t, Im.default), p = t.name("outer");
      t.label(p).for((0, Pe._)`;${w}--;`, () => t.for((0, Pe._)`${g} = ${w}; ${g}--;`, () => t.if((0, Pe._)`${$}(${r}[${w}], ${r}[${g}])`, () => {
        e.error(), t.assign(c, !1).break(p);
      })));
    }
  }
};
$a.default = Am;
var ga = {};
Object.defineProperty(ga, "__esModule", { value: !0 });
const No = ne(), Cm = F, km = Sn, Dm = {
  message: "must be equal to constant",
  params: ({ schemaCode: e }) => (0, No._)`{allowedValue: ${e}}`
}, Mm = {
  keyword: "const",
  $data: !0,
  error: Dm,
  code(e) {
    const { gen: t, data: r, $data: n, schemaCode: s, schema: o } = e;
    n || o && typeof o == "object" ? e.fail$data((0, No._)`!${(0, Cm.useFunc)(t, km.default)}(${r}, ${s})`) : e.fail((0, No._)`${o} !== ${r}`);
  }
};
ga.default = Mm;
var _a = {};
Object.defineProperty(_a, "__esModule", { value: !0 });
const cn = ne(), Lm = F, Fm = Sn, Vm = {
  message: "must be equal to one of the allowed values",
  params: ({ schemaCode: e }) => (0, cn._)`{allowedValues: ${e}}`
}, Um = {
  keyword: "enum",
  schemaType: "array",
  $data: !0,
  error: Vm,
  code(e) {
    const { gen: t, data: r, $data: n, schema: s, schemaCode: o, it: a } = e;
    if (!n && s.length === 0)
      throw new Error("enum must have non-empty array");
    const i = s.length >= a.opts.loopEnum;
    let c;
    const d = () => c ?? (c = (0, Lm.useFunc)(t, Fm.default));
    let u;
    if (i || n)
      u = t.let("valid"), e.block$data(u, f);
    else {
      if (!Array.isArray(s))
        throw new Error("ajv implementation error");
      const y = t.const("vSchema", o);
      u = (0, cn.or)(...s.map((w, g) => _(y, g)));
    }
    e.pass(u);
    function f() {
      t.assign(u, !1), t.forOf("v", o, (y) => t.if((0, cn._)`${d()}(${r}, ${y})`, () => t.assign(u, !0).break()));
    }
    function _(y, w) {
      const g = s[w];
      return typeof g == "object" && g !== null ? (0, cn._)`${d()}(${r}, ${y}[${w}])` : (0, cn._)`${r} === ${g}`;
    }
  }
};
_a.default = Um;
Object.defineProperty(ca, "__esModule", { value: !0 });
const zm = la, qm = ua, Gm = da, Km = ha, Hm = pa, Bm = ma, Wm = ya, Jm = $a, Xm = ga, Ym = _a, xm = [
  // number
  zm.default,
  qm.default,
  // string
  Gm.default,
  Km.default,
  // object
  Hm.default,
  Bm.default,
  // array
  Wm.default,
  Jm.default,
  // any
  { keyword: "type", schemaType: ["string", "array"] },
  { keyword: "nullable", schemaType: "boolean" },
  Xm.default,
  Ym.default
];
ca.default = xm;
var va = {}, Kr = {};
Object.defineProperty(Kr, "__esModule", { value: !0 });
Kr.validateAdditionalItems = void 0;
const hr = ne(), Ro = F, Qm = {
  message: ({ params: { len: e } }) => (0, hr.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, hr._)`{limit: ${e}}`
}, Zm = {
  keyword: "additionalItems",
  type: "array",
  schemaType: ["boolean", "object"],
  before: "uniqueItems",
  error: Qm,
  code(e) {
    const { parentSchema: t, it: r } = e, { items: n } = t;
    if (!Array.isArray(n)) {
      (0, Ro.checkStrictMode)(r, '"additionalItems" is ignored when "items" is not an array of schemas');
      return;
    }
    Tu(e, n);
  }
};
function Tu(e, t) {
  const { gen: r, schema: n, data: s, keyword: o, it: a } = e;
  a.items = !0;
  const i = r.const("len", (0, hr._)`${s}.length`);
  if (n === !1)
    e.setParams({ len: t.length }), e.pass((0, hr._)`${i} <= ${t.length}`);
  else if (typeof n == "object" && !(0, Ro.alwaysValidSchema)(a, n)) {
    const d = r.var("valid", (0, hr._)`${i} <= ${t.length}`);
    r.if((0, hr.not)(d), () => c(d)), e.ok(d);
  }
  function c(d) {
    r.forRange("i", t.length, i, (u) => {
      e.subschema({ keyword: o, dataProp: u, dataPropType: Ro.Type.Num }, d), a.allErrors || r.if((0, hr.not)(d), () => r.break());
    });
  }
}
Kr.validateAdditionalItems = Tu;
Kr.default = Zm;
var Ea = {}, Hr = {};
Object.defineProperty(Hr, "__esModule", { value: !0 });
Hr.validateTuple = void 0;
const mc = ne(), rs = F, ey = oe, ty = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "array", "boolean"],
  before: "uniqueItems",
  code(e) {
    const { schema: t, it: r } = e;
    if (Array.isArray(t))
      return Ou(e, "additionalItems", t);
    r.items = !0, !(0, rs.alwaysValidSchema)(r, t) && e.ok((0, ey.validateArray)(e));
  }
};
function Ou(e, t, r = e.schema) {
  const { gen: n, parentSchema: s, data: o, keyword: a, it: i } = e;
  u(s), i.opts.unevaluated && r.length && i.items !== !0 && (i.items = rs.mergeEvaluated.items(n, r.length, i.items));
  const c = n.name("valid"), d = n.const("len", (0, mc._)`${o}.length`);
  r.forEach((f, _) => {
    (0, rs.alwaysValidSchema)(i, f) || (n.if((0, mc._)`${d} > ${_}`, () => e.subschema({
      keyword: a,
      schemaProp: _,
      dataProp: _
    }, c)), e.ok(c));
  });
  function u(f) {
    const { opts: _, errSchemaPath: y } = i, w = r.length, g = w === f.minItems && (w === f.maxItems || f[t] === !1);
    if (_.strictTuples && !g) {
      const $ = `"${a}" is ${w}-tuple, but minItems or maxItems/${t} are not specified or different at path "${y}"`;
      (0, rs.checkStrictMode)(i, $, _.strictTuples);
    }
  }
}
Hr.validateTuple = Ou;
Hr.default = ty;
Object.defineProperty(Ea, "__esModule", { value: !0 });
const ry = Hr, ny = {
  keyword: "prefixItems",
  type: "array",
  schemaType: ["array"],
  before: "uniqueItems",
  code: (e) => (0, ry.validateTuple)(e, "items")
};
Ea.default = ny;
var wa = {};
Object.defineProperty(wa, "__esModule", { value: !0 });
const yc = ne(), sy = F, oy = oe, ay = Kr, iy = {
  message: ({ params: { len: e } }) => (0, yc.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, yc._)`{limit: ${e}}`
}, cy = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  error: iy,
  code(e) {
    const { schema: t, parentSchema: r, it: n } = e, { prefixItems: s } = r;
    n.items = !0, !(0, sy.alwaysValidSchema)(n, t) && (s ? (0, ay.validateAdditionalItems)(e, s) : e.ok((0, oy.validateArray)(e)));
  }
};
wa.default = cy;
var Sa = {};
Object.defineProperty(Sa, "__esModule", { value: !0 });
const Ye = ne(), kn = F, ly = {
  message: ({ params: { min: e, max: t } }) => t === void 0 ? (0, Ye.str)`must contain at least ${e} valid item(s)` : (0, Ye.str)`must contain at least ${e} and no more than ${t} valid item(s)`,
  params: ({ params: { min: e, max: t } }) => t === void 0 ? (0, Ye._)`{minContains: ${e}}` : (0, Ye._)`{minContains: ${e}, maxContains: ${t}}`
}, uy = {
  keyword: "contains",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  trackErrors: !0,
  error: ly,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, it: o } = e;
    let a, i;
    const { minContains: c, maxContains: d } = n;
    o.opts.next ? (a = c === void 0 ? 1 : c, i = d) : a = 1;
    const u = t.const("len", (0, Ye._)`${s}.length`);
    if (e.setParams({ min: a, max: i }), i === void 0 && a === 0) {
      (0, kn.checkStrictMode)(o, '"minContains" == 0 without "maxContains": "contains" keyword ignored');
      return;
    }
    if (i !== void 0 && a > i) {
      (0, kn.checkStrictMode)(o, '"minContains" > "maxContains" is always invalid'), e.fail();
      return;
    }
    if ((0, kn.alwaysValidSchema)(o, r)) {
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
          dataPropType: kn.Type.Num,
          compositeRule: !0
        }, g), $();
      });
    }
    function w(g) {
      t.code((0, Ye._)`${g}++`), i === void 0 ? t.if((0, Ye._)`${g} >= ${a}`, () => t.assign(f, !0).break()) : (t.if((0, Ye._)`${g} > ${i}`, () => t.assign(f, !1).break()), a === 1 ? t.assign(f, !0) : t.if((0, Ye._)`${g} >= ${a}`, () => t.assign(f, !0)));
    }
  }
};
Sa.default = uy;
var Ts = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.validateSchemaDeps = e.validatePropertyDeps = e.error = void 0;
  const t = ne(), r = F, n = oe;
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
})(Ts);
var ba = {};
Object.defineProperty(ba, "__esModule", { value: !0 });
const Iu = ne(), dy = F, fy = {
  message: "property name must be valid",
  params: ({ params: e }) => (0, Iu._)`{propertyName: ${e.propertyName}}`
}, hy = {
  keyword: "propertyNames",
  type: "object",
  schemaType: ["object", "boolean"],
  error: fy,
  code(e) {
    const { gen: t, schema: r, data: n, it: s } = e;
    if ((0, dy.alwaysValidSchema)(s, r))
      return;
    const o = t.name("valid");
    t.forIn("key", n, (a) => {
      e.setParams({ propertyName: a }), e.subschema({
        keyword: "propertyNames",
        data: a,
        dataTypes: ["string"],
        propertyName: a,
        compositeRule: !0
      }, o), t.if((0, Iu.not)(o), () => {
        e.error(!0), s.allErrors || t.break();
      });
    }), e.ok(o);
  }
};
ba.default = hy;
var Os = {};
Object.defineProperty(Os, "__esModule", { value: !0 });
const Dn = oe, tt = ne(), py = Je, Mn = F, my = {
  message: "must NOT have additional properties",
  params: ({ params: e }) => (0, tt._)`{additionalProperty: ${e.additionalProperty}}`
}, yy = {
  keyword: "additionalProperties",
  type: ["object"],
  schemaType: ["boolean", "object"],
  allowUndefined: !0,
  trackErrors: !0,
  error: my,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, errsCount: o, it: a } = e;
    if (!o)
      throw new Error("ajv implementation error");
    const { allErrors: i, opts: c } = a;
    if (a.props = !0, c.removeAdditional !== "all" && (0, Mn.alwaysValidSchema)(a, r))
      return;
    const d = (0, Dn.allSchemaProperties)(n.properties), u = (0, Dn.allSchemaProperties)(n.patternProperties);
    f(), e.ok((0, tt._)`${o} === ${py.default.errors}`);
    function f() {
      t.forIn("key", s, ($) => {
        !d.length && !u.length ? w($) : t.if(_($), () => w($));
      });
    }
    function _($) {
      let p;
      if (d.length > 8) {
        const E = (0, Mn.schemaRefOrVal)(a, n.properties, "properties");
        p = (0, Dn.isOwnProperty)(t, E, $);
      } else d.length ? p = (0, tt.or)(...d.map((E) => (0, tt._)`${$} === ${E}`)) : p = tt.nil;
      return u.length && (p = (0, tt.or)(p, ...u.map((E) => (0, tt._)`${(0, Dn.usePattern)(e, E)}.test(${$})`))), (0, tt.not)(p);
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
      if (typeof r == "object" && !(0, Mn.alwaysValidSchema)(a, r)) {
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
        dataPropType: Mn.Type.Str
      };
      E === !1 && Object.assign(N, {
        compositeRule: !0,
        createErrors: !1,
        allErrors: !1
      }), e.subschema(N, p);
    }
  }
};
Os.default = yy;
var Pa = {};
Object.defineProperty(Pa, "__esModule", { value: !0 });
const $y = at, $c = oe, no = F, gc = Os, gy = {
  keyword: "properties",
  type: "object",
  schemaType: "object",
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, it: o } = e;
    o.opts.removeAdditional === "all" && n.additionalProperties === void 0 && gc.default.code(new $y.KeywordCxt(o, gc.default, "additionalProperties"));
    const a = (0, $c.allSchemaProperties)(r);
    for (const f of a)
      o.definedProperties.add(f);
    o.opts.unevaluated && a.length && o.props !== !0 && (o.props = no.mergeEvaluated.props(t, (0, no.toHash)(a), o.props));
    const i = a.filter((f) => !(0, no.alwaysValidSchema)(o, r[f]));
    if (i.length === 0)
      return;
    const c = t.name("valid");
    for (const f of i)
      d(f) ? u(f) : (t.if((0, $c.propertyInData)(t, s, f, o.opts.ownProperties)), u(f), o.allErrors || t.else().var(c, !0), t.endIf()), e.it.definedProperties.add(f), e.ok(c);
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
Pa.default = gy;
var Na = {};
Object.defineProperty(Na, "__esModule", { value: !0 });
const _c = oe, Ln = ne(), vc = F, Ec = F, _y = {
  keyword: "patternProperties",
  type: "object",
  schemaType: "object",
  code(e) {
    const { gen: t, schema: r, data: n, parentSchema: s, it: o } = e, { opts: a } = o, i = (0, _c.allSchemaProperties)(r), c = i.filter((g) => (0, vc.alwaysValidSchema)(o, r[g]));
    if (i.length === 0 || c.length === i.length && (!o.opts.unevaluated || o.props === !0))
      return;
    const d = a.strictSchema && !a.allowMatchingProperties && s.properties, u = t.name("valid");
    o.props !== !0 && !(o.props instanceof Ln.Name) && (o.props = (0, Ec.evaluatedPropsToName)(t, o.props));
    const { props: f } = o;
    _();
    function _() {
      for (const g of i)
        d && y(g), o.allErrors ? w(g) : (t.var(u, !0), w(g), t.if(u));
    }
    function y(g) {
      for (const $ in d)
        new RegExp(g).test($) && (0, vc.checkStrictMode)(o, `property ${$} matches pattern ${g} (use allowMatchingProperties)`);
    }
    function w(g) {
      t.forIn("key", n, ($) => {
        t.if((0, Ln._)`${(0, _c.usePattern)(e, g)}.test(${$})`, () => {
          const p = c.includes(g);
          p || e.subschema({
            keyword: "patternProperties",
            schemaProp: g,
            dataProp: $,
            dataPropType: Ec.Type.Str
          }, u), o.opts.unevaluated && f !== !0 ? t.assign((0, Ln._)`${f}[${$}]`, !0) : !p && !o.allErrors && t.if((0, Ln.not)(u), () => t.break());
        });
      });
    }
  }
};
Na.default = _y;
var Ra = {};
Object.defineProperty(Ra, "__esModule", { value: !0 });
const vy = F, Ey = {
  keyword: "not",
  schemaType: ["object", "boolean"],
  trackErrors: !0,
  code(e) {
    const { gen: t, schema: r, it: n } = e;
    if ((0, vy.alwaysValidSchema)(n, r)) {
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
Ra.default = Ey;
var Ta = {};
Object.defineProperty(Ta, "__esModule", { value: !0 });
const wy = oe, Sy = {
  keyword: "anyOf",
  schemaType: "array",
  trackErrors: !0,
  code: wy.validateUnion,
  error: { message: "must match a schema in anyOf" }
};
Ta.default = Sy;
var Oa = {};
Object.defineProperty(Oa, "__esModule", { value: !0 });
const ns = ne(), by = F, Py = {
  message: "must match exactly one schema in oneOf",
  params: ({ params: e }) => (0, ns._)`{passingSchemas: ${e.passing}}`
}, Ny = {
  keyword: "oneOf",
  schemaType: "array",
  trackErrors: !0,
  error: Py,
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
        (0, by.alwaysValidSchema)(s, u) ? t.var(c, !0) : _ = e.subschema({
          keyword: "oneOf",
          schemaProp: f,
          compositeRule: !0
        }, c), f > 0 && t.if((0, ns._)`${c} && ${a}`).assign(a, !1).assign(i, (0, ns._)`[${i}, ${f}]`).else(), t.if(c, () => {
          t.assign(a, !0), t.assign(i, f), _ && e.mergeEvaluated(_, ns.Name);
        });
      });
    }
  }
};
Oa.default = Ny;
var Ia = {};
Object.defineProperty(Ia, "__esModule", { value: !0 });
const Ry = F, Ty = {
  keyword: "allOf",
  schemaType: "array",
  code(e) {
    const { gen: t, schema: r, it: n } = e;
    if (!Array.isArray(r))
      throw new Error("ajv implementation error");
    const s = t.name("valid");
    r.forEach((o, a) => {
      if ((0, Ry.alwaysValidSchema)(n, o))
        return;
      const i = e.subschema({ keyword: "allOf", schemaProp: a }, s);
      e.ok(s), e.mergeEvaluated(i);
    });
  }
};
Ia.default = Ty;
var ja = {};
Object.defineProperty(ja, "__esModule", { value: !0 });
const ms = ne(), ju = F, Oy = {
  message: ({ params: e }) => (0, ms.str)`must match "${e.ifClause}" schema`,
  params: ({ params: e }) => (0, ms._)`{failingKeyword: ${e.ifClause}}`
}, Iy = {
  keyword: "if",
  schemaType: ["object", "boolean"],
  trackErrors: !0,
  error: Oy,
  code(e) {
    const { gen: t, parentSchema: r, it: n } = e;
    r.then === void 0 && r.else === void 0 && (0, ju.checkStrictMode)(n, '"if" without "then" and "else" is ignored');
    const s = wc(n, "then"), o = wc(n, "else");
    if (!s && !o)
      return;
    const a = t.let("valid", !0), i = t.name("_valid");
    if (c(), e.reset(), s && o) {
      const u = t.let("ifClause");
      e.setParams({ ifClause: u }), t.if(i, d("then", u), d("else", u));
    } else s ? t.if(i, d("then")) : t.if((0, ms.not)(i), d("else"));
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
        t.assign(a, i), e.mergeValidEvaluated(_, a), f ? t.assign(f, (0, ms._)`${u}`) : e.setParams({ ifClause: u });
      };
    }
  }
};
function wc(e, t) {
  const r = e.schema[t];
  return r !== void 0 && !(0, ju.alwaysValidSchema)(e, r);
}
ja.default = Iy;
var Aa = {};
Object.defineProperty(Aa, "__esModule", { value: !0 });
const jy = F, Ay = {
  keyword: ["then", "else"],
  schemaType: ["object", "boolean"],
  code({ keyword: e, parentSchema: t, it: r }) {
    t.if === void 0 && (0, jy.checkStrictMode)(r, `"${e}" without "if" is ignored`);
  }
};
Aa.default = Ay;
Object.defineProperty(va, "__esModule", { value: !0 });
const Cy = Kr, ky = Ea, Dy = Hr, My = wa, Ly = Sa, Fy = Ts, Vy = ba, Uy = Os, zy = Pa, qy = Na, Gy = Ra, Ky = Ta, Hy = Oa, By = Ia, Wy = ja, Jy = Aa;
function Xy(e = !1) {
  const t = [
    // any
    Gy.default,
    Ky.default,
    Hy.default,
    By.default,
    Wy.default,
    Jy.default,
    // object
    Vy.default,
    Uy.default,
    Fy.default,
    zy.default,
    qy.default
  ];
  return e ? t.push(ky.default, My.default) : t.push(Cy.default, Dy.default), t.push(Ly.default), t;
}
va.default = Xy;
var Ca = {}, Br = {};
Object.defineProperty(Br, "__esModule", { value: !0 });
Br.dynamicAnchor = void 0;
const so = ne(), Yy = Je, Sc = Ve, xy = Tt, Qy = {
  keyword: "$dynamicAnchor",
  schemaType: "string",
  code: (e) => Au(e, e.schema)
};
function Au(e, t) {
  const { gen: r, it: n } = e;
  n.schemaEnv.root.dynamicAnchors[t] = !0;
  const s = (0, so._)`${Yy.default.dynamicAnchors}${(0, so.getProperty)(t)}`, o = n.errSchemaPath === "#" ? n.validateName : Zy(e);
  r.if((0, so._)`!${s}`, () => r.assign(s, o));
}
Br.dynamicAnchor = Au;
function Zy(e) {
  const { schemaEnv: t, schema: r, self: n } = e.it, { root: s, baseId: o, localRefs: a, meta: i } = t.root, { schemaId: c } = n.opts, d = new Sc.SchemaEnv({ schema: r, schemaId: c, root: s, baseId: o, localRefs: a, meta: i });
  return Sc.compileSchema.call(n, d), (0, xy.getValidate)(e, d);
}
Br.default = Qy;
var Wr = {};
Object.defineProperty(Wr, "__esModule", { value: !0 });
Wr.dynamicRef = void 0;
const bc = ne(), e$ = Je, Pc = Tt, t$ = {
  keyword: "$dynamicRef",
  schemaType: "string",
  code: (e) => Cu(e, e.schema)
};
function Cu(e, t) {
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
      const d = r.let("_v", (0, bc._)`${e$.default.dynamicAnchors}${(0, bc.getProperty)(o)}`);
      r.if(d, i(d, c), i(s.validateName, c));
    } else
      i(s.validateName, c)();
  }
  function i(c, d) {
    return d ? () => r.block(() => {
      (0, Pc.callRef)(e, c), r.let(d, !0);
    }) : () => (0, Pc.callRef)(e, c);
  }
}
Wr.dynamicRef = Cu;
Wr.default = t$;
var ka = {};
Object.defineProperty(ka, "__esModule", { value: !0 });
const r$ = Br, n$ = F, s$ = {
  keyword: "$recursiveAnchor",
  schemaType: "boolean",
  code(e) {
    e.schema ? (0, r$.dynamicAnchor)(e, "") : (0, n$.checkStrictMode)(e.it, "$recursiveAnchor: false is ignored");
  }
};
ka.default = s$;
var Da = {};
Object.defineProperty(Da, "__esModule", { value: !0 });
const o$ = Wr, a$ = {
  keyword: "$recursiveRef",
  schemaType: "string",
  code: (e) => (0, o$.dynamicRef)(e, e.schema)
};
Da.default = a$;
Object.defineProperty(Ca, "__esModule", { value: !0 });
const i$ = Br, c$ = Wr, l$ = ka, u$ = Da, d$ = [i$.default, c$.default, l$.default, u$.default];
Ca.default = d$;
var Ma = {}, La = {};
Object.defineProperty(La, "__esModule", { value: !0 });
const Nc = Ts, f$ = {
  keyword: "dependentRequired",
  type: "object",
  schemaType: "object",
  error: Nc.error,
  code: (e) => (0, Nc.validatePropertyDeps)(e)
};
La.default = f$;
var Fa = {};
Object.defineProperty(Fa, "__esModule", { value: !0 });
const h$ = Ts, p$ = {
  keyword: "dependentSchemas",
  type: "object",
  schemaType: "object",
  code: (e) => (0, h$.validateSchemaDeps)(e)
};
Fa.default = p$;
var Va = {};
Object.defineProperty(Va, "__esModule", { value: !0 });
const m$ = F, y$ = {
  keyword: ["maxContains", "minContains"],
  type: "array",
  schemaType: "number",
  code({ keyword: e, parentSchema: t, it: r }) {
    t.contains === void 0 && (0, m$.checkStrictMode)(r, `"${e}" without "contains" is ignored`);
  }
};
Va.default = y$;
Object.defineProperty(Ma, "__esModule", { value: !0 });
const $$ = La, g$ = Fa, _$ = Va, v$ = [$$.default, g$.default, _$.default];
Ma.default = v$;
var Ua = {}, za = {};
Object.defineProperty(za, "__esModule", { value: !0 });
const Ft = ne(), Rc = F, E$ = Je, w$ = {
  message: "must NOT have unevaluated properties",
  params: ({ params: e }) => (0, Ft._)`{unevaluatedProperty: ${e.unevaluatedProperty}}`
}, S$ = {
  keyword: "unevaluatedProperties",
  type: "object",
  schemaType: ["boolean", "object"],
  trackErrors: !0,
  error: w$,
  code(e) {
    const { gen: t, schema: r, data: n, errsCount: s, it: o } = e;
    if (!s)
      throw new Error("ajv implementation error");
    const { allErrors: a, props: i } = o;
    i instanceof Ft.Name ? t.if((0, Ft._)`${i} !== true`, () => t.forIn("key", n, (f) => t.if(d(i, f), () => c(f)))) : i !== !0 && t.forIn("key", n, (f) => i === void 0 ? c(f) : t.if(u(i, f), () => c(f))), o.props = !0, e.ok((0, Ft._)`${s} === ${E$.default.errors}`);
    function c(f) {
      if (r === !1) {
        e.setParams({ unevaluatedProperty: f }), e.error(), a || t.break();
        return;
      }
      if (!(0, Rc.alwaysValidSchema)(o, r)) {
        const _ = t.name("valid");
        e.subschema({
          keyword: "unevaluatedProperties",
          dataProp: f,
          dataPropType: Rc.Type.Str
        }, _), a || t.if((0, Ft.not)(_), () => t.break());
      }
    }
    function d(f, _) {
      return (0, Ft._)`!${f} || !${f}[${_}]`;
    }
    function u(f, _) {
      const y = [];
      for (const w in f)
        f[w] === !0 && y.push((0, Ft._)`${_} !== ${w}`);
      return (0, Ft.and)(...y);
    }
  }
};
za.default = S$;
var qa = {};
Object.defineProperty(qa, "__esModule", { value: !0 });
const pr = ne(), Tc = F, b$ = {
  message: ({ params: { len: e } }) => (0, pr.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, pr._)`{limit: ${e}}`
}, P$ = {
  keyword: "unevaluatedItems",
  type: "array",
  schemaType: ["boolean", "object"],
  error: b$,
  code(e) {
    const { gen: t, schema: r, data: n, it: s } = e, o = s.items || 0;
    if (o === !0)
      return;
    const a = t.const("len", (0, pr._)`${n}.length`);
    if (r === !1)
      e.setParams({ len: o }), e.fail((0, pr._)`${a} > ${o}`);
    else if (typeof r == "object" && !(0, Tc.alwaysValidSchema)(s, r)) {
      const c = t.var("valid", (0, pr._)`${a} <= ${o}`);
      t.if((0, pr.not)(c), () => i(c, o)), e.ok(c);
    }
    s.items = !0;
    function i(c, d) {
      t.forRange("i", d, a, (u) => {
        e.subschema({ keyword: "unevaluatedItems", dataProp: u, dataPropType: Tc.Type.Num }, c), s.allErrors || t.if((0, pr.not)(c), () => t.break());
      });
    }
  }
};
qa.default = P$;
Object.defineProperty(Ua, "__esModule", { value: !0 });
const N$ = za, R$ = qa, T$ = [N$.default, R$.default];
Ua.default = T$;
var Ga = {}, Ka = {};
Object.defineProperty(Ka, "__esModule", { value: !0 });
const ge = ne(), O$ = {
  message: ({ schemaCode: e }) => (0, ge.str)`must match format "${e}"`,
  params: ({ schemaCode: e }) => (0, ge._)`{format: ${e}}`
}, I$ = {
  keyword: "format",
  type: ["number", "string"],
  schemaType: "string",
  $data: !0,
  error: O$,
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
Ka.default = I$;
Object.defineProperty(Ga, "__esModule", { value: !0 });
const j$ = Ka, A$ = [j$.default];
Ga.default = A$;
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
Object.defineProperty(oa, "__esModule", { value: !0 });
const C$ = aa, k$ = ca, D$ = va, M$ = Ca, L$ = Ma, F$ = Ua, V$ = Ga, Oc = Ur, U$ = [
  M$.default,
  C$.default,
  k$.default,
  (0, D$.default)(!0),
  V$.default,
  Oc.metadataVocabulary,
  Oc.contentVocabulary,
  L$.default,
  F$.default
];
oa.default = U$;
var Ha = {}, Is = {};
Object.defineProperty(Is, "__esModule", { value: !0 });
Is.DiscrError = void 0;
var Ic;
(function(e) {
  e.Tag = "tag", e.Mapping = "mapping";
})(Ic || (Is.DiscrError = Ic = {}));
Object.defineProperty(Ha, "__esModule", { value: !0 });
const Or = ne(), To = Is, jc = Ve, z$ = Gr, q$ = F, G$ = {
  message: ({ params: { discrError: e, tagName: t } }) => e === To.DiscrError.Tag ? `tag "${t}" must be string` : `value of tag "${t}" must be in oneOf`,
  params: ({ params: { discrError: e, tag: t, tagName: r } }) => (0, Or._)`{error: ${e}, tag: ${r}, tagValue: ${t}}`
}, K$ = {
  keyword: "discriminator",
  type: "object",
  schemaType: "object",
  error: G$,
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
    const c = t.let("valid", !1), d = t.const("tag", (0, Or._)`${r}${(0, Or.getProperty)(i)}`);
    t.if((0, Or._)`typeof ${d} == "string"`, () => u(), () => e.error(!1, { discrError: To.DiscrError.Tag, tag: d, tagName: i })), e.ok(c);
    function u() {
      const y = _();
      t.if(!1);
      for (const w in y)
        t.elseIf((0, Or._)`${d} === ${w}`), t.assign(c, f(y[w]));
      t.else(), e.error(!1, { discrError: To.DiscrError.Mapping, tag: d, tagName: i }), t.endIf();
    }
    function f(y) {
      const w = t.name("valid"), g = e.subschema({ keyword: "oneOf", schemaProp: y }, w);
      return e.mergeEvaluated(g, Or.Name), w;
    }
    function _() {
      var y;
      const w = {}, g = p(s);
      let $ = !0;
      for (let R = 0; R < a.length; R++) {
        let T = a[R];
        if (T != null && T.$ref && !(0, q$.schemaHasRulesButRef)(T, o.self.RULES)) {
          const k = T.$ref;
          if (T = jc.resolveRef.call(o.self, o.schemaEnv.root, o.baseId, k), T instanceof jc.SchemaEnv && (T = T.schema), T === void 0)
            throw new z$.default(o.opts.uriResolver, o.baseId, k);
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
Ha.default = K$;
var Ba = {};
const H$ = "https://json-schema.org/draft/2020-12/schema", B$ = "https://json-schema.org/draft/2020-12/schema", W$ = {
  "https://json-schema.org/draft/2020-12/vocab/core": !0,
  "https://json-schema.org/draft/2020-12/vocab/applicator": !0,
  "https://json-schema.org/draft/2020-12/vocab/unevaluated": !0,
  "https://json-schema.org/draft/2020-12/vocab/validation": !0,
  "https://json-schema.org/draft/2020-12/vocab/meta-data": !0,
  "https://json-schema.org/draft/2020-12/vocab/format-annotation": !0,
  "https://json-schema.org/draft/2020-12/vocab/content": !0
}, J$ = "meta", X$ = "Core and Validation specifications meta-schema", Y$ = [
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
], x$ = [
  "object",
  "boolean"
], Q$ = "This meta-schema also defines keywords that have appeared in previous drafts in order to prevent incompatible extensions as they remain in common use.", Z$ = {
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
}, eg = {
  $schema: H$,
  $id: B$,
  $vocabulary: W$,
  $dynamicAnchor: J$,
  title: X$,
  allOf: Y$,
  type: x$,
  $comment: Q$,
  properties: Z$
}, tg = "https://json-schema.org/draft/2020-12/schema", rg = "https://json-schema.org/draft/2020-12/meta/applicator", ng = {
  "https://json-schema.org/draft/2020-12/vocab/applicator": !0
}, sg = "meta", og = "Applicator vocabulary meta-schema", ag = [
  "object",
  "boolean"
], ig = {
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
}, cg = {
  schemaArray: {
    type: "array",
    minItems: 1,
    items: {
      $dynamicRef: "#meta"
    }
  }
}, lg = {
  $schema: tg,
  $id: rg,
  $vocabulary: ng,
  $dynamicAnchor: sg,
  title: og,
  type: ag,
  properties: ig,
  $defs: cg
}, ug = "https://json-schema.org/draft/2020-12/schema", dg = "https://json-schema.org/draft/2020-12/meta/unevaluated", fg = {
  "https://json-schema.org/draft/2020-12/vocab/unevaluated": !0
}, hg = "meta", pg = "Unevaluated applicator vocabulary meta-schema", mg = [
  "object",
  "boolean"
], yg = {
  unevaluatedItems: {
    $dynamicRef: "#meta"
  },
  unevaluatedProperties: {
    $dynamicRef: "#meta"
  }
}, $g = {
  $schema: ug,
  $id: dg,
  $vocabulary: fg,
  $dynamicAnchor: hg,
  title: pg,
  type: mg,
  properties: yg
}, gg = "https://json-schema.org/draft/2020-12/schema", _g = "https://json-schema.org/draft/2020-12/meta/content", vg = {
  "https://json-schema.org/draft/2020-12/vocab/content": !0
}, Eg = "meta", wg = "Content vocabulary meta-schema", Sg = [
  "object",
  "boolean"
], bg = {
  contentEncoding: {
    type: "string"
  },
  contentMediaType: {
    type: "string"
  },
  contentSchema: {
    $dynamicRef: "#meta"
  }
}, Pg = {
  $schema: gg,
  $id: _g,
  $vocabulary: vg,
  $dynamicAnchor: Eg,
  title: wg,
  type: Sg,
  properties: bg
}, Ng = "https://json-schema.org/draft/2020-12/schema", Rg = "https://json-schema.org/draft/2020-12/meta/core", Tg = {
  "https://json-schema.org/draft/2020-12/vocab/core": !0
}, Og = "meta", Ig = "Core vocabulary meta-schema", jg = [
  "object",
  "boolean"
], Ag = {
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
}, Cg = {
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
}, kg = {
  $schema: Ng,
  $id: Rg,
  $vocabulary: Tg,
  $dynamicAnchor: Og,
  title: Ig,
  type: jg,
  properties: Ag,
  $defs: Cg
}, Dg = "https://json-schema.org/draft/2020-12/schema", Mg = "https://json-schema.org/draft/2020-12/meta/format-annotation", Lg = {
  "https://json-schema.org/draft/2020-12/vocab/format-annotation": !0
}, Fg = "meta", Vg = "Format vocabulary meta-schema for annotation results", Ug = [
  "object",
  "boolean"
], zg = {
  format: {
    type: "string"
  }
}, qg = {
  $schema: Dg,
  $id: Mg,
  $vocabulary: Lg,
  $dynamicAnchor: Fg,
  title: Vg,
  type: Ug,
  properties: zg
}, Gg = "https://json-schema.org/draft/2020-12/schema", Kg = "https://json-schema.org/draft/2020-12/meta/meta-data", Hg = {
  "https://json-schema.org/draft/2020-12/vocab/meta-data": !0
}, Bg = "meta", Wg = "Meta-data vocabulary meta-schema", Jg = [
  "object",
  "boolean"
], Xg = {
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
}, Yg = {
  $schema: Gg,
  $id: Kg,
  $vocabulary: Hg,
  $dynamicAnchor: Bg,
  title: Wg,
  type: Jg,
  properties: Xg
}, xg = "https://json-schema.org/draft/2020-12/schema", Qg = "https://json-schema.org/draft/2020-12/meta/validation", Zg = {
  "https://json-schema.org/draft/2020-12/vocab/validation": !0
}, e_ = "meta", t_ = "Validation vocabulary meta-schema", r_ = [
  "object",
  "boolean"
], n_ = {
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
}, s_ = {
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
}, o_ = {
  $schema: xg,
  $id: Qg,
  $vocabulary: Zg,
  $dynamicAnchor: e_,
  title: t_,
  type: r_,
  properties: n_,
  $defs: s_
};
Object.defineProperty(Ba, "__esModule", { value: !0 });
const a_ = eg, i_ = lg, c_ = $g, l_ = Pg, u_ = kg, d_ = qg, f_ = Yg, h_ = o_, p_ = ["/properties"];
function m_(e) {
  return [
    a_,
    i_,
    c_,
    l_,
    u_,
    t(this, d_),
    f_,
    t(this, h_)
  ].forEach((r) => this.addMetaSchema(r, void 0, !1)), this;
  function t(r, n) {
    return e ? r.$dataMetaSchema(n, p_) : n;
  }
}
Ba.default = m_;
(function(e, t) {
  Object.defineProperty(t, "__esModule", { value: !0 }), t.MissingRefError = t.ValidationError = t.CodeGen = t.Name = t.nil = t.stringify = t.str = t._ = t.KeywordCxt = t.Ajv2020 = void 0;
  const r = Dl, n = oa, s = Ha, o = Ba, a = "https://json-schema.org/draft/2020-12/schema";
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
  var c = at;
  Object.defineProperty(t, "KeywordCxt", { enumerable: !0, get: function() {
    return c.KeywordCxt;
  } });
  var d = ne();
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
  var u = ea();
  Object.defineProperty(t, "ValidationError", { enumerable: !0, get: function() {
    return u.default;
  } });
  var f = Gr;
  Object.defineProperty(t, "MissingRefError", { enumerable: !0, get: function() {
    return f.default;
  } });
})(wo, wo.exports);
var y_ = wo.exports, Oo = { exports: {} }, ku = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.formatNames = e.fastFormats = e.fullFormats = void 0;
  function t(L, q) {
    return { validate: L, compare: q };
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
    regex: ye,
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
    float: { type: "number", validate: le },
    // C-type double
    double: { type: "number", validate: le },
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
    const q = n.exec(L);
    if (!q)
      return !1;
    const ie = +q[1], O = +q[2], A = +q[3];
    return O >= 1 && O <= 12 && A >= 1 && A <= (O === 2 && r(ie) ? 29 : s[O]);
  }
  function a(L, q) {
    if (L && q)
      return L > q ? 1 : L < q ? -1 : 0;
  }
  const i = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
  function c(L) {
    return function(ie) {
      const O = i.exec(ie);
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
  function d(L, q) {
    if (!(L && q))
      return;
    const ie = (/* @__PURE__ */ new Date("2020-01-01T" + L)).valueOf(), O = (/* @__PURE__ */ new Date("2020-01-01T" + q)).valueOf();
    if (ie && O)
      return ie - O;
  }
  function u(L, q) {
    if (!(L && q))
      return;
    const ie = i.exec(L), O = i.exec(q);
    if (ie && O)
      return L = ie[1] + ie[2] + ie[3], q = O[1] + O[2] + O[3], L > q ? 1 : L < q ? -1 : 0;
  }
  const f = /t|\s/i;
  function _(L) {
    const q = c(L);
    return function(O) {
      const A = O.split(f);
      return A.length === 2 && o(A[0]) && q(A[1]);
    };
  }
  function y(L, q) {
    if (!(L && q))
      return;
    const ie = new Date(L).valueOf(), O = new Date(q).valueOf();
    if (ie && O)
      return ie - O;
  }
  function w(L, q) {
    if (!(L && q))
      return;
    const [ie, O] = L.split(f), [A, V] = q.split(f), D = a(ie, A);
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
  function le() {
    return !0;
  }
  const ue = /[^\\]\\Z/;
  function ye(L) {
    if (ue.test(L))
      return !1;
    try {
      return new RegExp(L), !0;
    } catch {
      return !1;
    }
  }
})(ku);
var Du = {}, Io = { exports: {} }, Mu = {}, it = {}, zr = {}, bn = {}, se = {}, En = {};
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
})(En);
var jo = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.ValueScope = e.ValueScopeName = e.Scope = e.varKinds = e.UsedValueState = void 0;
  const t = En;
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
})(jo);
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.or = e.and = e.not = e.CodeGen = e.operators = e.varKinds = e.ValueScopeName = e.ValueScope = e.Scope = e.Name = e.regexpCode = e.stringify = e.getProperty = e.nil = e.strConcat = e.str = e._ = void 0;
  const t = En, r = jo;
  var n = En;
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
  var s = jo;
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
      return ie(l, this.rhs);
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
      return this.nodes.reduce((l, h) => q(l, h.names), {});
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
      return ie(l, this.condition), this.else && q(l, this.else.names), l;
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
      return q(super.names, this.iteration.names);
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
      const l = ie(super.names, this.from);
      return ie(l, this.to);
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
      return q(super.names, this.iterable.names);
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
  class le extends w {
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
      return this.catch && q(l, this.catch.names), this.finally && q(l, this.finally.names), l;
    }
  }
  class ue extends w {
    constructor(l) {
      super(), this.error = l;
    }
    render(l) {
      return `catch(${this.error})` + super.render(l);
    }
  }
  ue.kind = "catch";
  class ye extends w {
    render(l) {
      return "finally" + super.render(l);
    }
  }
  ye.kind = "finally";
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
      const I = new le();
      if (this._blockNode(I), this.code(l), h) {
        const j = this.name("e");
        this._currNode = I.catch = new ue(j), h(j);
      }
      return b && (this._currNode = I.finally = new ye(), this.code(b)), this._endBlockNode(ue, ye);
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
  function q(v, l) {
    for (const h in l)
      v[h] = (v[h] || 0) + (l[h] || 0);
    return v;
  }
  function ie(v, l) {
    return l instanceof t._CodeOrName ? q(v, l.names) : v;
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
})(se);
var U = {};
Object.defineProperty(U, "__esModule", { value: !0 });
U.checkStrictMode = U.getErrorPath = U.Type = U.useFunc = U.setEvaluated = U.evaluatedPropsToName = U.mergeEvaluated = U.eachItem = U.unescapeJsonPointer = U.escapeJsonPointer = U.escapeFragment = U.unescapeFragment = U.schemaRefOrVal = U.schemaHasRulesButRef = U.schemaHasRules = U.checkUnknownRules = U.alwaysValidSchema = U.toHash = void 0;
const fe = se, $_ = En;
function g_(e) {
  const t = {};
  for (const r of e)
    t[r] = !0;
  return t;
}
U.toHash = g_;
function __(e, t) {
  return typeof t == "boolean" ? t : Object.keys(t).length === 0 ? !0 : (Lu(e, t), !Fu(t, e.self.RULES.all));
}
U.alwaysValidSchema = __;
function Lu(e, t = e.schema) {
  const { opts: r, self: n } = e;
  if (!r.strictSchema || typeof t == "boolean")
    return;
  const s = n.RULES.keywords;
  for (const o in t)
    s[o] || zu(e, `unknown keyword: "${o}"`);
}
U.checkUnknownRules = Lu;
function Fu(e, t) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (t[r])
      return !0;
  return !1;
}
U.schemaHasRules = Fu;
function v_(e, t) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (r !== "$ref" && t.all[r])
      return !0;
  return !1;
}
U.schemaHasRulesButRef = v_;
function E_({ topSchemaRef: e, schemaPath: t }, r, n, s) {
  if (!s) {
    if (typeof r == "number" || typeof r == "boolean")
      return r;
    if (typeof r == "string")
      return (0, fe._)`${r}`;
  }
  return (0, fe._)`${e}${t}${(0, fe.getProperty)(n)}`;
}
U.schemaRefOrVal = E_;
function w_(e) {
  return Vu(decodeURIComponent(e));
}
U.unescapeFragment = w_;
function S_(e) {
  return encodeURIComponent(Wa(e));
}
U.escapeFragment = S_;
function Wa(e) {
  return typeof e == "number" ? `${e}` : e.replace(/~/g, "~0").replace(/\//g, "~1");
}
U.escapeJsonPointer = Wa;
function Vu(e) {
  return e.replace(/~1/g, "/").replace(/~0/g, "~");
}
U.unescapeJsonPointer = Vu;
function b_(e, t) {
  if (Array.isArray(e))
    for (const r of e)
      t(r);
  else
    t(e);
}
U.eachItem = b_;
function Ac({ mergeNames: e, mergeToName: t, mergeValues: r, resultToName: n }) {
  return (s, o, a, i) => {
    const c = a === void 0 ? o : a instanceof fe.Name ? (o instanceof fe.Name ? e(s, o, a) : t(s, o, a), a) : o instanceof fe.Name ? (t(s, a, o), o) : r(o, a);
    return i === fe.Name && !(c instanceof fe.Name) ? n(s, c) : c;
  };
}
U.mergeEvaluated = {
  props: Ac({
    mergeNames: (e, t, r) => e.if((0, fe._)`${r} !== true && ${t} !== undefined`, () => {
      e.if((0, fe._)`${t} === true`, () => e.assign(r, !0), () => e.assign(r, (0, fe._)`${r} || {}`).code((0, fe._)`Object.assign(${r}, ${t})`));
    }),
    mergeToName: (e, t, r) => e.if((0, fe._)`${r} !== true`, () => {
      t === !0 ? e.assign(r, !0) : (e.assign(r, (0, fe._)`${r} || {}`), Ja(e, r, t));
    }),
    mergeValues: (e, t) => e === !0 ? !0 : { ...e, ...t },
    resultToName: Uu
  }),
  items: Ac({
    mergeNames: (e, t, r) => e.if((0, fe._)`${r} !== true && ${t} !== undefined`, () => e.assign(r, (0, fe._)`${t} === true ? true : ${r} > ${t} ? ${r} : ${t}`)),
    mergeToName: (e, t, r) => e.if((0, fe._)`${r} !== true`, () => e.assign(r, t === !0 ? !0 : (0, fe._)`${r} > ${t} ? ${r} : ${t}`)),
    mergeValues: (e, t) => e === !0 ? !0 : Math.max(e, t),
    resultToName: (e, t) => e.var("items", t)
  })
};
function Uu(e, t) {
  if (t === !0)
    return e.var("props", !0);
  const r = e.var("props", (0, fe._)`{}`);
  return t !== void 0 && Ja(e, r, t), r;
}
U.evaluatedPropsToName = Uu;
function Ja(e, t, r) {
  Object.keys(r).forEach((n) => e.assign((0, fe._)`${t}${(0, fe.getProperty)(n)}`, !0));
}
U.setEvaluated = Ja;
const Cc = {};
function P_(e, t) {
  return e.scopeValue("func", {
    ref: t,
    code: Cc[t.code] || (Cc[t.code] = new $_._Code(t.code))
  });
}
U.useFunc = P_;
var Ao;
(function(e) {
  e[e.Num = 0] = "Num", e[e.Str = 1] = "Str";
})(Ao || (U.Type = Ao = {}));
function N_(e, t, r) {
  if (e instanceof fe.Name) {
    const n = t === Ao.Num;
    return r ? n ? (0, fe._)`"[" + ${e} + "]"` : (0, fe._)`"['" + ${e} + "']"` : n ? (0, fe._)`"/" + ${e}` : (0, fe._)`"/" + ${e}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
  }
  return r ? (0, fe.getProperty)(e).toString() : "/" + Wa(e);
}
U.getErrorPath = N_;
function zu(e, t, r = e.opts.strictSchema) {
  if (r) {
    if (t = `strict mode: ${t}`, r === !0)
      throw new Error(t);
    e.self.logger.warn(t);
  }
}
U.checkStrictMode = zu;
var vt = {};
Object.defineProperty(vt, "__esModule", { value: !0 });
const Ae = se, R_ = {
  // validation function arguments
  data: new Ae.Name("data"),
  // data passed to validation function
  // args passed from referencing schema
  valCxt: new Ae.Name("valCxt"),
  // validation/data context - should not be used directly, it is destructured to the names below
  instancePath: new Ae.Name("instancePath"),
  parentData: new Ae.Name("parentData"),
  parentDataProperty: new Ae.Name("parentDataProperty"),
  rootData: new Ae.Name("rootData"),
  // root data - same as the data passed to the first/top validation function
  dynamicAnchors: new Ae.Name("dynamicAnchors"),
  // used to support recursiveRef and dynamicRef
  // function scoped variables
  vErrors: new Ae.Name("vErrors"),
  // null or array of validation errors
  errors: new Ae.Name("errors"),
  // counter of validation errors
  this: new Ae.Name("this"),
  // "globals"
  self: new Ae.Name("self"),
  scope: new Ae.Name("scope"),
  // JTD serialize/parse name for JSON string and position
  json: new Ae.Name("json"),
  jsonPos: new Ae.Name("jsonPos"),
  jsonLen: new Ae.Name("jsonLen"),
  jsonPart: new Ae.Name("jsonPart")
};
vt.default = R_;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.extendErrors = e.resetErrorsCount = e.reportExtraError = e.reportError = e.keyword$DataError = e.keywordError = void 0;
  const t = se, r = U, n = vt;
  e.keywordError = {
    message: ({ keyword: $ }) => (0, t.str)`must pass "${$}" keyword validation`
  }, e.keyword$DataError = {
    message: ({ keyword: $, schemaType: p }) => p ? (0, t.str)`"${$}" keyword must be ${p} ($data)` : (0, t.str)`"${$}" keyword is invalid ($data)`
  };
  function s($, p = e.keywordError, E, N) {
    const { it: R } = $, { gen: T, compositeRule: C, allErrors: k } = R, le = f($, p, E);
    N ?? (C || k) ? c(T, le) : d(R, (0, t._)`[${le}]`);
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
    const { keyword: R, data: T, schemaValue: C, it: k } = $, { opts: le, propertyName: ue, topSchemaRef: ye, schemaPath: L } = k;
    N.push([u.keyword, R], [u.params, typeof p == "function" ? p($) : p || (0, t._)`{}`]), le.messages && N.push([u.message, typeof E == "function" ? E($) : E]), le.verbose && N.push([u.schema, C], [u.parentSchema, (0, t._)`${ye}${L}`], [n.default.data, T]), ue && N.push([u.propertyName, ue]);
  }
})(bn);
Object.defineProperty(zr, "__esModule", { value: !0 });
zr.boolOrEmptySchema = zr.topBoolOrEmptySchema = void 0;
const T_ = bn, O_ = se, I_ = vt, j_ = {
  message: "boolean schema is false"
};
function A_(e) {
  const { gen: t, schema: r, validateName: n } = e;
  r === !1 ? qu(e, !1) : typeof r == "object" && r.$async === !0 ? t.return(I_.default.data) : (t.assign((0, O_._)`${n}.errors`, null), t.return(!0));
}
zr.topBoolOrEmptySchema = A_;
function C_(e, t) {
  const { gen: r, schema: n } = e;
  n === !1 ? (r.var(t, !1), qu(e)) : r.var(t, !0);
}
zr.boolOrEmptySchema = C_;
function qu(e, t) {
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
  (0, T_.reportError)(s, j_, void 0, t);
}
var Se = {}, wr = {};
Object.defineProperty(wr, "__esModule", { value: !0 });
wr.getRules = wr.isJSONType = void 0;
const k_ = ["string", "number", "integer", "boolean", "null", "object", "array"], D_ = new Set(k_);
function M_(e) {
  return typeof e == "string" && D_.has(e);
}
wr.isJSONType = M_;
function L_() {
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
wr.getRules = L_;
var Pt = {};
Object.defineProperty(Pt, "__esModule", { value: !0 });
Pt.shouldUseRule = Pt.shouldUseGroup = Pt.schemaHasRulesForType = void 0;
function F_({ schema: e, self: t }, r) {
  const n = t.RULES.types[r];
  return n && n !== !0 && Gu(e, n);
}
Pt.schemaHasRulesForType = F_;
function Gu(e, t) {
  return t.rules.some((r) => Ku(e, r));
}
Pt.shouldUseGroup = Gu;
function Ku(e, t) {
  var r;
  return e[t.keyword] !== void 0 || ((r = t.definition.implements) === null || r === void 0 ? void 0 : r.some((n) => e[n] !== void 0));
}
Pt.shouldUseRule = Ku;
Object.defineProperty(Se, "__esModule", { value: !0 });
Se.reportTypeError = Se.checkDataTypes = Se.checkDataType = Se.coerceAndCheckDataType = Se.getJSONTypes = Se.getSchemaTypes = Se.DataType = void 0;
const V_ = wr, U_ = Pt, z_ = bn, re = se, Hu = U;
var Mr;
(function(e) {
  e[e.Correct = 0] = "Correct", e[e.Wrong = 1] = "Wrong";
})(Mr || (Se.DataType = Mr = {}));
function q_(e) {
  const t = Bu(e.type);
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
Se.getSchemaTypes = q_;
function Bu(e) {
  const t = Array.isArray(e) ? e : e ? [e] : [];
  if (t.every(V_.isJSONType))
    return t;
  throw new Error("type must be JSONType or JSONType[]: " + t.join(","));
}
Se.getJSONTypes = Bu;
function G_(e, t) {
  const { gen: r, data: n, opts: s } = e, o = K_(t, s.coerceTypes), a = t.length > 0 && !(o.length === 0 && t.length === 1 && (0, U_.schemaHasRulesForType)(e, t[0]));
  if (a) {
    const i = Xa(t, n, s.strictNumbers, Mr.Wrong);
    r.if(i, () => {
      o.length ? H_(e, t, o) : Ya(e);
    });
  }
  return a;
}
Se.coerceAndCheckDataType = G_;
const Wu = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
function K_(e, t) {
  return t ? e.filter((r) => Wu.has(r) || t === "array" && r === "array") : [];
}
function H_(e, t, r) {
  const { gen: n, data: s, opts: o } = e, a = n.let("dataType", (0, re._)`typeof ${s}`), i = n.let("coerced", (0, re._)`undefined`);
  o.coerceTypes === "array" && n.if((0, re._)`${a} == 'object' && Array.isArray(${s}) && ${s}.length == 1`, () => n.assign(s, (0, re._)`${s}[0]`).assign(a, (0, re._)`typeof ${s}`).if(Xa(t, s, o.strictNumbers), () => n.assign(i, s))), n.if((0, re._)`${i} !== undefined`);
  for (const d of r)
    (Wu.has(d) || d === "array" && o.coerceTypes === "array") && c(d);
  n.else(), Ya(e), n.endIf(), n.if((0, re._)`${i} !== undefined`, () => {
    n.assign(s, i), B_(e, i);
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
function B_({ gen: e, parentData: t, parentDataProperty: r }, n) {
  e.if((0, re._)`${t} !== undefined`, () => e.assign((0, re._)`${t}[${r}]`, n));
}
function Co(e, t, r, n = Mr.Correct) {
  const s = n === Mr.Correct ? re.operators.EQ : re.operators.NEQ;
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
  return n === Mr.Correct ? o : (0, re.not)(o);
  function a(i = re.nil) {
    return (0, re.and)((0, re._)`typeof ${t} == "number"`, i, r ? (0, re._)`isFinite(${t})` : re.nil);
  }
}
Se.checkDataType = Co;
function Xa(e, t, r, n) {
  if (e.length === 1)
    return Co(e[0], t, r, n);
  let s;
  const o = (0, Hu.toHash)(e);
  if (o.array && o.object) {
    const a = (0, re._)`typeof ${t} != "object"`;
    s = o.null ? a : (0, re._)`!${t} || ${a}`, delete o.null, delete o.array, delete o.object;
  } else
    s = re.nil;
  o.number && delete o.integer;
  for (const a in o)
    s = (0, re.and)(s, Co(a, t, r, n));
  return s;
}
Se.checkDataTypes = Xa;
const W_ = {
  message: ({ schema: e }) => `must be ${e}`,
  params: ({ schema: e, schemaValue: t }) => typeof e == "string" ? (0, re._)`{type: ${e}}` : (0, re._)`{type: ${t}}`
};
function Ya(e) {
  const t = J_(e);
  (0, z_.reportError)(t, W_);
}
Se.reportTypeError = Ya;
function J_(e) {
  const { gen: t, data: r, schema: n } = e, s = (0, Hu.schemaRefOrVal)(e, n, "type");
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
var js = {};
Object.defineProperty(js, "__esModule", { value: !0 });
js.assignDefaults = void 0;
const Nr = se, X_ = U;
function Y_(e, t) {
  const { properties: r, items: n } = e.schema;
  if (t === "object" && r)
    for (const s in r)
      kc(e, s, r[s].default);
  else t === "array" && Array.isArray(n) && n.forEach((s, o) => kc(e, o, s.default));
}
js.assignDefaults = Y_;
function kc(e, t, r) {
  const { gen: n, compositeRule: s, data: o, opts: a } = e;
  if (r === void 0)
    return;
  const i = (0, Nr._)`${o}${(0, Nr.getProperty)(t)}`;
  if (s) {
    (0, X_.checkStrictMode)(e, `default is ignored for: ${i}`);
    return;
  }
  let c = (0, Nr._)`${i} === undefined`;
  a.useDefaults === "empty" && (c = (0, Nr._)`${c} || ${i} === null || ${i} === ""`), n.if(c, (0, Nr._)`${i} = ${(0, Nr.stringify)(r)}`);
}
var _t = {}, ae = {};
Object.defineProperty(ae, "__esModule", { value: !0 });
ae.validateUnion = ae.validateArray = ae.usePattern = ae.callValidateCode = ae.schemaProperties = ae.allSchemaProperties = ae.noPropertyInData = ae.propertyInData = ae.isOwnProperty = ae.hasPropFunc = ae.reportMissingProp = ae.checkMissingProp = ae.checkReportMissingProp = void 0;
const pe = se, xa = U, kt = vt, x_ = U;
function Q_(e, t) {
  const { gen: r, data: n, it: s } = e;
  r.if(Za(r, n, t, s.opts.ownProperties), () => {
    e.setParams({ missingProperty: (0, pe._)`${t}` }, !0), e.error();
  });
}
ae.checkReportMissingProp = Q_;
function Z_({ gen: e, data: t, it: { opts: r } }, n, s) {
  return (0, pe.or)(...n.map((o) => (0, pe.and)(Za(e, t, o, r.ownProperties), (0, pe._)`${s} = ${o}`)));
}
ae.checkMissingProp = Z_;
function e0(e, t) {
  e.setParams({ missingProperty: t }, !0), e.error();
}
ae.reportMissingProp = e0;
function Ju(e) {
  return e.scopeValue("func", {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    ref: Object.prototype.hasOwnProperty,
    code: (0, pe._)`Object.prototype.hasOwnProperty`
  });
}
ae.hasPropFunc = Ju;
function Qa(e, t, r) {
  return (0, pe._)`${Ju(e)}.call(${t}, ${r})`;
}
ae.isOwnProperty = Qa;
function t0(e, t, r, n) {
  const s = (0, pe._)`${t}${(0, pe.getProperty)(r)} !== undefined`;
  return n ? (0, pe._)`${s} && ${Qa(e, t, r)}` : s;
}
ae.propertyInData = t0;
function Za(e, t, r, n) {
  const s = (0, pe._)`${t}${(0, pe.getProperty)(r)} === undefined`;
  return n ? (0, pe.or)(s, (0, pe.not)(Qa(e, t, r))) : s;
}
ae.noPropertyInData = Za;
function Xu(e) {
  return e ? Object.keys(e).filter((t) => t !== "__proto__") : [];
}
ae.allSchemaProperties = Xu;
function r0(e, t) {
  return Xu(t).filter((r) => !(0, xa.alwaysValidSchema)(e, t[r]));
}
ae.schemaProperties = r0;
function n0({ schemaCode: e, data: t, it: { gen: r, topSchemaRef: n, schemaPath: s, errorPath: o }, it: a }, i, c, d) {
  const u = d ? (0, pe._)`${e}, ${t}, ${n}${s}` : t, f = [
    [kt.default.instancePath, (0, pe.strConcat)(kt.default.instancePath, o)],
    [kt.default.parentData, a.parentData],
    [kt.default.parentDataProperty, a.parentDataProperty],
    [kt.default.rootData, kt.default.rootData]
  ];
  a.opts.dynamicRef && f.push([kt.default.dynamicAnchors, kt.default.dynamicAnchors]);
  const _ = (0, pe._)`${u}, ${r.object(...f)}`;
  return c !== pe.nil ? (0, pe._)`${i}.call(${c}, ${_})` : (0, pe._)`${i}(${_})`;
}
ae.callValidateCode = n0;
const s0 = (0, pe._)`new RegExp`;
function o0({ gen: e, it: { opts: t } }, r) {
  const n = t.unicodeRegExp ? "u" : "", { regExp: s } = t.code, o = s(r, n);
  return e.scopeValue("pattern", {
    key: o.toString(),
    ref: o,
    code: (0, pe._)`${s.code === "new RegExp" ? s0 : (0, x_.useFunc)(e, s)}(${r}, ${n})`
  });
}
ae.usePattern = o0;
function a0(e) {
  const { gen: t, data: r, keyword: n, it: s } = e, o = t.name("valid");
  if (s.allErrors) {
    const i = t.let("valid", !0);
    return a(() => t.assign(i, !1)), i;
  }
  return t.var(o, !0), a(() => t.break()), o;
  function a(i) {
    const c = t.const("len", (0, pe._)`${r}.length`);
    t.forRange("i", 0, c, (d) => {
      e.subschema({
        keyword: n,
        dataProp: d,
        dataPropType: xa.Type.Num
      }, o), t.if((0, pe.not)(o), i);
    });
  }
}
ae.validateArray = a0;
function i0(e) {
  const { gen: t, schema: r, keyword: n, it: s } = e;
  if (!Array.isArray(r))
    throw new Error("ajv implementation error");
  if (r.some((c) => (0, xa.alwaysValidSchema)(s, c)) && !s.opts.unevaluated)
    return;
  const a = t.let("valid", !1), i = t.name("_valid");
  t.block(() => r.forEach((c, d) => {
    const u = e.subschema({
      keyword: n,
      schemaProp: d,
      compositeRule: !0
    }, i);
    t.assign(a, (0, pe._)`${a} || ${i}`), e.mergeValidEvaluated(u, i) || t.if((0, pe.not)(a));
  })), e.result(a, () => e.reset(), () => e.error(!0));
}
ae.validateUnion = i0;
Object.defineProperty(_t, "__esModule", { value: !0 });
_t.validateKeywordUsage = _t.validSchemaType = _t.funcKeywordCode = _t.macroKeywordCode = void 0;
const Fe = se, mr = vt, c0 = ae, l0 = bn;
function u0(e, t) {
  const { gen: r, keyword: n, schema: s, parentSchema: o, it: a } = e, i = t.macro.call(a.self, s, o, a), c = Yu(r, n, i);
  a.opts.validateSchema !== !1 && a.self.validateSchema(i, !0);
  const d = r.name("valid");
  e.subschema({
    schema: i,
    schemaPath: Fe.nil,
    errSchemaPath: `${a.errSchemaPath}/${n}`,
    topSchemaRef: c,
    compositeRule: !0
  }, d), e.pass(d, () => e.error(!0));
}
_t.macroKeywordCode = u0;
function d0(e, t) {
  var r;
  const { gen: n, keyword: s, schema: o, parentSchema: a, $data: i, it: c } = e;
  h0(c, t);
  const d = !i && t.compile ? t.compile.call(c.self, o, a, c) : t.validate, u = Yu(n, s, d), f = n.let("valid");
  e.block$data(f, _), e.ok((r = t.valid) !== null && r !== void 0 ? r : f);
  function _() {
    if (t.errors === !1)
      g(), t.modifying && Dc(e), $(() => e.error());
    else {
      const p = t.async ? y() : w();
      t.modifying && Dc(e), $(() => f0(e, p));
    }
  }
  function y() {
    const p = n.let("ruleErrs", null);
    return n.try(() => g((0, Fe._)`await `), (E) => n.assign(f, !1).if((0, Fe._)`${E} instanceof ${c.ValidationError}`, () => n.assign(p, (0, Fe._)`${E}.errors`), () => n.throw(E))), p;
  }
  function w() {
    const p = (0, Fe._)`${u}.errors`;
    return n.assign(p, null), g(Fe.nil), p;
  }
  function g(p = t.async ? (0, Fe._)`await ` : Fe.nil) {
    const E = c.opts.passContext ? mr.default.this : mr.default.self, N = !("compile" in t && !i || t.schema === !1);
    n.assign(f, (0, Fe._)`${p}${(0, c0.callValidateCode)(e, u, E, N)}`, t.modifying);
  }
  function $(p) {
    var E;
    n.if((0, Fe.not)((E = t.valid) !== null && E !== void 0 ? E : f), p);
  }
}
_t.funcKeywordCode = d0;
function Dc(e) {
  const { gen: t, data: r, it: n } = e;
  t.if(n.parentData, () => t.assign(r, (0, Fe._)`${n.parentData}[${n.parentDataProperty}]`));
}
function f0(e, t) {
  const { gen: r } = e;
  r.if((0, Fe._)`Array.isArray(${t})`, () => {
    r.assign(mr.default.vErrors, (0, Fe._)`${mr.default.vErrors} === null ? ${t} : ${mr.default.vErrors}.concat(${t})`).assign(mr.default.errors, (0, Fe._)`${mr.default.vErrors}.length`), (0, l0.extendErrors)(e);
  }, () => e.error());
}
function h0({ schemaEnv: e }, t) {
  if (t.async && !e.$async)
    throw new Error("async keyword in sync schema");
}
function Yu(e, t, r) {
  if (r === void 0)
    throw new Error(`keyword "${t}" failed to compile`);
  return e.scopeValue("keyword", typeof r == "function" ? { ref: r } : { ref: r, code: (0, Fe.stringify)(r) });
}
function p0(e, t, r = !1) {
  return !t.length || t.some((n) => n === "array" ? Array.isArray(e) : n === "object" ? e && typeof e == "object" && !Array.isArray(e) : typeof e == n || r && typeof e > "u");
}
_t.validSchemaType = p0;
function m0({ schema: e, opts: t, self: r, errSchemaPath: n }, s, o) {
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
_t.validateKeywordUsage = m0;
var Ht = {};
Object.defineProperty(Ht, "__esModule", { value: !0 });
Ht.extendSubschemaMode = Ht.extendSubschemaData = Ht.getSubschema = void 0;
const mt = se, xu = U;
function y0(e, { keyword: t, schemaProp: r, schema: n, schemaPath: s, errSchemaPath: o, topSchemaRef: a }) {
  if (t !== void 0 && n !== void 0)
    throw new Error('both "keyword" and "schema" passed, only one allowed');
  if (t !== void 0) {
    const i = e.schema[t];
    return r === void 0 ? {
      schema: i,
      schemaPath: (0, mt._)`${e.schemaPath}${(0, mt.getProperty)(t)}`,
      errSchemaPath: `${e.errSchemaPath}/${t}`
    } : {
      schema: i[r],
      schemaPath: (0, mt._)`${e.schemaPath}${(0, mt.getProperty)(t)}${(0, mt.getProperty)(r)}`,
      errSchemaPath: `${e.errSchemaPath}/${t}/${(0, xu.escapeFragment)(r)}`
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
Ht.getSubschema = y0;
function $0(e, t, { dataProp: r, dataPropType: n, data: s, dataTypes: o, propertyName: a }) {
  if (s !== void 0 && r !== void 0)
    throw new Error('both "data" and "dataProp" passed, only one allowed');
  const { gen: i } = t;
  if (r !== void 0) {
    const { errorPath: d, dataPathArr: u, opts: f } = t, _ = i.let("data", (0, mt._)`${t.data}${(0, mt.getProperty)(r)}`, !0);
    c(_), e.errorPath = (0, mt.str)`${d}${(0, xu.getErrorPath)(r, n, f.jsPropertySyntax)}`, e.parentDataProperty = (0, mt._)`${r}`, e.dataPathArr = [...u, e.parentDataProperty];
  }
  if (s !== void 0) {
    const d = s instanceof mt.Name ? s : i.let("data", s, !0);
    c(d), a !== void 0 && (e.propertyName = a);
  }
  o && (e.dataTypes = o);
  function c(d) {
    e.data = d, e.dataLevel = t.dataLevel + 1, e.dataTypes = [], t.definedProperties = /* @__PURE__ */ new Set(), e.parentData = t.data, e.dataNames = [...t.dataNames, d];
  }
}
Ht.extendSubschemaData = $0;
function g0(e, { jtdDiscriminator: t, jtdMetadata: r, compositeRule: n, createErrors: s, allErrors: o }) {
  n !== void 0 && (e.compositeRule = n), s !== void 0 && (e.createErrors = s), o !== void 0 && (e.allErrors = o), e.jtdDiscriminator = t, e.jtdMetadata = r;
}
Ht.extendSubschemaMode = g0;
var Te = {}, Qu = { exports: {} }, Gt = Qu.exports = function(e, t, r) {
  typeof t == "function" && (r = t, t = {}), r = t.cb || r;
  var n = typeof r == "function" ? r : r.pre || function() {
  }, s = r.post || function() {
  };
  ss(t, n, s, e, "", e);
};
Gt.keywords = {
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
Gt.arrayKeywords = {
  items: !0,
  allOf: !0,
  anyOf: !0,
  oneOf: !0
};
Gt.propsKeywords = {
  $defs: !0,
  definitions: !0,
  properties: !0,
  patternProperties: !0,
  dependencies: !0
};
Gt.skipKeywords = {
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
function ss(e, t, r, n, s, o, a, i, c, d) {
  if (n && typeof n == "object" && !Array.isArray(n)) {
    t(n, s, o, a, i, c, d);
    for (var u in n) {
      var f = n[u];
      if (Array.isArray(f)) {
        if (u in Gt.arrayKeywords)
          for (var _ = 0; _ < f.length; _++)
            ss(e, t, r, f[_], s + "/" + u + "/" + _, o, s, u, n, _);
      } else if (u in Gt.propsKeywords) {
        if (f && typeof f == "object")
          for (var y in f)
            ss(e, t, r, f[y], s + "/" + u + "/" + _0(y), o, s, u, n, y);
      } else (u in Gt.keywords || e.allKeys && !(u in Gt.skipKeywords)) && ss(e, t, r, f, s + "/" + u, o, s, u, n);
    }
    r(n, s, o, a, i, c, d);
  }
}
function _0(e) {
  return e.replace(/~/g, "~0").replace(/\//g, "~1");
}
var v0 = Qu.exports;
Object.defineProperty(Te, "__esModule", { value: !0 });
Te.getSchemaRefs = Te.resolveUrl = Te.normalizeId = Te._getFullPath = Te.getFullPath = Te.inlineRef = void 0;
const E0 = U, w0 = bs, S0 = v0, b0 = /* @__PURE__ */ new Set([
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
function P0(e, t = !0) {
  return typeof e == "boolean" ? !0 : t === !0 ? !ko(e) : t ? Zu(e) <= t : !1;
}
Te.inlineRef = P0;
const N0 = /* @__PURE__ */ new Set([
  "$ref",
  "$recursiveRef",
  "$recursiveAnchor",
  "$dynamicRef",
  "$dynamicAnchor"
]);
function ko(e) {
  for (const t in e) {
    if (N0.has(t))
      return !0;
    const r = e[t];
    if (Array.isArray(r) && r.some(ko) || typeof r == "object" && ko(r))
      return !0;
  }
  return !1;
}
function Zu(e) {
  let t = 0;
  for (const r in e) {
    if (r === "$ref")
      return 1 / 0;
    if (t++, !b0.has(r) && (typeof e[r] == "object" && (0, E0.eachItem)(e[r], (n) => t += Zu(n)), t === 1 / 0))
      return 1 / 0;
  }
  return t;
}
function ed(e, t = "", r) {
  r !== !1 && (t = Lr(t));
  const n = e.parse(t);
  return td(e, n);
}
Te.getFullPath = ed;
function td(e, t) {
  return e.serialize(t).split("#")[0] + "#";
}
Te._getFullPath = td;
const R0 = /#\/?$/;
function Lr(e) {
  return e ? e.replace(R0, "") : "";
}
Te.normalizeId = Lr;
function T0(e, t, r) {
  return r = Lr(r), e.resolve(t, r);
}
Te.resolveUrl = T0;
const O0 = /^[a-z_][-a-z0-9._]*$/i;
function I0(e, t) {
  if (typeof e == "boolean")
    return {};
  const { schemaId: r, uriResolver: n } = this.opts, s = Lr(e[r] || t), o = { "": s }, a = ed(n, s, !1), i = {}, c = /* @__PURE__ */ new Set();
  return S0(e, { allKeys: !0 }, (f, _, y, w) => {
    if (w === void 0)
      return;
    const g = a + _;
    let $ = o[w];
    typeof f[r] == "string" && ($ = p.call(this, f[r])), E.call(this, f.$anchor), E.call(this, f.$dynamicAnchor), o[_] = $;
    function p(N) {
      const R = this.opts.uriResolver.resolve;
      if (N = Lr($ ? R($, N) : N), c.has(N))
        throw u(N);
      c.add(N);
      let T = this.refs[N];
      return typeof T == "string" && (T = this.refs[T]), typeof T == "object" ? d(f, T.schema, N) : N !== Lr(g) && (N[0] === "#" ? (d(f, i[N], N), i[N] = f) : this.refs[N] = g), N;
    }
    function E(N) {
      if (typeof N == "string") {
        if (!O0.test(N))
          throw new Error(`invalid anchor "${N}"`);
        p.call(this, `#${N}`);
      }
    }
  }), i;
  function d(f, _, y) {
    if (_ !== void 0 && !w0(f, _))
      throw u(y);
  }
  function u(f) {
    return new Error(`reference "${f}" resolves to more than one schema`);
  }
}
Te.getSchemaRefs = I0;
Object.defineProperty(it, "__esModule", { value: !0 });
it.getData = it.KeywordCxt = it.validateFunctionCode = void 0;
const rd = zr, Mc = Se, ei = Pt, ys = Se, j0 = js, yn = _t, oo = Ht, W = se, Q = vt, A0 = Te, Nt = U, nn = bn;
function C0(e) {
  if (od(e) && (ad(e), sd(e))) {
    M0(e);
    return;
  }
  nd(e, () => (0, rd.topBoolOrEmptySchema)(e));
}
it.validateFunctionCode = C0;
function nd({ gen: e, validateName: t, schema: r, schemaEnv: n, opts: s }, o) {
  s.code.es5 ? e.func(t, (0, W._)`${Q.default.data}, ${Q.default.valCxt}`, n.$async, () => {
    e.code((0, W._)`"use strict"; ${Lc(r, s)}`), D0(e, s), e.code(o);
  }) : e.func(t, (0, W._)`${Q.default.data}, ${k0(s)}`, n.$async, () => e.code(Lc(r, s)).code(o));
}
function k0(e) {
  return (0, W._)`{${Q.default.instancePath}="", ${Q.default.parentData}, ${Q.default.parentDataProperty}, ${Q.default.rootData}=${Q.default.data}${e.dynamicRef ? (0, W._)`, ${Q.default.dynamicAnchors}={}` : W.nil}}={}`;
}
function D0(e, t) {
  e.if(Q.default.valCxt, () => {
    e.var(Q.default.instancePath, (0, W._)`${Q.default.valCxt}.${Q.default.instancePath}`), e.var(Q.default.parentData, (0, W._)`${Q.default.valCxt}.${Q.default.parentData}`), e.var(Q.default.parentDataProperty, (0, W._)`${Q.default.valCxt}.${Q.default.parentDataProperty}`), e.var(Q.default.rootData, (0, W._)`${Q.default.valCxt}.${Q.default.rootData}`), t.dynamicRef && e.var(Q.default.dynamicAnchors, (0, W._)`${Q.default.valCxt}.${Q.default.dynamicAnchors}`);
  }, () => {
    e.var(Q.default.instancePath, (0, W._)`""`), e.var(Q.default.parentData, (0, W._)`undefined`), e.var(Q.default.parentDataProperty, (0, W._)`undefined`), e.var(Q.default.rootData, Q.default.data), t.dynamicRef && e.var(Q.default.dynamicAnchors, (0, W._)`{}`);
  });
}
function M0(e) {
  const { schema: t, opts: r, gen: n } = e;
  nd(e, () => {
    r.$comment && t.$comment && cd(e), z0(e), n.let(Q.default.vErrors, null), n.let(Q.default.errors, 0), r.unevaluated && L0(e), id(e), K0(e);
  });
}
function L0(e) {
  const { gen: t, validateName: r } = e;
  e.evaluated = t.const("evaluated", (0, W._)`${r}.evaluated`), t.if((0, W._)`${e.evaluated}.dynamicProps`, () => t.assign((0, W._)`${e.evaluated}.props`, (0, W._)`undefined`)), t.if((0, W._)`${e.evaluated}.dynamicItems`, () => t.assign((0, W._)`${e.evaluated}.items`, (0, W._)`undefined`));
}
function Lc(e, t) {
  const r = typeof e == "object" && e[t.schemaId];
  return r && (t.code.source || t.code.process) ? (0, W._)`/*# sourceURL=${r} */` : W.nil;
}
function F0(e, t) {
  if (od(e) && (ad(e), sd(e))) {
    V0(e, t);
    return;
  }
  (0, rd.boolOrEmptySchema)(e, t);
}
function sd({ schema: e, self: t }) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (t.RULES.all[r])
      return !0;
  return !1;
}
function od(e) {
  return typeof e.schema != "boolean";
}
function V0(e, t) {
  const { schema: r, gen: n, opts: s } = e;
  s.$comment && r.$comment && cd(e), q0(e), G0(e);
  const o = n.const("_errs", Q.default.errors);
  id(e, o), n.var(t, (0, W._)`${o} === ${Q.default.errors}`);
}
function ad(e) {
  (0, Nt.checkUnknownRules)(e), U0(e);
}
function id(e, t) {
  if (e.opts.jtd)
    return Fc(e, [], !1, t);
  const r = (0, Mc.getSchemaTypes)(e.schema), n = (0, Mc.coerceAndCheckDataType)(e, r);
  Fc(e, r, !n, t);
}
function U0(e) {
  const { schema: t, errSchemaPath: r, opts: n, self: s } = e;
  t.$ref && n.ignoreKeywordsWithRef && (0, Nt.schemaHasRulesButRef)(t, s.RULES) && s.logger.warn(`$ref: keywords ignored in schema at path "${r}"`);
}
function z0(e) {
  const { schema: t, opts: r } = e;
  t.default !== void 0 && r.useDefaults && r.strictSchema && (0, Nt.checkStrictMode)(e, "default is ignored in the schema root");
}
function q0(e) {
  const t = e.schema[e.opts.schemaId];
  t && (e.baseId = (0, A0.resolveUrl)(e.opts.uriResolver, e.baseId, t));
}
function G0(e) {
  if (e.schema.$async && !e.schemaEnv.$async)
    throw new Error("async schema in sync schema");
}
function cd({ gen: e, schemaEnv: t, schema: r, errSchemaPath: n, opts: s }) {
  const o = r.$comment;
  if (s.$comment === !0)
    e.code((0, W._)`${Q.default.self}.logger.log(${o})`);
  else if (typeof s.$comment == "function") {
    const a = (0, W.str)`${n}/$comment`, i = e.scopeValue("root", { ref: t.root });
    e.code((0, W._)`${Q.default.self}.opts.$comment(${o}, ${a}, ${i}.schema)`);
  }
}
function K0(e) {
  const { gen: t, schemaEnv: r, validateName: n, ValidationError: s, opts: o } = e;
  r.$async ? t.if((0, W._)`${Q.default.errors} === 0`, () => t.return(Q.default.data), () => t.throw((0, W._)`new ${s}(${Q.default.vErrors})`)) : (t.assign((0, W._)`${n}.errors`, Q.default.vErrors), o.unevaluated && H0(e), t.return((0, W._)`${Q.default.errors} === 0`));
}
function H0({ gen: e, evaluated: t, props: r, items: n }) {
  r instanceof W.Name && e.assign((0, W._)`${t}.props`, r), n instanceof W.Name && e.assign((0, W._)`${t}.items`, n);
}
function Fc(e, t, r, n) {
  const { gen: s, schema: o, data: a, allErrors: i, opts: c, self: d } = e, { RULES: u } = d;
  if (o.$ref && (c.ignoreKeywordsWithRef || !(0, Nt.schemaHasRulesButRef)(o, u))) {
    s.block(() => dd(e, "$ref", u.all.$ref.definition));
    return;
  }
  c.jtd || B0(e, t), s.block(() => {
    for (const _ of u.rules)
      f(_);
    f(u.post);
  });
  function f(_) {
    (0, ei.shouldUseGroup)(o, _) && (_.type ? (s.if((0, ys.checkDataType)(_.type, a, c.strictNumbers)), Vc(e, _), t.length === 1 && t[0] === _.type && r && (s.else(), (0, ys.reportTypeError)(e)), s.endIf()) : Vc(e, _), i || s.if((0, W._)`${Q.default.errors} === ${n || 0}`));
  }
}
function Vc(e, t) {
  const { gen: r, schema: n, opts: { useDefaults: s } } = e;
  s && (0, j0.assignDefaults)(e, t.type), r.block(() => {
    for (const o of t.rules)
      (0, ei.shouldUseRule)(n, o) && dd(e, o.keyword, o.definition, t.type);
  });
}
function B0(e, t) {
  e.schemaEnv.meta || !e.opts.strictTypes || (W0(e, t), e.opts.allowUnionTypes || J0(e, t), X0(e, e.dataTypes));
}
function W0(e, t) {
  if (t.length) {
    if (!e.dataTypes.length) {
      e.dataTypes = t;
      return;
    }
    t.forEach((r) => {
      ld(e.dataTypes, r) || ti(e, `type "${r}" not allowed by context "${e.dataTypes.join(",")}"`);
    }), x0(e, t);
  }
}
function J0(e, t) {
  t.length > 1 && !(t.length === 2 && t.includes("null")) && ti(e, "use allowUnionTypes to allow union type keyword");
}
function X0(e, t) {
  const r = e.self.RULES.all;
  for (const n in r) {
    const s = r[n];
    if (typeof s == "object" && (0, ei.shouldUseRule)(e.schema, s)) {
      const { type: o } = s.definition;
      o.length && !o.some((a) => Y0(t, a)) && ti(e, `missing type "${o.join(",")}" for keyword "${n}"`);
    }
  }
}
function Y0(e, t) {
  return e.includes(t) || t === "number" && e.includes("integer");
}
function ld(e, t) {
  return e.includes(t) || t === "integer" && e.includes("number");
}
function x0(e, t) {
  const r = [];
  for (const n of e.dataTypes)
    ld(t, n) ? r.push(n) : t.includes("integer") && n === "number" && r.push("integer");
  e.dataTypes = r;
}
function ti(e, t) {
  const r = e.schemaEnv.baseId + e.errSchemaPath;
  t += ` at "${r}" (strictTypes)`, (0, Nt.checkStrictMode)(e, t, e.opts.strictTypes);
}
class ud {
  constructor(t, r, n) {
    if ((0, yn.validateKeywordUsage)(t, r, n), this.gen = t.gen, this.allErrors = t.allErrors, this.keyword = n, this.data = t.data, this.schema = t.schema[n], this.$data = r.$data && t.opts.$data && this.schema && this.schema.$data, this.schemaValue = (0, Nt.schemaRefOrVal)(t, this.schema, n, this.$data), this.schemaType = r.schemaType, this.parentSchema = t.schema, this.params = {}, this.it = t, this.def = r, this.$data)
      this.schemaCode = t.gen.const("vSchema", fd(this.$data, t));
    else if (this.schemaCode = this.schemaValue, !(0, yn.validSchemaType)(this.schema, r.schemaType, r.allowUndefined))
      throw new Error(`${n} value must be ${JSON.stringify(r.schemaType)}`);
    ("code" in r ? r.trackErrors : r.errors !== !1) && (this.errsCount = t.gen.const("_errs", Q.default.errors));
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
    (t ? nn.reportExtraError : nn.reportError)(this, this.def.error, r);
  }
  $dataError() {
    (0, nn.reportError)(this, this.def.$dataError || nn.keyword$DataError);
  }
  reset() {
    if (this.errsCount === void 0)
      throw new Error('add "trackErrors" to keyword definition');
    (0, nn.resetErrorsCount)(this.gen, this.errsCount);
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
        return (0, W._)`${(0, ys.checkDataTypes)(c, r, o.opts.strictNumbers, ys.DataType.Wrong)}`;
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
    const n = (0, oo.getSubschema)(this.it, t);
    (0, oo.extendSubschemaData)(n, this.it, t), (0, oo.extendSubschemaMode)(n, t);
    const s = { ...this.it, ...n, items: void 0, props: void 0 };
    return F0(s, r), s;
  }
  mergeEvaluated(t, r) {
    const { it: n, gen: s } = this;
    n.opts.unevaluated && (n.props !== !0 && t.props !== void 0 && (n.props = Nt.mergeEvaluated.props(s, t.props, n.props, r)), n.items !== !0 && t.items !== void 0 && (n.items = Nt.mergeEvaluated.items(s, t.items, n.items, r)));
  }
  mergeValidEvaluated(t, r) {
    const { it: n, gen: s } = this;
    if (n.opts.unevaluated && (n.props !== !0 || n.items !== !0))
      return s.if(r, () => this.mergeEvaluated(t, W.Name)), !0;
  }
}
it.KeywordCxt = ud;
function dd(e, t, r, n) {
  const s = new ud(e, r, t);
  "code" in r ? r.code(s, n) : s.$data && r.validate ? (0, yn.funcKeywordCode)(s, r) : "macro" in r ? (0, yn.macroKeywordCode)(s, r) : (r.compile || r.validate) && (0, yn.funcKeywordCode)(s, r);
}
const Q0 = /^\/(?:[^~]|~0|~1)*$/, Z0 = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
function fd(e, { dataLevel: t, dataNames: r, dataPathArr: n }) {
  let s, o;
  if (e === "")
    return Q.default.rootData;
  if (e[0] === "/") {
    if (!Q0.test(e))
      throw new Error(`Invalid JSON-pointer: ${e}`);
    s = e, o = Q.default.rootData;
  } else {
    const d = Z0.exec(e);
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
    d && (o = (0, W._)`${o}${(0, W.getProperty)((0, Nt.unescapeJsonPointer)(d))}`, a = (0, W._)`${a} && ${o}`);
  return a;
  function c(d, u) {
    return `Cannot access ${d} ${u} levels up, current level is ${t}`;
  }
}
it.getData = fd;
var Fn = {}, Uc;
function ri() {
  if (Uc) return Fn;
  Uc = 1, Object.defineProperty(Fn, "__esModule", { value: !0 });
  class e extends Error {
    constructor(r) {
      super("validation failed"), this.errors = r, this.ajv = this.validation = !0;
    }
  }
  return Fn.default = e, Fn;
}
var Jr = {};
Object.defineProperty(Jr, "__esModule", { value: !0 });
const ao = Te;
class ev extends Error {
  constructor(t, r, n, s) {
    super(s || `can't resolve reference ${n} from id ${r}`), this.missingRef = (0, ao.resolveUrl)(t, r, n), this.missingSchema = (0, ao.normalizeId)((0, ao.getFullPath)(t, this.missingRef));
  }
}
Jr.default = ev;
var Ke = {};
Object.defineProperty(Ke, "__esModule", { value: !0 });
Ke.resolveSchema = Ke.getCompilingSchema = Ke.resolveRef = Ke.compileSchema = Ke.SchemaEnv = void 0;
const et = se, tv = ri(), lr = vt, ot = Te, zc = U, rv = it;
class As {
  constructor(t) {
    var r;
    this.refs = {}, this.dynamicAnchors = {};
    let n;
    typeof t.schema == "object" && (n = t.schema), this.schema = t.schema, this.schemaId = t.schemaId, this.root = t.root || this, this.baseId = (r = t.baseId) !== null && r !== void 0 ? r : (0, ot.normalizeId)(n == null ? void 0 : n[t.schemaId || "$id"]), this.schemaPath = t.schemaPath, this.localRefs = t.localRefs, this.meta = t.meta, this.$async = n == null ? void 0 : n.$async, this.refs = {};
  }
}
Ke.SchemaEnv = As;
function ni(e) {
  const t = hd.call(this, e);
  if (t)
    return t;
  const r = (0, ot.getFullPath)(this.opts.uriResolver, e.root.baseId), { es5: n, lines: s } = this.opts.code, { ownProperties: o } = this.opts, a = new et.CodeGen(this.scope, { es5: n, lines: s, ownProperties: o });
  let i;
  e.$async && (i = a.scopeValue("Error", {
    ref: tv.default,
    code: (0, et._)`require("ajv/dist/runtime/validation_error").default`
  }));
  const c = a.scopeName("validate");
  e.validateName = c;
  const d = {
    gen: a,
    allErrors: this.opts.allErrors,
    data: lr.default.data,
    parentData: lr.default.parentData,
    parentDataProperty: lr.default.parentDataProperty,
    dataNames: [lr.default.data],
    dataPathArr: [et.nil],
    // TODO can its length be used as dataLevel if nil is removed?
    dataLevel: 0,
    dataTypes: [],
    definedProperties: /* @__PURE__ */ new Set(),
    topSchemaRef: a.scopeValue("schema", this.opts.code.source === !0 ? { ref: e.schema, code: (0, et.stringify)(e.schema) } : { ref: e.schema }),
    validateName: c,
    ValidationError: i,
    schema: e.schema,
    schemaEnv: e,
    rootId: r,
    baseId: e.baseId || r,
    schemaPath: et.nil,
    errSchemaPath: e.schemaPath || (this.opts.jtd ? "" : "#"),
    errorPath: (0, et._)`""`,
    opts: this.opts,
    self: this
  };
  let u;
  try {
    this._compilations.add(e), (0, rv.validateFunctionCode)(d), a.optimize(this.opts.code.optimize);
    const f = a.toString();
    u = `${a.scopeRefs(lr.default.scope)}return ${f}`, this.opts.code.process && (u = this.opts.code.process(u, e));
    const y = new Function(`${lr.default.self}`, `${lr.default.scope}`, u)(this, this.scope.get());
    if (this.scope.value(c, { ref: y }), y.errors = null, y.schema = e.schema, y.schemaEnv = e, e.$async && (y.$async = !0), this.opts.code.source === !0 && (y.source = { validateName: c, validateCode: f, scopeValues: a._values }), this.opts.unevaluated) {
      const { props: w, items: g } = d;
      y.evaluated = {
        props: w instanceof et.Name ? void 0 : w,
        items: g instanceof et.Name ? void 0 : g,
        dynamicProps: w instanceof et.Name,
        dynamicItems: g instanceof et.Name
      }, y.source && (y.source.evaluated = (0, et.stringify)(y.evaluated));
    }
    return e.validate = y, e;
  } catch (f) {
    throw delete e.validate, delete e.validateName, u && this.logger.error("Error compiling schema, function code:", u), f;
  } finally {
    this._compilations.delete(e);
  }
}
Ke.compileSchema = ni;
function nv(e, t, r) {
  var n;
  r = (0, ot.resolveUrl)(this.opts.uriResolver, t, r);
  const s = e.refs[r];
  if (s)
    return s;
  let o = av.call(this, e, r);
  if (o === void 0) {
    const a = (n = e.localRefs) === null || n === void 0 ? void 0 : n[r], { schemaId: i } = this.opts;
    a && (o = new As({ schema: a, schemaId: i, root: e, baseId: t }));
  }
  if (o !== void 0)
    return e.refs[r] = sv.call(this, o);
}
Ke.resolveRef = nv;
function sv(e) {
  return (0, ot.inlineRef)(e.schema, this.opts.inlineRefs) ? e.schema : e.validate ? e : ni.call(this, e);
}
function hd(e) {
  for (const t of this._compilations)
    if (ov(t, e))
      return t;
}
Ke.getCompilingSchema = hd;
function ov(e, t) {
  return e.schema === t.schema && e.root === t.root && e.baseId === t.baseId;
}
function av(e, t) {
  let r;
  for (; typeof (r = this.refs[t]) == "string"; )
    t = r;
  return r || this.schemas[t] || Cs.call(this, e, t);
}
function Cs(e, t) {
  const r = this.opts.uriResolver.parse(t), n = (0, ot._getFullPath)(this.opts.uriResolver, r);
  let s = (0, ot.getFullPath)(this.opts.uriResolver, e.baseId, void 0);
  if (Object.keys(e.schema).length > 0 && n === s)
    return io.call(this, r, e);
  const o = (0, ot.normalizeId)(n), a = this.refs[o] || this.schemas[o];
  if (typeof a == "string") {
    const i = Cs.call(this, e, a);
    return typeof (i == null ? void 0 : i.schema) != "object" ? void 0 : io.call(this, r, i);
  }
  if (typeof (a == null ? void 0 : a.schema) == "object") {
    if (a.validate || ni.call(this, a), o === (0, ot.normalizeId)(t)) {
      const { schema: i } = a, { schemaId: c } = this.opts, d = i[c];
      return d && (s = (0, ot.resolveUrl)(this.opts.uriResolver, s, d)), new As({ schema: i, schemaId: c, root: e, baseId: s });
    }
    return io.call(this, r, a);
  }
}
Ke.resolveSchema = Cs;
const iv = /* @__PURE__ */ new Set([
  "properties",
  "patternProperties",
  "enum",
  "dependencies",
  "definitions"
]);
function io(e, { baseId: t, schema: r, root: n }) {
  var s;
  if (((s = e.fragment) === null || s === void 0 ? void 0 : s[0]) !== "/")
    return;
  for (const i of e.fragment.slice(1).split("/")) {
    if (typeof r == "boolean")
      return;
    const c = r[(0, zc.unescapeFragment)(i)];
    if (c === void 0)
      return;
    r = c;
    const d = typeof r == "object" && r[this.opts.schemaId];
    !iv.has(i) && d && (t = (0, ot.resolveUrl)(this.opts.uriResolver, t, d));
  }
  let o;
  if (typeof r != "boolean" && r.$ref && !(0, zc.schemaHasRulesButRef)(r, this.RULES)) {
    const i = (0, ot.resolveUrl)(this.opts.uriResolver, t, r.$ref);
    o = Cs.call(this, n, i);
  }
  const { schemaId: a } = this.opts;
  if (o = o || new As({ schema: r, schemaId: a, root: n, baseId: t }), o.schema !== o.root.schema)
    return o;
}
const cv = "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#", lv = "Meta-schema for $data reference (JSON AnySchema extension proposal)", uv = "object", dv = [
  "$data"
], fv = {
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
}, hv = !1, pv = {
  $id: cv,
  description: lv,
  type: uv,
  required: dv,
  properties: fv,
  additionalProperties: hv
};
var si = {};
Object.defineProperty(si, "__esModule", { value: !0 });
const pd = Su;
pd.code = 'require("ajv/dist/runtime/uri").default';
si.default = pd;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.CodeGen = e.Name = e.nil = e.stringify = e.str = e._ = e.KeywordCxt = void 0;
  var t = it;
  Object.defineProperty(e, "KeywordCxt", { enumerable: !0, get: function() {
    return t.KeywordCxt;
  } });
  var r = se;
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
  const n = ri(), s = Jr, o = wr, a = Ke, i = se, c = Te, d = Se, u = U, f = pv, _ = si, y = (P, m) => new RegExp(P, m);
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
    var m, S, v, l, h, b, I, j, H, K, ce, He, Bt, Wt, Jt, Xt, Yt, xt, Qt, Zt, er, tr, rr, nr, sr;
    const Qe = P.strict, or = (m = P.code) === null || m === void 0 ? void 0 : m.optimize, Qr = or === !0 || or === void 0 ? 1 : or || 0, Zr = (v = (S = P.code) === null || S === void 0 ? void 0 : S.regExp) !== null && v !== void 0 ? v : y, qs = (l = P.uriResolver) !== null && l !== void 0 ? l : _.default;
    return {
      strictSchema: (b = (h = P.strictSchema) !== null && h !== void 0 ? h : Qe) !== null && b !== void 0 ? b : !0,
      strictNumbers: (j = (I = P.strictNumbers) !== null && I !== void 0 ? I : Qe) !== null && j !== void 0 ? j : !0,
      strictTypes: (K = (H = P.strictTypes) !== null && H !== void 0 ? H : Qe) !== null && K !== void 0 ? K : "log",
      strictTuples: (He = (ce = P.strictTuples) !== null && ce !== void 0 ? ce : Qe) !== null && He !== void 0 ? He : "log",
      strictRequired: (Wt = (Bt = P.strictRequired) !== null && Bt !== void 0 ? Bt : Qe) !== null && Wt !== void 0 ? Wt : !1,
      code: P.code ? { ...P.code, optimize: Qr, regExp: Zr } : { optimize: Qr, regExp: Zr },
      loopRequired: (Jt = P.loopRequired) !== null && Jt !== void 0 ? Jt : E,
      loopEnum: (Xt = P.loopEnum) !== null && Xt !== void 0 ? Xt : E,
      meta: (Yt = P.meta) !== null && Yt !== void 0 ? Yt : !0,
      messages: (xt = P.messages) !== null && xt !== void 0 ? xt : !0,
      inlineRefs: (Qt = P.inlineRefs) !== null && Qt !== void 0 ? Qt : !0,
      schemaId: (Zt = P.schemaId) !== null && Zt !== void 0 ? Zt : "$id",
      addUsedSchema: (er = P.addUsedSchema) !== null && er !== void 0 ? er : !0,
      validateSchema: (tr = P.validateSchema) !== null && tr !== void 0 ? tr : !0,
      validateFormats: (rr = P.validateFormats) !== null && rr !== void 0 ? rr : !0,
      unicodeRegExp: (nr = P.unicodeRegExp) !== null && nr !== void 0 ? nr : !0,
      int32range: (sr = P.int32range) !== null && sr !== void 0 ? sr : !0,
      uriResolver: qs
    };
  }
  class R {
    constructor(m = {}) {
      this.schemas = {}, this.refs = {}, this.formats = {}, this._compilations = /* @__PURE__ */ new Set(), this._loading = {}, this._cache = /* @__PURE__ */ new Map(), m = this.opts = { ...m, ...N(m) };
      const { es5: S, lines: v } = this.opts.code;
      this.scope = new i.ValueScope({ scope: {}, prefixes: g, es5: S, lines: v }), this.logger = q(m.logger);
      const l = m.validateFormats;
      m.validateFormats = !1, this.RULES = (0, o.getRules)(), T.call(this, $, m, "NOT SUPPORTED"), T.call(this, p, m, "DEPRECATED", "warn"), this._metaOpts = ye.call(this), m.formats && le.call(this), this._addVocabularies(), this._addDefaultMetaSchema(), m.keywords && ue.call(this, m.keywords), typeof m.meta == "object" && this.addMetaSchema(m.meta), k.call(this), m.validateFormats = l;
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
      async function l(K, ce) {
        await h.call(this, K.$schema);
        const He = this._addSchema(K, ce);
        return He.validate || b.call(this, He);
      }
      async function h(K) {
        K && !this.getSchema(K) && await l.call(this, { $ref: K }, !0);
      }
      async function b(K) {
        try {
          return this._compileSchemaEnv(K);
        } catch (ce) {
          if (!(ce instanceof s.default))
            throw ce;
          return I.call(this, ce), await j.call(this, ce.missingSchema), b.call(this, K);
        }
      }
      function I({ missingSchema: K, missingRef: ce }) {
        if (this.refs[K])
          throw new Error(`AnySchema ${K} is loaded but ${ce} cannot be resolved`);
      }
      async function j(K) {
        const ce = await H.call(this, K);
        this.refs[K] || await h.call(this, ce.$schema), this.refs[K] || this.addSchema(ce, K, S);
      }
      async function H(K) {
        const ce = this._loading[K];
        if (ce)
          return ce;
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
  function le() {
    for (const P in this.opts.formats) {
      const m = this.opts.formats[P];
      m && this.addFormat(P, m);
    }
  }
  function ue(P) {
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
  function ye() {
    const P = { ...this.opts };
    for (const m of w)
      delete P[m];
    return P;
  }
  const L = { log() {
  }, warn() {
  }, error() {
  } };
  function q(P) {
    if (P === !1)
      return L;
    if (P === void 0)
      return console;
    if (P.log && P.warn && P.error)
      return P;
    throw new Error("logger must implement log, warn and error methods");
  }
  const ie = /^[a-z_$][a-z0-9_$:-]*$/i;
  function O(P, m) {
    const { RULES: S } = this;
    if ((0, u.eachItem)(P, (v) => {
      if (S.keywords[v])
        throw new Error(`Keyword ${v} is already defined`);
      if (!ie.test(v))
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
})(Mu);
var oi = {}, ai = {}, ii = {};
Object.defineProperty(ii, "__esModule", { value: !0 });
const mv = {
  keyword: "id",
  code() {
    throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
  }
};
ii.default = mv;
var Sr = {};
Object.defineProperty(Sr, "__esModule", { value: !0 });
Sr.callRef = Sr.getValidate = void 0;
const yv = Jr, qc = ae, Ge = se, Rr = vt, Gc = Ke, Vn = U, $v = {
  keyword: "$ref",
  schemaType: "string",
  code(e) {
    const { gen: t, schema: r, it: n } = e, { baseId: s, schemaEnv: o, validateName: a, opts: i, self: c } = n, { root: d } = o;
    if ((r === "#" || r === "#/") && s === d.baseId)
      return f();
    const u = Gc.resolveRef.call(c, d, s, r);
    if (u === void 0)
      throw new yv.default(n.opts.uriResolver, s, r);
    if (u instanceof Gc.SchemaEnv)
      return _(u);
    return y(u);
    function f() {
      if (o === d)
        return os(e, a, o, o.$async);
      const w = t.scopeValue("root", { ref: d });
      return os(e, (0, Ge._)`${w}.validate`, d, d.$async);
    }
    function _(w) {
      const g = md(e, w);
      os(e, g, w, w.$async);
    }
    function y(w) {
      const g = t.scopeValue("schema", i.code.source === !0 ? { ref: w, code: (0, Ge.stringify)(w) } : { ref: w }), $ = t.name("valid"), p = e.subschema({
        schema: w,
        dataTypes: [],
        schemaPath: Ge.nil,
        topSchemaRef: g,
        errSchemaPath: r
      }, $);
      e.mergeEvaluated(p), e.ok($);
    }
  }
};
function md(e, t) {
  const { gen: r } = e;
  return t.validate ? r.scopeValue("validate", { ref: t.validate }) : (0, Ge._)`${r.scopeValue("wrapper", { ref: t })}.validate`;
}
Sr.getValidate = md;
function os(e, t, r, n) {
  const { gen: s, it: o } = e, { allErrors: a, schemaEnv: i, opts: c } = o, d = c.passContext ? Rr.default.this : Ge.nil;
  n ? u() : f();
  function u() {
    if (!i.$async)
      throw new Error("async schema referenced by sync schema");
    const w = s.let("valid");
    s.try(() => {
      s.code((0, Ge._)`await ${(0, qc.callValidateCode)(e, t, d)}`), y(t), a || s.assign(w, !0);
    }, (g) => {
      s.if((0, Ge._)`!(${g} instanceof ${o.ValidationError})`, () => s.throw(g)), _(g), a || s.assign(w, !1);
    }), e.ok(w);
  }
  function f() {
    e.result((0, qc.callValidateCode)(e, t, d), () => y(t), () => _(t));
  }
  function _(w) {
    const g = (0, Ge._)`${w}.errors`;
    s.assign(Rr.default.vErrors, (0, Ge._)`${Rr.default.vErrors} === null ? ${g} : ${Rr.default.vErrors}.concat(${g})`), s.assign(Rr.default.errors, (0, Ge._)`${Rr.default.vErrors}.length`);
  }
  function y(w) {
    var g;
    if (!o.opts.unevaluated)
      return;
    const $ = (g = r == null ? void 0 : r.validate) === null || g === void 0 ? void 0 : g.evaluated;
    if (o.props !== !0)
      if ($ && !$.dynamicProps)
        $.props !== void 0 && (o.props = Vn.mergeEvaluated.props(s, $.props, o.props));
      else {
        const p = s.var("props", (0, Ge._)`${w}.evaluated.props`);
        o.props = Vn.mergeEvaluated.props(s, p, o.props, Ge.Name);
      }
    if (o.items !== !0)
      if ($ && !$.dynamicItems)
        $.items !== void 0 && (o.items = Vn.mergeEvaluated.items(s, $.items, o.items));
      else {
        const p = s.var("items", (0, Ge._)`${w}.evaluated.items`);
        o.items = Vn.mergeEvaluated.items(s, p, o.items, Ge.Name);
      }
  }
}
Sr.callRef = os;
Sr.default = $v;
Object.defineProperty(ai, "__esModule", { value: !0 });
const gv = ii, _v = Sr, vv = [
  "$schema",
  "$id",
  "$defs",
  "$vocabulary",
  { keyword: "$comment" },
  "definitions",
  gv.default,
  _v.default
];
ai.default = vv;
var ci = {}, li = {};
Object.defineProperty(li, "__esModule", { value: !0 });
const $s = se, Dt = $s.operators, gs = {
  maximum: { okStr: "<=", ok: Dt.LTE, fail: Dt.GT },
  minimum: { okStr: ">=", ok: Dt.GTE, fail: Dt.LT },
  exclusiveMaximum: { okStr: "<", ok: Dt.LT, fail: Dt.GTE },
  exclusiveMinimum: { okStr: ">", ok: Dt.GT, fail: Dt.LTE }
}, Ev = {
  message: ({ keyword: e, schemaCode: t }) => (0, $s.str)`must be ${gs[e].okStr} ${t}`,
  params: ({ keyword: e, schemaCode: t }) => (0, $s._)`{comparison: ${gs[e].okStr}, limit: ${t}}`
}, wv = {
  keyword: Object.keys(gs),
  type: "number",
  schemaType: "number",
  $data: !0,
  error: Ev,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e;
    e.fail$data((0, $s._)`${r} ${gs[t].fail} ${n} || isNaN(${r})`);
  }
};
li.default = wv;
var ui = {};
Object.defineProperty(ui, "__esModule", { value: !0 });
const $n = se, Sv = {
  message: ({ schemaCode: e }) => (0, $n.str)`must be multiple of ${e}`,
  params: ({ schemaCode: e }) => (0, $n._)`{multipleOf: ${e}}`
}, bv = {
  keyword: "multipleOf",
  type: "number",
  schemaType: "number",
  $data: !0,
  error: Sv,
  code(e) {
    const { gen: t, data: r, schemaCode: n, it: s } = e, o = s.opts.multipleOfPrecision, a = t.let("res"), i = o ? (0, $n._)`Math.abs(Math.round(${a}) - ${a}) > 1e-${o}` : (0, $n._)`${a} !== parseInt(${a})`;
    e.fail$data((0, $n._)`(${n} === 0 || (${a} = ${r}/${n}, ${i}))`);
  }
};
ui.default = bv;
var di = {}, fi = {};
Object.defineProperty(fi, "__esModule", { value: !0 });
function yd(e) {
  const t = e.length;
  let r = 0, n = 0, s;
  for (; n < t; )
    r++, s = e.charCodeAt(n++), s >= 55296 && s <= 56319 && n < t && (s = e.charCodeAt(n), (s & 64512) === 56320 && n++);
  return r;
}
fi.default = yd;
yd.code = 'require("ajv/dist/runtime/ucs2length").default';
Object.defineProperty(di, "__esModule", { value: !0 });
const yr = se, Pv = U, Nv = fi, Rv = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxLength" ? "more" : "fewer";
    return (0, yr.str)`must NOT have ${r} than ${t} characters`;
  },
  params: ({ schemaCode: e }) => (0, yr._)`{limit: ${e}}`
}, Tv = {
  keyword: ["maxLength", "minLength"],
  type: "string",
  schemaType: "number",
  $data: !0,
  error: Rv,
  code(e) {
    const { keyword: t, data: r, schemaCode: n, it: s } = e, o = t === "maxLength" ? yr.operators.GT : yr.operators.LT, a = s.opts.unicode === !1 ? (0, yr._)`${r}.length` : (0, yr._)`${(0, Pv.useFunc)(e.gen, Nv.default)}(${r})`;
    e.fail$data((0, yr._)`${a} ${o} ${n}`);
  }
};
di.default = Tv;
var hi = {};
Object.defineProperty(hi, "__esModule", { value: !0 });
const Ov = ae, _s = se, Iv = {
  message: ({ schemaCode: e }) => (0, _s.str)`must match pattern "${e}"`,
  params: ({ schemaCode: e }) => (0, _s._)`{pattern: ${e}}`
}, jv = {
  keyword: "pattern",
  type: "string",
  schemaType: "string",
  $data: !0,
  error: Iv,
  code(e) {
    const { data: t, $data: r, schema: n, schemaCode: s, it: o } = e, a = o.opts.unicodeRegExp ? "u" : "", i = r ? (0, _s._)`(new RegExp(${s}, ${a}))` : (0, Ov.usePattern)(e, n);
    e.fail$data((0, _s._)`!${i}.test(${t})`);
  }
};
hi.default = jv;
var pi = {};
Object.defineProperty(pi, "__esModule", { value: !0 });
const gn = se, Av = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxProperties" ? "more" : "fewer";
    return (0, gn.str)`must NOT have ${r} than ${t} properties`;
  },
  params: ({ schemaCode: e }) => (0, gn._)`{limit: ${e}}`
}, Cv = {
  keyword: ["maxProperties", "minProperties"],
  type: "object",
  schemaType: "number",
  $data: !0,
  error: Av,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e, s = t === "maxProperties" ? gn.operators.GT : gn.operators.LT;
    e.fail$data((0, gn._)`Object.keys(${r}).length ${s} ${n}`);
  }
};
pi.default = Cv;
var mi = {};
Object.defineProperty(mi, "__esModule", { value: !0 });
const sn = ae, _n = se, kv = U, Dv = {
  message: ({ params: { missingProperty: e } }) => (0, _n.str)`must have required property '${e}'`,
  params: ({ params: { missingProperty: e } }) => (0, _n._)`{missingProperty: ${e}}`
}, Mv = {
  keyword: "required",
  type: "object",
  schemaType: "array",
  $data: !0,
  error: Dv,
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
          (0, kv.checkStrictMode)(a, p, a.opts.strictRequired);
        }
    }
    function d() {
      if (c || o)
        e.block$data(_n.nil, f);
      else
        for (const y of r)
          (0, sn.checkReportMissingProp)(e, y);
    }
    function u() {
      const y = t.let("missing");
      if (c || o) {
        const w = t.let("valid", !0);
        e.block$data(w, () => _(y, w)), e.ok(w);
      } else
        t.if((0, sn.checkMissingProp)(e, r, y)), (0, sn.reportMissingProp)(e, y), t.else();
    }
    function f() {
      t.forOf("prop", n, (y) => {
        e.setParams({ missingProperty: y }), t.if((0, sn.noPropertyInData)(t, s, y, i.ownProperties), () => e.error());
      });
    }
    function _(y, w) {
      e.setParams({ missingProperty: y }), t.forOf(y, n, () => {
        t.assign(w, (0, sn.propertyInData)(t, s, y, i.ownProperties)), t.if((0, _n.not)(w), () => {
          e.error(), t.break();
        });
      }, _n.nil);
    }
  }
};
mi.default = Mv;
var yi = {};
Object.defineProperty(yi, "__esModule", { value: !0 });
const vn = se, Lv = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxItems" ? "more" : "fewer";
    return (0, vn.str)`must NOT have ${r} than ${t} items`;
  },
  params: ({ schemaCode: e }) => (0, vn._)`{limit: ${e}}`
}, Fv = {
  keyword: ["maxItems", "minItems"],
  type: "array",
  schemaType: "number",
  $data: !0,
  error: Lv,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e, s = t === "maxItems" ? vn.operators.GT : vn.operators.LT;
    e.fail$data((0, vn._)`${r}.length ${s} ${n}`);
  }
};
yi.default = Fv;
var $i = {}, Pn = {};
Object.defineProperty(Pn, "__esModule", { value: !0 });
const $d = bs;
$d.code = 'require("ajv/dist/runtime/equal").default';
Pn.default = $d;
Object.defineProperty($i, "__esModule", { value: !0 });
const co = Se, Ne = se, Vv = U, Uv = Pn, zv = {
  message: ({ params: { i: e, j: t } }) => (0, Ne.str)`must NOT have duplicate items (items ## ${t} and ${e} are identical)`,
  params: ({ params: { i: e, j: t } }) => (0, Ne._)`{i: ${e}, j: ${t}}`
}, qv = {
  keyword: "uniqueItems",
  type: "array",
  schemaType: "boolean",
  $data: !0,
  error: zv,
  code(e) {
    const { gen: t, data: r, $data: n, schema: s, parentSchema: o, schemaCode: a, it: i } = e;
    if (!n && !s)
      return;
    const c = t.let("valid"), d = o.items ? (0, co.getSchemaTypes)(o.items) : [];
    e.block$data(c, u, (0, Ne._)`${a} === false`), e.ok(c);
    function u() {
      const w = t.let("i", (0, Ne._)`${r}.length`), g = t.let("j");
      e.setParams({ i: w, j: g }), t.assign(c, !0), t.if((0, Ne._)`${w} > 1`, () => (f() ? _ : y)(w, g));
    }
    function f() {
      return d.length > 0 && !d.some((w) => w === "object" || w === "array");
    }
    function _(w, g) {
      const $ = t.name("item"), p = (0, co.checkDataTypes)(d, $, i.opts.strictNumbers, co.DataType.Wrong), E = t.const("indices", (0, Ne._)`{}`);
      t.for((0, Ne._)`;${w}--;`, () => {
        t.let($, (0, Ne._)`${r}[${w}]`), t.if(p, (0, Ne._)`continue`), d.length > 1 && t.if((0, Ne._)`typeof ${$} == "string"`, (0, Ne._)`${$} += "_"`), t.if((0, Ne._)`typeof ${E}[${$}] == "number"`, () => {
          t.assign(g, (0, Ne._)`${E}[${$}]`), e.error(), t.assign(c, !1).break();
        }).code((0, Ne._)`${E}[${$}] = ${w}`);
      });
    }
    function y(w, g) {
      const $ = (0, Vv.useFunc)(t, Uv.default), p = t.name("outer");
      t.label(p).for((0, Ne._)`;${w}--;`, () => t.for((0, Ne._)`${g} = ${w}; ${g}--;`, () => t.if((0, Ne._)`${$}(${r}[${w}], ${r}[${g}])`, () => {
        e.error(), t.assign(c, !1).break(p);
      })));
    }
  }
};
$i.default = qv;
var gi = {};
Object.defineProperty(gi, "__esModule", { value: !0 });
const Do = se, Gv = U, Kv = Pn, Hv = {
  message: "must be equal to constant",
  params: ({ schemaCode: e }) => (0, Do._)`{allowedValue: ${e}}`
}, Bv = {
  keyword: "const",
  $data: !0,
  error: Hv,
  code(e) {
    const { gen: t, data: r, $data: n, schemaCode: s, schema: o } = e;
    n || o && typeof o == "object" ? e.fail$data((0, Do._)`!${(0, Gv.useFunc)(t, Kv.default)}(${r}, ${s})`) : e.fail((0, Do._)`${o} !== ${r}`);
  }
};
gi.default = Bv;
var _i = {};
Object.defineProperty(_i, "__esModule", { value: !0 });
const ln = se, Wv = U, Jv = Pn, Xv = {
  message: "must be equal to one of the allowed values",
  params: ({ schemaCode: e }) => (0, ln._)`{allowedValues: ${e}}`
}, Yv = {
  keyword: "enum",
  schemaType: "array",
  $data: !0,
  error: Xv,
  code(e) {
    const { gen: t, data: r, $data: n, schema: s, schemaCode: o, it: a } = e;
    if (!n && s.length === 0)
      throw new Error("enum must have non-empty array");
    const i = s.length >= a.opts.loopEnum;
    let c;
    const d = () => c ?? (c = (0, Wv.useFunc)(t, Jv.default));
    let u;
    if (i || n)
      u = t.let("valid"), e.block$data(u, f);
    else {
      if (!Array.isArray(s))
        throw new Error("ajv implementation error");
      const y = t.const("vSchema", o);
      u = (0, ln.or)(...s.map((w, g) => _(y, g)));
    }
    e.pass(u);
    function f() {
      t.assign(u, !1), t.forOf("v", o, (y) => t.if((0, ln._)`${d()}(${r}, ${y})`, () => t.assign(u, !0).break()));
    }
    function _(y, w) {
      const g = s[w];
      return typeof g == "object" && g !== null ? (0, ln._)`${d()}(${r}, ${y}[${w}])` : (0, ln._)`${r} === ${g}`;
    }
  }
};
_i.default = Yv;
Object.defineProperty(ci, "__esModule", { value: !0 });
const xv = li, Qv = ui, Zv = di, eE = hi, tE = pi, rE = mi, nE = yi, sE = $i, oE = gi, aE = _i, iE = [
  // number
  xv.default,
  Qv.default,
  // string
  Zv.default,
  eE.default,
  // object
  tE.default,
  rE.default,
  // array
  nE.default,
  sE.default,
  // any
  { keyword: "type", schemaType: ["string", "array"] },
  { keyword: "nullable", schemaType: "boolean" },
  oE.default,
  aE.default
];
ci.default = iE;
var vi = {}, Xr = {};
Object.defineProperty(Xr, "__esModule", { value: !0 });
Xr.validateAdditionalItems = void 0;
const $r = se, Mo = U, cE = {
  message: ({ params: { len: e } }) => (0, $r.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, $r._)`{limit: ${e}}`
}, lE = {
  keyword: "additionalItems",
  type: "array",
  schemaType: ["boolean", "object"],
  before: "uniqueItems",
  error: cE,
  code(e) {
    const { parentSchema: t, it: r } = e, { items: n } = t;
    if (!Array.isArray(n)) {
      (0, Mo.checkStrictMode)(r, '"additionalItems" is ignored when "items" is not an array of schemas');
      return;
    }
    gd(e, n);
  }
};
function gd(e, t) {
  const { gen: r, schema: n, data: s, keyword: o, it: a } = e;
  a.items = !0;
  const i = r.const("len", (0, $r._)`${s}.length`);
  if (n === !1)
    e.setParams({ len: t.length }), e.pass((0, $r._)`${i} <= ${t.length}`);
  else if (typeof n == "object" && !(0, Mo.alwaysValidSchema)(a, n)) {
    const d = r.var("valid", (0, $r._)`${i} <= ${t.length}`);
    r.if((0, $r.not)(d), () => c(d)), e.ok(d);
  }
  function c(d) {
    r.forRange("i", t.length, i, (u) => {
      e.subschema({ keyword: o, dataProp: u, dataPropType: Mo.Type.Num }, d), a.allErrors || r.if((0, $r.not)(d), () => r.break());
    });
  }
}
Xr.validateAdditionalItems = gd;
Xr.default = lE;
var Ei = {}, Yr = {};
Object.defineProperty(Yr, "__esModule", { value: !0 });
Yr.validateTuple = void 0;
const Kc = se, as = U, uE = ae, dE = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "array", "boolean"],
  before: "uniqueItems",
  code(e) {
    const { schema: t, it: r } = e;
    if (Array.isArray(t))
      return _d(e, "additionalItems", t);
    r.items = !0, !(0, as.alwaysValidSchema)(r, t) && e.ok((0, uE.validateArray)(e));
  }
};
function _d(e, t, r = e.schema) {
  const { gen: n, parentSchema: s, data: o, keyword: a, it: i } = e;
  u(s), i.opts.unevaluated && r.length && i.items !== !0 && (i.items = as.mergeEvaluated.items(n, r.length, i.items));
  const c = n.name("valid"), d = n.const("len", (0, Kc._)`${o}.length`);
  r.forEach((f, _) => {
    (0, as.alwaysValidSchema)(i, f) || (n.if((0, Kc._)`${d} > ${_}`, () => e.subschema({
      keyword: a,
      schemaProp: _,
      dataProp: _
    }, c)), e.ok(c));
  });
  function u(f) {
    const { opts: _, errSchemaPath: y } = i, w = r.length, g = w === f.minItems && (w === f.maxItems || f[t] === !1);
    if (_.strictTuples && !g) {
      const $ = `"${a}" is ${w}-tuple, but minItems or maxItems/${t} are not specified or different at path "${y}"`;
      (0, as.checkStrictMode)(i, $, _.strictTuples);
    }
  }
}
Yr.validateTuple = _d;
Yr.default = dE;
Object.defineProperty(Ei, "__esModule", { value: !0 });
const fE = Yr, hE = {
  keyword: "prefixItems",
  type: "array",
  schemaType: ["array"],
  before: "uniqueItems",
  code: (e) => (0, fE.validateTuple)(e, "items")
};
Ei.default = hE;
var wi = {};
Object.defineProperty(wi, "__esModule", { value: !0 });
const Hc = se, pE = U, mE = ae, yE = Xr, $E = {
  message: ({ params: { len: e } }) => (0, Hc.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, Hc._)`{limit: ${e}}`
}, gE = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  error: $E,
  code(e) {
    const { schema: t, parentSchema: r, it: n } = e, { prefixItems: s } = r;
    n.items = !0, !(0, pE.alwaysValidSchema)(n, t) && (s ? (0, yE.validateAdditionalItems)(e, s) : e.ok((0, mE.validateArray)(e)));
  }
};
wi.default = gE;
var Si = {};
Object.defineProperty(Si, "__esModule", { value: !0 });
const xe = se, Un = U, _E = {
  message: ({ params: { min: e, max: t } }) => t === void 0 ? (0, xe.str)`must contain at least ${e} valid item(s)` : (0, xe.str)`must contain at least ${e} and no more than ${t} valid item(s)`,
  params: ({ params: { min: e, max: t } }) => t === void 0 ? (0, xe._)`{minContains: ${e}}` : (0, xe._)`{minContains: ${e}, maxContains: ${t}}`
}, vE = {
  keyword: "contains",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  trackErrors: !0,
  error: _E,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, it: o } = e;
    let a, i;
    const { minContains: c, maxContains: d } = n;
    o.opts.next ? (a = c === void 0 ? 1 : c, i = d) : a = 1;
    const u = t.const("len", (0, xe._)`${s}.length`);
    if (e.setParams({ min: a, max: i }), i === void 0 && a === 0) {
      (0, Un.checkStrictMode)(o, '"minContains" == 0 without "maxContains": "contains" keyword ignored');
      return;
    }
    if (i !== void 0 && a > i) {
      (0, Un.checkStrictMode)(o, '"minContains" > "maxContains" is always invalid'), e.fail();
      return;
    }
    if ((0, Un.alwaysValidSchema)(o, r)) {
      let g = (0, xe._)`${u} >= ${a}`;
      i !== void 0 && (g = (0, xe._)`${g} && ${u} <= ${i}`), e.pass(g);
      return;
    }
    o.items = !0;
    const f = t.name("valid");
    i === void 0 && a === 1 ? y(f, () => t.if(f, () => t.break())) : a === 0 ? (t.let(f, !0), i !== void 0 && t.if((0, xe._)`${s}.length > 0`, _)) : (t.let(f, !1), _()), e.result(f, () => e.reset());
    function _() {
      const g = t.name("_valid"), $ = t.let("count", 0);
      y(g, () => t.if(g, () => w($)));
    }
    function y(g, $) {
      t.forRange("i", 0, u, (p) => {
        e.subschema({
          keyword: "contains",
          dataProp: p,
          dataPropType: Un.Type.Num,
          compositeRule: !0
        }, g), $();
      });
    }
    function w(g) {
      t.code((0, xe._)`${g}++`), i === void 0 ? t.if((0, xe._)`${g} >= ${a}`, () => t.assign(f, !0).break()) : (t.if((0, xe._)`${g} > ${i}`, () => t.assign(f, !1).break()), a === 1 ? t.assign(f, !0) : t.if((0, xe._)`${g} >= ${a}`, () => t.assign(f, !0)));
    }
  }
};
Si.default = vE;
var vd = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.validateSchemaDeps = e.validatePropertyDeps = e.error = void 0;
  const t = se, r = U, n = ae;
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
})(vd);
var bi = {};
Object.defineProperty(bi, "__esModule", { value: !0 });
const Ed = se, EE = U, wE = {
  message: "property name must be valid",
  params: ({ params: e }) => (0, Ed._)`{propertyName: ${e.propertyName}}`
}, SE = {
  keyword: "propertyNames",
  type: "object",
  schemaType: ["object", "boolean"],
  error: wE,
  code(e) {
    const { gen: t, schema: r, data: n, it: s } = e;
    if ((0, EE.alwaysValidSchema)(s, r))
      return;
    const o = t.name("valid");
    t.forIn("key", n, (a) => {
      e.setParams({ propertyName: a }), e.subschema({
        keyword: "propertyNames",
        data: a,
        dataTypes: ["string"],
        propertyName: a,
        compositeRule: !0
      }, o), t.if((0, Ed.not)(o), () => {
        e.error(!0), s.allErrors || t.break();
      });
    }), e.ok(o);
  }
};
bi.default = SE;
var ks = {};
Object.defineProperty(ks, "__esModule", { value: !0 });
const zn = ae, rt = se, bE = vt, qn = U, PE = {
  message: "must NOT have additional properties",
  params: ({ params: e }) => (0, rt._)`{additionalProperty: ${e.additionalProperty}}`
}, NE = {
  keyword: "additionalProperties",
  type: ["object"],
  schemaType: ["boolean", "object"],
  allowUndefined: !0,
  trackErrors: !0,
  error: PE,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, errsCount: o, it: a } = e;
    if (!o)
      throw new Error("ajv implementation error");
    const { allErrors: i, opts: c } = a;
    if (a.props = !0, c.removeAdditional !== "all" && (0, qn.alwaysValidSchema)(a, r))
      return;
    const d = (0, zn.allSchemaProperties)(n.properties), u = (0, zn.allSchemaProperties)(n.patternProperties);
    f(), e.ok((0, rt._)`${o} === ${bE.default.errors}`);
    function f() {
      t.forIn("key", s, ($) => {
        !d.length && !u.length ? w($) : t.if(_($), () => w($));
      });
    }
    function _($) {
      let p;
      if (d.length > 8) {
        const E = (0, qn.schemaRefOrVal)(a, n.properties, "properties");
        p = (0, zn.isOwnProperty)(t, E, $);
      } else d.length ? p = (0, rt.or)(...d.map((E) => (0, rt._)`${$} === ${E}`)) : p = rt.nil;
      return u.length && (p = (0, rt.or)(p, ...u.map((E) => (0, rt._)`${(0, zn.usePattern)(e, E)}.test(${$})`))), (0, rt.not)(p);
    }
    function y($) {
      t.code((0, rt._)`delete ${s}[${$}]`);
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
      if (typeof r == "object" && !(0, qn.alwaysValidSchema)(a, r)) {
        const p = t.name("valid");
        c.removeAdditional === "failing" ? (g($, p, !1), t.if((0, rt.not)(p), () => {
          e.reset(), y($);
        })) : (g($, p), i || t.if((0, rt.not)(p), () => t.break()));
      }
    }
    function g($, p, E) {
      const N = {
        keyword: "additionalProperties",
        dataProp: $,
        dataPropType: qn.Type.Str
      };
      E === !1 && Object.assign(N, {
        compositeRule: !0,
        createErrors: !1,
        allErrors: !1
      }), e.subschema(N, p);
    }
  }
};
ks.default = NE;
var Pi = {};
Object.defineProperty(Pi, "__esModule", { value: !0 });
const RE = it, Bc = ae, lo = U, Wc = ks, TE = {
  keyword: "properties",
  type: "object",
  schemaType: "object",
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, it: o } = e;
    o.opts.removeAdditional === "all" && n.additionalProperties === void 0 && Wc.default.code(new RE.KeywordCxt(o, Wc.default, "additionalProperties"));
    const a = (0, Bc.allSchemaProperties)(r);
    for (const f of a)
      o.definedProperties.add(f);
    o.opts.unevaluated && a.length && o.props !== !0 && (o.props = lo.mergeEvaluated.props(t, (0, lo.toHash)(a), o.props));
    const i = a.filter((f) => !(0, lo.alwaysValidSchema)(o, r[f]));
    if (i.length === 0)
      return;
    const c = t.name("valid");
    for (const f of i)
      d(f) ? u(f) : (t.if((0, Bc.propertyInData)(t, s, f, o.opts.ownProperties)), u(f), o.allErrors || t.else().var(c, !0), t.endIf()), e.it.definedProperties.add(f), e.ok(c);
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
Pi.default = TE;
var Ni = {};
Object.defineProperty(Ni, "__esModule", { value: !0 });
const Jc = ae, Gn = se, Xc = U, Yc = U, OE = {
  keyword: "patternProperties",
  type: "object",
  schemaType: "object",
  code(e) {
    const { gen: t, schema: r, data: n, parentSchema: s, it: o } = e, { opts: a } = o, i = (0, Jc.allSchemaProperties)(r), c = i.filter((g) => (0, Xc.alwaysValidSchema)(o, r[g]));
    if (i.length === 0 || c.length === i.length && (!o.opts.unevaluated || o.props === !0))
      return;
    const d = a.strictSchema && !a.allowMatchingProperties && s.properties, u = t.name("valid");
    o.props !== !0 && !(o.props instanceof Gn.Name) && (o.props = (0, Yc.evaluatedPropsToName)(t, o.props));
    const { props: f } = o;
    _();
    function _() {
      for (const g of i)
        d && y(g), o.allErrors ? w(g) : (t.var(u, !0), w(g), t.if(u));
    }
    function y(g) {
      for (const $ in d)
        new RegExp(g).test($) && (0, Xc.checkStrictMode)(o, `property ${$} matches pattern ${g} (use allowMatchingProperties)`);
    }
    function w(g) {
      t.forIn("key", n, ($) => {
        t.if((0, Gn._)`${(0, Jc.usePattern)(e, g)}.test(${$})`, () => {
          const p = c.includes(g);
          p || e.subschema({
            keyword: "patternProperties",
            schemaProp: g,
            dataProp: $,
            dataPropType: Yc.Type.Str
          }, u), o.opts.unevaluated && f !== !0 ? t.assign((0, Gn._)`${f}[${$}]`, !0) : !p && !o.allErrors && t.if((0, Gn.not)(u), () => t.break());
        });
      });
    }
  }
};
Ni.default = OE;
var Ri = {};
Object.defineProperty(Ri, "__esModule", { value: !0 });
const IE = U, jE = {
  keyword: "not",
  schemaType: ["object", "boolean"],
  trackErrors: !0,
  code(e) {
    const { gen: t, schema: r, it: n } = e;
    if ((0, IE.alwaysValidSchema)(n, r)) {
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
Ri.default = jE;
var Ti = {};
Object.defineProperty(Ti, "__esModule", { value: !0 });
const AE = ae, CE = {
  keyword: "anyOf",
  schemaType: "array",
  trackErrors: !0,
  code: AE.validateUnion,
  error: { message: "must match a schema in anyOf" }
};
Ti.default = CE;
var Oi = {};
Object.defineProperty(Oi, "__esModule", { value: !0 });
const is = se, kE = U, DE = {
  message: "must match exactly one schema in oneOf",
  params: ({ params: e }) => (0, is._)`{passingSchemas: ${e.passing}}`
}, ME = {
  keyword: "oneOf",
  schemaType: "array",
  trackErrors: !0,
  error: DE,
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
        (0, kE.alwaysValidSchema)(s, u) ? t.var(c, !0) : _ = e.subschema({
          keyword: "oneOf",
          schemaProp: f,
          compositeRule: !0
        }, c), f > 0 && t.if((0, is._)`${c} && ${a}`).assign(a, !1).assign(i, (0, is._)`[${i}, ${f}]`).else(), t.if(c, () => {
          t.assign(a, !0), t.assign(i, f), _ && e.mergeEvaluated(_, is.Name);
        });
      });
    }
  }
};
Oi.default = ME;
var Ii = {};
Object.defineProperty(Ii, "__esModule", { value: !0 });
const LE = U, FE = {
  keyword: "allOf",
  schemaType: "array",
  code(e) {
    const { gen: t, schema: r, it: n } = e;
    if (!Array.isArray(r))
      throw new Error("ajv implementation error");
    const s = t.name("valid");
    r.forEach((o, a) => {
      if ((0, LE.alwaysValidSchema)(n, o))
        return;
      const i = e.subschema({ keyword: "allOf", schemaProp: a }, s);
      e.ok(s), e.mergeEvaluated(i);
    });
  }
};
Ii.default = FE;
var ji = {};
Object.defineProperty(ji, "__esModule", { value: !0 });
const vs = se, wd = U, VE = {
  message: ({ params: e }) => (0, vs.str)`must match "${e.ifClause}" schema`,
  params: ({ params: e }) => (0, vs._)`{failingKeyword: ${e.ifClause}}`
}, UE = {
  keyword: "if",
  schemaType: ["object", "boolean"],
  trackErrors: !0,
  error: VE,
  code(e) {
    const { gen: t, parentSchema: r, it: n } = e;
    r.then === void 0 && r.else === void 0 && (0, wd.checkStrictMode)(n, '"if" without "then" and "else" is ignored');
    const s = xc(n, "then"), o = xc(n, "else");
    if (!s && !o)
      return;
    const a = t.let("valid", !0), i = t.name("_valid");
    if (c(), e.reset(), s && o) {
      const u = t.let("ifClause");
      e.setParams({ ifClause: u }), t.if(i, d("then", u), d("else", u));
    } else s ? t.if(i, d("then")) : t.if((0, vs.not)(i), d("else"));
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
        t.assign(a, i), e.mergeValidEvaluated(_, a), f ? t.assign(f, (0, vs._)`${u}`) : e.setParams({ ifClause: u });
      };
    }
  }
};
function xc(e, t) {
  const r = e.schema[t];
  return r !== void 0 && !(0, wd.alwaysValidSchema)(e, r);
}
ji.default = UE;
var Ai = {};
Object.defineProperty(Ai, "__esModule", { value: !0 });
const zE = U, qE = {
  keyword: ["then", "else"],
  schemaType: ["object", "boolean"],
  code({ keyword: e, parentSchema: t, it: r }) {
    t.if === void 0 && (0, zE.checkStrictMode)(r, `"${e}" without "if" is ignored`);
  }
};
Ai.default = qE;
Object.defineProperty(vi, "__esModule", { value: !0 });
const GE = Xr, KE = Ei, HE = Yr, BE = wi, WE = Si, JE = vd, XE = bi, YE = ks, xE = Pi, QE = Ni, ZE = Ri, ew = Ti, tw = Oi, rw = Ii, nw = ji, sw = Ai;
function ow(e = !1) {
  const t = [
    // any
    ZE.default,
    ew.default,
    tw.default,
    rw.default,
    nw.default,
    sw.default,
    // object
    XE.default,
    YE.default,
    JE.default,
    xE.default,
    QE.default
  ];
  return e ? t.push(KE.default, BE.default) : t.push(GE.default, HE.default), t.push(WE.default), t;
}
vi.default = ow;
var Ci = {}, ki = {};
Object.defineProperty(ki, "__esModule", { value: !0 });
const _e = se, aw = {
  message: ({ schemaCode: e }) => (0, _e.str)`must match format "${e}"`,
  params: ({ schemaCode: e }) => (0, _e._)`{format: ${e}}`
}, iw = {
  keyword: "format",
  type: ["number", "string"],
  schemaType: "string",
  $data: !0,
  error: aw,
  code(e, t) {
    const { gen: r, data: n, $data: s, schema: o, schemaCode: a, it: i } = e, { opts: c, errSchemaPath: d, schemaEnv: u, self: f } = i;
    if (!c.validateFormats)
      return;
    s ? _() : y();
    function _() {
      const w = r.scopeValue("formats", {
        ref: f.formats,
        code: c.code.formats
      }), g = r.const("fDef", (0, _e._)`${w}[${a}]`), $ = r.let("fType"), p = r.let("format");
      r.if((0, _e._)`typeof ${g} == "object" && !(${g} instanceof RegExp)`, () => r.assign($, (0, _e._)`${g}.type || "string"`).assign(p, (0, _e._)`${g}.validate`), () => r.assign($, (0, _e._)`"string"`).assign(p, g)), e.fail$data((0, _e.or)(E(), N()));
      function E() {
        return c.strictSchema === !1 ? _e.nil : (0, _e._)`${a} && !${p}`;
      }
      function N() {
        const R = u.$async ? (0, _e._)`(${g}.async ? await ${p}(${n}) : ${p}(${n}))` : (0, _e._)`${p}(${n})`, T = (0, _e._)`(typeof ${p} == "function" ? ${R} : ${p}.test(${n}))`;
        return (0, _e._)`${p} && ${p} !== true && ${$} === ${t} && !${T}`;
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
        const C = T instanceof RegExp ? (0, _e.regexpCode)(T) : c.code.formats ? (0, _e._)`${c.code.formats}${(0, _e.getProperty)(o)}` : void 0, k = r.scopeValue("formats", { key: o, ref: T, code: C });
        return typeof T == "object" && !(T instanceof RegExp) ? [T.type || "string", T.validate, (0, _e._)`${k}.validate`] : ["string", T, k];
      }
      function R() {
        if (typeof w == "object" && !(w instanceof RegExp) && w.async) {
          if (!u.$async)
            throw new Error("async format in sync schema");
          return (0, _e._)`await ${p}(${n})`;
        }
        return typeof $ == "function" ? (0, _e._)`${p}(${n})` : (0, _e._)`${p}.test(${n})`;
      }
    }
  }
};
ki.default = iw;
Object.defineProperty(Ci, "__esModule", { value: !0 });
const cw = ki, lw = [cw.default];
Ci.default = lw;
var qr = {};
Object.defineProperty(qr, "__esModule", { value: !0 });
qr.contentVocabulary = qr.metadataVocabulary = void 0;
qr.metadataVocabulary = [
  "title",
  "description",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
  "examples"
];
qr.contentVocabulary = [
  "contentMediaType",
  "contentEncoding",
  "contentSchema"
];
Object.defineProperty(oi, "__esModule", { value: !0 });
const uw = ai, dw = ci, fw = vi, hw = Ci, Qc = qr, pw = [
  uw.default,
  dw.default,
  (0, fw.default)(),
  hw.default,
  Qc.metadataVocabulary,
  Qc.contentVocabulary
];
oi.default = pw;
var Di = {}, Ds = {};
Object.defineProperty(Ds, "__esModule", { value: !0 });
Ds.DiscrError = void 0;
var Zc;
(function(e) {
  e.Tag = "tag", e.Mapping = "mapping";
})(Zc || (Ds.DiscrError = Zc = {}));
Object.defineProperty(Di, "__esModule", { value: !0 });
const Ir = se, Lo = Ds, el = Ke, mw = Jr, yw = U, $w = {
  message: ({ params: { discrError: e, tagName: t } }) => e === Lo.DiscrError.Tag ? `tag "${t}" must be string` : `value of tag "${t}" must be in oneOf`,
  params: ({ params: { discrError: e, tag: t, tagName: r } }) => (0, Ir._)`{error: ${e}, tag: ${r}, tagValue: ${t}}`
}, gw = {
  keyword: "discriminator",
  type: "object",
  schemaType: "object",
  error: $w,
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
    const c = t.let("valid", !1), d = t.const("tag", (0, Ir._)`${r}${(0, Ir.getProperty)(i)}`);
    t.if((0, Ir._)`typeof ${d} == "string"`, () => u(), () => e.error(!1, { discrError: Lo.DiscrError.Tag, tag: d, tagName: i })), e.ok(c);
    function u() {
      const y = _();
      t.if(!1);
      for (const w in y)
        t.elseIf((0, Ir._)`${d} === ${w}`), t.assign(c, f(y[w]));
      t.else(), e.error(!1, { discrError: Lo.DiscrError.Mapping, tag: d, tagName: i }), t.endIf();
    }
    function f(y) {
      const w = t.name("valid"), g = e.subschema({ keyword: "oneOf", schemaProp: y }, w);
      return e.mergeEvaluated(g, Ir.Name), w;
    }
    function _() {
      var y;
      const w = {}, g = p(s);
      let $ = !0;
      for (let R = 0; R < a.length; R++) {
        let T = a[R];
        if (T != null && T.$ref && !(0, yw.schemaHasRulesButRef)(T, o.self.RULES)) {
          const k = T.$ref;
          if (T = el.resolveRef.call(o.self, o.schemaEnv.root, o.baseId, k), T instanceof el.SchemaEnv && (T = T.schema), T === void 0)
            throw new mw.default(o.opts.uriResolver, o.baseId, k);
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
Di.default = gw;
const _w = "http://json-schema.org/draft-07/schema#", vw = "http://json-schema.org/draft-07/schema#", Ew = "Core schema meta-schema", ww = {
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
}, Sw = [
  "object",
  "boolean"
], bw = {
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
}, Pw = {
  $schema: _w,
  $id: vw,
  title: Ew,
  definitions: ww,
  type: Sw,
  properties: bw,
  default: !0
};
(function(e, t) {
  Object.defineProperty(t, "__esModule", { value: !0 }), t.MissingRefError = t.ValidationError = t.CodeGen = t.Name = t.nil = t.stringify = t.str = t._ = t.KeywordCxt = t.Ajv = void 0;
  const r = Mu, n = oi, s = Di, o = Pw, a = ["/properties"], i = "http://json-schema.org/draft-07/schema";
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
  var d = it;
  Object.defineProperty(t, "KeywordCxt", { enumerable: !0, get: function() {
    return d.KeywordCxt;
  } });
  var u = se;
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
  var f = ri();
  Object.defineProperty(t, "ValidationError", { enumerable: !0, get: function() {
    return f.default;
  } });
  var _ = Jr;
  Object.defineProperty(t, "MissingRefError", { enumerable: !0, get: function() {
    return _.default;
  } });
})(Io, Io.exports);
var Nw = Io.exports;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.formatLimitDefinition = void 0;
  const t = Nw, r = se, n = r.operators, s = {
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
})(Du);
(function(e, t) {
  Object.defineProperty(t, "__esModule", { value: !0 });
  const r = ku, n = Du, s = se, o = new s.Name("fullFormats"), a = new s.Name("fastFormats"), i = (d, u = { keywords: !0 }) => {
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
})(Oo, Oo.exports);
var Rw = Oo.exports;
const Tw = /* @__PURE__ */ kl(Rw), Ow = (e, t, r, n) => {
  if (r === "length" || r === "prototype" || r === "arguments" || r === "caller")
    return;
  const s = Object.getOwnPropertyDescriptor(e, r), o = Object.getOwnPropertyDescriptor(t, r);
  !Iw(s, o) && n || Object.defineProperty(e, r, o);
}, Iw = function(e, t) {
  return e === void 0 || e.configurable || e.writable === t.writable && e.enumerable === t.enumerable && e.configurable === t.configurable && (e.writable || e.value === t.value);
}, jw = (e, t) => {
  const r = Object.getPrototypeOf(t);
  r !== Object.getPrototypeOf(e) && Object.setPrototypeOf(e, r);
}, Aw = (e, t) => `/* Wrapped ${e}*/
${t}`, Cw = Object.getOwnPropertyDescriptor(Function.prototype, "toString"), kw = Object.getOwnPropertyDescriptor(Function.prototype.toString, "name"), Dw = (e, t, r) => {
  const n = r === "" ? "" : `with ${r.trim()}() `, s = Aw.bind(null, n, t.toString());
  Object.defineProperty(s, "name", kw);
  const { writable: o, enumerable: a, configurable: i } = Cw;
  Object.defineProperty(e, "toString", { value: s, writable: o, enumerable: a, configurable: i });
};
function Mw(e, t, { ignoreNonConfigurable: r = !1 } = {}) {
  const { name: n } = e;
  for (const s of Reflect.ownKeys(t))
    Ow(e, t, s, r);
  return jw(e, t), Dw(e, t, n), e;
}
const tl = (e, t = {}) => {
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
  return Mw(d, e), d.cancel = () => {
    a && (clearTimeout(a), a = void 0), i && (clearTimeout(i), i = void 0);
  }, d;
};
var Fo = { exports: {} };
const Lw = "2.0.0", Sd = 256, Fw = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
9007199254740991, Vw = 16, Uw = Sd - 6, zw = [
  "major",
  "premajor",
  "minor",
  "preminor",
  "patch",
  "prepatch",
  "prerelease"
];
var Ms = {
  MAX_LENGTH: Sd,
  MAX_SAFE_COMPONENT_LENGTH: Vw,
  MAX_SAFE_BUILD_LENGTH: Uw,
  MAX_SAFE_INTEGER: Fw,
  RELEASE_TYPES: zw,
  SEMVER_SPEC_VERSION: Lw,
  FLAG_INCLUDE_PRERELEASE: 1,
  FLAG_LOOSE: 2
};
const qw = typeof process == "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...e) => console.error("SEMVER", ...e) : () => {
};
var Ls = qw;
(function(e, t) {
  const {
    MAX_SAFE_COMPONENT_LENGTH: r,
    MAX_SAFE_BUILD_LENGTH: n,
    MAX_LENGTH: s
  } = Ms, o = Ls;
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
})(Fo, Fo.exports);
var Nn = Fo.exports;
const Gw = Object.freeze({ loose: !0 }), Kw = Object.freeze({}), Hw = (e) => e ? typeof e != "object" ? Gw : e : Kw;
var Mi = Hw;
const rl = /^[0-9]+$/, bd = (e, t) => {
  if (typeof e == "number" && typeof t == "number")
    return e === t ? 0 : e < t ? -1 : 1;
  const r = rl.test(e), n = rl.test(t);
  return r && n && (e = +e, t = +t), e === t ? 0 : r && !n ? -1 : n && !r ? 1 : e < t ? -1 : 1;
}, Bw = (e, t) => bd(t, e);
var Pd = {
  compareIdentifiers: bd,
  rcompareIdentifiers: Bw
};
const Kn = Ls, { MAX_LENGTH: nl, MAX_SAFE_INTEGER: Hn } = Ms, { safeRe: Bn, t: Wn } = Nn, Ww = Mi, { compareIdentifiers: uo } = Pd;
let Jw = class ft {
  constructor(t, r) {
    if (r = Ww(r), t instanceof ft) {
      if (t.loose === !!r.loose && t.includePrerelease === !!r.includePrerelease)
        return t;
      t = t.version;
    } else if (typeof t != "string")
      throw new TypeError(`Invalid version. Must be a string. Got type "${typeof t}".`);
    if (t.length > nl)
      throw new TypeError(
        `version is longer than ${nl} characters`
      );
    Kn("SemVer", t, r), this.options = r, this.loose = !!r.loose, this.includePrerelease = !!r.includePrerelease;
    const n = t.trim().match(r.loose ? Bn[Wn.LOOSE] : Bn[Wn.FULL]);
    if (!n)
      throw new TypeError(`Invalid Version: ${t}`);
    if (this.raw = t, this.major = +n[1], this.minor = +n[2], this.patch = +n[3], this.major > Hn || this.major < 0)
      throw new TypeError("Invalid major version");
    if (this.minor > Hn || this.minor < 0)
      throw new TypeError("Invalid minor version");
    if (this.patch > Hn || this.patch < 0)
      throw new TypeError("Invalid patch version");
    n[4] ? this.prerelease = n[4].split(".").map((s) => {
      if (/^[0-9]+$/.test(s)) {
        const o = +s;
        if (o >= 0 && o < Hn)
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
    if (Kn("SemVer.compare", this.version, this.options, t), !(t instanceof ft)) {
      if (typeof t == "string" && t === this.version)
        return 0;
      t = new ft(t, this.options);
    }
    return t.version === this.version ? 0 : this.compareMain(t) || this.comparePre(t);
  }
  compareMain(t) {
    return t instanceof ft || (t = new ft(t, this.options)), this.major < t.major ? -1 : this.major > t.major ? 1 : this.minor < t.minor ? -1 : this.minor > t.minor ? 1 : this.patch < t.patch ? -1 : this.patch > t.patch ? 1 : 0;
  }
  comparePre(t) {
    if (t instanceof ft || (t = new ft(t, this.options)), this.prerelease.length && !t.prerelease.length)
      return -1;
    if (!this.prerelease.length && t.prerelease.length)
      return 1;
    if (!this.prerelease.length && !t.prerelease.length)
      return 0;
    let r = 0;
    do {
      const n = this.prerelease[r], s = t.prerelease[r];
      if (Kn("prerelease compare", r, n, s), n === void 0 && s === void 0)
        return 0;
      if (s === void 0)
        return 1;
      if (n === void 0)
        return -1;
      if (n === s)
        continue;
      return uo(n, s);
    } while (++r);
  }
  compareBuild(t) {
    t instanceof ft || (t = new ft(t, this.options));
    let r = 0;
    do {
      const n = this.build[r], s = t.build[r];
      if (Kn("build compare", r, n, s), n === void 0 && s === void 0)
        return 0;
      if (s === void 0)
        return 1;
      if (n === void 0)
        return -1;
      if (n === s)
        continue;
      return uo(n, s);
    } while (++r);
  }
  // preminor will bump the version up to the next minor release, and immediately
  // down to pre-release. premajor and prepatch work the same way.
  inc(t, r, n) {
    if (t.startsWith("pre")) {
      if (!r && n === !1)
        throw new Error("invalid increment argument: identifier is empty");
      if (r) {
        const s = `-${r}`.match(this.options.loose ? Bn[Wn.PRERELEASELOOSE] : Bn[Wn.PRERELEASE]);
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
          n === !1 && (o = [r]), uo(this.prerelease[0], r) === 0 ? isNaN(this.prerelease[1]) && (this.prerelease = o) : this.prerelease = o;
        }
        break;
      }
      default:
        throw new Error(`invalid increment argument: ${t}`);
    }
    return this.raw = this.format(), this.build.length && (this.raw += `+${this.build.join(".")}`), this;
  }
};
var Ue = Jw;
const sl = Ue, Xw = (e, t, r = !1) => {
  if (e instanceof sl)
    return e;
  try {
    return new sl(e, t);
  } catch (n) {
    if (!r)
      return null;
    throw n;
  }
};
var xr = Xw;
const Yw = xr, xw = (e, t) => {
  const r = Yw(e, t);
  return r ? r.version : null;
};
var Qw = xw;
const Zw = xr, eS = (e, t) => {
  const r = Zw(e.trim().replace(/^[=v]+/, ""), t);
  return r ? r.version : null;
};
var tS = eS;
const ol = Ue, rS = (e, t, r, n, s) => {
  typeof r == "string" && (s = n, n = r, r = void 0);
  try {
    return new ol(
      e instanceof ol ? e.version : e,
      r
    ).inc(t, n, s).version;
  } catch {
    return null;
  }
};
var nS = rS;
const al = xr, sS = (e, t) => {
  const r = al(e, null, !0), n = al(t, null, !0), s = r.compare(n);
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
var oS = sS;
const aS = Ue, iS = (e, t) => new aS(e, t).major;
var cS = iS;
const lS = Ue, uS = (e, t) => new lS(e, t).minor;
var dS = uS;
const fS = Ue, hS = (e, t) => new fS(e, t).patch;
var pS = hS;
const mS = xr, yS = (e, t) => {
  const r = mS(e, t);
  return r && r.prerelease.length ? r.prerelease : null;
};
var $S = yS;
const il = Ue, gS = (e, t, r) => new il(e, r).compare(new il(t, r));
var lt = gS;
const _S = lt, vS = (e, t, r) => _S(t, e, r);
var ES = vS;
const wS = lt, SS = (e, t) => wS(e, t, !0);
var bS = SS;
const cl = Ue, PS = (e, t, r) => {
  const n = new cl(e, r), s = new cl(t, r);
  return n.compare(s) || n.compareBuild(s);
};
var Li = PS;
const NS = Li, RS = (e, t) => e.sort((r, n) => NS(r, n, t));
var TS = RS;
const OS = Li, IS = (e, t) => e.sort((r, n) => OS(n, r, t));
var jS = IS;
const AS = lt, CS = (e, t, r) => AS(e, t, r) > 0;
var Fs = CS;
const kS = lt, DS = (e, t, r) => kS(e, t, r) < 0;
var Fi = DS;
const MS = lt, LS = (e, t, r) => MS(e, t, r) === 0;
var Nd = LS;
const FS = lt, VS = (e, t, r) => FS(e, t, r) !== 0;
var Rd = VS;
const US = lt, zS = (e, t, r) => US(e, t, r) >= 0;
var Vi = zS;
const qS = lt, GS = (e, t, r) => qS(e, t, r) <= 0;
var Ui = GS;
const KS = Nd, HS = Rd, BS = Fs, WS = Vi, JS = Fi, XS = Ui, YS = (e, t, r, n) => {
  switch (t) {
    case "===":
      return typeof e == "object" && (e = e.version), typeof r == "object" && (r = r.version), e === r;
    case "!==":
      return typeof e == "object" && (e = e.version), typeof r == "object" && (r = r.version), e !== r;
    case "":
    case "=":
    case "==":
      return KS(e, r, n);
    case "!=":
      return HS(e, r, n);
    case ">":
      return BS(e, r, n);
    case ">=":
      return WS(e, r, n);
    case "<":
      return JS(e, r, n);
    case "<=":
      return XS(e, r, n);
    default:
      throw new TypeError(`Invalid operator: ${t}`);
  }
};
var Td = YS;
const xS = Ue, QS = xr, { safeRe: Jn, t: Xn } = Nn, ZS = (e, t) => {
  if (e instanceof xS)
    return e;
  if (typeof e == "number" && (e = String(e)), typeof e != "string")
    return null;
  t = t || {};
  let r = null;
  if (!t.rtl)
    r = e.match(t.includePrerelease ? Jn[Xn.COERCEFULL] : Jn[Xn.COERCE]);
  else {
    const c = t.includePrerelease ? Jn[Xn.COERCERTLFULL] : Jn[Xn.COERCERTL];
    let d;
    for (; (d = c.exec(e)) && (!r || r.index + r[0].length !== e.length); )
      (!r || d.index + d[0].length !== r.index + r[0].length) && (r = d), c.lastIndex = d.index + d[1].length + d[2].length;
    c.lastIndex = -1;
  }
  if (r === null)
    return null;
  const n = r[2], s = r[3] || "0", o = r[4] || "0", a = t.includePrerelease && r[5] ? `-${r[5]}` : "", i = t.includePrerelease && r[6] ? `+${r[6]}` : "";
  return QS(`${n}.${s}.${o}${a}${i}`, t);
};
var eb = ZS;
class tb {
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
var rb = tb, fo, ll;
function ut() {
  if (ll) return fo;
  ll = 1;
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
      A = A.replace(P, q(this.options.includePrerelease)), a("hyphen replace", A), A = A.replace(c[d.COMPARATORTRIM], u), a("comparator trim", A), A = A.replace(c[d.TILDETRIM], f), a("tilde trim", A), A = A.replace(c[d.CARETTRIM], _), a("caret trim", A);
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
        if (ie(this.set[V], A, this.options))
          return !0;
      return !1;
    }
  }
  fo = t;
  const r = rb, n = new r(), s = Mi, o = Vs(), a = Ls, i = Ue, {
    safeRe: c,
    t: d,
    comparatorTrimReplace: u,
    tildeTrimReplace: f,
    caretTrimReplace: _
  } = Nn, { FLAG_INCLUDE_PRERELEASE: y, FLAG_LOOSE: w } = Ms, g = (O) => O.value === "<0.0.0-0", $ = (O) => O.value === "", p = (O, A) => {
    let V = !0;
    const D = O.slice();
    let G = D.pop();
    for (; V && D.length; )
      V = D.every((M) => G.intersects(M, A)), G = D.pop();
    return V;
  }, E = (O, A) => (O = O.replace(c[d.BUILD], ""), a("comp", O, A), O = C(O, A), a("caret", O), O = R(O, A), a("tildes", O), O = le(O, A), a("xrange", O), O = ye(O, A), a("stars", O), O), N = (O) => !O || O.toLowerCase() === "x" || O === "*", R = (O, A) => O.trim().split(/\s+/).map((V) => T(V, A)).join(" "), T = (O, A) => {
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
  }, le = (O, A) => (a("replaceXRanges", O, A), O.split(/\s+/).map((V) => ue(V, A)).join(" ")), ue = (O, A) => {
    O = O.trim();
    const V = A.loose ? c[d.XRANGELOOSE] : c[d.XRANGE];
    return O.replace(V, (D, G, M, P, m, S) => {
      a("xRange", O, D, G, M, P, m, S);
      const v = N(M), l = v || N(P), h = l || N(m), b = h;
      return G === "=" && b && (G = ""), S = A.includePrerelease ? "-0" : "", v ? G === ">" || G === "<" ? D = "<0.0.0-0" : D = "*" : G && b ? (l && (P = 0), m = 0, G === ">" ? (G = ">=", l ? (M = +M + 1, P = 0, m = 0) : (P = +P + 1, m = 0)) : G === "<=" && (G = "<", l ? M = +M + 1 : P = +P + 1), G === "<" && (S = "-0"), D = `${G + M}.${P}.${m}${S}`) : l ? D = `>=${M}.0.0${S} <${+M + 1}.0.0-0` : h && (D = `>=${M}.${P}.0${S} <${M}.${+P + 1}.0-0`), a("xRange return", D), D;
    });
  }, ye = (O, A) => (a("replaceStars", O, A), O.trim().replace(c[d.STAR], "")), L = (O, A) => (a("replaceGTE0", O, A), O.trim().replace(c[A.includePrerelease ? d.GTE0PRE : d.GTE0], "")), q = (O) => (A, V, D, G, M, P, m, S, v, l, h, b) => (N(D) ? V = "" : N(G) ? V = `>=${D}.0.0${O ? "-0" : ""}` : N(M) ? V = `>=${D}.${G}.0${O ? "-0" : ""}` : P ? V = `>=${V}` : V = `>=${V}${O ? "-0" : ""}`, N(v) ? S = "" : N(l) ? S = `<${+v + 1}.0.0-0` : N(h) ? S = `<${v}.${+l + 1}.0-0` : b ? S = `<=${v}.${l}.${h}-${b}` : O ? S = `<${v}.${l}.${+h + 1}-0` : S = `<=${S}`, `${V} ${S}`.trim()), ie = (O, A, V) => {
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
  return fo;
}
var ho, ul;
function Vs() {
  if (ul) return ho;
  ul = 1;
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
  ho = t;
  const r = Mi, { safeRe: n, t: s } = Nn, o = Td, a = Ls, i = Ue, c = ut();
  return ho;
}
const nb = ut(), sb = (e, t, r) => {
  try {
    t = new nb(t, r);
  } catch {
    return !1;
  }
  return t.test(e);
};
var Us = sb;
const ob = ut(), ab = (e, t) => new ob(e, t).set.map((r) => r.map((n) => n.value).join(" ").trim().split(" "));
var ib = ab;
const cb = Ue, lb = ut(), ub = (e, t, r) => {
  let n = null, s = null, o = null;
  try {
    o = new lb(t, r);
  } catch {
    return null;
  }
  return e.forEach((a) => {
    o.test(a) && (!n || s.compare(a) === -1) && (n = a, s = new cb(n, r));
  }), n;
};
var db = ub;
const fb = Ue, hb = ut(), pb = (e, t, r) => {
  let n = null, s = null, o = null;
  try {
    o = new hb(t, r);
  } catch {
    return null;
  }
  return e.forEach((a) => {
    o.test(a) && (!n || s.compare(a) === 1) && (n = a, s = new fb(n, r));
  }), n;
};
var mb = pb;
const po = Ue, yb = ut(), dl = Fs, $b = (e, t) => {
  e = new yb(e, t);
  let r = new po("0.0.0");
  if (e.test(r) || (r = new po("0.0.0-0"), e.test(r)))
    return r;
  r = null;
  for (let n = 0; n < e.set.length; ++n) {
    const s = e.set[n];
    let o = null;
    s.forEach((a) => {
      const i = new po(a.semver.version);
      switch (a.operator) {
        case ">":
          i.prerelease.length === 0 ? i.patch++ : i.prerelease.push(0), i.raw = i.format();
        case "":
        case ">=":
          (!o || dl(i, o)) && (o = i);
          break;
        case "<":
        case "<=":
          break;
        default:
          throw new Error(`Unexpected operation: ${a.operator}`);
      }
    }), o && (!r || dl(r, o)) && (r = o);
  }
  return r && e.test(r) ? r : null;
};
var gb = $b;
const _b = ut(), vb = (e, t) => {
  try {
    return new _b(e, t).range || "*";
  } catch {
    return null;
  }
};
var Eb = vb;
const wb = Ue, Od = Vs(), { ANY: Sb } = Od, bb = ut(), Pb = Us, fl = Fs, hl = Fi, Nb = Ui, Rb = Vi, Tb = (e, t, r, n) => {
  e = new wb(e, n), t = new bb(t, n);
  let s, o, a, i, c;
  switch (r) {
    case ">":
      s = fl, o = Nb, a = hl, i = ">", c = ">=";
      break;
    case "<":
      s = hl, o = Rb, a = fl, i = "<", c = "<=";
      break;
    default:
      throw new TypeError('Must provide a hilo val of "<" or ">"');
  }
  if (Pb(e, t, n))
    return !1;
  for (let d = 0; d < t.set.length; ++d) {
    const u = t.set[d];
    let f = null, _ = null;
    if (u.forEach((y) => {
      y.semver === Sb && (y = new Od(">=0.0.0")), f = f || y, _ = _ || y, s(y.semver, f.semver, n) ? f = y : a(y.semver, _.semver, n) && (_ = y);
    }), f.operator === i || f.operator === c || (!_.operator || _.operator === i) && o(e, _.semver))
      return !1;
    if (_.operator === c && a(e, _.semver))
      return !1;
  }
  return !0;
};
var zi = Tb;
const Ob = zi, Ib = (e, t, r) => Ob(e, t, ">", r);
var jb = Ib;
const Ab = zi, Cb = (e, t, r) => Ab(e, t, "<", r);
var kb = Cb;
const pl = ut(), Db = (e, t, r) => (e = new pl(e, r), t = new pl(t, r), e.intersects(t, r));
var Mb = Db;
const Lb = Us, Fb = lt;
var Vb = (e, t, r) => {
  const n = [];
  let s = null, o = null;
  const a = e.sort((u, f) => Fb(u, f, r));
  for (const u of a)
    Lb(u, t, r) ? (o = u, s || (s = u)) : (o && n.push([s, o]), o = null, s = null);
  s && n.push([s, null]);
  const i = [];
  for (const [u, f] of n)
    u === f ? i.push(u) : !f && u === a[0] ? i.push("*") : f ? u === a[0] ? i.push(`<=${f}`) : i.push(`${u} - ${f}`) : i.push(`>=${u}`);
  const c = i.join(" || "), d = typeof t.raw == "string" ? t.raw : String(t);
  return c.length < d.length ? c : t;
};
const ml = ut(), qi = Vs(), { ANY: mo } = qi, on = Us, Gi = lt, Ub = (e, t, r = {}) => {
  if (e === t)
    return !0;
  e = new ml(e, r), t = new ml(t, r);
  let n = !1;
  e: for (const s of e.set) {
    for (const o of t.set) {
      const a = qb(s, o, r);
      if (n = n || a !== null, a)
        continue e;
    }
    if (n)
      return !1;
  }
  return !0;
}, zb = [new qi(">=0.0.0-0")], yl = [new qi(">=0.0.0")], qb = (e, t, r) => {
  if (e === t)
    return !0;
  if (e.length === 1 && e[0].semver === mo) {
    if (t.length === 1 && t[0].semver === mo)
      return !0;
    r.includePrerelease ? e = zb : e = yl;
  }
  if (t.length === 1 && t[0].semver === mo) {
    if (r.includePrerelease)
      return !0;
    t = yl;
  }
  const n = /* @__PURE__ */ new Set();
  let s, o;
  for (const y of e)
    y.operator === ">" || y.operator === ">=" ? s = $l(s, y, r) : y.operator === "<" || y.operator === "<=" ? o = gl(o, y, r) : n.add(y.semver);
  if (n.size > 1)
    return null;
  let a;
  if (s && o) {
    if (a = Gi(s.semver, o.semver, r), a > 0)
      return null;
    if (a === 0 && (s.operator !== ">=" || o.operator !== "<="))
      return null;
  }
  for (const y of n) {
    if (s && !on(y, String(s), r) || o && !on(y, String(o), r))
      return null;
    for (const w of t)
      if (!on(y, String(w), r))
        return !1;
    return !0;
  }
  let i, c, d, u, f = o && !r.includePrerelease && o.semver.prerelease.length ? o.semver : !1, _ = s && !r.includePrerelease && s.semver.prerelease.length ? s.semver : !1;
  f && f.prerelease.length === 1 && o.operator === "<" && f.prerelease[0] === 0 && (f = !1);
  for (const y of t) {
    if (u = u || y.operator === ">" || y.operator === ">=", d = d || y.operator === "<" || y.operator === "<=", s) {
      if (_ && y.semver.prerelease && y.semver.prerelease.length && y.semver.major === _.major && y.semver.minor === _.minor && y.semver.patch === _.patch && (_ = !1), y.operator === ">" || y.operator === ">=") {
        if (i = $l(s, y, r), i === y && i !== s)
          return !1;
      } else if (s.operator === ">=" && !on(s.semver, String(y), r))
        return !1;
    }
    if (o) {
      if (f && y.semver.prerelease && y.semver.prerelease.length && y.semver.major === f.major && y.semver.minor === f.minor && y.semver.patch === f.patch && (f = !1), y.operator === "<" || y.operator === "<=") {
        if (c = gl(o, y, r), c === y && c !== o)
          return !1;
      } else if (o.operator === "<=" && !on(o.semver, String(y), r))
        return !1;
    }
    if (!y.operator && (o || s) && a !== 0)
      return !1;
  }
  return !(s && d && !o && a !== 0 || o && u && !s && a !== 0 || _ || f);
}, $l = (e, t, r) => {
  if (!e)
    return t;
  const n = Gi(e.semver, t.semver, r);
  return n > 0 ? e : n < 0 || t.operator === ">" && e.operator === ">=" ? t : e;
}, gl = (e, t, r) => {
  if (!e)
    return t;
  const n = Gi(e.semver, t.semver, r);
  return n < 0 ? e : n > 0 || t.operator === "<" && e.operator === "<=" ? t : e;
};
var Gb = Ub;
const yo = Nn, _l = Ms, Kb = Ue, vl = Pd, Hb = xr, Bb = Qw, Wb = tS, Jb = nS, Xb = oS, Yb = cS, xb = dS, Qb = pS, Zb = $S, eP = lt, tP = ES, rP = bS, nP = Li, sP = TS, oP = jS, aP = Fs, iP = Fi, cP = Nd, lP = Rd, uP = Vi, dP = Ui, fP = Td, hP = eb, pP = Vs(), mP = ut(), yP = Us, $P = ib, gP = db, _P = mb, vP = gb, EP = Eb, wP = zi, SP = jb, bP = kb, PP = Mb, NP = Vb, RP = Gb;
var TP = {
  parse: Hb,
  valid: Bb,
  clean: Wb,
  inc: Jb,
  diff: Xb,
  major: Yb,
  minor: xb,
  patch: Qb,
  prerelease: Zb,
  compare: eP,
  rcompare: tP,
  compareLoose: rP,
  compareBuild: nP,
  sort: sP,
  rsort: oP,
  gt: aP,
  lt: iP,
  eq: cP,
  neq: lP,
  gte: uP,
  lte: dP,
  cmp: fP,
  coerce: hP,
  Comparator: pP,
  Range: mP,
  satisfies: yP,
  toComparators: $P,
  maxSatisfying: gP,
  minSatisfying: _P,
  minVersion: vP,
  validRange: EP,
  outside: wP,
  gtr: SP,
  ltr: bP,
  intersects: PP,
  simplifyRange: NP,
  subset: RP,
  SemVer: Kb,
  re: yo.re,
  src: yo.src,
  tokens: yo.t,
  SEMVER_SPEC_VERSION: _l.SEMVER_SPEC_VERSION,
  RELEASE_TYPES: _l.RELEASE_TYPES,
  compareIdentifiers: vl.compareIdentifiers,
  rcompareIdentifiers: vl.rcompareIdentifiers
};
const Tr = /* @__PURE__ */ kl(TP), OP = Object.prototype.toString, IP = "[object Uint8Array]", jP = "[object ArrayBuffer]";
function Id(e, t, r) {
  return e ? e.constructor === t ? !0 : OP.call(e) === r : !1;
}
function jd(e) {
  return Id(e, Uint8Array, IP);
}
function AP(e) {
  return Id(e, ArrayBuffer, jP);
}
function CP(e) {
  return jd(e) || AP(e);
}
function kP(e) {
  if (!jd(e))
    throw new TypeError(`Expected \`Uint8Array\`, got \`${typeof e}\``);
}
function DP(e) {
  if (!CP(e))
    throw new TypeError(`Expected \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof e}\``);
}
function $o(e, t) {
  if (e.length === 0)
    return new Uint8Array(0);
  t ?? (t = e.reduce((s, o) => s + o.length, 0));
  const r = new Uint8Array(t);
  let n = 0;
  for (const s of e)
    kP(s), r.set(s, n), n += s.length;
  return r;
}
const Yn = {
  utf8: new globalThis.TextDecoder("utf8")
};
function xn(e, t = "utf8") {
  return DP(e), Yn[t] ?? (Yn[t] = new globalThis.TextDecoder(t)), Yn[t].decode(e);
}
function MP(e) {
  if (typeof e != "string")
    throw new TypeError(`Expected \`string\`, got \`${typeof e}\``);
}
const LP = new globalThis.TextEncoder();
function Qn(e) {
  return MP(e), LP.encode(e);
}
Array.from({ length: 256 }, (e, t) => t.toString(16).padStart(2, "0"));
const go = "aes-256-cbc", Mt = () => /* @__PURE__ */ Object.create(null), El = (e) => e !== void 0, _o = (e, t) => {
  const r = /* @__PURE__ */ new Set([
    "undefined",
    "symbol",
    "function"
  ]), n = typeof t;
  if (r.has(n))
    throw new TypeError(`Setting a value of type \`${n}\` for key \`${e}\` is not allowed as it's not supported by JSON`);
}, Vt = "__internal__", vo = `${Vt}.migrations.version`;
var zt, nt, ze, Xe, gr, _r, Fr, ht, be, Ad, Cd, kd, Dd, Md, Ld, Fd, Vd;
class FP {
  constructor(t = {}) {
    dt(this, be);
    en(this, "path");
    en(this, "events");
    dt(this, zt);
    dt(this, nt);
    dt(this, ze);
    dt(this, Xe, {});
    dt(this, gr, !1);
    dt(this, _r);
    dt(this, Fr);
    dt(this, ht);
    en(this, "_deserialize", (t) => JSON.parse(t));
    en(this, "_serialize", (t) => JSON.stringify(t, void 0, "	"));
    const r = Et(this, be, Ad).call(this, t);
    Be(this, ze, r), Et(this, be, Cd).call(this, r), Et(this, be, Dd).call(this, r), Et(this, be, Md).call(this, r), this.events = new EventTarget(), Be(this, nt, r.encryptionKey), this.path = Et(this, be, Ld).call(this, r), Et(this, be, Fd).call(this, r), r.watch && this._watch();
  }
  get(t, r) {
    if (Z(this, ze).accessPropertiesByDotNotation)
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
      throw new TypeError(`Please don't use the ${Vt} key, as it's used to manage this module internal operations.`);
    const { store: n } = this, s = (o, a) => {
      if (_o(o, a), Z(this, ze).accessPropertiesByDotNotation)
        On(n, o, a);
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
    return Z(this, ze).accessPropertiesByDotNotation ? Js(this.store, t) : t in this.store;
  }
  appendToArray(t, r) {
    _o(t, r);
    const n = Z(this, ze).accessPropertiesByDotNotation ? this._get(t, []) : t in this.store ? this.store[t] : [];
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
      El(Z(this, Xe)[r]) && this.set(r, Z(this, Xe)[r]);
  }
  delete(t) {
    const { store: r } = this;
    Z(this, ze).accessPropertiesByDotNotation ? ff(r, t) : delete r[t], this.store = r;
  }
  /**
      Delete all items.
  
      This resets known items to their default values, if defined by the `defaults` or `schema` option.
      */
  clear() {
    const t = Mt();
    for (const r of Object.keys(Z(this, Xe)))
      El(Z(this, Xe)[r]) && (_o(r, Z(this, Xe)[r]), Z(this, ze).accessPropertiesByDotNotation ? On(t, r, Z(this, Xe)[r]) : t[r] = Z(this, Xe)[r]);
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
      const r = Y.readFileSync(this.path, Z(this, nt) ? null : "utf8"), n = this._decryptData(r), s = this._deserialize(n);
      return Z(this, gr) || this._validate(s), Object.assign(Mt(), s);
    } catch (r) {
      if ((r == null ? void 0 : r.code) === "ENOENT")
        return this._ensureDirectory(), Mt();
      if (Z(this, ze).clearInvalidConfig) {
        const n = r;
        if (n.name === "SyntaxError" || (t = n.message) != null && t.startsWith("Config schema violation:"))
          return Mt();
      }
      throw r;
    }
  }
  set store(t) {
    if (this._ensureDirectory(), !Js(t, Vt))
      try {
        const r = Y.readFileSync(this.path, Z(this, nt) ? null : "utf8"), n = this._decryptData(r), s = this._deserialize(n);
        Js(s, Vt) && On(t, Vt, Ji(s, Vt));
      } catch {
      }
    Z(this, gr) || this._validate(t), this._write(t), this.events.dispatchEvent(new Event("change"));
  }
  *[Symbol.iterator]() {
    for (const [t, r] of Object.entries(this.store))
      this._isReservedKeyPath(t) || (yield [t, r]);
  }
  /**
  Close the file watcher if one exists. This is useful in tests to prevent the process from hanging.
  */
  _closeWatcher() {
    Z(this, _r) && (Z(this, _r).close(), Be(this, _r, void 0)), Z(this, Fr) && (Y.unwatchFile(this.path), Be(this, Fr, !1)), Be(this, ht, void 0);
  }
  _decryptData(t) {
    if (!Z(this, nt))
      return typeof t == "string" ? t : xn(t);
    try {
      const r = t.slice(0, 16), n = ir.pbkdf2Sync(Z(this, nt), r, 1e4, 32, "sha512"), s = ir.createDecipheriv(go, n, r), o = t.slice(17), a = typeof o == "string" ? Qn(o) : o;
      return xn($o([s.update(a), s.final()]));
    } catch {
      try {
        const r = t.slice(0, 16), n = ir.pbkdf2Sync(Z(this, nt), r.toString(), 1e4, 32, "sha512"), s = ir.createDecipheriv(go, n, r), o = t.slice(17), a = typeof o == "string" ? Qn(o) : o;
        return xn($o([s.update(a), s.final()]));
      } catch {
      }
    }
    return typeof t == "string" ? t : xn(t);
  }
  _handleStoreChange(t) {
    let r = this.store;
    const n = () => {
      const s = r, o = this.store;
      Bi(o, s) || (r = o, t.call(this, o, s));
    };
    return this.events.addEventListener("change", n), () => {
      this.events.removeEventListener("change", n);
    };
  }
  _handleValueChange(t, r) {
    let n = t();
    const s = () => {
      const o = n, a = t();
      Bi(a, o) || (n = a, r.call(this, a, o));
    };
    return this.events.addEventListener("change", s), () => {
      this.events.removeEventListener("change", s);
    };
  }
  _validate(t) {
    if (!Z(this, zt) || Z(this, zt).call(this, t) || !Z(this, zt).errors)
      return;
    const n = Z(this, zt).errors.map(({ instancePath: s, message: o = "" }) => `\`${s.slice(1)}\` ${o}`);
    throw new Error("Config schema violation: " + n.join("; "));
  }
  _ensureDirectory() {
    Y.mkdirSync(z.dirname(this.path), { recursive: !0 });
  }
  _write(t) {
    let r = this._serialize(t);
    if (Z(this, nt)) {
      const n = ir.randomBytes(16), s = ir.pbkdf2Sync(Z(this, nt), n, 1e4, 32, "sha512"), o = ir.createCipheriv(go, s, n);
      r = $o([n, Qn(":"), o.update(Qn(r)), o.final()]);
    }
    if (me.env.SNAP)
      Y.writeFileSync(this.path, r, { mode: Z(this, ze).configFileMode });
    else
      try {
        Cl(this.path, r, { mode: Z(this, ze).configFileMode });
      } catch (n) {
        if ((n == null ? void 0 : n.code) === "EXDEV") {
          Y.writeFileSync(this.path, r, { mode: Z(this, ze).configFileMode });
          return;
        }
        throw n;
      }
  }
  _watch() {
    if (this._ensureDirectory(), Y.existsSync(this.path) || this._write(Mt()), me.platform === "win32" || me.platform === "darwin") {
      Z(this, ht) ?? Be(this, ht, tl(() => {
        this.events.dispatchEvent(new Event("change"));
      }, { wait: 100 }));
      const t = z.dirname(this.path), r = z.basename(this.path);
      Be(this, _r, Y.watch(t, { persistent: !1, encoding: "utf8" }, (n, s) => {
        s && s !== r || typeof Z(this, ht) == "function" && Z(this, ht).call(this);
      }));
    } else
      Z(this, ht) ?? Be(this, ht, tl(() => {
        this.events.dispatchEvent(new Event("change"));
      }, { wait: 1e3 })), Y.watchFile(this.path, { persistent: !1 }, (t, r) => {
        typeof Z(this, ht) == "function" && Z(this, ht).call(this);
      }), Be(this, Fr, !0);
  }
  _migrate(t, r, n) {
    let s = this._get(vo, "0.0.0");
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
        c == null || c(this), this._set(vo, i), s = i, a = structuredClone(this.store);
      } catch (c) {
        this.store = a;
        try {
          this._write(a);
        } catch {
        }
        const d = c instanceof Error ? c.message : String(c);
        throw new Error(`Something went wrong during the migration! Changes applied to the store until this failed migration will be restored. ${d}`);
      }
    (this._isVersionInRangeFormat(s) || !Tr.eq(s, r)) && this._set(vo, r);
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
    return t === Vt || t.startsWith(`${Vt}.`);
  }
  _isVersionInRangeFormat(t) {
    return Tr.clean(t) === null;
  }
  _shouldPerformMigration(t, r, n) {
    return this._isVersionInRangeFormat(t) ? r !== "0.0.0" && Tr.satisfies(r, t) ? !1 : Tr.satisfies(n, t) : !(Tr.lte(t, r) || Tr.gt(t, n));
  }
  _get(t, r) {
    return Ji(this.store, t, r);
  }
  _set(t, r) {
    const { store: n } = this;
    On(n, t, r), this.store = n;
  }
}
zt = new WeakMap(), nt = new WeakMap(), ze = new WeakMap(), Xe = new WeakMap(), gr = new WeakMap(), _r = new WeakMap(), Fr = new WeakMap(), ht = new WeakMap(), be = new WeakSet(), Ad = function(t) {
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
    r.cwd = yf(r.projectName, { suffix: r.projectSuffix }).config;
  }
  return typeof r.fileExtension == "string" && (r.fileExtension = r.fileExtension.replace(/^\.+/, "")), r;
}, Cd = function(t) {
  if (!(t.schema ?? t.ajvOptions ?? t.rootSchema))
    return;
  if (t.schema && typeof t.schema != "object")
    throw new TypeError("The `schema` option must be an object.");
  const r = Tw.default, n = new y_.Ajv2020({
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
  Be(this, zt, n.compile(s)), Et(this, be, kd).call(this, t.schema);
}, kd = function(t) {
  const r = Object.entries(t ?? {});
  for (const [n, s] of r) {
    if (!s || typeof s != "object" || !Object.hasOwn(s, "default"))
      continue;
    const { default: o } = s;
    o !== void 0 && (Z(this, Xe)[n] = o);
  }
}, Dd = function(t) {
  t.defaults && Object.assign(Z(this, Xe), t.defaults);
}, Md = function(t) {
  t.serialize && (this._serialize = t.serialize), t.deserialize && (this._deserialize = t.deserialize);
}, Ld = function(t) {
  const r = typeof t.fileExtension == "string" ? t.fileExtension : void 0, n = r ? `.${r}` : "";
  return z.resolve(t.cwd, `${t.configName ?? "config"}${n}`);
}, Fd = function(t) {
  if (t.migrations) {
    Et(this, be, Vd).call(this, t), this._validate(this.store);
    return;
  }
  const r = this.store, n = Object.assign(Mt(), t.defaults ?? {}, r);
  this._validate(n);
  try {
    Wi.deepEqual(r, n);
  } catch {
    this.store = n;
  }
}, Vd = function(t) {
  const { migrations: r, projectVersion: n } = t;
  if (r) {
    if (!n)
      throw new Error("Please specify the `projectVersion` option.");
    Be(this, gr, !0);
    try {
      const s = this.store, o = Object.assign(Mt(), t.defaults ?? {}, s);
      try {
        Wi.deepEqual(s, o);
      } catch {
        this._write(o);
      }
      this._migrate(r, n, t.beforeEachMigration);
    } finally {
      Be(this, gr, !1);
    }
  }
};
const { app: cs, ipcMain: Vo, shell: VP } = bl;
let wl = !1;
const Sl = () => {
  if (!Vo || !cs)
    throw new Error("Electron Store: You need to call `.initRenderer()` from the main process.");
  const e = {
    defaultCwd: cs.getPath("userData"),
    appVersion: cs.getVersion()
  };
  return wl || (Vo.on("electron-store-get-data", (t) => {
    t.returnValue = e;
  }), wl = !0), e;
};
class Ud extends FP {
  constructor(t) {
    let r, n;
    if (me.type === "renderer") {
      const s = bl.ipcRenderer.sendSync("electron-store-get-data");
      if (!s)
        throw new Error("Electron Store: You need to call `.initRenderer()` from the main process.");
      ({ defaultCwd: r, appVersion: n } = s);
    } else Vo && cs && ({ defaultCwd: r, appVersion: n } = Sl());
    t = {
      name: "config",
      ...t
    }, t.projectVersion || (t.projectVersion = n), t.cwd ? t.cwd = z.isAbsolute(t.cwd) ? t.cwd : z.join(r, t.cwd) : t.cwd = r, t.configName = t.name, delete t.name, super(t);
  }
  static initRenderer() {
    Sl();
  }
  async openInEditor() {
    const t = await VP.openPath(this.path);
    if (t)
      throw new Error(t);
  }
}
const zs = new Ud({
  defaults: {
    libraryPath: z.join(ct.getPath("userData")),
    aiSettings: {
      faceDetectionThreshold: 0.6,
      faceBlurThreshold: 20,
      vlmTemperature: 0.2,
      vlmMaxTokens: 100
    }
  }
});
function Uo() {
  return zs.get("libraryPath");
}
function UP(e) {
  zs.set("libraryPath", e);
}
function zd() {
  return zs.get("aiSettings");
}
function zP(e) {
  zs.set("aiSettings", e);
}
const Es = new Ud(), qP = Zd(import.meta.url), qd = z.dirname(qP), yt = Uo();
X.info(`[Main] Library Path: ${yt}`);
process.env.APP_ROOT = z.join(qd, "..");
const zo = process.env.VITE_DEV_SERVER_URL, fN = z.join(process.env.APP_ROOT, "dist-electron"), Gd = z.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = zo ? z.join(process.env.APP_ROOT, "public") : Gd;
let ve, Cr = null, Ee = null;
const $e = /* @__PURE__ */ new Map();
function GP() {
  let e, t;
  if (ct.isPackaged)
    e = z.join(process.resourcesPath, "python-bin", "smart-photo-ai", "smart-photo-ai.exe"), t = [], X.info(`[Main] Starting Bundled Python Backend (Prod): ${e}`);
  else {
    e = z.join(process.env.APP_ROOT, "src", "python", ".venv", "Scripts", "python.exe");
    const r = z.join(process.env.APP_ROOT, "src", "python", "main.py");
    t = [r], X.info(`[Main] Starting Python Backend (Dev): ${e} ${r}`);
  }
  Ee = xd(e, t, {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
      LIBRARY_PATH: yt,
      LOG_PATH: z.join(ct.getPath("userData"), "logs"),
      PYTORCH_CUDA_ALLOC_CONF: "expandable_segments:True"
    }
  }), Ee.stdout && (setTimeout(() => KP(), 2e3), Qd({ input: Ee.stdout }).on("line", async (n) => {
    var s;
    try {
      const o = JSON.parse(n);
      X.info("[Python]", o), ve && (o.type === "scan_result" || o.type === "tags_result") && ve.webContents.send("ai:scan-result", o), o.type === "cluster_result" && console.log(`[Main] Received Cluster Result for ${o.photoId}. Clusters: ${(s = o.clusters) == null ? void 0 : s.length}`);
      const a = o.photoId || o.reqId || o.payload && o.payload.reqId;
      if (ve && (o.type === "download_progress" || o.type === "download_result") && ve.webContents.send("ai:model-progress", o), a && $e.has(a)) {
        const i = $e.get(a);
        o.error ? i == null || i.reject(o.error) : i == null || i.resolve(o), $e.delete(a);
      }
      if ((o.type === "scan_result" || o.type === "tags_result") && o.error && o.photoId)
        try {
          const { getDB: i } = await Promise.resolve().then(() => ee), d = i().prepare("INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, (SELECT file_path FROM photos WHERE id = ?), ?, ?)"), u = o.type === "scan_result" ? "Face Scan" : "Smart Tags";
          d.run(o.photoId, o.photoId, o.error, u), X.info(`[Main] Logged scan error for ${o.photoId}`);
        } catch (i) {
          X.error("[Main] Failed to log auto-error:", i);
        }
    } catch {
      X.info("[Python Raw]", n);
    }
  })), Ee.stderr && Ee.stderr.on("data", (r) => {
    const n = r.toString();
    n.toLowerCase().includes("error") || n.toLowerCase().includes("exception") ? X.error(`[Python Error]: ${n}`) : X.info(`[Python Log]: ${n}`);
  }), Ee.on("close", (r) => {
    X.info(`[Main] Python process exited with code ${r}`), Ee = null;
  });
}
function Lt(e) {
  Ee && Ee.stdin ? Ee.stdin.write(JSON.stringify(e) + `
`) : X.error("[Main] Python process not running. Queuing or dropping command.", e.type);
}
function KP() {
  if (Ee && Ee.stdin) {
    const t = { type: "update_config", payload: { config: zd() } };
    Ee.stdin.write(JSON.stringify(t) + `
`);
  }
}
function HP() {
  Cr = new qo({
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
  }), Cr.loadFile(z.join(process.env.VITE_PUBLIC, "splash.html")), Cr.on("closed", () => Cr = null);
}
function Kd() {
  ve = new qo({
    icon: z.join(process.env.VITE_PUBLIC, "icon.png"),
    width: 1200,
    height: 800,
    show: !1,
    // Hide initially
    backgroundColor: "#111827",
    // Set dark background
    webPreferences: {
      preload: z.join(qd, "preload.mjs"),
      webSecurity: !1
    }
  }), ve.once("ready-to-show", () => {
    ve == null || ve.show(), Cr && Cr.close();
  }), ve.webContents.on("did-finish-load", () => {
    ve == null || ve.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), zo ? ve.loadURL(zo) : ve.loadFile(z.join(Gd, "index.html"));
}
ct.on("window-all-closed", () => {
  Ee && Ee.kill(), process.platform !== "darwin" && (ct.quit(), ve = null);
});
ct.on("activate", () => {
  qo.getAllWindows().length === 0 && Kd();
});
ct.whenReady().then(async () => {
  try {
    await ke.mkdir(yt, { recursive: !0 });
  } catch (t) {
    X.error(`[Main] Failed to create library path: ${yt}`, t);
  }
  Rl(yt), GP(), Jd.handle("local-resource", (t) => {
    let r = t.url.replace("local-resource://", "");
    const n = r.indexOf("?");
    n !== -1 && (r = r.substring(0, n));
    const s = decodeURIComponent(r);
    return Xd.fetch(ef(s).toString());
  }), HP(), Kd(), J.handle("app:focusWindow", () => ve ? (ve.isMinimized() && ve.restore(), ve.focus(), !0) : !1), J.handle("scan-directory", async (t, r) => await lf(r, yt, (n) => {
    t.sender.send("scan-progress", n);
  })), J.handle("dialog:openDirectory", async () => {
    const { canceled: t, filePaths: r } = await Yd.showOpenDialog({
      properties: ["openDirectory"]
    });
    return t ? null : r[0];
  }), J.handle("read-file-buffer", async (t, r) => {
    const n = await import("node:fs/promises");
    try {
      return await n.readFile(r);
    } catch (s) {
      throw X.error("Failed to read file:", r, s), s;
    }
  }), J.handle("ai:getSettings", () => zd()), J.handle("ai:saveSettings", (t, r) => {
    if (zP(r), Ee && Ee.stdin) {
      const n = { type: "update_config", payload: { config: r } };
      Ee.stdin.write(JSON.stringify(n) + `
`);
    }
    return !0;
  }), J.handle("ai:downloadModel", async (t, { modelName: r }) => (X.info(`[Main] Requesting model download: ${r}`), new Promise((n, s) => {
    const o = Math.floor(Math.random() * 1e6);
    $e.set(o, {
      resolve: (a) => n(a),
      reject: s
    }), Lt({
      type: "download_model",
      payload: {
        reqId: o,
        modelName: r
      }
    }), setTimeout(() => {
      $e.has(o) && ($e.delete(o), s("Model download timed out"));
    }, 18e5);
  }))), J.handle("ai:getSystemStatus", async () => new Promise((t, r) => {
    const n = Math.floor(Math.random() * 1e6);
    $e.set(n, {
      resolve: (s) => t(s.status || {}),
      reject: r
    }), Lt({
      type: "get_system_status",
      payload: { reqId: n }
    }), setTimeout(() => {
      $e.has(n) && ($e.delete(n), r("Get system status timed out"));
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
      const t = z.join(Uo(), "previews");
      try {
        await ke.access(t);
      } catch {
        return { success: !0, count: 0, size: 0 };
      }
      let r = 0, n = 0;
      const s = await ke.readdir(t);
      for (const o of s)
        if (!o.startsWith("."))
          try {
            const a = await ke.stat(z.join(t, o));
            a.isFile() && (r++, n += a.size);
          } catch {
          }
      return { success: !0, count: r, size: n };
    } catch (t) {
      return { success: !1, error: String(t) };
    }
  }), J.handle("settings:cleanupPreviews", async (t, { days: r }) => {
    try {
      const n = z.join(Uo(), "previews");
      try {
        await ke.access(n);
      } catch {
        return { success: !0, deletedCount: 0, deletedSize: 0 };
      }
      const s = Date.now(), o = r * 24 * 60 * 60 * 1e3;
      let a = 0, i = 0;
      const c = await ke.readdir(n);
      for (const d of c) {
        if (d.startsWith(".")) continue;
        const u = z.join(n, d);
        try {
          const f = await ke.stat(u);
          s - f.mtimeMs > o && (await ke.unlink(u), a++, i += f.size);
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
    X.info(`[Main] Requesting AI scan for ${r}`);
    try {
      const a = s.prepare("SELECT file_path FROM photos WHERE id = ?").get(r);
      if (a && a.file_path) {
        const i = z.join(yt, "previews");
        return await ke.mkdir(i, { recursive: !0 }), Lt({
          type: "scan_image",
          payload: {
            photoId: r,
            filePath: a.file_path,
            previewStorageDir: i
          }
        }), new Promise((c, d) => {
          $e.set(r, { resolve: c, reject: d }), setTimeout(() => {
            $e.has(r) && ($e.delete(r), d("Scan timed out"));
          }, 3e5);
        });
      } else
        return X.error("[Main] Photo not found or no path:", r), { success: !1, error: "Photo not found" };
    } catch (o) {
      return X.error("[Main] Failed to lookup photo for AI:", o), { success: !1, error: o };
    }
  }), J.handle("ai:generateTags", async (t, { photoId: r }) => {
    const { getDB: n } = await Promise.resolve().then(() => ee), s = n();
    X.info(`[Main] Requesting Tags (VLM) for ${r}`);
    try {
      const a = s.prepare("SELECT file_path FROM photos WHERE id = ?").get(r);
      return a && a.file_path ? (Lt({ type: "generate_tags", payload: { photoId: r, filePath: a.file_path } }), { success: !0 }) : { success: !1, error: "Photo not found" };
    } catch (o) {
      return X.error("[Main] Failed to lookup photo for VLM:", o), { success: !1, error: o };
    }
  }), J.handle("ai:enhanceImage", async (t, { photoId: r, task: n, modelName: s }) => {
    const { getDB: o } = await Promise.resolve().then(() => ee), a = o();
    X.info(`[Main] Enhance Request: ${r} [${n}]`);
    try {
      const c = a.prepare("SELECT file_path FROM photos WHERE id = ?").get(r);
      if (!c || !c.file_path) return { success: !1, error: "Photo not found" };
      const d = z.extname(c.file_path), u = z.basename(c.file_path, d), f = n === "upscale" ? "_upscaled" : "_restored", _ = z.join(z.dirname(c.file_path), `${u}${f}.jpg`);
      return new Promise((y, w) => {
        const g = Math.floor(Math.random() * 1e6);
        $e.set(g, {
          resolve: ($) => {
            $.success ? y({ success: !0, outPath: $.outPath }) : y({ success: !1, error: $.error });
          },
          reject: w
        }), Lt({
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
          $e.has(g) && ($e.delete(g), w("Enhancement timed out"));
        }, 6e5);
      });
    } catch (i) {
      return X.error("Enhance failed:", i), { success: !1, error: String(i) };
    }
  }), J.handle("ai:rebuildIndex", async () => {
    const { getDB: t } = await Promise.resolve().then(() => ee), r = t();
    X.info("[Main] Rebuilding Vector Index...");
    try {
      const n = r.prepare("SELECT id, descriptor_json FROM faces WHERE descriptor_json IS NOT NULL").all(), s = n.map((a) => JSON.parse(a.descriptor_json)), o = n.map((a) => a.id);
      return s.length === 0 ? { success: !0, count: 0 } : new Promise((a, i) => {
        const c = Math.floor(Math.random() * 1e6);
        $e.set(c, {
          resolve: (d) => a({ success: !0, count: d.count }),
          reject: i
        }), Lt({
          type: "rebuild_index",
          payload: {
            reqId: c,
            descriptors: s,
            ids: o
          }
        });
      });
    } catch (n) {
      return X.error("Failed to rebuild index:", n), { success: !1, error: String(n) };
    }
  }), J.handle("ai:command", async (t, r) => {
    try {
      const n = Math.floor(Math.random() * 1e7);
      return r.payload || (r.payload = {}), r.payload.reqId = n, new Promise((s, o) => {
        $e.set(n, { resolve: s, reject: o }), Lt(r), setTimeout(() => {
          $e.has(n) && ($e.delete(n), o("Command timed out"));
        }, 3e4);
      });
    } catch (n) {
      return X.error("AI Command Failed:", n), { error: n };
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
        $e.set(_, { resolve: (y) => u({ success: !0, clusters: y.clusters }), reject: f }), Lt({
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
          $e.has(_) && ($e.delete(_), f("Clustering timed out"));
        }, 3e5);
      });
    } catch (i) {
      return X.error("Failed to cluster faces:", i), { success: !1, error: i };
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
      return X.error("Failed to add tags:", u), { success: !1, error: u };
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
      return X.error("Failed to get tags:", a), [];
    }
  }), J.handle("db:clearAITags", async (t) => {
    const { getDB: r } = await Promise.resolve().then(() => ee), n = r();
    try {
      return n.exec(`
        DELETE FROM photo_tags WHERE source = 'AI';
        DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM photo_tags);
      `), X.info("Cleared all AI tags."), { success: !0 };
    } catch (s) {
      return X.error("Failed to clear AI tags:", s), { success: !1, error: s };
    }
  }), J.handle("db:getPhoto", async (t, r) => {
    const { getDB: n } = await Promise.resolve().then(() => ee), s = n();
    try {
      return s.prepare("SELECT * FROM photos WHERE id = ?").get(r) || null;
    } catch (o) {
      return X.error("Failed to get photo:", o), null;
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
      await ke.mkdir(n, { recursive: !0 });
      for (const u of i) {
        const f = u.file_path, _ = z.basename(f), y = z.join(n, _);
        try {
          await ke.copyFile(f, y), c++;
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
          const le = k.box;
          let ue = null, ye = 0;
          for (const L of R) {
            if (T.has(L.id)) continue;
            const q = JSON.parse(L.box_json), ie = Math.max(le.x, q.x), O = Math.max(le.y, q.y), A = Math.min(le.x + k.box.width, q.x + q.width), V = Math.min(le.y + k.box.height, q.y + q.height), D = Math.max(0, A - ie) * Math.max(0, V - O);
            if (D > 0) {
              const G = le.width * le.height, M = q.width * q.height, P = D / (G + M - D);
              P > 0.25 && P > ye && (ye = P, ue = L.id);
            }
          }
          if (ue) {
            f.run(JSON.stringify(le), JSON.stringify(k.descriptor), k.blur_score || null, ue), T.add(ue);
            const L = R.find((q) => q.id === ue);
            L && L.person_id && C.add(L.person_id);
          } else {
            let L = null, q = 0.45;
            const ie = w.all();
            for (const O of ie) {
              const A = JSON.parse(O.descriptor_mean_json);
              let V = 0, D = 0, G = 0;
              if (k.descriptor.length !== A.length) continue;
              for (let m = 0; m < k.descriptor.length; m++)
                V += k.descriptor[m] * A[m], D += k.descriptor[m] ** 2, G += A[m] ** 2;
              const M = Math.sqrt(D) * Math.sqrt(G), P = M === 0 ? 1 : 1 - V / M;
              P < q && (q = P, L = O.id);
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
                m < q && (q = m, L = A.person_id);
              }
            }
            _.run(r, JSON.stringify(le), JSON.stringify(k.descriptor), L, k.blur_score || null), L && C.add(L);
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
      return X.error("Failed to delete faces:", o), { success: !1, error: o };
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
J.handle("settings:getLibraryPath", () => yt);
J.handle("settings:moveLibrary", async (e, t) => {
  console.log(`[Main] Configuring move library to: ${t}`);
  try {
    if (!(await ke.stat(t)).isDirectory()) return { success: !1, error: "Target is not a directory" };
  } catch {
    return { success: !1, error: "Target directory does not exist" };
  }
  const { closeDB: r } = await Promise.resolve().then(() => ee);
  try {
    r(), Ee && Ee.kill(), console.log("[Main] Moving files...");
    const n = ["library.db", "previews", "vectors.index", "id_map.pkl", "library.db-shm", "library.db-wal"];
    await new Promise((s) => setTimeout(s, 1e3));
    for (const s of n) {
      const o = z.join(yt, s), a = z.join(t, s);
      try {
        await ke.access(o), console.log(`Copying ${o} -> ${a}`), await ke.cp(o, a, { recursive: !0, force: !0 });
      } catch (i) {
        if (i.code === "ENOENT")
          continue;
        throw console.error(`Failed to copy ${s}:`, i), new Error(`Failed to copy ${s}: ${i.message}`);
      }
    }
    try {
      await ke.access(z.join(t, "library.db"));
    } catch {
    }
    UP(t), console.log("Cleaning up old files...");
    for (const s of n) {
      const o = z.join(yt, s);
      try {
        await ke.rm(o, { recursive: !0, force: !0 });
      } catch (a) {
        console.error(`Failed to cleanup ${o}:`, a);
      }
    }
    return console.log("[Main] Restarting application..."), ct.relaunch(), ct.exit(0), { success: !0 };
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
      a.run(t), o && o.person_id && Hd(n, o.person_id);
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
        Hd(n, d);
    })(), { success: !0 };
  } catch (s) {
    return console.error("Failed to ignore faces:", s), { success: !1, error: s };
  }
});
const Hd = (e, t) => {
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
    const s = ct.getPath("userData"), o = r.join(s, "previews");
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
  batchSize: Es.get("queue.batchSize", 0),
  cooldownSeconds: Es.get("queue.cooldownSeconds", 60)
}));
J.handle("settings:setQueueConfig", async (e, t) => (Es.set("queue.batchSize", t.batchSize), Es.set("queue.cooldownSeconds", t.cooldownSeconds), { success: !0 }));
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
J.handle("os:getLogPath", () => X.getLogPath());
J.handle("os:showInFolder", (e, t) => {
  Pl.showItemInFolder(t);
});
J.handle("os:openFolder", (e, t) => {
  Pl.openPath(t);
});
process.on("uncaughtException", (e) => {
  X.error("Uncaught Exception:", e);
});
process.on("unhandledRejection", (e) => {
  X.error("Unhandled Rejection:", e);
});
export {
  fN as MAIN_DIST,
  Gd as RENDERER_DIST,
  zo as VITE_DEV_SERVER_URL
};
