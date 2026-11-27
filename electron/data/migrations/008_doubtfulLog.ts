import type { Migration } from './types';

/**
 * What the Doubtful faces list (faces assigned to a person that the vision check says show no clear face) did with a face: `ignored` (not a face)
 * or `unassigned` (back to suggestions). The table remembers how the face was assigned before (person, confirmed or not, how, at what distance,
 * tier, suggestion), so Undo gives it back exactly as it was. One row per face. Additive: one new table.
 */
export const doubtfulLogMigration: Migration = {
    version: 8,
    name: 'doubtful_log',
    up(db) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS doubtful_log (
                face_id              INTEGER PRIMARY KEY,
                action               TEXT NOT NULL CHECK (action IN ('ignored', 'unassigned')),
                former_person_id     INTEGER,
                former_confirmed     INTEGER,
                former_source        TEXT,
                former_distance      REAL,
                former_tier          TEXT,
                former_suggested_id  INTEGER,
                created_at           TEXT NOT NULL
            )
        `);
        db.exec('CREATE INDEX IF NOT EXISTS idx_doubtful_log_action ON doubtful_log (action, former_person_id)');
    },
};
