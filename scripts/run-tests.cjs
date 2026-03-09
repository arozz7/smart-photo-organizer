/**
 * Test runner that ensures all steps (rebuild, vitest, restore) use Node v22.
 *
 * On this machine nvm4w's PATH node is v21, but vitest needs better-sqlite3
 * compiled for v22 (ABI 127). This script:
 *   1. Re-invokes itself with the v22 executable if running under v21.
 *   2. Rebuilds better-sqlite3 for Node v22.
 *   3. Runs vitest.
 *   4. Restores the Electron-compiled better-sqlite3 binary.
 */
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REQUIRED_MAJOR = 22;

function findNodeV22() {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return null;
    const nvmBase = path.join(localAppData, 'nvm');
    if (!fs.existsSync(nvmBase)) return null;
    const entries = fs.readdirSync(nvmBase)
        .filter(d => /^v22\./.test(d))
        .sort((a, b) => {
            // Numeric sort so v22.15.0 > v22.2.0
            const parts = s => s.slice(1).split('.').map(Number);
            const [, aMi, aPa] = parts(a);
            const [, bMi, bPa] = parts(b);
            return bMi - aMi || bPa - aPa;
        });
    for (const entry of entries) {
        const candidate = path.join(nvmBase, entry, 'node.exe');
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

// --- Step 0: Ensure we're on v22 ---
const currentMajor = parseInt(process.version.slice(1), 10);
if (currentMajor !== REQUIRED_MAJOR) {
    const v22 = findNodeV22();
    if (v22) {
        console.log(`[run-tests] Node ${process.version} → re-invoking with ${v22}`);
        const result = spawnSync(v22, [__filename, ...process.argv.slice(2)], { stdio: 'inherit' });
        process.exit(result.status ?? 0);
    } else {
        console.warn(`[run-tests] Warning: Node v22 not found; running with ${process.version} (ABI mismatch possible)`);
    }
}

const root = path.resolve(__dirname, '..');
const nodeGypJs = path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
const sqliteDir = path.join(root, 'node_modules', 'better-sqlite3');
const vitestMjs = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const electronRebuildCli = path.join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');

console.log(`[run-tests] Using Node: ${process.execPath} (${process.version})`);

// --- Step 1: Rebuild for Node (vitest) ---
console.log('[run-tests] Rebuilding better-sqlite3 for Node...');
execFileSync(process.execPath, [nodeGypJs, 'rebuild'], { cwd: sqliteDir, stdio: 'inherit' });

// --- Step 2: Run vitest ---
console.log('[run-tests] Running vitest...');
let vitestExitCode = 0;
try {
    execFileSync(process.execPath, [vitestMjs, 'run', ...process.argv.slice(2)], {
        cwd: root,
        stdio: 'inherit',
    });
} catch (e) {
    vitestExitCode = e.status ?? 1;
}

// --- Step 3: Restore Electron binary ---
console.log('[run-tests] Restoring Electron binary...');
try {
    execFileSync(process.execPath, [electronRebuildCli, '-f', '-w', 'better-sqlite3'], {
        cwd: root,
        stdio: 'inherit',
    });
} catch (e) {
    console.warn('[run-tests] electron-rebuild failed (app may need a manual rebuild):', e.message);
}

process.exit(vitestExitCode);
