import { getDB } from '../../db';
import { IMetadataRepository } from './interfaces';
import logger from '../../logger';

export class SqliteMetadataRepository implements IMetadataRepository {

    async getImageMetadata(filePath: string): Promise<{ orientation: number }> {
        let orientation = 1;
        try {
            const db = getDB();
            const row = db.prepare('SELECT metadata_json FROM photos WHERE file_path = ?').get(filePath) as { metadata_json: string };
            if (row && row.metadata_json) {
                const meta = JSON.parse(row.metadata_json);
                if (meta.Orientation) orientation = parseInt(meta.Orientation);
                else if (meta.ExifImageOrientation) orientation = parseInt(meta.ExifImageOrientation);
            }
        } catch (dbErr) {
            // logger.warn(`[MetadataRepository] Failed to get metadata for ${filePath}`, dbErr);
        }
        return { orientation };
    }

    async getPreviewPath(filePath: string): Promise<string | null> {
        try {
            const db = getDB();
            const row = db.prepare('SELECT preview_cache_path FROM photos WHERE file_path = ?').get(filePath) as { preview_cache_path: string };
            if (row && row.preview_cache_path) {
                return row.preview_cache_path;
            }
        } catch (err) {
            // ignore
        }
        return null;
    }

    async getFilePathFromPreview(previewPathSubstr: string): Promise<string | null> {
        try {
            const db = getDB();
            // Expecting previewPathSubstr to be the hash from the filename (e.g. "abc12345")
            // The Original Query: 'SELECT file_path FROM photos WHERE preview_cache_path LIKE ?'
            // We'll wrap with % here or expect caller to pass it? 
            // The caller in imageProtocol passed `%${match[1]}%`.
            // Let's make this method accept the exact match string for flexibilty
            const row = db.prepare('SELECT file_path FROM photos WHERE preview_cache_path LIKE ?').get(`%${previewPathSubstr}%`) as { file_path: string };
            if (row && row.file_path) {
                return row.file_path;
            }
        } catch (err) {
            // ignore
        }
        return null;
    }

    async getPhotoId(filePath: string): Promise<number | null> {
        try {
            const db = getDB();
            const row = db.prepare('SELECT id FROM photos WHERE file_path = ?').get(filePath) as { id: number };
            return row ? row.id : null;
        } catch (err) {
            return null;
        }
    }

    async clearPreviewPath(filePath: string): Promise<void> {
        try {
            const db = getDB();
            db.prepare('UPDATE photos SET preview_cache_path = NULL WHERE file_path = ?').run(filePath);
        } catch (err) {
            logger.warn(`[MetadataRepository] Failed to clear preview path for ${filePath}`, err);
        }
    }

    async logError(photoId: number, filePath: string, errorMessage: string, stage: string): Promise<void> {
        try {
            const db = getDB();
            db.prepare('INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, ?, ?, ?)').run(photoId, filePath, errorMessage, stage);
        } catch (dbErr) {
            logger.error("[MetadataRepository] Failed to log error to DB", dbErr);
        }
    }
}
