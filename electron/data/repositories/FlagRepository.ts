import { getDB } from '../../db';
import { FaceRepository } from './FaceRepository';

/** Kind written to `face_flags` for "this box does not hold a face". */
export const NON_FACE_KIND = 'non_face';
/**
 * Written to `face_flags` for a face this list ignored, so only those can be undone and counted. (`faces.ignore_source` cannot
 * carry its own value: the legacy column only accepts 'user' and 'background_verification', and SQLite cannot relax a CHECK
 * without rebuilding the whole faces table.) The row is removed again when the face is restored.
 */
export const NON_FACE_IGNORED_KIND = 'non_face_ignored';
/** A face turned this many degrees or more (either way) is counted as turned; shown to the user, never used to flag or sort. */
export const TURNED_YAW_DEGREES = 45;
/** Ids per query when checking or updating a batch; far below SQLite's limit on bound values. */
const ID_CHUNK = 500;

/**
 * A face the review queue holds (unassigned, not ignored, human, with a descriptor; the same condition as
 * ParkedFaceRepository) whose detector score is below the cut-off and that the user has not said to keep.
 * The score is the only thing that makes a face a suggestion: pose, size and quality never do.
 */
export const NON_FACE_CANDIDATE = `
    f.person_id IS NULL
    AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
    AND COALESCE(f.entity_type, 'human') = 'human'
    AND f.descriptor IS NOT NULL
    AND f.score < ?
    AND NOT EXISTS (SELECT 1 FROM face_flags g WHERE g.face_id = f.id AND g.kind = '${NON_FACE_KIND}' AND g.status = 'dismissed')
`;

export interface NonFaceTile {
    faceId: number;
    score: number;
    quality: number | null;
    blur: number | null;
    /** Degrees; null when the pose is unknown (shown as unknown, not as facing front). */
    yaw: number | null;
    pitch: number | null;
    box: { x: number; y: number; width: number; height: number };
    photoId: number;
    filePath: string | null;
    previewPath: string | null;
    photoWidth: number | null;
    photoHeight: number | null;
}

export interface NonFaceCount {
    cutoff: number;
    total: number;
    /** How many of `total` are turned 45 degrees or more. */
    turned: number;
}

interface TileRow {
    id: number; score: number; face_quality: number | null; blur_score: number | null;
    pose_yaw: number | null; pose_pitch: number | null; box_json: string | null; photo_id: number;
    file_path: string | null; preview_cache_path: string | null; width: number | null; height: number | null;
}

const NO_BOX = { x: 0, y: 0, width: 0, height: 0 };

function parseBox(json: string | null): NonFaceTile['box'] {
    try {
        return json ? JSON.parse(json) : NO_BOX;
    } catch {
        return NO_BOX;
    }
}

function chunked<T>(items: T[]): T[][] {
    const chunks: T[][] = [];
    for (let start = 0; start < items.length; start += ID_CHUNK) chunks.push(items.slice(start, start + ID_CHUNK));
    return chunks;
}

const marks = (items: unknown[]) => items.map(() => '?').join(',');

/**
 * Reads and writes for the "not a face" suggestion list (docs/plans/non-face-and-picture-faces-plan.md, Phase B).
 * Every write re-checks that the face is still a suggestion at the given cut-off, so an out-of-date page can never
 * ignore a face that was assigned, ignored or kept in the meantime. Kept out of FaceRepository (over the file-size limit).
 */
export class FlagRepository {
    /** One query for several cut-offs: how many suggestions each gives, and how many of those are turned faces. */
    static countNonFaceBelow(cutoffs: number[]): NonFaceCount[] {
        if (cutoffs.length === 0) return [];
        const selects = cutoffs.map((_, i) => `COALESCE(SUM(f.score < ?), 0) AS total${i}, COALESCE(SUM(f.score < ? AND ABS(f.pose_yaw) >= ${TURNED_YAW_DEGREES}), 0) AS turned${i}`);
        const params = cutoffs.flatMap(cutoff => [cutoff, cutoff]);
        // the widest cut-off bounds the rows that need looking at
        const row = getDB().prepare(`
            SELECT ${selects.join(', ')}
            FROM faces f
            WHERE ${NON_FACE_CANDIDATE}
        `).get(...params, Math.max(...cutoffs)) as Record<string, number>;
        return cutoffs.map((cutoff, i) => ({ cutoff, total: row[`total${i}`], turned: row[`turned${i}`] }));
    }

    /**
     * The ids of the suggestions at the cut-off that Review Needed may hide: the list (same candidates, same cut-off) without its
     * turned faces (45 degrees or more, real faces seen from the side), which stay in Review Needed. An unknown pose counts as not turned.
     */
    static idsToHideBelow(cutoff: number): number[] {
        const rows = getDB().prepare(`
            SELECT f.id FROM faces f
            WHERE ${NON_FACE_CANDIDATE} AND (f.pose_yaw IS NULL OR ABS(f.pose_yaw) < ${TURNED_YAW_DEGREES})
            ORDER BY f.id
        `).all(cutoff) as { id: number }[];
        return rows.map(r => r.id);
    }

