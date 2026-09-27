/**
 * PhotoIdentityRepository / PhotoIdentityService against a real SQLite database and real files.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../../electron/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initDB, getDB, closeDB } from '../../../electron/db';
import { PhotoIdentityRepository } from '../../../electron/data/repositories/PhotoIdentityRepository';
import { PhotoIdentityService } from '../../../electron/core/services/PhotoIdentityService';

const identity = (size: number, mtime = 1_700_000_000_000, fileId: string | null = '5:77') => ({ size, mtime, fileId });

describe('PhotoIdentity', () => {
    let base: string;
    const addPhoto = (filePath: string, extra: Record<string, unknown> = {}): number => {
        const columns = ['file_path', ...Object.keys(extra)];
        const info = getDB()
            .prepare(`INSERT INTO photos (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
            .run(filePath, ...Object.values(extra));
        return Number(info.lastInsertRowid);
    };
    const identityOf = (id: number) =>
        getDB().prepare('SELECT file_size, file_mtime, file_id, sha256_hash, phash FROM photos WHERE id = ?').get(id) as Record<string, unknown>;

    beforeEach(async () => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-pid-'));
        await initDB(base);
    });

    afterEach(() => {
        closeDB();
        fs.rmSync(base, { recursive: true, force: true });
    });

    describe('PhotoIdentityRepository', () => {
        it('stores an identity for a photo', () => {
            // Arrange
            const id = addPhoto('a.jpg');

            // Act
            PhotoIdentityRepository.setIdentity(id, identity(123, 999, '5:1'));

            // Assert
            expect(identityOf(id)).toMatchObject({ file_size: 123, file_mtime: 999, file_id: '5:1' });
        });

        it('lists photos without an identity in id order, after a cursor, up to the limit', () => {
            // Arrange
            const ids = [addPhoto('a.jpg'), addPhoto('b.jpg'), addPhoto('c.jpg'), addPhoto('d.jpg')];
            PhotoIdentityRepository.setIdentity(ids[1], identity(1)); // already recorded

            // Act
            const firstPage = PhotoIdentityRepository.getPhotosNeedingIdentity(0, 2);
            const secondPage = PhotoIdentityRepository.getPhotosNeedingIdentity(firstPage[firstPage.length - 1].id, 2);

            // Assert
            expect(firstPage.map(p => p.file_path)).toEqual(['a.jpg', 'c.jpg']);
            expect(secondPage.map(p => p.file_path)).toEqual(['d.jpg']);
        });

        it('does not list photos already marked missing (their file is gone)', () => {
            // Arrange
            addPhoto('gone.jpg', { missing_since: '2026-01-01' });
            addPhoto('here.jpg');

            // Act
            const pending = PhotoIdentityRepository.getPhotosNeedingIdentity(0, 10);

            // Assert
            expect(pending.map(p => p.file_path)).toEqual(['here.jpg']);
        });

        it('counts photos still needing an identity', () => {
            // Arrange
            const a = addPhoto('a.jpg');
            addPhoto('b.jpg');
            PhotoIdentityRepository.setIdentity(a, identity(1));

            // Assert
            expect(PhotoIdentityRepository.countPhotosNeedingIdentity()).toBe(1);
        });

        it('saves a batch atomically', () => {
            // Arrange
            const a = addPhoto('a.jpg');
            const b = addPhoto('b.jpg');

            // Act
            PhotoIdentityRepository.setIdentityBatch([{ id: a, identity: identity(1) }, { id: b, identity: identity(2, 5, null) }]);

            // Assert
            expect(identityOf(a).file_size).toBe(1);
            expect(identityOf(b)).toMatchObject({ file_size: 2, file_id: null });
        });

        it('after an in-app rewrite: stores the new identity and clears the stale hashes', () => {
            // Arrange
            const id = addPhoto('a.jpg', { sha256_hash: 'old', phash: 'oldp' });

            // Act
            PhotoIdentityRepository.markContentRewritten(id, identity(500));

            // Assert
            expect(identityOf(id)).toMatchObject({ file_size: 500, sha256_hash: null, phash: null });
        });
    });

    describe('PhotoIdentityService.refreshAfterRewrite', () => {
        it('reads the file on disk and records its identity, clearing stale hashes', async () => {
            // Arrange
            const file = path.join(base, 'rotated.jpg');
            fs.writeFileSync(file, 'new bytes after rotation');
            const id = addPhoto(file, { sha256_hash: 'old', phash: 'oldp' });

            // Act
            await PhotoIdentityService.refreshAfterRewrite(id, file);

            // Assert
            expect(identityOf(id)).toMatchObject({ file_size: Buffer.byteLength('new bytes after rotation'), sha256_hash: null, phash: null });
        });

        it('does nothing (and does not throw) when the file cannot be read', async () => {
            // Arrange
            const id = addPhoto('C:/definitely/not/here.jpg', { sha256_hash: 'keep' });

            // Act / Assert
            await expect(PhotoIdentityService.refreshAfterRewrite(id, 'C:/definitely/not/here.jpg')).resolves.toBeUndefined();
            expect(identityOf(id).sha256_hash).toBe('keep');
        });
    });
});
