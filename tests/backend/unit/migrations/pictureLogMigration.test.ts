import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { pictureLogMigration } from '../../../../electron/data/migrations/005_pictureLog';
import { MIGRATIONS } from '../../../../electron/data/migrations';

const AT = '2026-11-21T10:00:00Z';
const insert = (db: Database.Database, faceId: number, action: string, person: number | null = null) =>
    db.prepare('INSERT INTO picture_log (face_id, action, former_person_id, former_confirmed, former_source, former_distance, created_at) VALUES (?, ?, ?, 1, ?, 0.4, ?)')
        .run(faceId, action, person, person ? 'auto_rematch' : null, AT);

describe('005_pictureLog migration', () => {
    let db: Database.Database;
    beforeEach(() => { db = new Database(':memory:'); });
    afterEach(() => db.close());

    it('is version 5 and registered after the profile suggestion log', () => {
        expect(pictureLogMigration.version).toBe(5);
        expect(MIGRATIONS.map(m => m.version)).toEqual([1, 2, 3, 4, 5]);
    });

    it('keeps one row per face: what the user did with it, and how it was assigned before (so Undo gives it back exactly)', () => {
        pictureLogMigration.up(db);

        insert(db, 1, 'ignored', 10);
        insert(db, 2, 'kept');

        expect(db.prepare('SELECT face_id, action, former_person_id, former_confirmed, former_source, former_distance FROM picture_log ORDER BY face_id').all()).toEqual([
            { face_id: 1, action: 'ignored', former_person_id: 10, former_confirmed: 1, former_source: 'auto_rematch', former_distance: 0.4 },
            { face_id: 2, action: 'kept', former_person_id: null, former_confirmed: 1, former_source: null, former_distance: 0.4 },
        ]);
        expect(() => insert(db, 1, 'kept')).toThrow();
    });

    it('accepts only ignored or kept', () => {
        pictureLogMigration.up(db);

        expect(() => insert(db, 1, 'suggested')).toThrow();
    });

    it('is safe to run twice and keeps its rows', () => {
        pictureLogMigration.up(db);
        insert(db, 1, 'kept');

        expect(() => pictureLogMigration.up(db)).not.toThrow();
        expect(db.prepare('SELECT COUNT(*) AS c FROM picture_log').get()).toEqual({ c: 1 });
    });
});
