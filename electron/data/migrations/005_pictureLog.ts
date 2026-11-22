import type { Migration } from './types';

/**
 * What the Pictures? lists (docs/plans/pictures-suggestions-plan.md, Phase C) did with a face: `ignored` (the user said it is only a picture of a
 * face) or `kept` (a real face: not suggested again). For an ignored face the table remembers how it was assigned before (person, confirmed
 * or not, how, at what distance), so Undo gives it back exactly as it was. One row per face. Additive: one new table.
 */
export const pictureLogMigration: Migration = {
    version: 5,
    name: 'picture_log',
    up(db) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS picture_log (
                face_id          INTEGER PRIMARY KEY,
                action           TEXT NOT NULL CHECK (action IN ('ignored', 'kept')),
                former_person_id INTEGER,
                former_confirmed INTEGER,
                former_source    TEXT,
                former_distance  REAL,
                created_at       TEXT NOT NULL
            )
        `);
        db.exec('CREATE INDEX IF NOT EXISTS idx_picture_log_action ON picture_log (action, former_person_id)');
    },
};
