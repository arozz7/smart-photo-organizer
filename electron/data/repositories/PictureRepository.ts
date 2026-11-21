import { getDB } from '../../db';
import { PICTURE_MODEL } from '../../core/services/pictureModel';
import type { DueFace, VisibilityScore } from './VisibilityRepository';

export { PICTURE_MODEL };

/** Kind written to `face_flags` for the model's "real person or only a picture?" score (a different kind from the other checks and from the user's choices). */
export const PICTURE_KIND = 'picture';

export interface PictureCounts {
    /** Faces the picture check looks at: every face that is not ignored and is human, assigned to a person or not. */
    candidates: number;
    scored: number;
    failed: number;
    /** The same for the faces already assigned to a person (they are checked first). */
    assignedCandidates: number;
    assignedChecked: number;
}

/** A face the picture check should look at: not ignored, human, with a descriptor. */
const CANDIDATE = `
    (f.is_ignored = 0 OR f.is_ignored IS NULL)
    AND COALESCE(f.entity_type, 'human') = 'human'
    AND f.descriptor IS NOT NULL
`;

const NO_BOX = { x: 0, y: 0, width: 0, height: 0 };

function parseBox(json: string | null): DueFace['box'] {
    try {
        return json ? JSON.parse(json) : NO_BOX;
    } catch {
        return NO_BOX;
    }
}

/**
 * The queue of faces the picture check should look at, and where its scores are kept (docs/plans/pictures-suggestions-plan.md, Phase C).
 * Faces already assigned to people come first (a picture there is in a person's centroids and in the search index), then the review queue,
 * the clearest faces (highest detector score) first: low scores are the Not a Face? list's work.
 */
export class PictureRepository {
    /** The next faces without a score from the current model. */
    static loadDue(limit: number): DueFace[] {
        const rows = getDB().prepare(`
            SELECT f.id, f.box_json, p.width, p.preview_cache_path, p.file_path
            FROM faces f
            LEFT JOIN photos p ON p.id = f.photo_id
            WHERE ${CANDIDATE}
              AND NOT EXISTS (SELECT 1 FROM face_flags v WHERE v.face_id = f.id AND v.kind = '${PICTURE_KIND}' AND v.model = ?)
            ORDER BY (f.person_id IS NULL) ASC, f.score DESC, f.id ASC
            LIMIT ?
        `).all(PICTURE_MODEL, limit) as { id: number; box_json: string | null; width: number | null; preview_cache_path: string | null; file_path: string | null }[];
        return rows.map(r => ({ id: r.id, box: parseBox(r.box_json), photoWidth: r.width, previewPath: r.preview_cache_path, filePath: r.file_path }));
    }

    /** Stores the scores (one per face and kind; an older one is replaced). A null score is a failed attempt, kept so it is not tried again. */
    static save(scores: VisibilityScore[], model: string, at: string): void {
        if (scores.length === 0) return;
        const db = getDB();
        const store = db.prepare(`INSERT OR REPLACE INTO face_flags (face_id, kind, score, model, status, created_at) VALUES (?, '${PICTURE_KIND}', ?, ?, 'suggested', ?)`);
        db.transaction(() => {
            for (const { faceId, score } of scores) store.run(faceId, score, model, at);
        })();
    }

    static counts(): PictureCounts {
        return getDB().prepare(`
            SELECT COUNT(*) AS candidates,
                   COALESCE(SUM(v.face_id IS NOT NULL AND v.score IS NOT NULL), 0) AS scored,
                   COALESCE(SUM(v.face_id IS NOT NULL AND v.score IS NULL), 0) AS failed,
                   COALESCE(SUM(f.person_id IS NOT NULL), 0) AS assignedCandidates,
                   COALESCE(SUM(f.person_id IS NOT NULL AND v.face_id IS NOT NULL), 0) AS assignedChecked
            FROM faces f
            LEFT JOIN face_flags v ON v.face_id = f.id AND v.kind = '${PICTURE_KIND}' AND v.model = ?
            WHERE ${CANDIDATE}
        `).get(PICTURE_MODEL) as PictureCounts;
    }
}
