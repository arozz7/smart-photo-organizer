import { getDB } from '../../db';

/** Length in bytes of a face descriptor (512 float32 numbers). */
const DESCRIPTOR_BYTES = 512 * 4;
/** Ids per query; far below SQLite's limit on bound values. */
const CHUNK = 500;

/** Source recorded on faces the "Turned faces" list assigned; also how Undo finds them. */
export const PROFILE_SOURCE = 'profile_match';
/** What unassigned faces carry as their source (as the scanner leaves them). */
const UNASSIGNED_SOURCE = 'ai_scan';

export interface ProfileFaceRow {
    id: number;
    photoId: number;
    descriptor: Buffer;
}

export interface ProfileExampleRow {
    faceId: number;
    personId: number;
    photoId: number;
    descriptor: Buffer;
}

export interface ProfilePair {
    faceId: number;
    personId: number;
}

export interface ProfileAssignment extends ProfilePair {
    distance: number;
}

export interface ProfileFaceTile {
    faceId: number;
    photoId: number;
    box: { x: number; y: number; width: number; height: number };
    /** Degrees; null when unknown. */
    yaw: number | null;
    quality: number | null;
    blur: number | null;
    filePath: string | null;
    previewPath: string | null;
    photoWidth: number | null;
    photoHeight: number | null;
}

/** Unassigned, not ignored, human, turned from `minYaw`, with a full descriptor: faces the list may suggest a person for. */
const CANDIDATE = `
    f.person_id IS NULL
    AND f.is_ignored = 0
    AND COALESCE(f.entity_type, 'human') = 'human'
    AND f.descriptor IS NOT NULL AND length(f.descriptor) = ${DESCRIPTOR_BYTES}
    AND ABS(f.pose_yaw) >= ?
`;

/** Confirmed, not ignored, human, turned from `minYaw`, with a full descriptor, of a named person: a profile example. */
const EXAMPLE = `
    f.person_id IS NOT NULL
    AND f.is_confirmed = 1
    AND f.is_ignored = 0
    AND COALESCE(f.entity_type, 'human') = 'human'
    AND f.descriptor IS NOT NULL AND length(f.descriptor) = ${DESCRIPTOR_BYTES}
    AND ABS(f.pose_yaw) >= ?
`;

function chunks<T>(items: readonly T[]): T[][] {
    const out: T[][] = [];
    for (let start = 0; start < items.length; start += CHUNK) out.push(items.slice(start, start + CHUNK));
    return out;
}

const marks = (count: number) => Array(count).fill('?').join(',');

/**
 * Reads and writes of the "Turned faces" list (docs/plans/profile-suggestions-plan.md, Phase F1). Assigning is a guarded
 * update (not FaceRepository.assignFacesToPerson, which un-ignores faces and does not check that a face is still unassigned).
 */
export class ProfileMatchRepository {
    static loadExamples(minYaw: number): ProfileExampleRow[] {
        return getDB()
            .prepare(`SELECT f.id AS faceId, f.person_id AS personId, f.photo_id AS photoId, f.descriptor AS descriptor FROM faces f WHERE ${EXAMPLE} ORDER BY f.id`)
            .all(minYaw) as ProfileExampleRow[];
    }

    static countCandidates(minYaw: number): number {
        return (getDB().prepare(`SELECT COUNT(*) AS count FROM faces f WHERE ${CANDIDATE}`).get(minYaw) as { count: number }).count;
    }

    /** The next `limit` candidates with an id above `afterId`, in id order (paging by id survives faces being assigned in between). */
    static loadCandidates(afterId: number, limit: number, minYaw: number): ProfileFaceRow[] {
        return getDB()
            .prepare(`SELECT f.id AS id, f.photo_id AS photoId, f.descriptor AS descriptor FROM faces f WHERE ${CANDIDATE} AND f.id > ? ORDER BY f.id LIMIT ?`)
            .all(minYaw, afterId, limit) as ProfileFaceRow[];
    }

    /** Every person who has a face (assigned, confirmed or not, not ignored) in each of these photos. */
    static personsInPhotos(photoIds: readonly number[]): Map<number, Set<number>> {
        const db = getDB();
        const byPhoto = new Map<number, Set<number>>();
        for (const chunk of chunks(photoIds)) {
            const rows = db
                .prepare(`SELECT photo_id AS photoId, person_id AS personId FROM faces WHERE person_id IS NOT NULL AND is_ignored = 0 AND photo_id IN (${marks(chunk.length)})`)
                .all(...chunk) as { photoId: number; personId: number }[];
            for (const row of rows) {
                if (!byPhoto.has(row.photoId)) byPhoto.set(row.photoId, new Set());
                byPhoto.get(row.photoId)!.add(row.personId);
            }
        }
        return byPhoto;
    }

    /** "faceId:personId" pairs among these faces that the user said "not this person" about. */
    static dismissedPairs(faceIds: readonly number[]): Set<string> {
        const db = getDB();
        const pairs = new Set<string>();
        for (const chunk of chunks(faceIds)) {
            const rows = db
                .prepare(`SELECT face_id AS faceId, person_id AS personId FROM profile_suggestion_log WHERE status = 'dismissed' AND face_id IN (${marks(chunk.length)})`)
                .all(...chunk) as { faceId: number; personId: number }[];
            for (const row of rows) pairs.add(`${row.faceId}:${row.personId}`);
        }
        return pairs;
    }

