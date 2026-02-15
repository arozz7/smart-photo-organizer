import { getDB } from '../../db';

interface SmartAlbumRow {
    id: number;
    name: string;
    filter_json: string;
    created_at: string;
}

export class SmartAlbumRepository {
    static create(name: string, filterJson: string): SmartAlbumRow {
        const db = getDB();
        const result = db.prepare(
            'INSERT INTO smart_albums (name, filter_json) VALUES (?, ?)'
        ).run(name, filterJson);
        return db.prepare('SELECT * FROM smart_albums WHERE id = ?').get(result.lastInsertRowid) as SmartAlbumRow;
    }

    static getAll(): SmartAlbumRow[] {
        const db = getDB();
        return db.prepare('SELECT * FROM smart_albums ORDER BY created_at DESC').all() as SmartAlbumRow[];
    }

    static getById(id: number): SmartAlbumRow | undefined {
        const db = getDB();
        return db.prepare('SELECT * FROM smart_albums WHERE id = ?').get(id) as SmartAlbumRow | undefined;
    }

    static update(id: number, name: string, filterJson: string): void {
        const db = getDB();
        db.prepare('UPDATE smart_albums SET name = ?, filter_json = ? WHERE id = ?').run(name, filterJson, id);
    }

    static delete(id: number): void {
        const db = getDB();
        db.prepare('DELETE FROM smart_albums WHERE id = ?').run(id);
    }
}
