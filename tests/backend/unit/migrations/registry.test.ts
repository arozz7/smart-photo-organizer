import { describe, it, expect } from 'vitest';
import { MIGRATIONS } from '../../../../electron/data/migrations';

describe('migration registry', () => {
    it('has unique, contiguous versions starting at 1 (no gaps that would hide a missing migration)', () => {
        // Arrange
        const versions = MIGRATIONS.map(m => m.version);

        // Assert
        expect(versions).toEqual(versions.map((_, index) => index + 1));
    });

    it('gives every migration a unique, non-empty name', () => {
        // Arrange
        const names = MIGRATIONS.map(m => m.name);

        // Assert
        expect(names.every(n => n.trim().length > 0)).toBe(true);
        expect(new Set(names).size).toBe(names.length);
    });
});
