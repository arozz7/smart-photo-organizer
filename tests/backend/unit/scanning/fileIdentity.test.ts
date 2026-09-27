import { describe, it, expect } from 'vitest';
import {
    compareIdentity,
    MTIME_TOLERANCE_MS,
    toFileId,
    type FileIdentity,
} from '../../../../electron/scanning/fileIdentity';

const current = (overrides: Partial<FileIdentity> = {}): FileIdentity => ({ size: 1000, mtime: 1_700_000_000_000, fileId: '5:77', ...overrides });

describe('toFileId', () => {
    it('combines the volume and the file index, so equal indexes on different volumes never look like the same file', () => {
        expect(toFileId(5n, 77n)).toBe('5:77');
        expect(toFileId(6n, 77n)).not.toBe(toFileId(5n, 77n));
    });

    it('is null when the filesystem gives no usable file index (network shares, some exFAT setups report 0)', () => {
        expect(toFileId(5n, 0n)).toBeNull();
    });

    it('keeps 64-bit file indexes exact (they exceed what a JavaScript number can hold)', () => {
        expect(toFileId(1n, 9007199254740993n)).toBe('1:9007199254740993');
    });
});

describe('compareIdentity', () => {
    it("says 'identity-missing' when nothing was recorded yet, so the values are filled in, not treated as an edit", () => {
        expect(compareIdentity({ size: null, mtime: null }, current())).toBe('identity-missing');
        expect(compareIdentity({ size: 1000, mtime: null }, current())).toBe('identity-missing');
        expect(compareIdentity({ size: null, mtime: 5 }, current())).toBe('identity-missing');
    });

    it("says 'unchanged' when size and time match", () => {
        expect(compareIdentity({ size: 1000, mtime: 1_700_000_000_000 }, current())).toBe('unchanged');
    });

    it('ignores timestamp jitter up to the tolerance (FAT stores time in 2-second steps)', () => {
        expect(compareIdentity({ size: 1000, mtime: 1_700_000_000_000 - MTIME_TOLERANCE_MS }, current())).toBe('unchanged');
        expect(compareIdentity({ size: 1000, mtime: 1_700_000_000_000 + MTIME_TOLERANCE_MS }, current())).toBe('unchanged');
    });

    it("says 'changed' when the size differs, whatever the timestamp", () => {
        expect(compareIdentity({ size: 999, mtime: 1_700_000_000_000 }, current())).toBe('changed');
    });

    it("asks for a content check ('needs-hash-check') when only the timestamp moved beyond the tolerance", () => {
        expect(compareIdentity({ size: 1000, mtime: 1_700_000_000_000 - MTIME_TOLERANCE_MS - 1 }, current())).toBe('needs-hash-check');
        expect(compareIdentity({ size: 1000, mtime: 1_600_000_000_000 }, current())).toBe('needs-hash-check');
    });
});
