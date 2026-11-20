import { describe, it, expect } from 'vitest';
import {
    ProfileIndex,
    resolvePerPhoto,
    unitVector,
    l2Distance,
    type ProfileExample,
    type FaceSuggestion,
} from '../../../../electron/core/services/ProfileSuggester';

/** Unit vectors on a circle: the L2 distance between two of them is 2 * sin(angle difference / 2). */
const angleOf = (distance: number) => 2 * Math.asin(distance / 2);
const onCircle = (angle: number) => Float32Array.from([Math.cos(angle), Math.sin(angle), 0, 0]);

const example = (faceId: number, personId: number, photoId: number, angle: number): ProfileExample => ({ faceId, personId, photoId, vector: onCircle(angle) });
const never = () => false;

describe('unitVector', () => {
    it('scales a stored descriptor (length about 20) to length 1, and leaves a unit one alone', () => {
        const scaled = unitVector([20, 0, 0, 0])!;
        const unit = unitVector([0, 1, 0, 0])!;

        expect(Array.from(scaled)).toEqual([1, 0, 0, 0]);
        expect(Array.from(unit)).toEqual([0, 1, 0, 0]);
    });

    it('refuses an all-zero or non-finite descriptor', () => {
        expect(unitVector([0, 0, 0, 0])).toBeNull();
        expect(unitVector([1, Number.NaN, 0, 0])).toBeNull();
        expect(unitVector([])).toBeNull();
    });
});

describe('l2Distance', () => {
    it('matches 2 * sin(angle / 2) for unit vectors', () => {
        expect(l2Distance(onCircle(0), onCircle(angleOf(0.9)))).toBeCloseTo(0.9, 5);
    });
});

describe('ProfileIndex.find', () => {
    const base = angleOf(0.9);
    const candidate = { faceId: 100, photoId: 1, vector: onCircle(base) };
    /** The angle of an example that lies exactly `distance` from the candidate (an example at angle 0 lies 0.9 from it). */
    const at = (distance: number, side = 1) => base + side * angleOf(distance);

    it('suggests the person whose nearest example is within the distance', () => {
        const index = new ProfileIndex([example(1, 10, 2, 0), example(2, 10, 3, at(0.4))]);

        const matches = index.find(candidate, 1.0, never);

        expect(matches).toHaveLength(1);
        expect(matches[0].personId).toBe(10);
        expect(matches[0].distance).toBeCloseTo(0.4, 3);
        expect(matches[0].exampleFaceIds).toEqual([2, 1]);
    });

    it('suggests nobody when every example is farther than the distance', () => {
        const index = new ProfileIndex([example(1, 10, 2, 0)]);

        expect(index.find(candidate, 0.8, never)).toEqual([]);
    });

    it('counts a distance equal to the setting as within it', () => {
        const index = new ProfileIndex([example(1, 10, 2, 0)]);

        expect(index.find(candidate, 0.9 + 1e-6, never)).toHaveLength(1);
    });

    it('ignores examples from the same photo as the face', () => {
        const index = new ProfileIndex([example(1, 10, 1, 0)]);

        expect(index.find(candidate, 1.0, never)).toEqual([]);
    });

    it('skips a person the caller excludes (already in the photo, or dismissed for this face)', () => {
        const index = new ProfileIndex([example(1, 10, 2, 0), example(2, 11, 3, at(0.7))]);

        const matches = index.find(candidate, 1.0, personId => personId === 10);

        expect(matches.map(match => match.personId)).toEqual([11]);
    });

    it('returns both names, nearest first, when two people are within the distance', () => {
        const index = new ProfileIndex([example(1, 10, 2, 0), example(2, 11, 3, at(0.7))]);

        const matches = index.find(candidate, 1.0, never);

        expect(matches.map(match => match.personId)).toEqual([11, 10]);
        expect(matches[0].distance).toBeCloseTo(0.7, 3);
        expect(matches[1].distance).toBeCloseTo(0.9, 3);
    });

    it('returns at most two names', () => {
        const index = new ProfileIndex([
            example(1, 10, 2, 0),
            example(2, 11, 3, at(0.7)),
            example(3, 12, 4, at(0.8, -1)),
        ]);

        expect(index.find(candidate, 1.0, never)).toHaveLength(2);
    });

    it('keeps the two nearest examples of the suggested person, nearest first', () => {
        const index = new ProfileIndex([example(1, 10, 2, 0), example(2, 10, 3, at(0.6)), example(3, 10, 4, at(0.7, -1))]);

        const [match] = index.find(candidate, 1.0, never);

        expect(match.exampleFaceIds).toEqual([2, 3]);
    });
});

describe('resolvePerPhoto', () => {
    const suggestion = (faceId: number, photoId: number, names: [number, number][]): FaceSuggestion => ({
        faceId,
        photoId,
        matches: names.map(([personId, distance]) => ({ personId, distance, exampleFaceIds: [] })),
    });

    it('gives a person to only the nearest face of a photo, and drops the other when it has no second name', () => {
        const resolved = resolvePerPhoto([suggestion(1, 5, [[10, 0.9]]), suggestion(2, 5, [[10, 0.7]])]);

        expect(resolved.map(s => s.faceId)).toEqual([2]);
    });

    it('lets the face that lost the person fall back to its second name', () => {
        const resolved = resolvePerPhoto([suggestion(1, 5, [[10, 0.9], [11, 0.95]]), suggestion(2, 5, [[10, 0.7]])]);

        expect(resolved.map(s => [s.faceId, s.matches.map(m => m.personId)])).toEqual([[2, [10]], [1, [11]]]);
    });

    it('does not mix photos: the same person may be suggested once in each photo', () => {
        const resolved = resolvePerPhoto([suggestion(1, 5, [[10, 0.9]]), suggestion(2, 6, [[10, 0.7]])]);

        expect(resolved).toHaveLength(2);
    });

    it('lists the nearest suggestions first', () => {
        const resolved = resolvePerPhoto([suggestion(1, 5, [[10, 0.9]]), suggestion(2, 6, [[11, 0.5]]), suggestion(3, 7, [[12, 0.7]])]);

        expect(resolved.map(s => s.faceId)).toEqual([2, 3, 1]);
    });
});
