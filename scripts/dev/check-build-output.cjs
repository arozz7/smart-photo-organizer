'use strict';
/**
 * Checks the Electron main-process build (dist-electron) after `vite build`.
 *
 * Native modules must stay external: imported at run time from node_modules, never bundled. If a bundler
 * inlines better-sqlite3 (this happened when Vite 8 ignored `build.rollupOptions.external`), the built app
 * cannot find the native binding and fails at startup with "DB Init Failed", while every unit test still passes.
 *
 * Only files reachable from main.js are checked: older builds leave stale chunks in the same folder.
 */
const fs = require('node:fs');
const path = require('node:path');

const NATIVE_MODULES = ['better-sqlite3', 'sharp', 'exiftool-vendored'];
const RELATIVE_IMPORT = /(?:from\s*|import\s*\(?\s*|import\s+)["'](\.\/[^"']+\.m?js)["']/g;

/** Returns every file reachable from main.js through relative imports, as { name: source }. */
function readReachableFiles(distDir) {
    const files = new Map();
    const pending = ['main.js'];
    while (pending.length > 0) {
        const name = pending.pop();
        if (files.has(name)) continue;
        const file = path.join(distDir, name);
        if (!fs.existsSync(file)) continue;
        const source = fs.readFileSync(file, 'utf8');
        files.set(name, source);
        for (const match of source.matchAll(RELATIVE_IMPORT)) pending.push(path.normalize(match[1]));
    }
    return files;
}

/** Returns a list of human-readable problems; an empty list means the build output is fine. */
function findBuildProblems(distDir) {
    if (!fs.existsSync(path.join(distDir, 'main.js'))) return [`${path.join(distDir, 'main.js')} is missing (run the build first)`];

    const files = readReachableFiles(distDir);
    const problems = [];
    for (const moduleName of NATIVE_MODULES) {
        const bundledMarker = new RegExp(`^// node_modules/${moduleName}/`, 'm');
        const importMarker = new RegExp(`from\\s*["']${moduleName}["']|import\\s*["']${moduleName}["']`);
        for (const [name, source] of files) {
            if (bundledMarker.test(source)) problems.push(`${moduleName} is bundled into ${name}; it must stay external`);
        }
        if (![...files.values()].some((source) => importMarker.test(source))) {
            problems.push(`${moduleName} is never imported by the main bundle (expected an external import)`);
        }
    }
    return problems;
}

module.exports = { findBuildProblems };

if (require.main === module) {
    const distDir = path.resolve(__dirname, '../../dist-electron');
    const problems = findBuildProblems(distDir);
    if (problems.length > 0) {
        for (const problem of problems) console.error(`  - ${problem}`);
        console.error('Fix vite.config.ts externals (Vite 8 reads build.rolldownOptions.external).');
        process.exit(1);
    }
    console.log('Native modules are external in the main bundle.');
}
