import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getDB } from '../../db';
import type { CompoundFilter, FilterCondition } from '../../types/filterTypes';

export interface BlurryPhotoRow {
    id: number;
    file_path: string;
    blur_score: number;
    date_taken: string | null;
    metadata_json: string | null;
    folder: string;
}

export class PhotoRepository {
    /** Ensure custom SQLite functions are registered */
    private static ensureFunctions(db: any) {
        try {
            db.function('DIRNAME', (p: string) => path.dirname(p));
            db.function('EXTNAME', (p: string) => path.extname(p).toLowerCase());
        } catch (_) { /* already registered */ }
    }

    static getPhotos(page = 1, limit = 50, sort = 'date_desc', filter: any = {}, offset?: number) {
        const db = getDB();
        const calculatedOffset = offset !== undefined ? offset : (page - 1) * limit;
        let orderBy = 'date_taken DESC';

        switch (sort) {
            case 'date_asc': orderBy = 'date_taken ASC'; break;
            case 'name_asc': orderBy = 'file_path ASC'; break;
            case 'name_desc': orderBy = 'file_path DESC'; break;
        }

        const params: any[] = [];
        const conditions: string[] = [];

        if (filter.folder) {
            conditions.push('file_path LIKE ?');
            params.push(`${filter.folder}%`);
        }
        if (filter.search) {
            conditions.push('file_path LIKE ?');
            params.push(`%${filter.search}%`);
        }
        if (filter.tag) {
            conditions.push('id IN (SELECT photo_id FROM photo_tags pt JOIN tags t ON pt.tag_id = t.id WHERE t.name = ?)');
            params.push(filter.tag);
        }
        if (filter.people && filter.people.length > 0) {
            const personId = filter.people[0];
            conditions.push('id IN (SELECT photo_id FROM faces WHERE person_id = ?)');
            params.push(personId);
        }
        if (filter.untagged === 'untagged') {
            conditions.push('id IN (SELECT photo_id FROM faces WHERE person_id IS NULL)');
        }

        // --- Extended filters (Phase: Advanced Filtering) ---
        // Photo sharpness (photos.blur_score via Variance of Laplacian): higher = sharper
        if (filter.blurScoreMin !== undefined) {
            conditions.push('blur_score IS NOT NULL AND blur_score >= ?');
            params.push(filter.blurScoreMin);
        }
        if (filter.blurScoreMax !== undefined) {
            conditions.push('blur_score IS NOT NULL AND blur_score <= ?');
            params.push(filter.blurScoreMax);
        }
        if (filter.dateFrom) {
            conditions.push('date_taken >= ?');
            params.push(filter.dateFrom);
        }
        if (filter.dateTo) {
            conditions.push('date_taken <= ?');
            params.push(filter.dateTo);
        }
        if (filter.year !== undefined) {
            conditions.push("strftime('%Y', date_taken) = ?");
            params.push(String(filter.year));
        }
        if (filter.month !== undefined) {
            conditions.push("strftime('%m', date_taken) = ?");
            params.push(String(filter.month).padStart(2, '0'));
        }
        if (filter.camera) {
            conditions.push("json_extract(metadata_json, '$.Model') = ?");
            params.push(filter.camera);
        }
        if (filter.fileType) {
            PhotoRepository.ensureFunctions(db);
            conditions.push('EXTNAME(file_path) = ?');
            params.push(filter.fileType.toLowerCase());
        }
        if (filter.hasFaces === true) {
            conditions.push('id IN (SELECT DISTINCT photo_id FROM faces WHERE is_ignored = 0)');
        } else if (filter.hasFaces === false) {
            conditions.push('id NOT IN (SELECT DISTINCT photo_id FROM faces WHERE is_ignored = 0)');
        }
        if (filter.faceQualityMin !== undefined) {
            conditions.push('id IN (SELECT DISTINCT photo_id FROM faces WHERE face_quality >= ? AND is_ignored = 0)');
            params.push(filter.faceQualityMin);
        }
        if (filter.frontalFacesOnly) {
            conditions.push('id IN (SELECT DISTINCT photo_id FROM faces WHERE ABS(pose_yaw) < 30 AND ABS(pose_pitch) < 30 AND is_ignored = 0)');
        }
        if (filter.unnamedFacesOnly) {
            conditions.push('id IN (SELECT DISTINCT photo_id FROM faces WHERE person_id IS NULL AND is_ignored = 0)');
        }
        if (filter.confidenceTier) {
            conditions.push('id IN (SELECT DISTINCT photo_id FROM faces WHERE confidence_tier = ? AND is_ignored = 0)');
            params.push(filter.confidenceTier);
        }

        let whereClause = '';
        if (conditions.length > 0) {
            whereClause = ' WHERE ' + conditions.join(' AND ');
        }

        try {
            const query = `SELECT * FROM photos${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
            const countQuery = `SELECT COUNT(*) as count FROM photos${whereClause}`;

            const photos = db.prepare(query).all(...params, limit, calculatedOffset);
            const total = db.prepare(countQuery).get(...params).count;

            return { photos, total };
        } catch (e) {
            throw new Error(`PhotoRepository.getPhotos failed: ${String(e)}`);
        }
    }

    static getLibraryStats() {
        const db = getDB();


        try {
            try {
                db.function('DIRNAME', (p: string) => path.dirname(p));
                db.function('EXTNAME', (p: string) => path.extname(p).toLowerCase());
            } catch (e) { /* functions might already exist */ }

            const total = db.prepare('SELECT COUNT(*) as count FROM photos').get().count;

            const fileTypes = db.prepare(`
                SELECT EXTNAME(file_path) as type, COUNT(*) as count 
                FROM photos 
                GROUP BY type 
                ORDER BY count DESC
            `).all();

            const folders = db.prepare(`
                SELECT DISTINCT DIRNAME(file_path) as folder, COUNT(*) as count 
                FROM photos 
                GROUP BY folder 
                ORDER BY count DESC
            `).all();

            return { totalPhotos: total, fileTypes, folders };
        } catch (e) {
            throw new Error(`PhotoRepository.getLibraryStats failed: ${String(e)}`);
        }
    }

    static getUnprocessedPhotos() {
        const db = getDB();
        // Return photos that don't have a blur score, implying they haven't been successfully scanned.
        // Limit to 1000 to avoid overwhelming the queue if it's a huge init.
        return db.prepare('SELECT * FROM photos WHERE blur_score IS NULL LIMIT 1000').all();
    }

    static getBlurryPhotos(options: {
        threshold: number;
        groupBy: 'folder' | 'location' | 'none';
        limit?: number;
        offset?: number;
    }): { photos: BlurryPhotoRow[]; total: number } {
        const db = getDB();
        PhotoRepository.ensureFunctions(db);
        const { threshold, groupBy, limit = 100, offset = 0 } = options;

        const orderBy = groupBy === 'folder'
            ? 'DIRNAME(file_path) ASC, blur_score ASC'
            : groupBy === 'location'
            ? "json_extract(metadata_json, '$.GPSLatitude') ASC, blur_score ASC"
            : 'blur_score ASC';

        try {
            const baseWhere = 'WHERE blur_score IS NOT NULL AND blur_score < ?';
            const rows = db.prepare(`
                SELECT id, file_path, blur_score, date_taken, metadata_json,
                       DIRNAME(file_path) AS folder
                FROM photos
                ${baseWhere}
                ORDER BY ${orderBy}
                LIMIT ? OFFSET ?
            `).all(threshold, limit, offset) as BlurryPhotoRow[];

            const { total } = db.prepare(`SELECT COUNT(*) AS total FROM photos ${baseWhere}`)
                .get(threshold) as { total: number };

            return { photos: rows, total };
        } catch (e) {
            throw new Error(`PhotoRepository.getBlurryPhotos failed: ${String(e)}`);
        }
    }

    static getFolders() {
        const db = getDB();
        const rows = db.prepare('SELECT DISTINCT file_path FROM photos').all();
        const folders = new Set(rows.map((r: any) => path.dirname(r.file_path)));
        return Array.from(folders).sort().map(f => ({ folder: f }));
    }

    static getPhotoById(id: number) {
        const db = getDB();
        return db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
    }

    static updatePhoto(id: number, updates: { description?: string; blur_score?: number; phash?: string }) {
        const db = getDB();
        const sets: string[] = [];
        const params: any[] = [];

        if (updates.description !== undefined) {
            sets.push('description = ?');
            params.push(updates.description);
        }
        if (updates.blur_score !== undefined) {
            sets.push('blur_score = ?');
            params.push(updates.blur_score);
        }
        if (updates.phash !== undefined) {
            sets.push('phash = ?');
            params.push(updates.phash);
        }

        if (sets.length > 0) {
            params.push(id);
            db.prepare(`UPDATE photos SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        }
    }

