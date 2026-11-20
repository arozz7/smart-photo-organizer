import type { Migration } from './types';

/**
 * What the "Turned faces" list (docs/plans/profile-suggestions-plan.md, Phase F1) has done with a face, per person:
 * `dismissed` (the user said "not this person": the pair is not offered again) or `assigned` (the list gave the face to that
 * person; Undo finds exactly these). One row per face and person, because a face can be dismissed for one person and later
 * assigned to another. Additive: one new table, no change to existing ones (same pattern as the re-match log).
 */
export const profileSuggestionLogMigration: Migration = {
    version: 4,
    name: 'profile_suggestion_log',
    up(db) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS profile_suggestion_log (
                face_id    INTEGER NOT NULL,
                person_id  INTEGER NOT NULL,
                status     TEXT NOT NULL CHECK (status IN ('assigned', 'dismissed')),
                distance   REAL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (face_id, person_id)
            )
        `);
        db.exec('CREATE INDEX IF NOT EXISTS idx_profile_suggestion_log_status ON profile_suggestion_log (status, person_id)');
    },
};
