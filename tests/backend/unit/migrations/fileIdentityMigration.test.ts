import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { fileIdentityMigration } from '../../../../electron/data/migrations/001_fileIdentity';
import { addColumnIfMissing } from '../../../../electron/data/migrations/helpers';

const columnsOf = (db: Database.Database, table: string): string[] =>
    (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(c => c.name);

describe('addColumnIfMissing', () => {
    let db: Database.Database;
    beforeEach(() => { db = new Database(':memory:'); db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)'); });
    afterEach(() => db.close());

    it('adds a missing column', () => {
        addColumnIfMissing(db, 't', 'size', 'INTEGER');
        expect(columnsOf(db, 't')).toContain('size');
    });

    it('is a no-op when the column already exists (idempotent)', () => {
        addColumnIfMissing(db, 't', 'size', 'INTEGER');
        expect(() => addColumnIfMissing(db, 't', 'size', 'INTEGER')).not.toThrow();
        expect(columnsOf(db, 't').filter(c => c === 'size')).toHaveLength(1);
    });
});

describe('001_fileIdentity migration', () => {
    let db: Database.Database;
    beforeEach(() => {
        db = new Database(':memory:');
        db.exec(`CREATE TABLE photos (id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT UNIQUE NOT NULL);
                 INSERT INTO photos (file_path) VALUES ('a.jpg'), ('b.jpg');`);
    });
    afterEach(() => db.close());

    it('is version 1 and additive', () => {
        expect(fileIdentityMigration.version).toBe(1);
        expect(fileIdentityMigration.name).toBe('file_identity');
    });

    it('adds nullable identity columns and keeps every existing row', () => {
        // Act
        fileIdentityMigration.up(db);

        // Assert
        expect(columnsOf(db, 'photos')).toEqual(expect.arrayContaining(['file_size', 'file_mtime', 'file_id', 'missing_since']));
        const rows = db.prepare('SELECT file_path, file_size, file_mtime, file_id, missing_since FROM photos ORDER BY id').all();
        expect(rows).toEqual([
            { file_path: 'a.jpg', file_size: null, file_mtime: null, file_id: null, missing_since: null },
            { file_path: 'b.jpg', file_size: null, file_mtime: null, file_id: null, missing_since: null },
        ]);
    });

    it('indexes file_id (used later to re-link moved files)', () => {
        fileIdentityMigration.up(db);

        const indexes = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]).map(i => i.name);
        expect(indexes).toContain('idx_photos_file_id');
    });

    it('is safe to run twice', () => {
        fileIdentityMigration.up(db);
        expect(() => fileIdentityMigration.up(db)).not.toThrow();
    });
});
