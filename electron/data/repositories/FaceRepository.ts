import { getDB } from '../../db';

export class FaceRepository {
    private static parseFace(row: any) {
        let original_width = row.width;
        let original_height = row.height;

        // Fallback to metadata if columns NULL
        if ((!original_width || !original_height) && row.metadata_json) {
            try {
                const meta = JSON.parse(row.metadata_json);
                original_width = original_width || meta.ImageWidth || meta.SourceImageWidth || meta.ExifImageWidth;
                original_height = original_height || meta.ImageHeight || meta.SourceImageHeight || meta.ExifImageHeight;
            } catch (e) { }
        }
        return {
            ...row,
            box: JSON.parse(row.box_json),
            original_width,
            original_height,
            descriptor: row.descriptor ? Array.from(new Float32Array(row.descriptor.buffer, row.descriptor.byteOffset, row.descriptor.byteLength / 4)) : null,
            is_reference: !!row.is_reference
        };
    }

    static getBlurryFaces(options: { personId?: number, scope?: string, limit?: number, offset?: number, threshold?: number }) {
        const db = getDB();
        const { personId, scope, limit = 1000, offset = 0, threshold = 20.0 } = options;

        let query = `SELECT f.id, f.photo_id, f.blur_score, f.box_json, p.file_path, p.preview_cache_path, p.metadata_json, p.width, p.height, pp.name as person_name 
               FROM faces f 
               JOIN photos p ON f.photo_id = p.id
               LEFT JOIN people pp ON f.person_id = pp.id
               WHERE (f.is_ignored = 0 OR f.is_ignored IS NULL) AND f.blur_score < ?`;

        let countQuery = `SELECT COUNT(*) as count FROM faces f WHERE (f.is_ignored = 0 OR f.is_ignored IS NULL) AND f.blur_score < ?`;

        const params: any[] = [threshold];

        if (personId) {
            query += ` AND f.person_id = ?`;
            countQuery += ` AND f.person_id = ?`;
            params.push(personId);
        } else if (scope !== 'all') {
            // 'unnamed' or default
            query += ` AND f.person_id IS NULL`;
            countQuery += ` AND f.person_id IS NULL`;
        }

        query += ' ORDER BY f.blur_score ASC LIMIT ? OFFSET ?';
        const queryParams = [...params, limit, offset];

        try {
            const rows = db.prepare(query).all(...queryParams);
            const totalRes = db.prepare(countQuery).get(...params) as { count: number };

            return {
                faces: rows.map((r: any) => this.parseFace(r)),
                total: totalRes ? totalRes.count : 0
            };
        } catch (e) {
            throw new Error(`FaceRepository.getBlurryFaces failed: ${String(e)}`);
        }
    }

    static getFacesByIds(ids: number[]) {
        const db = getDB();
        if (ids.length === 0) return [];
        const placeholders = ids.map(() => '?').join(',');
        const query = `
            SELECT f.id, f.photo_id, f.blur_score, f.box_json, f.descriptor, p.file_path, p.preview_cache_path, p.metadata_json, p.width, p.height
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.id IN (${placeholders})
        `;
        const rows = db.prepare(query).all(...ids);
        return rows.map((r: any) => this.parseFace(r));
    }

    static ignoreFaces(ids: number[]) {
        const db = getDB();
        if (ids.length === 0) return;
        const placeholders = ids.map(() => '?').join(',');
        const query = `UPDATE faces SET is_ignored = 1 WHERE id IN (${placeholders})`;
        db.prepare(query).run(...ids);
    }

    static restoreFaces(ids: number[], personId?: number | null) {
        const db = getDB();
        if (ids.length === 0) return;
        const placeholders = ids.map(() => '?').join(',');

        let query: string;
        let params: any[];

        if (personId !== undefined) {
            query = `UPDATE faces SET is_ignored = 0, person_id = ? WHERE id IN (${placeholders})`;
            params = [personId, ...ids];
        } else {
            query = `UPDATE faces SET is_ignored = 0 WHERE id IN (${placeholders})`;
            params = [...ids];
        }

        db.prepare(query).run(...params);
    }

    static getIgnoredFaces(page = 1, limit = 50) {
        const db = getDB();
        const offset = (page - 1) * limit;

        const total = db.prepare('SELECT COUNT(*) as count FROM faces WHERE is_ignored = 1').get() as { count: number };

        const faces = db.prepare(`
            SELECT f.id, f.photo_id, f.blur_score, f.box_json, f.is_ignored, f.descriptor,
                   p.file_path, p.preview_cache_path, p.metadata_json, p.width, p.height
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.is_ignored = 1
            LIMIT ? OFFSET ?
        `).all(limit, offset);

        return {
            faces: faces.map((r: any) => this.parseFace(r)),
            total: total.count
        };
    }

