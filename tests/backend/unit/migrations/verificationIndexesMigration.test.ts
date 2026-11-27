import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { verificationIndexesMigration } from '../../../../electron/data/migrations/006_verificationIndexes';
import { MIGRATIONS } from '../../../../electron/data/migrations';
import { SUSPECT_COUNT_SQL, SUSPECT_LIST_SQL, ORPHAN_COUNT_SQL, ORPHAN_LIST_SQL } from '../../../../electron/data/repositories/verificationQueries';

/** The columns these queries read, as in the real library. */
function createLibrary(): Database.Database {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE photos (id INTEGER PRIMARY KEY, file_path TEXT, preview_cache_path TEXT, created_at TEXT);
        CREATE TABLE faces (
            id INTEGER PRIMARY KEY, photo_id INTEGER, box_json TEXT, verification_attempts INTEGER DEFAULT 0, score REAL, face_quality REAL,
            entity_type TEXT, is_ignored INTEGER DEFAULT 0, confidence_tier TEXT, needs_bucketing INTEGER DEFAULT 0,
            bucket_id INTEGER, person_id INTEGER, descriptor BLOB
        );
    `);
    return db;
}

const planOf = (db: Database.Database, sql: string): string =>
    (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(sql.includes('LIMIT ?') ? [10] : [])) as { detail: string }[]).map(row => row.detail).join(' | ');

describe('006_verificationIndexes migration', () => {
    let db: Database.Database;
    beforeEach(() => { db = createLibrary(); });
    afterEach(() => db.close());

    it('is version 6 and registered in order', () => {
        expect(verificationIndexesMigration.version).toBe(6);
        expect(MIGRATIONS[5]).toBe(verificationIndexesMigration);
    });

    it.each([
        ['counting suspect faces', SUSPECT_COUNT_SQL, 'idx_faces_suspect'],
        ['listing suspect faces', SUSPECT_LIST_SQL, 'idx_faces_suspect'],
        ['counting orphaned faces', ORPHAN_COUNT_SQL, 'idx_faces_orphan'],
        ['listing orphaned faces', ORPHAN_LIST_SQL, 'idx_faces_orphan'],
    ])('makes %s use its index instead of reading every face', (_name, sql, index) => {
        verificationIndexesMigration.up(db);

        expect(planOf(db, sql)).toContain(index);
    });

    it('does not change what the queries return', () => {
        db.exec(`
            INSERT INTO photos VALUES (1, 'a.jpg', NULL, '2026-01-01'), (2, 'b.jpg', NULL, '2026-02-01');
            INSERT INTO faces (id, photo_id, entity_type, is_ignored, confidence_tier, descriptor) VALUES
                (1, 1, 'suspect', 0, 'unknown', x'00'),
                (2, 1, 'suspect', 1, 'unknown', x'00'),
                (3, 2, 'suspect', NULL, 'unknown', x'00'),
                (4, 2, 'human', 0, 'unknown', x'00'),
                (5, 1, 'human', 0, 'human', x'00'),
                (6, 1, 'human', 0, 'unknown', NULL);
            UPDATE faces SET person_id = 9 WHERE id = 5;
        `);
        const before = [SUSPECT_COUNT_SQL, ORPHAN_COUNT_SQL].map(sql => db.prepare(sql).get());
        const beforeLists = [SUSPECT_LIST_SQL, ORPHAN_LIST_SQL].map(sql => db.prepare(sql).all(10));

        verificationIndexesMigration.up(db);

        expect([SUSPECT_COUNT_SQL, ORPHAN_COUNT_SQL].map(sql => db.prepare(sql).get())).toEqual(before);
        expect([SUSPECT_LIST_SQL, ORPHAN_LIST_SQL].map(sql => db.prepare(sql).all(10))).toEqual(beforeLists);
        expect(before).toEqual([{ count: 2 }, { count: 1 }]);
    });

    it('is safe to run twice', () => {
        verificationIndexesMigration.up(db);

        expect(() => verificationIndexesMigration.up(db)).not.toThrow();
    });
});
