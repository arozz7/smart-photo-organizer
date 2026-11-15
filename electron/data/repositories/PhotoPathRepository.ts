import { getDB } from '../../db';
import type { StoredPhoto } from '../../core/services/sendTo/PhotoPathSource';

/** SQLite's classic limit on bound parameters is 999, so large id lists are queried in chunks. */
const IDS_PER_QUERY = 500;

/** Read-only lookup of the stored file path of photos. */
export class PhotoPathRepository {
    /** Rows for the ids that exist, returned in the order of `ids`. Unknown ids are left out. */
    static getByIds(ids: readonly number[]): StoredPhoto[] {
        const db = getDB();
        const byId = new Map<number, StoredPhoto>();

        for (let start = 0; start < ids.length; start += IDS_PER_QUERY) {
            const chunk = ids.slice(start, start + IDS_PER_QUERY);
            const placeholders = chunk.map(() => '?').join(',');
            const rows = db
                .prepare(`SELECT id, file_path, missing_since FROM photos WHERE id IN (${placeholders})`)
                .all(...chunk) as StoredPhoto[];
            rows.forEach(row => byId.set(row.id, row));
        }

        return ids.flatMap(id => byId.get(id) ?? []);
    }
}