    /**
     * Gives each face to its person as a confirmed assignment and logs the pair. A face that was assigned or ignored since the
     * list was made is left alone. Returns the pairs that were assigned.
     */
    static assign(assignments: readonly ProfileAssignment[], at: string): ProfilePair[] {
        if (assignments.length === 0) return [];
        const db = getDB();
        const update = db.prepare(`
            UPDATE faces
            SET person_id = ?, assignment_source = '${PROFILE_SOURCE}', is_confirmed = 1, match_distance = ?,
                bucket_id = NULL, needs_bucketing = 0
            WHERE id = ? AND person_id IS NULL AND is_ignored = 0
        `);
        const log = db.prepare(`INSERT OR REPLACE INTO profile_suggestion_log (face_id, person_id, status, distance, created_at) VALUES (?, ?, 'assigned', ?, ?)`);
        const done: ProfilePair[] = [];
        db.transaction(() => {
            for (const item of assignments) {
                if (update.run(item.personId, item.distance, item.faceId).changes > 0) {
                    log.run(item.faceId, item.personId, item.distance, at);
                    done.push({ faceId: item.faceId, personId: item.personId });
                }
            }
        })();
        return done;
    }

    /** Remembers "not this person" for each pair, so it is not suggested again. */
    static dismiss(assignments: readonly ProfileAssignment[], at: string): void {
        if (assignments.length === 0) return;
        const db = getDB();
        const log = db.prepare(`INSERT OR REPLACE INTO profile_suggestion_log (face_id, person_id, status, distance, created_at) VALUES (?, ?, 'dismissed', ?, ?)`);
        db.transaction(() => {
            for (const item of assignments) log.run(item.faceId, item.personId, item.distance, at);
        })();
    }

    /**
     * Returns faces this list assigned to unassigned (and queues them for grouping again), and forgets their log rows.
     * A face is only returned while it is still that person's with the list's source: one the user moved, or confirmed
     * elsewhere, is left as it is. Returns the pairs that were undone.
     */
    static undo(faceIds: readonly number[]): ProfilePair[] {
        const db = getDB();
        const restored: ProfilePair[] = [];
        db.transaction(() => {
            for (const chunk of chunks(faceIds)) {
                const rows = db
                    .prepare(`
                        SELECT l.face_id AS faceId, l.person_id AS personId
                        FROM profile_suggestion_log l JOIN faces f ON f.id = l.face_id
                        WHERE l.status = 'assigned' AND f.person_id = l.person_id AND f.assignment_source = '${PROFILE_SOURCE}'
                          AND l.face_id IN (${marks(chunk.length)})
                        ORDER BY l.face_id
                    `)
                    .all(...chunk) as ProfilePair[];
                const reset = db.prepare(`
                    UPDATE faces
                    SET person_id = NULL, is_confirmed = 0, match_distance = NULL, assignment_source = '${UNASSIGNED_SOURCE}',
                        bucket_id = NULL, needs_bucketing = 1
                    WHERE id = ? AND person_id = ? AND assignment_source = '${PROFILE_SOURCE}'
                `);
                const forget = db.prepare(`DELETE FROM profile_suggestion_log WHERE face_id = ? AND person_id = ? AND status = 'assigned'`);
                for (const row of rows) {
                    if (reset.run(row.faceId, row.personId).changes > 0) {
                        forget.run(row.faceId, row.personId);
                        restored.push(row);
                    }
                }
            }
        })();
        return restored;
    }

    /** Faces this list assigned that are still with that person (what Undo could return). */
    static countAssigned(): number {
        return (getDB()
            .prepare(`
                SELECT COUNT(*) AS count FROM profile_suggestion_log l JOIN faces f ON f.id = l.face_id
                WHERE l.status = 'assigned' AND f.person_id = l.person_id AND f.assignment_source = '${PROFILE_SOURCE}'
            `)
            .get() as { count: number }).count;
    }

    /** What the page shows for faces. */
    static faceTiles(faceIds: readonly number[]): ProfileFaceTile[] {
        const db = getDB();
        const tiles: ProfileFaceTile[] = [];
        for (const chunk of chunks(faceIds)) {
            const rows = db
                .prepare(`
                    SELECT f.id AS faceId, f.photo_id AS photoId, f.box_json AS boxJson, f.pose_yaw AS yaw, f.face_quality AS quality, f.blur_score AS blur,
                           p.file_path AS filePath, p.preview_cache_path AS previewPath, p.width AS photoWidth, p.height AS photoHeight
                    FROM faces f JOIN photos p ON p.id = f.photo_id
                    WHERE f.id IN (${marks(chunk.length)})
                `)
                .all(...chunk) as (Omit<ProfileFaceTile, 'box'> & { boxJson: string })[];
            for (const { boxJson, ...rest } of rows) {
                try {
                    tiles.push({ ...rest, box: JSON.parse(boxJson) });
                } catch {
                    /* a face without a readable box cannot be shown; it is left out of the page */
                }
            }
        }
        return tiles;
    }

    static personNames(personIds: readonly number[]): Map<number, string> {
        const db = getDB();
        const names = new Map<number, string>();
        for (const chunk of chunks(personIds)) {
            const rows = db.prepare(`SELECT id, name FROM people WHERE id IN (${marks(chunk.length)})`).all(...chunk) as { id: number; name: string | null }[];
            for (const row of rows) names.set(row.id, row.name ?? `Person ${row.id}`);
        }
        return names;
    }

    /** The sharpest confirmed frontal face (|yaw| of 15 or less) of a person, outside one photo, to show beside the turned examples; null if none. */
    static frontalReference(personId: number, excludePhotoId: number): number | null {
        const row = getDB()
            .prepare(`
                SELECT f.id AS id FROM faces f
                WHERE f.person_id = ? AND f.is_confirmed = 1 AND f.is_ignored = 0 AND f.photo_id != ?
                  AND ABS(f.pose_yaw) <= 15 AND f.descriptor IS NOT NULL
                ORDER BY f.blur_score DESC, f.id LIMIT 1
            `)
            .get(personId, excludePhotoId) as { id: number } | undefined;
        return row?.id ?? null;
    }
}
