import { describe, it, expect } from 'vitest';
import { isCameraRawExtension, isRawLikeExtension, isStandardImageExtension, isSupportedImageExtension } from '../../../electron/utils/imageFormats';

describe('imageFormats', () => {
    it.each(['.jpg', '.jpeg', '.png', '.jfif', '.webp'])('treats %s as a supported standard (non-RAW) image', ext => {
        expect(isSupportedImageExtension(ext)).toBe(true);
        expect(isStandardImageExtension(ext)).toBe(true);
        expect(isRawLikeExtension(ext)).toBe(false);
    });

    it.each(['.arw', '.cr2', '.nef', '.dng', '.orf', '.rw2', '.tif', '.tiff'])('treats %s as supported RAW-like (needs the RAW path)', ext => {
        expect(isSupportedImageExtension(ext)).toBe(true);
        expect(isStandardImageExtension(ext)).toBe(false);
        expect(isRawLikeExtension(ext)).toBe(true);
    });

    it.each(['.txt', '.mp4', '.gif', '.heic', ''])('does not support %s', ext => {
        expect(isSupportedImageExtension(ext)).toBe(false);
    });

    it.each(['.arw', '.cr2', '.nef', '.orf', '.rw2', '.ARW'])('treats %s as camera RAW, which the Python engine decodes and sharp never sees', ext => {
        expect(isCameraRawExtension(ext)).toBe(true);
    });

    it.each(['.dng', '.tif', '.tiff', '.jpg', '.png', '.webp'])('lets sharp read %s', ext => {
        expect(isCameraRawExtension(ext)).toBe(false);
    });

    it('is case-insensitive', () => {
        expect(isSupportedImageExtension('.WEBP')).toBe(true);
        expect(isRawLikeExtension('.ARW')).toBe(true);
    });
});
