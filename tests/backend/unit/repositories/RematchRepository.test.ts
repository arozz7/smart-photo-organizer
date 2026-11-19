import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { rematchLogMigration } from '../../../../electron/data/migrations/002_rematchLog';

let testDb: Database.Database;
vi.mock('../../../../electron/db', () => ({ getDB: () => testDb }));

import { RematchRepository } from '../../../../electron/data/repositories/RematchRepository';

const DESCRIPTOR_BYTES = 512 * 4;
const descriptor = () => Buffer.alloc(DESCRIPTOR_BYTES);

interface FaceSeed {
    id: number;
    person?: number | null;
    ignored?: number;
    entity?: string | null;
    descriptor?: Buffer | null;
    source?: string;
    confirmed?: number;
}

function seed(faces: FaceSeed[]) {
    const insert = testDb.prepare(
        `INSERT INTO faces (id, person_id, is_ignored, entity_type, descriptor, assignment_source, is_confirmed, needs_bucketing, bucket_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 5)`
    );
    for (const f of faces) {
        insert.run(
            f.id,
            f.person ?? null,
            f.ignored ?? 0,
            f.entity === undefined ? 'human' : f.entity,
            f.descriptor === undefined ? descriptor() : f.descriptor,
            f.source ?? 'ai_scan',
            f.confirmed ?? 0
        );
    }
}

