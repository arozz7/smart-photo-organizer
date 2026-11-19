import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { rematchLogMigration } from '../../../../electron/data/migrations/002_rematchLog';
import { MIGRATIONS } from '../../../../electron/data/migrations';

describe('002_rematchLog migration', () => {
    let db: Database.Database;
    beforeEach(() => { db = new Database(':memory:'); });
    afterEach(() => db.close());

    it('is version 2 and registered after file identity, before later migrations', () => {
        expect(rematchLogMigration.version).toBe(2);
        expect(MIGRATIONS.map(m => m.version).slice(0, 2)).toEqual([1, 2]);
    });

    it('creates a log keyed by face and person', () => {
        rematchLogMigration.up(db);

        db.prepare('INSERT INTO rematch_log (face_id, person_id, distance, assigned_at) VALUES (1, 7, 0.5, ?)').run('2026-11-18T10:00:00Z');
        db.prepare('INSERT INTO rematch_log (face_id, person_id, distance, assigned_at) VALUES (1, 8, 0.6, ?)').run('2026-11-18T10:00:00Z');

        expect(db.prepare('SELECT COUNT(*) AS c FROM rematch_log').get()).toEqual({ c: 2 });
        expect(() =>
            db.prepare('INSERT INTO rematch_log (face_id, person_id, distance, assigned_at) VALUES (1, 7, 0.5, ?)').run('2026-11-18T10:00:00Z')
        ).toThrow();
    });

    it('is safe to run twice and keeps its rows', () => {
        rematchLogMigration.up(db);
        db.prepare('INSERT INTO rematch_log (face_id, person_id, distance, assigned_at) VALUES (1, 7, 0.5, ?)').run('2026-11-18T10:00:00Z');

        expect(() => rematchLogMigration.up(db)).not.toThrow();
        expect(db.prepare('SELECT COUNT(*) AS c FROM rematch_log').get()).toEqual({ c: 1 });
    });
});
