import { getDB } from '../../db';
import type { FileIdentity } from '../../scanning/fileIdentity';

export interface PhotoNeedingIdentity {
    id: number;
    file_path: string;
}

/**
 * Database access for each photo's file identity (size, modified time, file id).
 * DB only: reading the file system belongs to PhotoIdentityService.
 */
export class PhotoIdentityRepository {
    static setIdentity(photoId: number, identity: FileIdentity): void {
        getDB()
            .prepare('UPDATE photos SET file_size = ?, file_mtime = ?, file_id = ? WHERE id = ?')
            .run(identity.size, identity.mtime, identity.fileId, photoId);
    }

    /**
     * Photos with no recorded identity, in id order after `afterId`. A cursor (not OFFSET) so files that cannot be
     * read are passed over once instead of being retried forever. Photos already known to be missing are skipped.
     */
    static getPhotosNeedingIdentity(afterId: number, limit: number): PhotoNeedingIdentity[] {
        return getDB()
            .prepare(
                `SELECT id, file_path FROM photos
                 WHERE file_size IS NULL AND missing_since IS NULL AND id > ?
                 ORDER BY id LIMIT ?`,
            )
            .all(afterId, limit) as PhotoNeedingIdentity[];
    }

    static countPhotosNeedingIdentity(): number {
        const row = getDB()
            .prepare('SELECT COUNT(*) AS c FROM photos WHERE file_size IS NULL AND missing_since IS NULL')
            .get() as { c: number };
        return row.c;
    }

    /** Saves many identities in one transaction (one commit instead of hundreds). */
    static setIdentityBatch(entries: { id: number; identity: FileIdentity }[]): void {
        const db = getDB();
        const update = db.prepare('UPDATE photos SET file_size = ?, file_mtime = ?, file_id = ? WHERE id = ?');
        db.transaction(() => {
            for (const { id, identity } of entries) update.run(identity.size, identity.mtime, identity.fileId, id);
        })();
    }

    /**
     * The app itself rewrote the file (e.g. rotation): record the new identity so the next scan does not mistake
     * it for an outside edit, and clear the hashes, which describe the old bytes, so they are recomputed.
     */
    static markContentRewritten(photoId: number, identity: FileIdentity): void {
        getDB()
            .prepare('UPDATE photos SET sha256_hash = NULL, phash = NULL, file_size = ?, file_mtime = ?, file_id = ? WHERE id = ?')
            .run(identity.size, identity.mtime, identity.fileId, photoId);
    }
}
