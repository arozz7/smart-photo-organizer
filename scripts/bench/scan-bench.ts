/**
 * Scanner benchmark: runs the REAL scanner (sharp, ExifTool, SQLite) over a synthetic tree and
 * reports first-ingest and unchanged-rescan timings. Run through the vitest environment
 * (better-sqlite3 ABI + electron mock):
 *
 *   $env:SCAN_BENCH = "1"; $env:SCAN_BENCH_FILES = "1000"
 *   node scripts/run-tests.cjs tests/tools/scanBench.test.ts
 *
 * Record the printed numbers in the phase changelog; they are machine-specific, so compare
 * before/after on the same machine only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

export interface BenchOptions {
    files: number;
    foldersCount: number;
}

export interface BenchResult {
    files: number;
    ingestMs: number;
    rescanMs: number;
    ingestPerFileMs: number;
    rescanPerFileMs: number;
}

/** Writes `files` small, distinct JPEGs spread over `foldersCount` folders. Returns the root. */
export async function createSyntheticTree(options: BenchOptions): Promise<string> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-'));
    for (let i = 0; i < options.files; i++) {
        const folder = path.join(root, `folder-${i % options.foldersCount}`);
        fs.mkdirSync(folder, { recursive: true });
        // Distinct colour per file so hashes differ; tiny so generation stays cheap
        const colour = { r: i % 256, g: (i * 7) % 256, b: (i * 13) % 256 };
        await sharp({ create: { width: 320, height: 240, channels: 3, background: colour } })
            .jpeg({ quality: 70 })
            .toFile(path.join(folder, `IMG_${String(i).padStart(6, '0')}.jpg`));
    }
    return root;
}

export async function runScanBench(options: BenchOptions): Promise<BenchResult> {
    const { initDB, closeDB } = await import('../../electron/db');
    const { scanDirectory } = await import('../../electron/scanner');

    const tree = await createSyntheticTree(options);
    const library = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-lib-'));
    await initDB(library);

    try {
        const t0 = performance.now();
        await scanDirectory(tree, library);
        const ingestMs = performance.now() - t0;

        const t1 = performance.now();
        await scanDirectory(tree, library);
        const rescanMs = performance.now() - t1;

        return {
            files: options.files,
            ingestMs: Math.round(ingestMs),
            rescanMs: Math.round(rescanMs),
            ingestPerFileMs: Number((ingestMs / options.files).toFixed(2)),
            rescanPerFileMs: Number((rescanMs / options.files).toFixed(2)),
        };
    } finally {
        closeDB();
        fs.rmSync(tree, { recursive: true, force: true });
        fs.rmSync(library, { recursive: true, force: true });
    }
}
