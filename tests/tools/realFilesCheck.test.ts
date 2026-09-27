/**
 * Tool (not a behaviour test): checks the scanner against REAL photos. Never modifies the originals.
 * Set STUB_PYTHON=1 to make the (absent) Python backend fail instantly instead of timing out.
 * Set SPO_ELECTRON_DIR to another checkout of electron/ to run an older scanner version.
 * Skipped unless REAL_FILES_DIR (a folder of photos) or REAL_ORIENTATION_LIST (JSON array of paths)
 * is set. Used to compare two versions of the scanner on the same files:
 *
 *   # scan a folder and write a normalised snapshot (run once per scanner version, then diff the files)
 *   $env:REAL_FILES_DIR = "C:\temp\real-photos"; $env:SNAPSHOT_OUT = "C:\temp\snapshot-a.json"
 *   node scripts/run-tests.cjs tests/tools/realFilesCheck.test.ts
 *
 *   # verify the Orientation in a full ExifTool read equals a targeted read, for every listed file
 *   $env:REAL_ORIENTATION_LIST = "C:\temp\files.json"
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const realDir = process.env.REAL_FILES_DIR;
// Point at another checkout of electron/ (e.g. extracted from an older commit) to compare scanner versions
const electronDir = process.env.SPO_ELECTRON_DIR ?? path.resolve(__dirname, '../../electron');
const orientationList = process.env.REAL_ORIENTATION_LIST;

describe.skipIf(!realDir)('real photos: scan snapshot', () => {
    it('scans the folder and writes a normalised snapshot', async () => {
        if (process.env.STUB_PYTHON === '1') {
            // The harness has no Python backend, and RAW previews fall back to it (120 s timeout each).
            // Fail those requests instantly, identically for every scanner version being compared.
            vi.doMock(path.join(electronDir, 'infrastructure/PythonAIProvider'), () => ({
                pythonProvider: { generateThumbnail: async () => ({ success: false }), sendRequest: async () => ({ success: false }) },
            }));
        }
        const { initDB, getDB, closeDB } = await import(/* @vite-ignore */ path.join(electronDir, 'db'));
        const { scanDirectory } = await import(/* @vite-ignore */ path.join(electronDir, 'scanner'));
        const library = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-real-lib-'));
        await initDB(library);

        try {
            const t0 = performance.now();
            const results = await scanDirectory(realDir as string, library);
            const scanMs = Math.round(performance.now() - t0);

            const rows = getDB()
                .prepare('SELECT file_path, preview_cache_path, date_taken, width, height, metadata_json, sha256_hash, description FROM photos ORDER BY file_path')
                .all() as Record<string, string | number | null>[];
            const errors = getDB().prepare('SELECT file_path, error_message, stage FROM scan_errors ORDER BY file_path, stage').all();

            const photos = [];
            for (const row of rows) {
                const previewMeta = row.preview_cache_path ? await sharp(row.preview_cache_path as string).metadata() : null;
                photos.push({
                    ...row,
                    preview_cache_path: row.preview_cache_path ? path.basename(row.preview_cache_path as string) : null,
                    preview: previewMeta ? { width: previewMeta.width, height: previewMeta.height } : null,
                });
            }

            const snapshot = { returnedInOrder: results.map(r => path.basename(r.file_path)), photos, errors };
            console.log(`[real] files=${rows.length} scanMs=${scanMs} perFileMs=${(scanMs / Math.max(rows.length, 1)).toFixed(1)}`);
            if (process.env.SNAPSHOT_OUT) fs.writeFileSync(process.env.SNAPSHOT_OUT, JSON.stringify(snapshot, null, 2));
            expect(rows.length).toBeGreaterThan(0);
        } finally {
            closeDB();
            fs.rmSync(library, { recursive: true, force: true });
        }
    }, 900_000);
});

describe.skipIf(!orientationList)('real photos: Orientation from full read equals targeted read', () => {
    it('matches for every listed file', async () => {
        const { PhotoService } = await import(/* @vite-ignore */ path.join(electronDir, 'core/services/PhotoService'));
        const tool = await PhotoService.getExifTool();
        const files = JSON.parse(fs.readFileSync(orientationList as string, 'utf-8')) as string[];
        const mismatches: string[] = [];

        for (const file of files) {
            const full = await tool!.read(file);
            const targeted = await tool!.read(file, ['Orientation']);
            if (JSON.stringify(full.Orientation) !== JSON.stringify(targeted.Orientation)) {
                mismatches.push(`${file}: full=${JSON.stringify(full.Orientation)} targeted=${JSON.stringify(targeted.Orientation)}`);
            }
        }

        console.log(`[real] orientation checked=${files.length} mismatches=${mismatches.length}`);
        expect(mismatches).toEqual([]);
    }, 900_000);
});
