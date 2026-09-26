import type Database from 'better-sqlite3';

/** A row from `photos` (SELECT *). Only the columns the scanner relies on are named. */
export interface PhotoRow {
    id: number;
    file_path: string;
    preview_cache_path: string | null;
    metadata_json: string | null;
    width: number | null;
    height: number | null;
    [column: string]: unknown;
}

export interface NewPhoto {
    file_path: string;
    preview_cache_path: string | null;
    created_at: string;
    date_taken: string;
    metadata_json: string;
    width: number | null;
    height: number | null;
    sha256_hash: string | null;
}

/**
 * The scanner's SQL, prepared ONCE per scan instead of once per file.
 * All parameters are bound (no string interpolation).
 */
export class ScanStatements {
    private readonly selectByPath: Database.Statement;
    private readonly insertPhoto: Database.Statement;
    private readonly setPreview: Database.Statement;
    private readonly deleteErrors: Database.Statement;
    private readonly insertError: Database.Statement;
    private readonly setMetadata: Database.Statement;
    private readonly recordNew: (photo: NewPhoto, previewError: string | null) => void;

    constructor(db: Database.Database) {
        this.selectByPath = db.prepare('SELECT * FROM photos WHERE file_path = ?');
        this.insertPhoto = db.prepare(`
            INSERT INTO photos (file_path, preview_cache_path, created_at, date_taken, metadata_json, width, height, sha256_hash)
            VALUES (@file_path, @preview_cache_path, @created_at, @date_taken, @metadata_json, @width, @height, @sha256_hash)
            ON CONFLICT(file_path) DO NOTHING
        `);
        this.setPreview = db.prepare('UPDATE photos SET preview_cache_path = ? WHERE id = ?');
        this.deleteErrors = db.prepare('DELETE FROM scan_errors WHERE photo_id = ?');
        this.insertError = db.prepare('INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, ?, ?, ?)');
        this.setMetadata = db.prepare('UPDATE photos SET metadata_json = ?, width = ?, height = ? WHERE id = ?');

        // One transaction (one commit) per new photo instead of one per statement.
        this.recordNew = db.transaction((photo: NewPhoto, previewError: string | null) => {
            const info = this.insertPhoto.run(photo);
            if (previewError !== null) {
                const id = info.changes > 0 ? Number(info.lastInsertRowid) : this.findByPath(photo.file_path)?.id ?? null;
                this.insertError.run(id, photo.file_path, previewError, 'Initial Scan');
            }
        });
    }

    findByPath(filePath: string): PhotoRow | undefined {
        return this.selectByPath.get(filePath) as PhotoRow | undefined;
    }

    /** Inserts a new photo (with its hash) and, if preview generation failed, records that error too. */
    addNewPhoto(photo: NewPhoto, previewError: string | null): void {
        this.recordNew(photo, previewError);
    }

    updatePreview(photoId: number, previewPath: string): void {
        this.setPreview.run(previewPath, photoId);
    }

    clearErrors(photoId: number): void {
        this.deleteErrors.run(photoId);
    }

    addError(photoId: number, filePath: string, message: string, stage: string): void {
        this.insertError.run(photoId, filePath, message, stage);
    }

    updateMetadata(photoId: number, metadataJson: string, width: number | null, height: number | null): void {
        this.setMetadata.run(metadataJson, width, height, photoId);
    }
}
