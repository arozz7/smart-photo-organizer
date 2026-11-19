import { getDB } from '../../db';
import { NON_FACE_CANDIDATE } from './FlagRepository';
import { VISIBILITY_MODEL } from '../../core/services/visibilityModel';

export { VISIBILITY_MODEL };

/** Kind written to `face_flags` for the model's "is a clear face visible?" score (a different kind from the user's keep or ignore). */
export const VISIBILITY_KIND = 'face_visibility';
/**
 * Faces with a detector score at or above this are not shown to the model. In the Phase A labels about nine in ten
 * non-faces score below it, and it keeps the work to about a fifth of the review queue.
 */
export const VISIBILITY_MAX_DETECTOR_SCORE = 0.75;

export interface DueFace {
    id: number;
    box: { x: number; y: number; width: number; height: number };
    /** Width of the original photo, which the box coordinates refer to. */
    photoWidth: number | null;
    previewPath: string | null;
    filePath: string | null;
}

export interface VisibilityScore {
    faceId: number;
    /** Higher means "no clear face visible"; null when the face could not be scored (kept, so it is not tried again). */
    score: number | null;
}

export interface VisibilityCounts {
    candidates: number;
    scored: number;
    failed: number;
}

const NO_BOX = { x: 0, y: 0, width: 0, height: 0 };

function parseBox(json: string | null): DueFace['box'] {
    try {
        return json ? JSON.parse(json) : NO_BOX;
    } catch {
        return NO_BOX;
    }
}

/**
 * The queue of faces the model should look at, and where its scores are kept (docs/plans/non-face-and-picture-faces-plan.md,
 * Phase B part 2). "Needs a look" is the same rule as the suggestion list (unassigned, not ignored, human, not kept) and an
 * uncertain detector score, so the two cannot drift apart.
 */
export class VisibilityRepository {
    /** The next faces without a score from the current model, the lowest detector score first. */
    static loadDue(limit: number): DueFace[] {
        const rows = getDB().prepare(`
            SELECT f.id, f.box_json, p.width, p.preview_cache_path, p.file_path
            FROM faces f
            LEFT JOIN photos p ON p.id = f.photo_id
            WHERE ${NON_FACE_CANDIDATE}
              AND NOT EXISTS (SELECT 1 FROM face_flags v WHERE v.face_id = f.id AND v.kind = '${VISIBILITY_KIND}' AND v.model = ?)
            ORDER BY f.score ASC, f.id ASC
            LIMIT ?
        `).all(VISIBILITY_MAX_DETECTOR_SCORE, VISIBILITY_MODEL, limit) as { id: number; box_json: string | null; width: number | null; preview_cache_path: string | null; file_path: string | null }[];
        return rows.map(r => ({ id: r.id, box: parseBox(r.box_json), photoWidth: r.width, previewPath: r.preview_cache_path, filePath: r.file_path }));
    }

    /** Stores the scores (one per face and kind; an older one is replaced). */
    static save(scores: VisibilityScore[], model: string, at: string): void {
        if (scores.length === 0) return;
        const db = getDB();
        const store = db.prepare(
            `INSERT OR REPLACE INTO face_flags (face_id, kind, score, model, status, created_at) VALUES (?, '${VISIBILITY_KIND}', ?, ?, 'suggested', ?)`
        );
        db.transaction(() => {
            for (const { faceId, score } of scores) store.run(faceId, score, model, at);
        })();
    }

    /** How many faces need a look, and for how many of them the current model has a score or a failed attempt. */
    static counts(): VisibilityCounts {
        return getDB().prepare(`
            SELECT COUNT(*) AS candidates,
                   COALESCE(SUM(v.face_id IS NOT NULL AND v.score IS NOT NULL), 0) AS scored,
                   COALESCE(SUM(v.face_id IS NOT NULL AND v.score IS NULL), 0) AS failed
            FROM faces f
            LEFT JOIN face_flags v ON v.face_id = f.id AND v.kind = '${VISIBILITY_KIND}' AND v.model = ?
            WHERE ${NON_FACE_CANDIDATE}
        `).get(VISIBILITY_MODEL, VISIBILITY_MAX_DETECTOR_SCORE) as VisibilityCounts;
    }
}