    static getPhotosNeedingSha256(limit: number): { id: number; file_path: string }[] {
        return getDB().prepare(
            'SELECT id, file_path FROM photos WHERE sha256_hash IS NULL LIMIT ?'
        ).all(limit) as { id: number; file_path: string }[];
    }

    static getPhotosNeedingPhash(limit: number): { id: number; file_path: string; preview_cache_path: string | null }[] {
        return getDB().prepare(
            'SELECT id, file_path, preview_cache_path FROM photos WHERE phash IS NULL LIMIT ?'
        ).all(limit) as { id: number; file_path: string; preview_cache_path: string | null }[];
    }

    static countPhotosNeedingHash(): { needsSha256: number; needsPhash: number } {
        const db = getDB();
        const sha256Row = db.prepare('SELECT COUNT(*) as c FROM photos WHERE sha256_hash IS NULL').get() as { c: number };
        const phashRow  = db.prepare('SELECT COUNT(*) as c FROM photos WHERE phash IS NULL').get()  as { c: number };
        return { needsSha256: sha256Row.c, needsPhash: phashRow.c };
    }

    static updatePhotoSha256(id: number, hash: string): void {
        getDB().prepare('UPDATE photos SET sha256_hash = ? WHERE id = ?').run(hash, id);
    }

    static updatePhotoPhash(id: number, hash: string): void {
        getDB().prepare('UPDATE photos SET phash = ? WHERE id = ?').run(hash, id);
    }

