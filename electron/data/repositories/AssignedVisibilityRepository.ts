import { getDB } from '../../db';
import { NON_FACE_KIND } from './FlagRepository';
import { VisibilityRepository, VISIBILITY_KIND, VISIBILITY_MODEL, type DueFace, type VisibilityCounts, type VisibilityScore } from './VisibilityRepository';

/**
 * An assigned face the model should look at: not ignored, human, with a descriptor, and not already kept by the user as a real face.
 * There is no detector-score cut-off here: nearly every assigned face scores 0.85 or more, so a cut-off would skip the pool.
 */
export const ASSIGNED_CANDIDATE = `
    f.person_id IS NOT NULL
    AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
    AND COALESCE(f.entity_type, 'human') = 'human'
    AND f.descriptor IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM face_flags g WHERE g.face_id = f.id AND g.kind = '${NON_FACE_KIND}' AND g.status = 'dismissed')
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
 * The queue for the "is a clear face visible?" check over faces assigned to people (the unassigned faces are VisibilityRepository's).
 * Scores go to the same place (one visibility score per face and model), so a face is never scored twice and a face that is
 * unassigned later keeps its score. The biggest person comes first: that is where most of the unreviewed assignments are.
 */
export class AssignedVisibilityRepository {
    /** The next assigned faces without a score from the current model: the biggest person first, then the lowest detector score. */
    static loadDue(limit: number): DueFace[] {
        const rows = getDB().prepare(`
            SELECT f.id, f.box_json, p.width, p.preview_cache_path, p.file_path
            FROM faces f
            JOIN (SELECT person_id, COUNT(*) AS size FROM faces WHERE person_id IS NOT NULL GROUP BY person_id) pc ON pc.person_id = f.person_id
            LEFT JOIN photos p ON p.id = f.photo_id
            WHERE ${ASSIGNED_CANDIDATE}
              AND NOT EXISTS (SELECT 1 FROM face_flags v WHERE v.face_id = f.id AND v.kind = '${VISIBILITY_KIND}' AND v.model = ?)
            ORDER BY pc.size DESC, f.person_id ASC, f.score ASC, f.id ASC
            LIMIT ?
        `).all(VISIBILITY_MODEL, limit) as { id: number; box_json: string | null; width: number | null; preview_cache_path: string | null; file_path: string | null }[];
        return rows.map(r => ({ id: r.id, box: parseBox(r.box_json), photoWidth: r.width, previewPath: r.preview_cache_path, filePath: r.file_path }));
    }

    /** Stores the scores in the shared visibility place (one per face; an older one is replaced). */
    static save(scores: VisibilityScore[], model: string, at: string): void {
        VisibilityRepository.save(scores, model, at);
    }

    /** How many assigned faces need a look, and for how many the current model has a score or a failed attempt. */
    static counts(): VisibilityCounts {
        return getDB().prepare(`
            SELECT COUNT(*) AS candidates,
                   COALESCE(SUM(v.face_id IS NOT NULL AND v.score IS NOT NULL), 0) AS scored,
                   COALESCE(SUM(v.face_id IS NOT NULL AND v.score IS NULL), 0) AS failed
            FROM faces f
            LEFT JOIN face_flags v ON v.face_id = f.id AND v.kind = '${VISIBILITY_KIND}' AND v.model = ?
            WHERE ${ASSIGNED_CANDIDATE}
        `).get(VISIBILITY_MODEL) as VisibilityCounts;
    }
}
