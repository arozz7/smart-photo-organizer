/**
 * Scanner file-identity behaviour: records size / modified time / file id for every photo and
 * recognises files that were edited outside the app. Real SQLite, hashing and file system;
 * only ExifTool and preview generation are faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const previewCalls: { file: string; force: boolean }[] = [];

vi.mock('../../../electron/core/services/PhotoService', () => ({
    PhotoService: {
        getExifTool: vi.fn(async () => ({ read: vi.fn(async () => ({ ImageWidth: 4000, ImageHeight: 3000, Orientation: 1, DateTimeOriginal: '2020:05:04 10:00:00' })) })),
        extractPreview: vi.fn(async (file: string, previewDir: string, force = false) => {
            previewCalls.push({ file: path.basename(file), force });
            const target = path.join(previewDir, `${path.basename(file)}.jpg`);
            fs.writeFileSync(target, 'preview');
            return target;
        }),
    },
}));

vi.mock('../../../electron/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initDB, getDB, closeDB } from '../../../electron/db';
import { scanDirectory } from '../../../electron/scanner';

interface IdentityRow {
    file_size: number | null;
    file_mtime: number | null;
    file_id: string | null;
    sha256_hash: string | null;
    phash: string | null;
}

const sha256 = (content: string): string => createHash('sha256').update(content).digest('hex');
const MINUTE = 60_000;

describe('scanner file identity', () => {
    let base: string;
    let root: string;
    let library: string;
    let photo: string;

    const row = (): IdentityRow =>
        getDB().prepare('SELECT file_size, file_mtime, file_id, sha256_hash, phash FROM photos WHERE file_path = ?').get(photo) as IdentityRow;

    /** Writes new content and sets the modified time explicitly (tests must not depend on the clock). */
    const writeFile = (content: string, mtimeMs: number): void => {
        fs.writeFileSync(photo, content);
        fs.utimesSync(photo, new Date(mtimeMs), new Date(mtimeMs));
    };

    beforeEach(async () => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-identity-'));
        root = path.join(base, 'tree');
        library = path.join(base, 'lib');
        fs.mkdirSync(root);
        fs.mkdirSync(library);
        photo = path.join(root, 'a.jpg');
        writeFile('original content', 1_700_000_000_000);
        previewCalls.length = 0;
        await initDB(library);
    });

    afterEach(() => {
        closeDB();
        fs.rmSync(base, { recursive: true, force: true });
    });

    it('records size, modified time and file id when a photo is first indexed', async () => {
        // Act
        await scanDirectory(root, library);

        // Assert
        const stored = row();
        expect(stored.file_size).toBe(Buffer.byteLength('original content'));
        expect(Math.abs((stored.file_mtime as number) - 1_700_000_000_000)).toBeLessThan(2);
        expect(stored.file_id === null || /^\d+:\d+$/.test(stored.file_id)).toBe(true);
    });

    it('leaves an unchanged photo alone on rescan (not flagged, nothing regenerated)', async () => {
        // Arrange
        await scanDirectory(root, library);
        previewCalls.length = 0;

        // Act
        const [result] = await scanDirectory(root, library);

        // Assert
        expect(result).toMatchObject({ isNew: false, needsUpdate: false });
        expect(result.contentChanged).toBe(false);
        expect(previewCalls).toEqual([]);
    });

    it('fills in identity for photos indexed before it was recorded, without treating them as edited', async () => {
        // Arrange — a legacy row: indexed, identity columns NULL
        await scanDirectory(root, library);
        getDB().prepare('UPDATE photos SET file_size = NULL, file_mtime = NULL, file_id = NULL WHERE file_path = ?').run(photo);
        previewCalls.length = 0;

        // Act
        const [result] = await scanDirectory(root, library);

        // Assert
        expect(result).toMatchObject({ isNew: false, needsUpdate: false, contentChanged: false });
        expect(row().file_size).toBe(Buffer.byteLength('original content'));
        expect(previewCalls).toEqual([]);
    });

    it('detects a file edited outside the app (different size) and queues a full re-analysis', async () => {
        // Arrange
        await scanDirectory(root, library);
        previewCalls.length = 0;
        writeFile('edited content that is longer', 1_700_000_000_000 + 10 * MINUTE);

        // Act
        const [result] = await scanDirectory(root, library);

        // Assert: flagged for AI re-analysis with a clean rescan
        expect(result).toMatchObject({ isNew: true, needsUpdate: true, contentChanged: true });
        // Assert: preview regenerated (forced), hash and identity refreshed, stale perceptual hash cleared
        expect(previewCalls).toEqual([{ file: 'a.jpg', force: true }]);
        const stored = row();
        expect(stored.sha256_hash).toBe(sha256('edited content that is longer'));
        expect(stored.file_size).toBe(Buffer.byteLength('edited content that is longer'));
        expect(stored.phash).toBeNull();
    });

    it('detects an edit that keeps the same size (only the content hash reveals it)', async () => {
        // Arrange
        await scanDirectory(root, library);
        writeFile('ORIGINAL CONTENT', 1_700_000_000_000 + 10 * MINUTE); // same length, different bytes

        // Act
        const [result] = await scanDirectory(root, library);

        // Assert
        expect(result).toMatchObject({ isNew: true, contentChanged: true });
        expect(row().sha256_hash).toBe(sha256('ORIGINAL CONTENT'));
    });

    it('does NOT treat a re-saved or touched file as edited when the content is identical', async () => {
        // Arrange — same bytes, newer timestamp (copy tools, backups, "touch")
        await scanDirectory(root, library);
        previewCalls.length = 0;
        writeFile('original content', 1_700_000_000_000 + 10 * MINUTE);

        // Act
        const [result] = await scanDirectory(root, library);

        // Assert: not flagged, no regeneration, but the new timestamp is remembered so it is not re-hashed every scan
        expect(result).toMatchObject({ isNew: false, needsUpdate: false, contentChanged: false });
        expect(previewCalls).toEqual([]);
        expect(Math.abs((row().file_mtime as number) - (1_700_000_000_000 + 10 * MINUTE))).toBeLessThan(2);
    });

    it('ignores sub-tolerance timestamp jitter (no hashing, no writes)', async () => {
        // Arrange
        await scanDirectory(root, library);
        const before = row();
        writeFile('original content', 1_700_000_000_000 + 1500);

        // Act
        const [result] = await scanDirectory(root, library);

        // Assert
        expect(result.contentChanged).toBe(false);
        expect(row().file_mtime).toBe(before.file_mtime);
    });

    it('is cautious when only the timestamp changed and no hash was ever stored: refreshes identity, does not re-analyse', async () => {
        // Arrange
        await scanDirectory(root, library);
        getDB().prepare('UPDATE photos SET sha256_hash = NULL WHERE file_path = ?').run(photo);
        previewCalls.length = 0;
        writeFile('ORIGINAL CONTENT', 1_700_000_000_000 + 10 * MINUTE);

        // Act
        const [result] = await scanDirectory(root, library);

        // Assert
        expect(result).toMatchObject({ isNew: false, needsUpdate: false, contentChanged: false });
        expect(previewCalls).toEqual([]);
    });

    it('a forced rescan still reprocesses everything, and refreshes identity', async () => {
        // Arrange
        await scanDirectory(root, library);
        previewCalls.length = 0;

        // Act
        const [result] = await scanDirectory(root, library, undefined, { forceRescan: true });

        // Assert
        expect(result).toMatchObject({ isNew: true, needsUpdate: true });
        expect(previewCalls).toEqual([{ file: 'a.jpg', force: true }]);
    });
});
