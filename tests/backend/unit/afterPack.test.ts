import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { pruneOtherPlatformPrebuilds, prebuildsDirFor } = require('../../../scripts/release/afterPack.cjs');

const ALL_PREBUILDS = [
    'darwin-arm64.node', 'darwin-x64.node',
    'linux-arm64.node', 'linux-x64.node', 'linuxmusl-arm64.node', 'linuxmusl-x64.node',
    'win32-arm64.node', 'win32-x64.node',
];

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-prebuilds-'));
    for (const name of ALL_PREBUILDS) fs.writeFileSync(path.join(dir, name), 'x'.repeat(10));
    fs.writeFileSync(path.join(dir, 'README.txt'), 'keep me');
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const remaining = () => fs.readdirSync(dir).sort();

describe('pruneOtherPlatformPrebuilds', () => {
    it('keeps only the Windows binaries for a Windows package', () => {
        const result = pruneOtherPlatformPrebuilds(dir, 'win32');

        expect(remaining()).toEqual(['README.txt', 'win32-arm64.node', 'win32-x64.node']);
        expect(result.removed).toHaveLength(6);
        expect(result.bytes).toBe(60);
    });

    it('keeps the glibc and musl binaries for a Linux package', () => {
        pruneOtherPlatformPrebuilds(dir, 'linux');

        expect(remaining()).toEqual([
            'README.txt', 'linux-arm64.node', 'linux-x64.node', 'linuxmusl-arm64.node', 'linuxmusl-x64.node',
        ]);
    });

    it('keeps both architectures for a macOS package (it may be universal)', () => {
        pruneOtherPlatformPrebuilds(dir, 'darwin');

        expect(remaining()).toEqual(['README.txt', 'darwin-arm64.node', 'darwin-x64.node']);
    });

    it('removes nothing for a platform it does not know', () => {
        const result = pruneOtherPlatformPrebuilds(dir, 'freebsd');

        expect(remaining()).toHaveLength(ALL_PREBUILDS.length + 1);
        expect(result.removed).toEqual([]);
    });

    it('does nothing when the folder is missing (module not packaged)', () => {
        const result = pruneOtherPlatformPrebuilds(path.join(dir, 'missing'), 'win32');

        expect(result).toEqual({ removed: [], bytes: 0 });
    });
});

describe('prebuildsDirFor', () => {
    it('points at the unpacked better-sqlite3 prebuilds under the resources folder', () => {
        expect(prebuildsDirFor(path.join('out', 'resources'))).toBe(
            path.join('out', 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'prebuilds')
        );
    });
});
