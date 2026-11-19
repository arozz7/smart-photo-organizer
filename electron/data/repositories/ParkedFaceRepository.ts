import { getDB } from '../../db';
import type { UnassignedFingerprint } from '../../core/services/parkedFaces';
import type { UnassignedFace } from '../../core/services/ParkedFaceSummaryService';

/**
 * Reads of the unassigned faces for the parked-faces summary. The condition is the one the review queue uses
 * (FaceRepository.getUnassignedDescriptors): faces with a descriptor, no person, not ignored.
 */
const UNASSIGNED = `f.descriptor IS NOT NULL AND f.person_id IS NULL AND (f.is_ignored = 0 OR f.is_ignored IS NULL)`;

export class ParkedFaceRepository {
    /** Size and identity of the unassigned set; cheap, so the saved summary can be checked before any real work. */
    static getFingerprint(): UnassignedFingerprint {
        return getDB().prepare(`
            SELECT COUNT(*) AS count,
                   COALESCE(SUM(f.id), 0) AS idSum,
                   COALESCE(SUM(f.id * f.id), 0) AS idSquareSum
            FROM faces f
            WHERE ${UNASSIGNED}
        `).get() as UnassignedFingerprint;
    }

    static getUnassignedFaces(): UnassignedFace[] {
        const rows = getDB().prepare(`
            SELECT f.id, f.descriptor, f.box_json, f.blur_score, f.photo_id, p.file_path, p.date_taken
            FROM faces f
            LEFT JOIN photos p ON p.id = f.photo_id
            WHERE ${UNASSIGNED}
            ORDER BY f.id
        `).all() as {
            id: number; descriptor: Buffer; box_json: string | null; blur_score: number | null;
            photo_id: number; file_path: string | null; date_taken: string | null;
        }[];
        return rows.map(row => ({
            id: row.id,
            descriptor: row.descriptor,
            boxJson: row.box_json,
            blur: row.blur_score,
            photoId: row.photo_id,
            filePath: row.file_path,
            dateTaken: row.date_taken,
        }));
    }
}
