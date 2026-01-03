/**
 * PhotoService Unit Tests
 * 
 * Tests the PhotoService class by mocking large external dependencies:
 * sharp, exiftool-vendored, and PythonAIProvider.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';

// 1. Mock sharp (fluent API)
const mockSharpInstance = {
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue({}),
    rotate: vi.fn().mockReturnThis(),
};
vi.mock('sharp', () => ({
    default: vi.fn(() => mockSharpInstance)
}));

// 2. Mock ExifTool as a class
const mockExifToolInstance = {
    version: vi.fn().mockResolvedValue('12.00'),
    read: vi.fn(),
    extractPreview: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined)
};
vi.mock('exiftool-vendored', () => {
    return {
        // Using a regular function to ensure it can be used as a constructor
        ExifTool: function () {
            return mockExifToolInstance;
        }
    };
});

// 3. Mock Python Provider
vi.mock('../../../../electron/infrastructure/PythonAIProvider', () => ({
    pythonProvider: {
        generateThumbnail: vi.fn(),
        rotateImage: vi.fn(),
        sendRequest: vi.fn(),
        analyzeImage: vi.fn(),
    }
}));

// 4. Mock Repositories & Store
vi.mock('../../../../electron/data/repositories/PhotoRepository', () => ({
    PhotoRepository: {
        updatePhoto: vi.fn(),
        addTags: vi.fn()
    }
}));

vi.mock('../../../../electron/store', () => ({
    getLibraryPath: vi.fn(() => '/mock/library')
}));

vi.mock('../../../../electron/logger', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

// 5. Mock fs/promises
vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        promises: {
            access: vi.fn(),
            writeFile: vi.fn().mockResolvedValue(undefined),
            unlink: vi.fn().mockResolvedValue(undefined),
            mkdir: vi.fn().mockResolvedValue(undefined),
        }
    };
});

import { PhotoService } from '../../../../electron/core/services/PhotoService';
import { pythonProvider } from '../../../../electron/infrastructure/PythonAIProvider';
import { PhotoRepository } from '../../../../electron/data/repositories/PhotoRepository';
import sharp from 'sharp';

describe('PhotoService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset intermediate static state
        (PhotoService as any)._exiftool = null;
        (PhotoService as any)._exiftoolInitPromise = null;

        // Default fs.access to succeed
        vi.mocked(fs.access).mockResolvedValue(undefined);
    });

    // ==========================================
    // extractPreview
    // ==========================================
    describe('extractPreview', () => {
        it('should return existing preview if found and no rescan forced', async () => {
            // Arrange
            const filePath = '/path/to/photo.jpg';
            const previewDir = '/previews';
            vi.mocked(fs.access).mockResolvedValue(undefined);

            // Act
            const result = await PhotoService.extractPreview(filePath, previewDir);

            // Assert
            expect(result).not.toBeNull();
            expect(sharp).not.toHaveBeenCalled();
        });

        it('should use sharp for standard JPG images if preview missing', async () => {
            // Arrange
            const filePath = '/path/to/photo.jpg';
            const previewDir = '/previews';

            // First call (check existence) fails, subsequent calls (checks during extraction) succeed
            vi.mocked(fs.access).mockRejectedValueOnce(new Error('Missing'));
            vi.mocked(fs.access).mockResolvedValue(undefined);

            // Act
            const result = await PhotoService.extractPreview(filePath, previewDir);

            // Assert
            expect(result).not.toBeNull();
            expect(sharp).toHaveBeenCalledWith(filePath);
            expect(mockSharpInstance.toFile).toHaveBeenCalled();
        });

        it('should use exiftool for RAW file extraction before sharp', async () => {
            // Arrange
            const filePath = '/path/to/photo.ARW';
            const previewDir = '/previews';

            // access(previewPath) fails
            vi.mocked(fs.access).mockRejectedValueOnce(new Error('Missing'));
            // access(tempPreviewPath) succeeds
            vi.mocked(fs.access).mockResolvedValue(undefined);

            mockExifToolInstance.read.mockResolvedValue({ Orientation: 1 });

            // Act
            const result = await PhotoService.extractPreview(filePath, previewDir);

            // Assert
            // No need to check for ExifTool constructor, just the instance method
            expect(mockExifToolInstance.extractPreview).toHaveBeenCalledWith(filePath, expect.stringContaining('.tmp'));
            expect(sharp).toHaveBeenCalledWith(expect.stringContaining('.tmp'));
        });

        it('should fallback to Python if both ExifTool and Sharp fail', async () => {
            // Arrange
            const filePath = '/path/to/corrupt.jpg';
            // All fs access checks for previews fail
            vi.mocked(fs.access).mockRejectedValue(new Error('Missing'));

            // Sharp fails
            vi.mocked(sharp).mockImplementation(() => { throw new Error('Sharp fail'); });

            vi.mocked(pythonProvider.generateThumbnail).mockResolvedValue({
                success: true,
                data: Buffer.from('fake-image-data').toString('base64')
            });

            // Act
            const result = await PhotoService.extractPreview(filePath, '/previews');

            // Assert
            expect(result).not.toBeNull();
            expect(pythonProvider.generateThumbnail).toHaveBeenCalled();
            expect(fs.writeFile).toHaveBeenCalled();
        });
    });

    // ==========================================
    // rotatePhoto
    // ==========================================
    describe('rotatePhoto', () => {
        it('should call pythonProvider rotateImage', async () => {
            // Arrange
            const filePath = '/path/to/photo.jpg';
            vi.mocked(pythonProvider.rotateImage).mockResolvedValue({ success: true } as any);

            // Act
            await PhotoService.rotatePhoto(1, filePath, 90);

            // Assert
            // Implementation calls pythonProvider.rotateImage at line 133
            expect(pythonProvider.rotateImage).toHaveBeenCalledWith(filePath, 90);
        });
    });

    // ==========================================
    // generateTags
    // ==========================================
    describe('generateTags', () => {
        it('should update repository with description and tags from AI', async () => {
            // Arrange
            const photoId = 123;
            vi.mocked(pythonProvider.sendRequest).mockResolvedValue({
                success: true,
                description: 'A beautiful sunset',
                tags: ['sunset', 'ocean']
            });

            // Act
            const result = await PhotoService.generateTags(photoId, '/path/photo.jpg');

            // Assert
            expect(PhotoRepository.updatePhoto).toHaveBeenCalledWith(photoId, { description: 'A beautiful sunset' });
            expect(PhotoRepository.addTags).toHaveBeenCalledWith(photoId, ['sunset', 'ocean']);
            expect(result.dbStatus).toContain('Description saved');
            expect(result.dbStatus).toContain('Tags saved: 2');
        });

        it('should skip DB updates if AI fails', async () => {
            // Arrange
            vi.mocked(pythonProvider.sendRequest).mockResolvedValue({ error: 'AI Timeout' });

            // Act
            await PhotoService.generateTags(1, '/path.jpg');

            // Assert
            expect(PhotoRepository.updatePhoto).not.toHaveBeenCalled();
            expect(PhotoRepository.addTags).not.toHaveBeenCalled();
        });
    });

    // ==========================================
    // analyzeImage
    // ==========================================
    describe('analyzeImage', () => {
        it('should call pythonProvider analyzeImage', async () => {
            // Arrange
            const options = { filePath: '/test.jpg', detail: true };

            // Act
            await PhotoService.analyzeImage(options);

            // Assert
            expect(pythonProvider.analyzeImage).toHaveBeenCalledWith('/test.jpg', options);
        });
    });
});
