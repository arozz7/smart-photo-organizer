import type { Migration } from './types';

/**
 * Indexes for the queries the background face verification runs on every loop. Without them each of the four queries
 * read all faces (300 to 570 ms on a library of 117,000 faces, on the thread that serves the window); with them they read
 * only the few faces that match (tens of suspects, tens of orphans).
 *
 * Partial indexes: they hold only the matching faces, so they stay tiny and cost almost nothing when other faces change.
 * The conditions repeat those of `repositories/verificationQueries.ts` term for term; SQLite uses a partial index only then.
 * Additive: two new indexes, no change to tables or data.
 */
export const verificationIndexesMigration: Migration = {
    version: 6,
    name: 'verification_indexes',
    up(db) {
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_faces_suspect ON faces(photo_id)
            WHERE entity_type = 'suspect' AND (is_ignored = 0 OR is_ignored IS NULL)
        `);
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_faces_orphan ON faces(photo_id)
            WHERE entity_type = 'human'
              AND (confidence_tier = 'human' OR confidence_tier = 'unknown')
              AND needs_bucketing = 0
              AND bucket_id IS NULL
              AND person_id IS NULL
              AND is_ignored = 0
              AND descriptor IS NOT NULL
              AND verification_attempts = 0
        `);
    },
};
