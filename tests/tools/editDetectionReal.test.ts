/**
 * Tool (not a behaviour test): edit detection end to end with the REAL tools (sharp, ExifTool, SQLite).
 * The behaviour tests fake ExifTool and preview generation; this proves the whole chain works for real.
 * Skipped unless SCAN_BENCH=1:
 *
 *   $env:SCAN_BENCH = "1"; node scripts/run-tests.cjs tests/tools/editDetectionReal.test.ts
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const makeJpeg = (file: string, width: number, height: number, red: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: red, g: 80, b: 120 } } }).jpeg({ quality: 85 }).toFile(file);

describe.skipIf(process.env.SCAN_BENCH !== '1')('edit detection with real tools', () => {
    it('flags only the file that was really edited, and refreshes its dimensions, preview and hash', async () => {
        // Arrange
        sharp.cache(false); // on Windows a cached/mapped input file cannot be overwritten
        const { initDB, getDB, closeDB } = await import('../../electron/db');
        const { scanDirectory } = await import('../../electron/scanner');
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-editreal-'));
        const root = path.join(base, 'photos');
        const library = path.join(base, 'lib');
        fs.mkdirSync(root); fs.mkdirSync(library);
        const edited = path.join(root, 'edited.jpg');
        const touched = path.join(root, 'touched.jpg');
        const untouched = path.join(root, 'untouched.jpg');
        await makeJpeg(edited, 640, 480, 200);
        await makeJpeg(touched, 640, 480, 100);
        await makeJpeg(untouched, 640, 480, 50);
        await initDB(library);

        try {
            const first = await scanDirectory(root, library);
            expect(first).toHaveLength(3);
            const row = (file: string) => getDB().prepare('SELECT width, height, sha256_hash, preview_cache_path, file_size FROM photos WHERE file_path = ?').get(file) as
                { width: number; height: number; sha256_hash: string; preview_cache_path: string; file_size: number };
            const before = row(edited);
            expect(before).toMatchObject({ width: 640, height: 480 });

            // Act: really edit one file (new size), only touch another (same bytes, newer time)
            await makeJpeg(edited, 800, 600, 10);
            const later = new Date(Date.now() + 60 * 60 * 1000);
            fs.utimesSync(touched, later, later);
            const second = await scanDirectory(root, library);
            const flag = (file: string) => second.find(p => p.file_path === file)!;

            // Assert: flags
            expect(flag(edited)).toMatchObject({ isNew: true, needsUpdate: true, contentChanged: true });
            expect(flag(touched)).toMatchObject({ isNew: false, needsUpdate: false, contentChanged: false });
            expect(flag(untouched)).toMatchObject({ isNew: false, needsUpdate: false, contentChanged: false });

            // Assert: the edited photo's record, hash and real preview were refreshed
            const after = row(edited);
            expect(after).toMatchObject({ width: 800, height: 600 });
            expect(after.sha256_hash).not.toBe(before.sha256_hash);
            expect(after.file_size).not.toBe(before.file_size);
            expect((await sharp(after.preview_cache_path).metadata()).width).toBe(800);

            // Assert: a third scan finds nothing to do
            const third = await scanDirectory(root, library);
            expect(third.every(p => !p.contentChanged && !p.isNew)).toBe(true);
            console.log('[editreal] edited flagged; touched and untouched left alone; third scan quiet');
        } finally {
            closeDB();
            fs.rmSync(base, { recursive: true, force: true });
        }
    }, 120_000);
});
