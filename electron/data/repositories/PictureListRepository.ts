import { getDB } from '../../db';
import { PICTURE_KIND, PICTURE_MODEL } from './PictureRepository';

/** Ids per query when checking or updating a batch; far below SQLite's limit on bound values. */
const ID_CHUNK = 500;

export type PictureList = 'unassigned' | 'assigned';

export interface PictureTile {
    faceId: number;
    /** The model's answer (higher means more picture-like); the list is sorted by it. */
    score: number;
    quality: number | null;
    blur: number | null;
    yaw: number | null;
    box: { x: number; y: number; width: number; height: number };
    photoId: number;
    filePath: string | null;
    previewPath: string | null;
    photoWidth: number | null;
    photoHeight: number | null;
    /** Assigned faces only: the person and how the face was given to them. */
    personId: number | null;
    personName: string | null;
    source: string | null;
    confirmed: boolean | null;
}

export interface PictureCount {
    minQ1: number;
    unassigned: number;
    assigned: number;
}

/** What an ignore changed, so the person can be rebuilt (`formerPersonId` is null for a face that was not assigned). */
export interface IgnoredPicture {
    faceId: number;
    formerPersonId: number | null;
}

export interface RestoredPicture {
    faceId: number;
    personId: number | null;
}

interface TileRow {
    id: number; score: number; face_quality: number | null; blur_score: number | null; pose_yaw: number | null; box_json: string | null; photo_id: number;
    file_path: string | null; preview_cache_path: string | null; width: number | null; height: number | null;
    person_id: number | null; person_name: string | null; assignment_source: string | null; is_confirmed: number | null;
}

const NO_BOX = { x: 0, y: 0, width: 0, height: 0 };

function parseBox(json: string | null): PictureTile['box'] {
    try {
        return json ? JSON.parse(json) : NO_BOX;
    } catch {
        return NO_BOX;
    }
}

const marks = (count: number) => Array(count).fill('?').join(',');

function chunked<T>(items: readonly T[]): T[][] {
    const out: T[][] = [];
    for (let start = 0; start < items.length; start += ID_CHUNK) out.push(items.slice(start, start + ID_CHUNK));
    return out;
}

/** The model's score of a face (from the current version of the model only; a failed attempt has no score and is left out). */
const WITH_SCORE = `JOIN face_flags v ON v.face_id = f.id AND v.kind = '${PICTURE_KIND}' AND v.model = ? AND v.score IS NOT NULL`;
/** A face the lists may suggest: not ignored, human, with a descriptor, and not already answered by the user (ignored or kept as a picture). */
const SUGGESTION = `
    (f.is_ignored = 0 OR f.is_ignored IS NULL)
    AND COALESCE(f.entity_type, 'human') = 'human'
    AND f.descriptor IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM picture_log l WHERE l.face_id = f.id)
`;

interface FormerState {
    id: number;
    person_id: number | null;
    is_confirmed: number | null;
    assignment_source: string | null;
    match_distance: number | null;
}

/**
 * The Pictures? lists (docs/plans/pictures-suggestions-plan.md, Phase C): faces whose picture score reaches a cut-off, unassigned (Review
 * Needed) and assigned to people. Ignoring a picture takes it out of its person (centroids and the search index follow) and remembers exactly
 * how it was assigned, so Undo gives it back as it was. Writes re-check in SQL that a face is still a suggestion.
 */
export class PictureListRepository {
    /** One query for several cut-offs: how many suggestions each gives in the two lists. */
    static countAtLeast(minQ1s: number[]): PictureCount[] {
        if (minQ1s.length === 0) return [];
        const sums = minQ1s.map((_, i) => `COALESCE(SUM(v.score >= ? AND f.person_id IS NULL), 0) AS unassigned${i}, COALESCE(SUM(v.score >= ? AND f.person_id IS NOT NULL), 0) AS assigned${i}`);
        const row = getDB().prepare(`
            SELECT ${sums.join(', ')}
            FROM faces f
            ${WITH_SCORE}
            WHERE ${SUGGESTION} AND v.score >= ?
        `).get(...minQ1s.flatMap(min => [min, min]), PICTURE_MODEL, Math.min(...minQ1s)) as Record<string, number>;
        return minQ1s.map((minQ1, i) => ({ minQ1, unassigned: row[`unassigned${i}`], assigned: row[`assigned${i}`] }));
    }

    /** The suggestions of one list, the most picture-like first, `limit` at a time. */
    static list(which: PictureList, minQ1: number, offset: number, limit: number): PictureTile[] {
        const rows = getDB().prepare(`
            SELECT f.id, v.score, f.face_quality, f.blur_score, f.pose_yaw, f.box_json, f.photo_id, p.file_path, p.preview_cache_path, p.width, p.height,
                   f.person_id, pe.name AS person_name, f.assignment_source, f.is_confirmed
            FROM faces f
            ${WITH_SCORE}
            LEFT JOIN photos p ON p.id = f.photo_id
            LEFT JOIN people pe ON pe.id = f.person_id
            WHERE ${SUGGESTION} AND v.score >= ? AND f.person_id IS ${which === 'assigned' ? 'NOT NULL' : 'NULL'}
            ORDER BY v.score DESC, f.id ASC
            LIMIT ? OFFSET ?
        `).all(PICTURE_MODEL, minQ1, limit, offset) as TileRow[];
        return rows.map(r => ({
            faceId: r.id, score: r.score, quality: r.face_quality, blur: r.blur_score, yaw: r.pose_yaw, box: parseBox(r.box_json), photoId: r.photo_id,
            filePath: r.file_path, previewPath: r.preview_cache_path, photoWidth: r.width, photoHeight: r.height,
            personId: r.person_id, personName: r.person_name, source: r.person_id === null ? null : r.assignment_source, confirmed: r.person_id === null ? null : r.is_confirmed === 1,
        }));
    }

