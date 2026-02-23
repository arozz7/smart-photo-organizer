import { getDB } from '../../db';

export interface ReferenceCandidate {
    filePath: string;
    cameraModel: string | null;
    width: number | null;
    height: number | null;
}

/**
 * Repository for discovering healthy reference photos to assist PRS repair.
 * Only photos without a scan_error record are considered healthy references.
 */
export class ReferenceRepository {
    /**
     * Find healthy photos that match the given camera model and/or resolution.
     * Returns up to `limit` candidates (default 10), sorted by recency.
     */
    static findCandidates(query: {
        cameraModel?: string;
        resolution?: string;
        limit?: number;
    }): ReferenceCandidate[] {
        const db = getDB();
        const limit = query.limit ?? 10;

        const cameraModel = query.cameraModel ?? null;
        const resolution = query.resolution ?? null;

        try {
            const rows = db.prepare(`
                SELECT p.file_path,
                       json_extract(p.metadata_json, '$.Model') AS cameraModel,
                       p.width,
                       p.height
                FROM photos p
                LEFT JOIN scan_errors se ON se.photo_id = p.id
                WHERE se.id IS NULL
                  AND (? IS NULL OR json_extract(p.metadata_json, '$.Model') = ?)
                  AND (? IS NULL OR (CAST(p.width AS TEXT) || 'x' || CAST(p.height AS TEXT)) = ?)
                ORDER BY p.date_taken DESC
                LIMIT ?
            `).all(cameraModel, cameraModel, resolution, resolution, limit) as Array<{
                file_path: string;
                cameraModel: string | null;
                width: number | null;
                height: number | null;
            }>;

            return rows.map(r => ({
                filePath: r.file_path,
                cameraModel: r.cameraModel,
                width: r.width,
                height: r.height,
            }));
        } catch (e) {
            throw new Error(`ReferenceRepository.findCandidates failed: ${String(e)}`);
        }
    }
}
