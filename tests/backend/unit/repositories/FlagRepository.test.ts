import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { faceFlagsMigration } from '../../../../electron/data/migrations/003_faceFlags';

let testDb: Database.Database;
vi.mock('../../../../electron/db', () => ({ getDB: () => testDb }));

import { FlagRepository } from '../../../../electron/data/repositories/FlagRepository';

interface FaceSeed {
    id: number;
    score?: number | null;
    yaw?: number | null;
    person?: number | null;
    ignored?: number;
    entity?: string | null;
    source?: string | null;
}

const BOX = JSON.stringify({ x: 10, y: 20, width: 30, height: 40 });

function seed(faces: FaceSeed[]) {
    testDb.prepare(`INSERT OR IGNORE INTO photos (id, file_path, preview_cache_path, width, height) VALUES (1, 'a.jpg', 'a_preview.jpg', 4000, 3000)`).run();
    const insert = testDb.prepare(
        `INSERT INTO faces (id, photo_id, box_json, score, face_quality, blur_score, pose_yaw, pose_pitch, person_id, is_ignored, entity_type, descriptor, ignore_source)
         VALUES (?, 1, ?, ?, 0.6, 120, ?, 5, ?, ?, ?, x'00', ?)`
    );
    for (const f of faces) {
        insert.run(
            f.id, BOX, f.score === undefined ? 0.4 : f.score, f.yaw === undefined ? 10 : f.yaw,
            f.person ?? null, f.ignored ?? 0, f.entity === undefined ? 'human' : f.entity, f.source ?? null
        );
    }
}

const row = (id: number) =>
    testDb.prepare('SELECT is_ignored, ignore_source, person_id FROM faces WHERE id = ?').get(id) as { is_ignored: number; ignore_source: string | null; person_id: number | null };

