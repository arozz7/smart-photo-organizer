import { describe, it, expect } from 'vitest';
import {
    DEFAULT_PARKED_SETTINGS,
    assignShotIds,
    classifyFace,
    collectCentroids,
    faceBoxArea,
    formatUnassignedFingerprint,
    parkedSummaryCacheKey,
    summariseParked,
    type FaceMeasure,
} from '../../../../electron/core/services/parkedFaces';

const settings = DEFAULT_PARKED_SETTINGS;

/** A sharp, large face with one twin: worth reviewing. Tests change one thing. */
const good: FaceMeasure = {
    area: 40_000,
    blur: 250,
    twins: 1,
    twinsAtAlternative: 1,
    sameShot: 0,
    nearestCentroid: 1.2,
};

describe('faceBoxArea', () => {
    it('multiplies width and height from the stored box', () => {
        expect(faceBoxArea('{"x":507,"y":689,"width":117,"height":117}')).toBe(13_689);
    });

    it.each([null, '', 'not json', '{}', '{"width":10}', '{"width":-5,"height":4}', '{"width":"a","height":4}'])(
        'reports "unknown" (null) rather than a size for %j',
        raw => {
            expect(faceBoxArea(raw as string | null)).toBeNull();
        }
    );
});

describe('classifyFace', () => {
    it('keeps a clear face that has a twin for review', () => {
        expect(classifyFace(good, settings)).toEqual({ category: 'worthReviewing', nearNamed: false });
    });

    it('parks a face that is too small', () => {
        expect(classifyFace({ ...good, area: settings.minFaceArea - 1 }, settings).category).toBe('lowQuality');
    });

    it('parks a face that is too blurry', () => {
        expect(classifyFace({ ...good, blur: settings.minBlurScore - 1 }, settings).category).toBe('lowQuality');
    });

    it('does not park a face exactly at the size and blur limits', () => {
        const result = classifyFace({ ...good, area: settings.minFaceArea, blur: settings.minBlurScore }, settings);
        expect(result.category).toBe('worthReviewing');
    });

    it('does not judge quality it cannot measure', () => {
        expect(classifyFace({ ...good, area: null, blur: null }, settings).category).toBe('worthReviewing');
    });

    it('parks a clear face that appears only once', () => {
        expect(classifyFace({ ...good, twins: 0, twinsAtAlternative: 0 }, settings).category).toBe('singleton');
    });

    it('does not park a lone face that sits near a named person: it is a likely match for them', () => {
        const result = classifyFace({ ...good, twins: 0, nearestCentroid: settings.suggestionDistance }, settings);
        expect(result).toEqual({ category: 'worthReviewing', nearNamed: true });
    });

    it('parks a lone face that is just beyond the suggestion distance', () => {
        const result = classifyFace({ ...good, twins: 0, nearestCentroid: settings.suggestionDistance + 0.01 }, settings);
        expect(result.category).toBe('singleton');
    });

    it('parks a lone face when nobody is named yet (no centroids)', () => {
        expect(classifyFace({ ...good, twins: 0, nearestCentroid: null }, settings).category).toBe('singleton');
    });

    it('treats a poor-quality face as parked even when it has twins and is near a named person', () => {
        const result = classifyFace({ ...good, area: 100, nearestCentroid: 0.3 }, settings);
        expect(result).toEqual({ category: 'lowQuality', nearNamed: false });
    });
});

