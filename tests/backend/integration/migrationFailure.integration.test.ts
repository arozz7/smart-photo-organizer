/**
 * initDB must fail closed when a migration fails: it rethrows the MigrationError (carrying the
 * backup path) and leaves no open database behind, so no service can run on a half-upgraded library.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MigrationError } from '../../../electron/data/migrations/types';
import { createLegacyLibraryCopy, removeLibraryCopy } from '../../fixtures/legacyFixture';

const failure = new MigrationError('Migration 1 (add_x) failed', 1, new Error('boom'), 'D:/Library/backups/x.db');

vi.mock('../../../electron/data/migrations', () => ({
    migrateDatabase: vi.fn(async () => { throw failure; }),
}));

describe('initDB when a migration fails', () => {
    let libraryDir: string;

    beforeEach(() => { libraryDir = createLegacyLibraryCopy(); });
    afterEach(() => removeLibraryCopy(libraryDir));

    it('rethrows the MigrationError with its backup path', async () => {
        // Arrange
        const { initDB } = await import('../../../electron/db');

        // Act
        const attempt = initDB(libraryDir);

        // Assert
        await expect(attempt).rejects.toBe(failure);
        await expect(attempt).rejects.toMatchObject({ backupPath: 'D:/Library/backups/x.db' });
    });

    it('leaves no open database behind (fail closed)', async () => {
        // Arrange
        const { initDB, getDB } = await import('../../../electron/db');

        // Act
        await initDB(libraryDir).catch(() => undefined);

        // Assert
        expect(() => getDB()).toThrow(/not initialized/i);
    });
});
