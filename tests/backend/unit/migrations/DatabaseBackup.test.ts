import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseBackup } from '../../../../electron/data/migrations/DatabaseBackup';

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