    /** The suggestions, lowest detector score first (the most likely non-faces), `limit` at a time. */
    static listNonFace(cutoff: number, offset: number, limit: number): NonFaceTile[] {
        const rows = getDB().prepare(`
            SELECT f.id, f.score, f.face_quality, f.blur_score, f.pose_yaw, f.pose_pitch, f.box_json, f.photo_id,
                   p.file_path, p.preview_cache_path, p.width, p.height
            FROM faces f
            LEFT JOIN photos p ON p.id = f.photo_id
            WHERE ${NON_FACE_CANDIDATE}
            ORDER BY f.score ASC, f.id ASC
            LIMIT ? OFFSET ?
        `).all(cutoff, limit, offset) as TileRow[];
        return rows.map(r => ({
            faceId: r.id, score: r.score, quality: r.face_quality, blur: r.blur_score, yaw: r.pose_yaw, pitch: r.pose_pitch,
            box: parseBox(r.box_json), photoId: r.photo_id, filePath: r.file_path, previewPath: r.preview_cache_path,
            photoWidth: r.width, photoHeight: r.height,
        }));
    }

    /** The ids among these that are still suggestions at the cut-off. */
    static stillSuggested(ids: number[], cutoff: number): number[] {
        const db = getDB();
        return chunked(ids).flatMap(chunk =>
            (db.prepare(`SELECT f.id FROM faces f WHERE f.id IN (${marks(chunk)}) AND ${NON_FACE_CANDIDATE}`).all(...chunk, cutoff) as { id: number }[]).map(r => r.id)
        );
    }

    /** Ignores the faces that are still suggestions, remembers that this list did it (for undo), and returns the ids it changed. */
    static ignoreNonFace(ids: number[], cutoff: number, at: string): number[] {
        return getDB().transaction(() => this.ignoreEligible(this.stillSuggested(ids, cutoff), at))();
    }

    /**
     * The write half of ignoring, for ids the caller has already checked are suggestions (in whichever list): the same
     * ignore as everywhere else (unassigns the face, source 'user') plus the note that this list did it, which undo needs.
     * Call it inside the transaction that did the check.
     */
    static ignoreEligible(eligible: number[], at: string): number[] {
        const remember = getDB().prepare(
            `INSERT OR REPLACE INTO face_flags (face_id, kind, score, model, status, created_at)
             SELECT id, '${NON_FACE_IGNORED_KIND}', score, 'detector_score', 'dismissed', ? FROM faces WHERE id = ?`
        );
        FaceRepository.ignoreFaces(eligible);
        for (const id of eligible) remember.run(at, id);
        return eligible;
    }

    /** "This is a face, keep it": records the faces that are still suggestions as dismissed so they are not offered again. Returns how many. */
    static dismissNonFace(ids: number[], cutoff: number, at: string): number {
        return getDB().transaction(() => this.dismissEligible(this.stillSuggested(ids, cutoff), at))();
    }

    /** The write half of keeping, for ids the caller has already checked. Returns how many were recorded. */
    static dismissEligible(eligible: number[], at: string): number {
        const record = getDB().prepare(
            `INSERT OR IGNORE INTO face_flags (face_id, kind, score, model, status, created_at)
             SELECT id, '${NON_FACE_KIND}', score, 'detector_score', 'dismissed', ? FROM faces WHERE id = ?`
        );
        return eligible.reduce((count, id) => count + record.run(at, id).changes, 0);
    }

    /** Returns these faces to the review queue, but only those this list ignored and that are still ignored and unassigned. Returns the ids restored. */
    static restoreNonFace(ids: number[]): number[] {
        const db = getDB();
        return db.transaction(() => {
            const eligible = chunked(ids).flatMap(chunk =>
                (db.prepare(
                    `SELECT f.id FROM faces f
                     JOIN face_flags g ON g.face_id = f.id AND g.kind = '${NON_FACE_IGNORED_KIND}'
                     WHERE f.id IN (${marks(chunk)}) AND f.is_ignored = 1 AND f.person_id IS NULL`
                ).all(...chunk) as { id: number }[]).map(r => r.id)
            );
            FaceRepository.restoreFaces(eligible);
            for (const chunk of chunked(eligible)) {
                db.prepare(`UPDATE faces SET ignore_source = NULL WHERE id IN (${marks(chunk)})`).run(...chunk);
                db.prepare(`DELETE FROM face_flags WHERE kind = '${NON_FACE_IGNORED_KIND}' AND face_id IN (${marks(chunk)})`).run(...chunk);
            }
            return eligible;
        })();
    }

    /** Faces this list has ignored and are still ignored; they can also be restored from the Ignored filter. */
    static countIgnoredByNonFace(): number {
        const row = getDB().prepare(
            `SELECT COUNT(*) AS count FROM faces f JOIN face_flags g ON g.face_id = f.id AND g.kind = '${NON_FACE_IGNORED_KIND}' WHERE f.is_ignored = 1`
        ).get() as { count: number };
        return row.count;
    }
}
