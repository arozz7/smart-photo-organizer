/**
 * Legacy library upgrade tests.
 *
 * Uses the REAL initDB against a frozen copy of a v0.8.1 library. These tests guard the
 * backward-compatibility promise: opening an existing library must never lose or alter user data.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { initDB, getDB, closeDB } from '../../../electron/db';
import {
    createLegacyLibraryCopy,
    loadLegacySnapshot,
    removeLibraryCopy,
} from '../../fixtures/legacyFixture';

describe('Legacy library upgrade (v0.8.1 fixture)', () => {
    let libraryDir: string;
    let db: Database.Database;

    beforeEach(async () => {
        libraryDir = createLegacyLibraryCopy();
        await initDB(libraryDir);
        db = getDB();
    });

    afterEach(() => {
        closeDB();
        removeLibraryCopy(libraryDir);
    });

    it('keeps the row count of every existing user table', () => {
        // Arrange
        const { rowCounts } = loadLegacySnapshot();
        const userTables = Object.keys(rowCounts).filter(t => t !== 'app_state');

        // Act
        const actual = Object.fromEntries(
            userTables.map(t => [t, (db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c]),
        );

        // Assert
        userTables.forEach(t => expect(actual[t], `table ${t}`).toBe(rowCounts[t]));
    });

    it('keeps every existing table, column and index definition (additive-only schema)', async () => {
        // Arrange — materialise the frozen table definitions in a scratch DB to read their columns
        const { schema } = loadLegacySnapshot();
        const { default: Database } = await import('better-sqlite3');
        const frozen = new Database(':memory:');
        const columnsOf = (conn: Database.Database, table: string): string[] =>
            (conn.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(c => c.name);
        const tableNames = Object.keys(schema).filter(k => k.startsWith('table:')).map(k => k.slice('table:'.length));
        tableNames.forEach(t => frozen.exec(schema[`table:${t}`]));
        const indexNames = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[])
            .map(i => i.name);

        // Act / Assert
        tableNames.forEach(t => {
            expect(columnsOf(db, t), `columns of ${t}`).toEqual(expect.arrayContaining(columnsOf(frozen, t)));
        });
        Object.keys(schema)
            .filter(k => k.startsWith('index:'))
            .forEach(k => expect(indexNames, k).toContain(k.slice('index:'.length)));
        frozen.close();
    });

    it('preserves named people, confirmed assignments and eras', () => {
        // Act
        const alice = db.prepare(`SELECT id, cover_face_id FROM people WHERE name = 'Alice'`).get() as { id: number; cover_face_id: number };
        const confirmed = db.prepare(`SELECT COUNT(*) AS c FROM faces WHERE person_id = ? AND is_confirmed = 1`).get(alice.id) as { c: number };
        const era = db.prepare(`SELECT user_name FROM person_eras WHERE person_id = ?`).get(alice.id) as { user_name: string };

        // Assert
        expect(alice.cover_face_id).toBe(1);
        expect(confirmed.c).toBe(2);
        expect(era.user_name).toBe('Beach years');
    });

    it('preserves ignored faces, buckets, smart albums and duplicate groups', () => {
        // Act
        const ignored = db.prepare(`SELECT ignore_source FROM faces WHERE is_ignored = 1`).all() as { ignore_source: string }[];
        const bucketed = db.prepare(`SELECT COUNT(*) AS c FROM faces WHERE bucket_id IS NOT NULL`).get() as { c: number };
        const albums = db.prepare(`SELECT name FROM smart_albums ORDER BY id`).all() as { name: string }[];
        const dupMembers = db.prepare(`SELECT COUNT(*) AS c FROM photos WHERE duplicate_group_id = 1`).get() as { c: number };

        // Assert
        expect(ignored).toEqual([{ ignore_source: 'user' }]);
        expect(bucketed.c).toBe(1);
        expect(albums.map(a => a.name)).toEqual(['Alice at the beach', 'Sharp 2019']);
        expect(dupMembers.c).toBe(2);
    });

    it('takes no backup and leaves user_version alone when no migrations are pending', () => {
        // Assert
        expect(db.pragma('user_version', { simple: true })).toBe(0);
        expect(fs.existsSync(path.join(libraryDir, 'backups'))).toBe(false);
    });

    it('is idempotent: opening the library a second time changes nothing', async () => {
        // Arrange
        const before = JSON.stringify(
            db.prepare(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`).all(),
        );
        closeDB();

        // Act
        await initDB(libraryDir);
        db = getDB();
        const after = JSON.stringify(
            db.prepare(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`).all(),
        );

        // Assert
        expect(after).toBe(before);
    });
});


describe('Fresh library', () => {
    it('creates the full schema on an empty folder', async () => {
        // Arrange
        const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-fresh-'));

        // Act
        await initDB(libraryDir);
        const tables = (getDB().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(t => t.name);
        closeDB();
        removeLibraryCopy(libraryDir);

        // Assert
        expect(tables).toEqual(expect.arrayContaining(['photos', 'faces', 'people', 'person_eras', 'smart_albums', 'duplicate_groups', 'app_state']));
    });
});
