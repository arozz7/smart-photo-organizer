/**
 * The path source for "Send to..." against a real SQLite database: selections, Smart Albums, missing marks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../../electron/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initDB, getDB, closeDB } from '../../../electron/db';
import { SmartAlbumRepository } from '../../../electron/data/repositories/SmartAlbumRepository';
import { createDbPhotoPathSource } from '../../../electron/core/services/sendTo/createDbPhotoPathSource';

describe('Send to... path source (real database)', () => {
    let base: string;
    const addPhoto = (filePath: string, missingSince: string | null = null): number => {
        const info = getDB()
            .prepare('INSERT INTO photos (file_path, missing_since) VALUES (?, ?)')
            .run(filePath, missingSince);
        return Number(info.lastInsertRowid);
    };

    beforeEach(async () => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-sendto-'));
        await initDB(base);
    });

    afterEach(() => {
        closeDB();
        fs.rmSync(base, { recursive: true, force: true });
    });

    it('returns stored paths for selected ids in the requested order, leaving out unknown ids', () => {
        const a = addPhoto('C:\\Photos\\a.jpg');
        const b = addPhoto('C:\\Photos\\b.jpg');

        const rows = createDbPhotoPathSource().pathsForPhotoIds([b, 9999, a]);

        expect(rows.map(r => r.filePath)).toEqual(['C:\\Photos\\b.jpg', 'C:\\Photos\\a.jpg']);
    });

    it('reports the missing mark of a photo', () => {
        const id = addPhoto('C:\\Photos\\gone.jpg', '2026-11-01 10:00:00');

        const [row] = createDbPhotoPathSource().pathsForPhotoIds([id]);

        expect(row.missingSince).toBe('2026-11-01 10:00:00');
    });

    it('handles more ids than one SQL statement can bind', () => {
        const ids = Array.from({ length: 1200 }, (_, i) => addPhoto(`C:\\Photos\\bulk-${i}.jpg`));

        const rows = createDbPhotoPathSource().pathsForPhotoIds(ids);

        expect(rows).toHaveLength(1200);
        expect(rows[0].id).toBe(ids[0]);
        expect(rows[1199].id).toBe(ids[1199]);
    });

    it('resolves a Smart Album saved with a folder filter to every matching photo, across pages', () => {
        // More photos than one page (500) so the paging loop is exercised.
        for (let i = 0; i < 1100; i++) addPhoto(`C:\\Holiday\\img-${String(i).padStart(4, '0')}.jpg`);
        addPhoto('C:\\Other\\not-in-album.jpg');
        const album = SmartAlbumRepository.create('Holiday', JSON.stringify({ compound: false, filter: { folder: 'C:\\Holiday' } }));

        const rows = createDbPhotoPathSource().pathsForSmartAlbum(album.id);

        expect(rows).toHaveLength(1100);
        expect(new Set(rows!.map(r => r.id)).size).toBe(1100);
        expect(rows!.every(r => r.filePath.startsWith('C:\\Holiday'))).toBe(true);
    });

    it('resolves a compound Smart Album', () => {
        addPhoto('C:\\Photos\\keep\\one.jpg');
        addPhoto('C:\\Photos\\skip\\two.jpg');
        const compound = {
            logic: 'AND',
            groups: [{ logic: 'AND', conditions: [{ field: 'folder', operator: 'eq', value: 'C:\\Photos\\keep' }] }],
        };
        const album = SmartAlbumRepository.create('Keepers', JSON.stringify({ compound: true, filter: compound }));

        const rows = createDbPhotoPathSource().pathsForSmartAlbum(album.id);

        expect(rows?.map(r => r.filePath)).toEqual(['C:\\Photos\\keep\\one.jpg']);
    });

    it('returns null for an album that does not exist', () => {
        expect(createDbPhotoPathSource().pathsForSmartAlbum(12345)).toBeNull();
    });
});
