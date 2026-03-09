/**
 * Rebuilds better-sqlite3 for the Node.js runtime that vitest will use.
 *
 * On this machine, nvm4w's `node` (PATH default) is v21 but vitest must run
 * on v22. This script detects the mismatch and re-invokes itself with the
 * correct v22 executable so node-gyp builds for ABI 127.
 */
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REQUIRED_MAJOR = 22;

// Locate the v22 node executable via the NVM install directory.
// Returns null if not found (avoids infinite re-invoke loops).
function findNodeV22() {
    const localAppData = process.env.LOCALAPPDATA; // C:\Users\<user>\AppData\Local
    if (!localAppData) return null;

    const nvmBase = path.join(localAppData, 'nvm');
    if (!fs.existsSync(nvmBase)) return null;

    const entries = fs.readdirSync(nvmBase)
        .filter(d => /^v22\./.test(d))
        .sort()
        .reverse();

    for (const entry of entries) {
        const candidate = path.join(nvmBase, entry, 'node.exe');
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

const currentMajor = parseInt(process.version.slice(1), 10);
if (currentMajor !== REQUIRED_MAJOR) {
    const v22 = findNodeV22();
    if (v22) {
        console.log(`[rebuild-sqlite-node] Node ${process.version} detected; re-invoking with ${v22}`);
        const result = spawnSync(v22, [__filename], { stdio: 'inherit' });
        process.exit(result.status ?? 0);
    } else {
        console.warn(`[rebuild-sqlite-node] Warning: Node v22 not found in NVM; rebuilding with ${process.version} (ABI mismatch possible)`);
    }
}

const root = path.resolve(__dirname, '..');
const nodeGypJs = path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
const sqliteDir = path.join(root, 'node_modules', 'better-sqlite3');

console.log(`[rebuild-sqlite-node] Using Node: ${process.execPath} (${process.version})`);
console.log(`[rebuild-sqlite-node] Rebuilding in: ${sqliteDir}`);

execFileSync(process.execPath, [nodeGypJs, 'rebuild'], {
    cwd: sqliteDir,
    stdio: 'inherit',
});
