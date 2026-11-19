import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;
vi.mock('../../../../electron/db', () => ({ getDB: () => testDb }));

import { FaceRepository } from '../../../../electron/data/repositories/FaceRepository';
import { NamedFaceFingerprintRepository } from '../../../../electron/data/repositories/NamedFaceFingerprintRepository';

/**
 * The face search index (used to match new scans) must hold the faces the user stands behind. Faces the background re-match
 * assigned and the user has not confirmed yet are suggestions: they stay out of the index until confirmed, so a wrong
 * suggestion cannot pull new photos towards the wrong person.
 */
describe('the named faces that feed the face search index', () => {
    beforeEach(() => {
        testDb = new Database(':memory:');
        testDb.exec(`
            CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT);
            CREATE INDEX idx_people ON people(id);
            CREATE TABLE faces (id INTEGER PRIMARY KEY, person_id INTEGER, is_ignored BOOLEAN DEFAULT 0, descriptor BLOB,
                                assignment_source TEXT DEFAULT 'manual', is_confirmed BOOLEAN DEFAULT 0);
            CREATE INDEX idx_faces_person ON faces(person_id);
            INSERT INTO people (id, name) VALUES (1, 'A'), (2, 'B');
        `);
        const insert = testDb.prepare('INSERT INTO faces (id, person_id, is_ignored, descriptor, assignment_source, is_confirmed) VALUES (?, ?, ?, ?, ?, ?)');
        const descriptor = Buffer.alloc(512 * 4);
        insert.run(1, 1, 0, descriptor, 'ai_scan', 1); // confirmed
        insert.run(2, 1, 0, descriptor, 'auto_suggestion', 0); // unconfirmed suggestion from the scan (existing behaviour: in the index)
        insert.run(3, 2, 0, descriptor, 'auto_rematch', 0); // unconfirmed re-match: out
        insert.run(4, 2, 0, descriptor, 'auto_rematch', 1); // re-match the user confirmed: in
        insert.run(5, 2, 1, descriptor, 'ai_scan', 1); // ignored: out
        insert.run(6, null, 0, descriptor, 'ai_scan', 0); // unassigned: out
    });
    afterEach(() => testDb.close());

    it('leaves out unconfirmed re-matches but keeps confirmed ones and everything that was already included', () => {
        const ids = FaceRepository.getNamedFaceDescriptors().map(face => face.id).sort((a, b) => a - b);

        expect(ids).toEqual([1, 2, 4]);
    });

    it('is described by a fingerprint of the same set', () => {
        expect(NamedFaceFingerprintRepository.get()).toEqual({ count: 3, idSum: 1 + 2 + 4, idSquareSum: 1 + 4 + 16 });
    });

    it('does not change the fingerprint when the re-match assigns a face, but does when the user confirms it', () => {
        const before = NamedFaceFingerprintRepository.get();

        testDb.prepare(`UPDATE faces SET person_id = 1, assignment_source = 'auto_rematch', is_confirmed = 0 WHERE id = 6`).run();
        expect(NamedFaceFingerprintRepository.get()).toEqual(before);

        testDb.prepare('UPDATE faces SET is_confirmed = 1 WHERE id = 6').run();
        expect(NamedFaceFingerprintRepository.get().count).toBe(before.count + 1);
    });
});
