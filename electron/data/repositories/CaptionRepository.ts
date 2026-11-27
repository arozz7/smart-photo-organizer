import { getDB } from '../../db';

export interface PhotoToCaption {
    id: number;
    file_path: string;
}

/**
 * Photos waiting for a description and tags. Only photos whose faces were already scanned count, so a caption never
 * comes before the faces of the same photo, and the backlog starts at the newest photos.
 */
export class CaptionRepository {
    static getPhotosNeedingCaption(skipIds: ReadonlySet<number>, limit: number): PhotoToCaption[] {
        const db = getDB();
        return db
            .prepare(
                `SELECT p.id, p.file_path FROM photos p
                 WHERE (p.description IS NULL OR p.description = '')
                   AND p.missing_since IS NULL
                   AND p.id IN (SELECT photo_id FROM scan_history WHERE status = 'success')
                   AND p.id NOT IN (SELECT value FROM json_each(?))
                 ORDER BY p.id DESC
                 LIMIT ?`,
            )
            .all(JSON.stringify([...skipIds]), limit) as PhotoToCaption[];
    }

    static countPhotosNeedingCaption(): number {
        const db = getDB();
        const row = db
            .prepare(
                `SELECT COUNT(*) AS n FROM photos p
                 WHERE (p.description IS NULL OR p.description = '')
                   AND p.missing_since IS NULL
                   AND p.id IN (SELECT photo_id FROM scan_history WHERE status = 'success')`,
            )
            .get() as { n: number };
        return row.n;
    }
}
