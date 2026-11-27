import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { doubtfulLogMigration } from '../../../../electron/data/migrations/008_doubtfulLog';
import { MIGRATIONS } from '../../../../electron/data/migrations';

describe('008_doubtfulLog migration', () => {
    let db: Database.Database;
    beforeEach(() => { db = new Database(':memory:'); });
    afterEach(() => db.close());

    it('is version 8 and registered in order', () => {
        expect(doubtfulLogMigration.version).toBe(8);
        expect(MIGRATIONS[7]).toBe(doubtfulLogMigration);
    });

    it('creates an empty log that keeps how a face was assigned before the list changed it', () => {
        doubtfulLogMigration.up(db);

        db.prepare(`INSERT INTO doubtful_log (face_id, action, former_person_id, former_confirmed, former_source, former_distance, former_tier, former_suggested_id, created_at)
                    VALUES (1, 'unassigned', 7, 1, 'ai_scan', 0.3, 'high', 7, 'now')`).run();

        expect(db.prepare('SELECT * FROM doubtful_log').all()).toHaveLength(1);
    });

    it('accepts only the two actions it logs', () => {
        doubtfulLogMigration.up(db);

        expect(() => db.prepare(`INSERT INTO doubtful_log (face_id, action, created_at) VALUES (1, 'kept', 'now')`).run()).toThrow();
    });

    it('is safe to run twice and keeps what is in the log', () => {
        doubtfulLogMigration.up(db);
        db.prepare(`INSERT INTO doubtful_log (face_id, action, created_at) VALUES (1, 'ignored', 'now')`).run();

        doubtfulLogMigration.up(db);

        expect(db.prepare('SELECT COUNT(*) AS c FROM doubtful_log').get()).toEqual({ c: 1 });
    });
});