describe('RematchRepository', () => {
    beforeEach(() => {
        testDb = new Database(':memory:');
        testDb.exec(`CREATE TABLE faces (
            id INTEGER PRIMARY KEY, person_id INTEGER, is_ignored BOOLEAN DEFAULT 0, entity_type TEXT DEFAULT 'human',
            descriptor BLOB, assignment_source TEXT DEFAULT 'manual', is_confirmed BOOLEAN DEFAULT 0,
            needs_bucketing INTEGER DEFAULT 0, bucket_id INTEGER, match_distance REAL)`);
        rematchLogMigration.up(testDb);
    });
    afterEach(() => testDb.close());

    describe('which faces are looked at', () => {
        it('returns only unassigned, not ignored, human faces with a full descriptor, in id order', () => {
            seed([
                { id: 1 },
                { id: 2, person: 9 },
                { id: 3, ignored: 1 },
                { id: 4, entity: 'dog' },
                { id: 5, descriptor: null },
                { id: 6, descriptor: Buffer.alloc(12) },
                { id: 7, entity: null },
                { id: 8 },
            ]);

            const faces = RematchRepository.getUnassignedFaces(0, 100);

            expect(faces.map(f => f.id)).toEqual([1, 7, 8]);
            expect(RematchRepository.countUnassigned()).toBe(3);
        });

        it('pages by id so faces assigned in between are not skipped or repeated', () => {
            seed([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);

            const first = RematchRepository.getUnassignedFaces(0, 2);
            const second = RematchRepository.getUnassignedFaces(first[first.length - 1].id, 2);
            const third = RematchRepository.getUnassignedFaces(second[second.length - 1].id, 2);

            expect([first, second, third].map(page => page.map(f => f.id))).toEqual([[1, 2], [3, 4], [5]]);
        });
    });

    describe('saving matches', () => {
        it('assigns unconfirmed with the source and distance, clears bucket link and bucketing flag, and logs the pair', () => {
            seed([{ id: 1 }, { id: 2 }]);

            RematchRepository.saveMatches([{ faceId: 1, personId: 7, distance: 0.52 }], '2026-11-18T10:00:00Z');

            expect(testDb.prepare('SELECT person_id, assignment_source, is_confirmed, match_distance, bucket_id, needs_bucketing FROM faces WHERE id = 1').get())
                .toEqual({ person_id: 7, assignment_source: 'auto_rematch', is_confirmed: 0, match_distance: 0.52, bucket_id: null, needs_bucketing: 0 });
            expect(testDb.prepare('SELECT person_id, assignment_source FROM faces WHERE id = 2').get()).toEqual({ person_id: null, assignment_source: 'ai_scan' });
            expect(testDb.prepare('SELECT face_id, person_id, distance, assigned_at FROM rematch_log').all())
                .toEqual([{ face_id: 1, person_id: 7, distance: 0.52, assigned_at: '2026-11-18T10:00:00Z' }]);
        });

        it('does not touch a face that was assigned or ignored in the meantime, and does not log it', () => {
            seed([{ id: 1, person: 3, confirmed: 1, source: 'manual' }, { id: 2, ignored: 1 }]);

            RematchRepository.saveMatches(
                [{ faceId: 1, personId: 7, distance: 0.5 }, { faceId: 2, personId: 7, distance: 0.5 }],
                '2026-11-18T10:00:00Z'
            );

            expect(testDb.prepare('SELECT person_id, is_confirmed, assignment_source FROM faces WHERE id = 1').get())
                .toEqual({ person_id: 3, is_confirmed: 1, assignment_source: 'manual' });
            expect(testDb.prepare('SELECT person_id FROM faces WHERE id = 2').get()).toEqual({ person_id: null });
            expect(testDb.prepare('SELECT COUNT(*) AS c FROM rematch_log').get()).toEqual({ c: 0 });
        });

        it('does nothing for an empty list', () => {
            expect(() => RematchRepository.saveMatches([], '2026-11-18T10:00:00Z')).not.toThrow();
        });
    });

    describe('remembering rejected matches', () => {
        it('reports the face and person pairs that were assigned before, only for the faces asked about', () => {
            seed([{ id: 1 }, { id: 2 }, { id: 3 }]);
            RematchRepository.saveMatches(
                [{ faceId: 1, personId: 7, distance: 0.5 }, { faceId: 2, personId: 8, distance: 0.6 }],
                '2026-11-18T10:00:00Z'
            );

            const tried = RematchRepository.findTriedPairs([1, 3]);

            expect([...tried]).toEqual(['1:7']);
        });

        it('keeps the pair after the user removes the face from the person', () => {
            seed([{ id: 1 }]);
            RematchRepository.saveMatches([{ faceId: 1, personId: 7, distance: 0.5 }], '2026-11-18T10:00:00Z');
            testDb.prepare('UPDATE faces SET person_id = NULL WHERE id = 1').run();

            expect(RematchRepository.findTriedPairs([1]).has('1:7')).toBe(true);
        });

        it('copes with more faces than SQLite allows in one statement', () => {
            const ids = Array.from({ length: 2500 }, (_, i) => i + 1);

            expect(RematchRepository.findTriedPairs(ids).size).toBe(0);
        });
    });

    describe('undo', () => {
        it('returns only unconfirmed re-matched faces to unassigned and leaves everything else alone', () => {
            seed([
                { id: 1 },
                { id: 2 },
                { id: 3, person: 4, source: 'manual', confirmed: 1 },
                { id: 4, person: 4, source: 'auto_suggestion' },
            ]);
            RematchRepository.saveMatches(
                [{ faceId: 1, personId: 7, distance: 0.5 }, { faceId: 2, personId: 7, distance: 0.6 }],
                '2026-11-18T10:00:00Z'
            );
            testDb.prepare('UPDATE faces SET is_confirmed = 1 WHERE id = 2').run();

            expect(RematchRepository.countUndoable()).toBe(1);
            const undone = RematchRepository.undoUnconfirmed();

            expect(undone).toBe(1);
            expect(testDb.prepare('SELECT person_id, match_distance, assignment_source, is_confirmed FROM faces WHERE id = 1').get())
                .toEqual({ person_id: null, match_distance: null, assignment_source: 'ai_scan', is_confirmed: 0 });
            expect(testDb.prepare('SELECT person_id, is_confirmed FROM faces WHERE id = 2').get()).toEqual({ person_id: 7, is_confirmed: 1 });
            expect(testDb.prepare('SELECT person_id FROM faces WHERE id = 3').get()).toEqual({ person_id: 4 });
            expect(testDb.prepare('SELECT person_id FROM faces WHERE id = 4').get()).toEqual({ person_id: 4 });
            expect(RematchRepository.countUndoable()).toBe(0);
        });

        it('is a true revert: it forgets the pairs it undoes, so they can be matched again (for example at another distance)', () => {
            seed([{ id: 1 }]);
            RematchRepository.saveMatches([{ faceId: 1, personId: 7, distance: 0.5 }], '2026-11-18T10:00:00Z');

            RematchRepository.undoUnconfirmed();

            expect(RematchRepository.findTriedPairs([1]).size).toBe(0);
        });

        it('keeps the pairs of faces the user removed one by one or confirmed', () => {
            seed([{ id: 1 }, { id: 2 }, { id: 3 }]);
            RematchRepository.saveMatches(
                [{ faceId: 1, personId: 7, distance: 0.5 }, { faceId: 2, personId: 7, distance: 0.5 }, { faceId: 3, personId: 7, distance: 0.5 }],
                '2026-11-18T10:00:00Z'
            );
            testDb.prepare('UPDATE faces SET person_id = NULL WHERE id = 1').run(); // removed by the user
            testDb.prepare('UPDATE faces SET is_confirmed = 1 WHERE id = 2').run(); // confirmed by the user

            RematchRepository.undoUnconfirmed();

            expect([...RematchRepository.findTriedPairs([1, 2, 3])].sort()).toEqual(['1:7', '2:7']);
        });
    });
});
