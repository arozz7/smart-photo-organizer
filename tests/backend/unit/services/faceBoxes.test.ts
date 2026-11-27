import { describe, it, expect } from 'vitest';
import { boxIoU, boxIoMin } from '../../../../electron/core/services/faceBoxes';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('boxIoU (overlap over union)', () => {
    it('is 1 for the same box', () => {
        expect(boxIoU(box(0, 0, 100, 100), box(0, 0, 100, 100))).toBe(1);
    });

    it('is 0 for boxes that do not touch', () => {
        expect(boxIoU(box(0, 0, 100, 100), box(200, 200, 100, 100))).toBe(0);
    });

    it('is the shared area over the combined area for partial overlap', () => {
        // 50x100 shared; union = 10000 + 10000 - 5000
        expect(boxIoU(box(0, 0, 100, 100), box(50, 0, 100, 100))).toBeCloseTo(5000 / 15000);
    });

    it('is 0 when both boxes are empty', () => {
        expect(boxIoU(box(0, 0, 0, 0), box(0, 0, 0, 0))).toBe(0);
    });
});

describe('boxIoMin (overlap over the smaller box)', () => {
    it('is 1 when the small box sits fully inside the big one', () => {
        expect(boxIoMin(box(0, 0, 200, 200), box(20, 20, 50, 50))).toBe(1);
    });

    it('is 0 for boxes that do not touch', () => {
        expect(boxIoMin(box(0, 0, 100, 100), box(200, 200, 100, 100))).toBe(0);
    });

    it('is 0 when one box is empty', () => {
        expect(boxIoMin(box(0, 0, 0, 0), box(0, 0, 100, 100))).toBe(0);
    });
});