    static getPhotosWithPhash(): { id: number; phash: string }[] {
        return getDB().prepare(
            'SELECT id, phash FROM photos WHERE phash IS NOT NULL'
        ).all() as { id: number; phash: string }[];
    }

    static findExactDuplicateGroups(): { sha256_hash: string; photo_ids: string }[] {
        return getDB().prepare(`
            SELECT sha256_hash, GROUP_CONCAT(id) AS photo_ids
            FROM photos
            WHERE sha256_hash IS NOT NULL
            GROUP BY sha256_hash
            HAVING COUNT(*) > 1
        `).all() as { sha256_hash: string; photo_ids: string }[];
    }

    static getPhotosByGroupId(groupId: number) {
        return getDB().prepare(
            'SELECT * FROM photos WHERE duplicate_group_id = ?'
        ).all(groupId);
    }

    static setDuplicateGroup(photoIds: number[], groupId: number | null) {
        const db = getDB();
        const stmt = db.prepare('UPDATE photos SET duplicate_group_id = ? WHERE id = ?');
        const tx = db.transaction(() => {
            for (const id of photoIds) stmt.run(groupId, id);
        });
        tx();
    }

    static getMetricsHistory(limit = 1000) {
        const db = getDB();
        try {
            const history = db.prepare('SELECT * FROM scan_history ORDER BY timestamp DESC LIMIT ?').all(limit);

            const stats = db.prepare(`
                SELECT 
                    COUNT(*) as total_scans,
                    SUM(CASE WHEN face_count > 0 THEN 1 ELSE 0 END) as face_scans,
                    SUM(COALESCE(scan_ms, 0) + COALESCE(tag_ms, 0)) as total_processing_time,
                    SUM(COALESCE(face_count, 0)) as total_faces
                FROM scan_history
                WHERE status = 'success'
            `).get() as any;

            // Count items in the last hour
            const oneHourAgo = Date.now() - 3600000;
            const recent = db.prepare('SELECT COUNT(*) as count FROM scan_history WHERE timestamp > ?').get(oneHourAgo) as any;

            // Ensure we return 0s instead of nulls
            const aggregated = {
                total_scans: stats?.total_scans || 0,
                face_scans: stats?.face_scans || 0,
                total_processing_time: stats?.total_processing_time || 0,
                total_faces: stats?.total_faces || 0,
                last_hour_scans: recent?.count || 0
            };

            return { success: true, history, stats: aggregated };
        } catch (e) {
            console.error('getMetricsHistory error:', e);
            throw new Error(`PhotoRepository.getMetricsHistory failed: ${String(e)}`);
        }
    }
    static recordScanHistory(data: {
        photoId: number,
        filePath: string,
        scanMs: number,
        tagMs?: number,
        faceCount: number,
        scanMode: string,
        status: string,
        error?: string
    }) {
        const db = getDB();
        try {
            console.log(`[PhotoRepository] Recording history: Photo=${data.photoId} Status=${data.status} Scan=${data.scanMs}ms`);
            db.prepare(`
                INSERT INTO scan_history (photo_id, file_path, scan_ms, tag_ms, face_count, scan_mode, status, error, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                data.photoId,
                data.filePath,
                data.scanMs,
                data.tagMs || 0,
                data.faceCount,
                data.scanMode,
                data.status,
                data.error || null,
                Date.now()
            );
        } catch (e) {
            console.error('Failed to record scan history:', e);
        }
    }

    static getScanErrors() {
        const db = getDB();
        return db.prepare('SELECT * FROM scan_errors ORDER BY timestamp DESC').all();
    }

    static async deleteScanErrorAndFile(id: number, deleteFile: boolean) {
        const db = getDB();


        try {
            const errorRecord = db.prepare('SELECT file_path FROM scan_errors WHERE id = ?').get(id) as { file_path: string };

            if (deleteFile && errorRecord && errorRecord.file_path) {
                try {
                    await fs.unlink(errorRecord.file_path);
                } catch (err) {
                    console.error('Failed to delete file:', err);
                }
                // Also delete from photos table if exists
                db.prepare('DELETE FROM photos WHERE file_path = ?').run(errorRecord.file_path);
            }

            db.prepare('DELETE FROM scan_errors WHERE id = ?').run(id);
            return { success: true };
        } catch (e) {
            return { success: false, error: String(e) };
        }
    }

    static retryScanErrors() {
        const db = getDB();
        // Return photo objects that the frontend can queue for AI processing.
        // JOIN on photos table to get the photo ID needed by addToQueue().
        // Errors without a matching photo (orphaned) are skipped.
        const photos = db.prepare(`
            SELECT DISTINCT p.id, p.file_path
            FROM scan_errors se
            JOIN photos p ON se.photo_id = p.id
        `).all() as { id: number; file_path: string }[];
        return photos;
    }

    static deletePhotoById(id: number): void {
        getDB().prepare('DELETE FROM photos WHERE id = ?').run(id);
    }

    static markUnrepairable(id: number, reason: string): void {
        getDB()
            .prepare('UPDATE scan_errors SET is_unrepairable = 1, error_message = ? WHERE id = ?')
            .run(`Repair attempted but verification failed: ${reason}`, id);
    }

    static clearScanErrors() {
        const db = getDB();
        db.prepare('DELETE FROM scan_errors').run();
    }

    static getFilePaths(ids: number[]) {
        if (ids.length === 0) return [];
        const db = getDB();
        const placeholders = ids.map(() => '?').join(',');
        const rows = db.prepare(`SELECT file_path FROM photos WHERE id IN (${placeholders})`).all(...ids) as { file_path: string }[];
        return rows.map(r => r.file_path);
    }

    static getPhotosForTargetedScan(options: { folderPath?: string, onlyWithFaces?: boolean }) {
        const db = getDB();
        const params: any[] = [];
        const conditions: string[] = [];

        if (options.folderPath) {
            conditions.push('file_path LIKE ?');
            params.push(`${options.folderPath}%`);
        }

        if (options.onlyWithFaces) {
            conditions.push('id IN (SELECT DISTINCT photo_id FROM faces)');
        }

        let whereClause = '';
        if (conditions.length > 0) {
            whereClause = ' WHERE ' + conditions.join(' AND ');
        }

        try {
            const query = `SELECT id FROM photos${whereClause}`;
            const rows = db.prepare(query).all(...params) as { id: number }[];
            return rows; // Return objects { id: number }
        } catch (e) {
            console.error('getPhotosForTargetedScan Error:', e);
            return [];
        }
    }

    static getPhotosForRescan(options: any) {
        // Reuse getPhotos logic but simplified
        return this.getPhotos(1, 100000, 'date_desc', options.filter || {}, 0).photos.map((p: any) => p.id);
    }

    static getAllTags() {
        const db = getDB();
        return db.prepare('SELECT * FROM tags ORDER BY name ASC').all();
    }

    static getTagsForPhoto(photoId: number) {
        const db = getDB();
        const rows = db.prepare(`
            SELECT t.name 
            FROM tags t
            JOIN photo_tags pt ON t.id = pt.tag_id
            WHERE pt.photo_id = ?
        `).all(photoId);
        return rows.map((r: any) => r.name);
    }

    static removeTag(photoId: number, tagName: string) {
        const db = getDB();
        const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as { id: number };
        if (tag) {
            db.prepare('DELETE FROM photo_tags WHERE photo_id = ? AND tag_id = ?').run(photoId, tag.id);
        }
    }

    static addTags(photoId: number, tags: string[]) {
        const db = getDB();
        const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
        const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?');
        const linkTag = db.prepare('INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, source) VALUES (?, ?, ?)');

        const transaction = db.transaction(() => {
            for (const tag of tags) {
                const lower = tag.toLowerCase();
                insertTag.run(lower);
                const tagId = getTagId.get(lower) as { id: number };
                if (tagId) linkTag.run(photoId, tagId.id, 'auto');
            }
        });
        transaction();
    }

    static cleanupTags() {
        console.log('[PhotoRepository] Starting cleanupTags...');
        const db = getDB();
        let deletedCount = 0;
        let mergedCount = 0;

        const transaction = db.transaction(() => {
            // 1. Get all tags
            const allTags = db.prepare('SELECT id, name FROM tags').all() as { id: number, name: string }[];

            const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
            const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?');
            const linkTag = db.prepare('INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, source) VALUES (?, ?, ?)');
            const getPhotoIds = db.prepare('SELECT photo_id FROM photo_tags WHERE tag_id = ?');
            const deleteTag = db.prepare('DELETE FROM tags WHERE id = ?');
            const deleteLink = db.prepare('DELETE FROM photo_tags WHERE tag_id = ?');

            for (const tag of allTags) {
                // Normalize: lowercase, remove punctuation (keep alphanumeric), split by spaces
                // Regex: remove anything that is NOT letter, number or space
                // Then split by space > filter empty
                const cleanName = tag.name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
                const parts = cleanName.split(/\s+/).filter(p => p.length > 0);

                // Conditions to change:
                // 1. Name changed (case, punctuation)
                // 2. Split into multiple
                // 3. Merging with existing (e.g. "Cat" -> "cat" exists)

                const needsUpdate = tag.name !== cleanName || parts.length > 1;

                if (needsUpdate) {
                    const photoIds = getPhotoIds.all(tag.id) as { photo_id: number }[];

                    if (photoIds.length > 0) {
                        for (const part of parts) {
                            // Ensure new tag exists
                            insertTag.run(part);
                            const newTagId = getTagId.get(part) as { id: number };

                            // Relink photos
                            for (const p of photoIds) {
                                linkTag.run(p.photo_id, newTagId.id, 'auto');
                            }
                        }
                        mergedCount += photoIds.length;
                    }

                    // Delete old tag (cascade should handle links, but we can be explicit)
                    deleteLink.run(tag.id);
                    deleteTag.run(tag.id);
                    deletedCount++;
                }
            }

            // Final sweep: delete any tags with no photos
            const finalSweep = db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM photo_tags)').run();
            deletedCount += finalSweep.changes;
        });

        try {
            transaction();
            return { success: true, deletedCount, mergedCount };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }
    static clearAITags() {
        const db = getDB();
        try {
            const transaction = db.transaction(() => {
                db.prepare("DELETE FROM photo_tags WHERE source = 'auto'").run();
                // Clean up orphan tags
                db.prepare("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM photo_tags)").run();
            });
            transaction();
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    static factoryReset() {
        const db = getDB();
        try {
            const transaction = db.transaction(() => {
                db.prepare('DELETE FROM photo_tags').run();
                db.prepare('DELETE FROM faces').run();
                db.prepare('DELETE FROM people').run();
                db.prepare('DELETE FROM tags').run();
                db.prepare('DELETE FROM scan_errors').run();
                db.prepare('DELETE FROM scan_history').run();
                db.prepare('DELETE FROM photos').run();
            });
            transaction();
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    // --- Metadata queries for filter dropdowns ---

    static getCameraModels(): string[] {
        const db = getDB();
        try {
            const rows = db.prepare(`
                SELECT DISTINCT json_extract(metadata_json, '$.Model') as model
                FROM photos
                WHERE metadata_json IS NOT NULL
                  AND json_extract(metadata_json, '$.Model') IS NOT NULL
                ORDER BY model ASC
            `).all() as { model: string }[];
            return rows.map(r => r.model).filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    static getYears(): number[] {
        const db = getDB();
        try {
            const rows = db.prepare(`
                SELECT DISTINCT CAST(strftime('%Y', date_taken) AS INTEGER) as year
                FROM photos
                WHERE date_taken IS NOT NULL
                ORDER BY year DESC
            `).all() as { year: number }[];
            return rows.map(r => r.year).filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    static getFileTypes(): string[] {
        const db = getDB();
        PhotoRepository.ensureFunctions(db);
        try {
            const rows = db.prepare(`
                SELECT DISTINCT EXTNAME(file_path) as ext
                FROM photos
                ORDER BY ext ASC
            `).all() as { ext: string }[];
            return rows.map(r => r.ext).filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    // --- Compound filter search ---

    static getPhotosByCompoundFilter(
        filter: CompoundFilter,
        page = 1,
        limit = 50,
        sort = 'date_desc',
        offset?: number
    ) {
        const db = getDB();
        PhotoRepository.ensureFunctions(db);
        const calculatedOffset = offset !== undefined ? offset : (page - 1) * limit;
        let orderBy = 'date_taken DESC';
        switch (sort) {
            case 'date_asc': orderBy = 'date_taken ASC'; break;
            case 'name_asc': orderBy = 'file_path ASC'; break;
            case 'name_desc': orderBy = 'file_path DESC'; break;
        }

        const params: any[] = [];
        const groupSqls: string[] = [];

        for (const group of filter.groups) {
            const condSqls: string[] = [];
            for (const cond of group.conditions) {
                const { sql, condParams } = PhotoRepository.buildConditionSQL(cond);
                if (sql) {
                    condSqls.push(cond.exclude ? `NOT (${sql})` : sql);
                    params.push(...condParams);
                }
            }
            if (condSqls.length > 0) {
                groupSqls.push(`(${condSqls.join(` ${group.logic} `)})`);
            }
        }

        let whereClause = '';
        if (groupSqls.length > 0) {
            whereClause = ' WHERE ' + groupSqls.join(` ${filter.logic} `);
        }

        try {
            const query = `SELECT * FROM photos${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
            const countQuery = `SELECT COUNT(*) as count FROM photos${whereClause}`;
            const photos = db.prepare(query).all(...params, limit, calculatedOffset);
            const total = (db.prepare(countQuery).get(...params) as { count: number }).count;
            return { photos, total };
        } catch (e) {
            throw new Error(`PhotoRepository.getPhotosByCompoundFilter failed: ${String(e)}`);
        }
    }

    /** Build SQL fragment for a single filter condition */
    private static buildConditionSQL(cond: FilterCondition): { sql: string; condParams: any[] } {
        const p: any[] = [];
        let sql = '';

        switch (cond.field) {
            case 'blur_score':
                sql = PhotoRepository.numericCondition('blur_score', cond.operator, cond.value, p);
                break;
            case 'created_at':
            case 'date_taken':
                if (cond.operator === 'between' && Array.isArray(cond.value)) {
                    sql = 'date_taken >= ? AND date_taken <= ?';
                    p.push(cond.value[0], cond.value[1]);
                } else {
                    sql = PhotoRepository.numericCondition('date_taken', cond.operator, cond.value, p);
                }
                break;
            case 'year':
                sql = "strftime('%Y', date_taken) = ?";
                p.push(String(cond.value));
                break;
            case 'camera':
                sql = "json_extract(metadata_json, '$.Model') = ?";
                p.push(cond.value);
                break;
            case 'file_type':
                sql = 'EXTNAME(file_path) = ?';
                p.push(String(cond.value).toLowerCase());
                break;
            case 'folder':
                sql = 'file_path LIKE ?';
                p.push(`${cond.value}%`);
                break;
            case 'search':
                sql = 'file_path LIKE ?';
                p.push(`%${cond.value}%`);
                break;
            case 'tag':
                sql = 'id IN (SELECT photo_id FROM photo_tags pt JOIN tags t ON pt.tag_id = t.id WHERE t.name = ?)';
                p.push(cond.value);
                break;
            case 'person':
                sql = 'id IN (SELECT photo_id FROM faces WHERE person_id = ?)';
                p.push(cond.value);
                break;
            case 'has_faces':
                sql = cond.value
                    ? 'id IN (SELECT DISTINCT photo_id FROM faces WHERE is_ignored = 0)'
                    : 'id NOT IN (SELECT DISTINCT photo_id FROM faces WHERE is_ignored = 0)';
                break;
            case 'face_quality':
                sql = 'id IN (SELECT DISTINCT photo_id FROM faces WHERE face_quality >= ? AND is_ignored = 0)';
                p.push(cond.value);
                break;
            case 'frontal_faces':
                sql = 'id IN (SELECT DISTINCT photo_id FROM faces WHERE ABS(pose_yaw) < 30 AND ABS(pose_pitch) < 30 AND is_ignored = 0)';
                break;
            case 'unnamed_faces':
                sql = 'id IN (SELECT DISTINCT photo_id FROM faces WHERE person_id IS NULL AND is_ignored = 0)';
                break;
            case 'confidence_tier':
                sql = 'id IN (SELECT DISTINCT photo_id FROM faces WHERE confidence_tier = ? AND is_ignored = 0)';
                p.push(cond.value);
                break;
            default:
                break;
        }
        return { sql, condParams: p };
    }

    /** Build a numeric comparison SQL fragment */
    private static numericCondition(column: string, op: string, value: any, params: any[]): string {
        const ops: Record<string, string> = {
            eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<='
        };
        const sqlOp = ops[op] || '=';
        params.push(value);
        return `${column} ${sqlOp} ?`;
    }
}
