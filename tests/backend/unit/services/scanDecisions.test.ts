import { describe, it, expect } from 'vitest';
import {
    findOverlapGarbage, findExistingFace, findRejectingFace, screenNewDetection, decideAssignment,
    type StoredFace,
} from '../../../../electron/core/services/scanDecisions';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const stored = (id: number, b = box(0, 0, 100, 100), extra: Partial<StoredFace> = {}): StoredFace => ({ id, box: b, ...extra });

describe('findOverlapGarbage', () => {
    it('picks the lower-scoring face of two on top of each other', () => {
        const ids = findOverlapGarbage([stored(1, box(0, 0, 100, 100), { score: 0.6 }), stored(2, box(2, 2, 100, 100), { score: 0.9 })], 0.55);

        expect([...ids]).toEqual([1]);
    });

    it('keeps a confirmed face even when it scores lower', () => {
        const ids = findOverlapGarbage([stored(1, box(0, 0, 100, 100), { score: 0.6, is_confirmed: 1 }), stored(2, box(2, 2, 100, 100), { score: 0.9 })], 0.55);

        expect([...ids]).toEqual([2]);
    });

    it('keeps both when both are confirmed', () => {
        const ids = findOverlapGarbage([stored(1, box(0, 0, 100, 100), { score: 0.6, is_confirmed: 1 }), stored(2, box(2, 2, 100, 100), { score: 0.9, is_confirmed: 1 })], 0.55);

        expect(ids.size).toBe(0);
    });

    it('leaves faces that do not overlap enough', () => {
        expect(findOverlapGarbage([stored(1, box(0, 0, 100, 100)), stored(2, box(80, 80, 100, 100))], 0.55).size).toBe(0);
    });
});

describe('findExistingFace', () => {
    const existing = [stored(1, box(0, 0, 100, 100)), stored(2, box(500, 500, 100, 100))];

    it('finds the stored face with the best overlap', () => {
        expect(findExistingFace(box(2, 2, 100, 100), existing, new Set(), 0.55)).toMatchObject({ face: { id: 1 }, clash: false });
    });

    it('finds nothing when no stored face overlaps enough', () => {
        expect(findExistingFace(box(250, 250, 100, 100), existing, new Set(), 0.55)).toMatchObject({ face: null, clash: false });
    });

    it('reports a clash, and no face, when another detection already took the stored face', () => {
        expect(findExistingFace(box(2, 2, 100, 100), existing, new Set([1]), 0.55)).toMatchObject({ face: null, clash: true });
    });
});

describe('findRejectingFace', () => {
    it('returns the thrown-out face that covers more than half of the detection', () => {
        expect(findRejectingFace(box(20, 20, 100, 100), [stored(9, box(0, 0, 200, 200))])?.id).toBe(9);
    });

    it('returns null when the overlap is half or less', () => {
        expect(findRejectingFace(box(150, 150, 100, 100), [stored(9, box(0, 0, 200, 200))])).toBeNull();
    });

    it('returns null when nothing was thrown out', () => {
        expect(findRejectingFace(box(0, 0, 100, 100), [])).toBeNull();
    });
});

describe('screenNewDetection', () => {
    const t = { rejectFloor: 0.4, largeFaceWidth: 300 };

    it('keeps a detection at or above the reject line', () => {
        expect(screenNewDetection(0.4, box(0, 0, 100, 100), t)).toEqual({ keep: true, byException: false });
    });

    it('drops a low score on a small box', () => {
        expect(screenNewDetection(0.3, box(0, 0, 200, 220), t)).toMatchObject({ keep: false });
    });

    it('keeps a low score on a large box as an exception', () => {
        expect(screenNewDetection(0.3, box(0, 0, 400, 420), t)).toEqual({ keep: true, byException: true });
    });

    it('drops a large box scoring under 0.15', () => {
        expect(screenNewDetection(0.12, box(0, 0, 400, 420), t)).toMatchObject({ keep: false });
    });

    it('drops a large square box unless it scores above 0.25', () => {
        expect(screenNewDetection(0.2, box(0, 0, 400, 400), t)).toMatchObject({ keep: false });
        expect(screenNewDetection(0.26, box(0, 0, 400, 400), t)).toMatchObject({ keep: true });
    });

    it('follows the large-face width', () => {
        expect(screenNewDetection(0.3, box(0, 0, 400, 420), { rejectFloor: 0.4, largeFaceWidth: 500 })).toMatchObject({ keep: false });
    });
});

describe('decideAssignment', () => {
    const thresholds = { autoAssign: 0.7, review: 0.9 };
    const fresh = { personId: null, suggestedPersonId: null, tier: 'unknown', source: 'ai_scan', confirmed: 0, matchDistance: null };
    const match = (distance: number, personId = 7) => ({ personId, personName: 'P', similarity: 0.8, distance, matchType: 'faiss' as const });

    it('assigns a close match for a solid detection and marks it unconfirmed from the scan', () => {
        expect(decideAssignment(fresh, match(0.3), true, 0.5, thresholds)).toMatchObject({
            personId: 7, suggestedPersonId: 7, tier: 'high', source: 'auto_scan', confirmed: 0, matchDistance: 0.3, newlyAssigned: true,
        });
    });

    it('only suggests a close match for a weak detection', () => {
        expect(decideAssignment(fresh, match(0.3), false, 0.5, thresholds)).toMatchObject({ personId: null, suggestedPersonId: 7, tier: 'review', newlyAssigned: false });
    });

    it('suggests a match between the two lines', () => {
        expect(decideAssignment(fresh, match(0.8), true, 0.5, thresholds)).toMatchObject({ personId: null, suggestedPersonId: 7, tier: 'review' });
    });

    it('does nothing with a match beyond the review line, but records its distance', () => {
        expect(decideAssignment(fresh, match(1.2), true, 0.5, thresholds)).toMatchObject({ personId: null, suggestedPersonId: null, tier: 'unknown', matchDistance: 1.2 });
    });

    it('never changes a face that already has a person', () => {
        const current = { ...fresh, personId: 4, tier: 'high', source: 'manual', confirmed: 1 };

        expect(decideAssignment(current, match(0.1, 7), true, 0.5, thresholds)).toMatchObject({ personId: 4, source: 'manual', confirmed: 1, newlyAssigned: false });
    });

    it('leaves everything as it was when there is no match', () => {
        expect(decideAssignment(fresh, null, true, 0.5, thresholds)).toMatchObject({ ...fresh, newlyAssigned: false });
    });
});