describe('FlagRepository (not a face, by detector score)', () => {
    beforeEach(() => {
        testDb = new Database(':memory:');
        testDb.exec(`
            CREATE TABLE photos (id INTEGER PRIMARY KEY, file_path TEXT, preview_cache_path TEXT, width INTEGER, height INTEGER);
            CREATE TABLE faces (
                id INTEGER PRIMARY KEY, photo_id INTEGER, box_json TEXT, score REAL, face_quality REAL, blur_score REAL,
                pose_yaw REAL, pose_pitch REAL, person_id INTEGER, is_ignored BOOLEAN DEFAULT 0, entity_type TEXT DEFAULT 'human',
                descriptor BLOB, ignore_source TEXT)`);
        faceFlagsMigration.up(testDb);
    });
    afterEach(() => testDb.close());

    describe('which faces are suggested', () => {
        it('lists only unassigned, not ignored, human faces with a score below the cut-off, lowest score first', () => {
            seed([
                { id: 1, score: 0.5 },
                { id: 2, score: 0.3 },
                { id: 3, score: 0.8 },
                { id: 4, score: 0.2, person: 9 },
                { id: 5, score: 0.2, ignored: 1 },
                { id: 6, score: 0.2, entity: 'dog' },
                { id: 7, score: null },
                { id: 8, score: 0.4, entity: null },
            ]);

            const tiles = FlagRepository.listNonFace(0.55, 0, 50);

            expect(tiles.map(t => t.faceId)).toEqual([2, 8, 1]);
            expect(tiles[0]).toMatchObject({
                score: 0.3, quality: 0.6, blur: 120, yaw: 10, pitch: 5, photoId: 1, filePath: 'a.jpg',
                previewPath: 'a_preview.jpg', photoWidth: 4000, photoHeight: 3000, box: { x: 10, y: 20, width: 30, height: 40 },
            });
        });

        it('does not use the score exactly at the cut-off', () => {
            seed([{ id: 1, score: 0.55 }, { id: 2, score: 0.54 }]);

            expect(FlagRepository.listNonFace(0.55, 0, 50).map(t => t.faceId)).toEqual([2]);
        });

        it('pages by offset and limit', () => {
            seed([{ id: 1, score: 0.1 }, { id: 2, score: 0.2 }, { id: 3, score: 0.3 }]);

            expect(FlagRepository.listNonFace(0.55, 1, 1).map(t => t.faceId)).toEqual([2]);
        });

        it('never orders or filters by pose, and reports an unknown pose as null', () => {
            seed([{ id: 1, score: 0.3, yaw: 80 }, { id: 2, score: 0.4, yaw: null }, { id: 3, score: 0.5, yaw: 0 }]);

            const tiles = FlagRepository.listNonFace(0.55, 0, 50);

            expect(tiles.map(t => t.faceId)).toEqual([1, 2, 3]);
            expect(tiles[1].yaw).toBeNull();
        });

        it('hides faces the user said to keep, but not a different kind of flag', () => {
            seed([{ id: 1 }, { id: 2 }, { id: 3 }]);
            FlagRepository.dismissNonFace([1], 0.55, '2026-11-19T10:00:00Z');
            testDb.prepare(`INSERT INTO face_flags (face_id, kind, status, created_at) VALUES (2, 'picture', 'dismissed', 'x')`).run();

            expect(FlagRepository.listNonFace(0.55, 0, 50).map(t => t.faceId)).toEqual([2, 3]);
        });
    });

    describe('counts for the cut-off choice', () => {
        it('counts the faces below each cut-off and how many of them are turned 45 degrees or more', () => {
            seed([
                { id: 1, score: 0.45, yaw: 60 },
                { id: 2, score: 0.5, yaw: -50 },
                { id: 3, score: 0.5, yaw: 44 },
                { id: 4, score: 0.6, yaw: 90 },
                { id: 5, score: 0.6, yaw: null },
                { id: 6, score: 0.9 },
            ]);

            expect(FlagRepository.countNonFaceBelow([0.4, 0.55, 0.7])).toEqual([
                { cutoff: 0.4, total: 0, turned: 0 },
                { cutoff: 0.55, total: 3, turned: 2 },
                { cutoff: 0.7, total: 5, turned: 3 },
            ]);
        });

        it('does not count faces the user kept', () => {
            seed([{ id: 1, score: 0.3 }, { id: 2, score: 0.3 }]);
            FlagRepository.dismissNonFace([1], 0.55, 'x');

            expect(FlagRepository.countNonFaceBelow([0.55])).toEqual([{ cutoff: 0.55, total: 1, turned: 0 }]);
        });
    });

    describe('ignoring suggested faces', () => {
        it('ignores the suggested faces, tags them, and returns which ones it changed', () => {
            seed([{ id: 1, score: 0.3 }, { id: 2, score: 0.4 }]);

            const changed = FlagRepository.ignoreNonFace([1, 2], 0.55);

            expect(changed.sort()).toEqual([1, 2]);
            expect(row(1)).toEqual({ is_ignored: 1, ignore_source: 'non_face_review', person_id: null });
            expect(FlagRepository.listNonFace(0.55, 0, 50)).toEqual([]);
        });

        it('leaves alone a stale id: assigned, already ignored, above the cut-off, kept, or not even a face', () => {
            seed([
                { id: 1, score: 0.3, person: 4 },
                { id: 2, score: 0.3, ignored: 1, source: 'user' },
                { id: 3, score: 0.9 },
                { id: 4, score: 0.3 },
                { id: 5, score: 0.3, entity: 'dog' },
            ]);
            FlagRepository.dismissNonFace([4], 0.55, 'x');

            const changed = FlagRepository.ignoreNonFace([1, 2, 3, 4, 5, 99], 0.55);

            expect(changed).toEqual([]);
            expect(row(1)).toEqual({ is_ignored: 0, ignore_source: null, person_id: 4 });
            expect(row(2)).toEqual({ is_ignored: 1, ignore_source: 'user', person_id: null });
            expect(row(3).is_ignored).toBe(0);
            expect(row(4).is_ignored).toBe(0);
            expect(row(5).is_ignored).toBe(0);
        });

        it('does nothing for an empty list', () => {
            expect(FlagRepository.ignoreNonFace([], 0.55)).toEqual([]);
        });

        it('handles more ids than one query can bind', () => {
            const many = Array.from({ length: 1200 }, (_, i) => ({ id: i + 1, score: 0.3 }));
            seed(many);

            expect(FlagRepository.ignoreNonFace(many.map(f => f.id), 0.55)).toHaveLength(1200);
        });
    });

    describe('keeping suggested faces', () => {
        it('records the faces as dismissed, once, and returns how many were recorded', () => {
            seed([{ id: 1, score: 0.3 }, { id: 2, score: 0.4 }, { id: 3, score: 0.9 }]);

            expect(FlagRepository.dismissNonFace([1, 2, 3, 99], 0.55, '2026-11-19T10:00:00Z')).toBe(2);
            expect(FlagRepository.dismissNonFace([1], 0.55, '2026-11-20T10:00:00Z')).toBe(0);

            expect(testDb.prepare(`SELECT face_id, kind, status, score, created_at FROM face_flags ORDER BY face_id`).all()).toEqual([
                { face_id: 1, kind: 'non_face', status: 'dismissed', score: 0.3, created_at: '2026-11-19T10:00:00Z' },
                { face_id: 2, kind: 'non_face', status: 'dismissed', score: 0.4, created_at: '2026-11-19T10:00:00Z' },
            ]);
        });
    });

    describe('undo', () => {
        it('restores exactly the faces it is given, only if this list ignored them, and clears the tag', () => {
            seed([{ id: 1, score: 0.3 }, { id: 2, score: 0.3 }, { id: 3, score: 0.3, ignored: 1, source: 'user' }, { id: 4, score: 0.3 }]);
            FlagRepository.ignoreNonFace([1, 2, 4], 0.55);

            const restored = FlagRepository.restoreNonFace([1, 3, 99]);

            expect(restored).toEqual([1]);
            expect(row(1)).toEqual({ is_ignored: 0, ignore_source: null, person_id: null });
            expect(row(2).is_ignored).toBe(1);
            expect(row(3)).toEqual({ is_ignored: 1, ignore_source: 'user', person_id: null });
            expect(FlagRepository.countIgnoredByNonFace()).toBe(2);
        });

        it('does not restore a face the user has since given to a person', () => {
            seed([{ id: 1, score: 0.3 }]);
            FlagRepository.ignoreNonFace([1], 0.55);
            testDb.prepare('UPDATE faces SET person_id = 5 WHERE id = 1').run();

            expect(FlagRepository.restoreNonFace([1])).toEqual([]);
        });
    });
});
