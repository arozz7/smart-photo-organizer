import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;
vi.mock('../../../../electron/db', () => ({ getDB: () => testDb }));

import { AppStateRepository } from '../../../../electron/data/repositories/AppStateRepository';

const GRACE_MS = 15_000;

describe('AppStateRepository: face queue activity', () => {
    beforeEach(() => {
        testDb = new Database(':memory:');
        testDb.exec('CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
        AppStateRepository.setAIIdleGraceMs(GRACE_MS);
        AppStateRepository.setAIProcessingActive(false, Number.NEGATIVE_INFINITY); // forget earlier activity
    });

    it('is not busy when the queue never ran', () => {
        expect(AppStateRepository.isAIProcessingActive(0)).toBe(false);
    });

    it('is busy while the queue is working', () => {
        AppStateRepository.setAIProcessingActive(true, 0);

        expect(AppStateRepository.isAIProcessingActive(60_000)).toBe(true);
    });

    it('stays busy through the short gap between two photos of a scan', () => {
        AppStateRepository.setAIProcessingActive(true, 0);
        AppStateRepository.setAIProcessingActive(false, 2_000);

        expect(AppStateRepository.isAIProcessingActive(3_000)).toBe(true);
        expect(AppStateRepository.isAIProcessingActive(2_000 + GRACE_MS - 1)).toBe(true);
    });

    it('is quiet once the queue has been idle for the whole waiting time', () => {
        AppStateRepository.setAIProcessingActive(true, 0);
        AppStateRepository.setAIProcessingActive(false, 2_000);

        expect(AppStateRepository.isAIProcessingActive(2_000 + GRACE_MS)).toBe(false);
    });

    it('starts the waiting time again each time the queue works', () => {
        AppStateRepository.setAIProcessingActive(false, 0);
        AppStateRepository.setAIProcessingActive(true, 10_000);
        AppStateRepository.setAIProcessingActive(false, 11_000);

        expect(AppStateRepository.isAIProcessingActive(11_000 + GRACE_MS - 1)).toBe(true);
    });

    it('follows the flag only when background work is allowed to run alongside (waiting time of zero)', () => {
        AppStateRepository.setAIIdleGraceMs(0);
        AppStateRepository.setAIProcessingActive(true, 0);
        AppStateRepository.setAIProcessingActive(false, 2_000);

        expect(AppStateRepository.isAIProcessingActive(2_000)).toBe(false);
        AppStateRepository.setAIProcessingActive(true, 3_000);
        expect(AppStateRepository.isAIProcessingActive(3_000)).toBe(true);
    });
});
