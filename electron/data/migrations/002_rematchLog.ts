import type { Migration } from './types';

/**
 * A record of every face that the background re-match (docs/plans/review-queue-parking-plan.md, Phase 2) assigned to a person.
 *
 * It exists so a match the user rejected is not made again: removing a face from a person (or undoing the re-match) only clears
 * `faces.person_id`, which would otherwise look the same as a face that was never matched. The re-match skips a face and person
 * pair that is in this table. Additive: one new table, no change to existing ones.
 */
export const rematchLogMigration: Migration = {
    version: 2,
    name: 'rematch_log',
    up(db) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS rematch_log (
                face_id     INTEGER NOT NULL,
                person_id   INTEGER NOT NULL,
                distance    REAL,
                assigned_at TEXT NOT NULL,
                PRIMARY KEY (face_id, person_id)
            )
        `);
    },
};
