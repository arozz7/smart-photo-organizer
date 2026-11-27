import { getDB } from '../../db';
import { FlagRepository } from './FlagRepository';
import { ASSIGNED_CANDIDATE } from './AssignedVisibilityRepository';
import { VISIBILITY_KIND, VISIBILITY_MODEL } from './VisibilityRepository';

/** Ids per query when checking or updating a batch; far below SQLite's limit on bound values. */
const ID_CHUNK = 500;

export interface DoubtfulTile {
    faceId: number;
    /** The model's answer (higher means "no clear face visible"); the list is sorted by it. */
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
    personId: number;
    personName: string | null;
    /** How the face was given to the person (scan, rematch, profile match, user). */
    source: string | null;
    confirmed: boolean;
}

export interface DoubtfulCount {
    minScore: number;
    total: number;
}

export interface DoubtfulPerson {
    personId: number;
    name: string | null;
    count: number;
}

/** What a change did, so the person can be rebuilt. */
export interface ChangedFace {
    faceId: number;
    formerPersonId: number;
}

export interface RestoredFace {
    faceId: number;
    /** Null when the former person no longer exists: the face comes back unassigned. */
    personId: number | null;
}

interface TileRow {
    id: number; score: number; face_quality: number | null; blur_score: number | null; pose_yaw: number | null; box_json: string | null; photo_id: number;
    file_path: string | null; preview_cache_path: string | null; width: number | null; height: number | null;
    person_id: number; person_name: string | null; assignment_source: string | null; is_confirmed: number | null;
}

interface FormerState {
    id: number;
    person_id: number;
    is_confirmed: number | null;
    assignment_source: string | null;
    match_distance: number | null;
    confidence_tier: string | null;
    suggested_person_id: number | null;
}

const NO_BOX = { x: 0, y: 0, width: 0, height: 0 };

