import { getDB } from '../../db';

/** Length in bytes of a face descriptor (512 float32 numbers). */
const DESCRIPTOR_BYTES = 512 * 4;
/** Faces per query when checking the log; far below SQLite's limit on bound values. */
const LOOKUP_CHUNK = 500;

/** Source recorded on faces assigned by the background re-match; also how "Undo re-match" finds them. */
export const REMATCH_SOURCE = 'auto_rematch';
/** What unassigned faces carry as their source (as the scanner leaves them). */
const UNASSIGNED_SOURCE = 'ai_scan';

/** Unassigned, not ignored, human, with a full descriptor: the faces the re-match looks at. */
const REMATCH_CANDIDATE = `
    person_id IS NULL
    AND (is_ignored = 0 OR is_ignored IS NULL)
    AND COALESCE(entity_type, 'human') = 'human'
    AND descriptor IS NOT NULL
    AND length(descriptor) = ${DESCRIPTOR_BYTES}
`;

export interface RematchCandidateFace {
    id: number;
    descriptor: Buffer;
}

export interface RematchAssignment {
    faceId: number;
    personId: number;
    distance: number;
}

/**
 * Reads and writes for the background re-match of unassigned faces against named people.
 * Kept out of FaceRepository (which is over the file-size limit).
 */
export class RematchRepository {
    static countUnassigned(): number {
        const row = getDB().prepare(`SELECT COUNT(*) AS count FROM faces WHERE ${REMATCH_CANDIDATE}`).get() as { count: number };
        return row.count;
    }

    /** The next `limit` candidate faces with an id above `afterId`, in id order (paging by id survives faces being assigned in between). */
    static getUnassignedFaces(afterId: number, limit: number): RematchCandidateFace[] {
        return getDB()
            .prepare(`SELECT id, descriptor FROM faces WHERE ${REMATCH_CANDIDATE} AND id > ? ORDER BY id ASC LIMIT ?`)
            .all(afterId, limit) as RematchCandidateFace[];
    }

    /**
     * Assigns each face to its person as an unconfirmed match and logs the pair. A face that was assigned, confirmed or ignored
     * since it was read is left alone.
     */
    static saveMatches(matches: RematchAssignment[], assignedAt: string): void {
        if (matches.length === 0) return;
        const db = getDB();
        const assign = db.prepare(`
            UPDATE faces
            SET person_id = ?, assignment_source = '${REMATCH_SOURCE}', is_confirmed = 0, match_distance = ?,
                bucket_id = NULL, needs_bucketing = 0
            WHERE id = ? AND person_id IS NULL AND (is_ignored = 0 OR is_ignored IS NULL)
        `);
        const log = db.prepare('INSERT OR REPLACE INTO rematch_log (face_id, person_id, distance, assigned_at) VALUES (?, ?, ?, ?)');
        db.transaction(() => {
            for (const match of matches) {
                const result = assign.run(match.personId, match.distance, match.faceId);
                if (result.changes > 0) log.run(match.faceId, match.personId, match.distance, assignedAt);
            }
        })();
    }

    /** The "faceId:personId" pairs among these faces that the re-match assigned before. */
    static findTriedPairs(faceIds: number[]): Set<string> {
        const tried = new Set<string>();
        const db = getDB();
        for (let start = 0; start < faceIds.length; start += LOOKUP_CHUNK) {
            const chunk = faceIds.slice(start, start + LOOKUP_CHUNK);
            const rows = db
                .prepare(`SELECT face_id, person_id FROM rematch_log WHERE face_id IN (${chunk.map(() => '?').join(',')})`)
                .all(...chunk) as { face_id: number; person_id: number }[];
            for (const row of rows) tried.add(`${row.face_id}:${row.person_id}`);
        }
        return tried;
    }

    /** Re-matched faces the user has not confirmed (and has not moved): what "Undo re-match" would return. */
    static countUndoable(): number {
        const row = getDB()
            .prepare(`SELECT COUNT(*) AS count FROM faces WHERE assignment_source = '${REMATCH_SOURCE}' AND is_confirmed = 0 AND person_id IS NOT NULL`)
            .get() as { count: number };
        return row.count;
    }

    /**
     * Returns every unconfirmed re-matched face to unassigned and forgets those pairs in the log, so it is a true revert
     * (a later run, for example at another distance, may match them again). Confirmed faces, and the pairs of faces the
     * user removed one by one, are left as they are.
     */
    static undoUnconfirmed(): number {
        const db = getDB();
        const undoable = `assignment_source = '${REMATCH_SOURCE}' AND is_confirmed = 0 AND person_id IS NOT NULL`;
        return db.transaction(() => {
            db.prepare(`DELETE FROM rematch_log WHERE (face_id, person_id) IN (SELECT id, person_id FROM faces WHERE ${undoable})`).run();
            return db
                .prepare(`UPDATE faces SET person_id = NULL, match_distance = NULL, assignment_source = '${UNASSIGNED_SOURCE}' WHERE ${undoable}`)
                .run().changes;
        })();
    }
}
