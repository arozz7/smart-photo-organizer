import { describe, it, expect } from 'vitest';
import { toUngroupableCentroids } from '../../../electron/core/services/ungroupableCentroids';

const person = (id: number, name: string, descriptor: number[] | null) => ({ id, name, descriptor, entity_type: 'human', eras: [], poseCentroids: [] });

describe('toUngroupableCentroids', () => {
    it('gives one centroid per named person, with the name and id Python reports back', () => {
        const result = toUngroupableCentroids([person(1, 'Alex', [0.1, 0.2]), person(2, 'Sam', [0.3, 0.4])]);

        expect(result).toEqual([
            { descriptor: [0.1, 0.2], name: 'Alex', personId: 1 },
            { descriptor: [0.3, 0.4], name: 'Sam', personId: 2 },
        ]);
    });

    it('leaves out a person who has no centroid yet', () => {
        const result = toUngroupableCentroids([person(1, 'Alex', null), person(2, 'Sam', []), person(3, 'Kim', [0.5])]);

        expect(result.map(c => c.personId)).toEqual([3]);
    });

    it('gives nothing when nobody is named', () => {
        expect(toUngroupableCentroids([])).toEqual([]);
    });
});