function parseBox(json: string | null): DoubtfulTile['box'] {
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
const WITH_SCORE = `JOIN face_flags v ON v.face_id = f.id AND v.kind = '${VISIBILITY_KIND}' AND v.model = ? AND v.score IS NOT NULL`;

/**
 * The Doubtful faces list: faces assigned to a person that the vision check says show no clear face. Every write re-checks in SQL that the face is
 * still doubtful (assigned, not ignored, not kept, still at or above the cut-off) and remembers how it was assigned, so Undo gives it back as it was.
 */
export class DoubtfulFaceRepository {
    /** One query for several cut-offs: how many doubtful faces each gives. */
    static countAtLeast(minScores: number[]): DoubtfulCount[] {
        if (minScores.length === 0) return [];
        const sums = minScores.map((_, i) => `COALESCE(SUM(v.score >= ?), 0) AS total${i}`);
        const row = getDB().prepare(`
            SELECT ${sums.join(', ')}
            FROM faces f
            ${WITH_SCORE}
            WHERE ${ASSIGNED_CANDIDATE}
        `).get(...minScores, VISIBILITY_MODEL) as Record<string, number>;
        return minScores.map((minScore, i) => ({ minScore, total: row[`total${i}`] }));
    }

    /** The people with doubtful faces at the cut-off, the one with the most first. */
    static peopleAtLeast(minScore: number): DoubtfulPerson[] {
        const rows = getDB().prepare(`
            SELECT f.person_id AS personId, pe.name AS name, COUNT(*) AS count
            FROM faces f
            ${WITH_SCORE}
            LEFT JOIN people pe ON pe.id = f.person_id
            WHERE ${ASSIGNED_CANDIDATE} AND v.score >= ?
            GROUP BY f.person_id
            ORDER BY count DESC, f.person_id ASC
        `).all(VISIBILITY_MODEL, minScore) as DoubtfulPerson[];
        return rows;
    }

    /** The doubtful faces (of one person, or all), the most doubtful first, `limit` at a time. */
    static list(minScore: number, personId: number | null, offset: number, limit: number): DoubtfulTile[] {
        const rows = getDB().prepare(`
            SELECT f.id, v.score, f.face_quality, f.blur_score, f.pose_yaw, f.box_json, f.photo_id, p.file_path, p.preview_cache_path, p.width, p.height,
                   f.person_id, pe.name AS person_name, f.assignment_source, f.is_confirmed
            FROM faces f
            ${WITH_SCORE}
            LEFT JOIN photos p ON p.id = f.photo_id
            LEFT JOIN people pe ON pe.id = f.person_id
            WHERE ${ASSIGNED_CANDIDATE} AND v.score >= ? ${personId === null ? '' : 'AND f.person_id = ?'}
            ORDER BY v.score DESC, f.id ASC
            LIMIT ? OFFSET ?
        `).all(VISIBILITY_MODEL, minScore, ...(personId === null ? [] : [personId]), limit, offset) as TileRow[];
        return rows.map(r => ({
            faceId: r.id, score: r.score, quality: r.face_quality, blur: r.blur_score, yaw: r.pose_yaw, box: parseBox(r.box_json), photoId: r.photo_id,
            filePath: r.file_path, previewPath: r.preview_cache_path, photoWidth: r.width, photoHeight: r.height,
            personId: r.person_id, personName: r.person_name, source: r.assignment_source, confirmed: r.is_confirmed === 1,
        }));
    }

    /** The faces among these that are still doubtful at the cut-off, with how they are assigned now. */
    private static eligible(ids: number[], minScore: number): FormerState[] {
        const db = getDB();
        return chunked(ids).flatMap(chunk =>
            db.prepare(`
                SELECT f.id, f.person_id, f.is_confirmed, f.assignment_source, f.match_distance, f.confidence_tier, f.suggested_person_id
                FROM faces f
                ${WITH_SCORE}
                WHERE f.id IN (${marks(chunk.length)}) AND ${ASSIGNED_CANDIDATE} AND v.score >= ?
            `).all(VISIBILITY_MODEL, ...chunk, minScore) as FormerState[]
        );
    }

    private static note(state: FormerState, action: 'ignored' | 'unassigned', at: string): void {
        getDB().prepare(`
            INSERT OR REPLACE INTO doubtful_log (face_id, action, former_person_id, former_confirmed, former_source, former_distance, former_tier, former_suggested_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(state.id, action, state.person_id, state.is_confirmed ?? 0, state.assignment_source, state.match_distance, state.confidence_tier, state.suggested_person_id, at);
    }

    /** "Not a face": ignores the faces that are still doubtful (taking them out of their person), noting how each was assigned. Returns what it changed. */
    static ignore(ids: number[], minScore: number, at: string): ChangedFace[] {
        const db = getDB();
        return db.transaction(() => {
            const update = db.prepare(`
                UPDATE faces
                SET is_ignored = 1, ignore_source = 'user', person_id = NULL, is_confirmed = 0, match_distance = NULL, assignment_source = 'ai_scan'
                WHERE id = ?
            `);
            return this.eligible(ids, minScore).map(state => {
                this.note(state, 'ignored', at);
                update.run(state.id);
                return { faceId: state.id, formerPersonId: state.person_id };
            });
        })();
    }

    /** "Back to suggestions": takes the faces that are still doubtful out of their person, unconfirmed, keeping that person as the suggestion. */
    static unassign(ids: number[], minScore: number, at: string): ChangedFace[] {
        const db = getDB();
        return db.transaction(() => {
            const update = db.prepare(`
                UPDATE faces
                SET person_id = NULL, is_confirmed = 0, confidence_tier = 'review', suggested_person_id = ?, assignment_source = 'ai_scan',
                    needs_bucketing = 1, bucket_id = NULL
                WHERE id = ?
            `);
            return this.eligible(ids, minScore).map(state => {
                this.note(state, 'unassigned', at);
                update.run(state.person_id, state.id);
                return { faceId: state.id, formerPersonId: state.person_id };
            });
        })();
    }

    /** "This is a face": the faces that are still doubtful are not offered again (here or in the other lists). Nothing else changes. Returns how many. */
    static keep(ids: number[], minScore: number, at: string): number {
        return getDB().transaction(() => FlagRepository.dismissEligible(this.eligible(ids, minScore).map(state => state.id), at))();
    }

    /**
     * Gives faces this list changed back as they were (person, confirmed or not, source, distance, tier, suggestion). A face the user has assigned,
     * ignored or restored differently since is left alone; one whose former person no longer exists comes back unassigned instead.
     */
    static undo(faceIds: number[]): RestoredFace[] {
        const db = getDB();
        return db.transaction(() => {
            const restored: RestoredFace[] = [];
            const personExists = db.prepare('SELECT 1 FROM people WHERE id = ?');
            const restore = db.prepare(`
                UPDATE faces
                SET is_ignored = 0, ignore_source = NULL, person_id = ?, is_confirmed = ?, assignment_source = COALESCE(?, 'ai_scan'), match_distance = ?,
                    confidence_tier = COALESCE(?, confidence_tier), suggested_person_id = ?, needs_bucketing = ?
                WHERE id = ?
            `);
            const forget = db.prepare('DELETE FROM doubtful_log WHERE face_id = ?');
            for (const chunk of chunked(faceIds)) {
                const rows = db.prepare(`
                    SELECT l.face_id, l.former_person_id, l.former_confirmed, l.former_source, l.former_distance, l.former_tier, l.former_suggested_id
                    FROM doubtful_log l JOIN faces f ON f.id = l.face_id
                    WHERE f.person_id IS NULL AND l.face_id IN (${marks(chunk.length)})
                      AND ((l.action = 'ignored' AND f.is_ignored = 1 AND f.ignore_source = 'user') OR (l.action = 'unassigned' AND (f.is_ignored = 0 OR f.is_ignored IS NULL)))
                    ORDER BY l.face_id
                `).all(...chunk) as { face_id: number; former_person_id: number; former_confirmed: number | null; former_source: string | null; former_distance: number | null; former_tier: string | null; former_suggested_id: number | null }[];
                for (const row of rows) {
                    const person = personExists.get(row.former_person_id) ? row.former_person_id : null;
                    restore.run(
                        person, person === null ? 0 : row.former_confirmed ?? 0, person === null ? null : row.former_source, person === null ? null : row.former_distance,
                        row.former_tier, person === null ? null : row.former_suggested_id, person === null ? 1 : 0, row.face_id,
                    );
                    forget.run(row.face_id);
                    restored.push({ faceId: row.face_id, personId: person });
                }
            }
            return restored;
        })();
    }

    /** Faces this list changed that could still be undone (the rows of the log; Undo checks each face again). */
    static countChanged(): number {
        return (getDB().prepare(`
            SELECT COUNT(*) AS count FROM doubtful_log l JOIN faces f ON f.id = l.face_id
            WHERE f.person_id IS NULL AND ((l.action = 'ignored' AND f.is_ignored = 1) OR (l.action = 'unassigned' AND (f.is_ignored = 0 OR f.is_ignored IS NULL)))
        `).get() as { count: number }).count;
    }
}
