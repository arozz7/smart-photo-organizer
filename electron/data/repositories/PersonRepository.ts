import { getDB } from '../../db';

export class PersonRepository {
    static getPeople() {
        const db = getDB();
        try {
            const stmt = db.prepare(`
                WITH BestFaces AS (
                    SELECT 
                        person_id,
                        id as face_id,
                        photo_id,
                        box_json,
                        blur_score,
                        ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY blur_score DESC) as rn
                    FROM faces 
                    WHERE person_id IS NOT NULL
                ),
                PersonCounts AS (
                    SELECT person_id, COUNT(*) as face_count 
                    FROM faces 
                    WHERE person_id IS NOT NULL 
                    GROUP BY person_id
                )
                SELECT 
                    p.*, 
                    COALESCE(pc.face_count, 0) as face_count,
                    COALESCE(ph.preview_cache_path, ph.file_path) as cover_path,
                    bf.box_json as cover_box,
                    ph.width as cover_width,
                    ph.height as cover_height
                FROM people p
                LEFT JOIN PersonCounts pc ON p.id = pc.person_id
                LEFT JOIN BestFaces bf ON p.id = bf.person_id AND bf.rn = 1
                LEFT JOIN photos ph ON bf.photo_id = ph.id
                ORDER BY face_count DESC
            `);
            return stmt.all();
        } catch (error) {
            throw new Error(`PersonRepository.getPeople failed: ${String(error)}`);
        }
    }

    static getPeopleWithDescriptors() {
        const db = getDB();
        try {
            const rows = db.prepare('SELECT id, name, descriptor_mean_json FROM people WHERE descriptor_mean_json IS NOT NULL').all();
            return rows.map((r: any) => ({
                id: r.id,
                name: r.name,
                descriptor: JSON.parse(r.descriptor_mean_json)
            }));
        } catch (error) {
            throw new Error(`PersonRepository.getPeopleWithDescriptors failed: ${String(error)}`);
        }
    }

    static getPersonById(personId: number) {
        const db = getDB();
        return db.prepare('SELECT * FROM people WHERE id = ?').get(personId);
    }

    static getPersonByName(name: string) {
        const db = getDB();
        return db.prepare('SELECT * FROM people WHERE name = ? COLLATE NOCASE').get(name.trim());
    }

    static createPerson(name: string) {
        const db = getDB();
        const normalizedName = name.trim();
        db.prepare('INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(normalizedName);
        return this.getPersonByName(normalizedName);
    }

    static updatePersonName(id: number, name: string) {
        const db = getDB();
        db.prepare('UPDATE people SET name = ? WHERE id = ?').run(name.trim(), id);
    }

    static updateDescriptorMean(id: number, meanJson: string | null) {
        const db = getDB();
        db.prepare('UPDATE people SET descriptor_mean_json = ? WHERE id = ?').run(meanJson, id);
    }

    static deletePerson(id: number) {
        const db = getDB();
        db.prepare('DELETE FROM people WHERE id = ?').run(id);
    }
}
