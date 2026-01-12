import { getDB } from '../../db';

/**
 * BucketRepository - Manages face buckets for background bucketing service.
 * 
 * Buckets are groups of faces that are:
 * - Suggestions: Faces that match an existing named person
 * - Discoveries: New clusters of unknown faces
 */
export class BucketRepository {
    /**
     * Create a new bucket.
     */
    static createBucket(data: {
        bucketType: 'suggestion' | 'discovery';
        suggestedPersonId?: number | null;
        centroid?: Buffer | null;
        sessionFolder?: string | null;
        sessionDate?: string | null;
    }): number {
        const db = getDB();
        const info = db.prepare(`
            INSERT INTO face_buckets (bucket_type, suggested_person_id, centroid, session_folder, session_date)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            data.bucketType,
            data.suggestedPersonId ?? null,
            data.centroid ?? null,
            data.sessionFolder ?? null,
            data.sessionDate ?? null
        );
        return Number(info.lastInsertRowid);
    }

    /**
     * Get all active buckets with their face counts.
     */
    static getBucketsWithCounts(): Array<{
        id: number;
        bucket_type: string;
        suggested_person_id: number | null;
        status: string;
        face_count: number;
        session_folder: string | null;
        session_date: string | null;
    }> {
        const db = getDB();
        return db.prepare(`
            SELECT 
                b.id, 
                b.bucket_type, 
                b.suggested_person_id, 
                b.status,
                b.session_folder,
                b.session_date,
                COUNT(f.id) as face_count
            FROM face_buckets b
            LEFT JOIN faces f ON f.bucket_id = b.id AND f.is_ignored = 0
            WHERE b.status = 'active'
            GROUP BY b.id
            ORDER BY face_count DESC
        `).all() as Array<{
            id: number;
            bucket_type: string;
            suggested_person_id: number | null;
            status: string;
            face_count: number;
            session_folder: string | null;
            session_date: string | null;
        }>;
    }

    /**
     * Get bucket by ID.
     */
    static getBucketById(bucketId: number) {
        const db = getDB();
        return db.prepare('SELECT * FROM face_buckets WHERE id = ?').get(bucketId);
    }

    /**
     * Update bucket face count.
     */
    static updateFaceCount(bucketId: number): void {
        const db = getDB();
        db.prepare(`
            UPDATE face_buckets 
            SET face_count = (SELECT COUNT(*) FROM faces WHERE bucket_id = ? AND is_ignored = 0),
                updated_at = datetime('now')
            WHERE id = ?
        `).run(bucketId, bucketId);
    }

    /**
     * Delete a bucket and unlink its faces.
     */
    static deleteBucket(bucketId: number): void {
        const db = getDB();
        db.prepare('UPDATE faces SET bucket_id = NULL WHERE bucket_id = ?').run(bucketId);
        db.prepare('DELETE FROM face_buckets WHERE id = ?').run(bucketId);
    }

    /**
     * Delete orphan buckets (those with no faces).
     */
    static deleteOrphanBuckets(): number {
        const db = getDB();
        const result = db.prepare(`
            DELETE FROM face_buckets 
            WHERE id NOT IN (SELECT DISTINCT bucket_id FROM faces WHERE bucket_id IS NOT NULL)
              AND status = 'active'
        `).run();
        return result.changes;
    }

    /**
     * Mark bucket as processed (status = 'completed').
     */
    static markCompleted(bucketId: number): void {
        const db = getDB();
        db.prepare(`
            UPDATE face_buckets SET status = 'completed', updated_at = datetime('now') WHERE id = ?
        `).run(bucketId);
    }

    /**
     * Get suggestion buckets (faces matching named people).
     */
    static getSuggestionBuckets() {
        const db = getDB();
        return db.prepare(`
            SELECT 
                b.*, 
                per.name as person_name,
                COUNT(f.id) as face_count,
                GROUP_CONCAT(f.id) as face_ids_str
            FROM face_buckets b
            LEFT JOIN people per ON b.suggested_person_id = per.id
            JOIN faces f ON f.bucket_id = b.id AND f.is_ignored = 0
            JOIN photos p ON f.photo_id = p.id
            WHERE b.bucket_type = 'suggestion' AND b.status = 'active'
            GROUP BY b.id
            HAVING face_count > 0
            ORDER BY face_count DESC
        `).all().map((row: any) => ({
            ...row,
            face_ids: row.face_ids_str ? row.face_ids_str.split(',').map(Number) : []
        }));
    }

    /**
     * Get discovery buckets (unknown face clusters).
     */
    static getDiscoveryBuckets() {
        const db = getDB();
        return db.prepare(`
            SELECT 
                b.*,
                COUNT(f.id) as face_count,
                GROUP_CONCAT(f.id) as face_ids_str
            FROM face_buckets b
            JOIN faces f ON f.bucket_id = b.id AND f.is_ignored = 0
            JOIN photos p ON f.photo_id = p.id
            WHERE b.bucket_type = 'discovery' AND b.status = 'active'
            GROUP BY b.id
            HAVING face_count > 0
            ORDER BY face_count DESC
        `).all().map((row: any) => ({
            ...row,
            face_ids: row.face_ids_str ? row.face_ids_str.split(',').map(Number) : []
        }));
    }
    /**
     * Get faces that are currently ignored but have been assigned to a bucket (potential background recovery).
     */
    static getRecoveredFaces() {
        const db = getDB();
        return db.prepare(`
            SELECT 
                f.id, ph.file_path, f.box_json as box, f.bucket_id, ph.width, ph.height,
                b.bucket_type,
                p.name as suggested_name, 
                p.id as suggested_person_id
            FROM faces f
            JOIN photos ph ON f.photo_id = ph.id
            JOIN face_buckets b ON f.bucket_id = b.id
            LEFT JOIN people p ON b.suggested_person_id = p.id
            WHERE f.is_ignored = 1
            ORDER BY b.updated_at DESC
        `).all();
    }

    /**
     * Recover faces by un-ignoring them.
     */
    static recoverFaces(faceIds: number[]): void {
        if (faceIds.length === 0) return;
        const db = getDB();
        const stmt = db.prepare('UPDATE faces SET is_ignored = 0 WHERE id = ?');
        const transaction = db.transaction((ids: number[]) => {
            for (const id of ids) stmt.run(id);
        });
        transaction(faceIds);
    }
}
