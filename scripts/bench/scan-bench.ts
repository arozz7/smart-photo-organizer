/**
 * Scanner benchmark: runs the REAL scanner (sharp, ExifTool, SQLite) over a synthetic tree and
 * reports first-ingest and unchanged-rescan timings, AND verifies the results are correct
 * (a speed-up is meaningless if ExifTool silently timed out and returned empty metadata).
 *
 * Run through the vitest environment (better-sqlite3 ABI + electron mock):
 *
 *   $env:SCAN_BENCH = "1"; $env:SCAN_BENCH_FILES = "500"
 *   # optional: SCAN_BENCH_PROCS, SCAN_BENCH_CONCURRENCY, SCAN_BENCH_SIZE=photo
 *   node scripts/run-tests.cjs tests/tools/scanBench.test.ts
 *
 * Numbers are machine-specific; compare before/after on the same machine only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

export interface BenchOptions {
    files: number;
    foldersCount: number;
    /** Image size in pixels. Default 320x240 (cheap); use ~3000x2000 to approximate real photos. */
    width?: number;
    height?: number;
    /** Overrides the scanner settings for this run (must be set before ExifTool starts). */
    concurrency?: number;
    exiftoolProcesses?: number;
}

/** Counts of rows that came back wrong. Every field must be 0 for the run to be valid. */
export interface BenchVerification {
    rows: number;
    emptyMetadata: number;
    missingDimensions: number;
    missingHash: number;
    missingPreviewFile: number;
}

export interface BenchResult {
    files: number;
    ingestMs: number;
    rescanMs: number;
    ingestPerFileMs: number;
    rescanPerFileMs: number;
    settings: { concurrency: number; exiftoolProcesses: number };
    verification: BenchVerification;
}

/** Writes `files` distinct JPEGs spread over `foldersCount` folders. Returns the root. */
export async function createSyntheticTree(options: BenchOptions): Promise<string> {
    const { width = 320, height = 240 } = options;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-'));
    for (let i = 0; i < options.files; i++) {
        const folder = path.join(root, `folder-${i % options.foldersCount}`);
        fs.mkdirSync(folder, { recursive: true });
        // Distinct colour per file so hashes differ; gaussian noise makes big images realistic to encode
        const image = sharp({
            create: {
                width, height, channels: 3,
                background: { r: i % 256, g: (i * 7) % 256, b: (i * 13) % 256 },
                ...(width * height > 1_000_000 ? { noise: { type: 'gaussian' as const, mean: 128, sigma: 30 } } : {}),
            },
        });
        await image.jpeg({ quality: 80 }).toFile(path.join(folder, `IMG_${String(i).padStart(6, '0')}.jpg`));
    }
    return root;
}

interface StoredRow {
    metadata_json: string | null;
    width: number | null;
    height: number | null;
    sha256_hash: string | null;
    preview_cache_path: string | null;
}

/** Reads every stored photo and counts the ones that are incomplete. */
export function verifyIngest(rows: StoredRow[]): BenchVerification {
    return {
        rows: rows.length,
        emptyMetadata: rows.filter(r => !r.metadata_json || r.metadata_json === '{}').length,
        missingDimensions: rows.filter(r => !r.width || !r.height).length,
        missingHash: rows.filter(r => !r.sha256_hash).length,
        missingPreviewFile: rows.filter(r => {
            if (!r.preview_cache_path) return true;
            try { return fs.statSync(r.preview_cache_path).size === 0; } catch { return true; }
        }).length,
    };
}

export async function runScanBench(options: BenchOptions): Promise<BenchResult> {
    // SPO_ELECTRON_DIR points at another checkout of electron/ (e.g. an older commit) to compare versions
    const electronDir = process.env.SPO_ELECTRON_DIR ?? path.resolve(__dirname, '../../electron');
    const load = (relative: string) => import(/* @vite-ignore */ path.join(electronDir, relative));
    const { initDB, getDB, closeDB } = await load('db');
    const { scanDirectory } = await load('scanner');
    const { ConfigService } = await load('core/services/ConfigService');

    // Override IN MEMORY only (ConfigService.updateSettings would persist to config.json).
    // Must happen before ExifTool is first used: its process count is fixed at start-up.
    const settings = { ...ConfigService.getScannerSettings() };
    if (options.concurrency) settings.concurrency = options.concurrency;
    if (options.exiftoolProcesses) settings.exiftoolProcesses = options.exiftoolProcesses;
    const { vi } = await import('vitest');
    vi.spyOn(ConfigService, 'getScannerSettings').mockReturnValue(settings);

    const tree = await createSyntheticTree(options);
    const library = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-lib-'));
    await initDB(library);

    try {
        const t0 = performance.now();
        await scanDirectory(tree, library);
        const ingestMs = performance.now() - t0;

        const verification = verifyIngest(getDB().prepare(
            'SELECT metadata_json, width, height, sha256_hash, preview_cache_path FROM photos',
        ).all() as StoredRow[]);

        const t1 = performance.now();
        await scanDirectory(tree, library);
        const rescanMs = performance.now() - t1;

        return {
            files: options.files,
            ingestMs: Math.round(ingestMs),
            rescanMs: Math.round(rescanMs),
            ingestPerFileMs: Number((ingestMs / options.files).toFixed(2)),
            rescanPerFileMs: Number((rescanMs / options.files).toFixed(2)),
            settings,
            verification,
        };
    } finally {
        closeDB();
        fs.rmSync(tree, { recursive: true, force: true });
        fs.rmSync(library, { recursive: true, force: true });
    }
}
