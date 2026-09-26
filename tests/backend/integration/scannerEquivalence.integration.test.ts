/**
 * Scanner equivalence test.
 *
 * Runs the REAL scanner (real SQLite via initDB, real hashing, real file walking) over a
 * deterministic tree, with only ExifTool and preview generation faked, through a fixed sequence
 * of scenarios (first scan, unchanged rescan, missing previews, metadata backfill, forced rescan,
 * failures, scanFiles). The resulting `photos` / `scan_errors` rows and the per-file result flags
 * are compared with a golden snapshot captured from the ORIGINAL scanner implementation, so
 * performance work on the scanner can prove it changed no behaviour.
 *
 * Regenerate the golden only for an intentional behaviour change:
 *   $env:UPDATE_SCAN_GOLDEN = "1"; node scripts/run-tests.cjs tests/backend/integration/scannerEquivalence.integration.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

// ---- Fakes for the two slow external collaborators --------------------------------------------
const behaviour = { previewShouldFail: new Set<string>() };

const fakeMetadata = (file: string): Record<string, unknown> => {
    const name = path.basename(file);
    const day = (createHash('md5').update(name).digest()[0] % 27) + 1;
    const meta: Record<string, unknown> = {
        ImageWidth: 4000,
        ImageHeight: 3000,
        Orientation: 1,
        DateTimeOriginal: `2020:05:${String(day).padStart(2, '0')} 10:00:00`,
        Make: 'TestCam',
    };
    if (name === 'rotated.jpg') meta.Orientation = 6; // dimensions must be swapped
    if (name.toLowerCase().endsWith('.arw')) { delete meta.ImageWidth; delete meta.ImageHeight; meta.SourceImageWidth = 6000; meta.SourceImageHeight = 4000; }
    return meta;
};

const previewNameFor = (file: string): string =>
    `${path.basename(path.dirname(file))}__${path.basename(file)}.jpg`;

vi.mock('../../../electron/core/services/PhotoService', () => ({
    PhotoService: {
        getExifTool: vi.fn(async () => ({ read: vi.fn(async (file: string) => fakeMetadata(file)) })),
        extractPreview: vi.fn(async (file: string, previewDir: string, force = false) => {
            if (behaviour.previewShouldFail.has(path.basename(file))) throw new Error('preview boom');
            const target = path.join(previewDir, previewNameFor(file));
            if (force || !fs.existsSync(target)) fs.writeFileSync(target, 'preview');
            return target;
        }),
    },
}));

vi.mock('../../../electron/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initDB, getDB, closeDB } from '../../../electron/db';
import { scanDirectory, scanFiles } from '../../../electron/scanner';

const GOLDEN_PATH = path.resolve(__dirname, '../../fixtures/scan-golden.json');

// ---- Deterministic tree ------------------------------------------------------------------------
const TREE: Record<string, string> = {
    '2019/a.jpg': 'content-a',
    '2019/b.jpg': 'content-b',
    '2019/c.png': 'content-c',
    '2019/d.jfif': 'content-d',
    '2019/raw/e.ARW': 'content-e',
    '2019/raw/f.cr2': 'content-f',
    '2020/rotated.jpg': 'content-rotated',
    '2020/broken.jpg': 'content-broken',
    '2020/notes.txt': 'not an image',
    '2020/clip.mp4': 'not supported',
    '2021/deep/deeper/i.jpg': 'content-i',
    '.hidden/j.jpg': 'content-hidden',
    'k.tiff': 'content-k',
};

interface Snapshot {
    photos: Record<string, unknown>[];
    scanErrors: Record<string, unknown>[];
    results: { file: string; isNew: boolean; needsUpdate: boolean }[];
}

describe('scanner equivalence (golden snapshot)', () => {
    let base: string;
    let root: string;
    let library: string;

    beforeEach(async () => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-scan-'));
        root = path.join(base, 'tree'); // fixed folder name keeps preview names deterministic
        fs.mkdirSync(root);
        library = path.join(base, 'lib');
        fs.mkdirSync(library);
        behaviour.previewShouldFail = new Set(['broken.jpg']);
        for (const [rel, content] of Object.entries(TREE)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        }
        fs.mkdirSync(path.join(root, '2021', 'empty'), { recursive: true });
        await initDB(library);
    });

    afterEach(() => {
        closeDB();
        fs.rmSync(base, { recursive: true, force: true });
    });

    const normalise = (value: unknown): unknown => {
        if (typeof value !== 'string') return value;
        return value.split(root).join('<ROOT>').split(library).join('<LIB>').replace(/\\/g, '/');
    };

    const snapshot = (results: { file_path: string; isNew: boolean; needsUpdate: boolean }[]): Snapshot => {
        const db = getDB();
        const photos = db
            .prepare(`SELECT file_path, preview_cache_path, date_taken, width, height, metadata_json, sha256_hash, description FROM photos ORDER BY file_path`)
            .all() as Record<string, unknown>[];
        const scanErrors = db
            .prepare(`SELECT file_path, error_message, stage FROM scan_errors ORDER BY file_path, stage`)
            .all() as Record<string, unknown>[];
        return {
            photos: photos.map(p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, normalise(v)]))),
            scanErrors: scanErrors.map(e => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, normalise(v)]))),
            results: results.map(r => ({ file: normalise(r.file_path) as string, isNew: r.isNew, needsUpdate: r.needsUpdate })),
        };
    };

    /** Same depth-first, readdir-order walk the scanner has always used (the ordering contract). */
    const referenceOrder = (dir: string): string[] => {
        const out: string[] = [];
        const supported = ['.jpg', '.jpeg', '.png', '.jfif', '.arw', '.cr2', '.nef', '.dng', '.orf', '.rw2', '.tif', '.tiff'];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { if (!entry.name.startsWith('.')) out.push(...referenceOrder(full)); }
            else if (entry.isFile() && supported.includes(path.extname(entry.name).toLowerCase())) out.push(full);
        }
        return out;
    };

    it('produces the same rows and result flags as the original scanner across scenarios', async () => {
        const steps: Record<string, Snapshot> = {};
        const previewDir = path.join(library, 'previews');

        // 1. first scan: everything new; the broken preview is recorded as an 'Initial Scan' error
        const first = await scanDirectory(root, library);
        expect(first.map(p => p.file_path)).toEqual(referenceOrder(root)); // ordering contract
        steps['1_first_scan'] = snapshot(first);

        // 2. unchanged rescan: nothing to regenerate
        const second = await scanDirectory(root, library);
        expect(second.map(p => p.file_path)).toEqual(referenceOrder(root));
        steps['2_unchanged_rescan'] = snapshot(second);

        // 3. previews deleted for one standard and one raw file: regenerated on rescan
        fs.rmSync(path.join(previewDir, previewNameFor(path.join(root, '2019', 'a.jpg'))));
        fs.rmSync(path.join(previewDir, previewNameFor(path.join(root, '2019', 'raw', 'e.ARW'))));
        steps['3_missing_previews'] = snapshot(await scanDirectory(root, library));

        // 4. metadata cleared in the DB: backfilled on rescan
        getDB().prepare(`UPDATE photos SET metadata_json = '{}', width = NULL, height = NULL WHERE file_path LIKE '%b.jpg'`).run();
        steps['4_metadata_backfill'] = snapshot(await scanDirectory(root, library));

        // 5. the broken preview starts working, and the whole tree is force-rescanned
        behaviour.previewShouldFail.clear();
        steps['5_force_rescan'] = snapshot(await scanDirectory(root, library, undefined, { forceRescan: true }));

        // 6. scanFiles on a subset, with a preview deleted and a path that does not exist
        fs.rmSync(path.join(previewDir, previewNameFor(path.join(root, '2019', 'c.png'))));
        steps['6_scan_files'] = snapshot(await scanFiles(
            [path.join(root, '2019', 'c.png'), path.join(root, '2019', 'missing.jpg'), path.join(root, '2020', 'rotated.jpg')],
            library,
        ));

        if (process.env.UPDATE_SCAN_GOLDEN === '1') {
            fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
            fs.writeFileSync(GOLDEN_PATH, JSON.stringify(steps, null, 2) + '\n');
        }
        const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf-8')) as Record<string, Snapshot>;

        expect(Object.keys(steps)).toEqual(Object.keys(golden));
        for (const key of Object.keys(golden)) {
            expect(steps[key], `scenario ${key}`).toEqual(golden[key]);
        }
    });
});
