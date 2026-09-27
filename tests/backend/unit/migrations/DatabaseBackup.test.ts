import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseBackup, hasRoomForBackup } from '../../../../electron/data/migrations/DatabaseBackup';

describe('DatabaseBackup', () => {
    let workDir: string;
    let db: Database.Database;
    let tick: number;
    const clock = (): Date => new Date(Date.UTC(2026, 8, 26, 12, 0, tick++));

    beforeEach(() => {
        tick = 0;
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-backup-'));
        db = new Database(path.join(workDir, 'library.db'));
        db.exec(`CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT);
                 INSERT INTO people (name) VALUES ('Alice'), ('Bob');`);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    const backupFiles = (dir: string): string[] => fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort();

    it('writes a consistent copy named with both schema versions into the backup folder', async () => {
        // Arrange
        const backupDir = path.join(workDir, 'backups');
        const backup = new DatabaseBackup(backupDir, 3, clock);

        // Act
        const written = await backup.create(db, 1, 4);

        // Assert
        expect(path.basename(written)).toMatch(/^library\.v1-to-v4\.\d{4}-\d{2}-\d{2}T[\d-]+Z\.db$/);
        const copy = new Database(written, { readonly: true });
        expect((copy.prepare('SELECT COUNT(*) AS c FROM people').get() as { c: number }).c).toBe(2);
        copy.close();
    });

    it('keeps only the newest N backups', async () => {
        // Arrange
        const backupDir = path.join(workDir, 'backups');
        const backup = new DatabaseBackup(backupDir, 3, clock);

        // Act
        for (let i = 0; i < 5; i++) await backup.create(db, i, i + 1);

        // Assert
        const files = backupFiles(backupDir);
        expect(files).toHaveLength(3);
        expect(files[0]).toContain('v2-to-v3');
        expect(files[2]).toContain('v4-to-v5');
    });

    it('never deletes files it did not create', async () => {
        // Arrange
        const backupDir = path.join(workDir, 'backups');
        fs.mkdirSync(backupDir);
        fs.writeFileSync(path.join(backupDir, 'my-own-notes.db'), 'keep me');
        const backup = new DatabaseBackup(backupDir, 1, clock);

        // Act
        await backup.create(db, 0, 1);
        await backup.create(db, 1, 2);

        // Assert
        expect(fs.existsSync(path.join(backupDir, 'my-own-notes.db'))).toBe(true);
        expect(backupFiles(backupDir).filter(f => f.startsWith('library.v'))).toHaveLength(1);
    });

    it('rejects a retention count below 1 so a backup can never delete itself', () => {
        // Act / Assert
        expect(() => new DatabaseBackup(path.join(workDir, 'b'), 0, clock)).toThrow(/at least 1/i);
    });
});

describe('DatabaseBackup: progress and disk space', () => {
    let workDir: string;
    let db: Database.Database;
    const MB = 1024 * 1024;

    beforeEach(() => {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-backup2-'));
        db = new Database(path.join(workDir, 'library.db'));
        db.exec('CREATE TABLE blobs (id INTEGER PRIMARY KEY, data BLOB)');
        const insert = db.prepare('INSERT INTO blobs (data) VALUES (?)');
        for (let i = 0; i < 300; i++) insert.run(Buffer.alloc(4096, i % 256)); // ~1.2 MB, many pages
    });

    afterEach(() => {
        db.close();
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    it('reports increasing progress from 0 to 100 percent while copying', async () => {
        // Arrange
        const backup = new DatabaseBackup(path.join(workDir, 'backups'), 3);
        const seen: number[] = [];

        // Act
        await backup.create(db, 0, 1, percent => seen.push(percent));

        // Assert
        expect(seen.length).toBeGreaterThan(1);
        expect(seen.every(p => p >= 0 && p <= 100)).toBe(true);
        expect([...seen].sort((a, b) => a - b)).toEqual(seen); // never goes backwards
        expect(seen[seen.length - 1]).toBe(100);
    });

    it('refuses, with a clear message and without writing anything, when the disk is too full', async () => {
        // Arrange
        const backupDir = path.join(workDir, 'backups');
        const backup = new DatabaseBackup(backupDir, 3, () => new Date(), { freeBytes: () => 100 });

        // Act
        const attempt = backup.create(db, 0, 1);

        // Assert
        await expect(attempt).rejects.toThrow(/not enough free disk space/i);
        expect(fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter(f => f.endsWith('.db')) : []).toEqual([]);
    });

    it('proceeds when there is comfortably enough room', async () => {
        // Arrange
        const backup = new DatabaseBackup(path.join(workDir, 'backups'), 3, () => new Date(), { freeBytes: () => 500 * MB });

        // Act / Assert
        await expect(backup.create(db, 0, 1)).resolves.toMatch(/\.db$/);
    });
});

describe('hasRoomForBackup', () => {
    it.each([
        [1000, 1000, false], // exactly the size is not enough: need headroom
        [1100, 1000, true],
        [999, 1000, false],
        [5_000_000_000, 594_000_000, true],
        [0, 1, false],
    ])('free %i bytes for a %i byte database -> %s', (free, size, expected) => {
        expect(hasRoomForBackup(free, size)).toBe(expected);
    });
});
