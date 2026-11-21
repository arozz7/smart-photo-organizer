import { describe, it, expect, vi } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('../../../electron/logger', () => ({ default: { info: vi.fn(), warn, error: vi.fn() } }));
vi.mock('../../../electron/core/services/NonFaceDeps', () => ({ getNonFaceService: () => ({ hiddenFromReviewIds: () => [1, 2] }) }));
vi.mock('../../../electron/core/services/PictureDeps', () => ({ getPictureSuggestionService: () => ({ hiddenFromReviewIds: () => [2, 3] }) }));

import { hiddenFromReview, withoutHidden, countWithoutHidden } from '../../../electron/core/services/reviewHiding';

describe('hiddenFromReview', () => {
    it('is the set of faces the Not a Face? list currently hides from Review Needed', () => {
        expect(hiddenFromReview([() => ({ hiddenFromReviewIds: () => [3, 4, 4] })])).toEqual(new Set([3, 4]));
    });

    it('hides nothing, and does not fail, when the list cannot be read (Review Needed must still show every face)', () => {
        warn.mockClear();

        const hidden = hiddenFromReview([() => ({ hiddenFromReviewIds: () => { throw new Error('face_flags is missing'); } })]);

        expect(hidden.size).toBe(0);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('face_flags is missing'));
    });

    it('uses both of the app\'s lists by default: the faces of each, once', () => {
        expect(hiddenFromReview()).toEqual(new Set([1, 2, 3]));
    });

    it('keeps hiding what the other list hides when one list cannot be read', () => {
        const hidden = hiddenFromReview([() => ({ hiddenFromReviewIds: () => { throw new Error('boom'); } }), () => ({ hiddenFromReviewIds: () => [7] })]);

        expect(hidden).toEqual(new Set([7]));
    });
});

describe('withoutHidden', () => {
    const faces = [{ id: 1 }, { id: 2 }, { id: 3 }];

    it('drops the hidden faces and keeps the order of the others', () => {
        expect(withoutHidden(faces, new Set([2]))).toEqual([{ id: 1 }, { id: 3 }]);
    });

    it('returns the same list when nothing is hidden', () => {
        expect(withoutHidden(faces, new Set())).toBe(faces);
    });
});

describe('countWithoutHidden', () => {
    it('subtracts the hidden faces from the count', () => {
        expect(countWithoutHidden(63272, new Set([1, 2, 3]))).toBe(63269);
    });

    it('never goes below zero', () => {
        expect(countWithoutHidden(2, new Set([1, 2, 3]))).toBe(0);
    });
});
