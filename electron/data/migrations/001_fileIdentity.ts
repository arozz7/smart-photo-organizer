import { addColumnIfMissing } from './helpers';
import type { Migration } from './types';

/**
 * File identity for each photo, so the app can tell "the same file" apart from "a file at the same path":
 *  - file_size / file_mtime: detect that a file was edited outside the app (Phase 130)
 *  - file_id: the filesystem's file index (NTFS file index on Windows), survives rename/move on the same
 *    volume (used to re-link moved files in Phase 131)
 *  - missing_since: when the file was last found missing (Phase 131)
 *
 * All columns are nullable: NULL means "not recorded yet" and is filled in lazily (at scan time and by a
 * background backfill), never at startup.
 */
export const fileIdentityMigration: Migration = {
    version: 1,
    name: 'file_identity',
    up(db) {
        addColumnIfMissing(db, 'photos', 'file_size', 'INTEGER');
        addColumnIfMissing(db, 'photos', 'file_mtime', 'INTEGER');
        addColumnIfMissing(db, 'photos', 'file_id', 'TEXT');
        addColumnIfMissing(db, 'photos', 'missing_since', 'DATETIME');
        db.exec('CREATE INDEX IF NOT EXISTS idx_photos_file_id ON photos(file_id)');
    },
};
