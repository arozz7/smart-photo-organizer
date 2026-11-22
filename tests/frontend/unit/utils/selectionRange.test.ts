import { describe, it, expect } from 'vitest';
import { idsBetween } from '../../../../src/utils/selectionRange';

describe('idsBetween', () => {
    const ids = [10, 20, 30, 40, 50];

    it('is every id from the anchor to the target, both included, in list order', () => {
        expect(idsBetween(ids, 20, 40)).toEqual([20, 30, 40]);
    });

    it('works backwards, from a lower face up to a higher one', () => {
        expect(idsBetween(ids, 50, 30)).toEqual([30, 40, 50]);
    });

    it('is just the face itself when anchor and target are the same', () => {
        expect(idsBetween(ids, 30, 30)).toEqual([30]);
    });

    it('is only the target when the anchor is not in the list (it was removed or never selectable)', () => {
        expect(idsBetween(ids, 99, 30)).toEqual([30]);
    });

    it('is empty when the target is not in the list', () => {
        expect(idsBetween(ids, 20, 99)).toEqual([]);
    });
});
