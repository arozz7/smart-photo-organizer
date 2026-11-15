import { describe, it, expect } from 'vitest';
import { batchPaths, quotedLength } from '../../../../electron/core/services/sendTo/PathBatcher';

const EXE = 'C:\\Program Files\\ClearFrame\\ClearFrame.exe';

describe('quotedLength', () => {
    it('counts the quotes and the separating space around a path', () => {
        expect(quotedLength('a.jpg')).toBe('a.jpg'.length + 3);
    });

    it('counts a backslash before a quote as two characters (Windows escaping)', () => {
        // A trailing backslash must be doubled so it does not escape the closing quote.
        expect(quotedLength('C:\\Photos\\')).toBe('C:\\Photos\\'.length + 1 + 3);
    });
});

describe('batchPaths', () => {
    it('returns no batches for no paths', () => {
        expect(batchPaths([], { exePath: EXE, maxCommandChars: 1000 })).toEqual({ batches: [], oversized: [] });
    });

    it('keeps every path in one batch when the command line is short', () => {
        const paths = ['C:\\a.jpg', 'C:\\b.jpg', 'C:\\c.jpg'];

        const result = batchPaths(paths, { exePath: EXE, maxCommandChars: 1000 });

        expect(result.batches).toEqual([paths]);
    });

    it('splits into several batches that each fit the budget, keeping the order', () => {
        const paths = Array.from({ length: 10 }, (_, i) => `C:\\Photos\\photo-${i}.jpg`);
        const maxCommandChars = quotedLength(EXE) + 3 * quotedLength(paths[0]);

        const result = batchPaths(paths, { exePath: EXE, maxCommandChars });

        expect(result.batches.map(b => b.length)).toEqual([3, 3, 3, 1]);
        expect(result.batches.flat()).toEqual(paths);
        for (const batch of result.batches) {
            const total = quotedLength(EXE) + batch.reduce((sum, p) => sum + quotedLength(p), 0);
            expect(total).toBeLessThanOrEqual(maxCommandChars);
        }
    });

    it('accepts a batch that exactly fills the budget', () => {
        const paths = ['C:\\a.jpg', 'C:\\b.jpg'];
        const maxCommandChars = quotedLength(EXE) + quotedLength(paths[0]) + quotedLength(paths[1]);

        const result = batchPaths(paths, { exePath: EXE, maxCommandChars });

        expect(result.batches).toEqual([paths]);
    });

    it('reports a single path that can never fit, instead of sending it', () => {
        const tooLong = `C:\\${'x'.repeat(200)}.jpg`;
        const result = batchPaths(['C:\\ok.jpg', tooLong], { exePath: EXE, maxCommandChars: 150 });

        expect(result.batches).toEqual([['C:\\ok.jpg']]);
        expect(result.oversized).toEqual([tooLong]);
    });

    it('handles unicode and spaces in paths', () => {
        const paths = ['C:\\Fotos\\Zürich 2024\\bild ä.jpg', 'D:\\写真\\家族.jpg'];

        const result = batchPaths(paths, { exePath: EXE, maxCommandChars: 1000 });

        expect(result.batches).toEqual([paths]);
    });
});
