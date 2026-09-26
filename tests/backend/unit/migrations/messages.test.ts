import { describe, it, expect } from 'vitest';
import { describeDowngrade, describeMigrationFailure } from '../../../../electron/data/migrations/messages';
import { MigrationError } from '../../../../electron/data/migrations/types';

describe('describeMigrationFailure', () => {
    it('names the failing version and tells the user where the backup is', () => {
        // Arrange
        const error = new MigrationError('Migration 3 (add_x) failed', 3, new Error('boom'), 'D:/Library/backups/library.v0-to-v3.db');

        // Act
        const { title, message } = describeMigrationFailure(error);

        // Assert
        expect(title).toMatch(/upgrade/i);
        expect(message).toContain('Migration 3 (add_x) failed');
        expect(message).toContain('D:/Library/backups/library.v0-to-v3.db');
        expect(message).toMatch(/not modified|unchanged|rolled back/i);
    });

    it('explains that no changes were made when the backup itself could not be written', () => {
        // Arrange
        const error = new MigrationError('Could not back up the database before migrating', 1, new Error('disk full'));

        // Act
        const { message } = describeMigrationFailure(error);

        // Assert
        expect(message).toContain('Could not back up the database before migrating');
        expect(message).toMatch(/no changes were made/i);
        expect(message.toLowerCase()).not.toContain('backup taken');
    });
});

describe('describeDowngrade', () => {
    it('warns that the library was written by a newer version, without alarming wording', () => {
        // Act
        const { title, message } = describeDowngrade({ fromVersion: 5, toVersion: 5, applied: [], downgradeDetected: true });

        // Assert
        expect(title).toMatch(/newer version/i);
        expect(message).toContain('5');
        expect(message).toMatch(/still (open|work)|safe/i);
    });
});