    static getUnclusteredFaces(limit = 500, offset = 0) {
        const db = getDB();
        try {
            const faces = db.prepare(`
                SELECT f.id, f.photo_id, f.blur_score, f.box_json, p.file_path, p.preview_cache_path, p.width, p.height
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
                WHERE f.person_id IS NULL 
                  AND f.descriptor IS NOT NULL
                  AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
                  AND (f.blur_score IS NULL OR f.blur_score >= 10)
                ORDER BY f.id ASC
                LIMIT ? OFFSET ?
            `).all(limit, offset);

            const total = db.prepare(`
                SELECT COUNT(f.id) as count
                FROM faces f
                WHERE f.person_id IS NULL 
                AND f.descriptor IS NOT NULL
                AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
                AND (f.blur_score IS NULL OR f.blur_score >= 10)
            `).get() as { count: number };

            return {
                faces: faces.map((f: any) => ({
                    id: f.id,
                    photo_id: f.photo_id,
                    blur_score: f.blur_score,
                    box: JSON.parse(f.box_json),
                    file_path: f.file_path,
                    preview_cache_path: f.preview_cache_path,
                    width: f.width,
                    height: f.height
                })),
                total: total.count
            };
        } catch (e) {
            throw new Error(`FaceRepository.getUnclusteredFaces failed: ${String(e)}`);
        }
    }

    static getFacesForClustering() {
        const db = getDB();
        try {
            const faces = db.prepare(`
                SELECT id, descriptor
                FROM faces 
                WHERE person_id IS NULL 
                  AND descriptor IS NOT NULL
                  AND (is_ignored = 0 OR is_ignored IS NULL)
                  AND (blur_score IS NULL OR blur_score >= 10)
            `).all();

            return faces.map((f: any) => ({
                id: f.id,
                descriptor: Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4))
            }));
        } catch (e) {
            throw new Error(`FaceRepository.getFacesForClustering failed: ${String(e)}`);
        }
    }

    static getFaceById(faceId: number) {
        const db = getDB();
        try {
            const face = db.prepare(`SELECT * FROM faces WHERE id = ?`).get(faceId);
            if (!face) return null;
            return {
                ...face,
                box: JSON.parse(face.box_json),
                descriptor: face.descriptor ? Array.from(new Float32Array(face.descriptor.buffer, face.descriptor.byteOffset, face.descriptor.byteLength / 4)) : null,
                is_reference: !!face.is_reference
            };
        } catch (e) {
            console.error('FaceRepository.getFaceById failed:', e);
            return null;
        }
    }

    static getFacesByPhoto(photoId: number) {
        const db = getDB();
        try {
            const stmt = db.prepare(`
                SELECT f.*, p.name as person_name 
                FROM faces f
                LEFT JOIN people p ON f.person_id = p.id
                WHERE f.photo_id = ? AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
            `);
            const faces = stmt.all(photoId);
            return faces.map((f: any) => ({
                ...f,
                box: JSON.parse(f.box_json),
                descriptor: f.descriptor ? Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4)) : null,
                is_reference: !!f.is_reference
            }));
        } catch (error) {
            console.error('FaceRepository.getFacesByPhoto failed:', error);
            return [];
        }
    }

    static getAllFaces(limit = 100, offset = 0, filter: { personId?: number, unnamed?: boolean } = {}, includeDescriptors = true) {
        const db = getDB();
        try {
            let query = `
                SELECT f.*, p.file_path, p.preview_cache_path, p.width, p.height 
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
            `;
            const params: any[] = [];
            const conditions: string[] = [];

            if (filter.unnamed) conditions.push('f.person_id IS NULL');
            if (filter.personId) {
                conditions.push('f.person_id = ?');
                params.push(filter.personId);
            }

            if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
            if (!query.includes('is_ignored')) query += conditions.length > 0 ? ' AND is_ignored = 0' : ' WHERE is_ignored = 0';

            query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const faces = db.prepare(query).all(...params);

            return faces.map((f: any) => ({
                ...f,
                box: JSON.parse(f.box_json),
                descriptor: includeDescriptors && f.descriptor ? Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4)) : null,
                is_reference: !!f.is_reference
            }));
        } catch (error) {
            throw new Error(`FaceRepository.getAllFaces failed: ${String(error)}`);
        }
    }

    static deleteFaces(faceIds: number[]) {
        if (!faceIds || faceIds.length === 0) return;
        const db = getDB();
        const placeholders = faceIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM faces WHERE id IN (${placeholders})`).run(...faceIds);
    }

    static updateFacePerson(faceIds: number[], personId: number) {
        if (!faceIds || faceIds.length === 0) return;
        const db = getDB();
        const placeholders = faceIds.map(() => '?').join(',');
        db.prepare(`UPDATE faces SET person_id = ? WHERE id IN (${placeholders})`).run(personId, ...faceIds);
    }

    static getAllDescriptors(): { id: number, descriptor: number[] }[] {
        const db = getDB();
        // Only return faces with descriptors
        const rows = db.prepare('SELECT id, descriptor FROM faces WHERE descriptor IS NOT NULL').all() as any[];
        return rows.map(r => ({
            id: r.id,
            descriptor: Array.from(new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4))
        }));
    }

    static getUnassignedDescriptors(): { id: number, descriptor: number[] }[] {
        const db = getDB();
        const rows = db.prepare('SELECT id, descriptor FROM faces WHERE descriptor IS NOT NULL AND person_id IS NULL AND (is_ignored = 0 OR is_ignored IS NULL)').all() as any[];
        return rows.map(r => ({
            id: r.id,
            descriptor: Array.from(new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4))
        }));
    }
}
