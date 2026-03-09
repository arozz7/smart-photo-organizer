import { getDB } from '../../db';

export type DuplicateGroupType = 'exact' | 'near';
export type DuplicateGroupStatus = 'pending' | 'resolved' | 'dismissed';

export interface DuplicateGroup {
    id: number;
    type: DuplicateGroupType;
    status: DuplicateGroupStatus;
    winner_photo_id: number | null;
    created_at: string;
}

export interface DuplicateGroupWithPhotos extends DuplicateGroup {
    photos: any[];
}

export class DuplicateGroupRepository {
    static createGroup(type: DuplicateGroupType): number {
        const db = getDB();
        const result = db.prepare(
            `INSERT INTO duplicate_groups (type, status) VALUES (?, 'pending')`
        ).run(type);
        return result.lastInsertRowid as number;
    }

    static getGroupById(id: number): DuplicateGroup | undefined {
        return getDB().prepare(
            'SELECT * FROM duplicate_groups WHERE id = ?'
        ).get(id) as DuplicateGroup | undefined;
    }

    static getPendingGroups(): DuplicateGroup[] {
        return getDB().prepare(
            `SELECT * FROM duplicate_groups WHERE status = 'pending' ORDER BY created_at DESC`
        ).all() as DuplicateGroup[];
    }

    static getGroupsWithPhotos(
        status: DuplicateGroupStatus = 'pending',
        limit = 50,
        offset = 0
    ): DuplicateGroupWithPhotos[] {
        const db = getDB();
        const groups = db.prepare(`
            SELECT * FROM duplicate_groups
            WHERE status = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(status, limit, offset) as DuplicateGroup[];

        return groups.map(g => ({
            ...g,
            photos: db.prepare(
                'SELECT * FROM photos WHERE duplicate_group_id = ? ORDER BY date_taken ASC'
            ).all(g.id)
        }));
    }

    static getStats(): { pending_exact: number; pending_near: number; resolved: number; dismissed: number } {
        const db = getDB();
        const rows = db.prepare(`
            SELECT type, status, COUNT(*) as cnt
            FROM duplicate_groups
            GROUP BY type, status
        `).all() as { type: string; status: string; cnt: number }[];

        const result = { pending_exact: 0, pending_near: 0, resolved: 0, dismissed: 0 };
        for (const row of rows) {
            if (row.status === 'pending' && row.type === 'exact') result.pending_exact += row.cnt;
            if (row.status === 'pending' && row.type === 'near') result.pending_near += row.cnt;
            if (row.status === 'resolved') result.resolved += row.cnt;
            if (row.status === 'dismissed') result.dismissed += row.cnt;
        }
        return result;
    }

    static resolveGroup(groupId: number, winnerPhotoId: number) {
        const db = getDB();
        db.prepare(
            `UPDATE duplicate_groups SET status = 'resolved', winner_photo_id = ? WHERE id = ?`
        ).run(winnerPhotoId, groupId);
    }

    static dismissGroup(groupId: number) {
        getDB().prepare(
            `UPDATE duplicate_groups SET status = 'dismissed' WHERE id = ?`
        ).run(groupId);
    }

    /**
     * Check if a set of photo IDs already forms a known group (prevent duplicates).
     * Returns the existing group ID or null.
     */
    static findExistingGroup(photoIds: number[]): number | null {
        if (photoIds.length === 0) return null;
        const db = getDB();
        // A group is "existing" if all photoIds are already in the same group
        const placeholders = photoIds.map(() => '?').join(',');
        const row = db.prepare(`
            SELECT duplicate_group_id, COUNT(*) as cnt
            FROM photos
            WHERE id IN (${placeholders}) AND duplicate_group_id IS NOT NULL
            GROUP BY duplicate_group_id
            HAVING cnt = ?
        `).get(...photoIds, photoIds.length) as { duplicate_group_id: number } | undefined;
        return row?.duplicate_group_id ?? null;
    }

    static deleteGroup(groupId: number) {
        // Unlink photos first (ON DELETE SET NULL handles it, but explicit is safer)
        getDB().prepare('UPDATE photos SET duplicate_group_id = NULL WHERE duplicate_group_id = ?').run(groupId);
        getDB().prepare('DELETE FROM duplicate_groups WHERE id = ?').run(groupId);
    }
}
