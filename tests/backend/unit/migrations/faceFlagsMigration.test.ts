import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { faceFlagsMigration } from '../../../../electron/data/migrations/003_faceFlags';
import { MIGRATIONS } from '../../../../electron/data/migrations';

const AT = '2026-11-19T10:00:00Z';
const insert = (db: Database.Database, faceId: number, kind: string, status?: string) =>
    status === undefined
        ? db.prepare('INSERT INTO face_flags (face_id, kind, created_at) VALUES (?, ?, ?)').run(faceId, kind, AT)
        : db.prepare('INSERT INTO face_flags (face_id, kind, status, created_at) VALUES (?, ?, ?, ?)').run(faceId, kind, status, AT);

describe('003_faceFlags migration', () => {
    let db: Database.Database;
    beforeEach(() => { db = new Database(':memory:'); });
    afterEach(() => db.close());

    it('is version 3 and registered after the re-match log', () => {
        expect(faceFlagsMigration.version).toBe(3);
        expect(MIGRATIONS.map(m => m.version)).toEqual([1, 2, 3]);
    });

    it('keeps one row per face and kind, and a face may carry both kinds', () => {
        faceFlagsMigration.up(db);

        insert(db, 1, 'non_face');
        insert(db, 1, 'picture');

        expect(db.prepare('SELECT COUNT(*) AS c FROM face_flags').get()).toEqual({ c: 2 });
        expect(() => insert(db, 1, 'non_face')).toThrow();
    });

    it('defaults a flag to suggested, and accepts only suggested or dismissed', () => {
        faceFlagsMigration.up(db);

        insert(db, 1, 'non_face');
        insert(db, 2, 'non_face', 'dismissed');

        expect(db.prepare('SELECT face_id, status FROM face_flags ORDER BY face_id').all()).toEqual([
            { face_id: 1, status: 'suggested' },
            { face_id: 2, status: 'dismissed' },
        ]);
        expect(() => insert(db, 3, 'non_face', 'ignored')).toThrow();
    });

    it('is safe to run twice and keeps its rows', () => {
        faceFlagsMigration.up(db);
        insert(db, 1, 'non_face', 'dismissed');

        expect(() => faceFlagsMigration.up(db)).not.toThrow();
        expect(db.prepare('SELECT COUNT(*) AS c FROM face_flags').get()).toEqual({ c: 1 });
    });
});
