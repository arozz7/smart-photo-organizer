import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, closeTestDatabase, seedPhoto } from '../../mocks/mockDatabase';

vi.mock('../../../../electron/db', () => ({ getDB: vi.fn() }));

import { CaptionRepository } from '../../../../electron/data/repositories/CaptionRepository';
import { getDB } from '../../../../electron/db';

describe('CaptionRepository', () => {
    let db: Database.Database;

    /** A photo whose faces were scanned (a scan_history row), with or without a description. */
    const scanned = (description: string | null, status = 'success'): number => {
        const id = seedPhoto(db, { description: description ?? undefined });
        db.prepare('INSERT INTO scan_history (photo_id, status) VALUES (?, ?)').run(id, status);
        return id;
    };

    beforeEach(() => {
        db = createTestDatabase();
        // The test schema is the older one: add what the real database has and this query reads.
        db.exec('ALTER TABLE photos ADD COLUMN missing_since TEXT');
        db.exec('CREATE TABLE scan_history (id INTEGER PRIMARY KEY, photo_id INTEGER, status TEXT)');
        vi.mocked(getDB).mockReturnValue(db);
    });

    afterEach(() => {
        closeTestDatabase();
        vi.clearAllMocks();
    });

    it('lists scanned photos without a description, newest first', () => {
        const older = scanned(null);
        const newer = scanned('');

        expect(CaptionRepository.getPhotosNeedingCaption(new Set(), 10).map(p => p.id)).toEqual([newer, older]);
    });

    it('leaves out photos that already have a description', () => {
        scanned('A dog on a beach');

        expect(CaptionRepository.getPhotosNeedingCaption(new Set(), 10)).toEqual([]);
    });

    it('leaves out photos whose faces were not scanned yet (the caption never comes before the faces)', () => {
        seedPhoto(db, {});
        scanned(null, 'error');

        expect(CaptionRepository.getPhotosNeedingCaption(new Set(), 10)).toEqual([]);
    });

    it('leaves out photos whose file went missing', () => {
        const id = scanned(null);
        db.prepare("UPDATE photos SET missing_since = '2026-11-01' WHERE id = ?").run(id);

        expect(CaptionRepository.getPhotosNeedingCaption(new Set(), 10)).toEqual([]);
    });

    it('leaves out the photos asked to be skipped, and respects the limit', () => {
        const a = scanned(null);
        const b = scanned(null);
        const c = scanned(null);

        expect(CaptionRepository.getPhotosNeedingCaption(new Set([c]), 10).map(p => p.id)).toEqual([b, a]);
        expect(CaptionRepository.getPhotosNeedingCaption(new Set(), 1).map(p => p.id)).toEqual([c]);
    });

    it('counts the photos waiting', () => {
        scanned(null);
        scanned(null);
        scanned('has one');

        expect(CaptionRepository.countPhotosNeedingCaption()).toBe(2);
    });
});
