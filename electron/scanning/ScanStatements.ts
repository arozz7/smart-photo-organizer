import type Database from 'better-sqlite3';
import type { FileIdentity } from './fileIdentity';

/** A row from `photos` (SELECT *). Only the columns the scanner relies on are named. */
export interface PhotoRow {
    id: number;
    file_path: string;
    preview_cache_path: string | null;
    metadata_json: string | null;
    width: number | null;
    height: number | null;
    sha256_hash: string | null;
    file_size: number | null;
    file_mtime: number | null;
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
    file_size: number | null;
    file_mtime: number | null;
    file_id: string | null;
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
    private readonly setIdentity: Database.Statement;
    private readonly setContentChanged: Database.Statement;
    private readonly recordNew: (photo: NewPhoto, previewError: string | null) => void;

    constructor(db: Database.Database) {
        this.selectByPath = db.prepare('SELECT * FROM photos WHERE file_path = ?');
        this.insertPhoto = db.prepare(`
            INSERT INTO photos (file_path, preview_cache_path, created_at, date_taken, metadata_json, width, height, sha256_hash,
                                file_size, file_mtime, file_id)
            VALUES (@file_path, @preview_cache_path, @created_at, @date_taken, @metadata_json, @width, @height, @sha256_hash,
                    @file_size, @file_mtime, @file_id)
            ON CONFLICT(file_path) DO NOTHING
        `);
        this.setPreview = db.prepare('UPDATE photos SET preview_cache_path = ? WHERE id = ?');
        this.deleteErrors = db.prepare('DELETE FROM scan_errors WHERE photo_id = ?');
        this.insertError = db.prepare('INSERT INTO scan_errors (photo_id, file_path, error_message, stage) VALUES (?, ?, ?, ?)');
        this.setMetadata = db.prepare('UPDATE photos SET metadata_json = ?, width = ?, height = ? WHERE id = ?');
        this.setIdentity = db.prepare('UPDATE photos SET file_size = ?, file_mtime = ?, file_id = ? WHERE id = ?');
        // The stored hashes describe the OLD content: replace the SHA-256 and clear the perceptual hash so the
        // background duplicate checker recomputes it from the new file.
        this.setContentChanged = db.prepare('UPDATE photos SET sha256_hash = ?, phash = NULL, file_size = ?, file_mtime = ?, file_id = ? WHERE id = ?');

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

    /** Records the file's size / modified time / file id (first time, or after a harmless timestamp change). */
    updateIdentity(photoId: number, identity: FileIdentity): void {
        this.setIdentity.run(identity.size, identity.mtime, identity.fileId, photoId);
    }

    /** The file's content changed: store the new hash and identity, and clear the now-stale perceptual hash. */
    recordContentChange(photoId: number, sha256: string | null, identity: FileIdentity): void {
        this.setContentChanged.run(sha256, identity.size, identity.mtime, identity.fileId, photoId);
    }
}
