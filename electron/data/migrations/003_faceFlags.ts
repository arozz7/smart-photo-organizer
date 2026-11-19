import type { Migration } from './types';

/**
 * Suggestions that a face is not worth reviewing as a person (docs/plans/non-face-and-picture-faces-plan.md, Phase B and C):
 * `kind` is `non_face` (nothing that looks like a face) or `picture` (a face in a framed photo, poster or screen).
 *
 * `status` is `suggested` for a score a model gave the face, and `dismissed` once the user said "keep it", so the face
 * is not offered again. A face the user ignores is not recorded here: it carries its own `faces.ignore_source`.
 * The detector-score list needs no rows at all until the user dismisses something. Additive: one new table, no change to existing ones.
 */
export const faceFlagsMigration: Migration = {
    version: 3,
    name: 'face_flags',
    up(db) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS face_flags (
                face_id    INTEGER NOT NULL,
                kind       TEXT NOT NULL,
                score      REAL,
                model      TEXT,
                status     TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'dismissed')),
                created_at TEXT NOT NULL,
                PRIMARY KEY (face_id, kind)
            )
        `);
    },
};
