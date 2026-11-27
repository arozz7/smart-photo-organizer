/**
 * The queries the background face verification runs on every loop (suspect faces, and orphaned faces that slipped through
 * bucketing). They live here, apart from FaceRepository, so the migration test can check that the indexes of
 * `006_verificationIndexes` are really used: on a library of 117,000 faces each of these took 300 to 570 ms without them,
 * all of it on the thread that serves the window.
 *
 * The WHERE conditions must stay identical, term for term, to the WHERE of the partial indexes (SQLite only uses a partial
 * index when the query repeats the index's conditions).
 */

const SUSPECT_WHERE = `f.entity_type = 'suspect' AND (f.is_ignored = 0 OR f.is_ignored IS NULL)`;

const ORPHAN_WHERE = `f.entity_type = 'human'
              AND (f.confidence_tier = 'human' OR f.confidence_tier = 'unknown')
              AND f.needs_bucketing = 0
              AND f.bucket_id IS NULL
              AND f.person_id IS NULL
              AND f.is_ignored = 0
              AND f.descriptor IS NOT NULL
              AND f.verification_attempts = 0`;

export const SUSPECT_COUNT_SQL = `SELECT COUNT(*) as count FROM faces f WHERE ${SUSPECT_WHERE}`;

export const SUSPECT_LIST_SQL = `
    SELECT f.id, f.photo_id, f.box_json, f.verification_attempts, f.score, f.face_quality,
           p.file_path, p.preview_cache_path
    FROM faces f
    JOIN photos p ON f.photo_id = p.id
    WHERE ${SUSPECT_WHERE}
    ORDER BY p.created_at DESC
    LIMIT ?`;

export const ORPHAN_COUNT_SQL = `SELECT COUNT(*) as count FROM faces f WHERE ${ORPHAN_WHERE}`;

export const ORPHAN_LIST_SQL = `
    SELECT f.id, f.photo_id, f.box_json,
           p.file_path, p.preview_cache_path
    FROM faces f
    JOIN photos p ON f.photo_id = p.id
    WHERE ${ORPHAN_WHERE}
    ORDER BY p.created_at DESC
    LIMIT ?`;
