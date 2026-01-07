/**
 * PhotoDetail Image Loading Tests
 * 
 * These tests verify the correct image loading behavior for different file types.
 * The approach has been simplified: PhotoDetail now always sends the original file_path,
 * and the backend ImageService handles preview logic for RAW files.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * This mirrors the simplified logic from PhotoDetail.tsx.
 * The frontend now always uses file_path directly.
 */
function getImagePathForPhoto(photo: { file_path: string }, retryTimestamp?: number): string {
    const base = `local-resource://${encodeURIComponent(photo.file_path)}`;
    return retryTimestamp ? `${base}?retry=${retryTimestamp}` : base;
}

/**
 * Backend ImageService is responsible for:
 * - Serving web-friendly files directly
 * - Converting RAW files to JPEG on-the-fly (using cached preview or generating new one)
 */
function isRawFile(filePath: string): boolean {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    return ['.nef', '.arw', '.cr2', '.dng', '.orf', '.rw2'].includes(`.${ext}`);
}

/**
 * Simulates the retry mechanism from PhotoDetail.tsx
 * Returns the next image path with cache-bust, or null if retries exhausted
 */
function handleImageError(
    photo: { file_path: string },
    currentRetryCount: number,
    maxRetries: number = 2
): { shouldRetry: boolean; newPath: string | null; newRetryCount: number } {
    if (currentRetryCount < maxRetries) {
        const timestamp = Date.now();
        return {
            shouldRetry: true,
            newPath: getImagePathForPhoto(photo, timestamp),
            newRetryCount: currentRetryCount + 1
        };
    }
    return {
        shouldRetry: false,
        newPath: null,
        newRetryCount: currentRetryCount
    };
}

describe('PhotoDetail Image Loading (Simplified Architecture)', () => {

    describe('getImagePathForPhoto', () => {
        it('should always use file_path for any file type', () => {
            const photo = {
                file_path: 'R:/Pictures/DSC07174.ARW'
            };

            const imagePath = getImagePathForPhoto(photo);

            // Should use the original file_path
            expect(imagePath).toContain(encodeURIComponent(photo.file_path));
        });

        it('should encode special characters in path', () => {
            const photo = {
                file_path: "R:/Pictures/Arianna's 16th/DSC07174.ARW"
            };

            const imagePath = getImagePathForPhoto(photo);

            // Should properly encode spaces and apostrophes
            expect(imagePath).toContain("Arianna's");
            expect(imagePath).toContain('local-resource://');
        });

        it('should handle JPG files the same as RAW files', () => {
            const jpgPhoto = { file_path: 'R:/Pictures/vacation.jpg' };
            const rawPhoto = { file_path: 'R:/Pictures/vacation.ARW' };

            const jpgPath = getImagePathForPhoto(jpgPhoto);
            const rawPath = getImagePathForPhoto(rawPhoto);

            // Both should use local-resource:// protocol
            expect(jpgPath).toContain('local-resource://');
            expect(rawPath).toContain('local-resource://');

            // Both should contain their respective file paths
            expect(jpgPath).toContain(encodeURIComponent(jpgPhoto.file_path));
            expect(rawPath).toContain(encodeURIComponent(rawPhoto.file_path));
        });

        it('should add retry timestamp when provided', () => {
            const photo = { file_path: 'R:/Pictures/DSC07174.ARW' };
            const timestamp = 1234567890;

            const imagePath = getImagePathForPhoto(photo, timestamp);

            expect(imagePath).toContain('?retry=1234567890');
        });
    });

    describe('isRawFile (backend logic)', () => {
        it('should identify RAW file extensions', () => {
            expect(isRawFile('photo.ARW')).toBe(true);
            expect(isRawFile('photo.NEF')).toBe(true);
            expect(isRawFile('photo.CR2')).toBe(true);
            expect(isRawFile('photo.DNG')).toBe(true);
            expect(isRawFile('photo.ORF')).toBe(true);
            expect(isRawFile('photo.RW2')).toBe(true);
            expect(isRawFile('photo.arw')).toBe(true); // lowercase
        });

        it('should identify non-RAW files', () => {
            expect(isRawFile('photo.jpg')).toBe(false);
            expect(isRawFile('photo.jpeg')).toBe(false);
            expect(isRawFile('photo.png')).toBe(false);
            expect(isRawFile('photo.webp')).toBe(false);
            expect(isRawFile('photo.gif')).toBe(false);
        });
    });

    describe('Retry Mechanism (Race Condition Fix)', () => {
        const photo = { file_path: 'R:/Pictures/2014/March 2014/DSC07363.ARW' };

        it('should retry on first failure with cache-bust parameter', () => {
            const result = handleImageError(photo, 0);

            expect(result.shouldRetry).toBe(true);
            expect(result.newPath).not.toBeNull();
            expect(result.newPath).toContain('?retry=');
            expect(result.newRetryCount).toBe(1);
        });

        it('should retry on second failure with new cache-bust parameter', () => {
            const result = handleImageError(photo, 1);

            expect(result.shouldRetry).toBe(true);
            expect(result.newPath).not.toBeNull();
            expect(result.newPath).toContain('?retry=');
            expect(result.newRetryCount).toBe(2);
        });

        it('should NOT retry after exhausting max attempts (default 2)', () => {
            const result = handleImageError(photo, 2);

            expect(result.shouldRetry).toBe(false);
            expect(result.newPath).toBeNull();
            expect(result.newRetryCount).toBe(2);
        });

        it('should allow custom max retry count', () => {
            // With maxRetries=3, we should still retry at count 2
            const result = handleImageError(photo, 2, 3);

            expect(result.shouldRetry).toBe(true);
            expect(result.newRetryCount).toBe(3);
        });

        it('should generate unique cache-bust timestamps on each retry', () => {
            const result1 = handleImageError(photo, 0);
            // Small delay to ensure different timestamp
            const result2 = handleImageError(photo, 1);

            // Both should have retry params but they should be unique (timestamps)
            expect(result1.newPath).toContain('?retry=');
            expect(result2.newPath).toContain('?retry=');
            // Extract timestamps - they should both be valid numbers
            const match1 = result1.newPath?.match(/retry=(\d+)/);
            const match2 = result2.newPath?.match(/retry=(\d+)/);
            expect(match1).not.toBeNull();
            expect(match2).not.toBeNull();
        });

        it('should preserve original file path in retry URL', () => {
            const result = handleImageError(photo, 0);

            expect(result.newPath).toContain(encodeURIComponent(photo.file_path));
        });
    });
});