    /** The ids Review Needed may hide: the unassigned list at the cut-off (an assigned face is never hidden, it is reviewed in its list). */
    static idsToHide(minQ1: number): number[] {
        const rows = getDB().prepare(`
            SELECT f.id FROM faces f
            ${WITH_SCORE}
            WHERE ${SUGGESTION} AND v.score >= ? AND f.person_id IS NULL
            ORDER BY f.id
        `).all(PICTURE_MODEL, minQ1) as { id: number }[];
        return rows.map(r => r.id);
    }

    /** The faces among these that are still suggestions at the cut-off, with how they are assigned now. */
    private static eligible(ids: number[], minQ1: number): FormerState[] {
        const db = getDB();
        return chunked(ids).flatMap(chunk =>
            db.prepare(`
                SELECT f.id, f.person_id, f.is_confirmed, f.assignment_source, f.match_distance
                FROM faces f
                ${WITH_SCORE}
                WHERE f.id IN (${marks(chunk.length)}) AND ${SUGGESTION} AND v.score >= ?
            `).all(PICTURE_MODEL, ...chunk, minQ1) as FormerState[]
        );
    }

    private static note(state: FormerState, action: 'ignored' | 'kept', at: string): void {
        getDB().prepare(
            'INSERT INTO picture_log (face_id, action, former_person_id, former_confirmed, former_source, former_distance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(state.id, action, state.person_id, state.is_confirmed ?? 0, state.assignment_source, state.match_distance, at);
    }

    /** Ignores the faces that are still suggestions (taking assigned ones out of their person), noting how each was assigned. Returns what it changed. */
    static ignore(ids: number[], minQ1: number, at: string): IgnoredPicture[] {
        const db = getDB();
        return db.transaction(() => {
            const done: IgnoredPicture[] = [];
            const update = db.prepare(`
                UPDATE faces
                SET is_ignored = 1, ignore_source = 'user', person_id = NULL, is_confirmed = 0, match_distance = NULL,
                    assignment_source = CASE WHEN person_id IS NULL THEN assignment_source ELSE 'ai_scan' END
                WHERE id = ?
            `);
            for (const state of this.eligible(ids, minQ1)) {
                this.note(state, 'ignored', at);
                update.run(state.id);
                done.push({ faceId: state.id, formerPersonId: state.person_id });
            }
            return done;
        })();
    }

    /** "This is a real face": the faces that are still suggestions are not offered again. Nothing else changes. Returns how many. */
    static keep(ids: number[], minQ1: number, at: string): number {
        return getDB().transaction(() => {
            const eligible = this.eligible(ids, minQ1);
            for (const state of eligible) this.note(state, 'kept', at);
            return eligible.length;
        })();
    }

    /**
     * Gives faces this list ignored back as they were (person, confirmed or not, source, distance). A face the user has assigned or ignored
     * differently since is left alone; so is one whose former person no longer exists, which comes back unassigned instead.
     */
    static undo(faceIds: number[]): RestoredPicture[] {
        const db = getDB();
        return db.transaction(() => {
            const restored: RestoredPicture[] = [];
            const personExists = db.prepare('SELECT 1 FROM people WHERE id = ?');
            const restore = db.prepare(`
                UPDATE faces
                SET is_ignored = 0, ignore_source = NULL, person_id = ?, is_confirmed = ?, assignment_source = COALESCE(?, 'ai_scan'), match_distance = ?,
                    needs_bucketing = CASE WHEN ? IS NULL THEN 1 ELSE needs_bucketing END
                WHERE id = ?
            `);
            const forget = db.prepare('DELETE FROM picture_log WHERE face_id = ?');
            for (const chunk of chunked(faceIds)) {
                const rows = db.prepare(`
                    SELECT l.face_id, l.former_person_id, l.former_confirmed, l.former_source, l.former_distance
                    FROM picture_log l JOIN faces f ON f.id = l.face_id
                    WHERE l.action = 'ignored' AND f.is_ignored = 1 AND f.ignore_source = 'user' AND f.person_id IS NULL AND l.face_id IN (${marks(chunk.length)})
                    ORDER BY l.face_id
                `).all(...chunk) as { face_id: number; former_person_id: number | null; former_confirmed: number | null; former_source: string | null; former_distance: number | null }[];
                for (const row of rows) {
                    const person = row.former_person_id !== null && personExists.get(row.former_person_id) ? row.former_person_id : null;
                    restore.run(person, person === null ? 0 : row.former_confirmed ?? 0, person === null ? null : row.former_source, person === null ? null : row.former_distance, person, row.face_id);
                    forget.run(row.face_id);
                    restored.push({ faceId: row.face_id, personId: person });
                }
            }
            return restored;
        })();
    }

    /** Faces this list ignored that are still ignored (what Undo could return). */
    static countIgnored(): number {
        return (getDB().prepare(`
            SELECT COUNT(*) AS count FROM picture_log l JOIN faces f ON f.id = l.face_id WHERE l.action = 'ignored' AND f.is_ignored = 1
        `).get() as { count: number }).count;
    }
}
