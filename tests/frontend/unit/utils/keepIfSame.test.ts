import { describe, it, expect } from 'vitest';
import { keepIfSame } from '../../../../src/utils/keepIfSame';

describe('keepIfSame', () => {
    it('keeps the previous object when the new one has the same values (so React sees no change)', () => {
        const previous = { active: true, offset: 5, total: 10, remaining: 5 };

        const result = keepIfSame(previous, { active: true, offset: 5, total: 10, remaining: 5 });

        expect(result).toBe(previous);
    });

    it('takes the new object when a value changed', () => {
        const previous = { active: true, offset: 5, total: 10, remaining: 5 };
        const next = { active: true, offset: 6, total: 10, remaining: 4 };

        expect(keepIfSame(previous, next)).toBe(next);
    });

    it('works for nested status objects and for a first value', () => {
        const previous = { system: { python: '3.11', cuda_available: true }, list: [1, 2] };

        expect(keepIfSame(previous, { system: { python: '3.11', cuda_available: true }, list: [1, 2] })).toBe(previous);
        expect(keepIfSame(previous, { system: { python: '3.11', cuda_available: false }, list: [1, 2] })).not.toBe(previous);
        expect(keepIfSame<{ a: number } | null>(null, { a: 1 })).toEqual({ a: 1 });
    });
});
