import { getDB } from '../../db';
import { FlagRepository, NON_FACE_CANDIDATE, TURNED_YAW_DEGREES, type NonFaceTile } from './FlagRepository';
import { VISIBILITY_KIND, VISIBILITY_MAX_DETECTOR_SCORE } from './VisibilityRepository';
import { VISIBILITY_MODEL, VISIBILITY_WEIGHTS } from '../../core/services/visibilityModel';

/** Ids per query when checking a batch; far below SQLite's limit on bound values. */
const ID_CHUNK = 500;

export interface RankedTile extends NonFaceTile {
    /** The model's answer (higher means "no clear face visible"). */
    modelScore: number;
    /** Log-odds that the box is not a face (model and detector score combined, see visibilityModel.ts). */
    logit: number;
}

export interface RankedCount {
    minLogit: number;
    total: number;
    /** How many of `total` are turned 45 degrees or more. */
    turned: number;
}

interface RankedRow {
    id: number; score: number; model_score: number; logit: number; face_quality: number | null; blur_score: number | null;
    pose_yaw: number | null; pose_pitch: number | null; box_json: string | null; photo_id: number;
    file_path: string | null; preview_cache_path: string | null; width: number | null; height: number | null;
}

const NO_BOX = { x: 0, y: 0, width: 0, height: 0 };

function parseBox(json: string | null): RankedTile['box'] {
    try {
        return json ? JSON.parse(json) : NO_BOX;
    } catch {
        return NO_BOX;
    }
}

/** The model's score of a face (from the current version of the model only; a failed attempt has no score and is left out). */
const WITH_MODEL_SCORE = `JOIN face_flags v ON v.face_id = f.id AND v.kind = '${VISIBILITY_KIND}' AND v.model = ? AND v.score IS NOT NULL`;
const LOGIT = '(? * v.score + ? * f.score + ?)';
const LOGIT_PARAMS = [VISIBILITY_WEIGHTS.model, VISIBILITY_WEIGHTS.detector, VISIBILITY_WEIGHTS.intercept];

/**
 * The "not a face" suggestions ranked by the model and the detector together (docs/plans/non-face-and-picture-faces-plan.md,
 * Phase B part 2): faces the model has scored, in the same queue and with the same guards as the detector-score list
 * (FlagRepository), whose likelihood of not being a face reaches the cut-off. Ignoring and keeping use the same write path
 * as the other list, after re-checking in SQL that the face is still a suggestion here.
 */
export class RankedNonFaceRepository {
    /** One query for several cut-offs (ranking numbers): how many suggestions each gives, and how many are turned faces. */
    static countAtLeast(minLogits: number[]): RankedCount[] {
        if (minLogits.length === 0) return [];
        const sums = minLogits.map((_, i) => `COALESCE(SUM(l >= ?), 0) AS total${i}, COALESCE(SUM(l >= ? AND ABS(yaw) >= ${TURNED_YAW_DEGREES}), 0) AS turned${i}`);
        const row = getDB().prepare(`
            SELECT ${sums.join(', ')}
            FROM (
                SELECT ${LOGIT} AS l, f.pose_yaw AS yaw
                FROM faces f
                ${WITH_MODEL_SCORE}
                WHERE ${NON_FACE_CANDIDATE}
            )
        `).get(...minLogits.flatMap(min => [min, min]), ...LOGIT_PARAMS, VISIBILITY_MODEL, VISIBILITY_MAX_DETECTOR_SCORE) as Record<string, number>;
        return minLogits.map((minLogit, i) => ({ minLogit, total: row[`total${i}`], turned: row[`turned${i}`] }));
    }

    /** The suggestions, the most likely non-faces first, `limit` at a time. */
    static list(minLogit: number, offset: number, limit: number): RankedTile[] {
        const rows = getDB().prepare(`
            SELECT f.id, f.score, v.score AS model_score, ${LOGIT} AS logit, f.face_quality, f.blur_score, f.pose_yaw, f.pose_pitch, f.box_json,
                   f.photo_id, p.file_path, p.preview_cache_path, p.width, p.height
            FROM faces f
            ${WITH_MODEL_SCORE}
            LEFT JOIN photos p ON p.id = f.photo_id
            WHERE ${NON_FACE_CANDIDATE} AND ${LOGIT} >= ?
            ORDER BY logit DESC, f.id ASC
            LIMIT ? OFFSET ?
        `).all(...LOGIT_PARAMS, VISIBILITY_MODEL, VISIBILITY_MAX_DETECTOR_SCORE, ...LOGIT_PARAMS, minLogit, limit, offset) as RankedRow[];
        return rows.map(r => ({
            faceId: r.id, score: r.score, modelScore: r.model_score, logit: r.logit, quality: r.face_quality, blur: r.blur_score,
            yaw: r.pose_yaw, pitch: r.pose_pitch, box: parseBox(r.box_json), photoId: r.photo_id, filePath: r.file_path,
            previewPath: r.preview_cache_path, photoWidth: r.width, photoHeight: r.height,
        }));
    }

    /** The ids among these that are still suggestions at the cut-off. */
    private static stillSuggested(ids: number[], minLogit: number): number[] {
        const db = getDB();
        const found: number[] = [];
        for (let start = 0; start < ids.length; start += ID_CHUNK) {
            const chunk = ids.slice(start, start + ID_CHUNK);
            const rows = db.prepare(`
                SELECT f.id FROM faces f ${WITH_MODEL_SCORE}
                WHERE f.id IN (${chunk.map(() => '?').join(',')}) AND ${NON_FACE_CANDIDATE} AND ${LOGIT} >= ?
            `).all(VISIBILITY_MODEL, ...chunk, VISIBILITY_MAX_DETECTOR_SCORE, ...LOGIT_PARAMS, minLogit) as { id: number }[];
            found.push(...rows.map(r => r.id));
        }
        return found;
    }

    /** Ignores the faces that are still suggestions here (the shared ignore, noted for undo) and returns the ids it changed. */
    static ignore(ids: number[], minLogit: number, at: string): number[] {
        return getDB().transaction(() => FlagRepository.ignoreEligible(this.stillSuggested(ids, minLogit), at))();
    }

    /** "These are faces": records the faces that are still suggestions here as kept, for both lists. Returns how many. */
    static keep(ids: number[], minLogit: number, at: string): number {
        return getDB().transaction(() => FlagRepository.dismissEligible(this.stillSuggested(ids, minLogit), at))();
    }
}
