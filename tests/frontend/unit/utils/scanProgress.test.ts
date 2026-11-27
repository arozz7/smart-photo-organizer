import { describe, it, expect } from 'vitest';
import { describeScanProgress, estimateRemainingMs, formatDuration } from '../../../../src/utils/scanProgress';

describe('estimateRemainingMs', () => {
    it('is unknown until enough files and time have passed to be meaningful', () => {
        expect(estimateRemainingMs(3, 1000, 2000)).toBeNull();
        expect(estimateRemainingMs(100, 1000, 500)).toBeNull();
    });

    it('extrapolates from the speed so far', () => {
        // 100 files in 10 s: the other 900 take 90 s
        expect(estimateRemainingMs(100, 1000, 10_000)).toBe(90_000);
    });
});

describe('formatDuration', () => {
    it.each([
        [45_000, '45 s'],
        [90_000, '2 min'],
        [3_600_000, '1 h 0 min'],
        [5_400_000, '1 h 30 min'],
    ])('%i ms is %s', (ms, text) => expect(formatDuration(ms)).toBe(text));
});

describe('describeScanProgress', () => {
    it('says it is looking for files before the total is known', () => {
        expect(describeScanProgress({ phase: 'collecting', done: 0, total: 0, folder: '' }, 0)).toBe('Looking for photos…');
    });

    it('shows done of total, the folder and the time left', () => {
        const text = describeScanProgress({ phase: 'processing', done: 412, total: 5354, folder: 'R:\\Pictures\\2013\\Orlando Trip\\April 07' }, 40_000);

        expect(text).toContain('412 of 5,354');
        expect(text).toContain('April 07');
        expect(text).toMatch(/left/);
    });

    it('omits the time left when it cannot be estimated', () => {
        const text = describeScanProgress({ phase: 'processing', done: 3, total: 5354, folder: 'D:\\a' }, 1000);

        expect(text).not.toMatch(/left/);
    });
});
