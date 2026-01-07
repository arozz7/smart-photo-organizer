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
                    WHERE person_id IS NOT NULL AND is_ignored = 0
                ),
                PersonCounts AS (
                    SELECT person_id, COUNT(*) as face_count 
                    FROM faces 
                    WHERE person_id IS NOT NULL AND is_ignored = 0
                    GROUP BY person_id
                )
                SELECT 
                    p.*, 
                    COALESCE(pc.face_count, 0) as face_count,
                    COALESCE(fixed_photo.preview_cache_path, fixed_photo.file_path, ph.preview_cache_path, ph.file_path) as cover_path,
                    COALESCE(fixed_face.box_json, bf.box_json) as cover_box,
                    COALESCE(fixed_photo.width, ph.width) as cover_width,
                    COALESCE(fixed_photo.height, ph.height) as cover_height,
                    p.cover_face_id
                FROM people p
                LEFT JOIN PersonCounts pc ON p.id = pc.person_id
                LEFT JOIN BestFaces bf ON p.id = bf.person_id AND bf.rn = 1
                LEFT JOIN photos ph ON bf.photo_id = ph.id
                LEFT JOIN faces fixed_face ON p.cover_face_id = fixed_face.id
                LEFT JOIN photos fixed_photo ON fixed_face.photo_id = fixed_photo.id
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
            const people = db.prepare('SELECT id, name, descriptor_mean_json FROM people WHERE descriptor_mean_json IS NOT NULL').all();
            const eras = db.prepare('SELECT * FROM person_eras').all(); // Fetch all eras

            // Map eras to personId
            const erasMap = new Map<number, any[]>();
            for (const era of eras) {
                if (!erasMap.has(era.person_id)) erasMap.set(era.person_id, []);
                erasMap.get(era.person_id)?.push({
                    centroid: JSON.parse(era.centroid_json),
                    name: era.era_name
                });
            }

            return people.map((r: any) => ({
                id: r.id,
                name: r.name,
                descriptor: JSON.parse(r.descriptor_mean_json),
                eras: erasMap.get(r.id) || []
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

    static setPersonCover(personId: number, faceId: number | null) {
        const db = getDB();
        db.prepare('UPDATE people SET cover_face_id = ? WHERE id = ?').run(faceId, personId);
    }

    /**
     * Get person with their descriptor mean (centroid) for outlier analysis.
     */
    static getPersonWithDescriptor(personId: number): {
        id: number;
        name: string;
        descriptor_mean_json: string | null;
    } | null {
        const db = getDB();
        try {
            const row = db.prepare(
                'SELECT id, name, descriptor_mean_json FROM people WHERE id = ?'
            ).get(personId) as { id: number; name: string; descriptor_mean_json: string | null } | undefined;
            return row || null;
        } catch (error) {
            throw new Error(`PersonRepository.getPersonWithDescriptor failed: ${String(error)}`);
        }
    }
    static getPerson(personId: number) {
        return this.getPersonById(personId);
    }

    static addHistorySnapshot(personId: number, descriptorJson: string, faceCount: number, reason: string) {
        const db = getDB();
        db.prepare('INSERT INTO person_history (person_id, descriptor_json, face_count, reason) VALUES (?, ?, ?, ?)').run(personId, descriptorJson, faceCount, reason);
    }

    // --- Era Methods ---
    static addEra(era: {
        person_id: number,
        era_name: string,
        start_year: number | null,
        end_year: number | null,
        centroid_json: string,
        face_count: number,
        is_auto_generated: boolean
    }) {
        const db = getDB();
        const info = db.prepare(`
            INSERT INTO person_eras (person_id, era_name, start_year, end_year, centroid_json, face_count, is_auto_generated, created_at)
            VALUES (@person_id, @era_name, @start_year, @end_year, @centroid_json, @face_count, @is_auto_generated, strftime('%s','now'))
        `).run({ ...era, is_auto_generated: era.is_auto_generated ? 1 : 0 });
        return info.lastInsertRowid as number;
    }

    static clearEras(personId: number) {
        const db = getDB();
        db.prepare('DELETE FROM person_eras WHERE person_id = ?').run(personId);
    }

    static getEras(personId: number) {
        const db = getDB();
        return db.prepare('SELECT * FROM person_eras WHERE person_id = ? ORDER BY start_year ASC').all(personId);
    }

    static deleteEra(eraId: number) {
        const db = getDB();
        db.prepare('UPDATE faces SET era_id = NULL WHERE era_id = ?').run(eraId);
        db.prepare('DELETE FROM person_eras WHERE id = ?').run(eraId);
    }
}
