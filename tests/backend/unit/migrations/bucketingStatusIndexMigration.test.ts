import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { bucketingStatusIndexMigration } from '../../../../electron/data/migrations/009_bucketingStatusIndex';
import { MIGRATIONS } from '../../../../electron/data/migrations';
import { REMAINING_BUCKETING_SQL } from '../../../../electron/data/repositories/bucketingQueries';

/** The columns of `faces` that the grouping status asks about, plus a wide column like the real descriptor. */
function createFaces(db: Database.Database) {
    db.exec(`CREATE TABLE faces (id INTEGER PRIMARY KEY, needs_bucketing INTEGER, person_id INTEGER, is_ignored INTEGER DEFAULT 0, descriptor BLOB);
             CREATE INDEX idx_faces_person_id ON faces (person_id);`);
}

describe('009_bucketingStatusIndex migration', () => {
    let db: Database.Database;
    beforeEach(() => { db = new Database(':memory:'); createFaces(db); });
    afterEach(() => db.close());

    it('is version 9 and registered last', () => {
        expect(bucketingStatusIndexMigration.version).toBe(9);
        expect(MIGRATIONS[MIGRATIONS.length - 1]).toBe(bucketingStatusIndexMigration);
    });

    it('lets the grouping status be counted from an index alone, without reading the faces themselves', () => {
        bucketingStatusIndexMigration.up(db);

        const plan = db.prepare(`EXPLAIN QUERY PLAN ${REMAINING_BUCKETING_SQL}`).all() as { detail: string }[];

        expect(plan.map(step => step.detail).join(' ')).toContain('COVERING INDEX');
    });

    it('counts the same faces with the index as without it', () => {
        const insert = db.prepare('INSERT INTO faces (needs_bucketing, person_id, is_ignored) VALUES (?, ?, ?)');
        insert.run(1, null, 0); insert.run(1, null, 0); // waiting
        insert.run(1, 5, 0);                              // already named
        insert.run(1, null, 1);                           // ignored
        insert.run(0, null, 0);                           // already grouped
        const before = db.prepare(REMAINING_BUCKETING_SQL).get();

        bucketingStatusIndexMigration.up(db);

        expect(db.prepare(REMAINING_BUCKETING_SQL).get()).toEqual(before);
        expect(before).toEqual({ count: 2 });
    });

    it('is safe to run twice', () => {
        bucketingStatusIndexMigration.up(db);

        expect(() => bucketingStatusIndexMigration.up(db)).not.toThrow();
    });
});
