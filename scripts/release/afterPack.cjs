'use strict';
/**
 * electron-builder afterPack hook: drops better-sqlite3 binaries built for other operating systems.
 *
 * better-sqlite3 13 ships a prebuilt .node file for every platform (about 16 MB) and loads only the one
 * matching the running machine. The hook edits the packaged copy only (never node_modules or the
 * project), deletes nothing but `.node` files in that one folder, and keeps every file for the target
 * platform, so a package for one platform never loses a binary it could load.
 */
const fs = require('node:fs');
const path = require('node:path');

/** File-name prefixes (better-sqlite3's own naming) kept per target platform. */
const KEEP_PREFIXES = {
    win32: ['win32-'],
    darwin: ['darwin-'],
    linux: ['linux-', 'linuxmusl-'],
};

function prebuildsDirFor(resourcesDir) {
    return path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'prebuilds');
}

/** Removes prebuilt binaries that are not for `platformName`. An unknown platform removes nothing. */
function pruneOtherPlatformPrebuilds(prebuildsDir, platformName) {
    const keep = KEEP_PREFIXES[platformName];
    const removed = [];
    let bytes = 0;
    if (!keep || !fs.existsSync(prebuildsDir)) return { removed, bytes };

    for (const name of fs.readdirSync(prebuildsDir)) {
        if (!name.endsWith('.node') || keep.some((prefix) => name.startsWith(prefix))) continue;
        const file = path.join(prebuildsDir, name);
        bytes += fs.statSync(file).size;
        fs.unlinkSync(file);
        removed.push(name);
    }
    return { removed, bytes };
}

/** electron-builder entry point. `context.electronPlatformName` is 'win32' | 'darwin' | 'linux'. */
async function afterPack(context) {
    const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
    const { removed, bytes } = pruneOtherPlatformPrebuilds(prebuildsDirFor(resourcesDir), context.electronPlatformName);
    if (removed.length > 0) {
        console.log(`  • afterPack: removed ${removed.length} other-platform better-sqlite3 binaries (${(bytes / 1048576).toFixed(1)} MB)`);
    }
}

exports.default = afterPack;
exports.pruneOtherPlatformPrebuilds = pruneOtherPlatformPrebuilds;
exports.prebuildsDirFor = prebuildsDirFor;
