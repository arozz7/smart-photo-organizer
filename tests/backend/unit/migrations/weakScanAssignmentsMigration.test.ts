import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { weakScanAssignmentsMigration } from '../../../../electron/data/migrations/007_weakScanAssignments';
import { MIGRATIONS } from '../../../../electron/data/migrations';

interface FaceSeed {
    id: number;
    person?: number | null;
    source?: string;
    confirmed?: number | null;
    ignored?: number | null;
    entity?: string | null;
    score?: number | null;
    tier?: string;
    suggested?: number | null;
    bucket?: number | null;
}

function createLibrary(): Database.Database {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE faces (
            id INTEGER PRIMARY KEY, person_id INTEGER, assignment_source TEXT, is_confirmed INTEGER, is_ignored INTEGER,
            entity_type TEXT, score REAL, confidence_tier TEXT, suggested_person_id INTEGER, bucket_id INTEGER
        );
    `);
    return db;
}

function seed(db: Database.Database, faces: FaceSeed[]) {
    const insert = db.prepare(`INSERT INTO faces (id, person_id, assignment_source, is_confirmed, is_ignored, entity_type, score, confidence_tier, suggested_person_id, bucket_id)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const f of faces) {
        insert.run(f.id, f.person === undefined ? 1 : f.person, f.source ?? 'auto_scan', f.confirmed === undefined ? 0 : f.confirmed, f.ignored === undefined ? 0 : f.ignored,
            f.entity === undefined ? 'human' : f.entity, f.score === undefined ? 0.5 : f.score, f.tier ?? 'high', f.suggested === undefined ? f.person ?? 1 : f.suggested, f.bucket ?? null);
    }
}

const face = (db: Database.Database, id: number) => db.prepare('SELECT * FROM faces WHERE id = ?').get(id) as Record<string, unknown>;
const logged = (db: Database.Database) => (db.prepare('SELECT face_id FROM assignment_repair_log ORDER BY face_id').all() as { face_id: number }[]).map(r => r.face_id);

describe('007_weakScanAssignments migration', () => {
    let db: Database.Database;
    beforeEach(() => { db = createLibrary(); });
    afterEach(() => db.close());

    it('is version 7 and registered in order', () => {
        expect(weakScanAssignmentsMigration.version).toBe(7);
        expect(MIGRATIONS[6]).toBe(weakScanAssignmentsMigration);
    });

    it('moves a weak scan assignment back to a suggestion and keeps the person as the suggestion', () => {
        seed(db, [{ id: 1, person: 7, score: 0.5, suggested: 7 }]);

        weakScanAssignmentsMigration.up(db);

        expect(face(db, 1)).toMatchObject({ person_id: null, is_confirmed: 0, confidence_tier: 'review', suggested_person_id: 7, assignment_source: 'ai_scan' });
    });

    it('does it for every person, not one', () => {
        seed(db, [{ id: 1, person: 7, score: 0.4 }, { id: 2, person: 3, score: 0.6 }, { id: 3, person: 10, score: 0.2 }]);

        weakScanAssignmentsMigration.up(db);

        expect([1, 2, 3].map(id => face(db, id).person_id)).toEqual([null, null, null]);
    });

    it('treats a face still marked suspect as weak even when its score is high (box not shaped like a face)', () => {
        seed(db, [{ id: 1, score: 0.95, entity: 'suspect' }]);

        weakScanAssignmentsMigration.up(db);

        expect(face(db, 1).person_id).toBeNull();
    });

    it('leaves a clear detection assigned', () => {
        seed(db, [{ id: 1, score: 0.7 }, { id: 2, score: 0.95 }]);

        weakScanAssignmentsMigration.up(db);

        expect(face(db, 1).person_id).toBe(1);
        expect(face(db, 2).person_id).toBe(1);
    });

    it('never touches a face the user confirmed', () => {
        seed(db, [{ id: 1, score: 0.4, confirmed: 1 }]);

        weakScanAssignmentsMigration.up(db);

        expect(face(db, 1).person_id).toBe(1);
    });

    it('never touches assignments made by anything other than the scan', () => {
        seed(db, [{ id: 1, score: 0.4, source: 'manual' }, { id: 2, score: 0.4, source: 'auto_rematch' }, { id: 3, score: 0.4, source: 'profile_match' }]);

        weakScanAssignmentsMigration.up(db);

        expect([1, 2, 3].map(id => face(db, id).person_id)).toEqual([1, 1, 1]);
    });

    it('never touches an ignored face or one with no score recorded', () => {
        seed(db, [{ id: 1, score: 0.4, ignored: 1 }, { id: 2, score: null }]);

        weakScanAssignmentsMigration.up(db);

        expect(face(db, 1).person_id).toBe(1);
        expect(face(db, 2).person_id).toBe(1);
    });

    it('leaves faces that were never assigned alone', () => {
        seed(db, [{ id: 1, person: null, score: 0.4, tier: 'review' }]);

        weakScanAssignmentsMigration.up(db);

        expect(logged(db)).toEqual([]);
    });

    it('logs what each face was, so the change can be undone', () => {
        seed(db, [{ id: 1, person: 7, score: 0.5, tier: 'high' }, { id: 2, person: 9, score: 0.9 }]);

        weakScanAssignmentsMigration.up(db);

        expect(logged(db)).toEqual([1]);
        expect(db.prepare('SELECT * FROM assignment_repair_log WHERE face_id = 1').get()).toMatchObject({
            repair: 'weak_scan_assignment', former_person_id: 7, former_tier: 'high', former_source: 'auto_scan',
        });
    });

    it('is safe to run twice: the second run changes and logs nothing more', () => {
        seed(db, [{ id: 1, score: 0.5 }]);
        weakScanAssignmentsMigration.up(db);
        const after = db.prepare('SELECT * FROM faces').all();
        const log = db.prepare('SELECT * FROM assignment_repair_log').all();

        weakScanAssignmentsMigration.up(db);

        expect(db.prepare('SELECT * FROM faces').all()).toEqual(after);
        expect(db.prepare('SELECT * FROM assignment_repair_log').all()).toEqual(log);
    });
});