describe('summariseParked', () => {
    it('counts each group and defines parked as low quality plus singletons', () => {
        const measures: FaceMeasure[] = [
            good,
            good,
            { ...good, area: 100 },
            { ...good, blur: 5 },
            { ...good, twins: 0, twinsAtAlternative: 0 },
            { ...good, twins: 0, twinsAtAlternative: 0, nearestCentroid: 0.5 },
        ];

        const summary = summariseParked(measures, settings);

        expect(summary).toMatchObject({
            unassigned: 6,
            lowQuality: 2,
            singleton: 1,
            nearNamed: 1,
            parked: 3,
            worthReviewing: 3,
        });
    });

    it('always has worthReviewing + parked equal to the unassigned total', () => {
        const measures = Array.from({ length: 50 }, (_, i): FaceMeasure => ({
            ...good,
            area: i % 7 === 0 ? 50 : 40_000,
            twins: i % 3 === 0 ? 0 : 2,
            nearestCentroid: i % 5 === 0 ? 0.4 : null,
        }));

        const summary = summariseParked(measures, settings);

        expect(summary.worthReviewing + summary.parked).toBe(summary.unassigned);
    });

    it('reports faces whose only close faces are the same shot saved again, whether or not a named person is near', () => {
        const measures: FaceMeasure[] = [
            { ...good, twins: 0, twinsAtAlternative: 0, sameShot: 3 },
            { ...good, twins: 0, twinsAtAlternative: 0, sameShot: 2, nearestCentroid: 0.4 },
            { ...good, twins: 0, twinsAtAlternative: 0, sameShot: 0 },
            { ...good, twins: 2, sameShot: 4 },
            { ...good, area: 50, twins: 0, sameShot: 5 },
        ];

        expect(summariseParked(measures, settings).sameShotOnly).toBe(2);
    });

    it('shows how many lone, clear faces lie within each of several distances of a named person', () => {
        const lone = (nearestCentroid: number | null): FaceMeasure => ({ ...good, twins: 0, twinsAtAlternative: 0, nearestCentroid });
        const measures: FaceMeasure[] = [
            lone(0.3), lone(0.55), lone(0.65), lone(0.75), lone(0.95), lone(null),
            { ...good, nearestCentroid: 0.1 },                  // has a twin: not a lone face
            { ...good, twins: 0, area: 50, nearestCentroid: 0.1 }, // low quality: not counted
        ];

        const counts = summariseParked(measures, settings).nearNamedByDistance;

        expect(counts).toEqual([
            { distance: 0.5, count: 1 },
            { distance: 0.6, count: 2 },
            { distance: 0.7, count: 3 },
            { distance: 0.8, count: 4 },
        ]);
    });

    it('shows how many more faces would be singletons at the alternative (looser) distance', () => {
        const measures: FaceMeasure[] = [
            { ...good, twins: 0, twinsAtAlternative: 0 },
            { ...good, twins: 0, twinsAtAlternative: 2 },
            { ...good, twins: 1, twinsAtAlternative: 1 },
        ];

        const summary = summariseParked(measures, settings);

        expect(summary.singleton).toBe(2);
        expect(summary.singletonAtAlternativeDistance).toBe(1);
    });

    it('handles an empty library', () => {
        expect(summariseParked([], settings)).toMatchObject({ unassigned: 0, parked: 0, worthReviewing: 0 });
    });

    it('records the settings the numbers were computed with', () => {
        expect(summariseParked([good], settings).settings).toEqual(settings);
    });
});

describe('assignShotIds', () => {
    const shot = (photoId: number, filePath: string | null, dateTaken: string | null) => ({ photoId, filePath, dateTaken });

    it('gives faces of one photo the same shot', () => {
        const ids = assignShotIds([shot(1, 'C:\\a\\1.jpg', null), shot(1, 'C:\\a\\1.jpg', null), shot(2, 'C:\\a\\2.jpg', null)]);

        expect(ids[0]).toBe(ids[1]);
        expect(ids[0]).not.toBe(ids[2]);
    });

    it('treats a RAW file and its exported JPG (same folder, same name) as one shot, ignoring case', () => {
        const ids = assignShotIds([shot(1, 'D:\\Trip\\IMG_0042.CR2', null), shot(2, 'd:\\trip\\img_0042.jpg', null), shot(3, 'D:\\Trip\\IMG_0043.jpg', null)]);

        expect(ids[0]).toBe(ids[1]);
        expect(ids[2]).not.toBe(ids[0]);
    });

    it('does not join files with the same name in different folders', () => {
        const ids = assignShotIds([shot(1, 'D:\\A\\IMG_1.jpg', null), shot(2, 'D:\\B\\IMG_1.jpg', null)]);

        expect(ids[0]).not.toBe(ids[1]);
    });

    it('understands forward slashes too', () => {
        const ids = assignShotIds([shot(1, 'D:/Trip/IMG_1.CR2', null), shot(2, 'D:/Trip/IMG_1.jpg', null)]);

        expect(ids[0]).toBe(ids[1]);
    });

    it('joins photos taken in the same second, wherever they are stored (an export in another folder)', () => {
        const ids = assignShotIds([
            shot(1, 'D:\\Raw\\a.cr2', '2024-05-01T10:00:00'),
            shot(2, 'D:\\Exports\\b.jpg', '2024-05-01T10:00:00'),
            shot(3, 'D:\\Raw\\c.cr2', '2024-05-01T10:00:01'),
        ]);

        expect(ids[0]).toBe(ids[1]);
        expect(ids[2]).not.toBe(ids[0]);
    });

    it('chains shots: same name joins A and B, same second joins B and C', () => {
        const ids = assignShotIds([
            shot(1, 'D:\\T\\x.cr2', null),
            shot(2, 'D:\\T\\x.jpg', '2024-05-01T10:00:00'),
            shot(3, 'D:\\E\\y.jpg', '2024-05-01T10:00:00'),
        ]);

        expect(new Set(ids).size).toBe(1);
    });

    it('ignores a capture time shared by many photos: that is a placeholder date, not one moment', () => {
        const photos = Array.from({ length: 30 }, (_, i) => shot(i + 1, `D:\\F\\${i}.jpg`, '2000-01-01T12:00:00'));

        expect(new Set(assignShotIds(photos)).size).toBe(30);
    });

    it('still joins a capture time shared by a small burst', () => {
        const photos = Array.from({ length: 5 }, (_, i) => shot(i + 1, `D:\\F\\${i}.jpg`, '2024-05-01T10:00:00'));

        expect(new Set(assignShotIds(photos)).size).toBe(1);
    });

    it('copes with missing paths and times', () => {
        const ids = assignShotIds([shot(1, null, null), shot(2, '', ''), shot(3, null, null)]);

        expect(new Set(ids).size).toBe(3);
    });

    it('returns nothing for no faces', () => {
        expect(assignShotIds([])).toEqual([]);
    });
});

