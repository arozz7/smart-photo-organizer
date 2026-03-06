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
            is_reference: !!row.is_reference,
            confidence_tier: row.confidence_tier || 'unknown',
            suggested_person_id: row.suggested_person_id,
            match_distance: row.match_distance
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
            SELECT f.id, f.photo_id, f.blur_score, f.box_json, f.descriptor, f.confidence_tier, f.suggested_person_id, f.match_distance,
                   p.file_path, p.preview_cache_path, p.metadata_json, p.width, p.height
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.id IN (${placeholders})
        `;
        const rows = db.prepare(query).all(...ids);
        return rows.map((r: any) => this.parseFace(r));
    }

    static ignoreFaces(ids: number[], source: 'user' | 'background_verification' = 'user') {
        const db = getDB();
        if (ids.length === 0) return;
        const placeholders = ids.map(() => '?').join(',');
        // CRITICAL: Unassign from person when ignoring so they are removed from FAISS index logic
        const query = `UPDATE faces SET is_ignored = 1, person_id = NULL, ignore_source = ? WHERE id IN (${placeholders})`;
        db.prepare(query).run(source, ...ids);
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

    static getIgnoredFaces(page = 1, limit = 50, order: 'asc' | 'desc' = 'asc') {
        const db = getDB();
        const offset = (page - 1) * limit;
        const orderDirection = order === 'desc' ? 'DESC' : 'ASC';

        const total = db.prepare('SELECT COUNT(*) as count FROM faces WHERE is_ignored = 1').get() as { count: number };

        const faces = db.prepare(`
            SELECT f.id, f.photo_id, f.blur_score, f.box_json, f.is_ignored, f.descriptor,
                   p.file_path, p.preview_cache_path, p.metadata_json, p.width, p.height
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.is_ignored = 1
            ORDER BY f.id ${orderDirection}
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
                SELECT f.id, f.photo_id, f.blur_score, f.box_json, f.confidence_tier, f.suggested_person_id, f.match_distance, p.file_path, p.preview_cache_path, p.width, p.height
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
                AND (f.entity_type = 'human' OR f.entity_type IS NULL)
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

    /**
     * [Phase 79] Get ALL faces for a photo, including ignored ones.
     * Used during rescan to properly clean up ignored faces in the pre-pass.
     * Without this, ignored faces are invisible to deduplication and get re-inserted as new faces.
     */
    static getFacesByPhotoIncludingIgnored(photoId: number) {
        const db = getDB();
        try {
            const stmt = db.prepare(`
                SELECT f.*, p.name as person_name 
                FROM faces f
                LEFT JOIN people p ON f.person_id = p.id
                WHERE f.photo_id = ?
            `);
            const faces = stmt.all(photoId);
            return faces.map((f: any) => ({
                ...f,
                box: JSON.parse(f.box_json),
                descriptor: f.descriptor ? Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4)) : null,
                is_reference: !!f.is_reference
            }));
        } catch (error) {
            console.error('FaceRepository.getFacesByPhotoIncludingIgnored failed:', error);
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
            // [Phase 56] Exclude suspect faces (pending VLM verification)
            query += (query.includes('WHERE') ? ' AND' : ' WHERE') + ' (f.entity_type = \'human\' OR f.entity_type IS NULL)';

            query += ' ORDER BY p.date_taken DESC LIMIT ? OFFSET ?';
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

    static updateFacePerson(faceIds: number[], personId: number | null, setConfirmed: boolean | null = null) {
        if (!faceIds || faceIds.length === 0) return;
        const db = getDB();
        const placeholders = faceIds.map(() => '?').join(',');

        let query = `UPDATE faces SET person_id = ?`;
        const params: any[] = [personId];

        // Always clear bucket link when status changes
        query += `, bucket_id = NULL`;

        // Update bucketing status
        if (personId === null) {
            // If unassigning, mark for re-bucketing
            query += `, needs_bucketing = 1`;
        } else {
            // If assigning, mark as complete
            query += `, needs_bucketing = 0`;
        }

        if (setConfirmed !== null) {
            query += `, is_confirmed = ?`;
            params.push(setConfirmed ? 1 : 0);
        } else if (personId === null) {
            // Implicitly unconfirm if removing person
            query += `, is_confirmed = 0`;
        }

        query += ` WHERE id IN (${placeholders})`;
        params.push(...faceIds);

        db.prepare(query).run(...params);
    }

    /**
     * Assign faces to a person with metadata tracking (Phase 40).
     */
    static assignFacesToPerson(
        faceIds: number[],
        personId: number,
        options: { assignment_source: string, is_confirmed: boolean }
    ) {
        if (!faceIds || faceIds.length === 0) return;
        const db = getDB();
        const placeholders = faceIds.map(() => '?').join(',');

        const query = `
            UPDATE faces 
            SET person_id = ?, 
                assignment_source = ?, 
                is_confirmed = ?,
                bucket_id = NULL,
                needs_bucketing = 0,
                is_ignored = 0
            WHERE id IN (${placeholders})
        `;

        db.prepare(query).run(
            personId,
            options.assignment_source,
            options.is_confirmed ? 1 : 0,
            ...faceIds
        );
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

    /**
     * Get descriptors ONLY for faces assigned to named people.
     * CRITICAL: This is what should populate the FAISS index for scan-time matching.
     * Including unnamed faces in FAISS causes false matches.
     */
    static getNamedFaceDescriptors(): { id: number, descriptor: number[] }[] {
        const db = getDB();
        const rows = db.prepare(`
            SELECT f.id, f.descriptor 
            FROM faces f 
            JOIN people p ON f.person_id = p.id 
            WHERE f.descriptor IS NOT NULL AND f.person_id IS NOT NULL AND f.is_ignored = 0
        `).all() as any[];
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

    /**
     * Get faces with their descriptors for a specific person.
     * Used for outlier detection analysis.
     * Includes photo data for direct display without additional lookups.
     */
    static getFacesWithDescriptorsByPerson(personId: number): Array<{
        id: number;
        descriptor: Buffer | null;
        blur_score: number | null;
        is_confirmed: number; // 0 or 1
        box_json: string;
        photo_id: number;
        file_path: string;
        preview_cache_path: string | null;
        width: number;
        height: number;
    }> {
        const db = getDB();
        try {
            const rows = db.prepare(`
                SELECT 
                    f.id, 
                    f.descriptor, 
                    f.blur_score,
                    f.is_confirmed,
                    f.box_json,
                    f.photo_id,
                    p.file_path,
                    p.preview_cache_path,
                    p.width,
                    p.height
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
                WHERE f.person_id = ?
                  AND f.descriptor IS NOT NULL
                  AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
            `).all(personId) as Array<{
                id: number;
                descriptor: Buffer | null;
                blur_score: number | null;
                is_confirmed: number;
                box_json: string;
                photo_id: number;
                file_path: string;
                preview_cache_path: string | null;
                width: number;
                height: number;
            }>;

            return rows;
        } catch (error) {
            throw new Error(`FaceRepository.getFacesWithDescriptorsByPerson failed: ${String(error)}`);
        }
    }

    /**
     * Get unnamed faces with descriptors and photo appearance counts.
     * Used for Background Face Filter to identify noise candidates.
     * Photo count represents how often faces in this photo's cluster appear.
     */
    static getUnnamedFacesForNoiseDetection(): Array<{
        id: number;
        descriptor: Buffer | null;
        box_json: string;
        file_path: string;
        preview_cache_path: string | null;
        width: number;
        height: number;
        photo_id: number;
    }> {
        const db = getDB();
        try {
            const rows = db.prepare(`
                SELECT 
                    f.id, 
                    f.descriptor, 
                    f.box_json,
                    f.photo_id,
                    p.file_path,
                    p.preview_cache_path,
                    p.width,
                    p.height
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
                WHERE f.person_id IS NULL 
                  AND f.descriptor IS NOT NULL
                  AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
                  AND (f.blur_score IS NULL OR f.blur_score >= 10)
            `).all() as Array<{
                id: number;
                descriptor: Buffer | null;
                box_json: string;
                file_path: string;
                preview_cache_path: string | null;
                width: number;
                height: number;
                photo_id: number;
            }>;

            return rows;
        } catch (error) {
            throw new Error(`FaceRepository.getUnnamedFacesForNoiseDetection failed: ${String(error)}`);
        }
    }

    /**
     * Get faces that need pose data backfill (Phase 5).
     * Returns faces where pose_yaw IS NULL but have descriptors.
     */
    static getFacesNeedingPoseBackfill(limit = 100): Array<{
        id: number;
        photo_id: number;
        box_json: string;
        file_path: string;
        preview_cache_path: string | null;
    }> {
        const db = getDB();
        try {
            const rows = db.prepare(`
                SELECT 
                    f.id,
                    f.photo_id,
                    f.box_json,
                    p.file_path,
                    p.preview_cache_path,
                    p.metadata_json
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
                WHERE f.pose_yaw IS NULL 
                  AND f.descriptor IS NOT NULL
                  AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
                  AND (f.blur_score IS NULL OR f.blur_score >= 10)
                LIMIT ?
            `).all(limit) as Array<{
                id: number;
                photo_id: number;
                box_json: string;
                file_path: string;
                preview_cache_path: string | null;
                metadata_json: string;
            }>;

            return rows.map(r => {
                let orientation = 1;
                try {
                    const meta = JSON.parse(r.metadata_json || '{}');
                    orientation = meta.Orientation || meta.orientation || 1;
                } catch { /* ignore */ }
                return {
                    ...r,
                    orientation
                };
            });
        } catch (error) {
            throw new Error(`FaceRepository.getFacesNeedingPoseBackfill failed: ${String(error)}`);
        }
    }

    /**
     * Get the total count of faces needing pose backfill.
     */
    static getPoseBackfillCount(): { needsBackfill: number; total: number } {
        const db = getDB();
        try {
            const needsBackfill = db.prepare(`
                SELECT COUNT(*) as count FROM faces 
                WHERE pose_yaw IS NULL 
                  AND descriptor IS NOT NULL
                  AND (is_ignored = 0 OR is_ignored IS NULL)
                  AND (blur_score IS NULL OR blur_score >= 10)
            `).get() as { count: number };

            const total = db.prepare(`
                SELECT COUNT(*) as count FROM faces 
                WHERE descriptor IS NOT NULL
                  AND (is_ignored = 0 OR is_ignored IS NULL)
                  AND (blur_score IS NULL OR blur_score >= 10)
            `).get() as { count: number };

            return {
                needsBackfill: needsBackfill?.count || 0,
                total: total?.count || 0
            };
        } catch (error) {
            throw new Error(`FaceRepository.getPoseBackfillCount failed: ${String(error)}`);
        }
    }

    /**
     * Get unified face data health statistics for the Face Data Health UI.
     * Returns counts of faces with each data type populated.
     */
    static getFaceDataHealth(): {
        total: number;
        eligibleTotal: number;  // Faces eligible for upgrade (not ignored, not too blurry)
        withAge: number;
        withGender: number;
        withPose: number;
        withDescriptorV2: number;
    } {
        const db = getDB();
        try {
            // Total faces in database
            const total = (db.prepare(`SELECT COUNT(*) as count FROM faces WHERE descriptor IS NOT NULL`).get() as { count: number })?.count || 0;

            // Eligible faces (not ignored, not too blurry) - these are what we upgrade
            const eligibleFilter = `
                descriptor IS NOT NULL
                AND (is_ignored = 0 OR is_ignored IS NULL)
                AND (blur_score IS NULL OR blur_score >= 10)
            `;

            const eligibleTotal = (db.prepare(`
                SELECT COUNT(*) as count FROM faces WHERE ${eligibleFilter}
            `).get() as { count: number })?.count || 0;

            // Eligible faces with age data
            const withAge = (db.prepare(`
                SELECT COUNT(*) as count FROM faces 
                WHERE ${eligibleFilter}
                  AND estimated_age IS NOT NULL AND estimated_age > 0
            `).get() as { count: number })?.count || 0;

            // Eligible faces with gender data
            const withGender = (db.prepare(`
                SELECT COUNT(*) as count FROM faces 
                WHERE ${eligibleFilter}
                  AND gender IS NOT NULL
            `).get() as { count: number })?.count || 0;

            // Eligible faces with pose data
            const withPose = (db.prepare(`
                SELECT COUNT(*) as count FROM faces 
                WHERE ${eligibleFilter}
                  AND pose_yaw IS NOT NULL
            `).get() as { count: number })?.count || 0;

            // Eligible faces with descriptor (embeddings)
            const withDescriptorV2 = (db.prepare(`
                SELECT COUNT(*) as count FROM faces 
                WHERE ${eligibleFilter}
                  AND descriptor IS NOT NULL
            `).get() as { count: number })?.count || 0;

            return {
                total,
                eligibleTotal,
                withAge,
                withGender,
                withPose,
                withDescriptorV2
            };
        } catch (error) {
            throw new Error(`FaceRepository.getFaceDataHealth failed: ${String(error)}`);
        }
    }

    /**
     * Update pose data for a specific face (Phase 5 backfill).
     */
    static updateFacePoseData(
        faceId: number,
        poseData: {
            pose_yaw: number | null;
            pose_pitch: number | null;
            pose_roll: number | null;
            face_quality: number | null;
            descriptor_v2?: Buffer | null;
        }
    ): void {
        const db = getDB();
        try {
            // Use COALESCE to avoid overwriting existing descriptor_v2 with null
            db.prepare(`
                UPDATE faces 
                SET pose_yaw = ?, pose_pitch = ?, pose_roll = ?, face_quality = ?,
                    descriptor_v2 = COALESCE(?, descriptor_v2)
                WHERE id = ?
            `).run(
                poseData.pose_yaw,
                poseData.pose_pitch,
                poseData.pose_roll,
                poseData.face_quality,
                poseData.descriptor_v2 ?? null,
                faceId
            );
        } catch (error) {
            throw new Error(`FaceRepository.updateFacePoseData failed: ${String(error)}`);
        }
    }

    // ============== FACE CONFIRMATION (Centroid Stability Feature) ==============

    /**
     * Mark faces as confirmed (user-verified as correctly assigned).
     * Confirmed faces are excluded from outlier detection.
     */
    static setConfirmed(faceIds: number[], confirmed: boolean): void {
        if (!faceIds || faceIds.length === 0) return;
        const db = getDB();
        const placeholders = faceIds.map(() => '?').join(',');
        db.prepare(`UPDATE faces SET is_confirmed = ? WHERE id IN (${placeholders})`).run(
            confirmed ? 1 : 0,
            ...faceIds
        );
    }

    /**
     * Get all confirmed faces for a person.
     */
    static getConfirmedFaces(personId: number): Array<{
        id: number;
        descriptor: number[] | null;
        box_json: string;
        photo_id: number;
        file_path: string;
        blur_score: number | null;
        pose_yaw: number | null;
        pose_pitch: number | null;
        pose_roll: number | null;
    }> {
        const db = getDB();
        try {
            const rows = db.prepare(`
                SELECT f.id, f.descriptor, f.box_json, f.photo_id, f.blur_score,
                       f.pose_yaw, f.pose_pitch, f.pose_roll, p.file_path
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
                WHERE f.person_id = ?
                  AND f.is_confirmed = 1
                  AND f.descriptor IS NOT NULL
                  AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
            `).all(personId) as Array<{
                id: number;
                descriptor: Buffer | null;
                box_json: string;
                photo_id: number;
                file_path: string;
                blur_score: number | null;
                pose_yaw: number | null;
                pose_pitch: number | null;
                pose_roll: number | null;
            }>;

            return rows.map(r => ({
                id: r.id,
                descriptor: r.descriptor ? Array.from(new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4)) : null,
                box_json: r.box_json,
                photo_id: r.photo_id,
                file_path: r.file_path,
                blur_score: r.blur_score,
                pose_yaw: r.pose_yaw,
                pose_pitch: r.pose_pitch,
                pose_roll: r.pose_roll
            }));
        } catch (error) {
            throw new Error(`FaceRepository.getConfirmedFaces failed: ${String(error)}`);
        }
    }

    /**
     * Unassign faces from a person (remove person_id without ignoring).
     * Used for removing misassigned faces.
     */
    static unassignFaces(faceIds: number[]): void {
        if (!faceIds || faceIds.length === 0) return;
        const db = getDB();
        const placeholders = faceIds.map(() => '?').join(',');
        db.prepare(`UPDATE faces SET person_id = NULL, is_confirmed = 0 WHERE id IN (${placeholders})`).run(
            ...faceIds
        );
    }

    static getAssignedFacesWithDates(personId: number) {
        const db = getDB();
        try {
            const faces = db.prepare(`
                SELECT f.id, f.descriptor, f.estimated_age, f.blur_score, f.face_quality,
                       p.created_at, p.metadata_json 
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
                WHERE f.person_id = ? 
                AND f.descriptor IS NOT NULL
            `).all(personId);

            return faces.map((f: any) => ({
                id: f.id,
                descriptor: Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4)),
                estimated_age: f.estimated_age,
                blur_score: f.blur_score,
                face_quality: f.face_quality,
                created_at: f.created_at,
                metadata_json: f.metadata_json
            }));
        } catch (error) {
            console.error('FaceRepository.getAssignedFacesWithDates failed:', error);
            return [];
        }
    }

    static updateFaceEra(faceId: number, eraId: number) {
        const db = getDB();
        db.prepare('UPDATE faces SET era_id = ? WHERE id = ?').run(eraId, faceId);
    }

    /**
     * [Phase 68] Update face demographics from VLM reasoning.
     */
    static updateFaceDemographics(faceId: number, data: { gender?: string, age?: number }) {
        const db = getDB();
        const updates: string[] = [];
        const params: any[] = [];

        if (data.gender) {
            updates.push('gender = ?');
            params.push(data.gender);
        }
        if (data.age) {
            updates.push('estimated_age = ?');
            params.push(data.age);
        }

        if (updates.length === 0) return;

        params.push(faceId);
        const query = `UPDATE faces SET ${updates.join(', ')} WHERE id = ?`;
        db.prepare(query).run(...params);
    }

    // ============== BACKGROUND BUCKETING (Phase B1) ==============

    /**
     * Set needs_bucketing flag on faces.
     */
    static setNeedsBucketing(faceIds: number[], value: boolean): void {
        if (!faceIds || faceIds.length === 0) return;
        const db = getDB();
        const placeholders = faceIds.map(() => '?').join(',');
        db.prepare(`UPDATE faces SET needs_bucketing = ? WHERE id IN (${placeholders})`).run(
            value ? 1 : 0,
            ...faceIds
        );
    }

    /**
     * Get faces that need bucketing (for background processing).
     */
    static getFacesNeedingBucketing(limit: number, offset: number): Array<{
        id: number;
        descriptor: Buffer | null;
        session_folder: string | null;
        session_date: string | null;
        suggested_person_id: number | null;
        match_distance: number | null;
        entity_type: string;
    }> {
        const db = getDB();
        try {
            return db.prepare(`
                SELECT id, descriptor, session_folder, session_date, suggested_person_id, match_distance, entity_type
                FROM faces
                WHERE needs_bucketing = 1
                  AND person_id IS NULL
                  AND (is_ignored = 0 OR is_ignored IS NULL)
                  AND descriptor IS NOT NULL
                ORDER BY id ASC
                LIMIT ? OFFSET ?
            `).all(limit, offset) as Array<{
                id: number;
                descriptor: Buffer | null;
                session_folder: string | null;
                session_date: string | null;
                suggested_person_id: number | null;
                match_distance: number | null;
                entity_type: string;
            }>;
        } catch (error) {
            throw new Error(`FaceRepository.getFacesNeedingBucketing failed: ${String(error)}`);
        }
    }

    /**
     * Get ignored faces for re-check (Phase B5).
     */
    static getIgnoredFacesForBucketing(limit: number, offset: number): Array<{
        id: number;
        descriptor: Buffer | null;
        entity_type: string;
    }> {
        const db = getDB();
        try {
            return db.prepare(`
                SELECT id, descriptor, entity_type
                FROM faces
                WHERE is_ignored = 1
                  AND descriptor IS NOT NULL
                ORDER BY id ASC
                LIMIT ? OFFSET ?
            `).all(limit, offset) as Array<{
                id: number;
                descriptor: Buffer | null;
                entity_type: string;
            }>;
        } catch (error) {
            throw new Error(`FaceRepository.getIgnoredFaces failed: ${String(error)}`);
        }
    }

    /**
     * Get count of faces needing bucketing.
     */
    static getFacesNeedingBucketingCount(): number {
        const db = getDB();
        const result = db.prepare(`
            SELECT COUNT(*) as count FROM faces
            WHERE needs_bucketing = 1
              AND person_id IS NULL
              AND (is_ignored = 0 OR is_ignored IS NULL)
              AND descriptor IS NOT NULL
        `).get() as { count: number };
        return result?.count || 0;
    }

    /**
     * Assign faces to a bucket.
     */
    static assignToBucket(faceIds: number[], bucketId: number): void {
        if (!faceIds || faceIds.length === 0) return;
        const db = getDB();
        const placeholders = faceIds.map(() => '?').join(',');
        db.prepare(`UPDATE faces SET bucket_id = ?, needs_bucketing = 0 WHERE id IN (${placeholders})`).run(
            bucketId,
            ...faceIds
        );
    }

    /**
     * Get faces in a bucket.
     */
    static getFacesByBucket(bucketId: number): Array<{
        id: number;
        photo_id: number;
        box_json: string;
        file_path: string;
        preview_cache_path: string | null;
        width: number;
        height: number;
    }> {
        const db = getDB();
        return db.prepare(`
            SELECT f.id, f.photo_id, f.box_json, p.file_path, p.preview_cache_path, p.width, p.height
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.bucket_id = ? AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
        `).all(bucketId) as Array<{
            id: number;
            photo_id: number;
            box_json: string;
            file_path: string;
            preview_cache_path: string | null;
            width: number;
            height: number;
        }>;
    }

    /**
     * Cleanup duplicate face records (same photo_id and box_json).
     * Keeps the record with the lowest ID, deletes duplicates.
     * @returns Number of deleted duplicate records
     */
    static cleanupDuplicates(): number {
        const db = getDB();
        try {
            const result = db.prepare(`
                DELETE FROM faces 
                WHERE id NOT IN (
                    SELECT MIN(id) FROM faces GROUP BY photo_id, box_json
                )
            `).run();
            return result.changes;
        } catch (error) {
            console.error('FaceRepository.cleanupDuplicates failed:', error);
            return 0;
        }
    }

    // ===== PHASE 56: VLM VERIFICATION METHODS =====

    /**
     * Get suspect faces that need VLM verification.
     * Returns faces ordered by most recent photos first.
     */
    static getSuspectFaces(limit = 10): Array<{
        id: number;
        photo_id: number;
        box_json: string;
        file_path: string;
        preview_cache_path: string | null;
        verification_attempts: number;
        score: number | null;
        face_quality: number | null;
    }> {
        const db = getDB();
        return db.prepare(`
            SELECT f.id, f.photo_id, f.box_json, f.verification_attempts, f.score, f.face_quality,
                   p.file_path, p.preview_cache_path
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.entity_type = 'suspect'
              AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
            ORDER BY p.created_at DESC
            LIMIT ?
        `).all(limit) as Array<{
            id: number;
            photo_id: number;
            box_json: string;
            file_path: string;
            preview_cache_path: string | null;
            verification_attempts: number;
            score: number | null;
            face_quality: number | null;
        }>;
    }

    /**
     * Count total suspect faces pending verification.
     */
    static countSuspectFaces(): number {
        const db = getDB();
        const result = db.prepare(`
            SELECT COUNT(*) as count 
            FROM faces 
            WHERE entity_type = 'suspect' 
              AND (is_ignored = 0 OR is_ignored IS NULL)
        `).get() as { count: number };
        return result.count;
    }

    /**
     * Update entity_type for a face (e.g., 'suspect' -> 'human').
     */
    static updateFaceEntityType(id: number, entityType: string): void {
        const db = getDB();
        db.prepare(`
            UPDATE faces 
            SET entity_type = ? 
            WHERE id = ?
        `).run(entityType, id);
    }

    /**
     * Mark a face as rejected (is_ignored = 1) after VLM verification failure.
     */
    static markFaceAsRejected(id: number): void {
        const db = getDB();
        db.prepare(`
            UPDATE faces
            SET is_ignored = 1, ignore_source = 'user'
            WHERE id = ?
        `).run(id);
    }

    /**
     * Increment verification_attempts counter and return new count.
     */
    static incrementVerificationAttempts(id: number): number {
        const db = getDB();
        db.prepare(`
            UPDATE faces 
            SET verification_attempts = verification_attempts + 1 
            WHERE id = ?
        `).run(id);

        const result = db.prepare(`
            SELECT verification_attempts 
            FROM faces 
            WHERE id = ?
        `).get(id) as { verification_attempts: number } | undefined;

        return result?.verification_attempts ?? 0;
    }

    /**
     * Mark existing low-confidence faces as 'suspect' for audit.
     * Returns count of updated faces.
     */
    static markLowConfidenceAsSuspect(): number {
        const db = getDB();
        const result = db.prepare(`
            UPDATE faces 
            SET entity_type = 'suspect' 
            WHERE score < 0.45 
              AND (entity_type IS NULL OR entity_type = 'human')
              AND (is_ignored = 0 OR is_ignored IS NULL)
        `).run();

        return result.changes;
    }
}
