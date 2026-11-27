import type { Migration } from './types';

/** A detection below this score is not accepted as a face without the vision check (the scan's own 'human' line). */
const ACCEPT_SCORE = 0.7;

/**
 * Faces the scan assigned to a person on its own (not confirmed by anyone) although the detector was not sure they are faces:
 * a score below the accept line, or still marked 'suspect' (a box that is not shaped like a face). Animals, objects and pictures
 * ended up under named people this way. A face with no score recorded (older scans) is not touched.
 */
const WEAK_SCAN_ASSIGNMENT = `
    person_id IS NOT NULL
    AND assignment_source = 'auto_scan'
    AND (is_confirmed = 0 OR is_confirmed IS NULL)
    AND (is_ignored = 0 OR is_ignored IS NULL)
    AND (entity_type = 'suspect' OR score < ${ACCEPT_SCORE})
`;

/**
 * One-time repair for every person: those faces go back to being suggestions (the person stays as `suggested_person_id`), where the
 * vision-model check and the user decide. What each face was is kept in `assignment_repair_log` so the change can be undone.
 * Confirmed faces and assignments made by anything other than the scan are never touched. The library is backed up before this runs.
 */
export const weakScanAssignmentsMigration: Migration = {
    version: 7,
    name: 'weak_scan_assignments',
    up(db) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS assignment_repair_log (
                face_id INTEGER PRIMARY KEY,
                repair TEXT NOT NULL,
                former_person_id INTEGER,
                former_tier TEXT,
                former_source TEXT,
                created_at TEXT NOT NULL
            )
        `);
        db.exec(`
            INSERT OR IGNORE INTO assignment_repair_log (face_id, repair, former_person_id, former_tier, former_source, created_at)
            SELECT id, 'weak_scan_assignment', person_id, confidence_tier, assignment_source, datetime('now')
            FROM faces WHERE ${WEAK_SCAN_ASSIGNMENT}
        `);
        db.exec(`
            UPDATE faces
            SET person_id = NULL, is_confirmed = 0, confidence_tier = 'review', assignment_source = 'ai_scan', bucket_id = NULL
            WHERE ${WEAK_SCAN_ASSIGNMENT}
        `);
    },
};