describe('collectCentroids', () => {
    const vec = (value: number) => Array.from({ length: 4 }, () => value);

    it('gathers the overall, era and pose centroids of every human', () => {
        const people = [
            { entity_type: 'human', descriptor: vec(1), eras: [{ centroid: vec(2) }], poseCentroids: [vec(3), vec(4)] },
            { entity_type: 'human', descriptor: vec(5), eras: [], poseCentroids: [] },
        ];

        expect(collectCentroids(people, 4)).toEqual([vec(1), vec(2), vec(3), vec(4), vec(5)]);
    });

    it('leaves out pets: unassigned faces are compared with human people only', () => {
        const people = [{ entity_type: 'pet', descriptor: vec(1), eras: [], poseCentroids: [] }, { descriptor: vec(2), eras: [], poseCentroids: [] }];

        expect(collectCentroids(people, 4)).toEqual([vec(2)]);
    });

    it('leaves out centroids of the wrong length or missing, instead of failing', () => {
        const people = [{ entity_type: 'human', descriptor: [1, 2], eras: [{ centroid: null }, {}], poseCentroids: [vec(3), null] }];

        expect(collectCentroids(people as never, 4)).toEqual([vec(3)]);
    });

    it('returns nothing when nobody is named', () => {
        expect(collectCentroids([], 4)).toEqual([]);
    });
});

describe('cache key', () => {
    const fingerprint = { count: 10, idSum: 55, idSquareSum: 385 };

    it('formats the unassigned-face fingerprint', () => {
        expect(formatUnassignedFingerprint(fingerprint)).toBe('10:55:385');
    });

    it('is the same for the same faces, centroids and settings', () => {
        const a = parkedSummaryCacheKey(fingerprint, 'abc', settings);
        const b = parkedSummaryCacheKey({ ...fingerprint }, 'abc', { ...settings });
        expect(a).toBe(b);
    });

    it('changes when a face is added or removed', () => {
        expect(parkedSummaryCacheKey({ ...fingerprint, count: 11 }, 'abc', settings)).not.toBe(parkedSummaryCacheKey(fingerprint, 'abc', settings));
    });

    it('changes when a different face replaces one (same count)', () => {
        const swapped = { count: 10, idSum: 56, idSquareSum: 386 };
        expect(parkedSummaryCacheKey(swapped, 'abc', settings)).not.toBe(parkedSummaryCacheKey(fingerprint, 'abc', settings));
    });

    it('changes when the named people change', () => {
        expect(parkedSummaryCacheKey(fingerprint, 'xyz', settings)).not.toBe(parkedSummaryCacheKey(fingerprint, 'abc', settings));
    });

    it('changes when a threshold changes', () => {
        const stricter = { ...settings, minFaceArea: settings.minFaceArea + 1 };
        expect(parkedSummaryCacheKey(fingerprint, 'abc', stricter)).not.toBe(parkedSummaryCacheKey(fingerprint, 'abc', settings));
    });
});
