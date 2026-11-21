'use strict';
/**
 * Release guard: the packaged app runs a frozen Python engine (`python-dist`, built by `npm run build:python`), not the sources.
 * Building the app without rebuilding the engine ships an engine that does not know commands added since (0.8.11 to 0.8.13 shipped
 * without `score_face_visibility`, so the model check paused with "Unknown command"). This finds that case before packing.
 */
const fs = require('node:fs');
const path = require('node:path');

const ENGINE_EXE = path.join('smart-photo-ai', process.platform === 'win32' ? 'smart-photo-ai.exe' : 'smart-photo-ai');
/** Folders under the Python sources that are not part of the engine. */
const IGNORED_DIRS = new Set(['.venv', 'venv', '__pycache__', 'tests', 'build', 'dist', 'node_modules', '.pytest_cache']);

/** The newest .py file under `dir` (ignoring IGNORED_DIRS): { file, mtimeMs } or null. */
function newestPythonSource(dir) {
    let newest = null;
    const walk = current => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name)) walk(full);
            } else if (entry.name.endsWith('.py')) {
                const mtimeMs = fs.statSync(full).mtimeMs;
                if (!newest || mtimeMs > newest.mtimeMs) newest = { file: full, mtimeMs };
            }
        }
    };
    if (fs.existsSync(dir)) walk(dir);
    return newest;
}

/** A message when the frozen engine is missing or older than the newest Python source, else null. */
function findStaleEngine(engineDir, sourceDir) {
    const exe = path.join(engineDir, ENGINE_EXE);
    if (!fs.existsSync(exe)) return `The Python engine was not found at ${exe}. Run: npm run build:python`;
    const newest = newestPythonSource(sourceDir);
    if (!newest) return null;
    const built = fs.statSync(exe).mtimeMs;
    if (built >= newest.mtimeMs) return null;
    return `The Python engine (${exe}, built ${new Date(built).toISOString()}) is older than ${newest.file} (${new Date(newest.mtimeMs).toISOString()}), `
        + 'so the packaged app would not know new commands. Run: npm run build:python';
}

module.exports = { findStaleEngine, newestPythonSource, ENGINE_EXE };
