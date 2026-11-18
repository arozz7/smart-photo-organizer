import { getDB } from '../../db';

/**
 * Size and identity of the set of faces that belong to named people: the faces the face search index must hold
 * (the same set as FaceRepository.getNamedFaceDescriptors). The sums tell two sets of equal size apart.
 *
 * Runs about once a minute on the main thread, so it starts from the (few) people and uses the person_id index:
 * the same question asked from the faces table scans every face and took about 0.2 s on 92,000 faces, against 16 ms here.
 */
export class NamedFaceFingerprintRepository {
    static get(): { count: number; idSum: number; idSquareSum: number } {
        return getDB().prepare(`
            SELECT COUNT(*) AS count,
                   COALESCE(SUM(f.id), 0) AS idSum,
                   COALESCE(SUM(f.id * f.id), 0) AS idSquareSum
            FROM people p
            CROSS JOIN faces f ON f.person_id = p.id
            WHERE f.descriptor IS NOT NULL AND f.is_ignored = 0
        `).get() as { count: number; idSum: number; idSquareSum: number };
    }
}
