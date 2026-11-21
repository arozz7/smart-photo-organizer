import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { profileSuggestionLogMigration } from '../../../../electron/data/migrations/004_profileSuggestionLog';
import { MIGRATIONS } from '../../../../electron/data/migrations';

const AT = '2026-11-19T10:00:00Z';
const insert = (db: Database.Database, faceId: number, personId: number, status: string) =>
    db.prepare('INSERT INTO profile_suggestion_log (face_id, person_id, status, distance, created_at) VALUES (?, ?, ?, 0.9, ?)').run(faceId, personId, status, AT);

describe('004_profileSuggestionLog migration', () => {
    let db: Database.Database;
    beforeEach(() => { db = new Database(':memory:'); });
    afterEach(() => db.close());

    it('is version 4 and registered after the face flags', () => {
        expect(profileSuggestionLogMigration.version).toBe(4);
        expect(MIGRATIONS.map(m => m.version)).toEqual([1, 2, 3, 4]);
    });

    it('keeps one row per face and person, so a face may be dismissed for one person and assigned to another', () => {
        profileSuggestionLogMigration.up(db);

        insert(db, 1, 10, 'dismissed');
        insert(db, 1, 11, 'assigned');

        expect(db.prepare('SELECT COUNT(*) AS c FROM profile_suggestion_log').get()).toEqual({ c: 2 });
        expect(() => insert(db, 1, 10, 'assigned')).toThrow();
    });

    it('accepts only assigned or dismissed', () => {
        profileSuggestionLogMigration.up(db);

        expect(() => insert(db, 1, 10, 'suggested')).toThrow();
    });

    it('is safe to run twice and keeps its rows', () => {
        profileSuggestionLogMigration.up(db);
        insert(db, 1, 10, 'dismissed');

        expect(() => profileSuggestionLogMigration.up(db)).not.toThrow();
        expect(db.prepare('SELECT COUNT(*) AS c FROM profile_suggestion_log').get()).toEqual({ c: 1 });
    });
});
