import { describe, it, expect, vi } from 'vitest';
import { extractDimensions, geometryChanged, normalizeOrientation, resolveDateTaken } from '../../../../electron/scanning/imageMetadata';

describe('normalizeOrientation', () => {
    it('treats a missing or unrecognised orientation as normal (1), so an editor adding an explicit "Horizontal" is not a change', () => {
        expect(normalizeOrientation(undefined)).toBe(1);
        expect(normalizeOrientation(null)).toBe(1);
        expect(normalizeOrientation('something odd')).toBe(1);
        expect(normalizeOrientation('Horizontal (normal)')).toBe(1);
    });

    it.each([[1, 1], [3, 3], [6, 6], [8, 8]])('keeps the numeric orientation %s', (value, expected) => {
        expect(normalizeOrientation(value)).toBe(expected);
    });

    it.each([['Rotate 180', 3], ['Rotate 90 CW', 6], ['Rotate 270 CW', 8]])('maps ExifTool text "%s" to %s', (text, expected) => {
        expect(normalizeOrientation(text)).toBe(expected);
    });
});

describe('geometryChanged', () => {
    const before = { width: 4000, height: 3000, orientation: 1 };

    it('is false when nothing about the picture geometry changed', () => {
        expect(geometryChanged(before, { ...before })).toBe(false);
    });

    it('is true when the dimensions change (crop, resize)', () => {
        expect(geometryChanged(before, { ...before, width: 3000 })).toBe(true);
        expect(geometryChanged(before, { ...before, height: 2000 })).toBe(true);
    });

    it('is true when the orientation changes, even a 180 degree turn that keeps the dimensions', () => {
        expect(geometryChanged(before, { ...before, orientation: 3 })).toBe(true);
    });

    it('is false when a missing orientation becomes an explicit normal one', () => {
        expect(geometryChanged({ ...before, orientation: normalizeOrientation(undefined) }, { ...before, orientation: normalizeOrientation('Horizontal (normal)') })).toBe(false);
    });

    it('is false (cautious) when the earlier dimensions were never recorded, because a change cannot be proven', () => {
        expect(geometryChanged({ width: null, height: null, orientation: 1 }, { ...before })).toBe(false);
        expect(geometryChanged({ width: 4000, height: null, orientation: 1 }, { ...before })).toBe(false);
    });

    it('is false (cautious) when the new dimensions could not be read', () => {
        expect(geometryChanged(before, { width: null, height: null, orientation: 1 })).toBe(false);
    });
});

describe('extractDimensions', () => {
    it('prefers ImageWidth/ImageHeight, then SourceImage*, then ExifImage*', () => {
        expect(extractDimensions({ ImageWidth: 10, ImageHeight: 20, SourceImageWidth: 1, SourceImageHeight: 2 })).toEqual({ width: 10, height: 20 });
        expect(extractDimensions({ SourceImageWidth: 6000, SourceImageHeight: 4000, ExifImageWidth: 1, ExifImageHeight: 1 })).toEqual({ width: 6000, height: 4000 });
        expect(extractDimensions({ ExifImageWidth: 30, ExifImageHeight: 40 })).toEqual({ width: 30, height: 40 });
    });

    it('returns nulls when dimensions are missing', () => {
        expect(extractDimensions({})).toEqual({ width: null, height: null });
    });

    it.each([6, 8, 5, 7, 'Rotate 90 CW', 'Rotate 270 CW'])('swaps width and height for orientation %s', orientation => {
        expect(extractDimensions({ ImageWidth: 4000, ImageHeight: 3000, Orientation: orientation })).toEqual({ width: 3000, height: 4000 });
    });

    it.each([1, 2, 3, 4, undefined, 'Horizontal (normal)'])('does not swap for orientation %s', orientation => {
        expect(extractDimensions({ ImageWidth: 4000, ImageHeight: 3000, Orientation: orientation })).toEqual({ width: 4000, height: 3000 });
    });

    it('does not swap when a dimension is missing', () => {
        expect(extractDimensions({ ImageWidth: 4000, Orientation: 6 })).toEqual({ width: 4000, height: null });
    });
});

describe('resolveDateTaken', () => {
    const fallbacks = { birthtime: () => new Date('2018-01-02T03:04:05.000Z'), now: () => new Date('2030-01-01T00:00:00.000Z') };

    it('uses the EXIF capture date first (DateTimeOriginal, then CreateDate, then MediaCreateDate)', () => {
        expect(resolveDateTaken({ DateTimeOriginal: '2020:05:04 10:00:00', CreateDate: '2019:01:01 00:00:00' }, fallbacks)).toBe('2020-05-04T10:00:00');
        expect(resolveDateTaken({ CreateDate: '2019:01:01 00:00:00' }, fallbacks)).toBe('2019-01-01T00:00:00');
        expect(resolveDateTaken({ MediaCreateDate: '2017:07:07 07:07:07' }, fallbacks)).toBe('2017-07-07T07:07:07');
    });

    it('falls back to the file birthtime when there is no EXIF date', () => {
        expect(resolveDateTaken({}, fallbacks)).toBe('2018-01-02T03:04:05.000Z');
    });

    it('falls back to now when the birthtime cannot be read', () => {
        const failing = { birthtime: vi.fn(() => { throw new Error('ENOENT'); }), now: fallbacks.now };
        expect(resolveDateTaken({}, failing)).toBe('2030-01-01T00:00:00.000Z');
    });
});
