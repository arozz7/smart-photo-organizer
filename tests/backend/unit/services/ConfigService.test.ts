/**
 * ConfigService Unit Tests
 * 
 * Tests the ConfigService class by mocking electron and fs.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

// 1. Mock Electron
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn((name) => {
            // Use path.join to ensure consistency with system separators
            if (name === 'userData') return path.join('/mock', 'user', 'data');
            return '/mock/path';
        })
    }
}));

// 2. Mock FS
vi.mock('node:fs', () => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn()
}));

import { ConfigService } from '../../../../electron/core/services/ConfigService';

describe('ConfigService', () => {
    let consoleErrorSpy: MockInstance;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset the private static config
        (ConfigService as any).config = undefined;
        // Spy on console.error
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('should return default settings if no config file exists', () => {
        // Arrange
        vi.mocked(fs.existsSync).mockReturnValue(false);

        // Act
        const settings = ConfigService.getSettings();

        // Assert
        expect(settings.aiSettings.faceSimilarityThreshold).toBe(0.65);
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should load settings from existing config file', () => {
        // Arrange
        const mockConfig = {
            libraryPath: '/my/photos',
            aiSettings: { faceSimilarityThreshold: 0.8 }
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

        // Act
        const settings = ConfigService.getSettings();

        // Assert
        expect(settings.libraryPath).toBe('/my/photos');
        expect(settings.aiSettings.faceSimilarityThreshold).toBe(0.8);
        // Should also have defaults for other fields
        expect(settings.aiSettings.faceBlurThreshold).toBe(20);
    });

    it('should update settings and save to disk', () => {
        // Arrange
        vi.mocked(fs.existsSync).mockReturnValue(false);

        // Act
        ConfigService.updateSettings({ libraryPath: '/new/path' });

        // Assert
        const settings = ConfigService.getSettings();
        expect(settings.libraryPath).toBe('/new/path');
        expect(fs.writeFileSync).toHaveBeenCalledWith(
            expect.stringContaining('config.json'),
            expect.stringContaining('/new/path')
        );
    });

    it('should update specific nested AI settings', () => {
        // Act
        ConfigService.setAISettings({ faceBlurThreshold: 50 });

        // Assert
        const settings = ConfigService.getAISettings();
        expect(settings.faceBlurThreshold).toBe(50);
        expect(settings.faceSimilarityThreshold).toBe(0.65); // Default preserved
    });

    it('should return library path or default to mock UserData/Library', () => {
        // Arrange
        vi.mocked(fs.existsSync).mockReturnValue(false);

        // Act & Assert
        const libPath = ConfigService.getLibraryPath();
        const expectedBase = path.join('/mock', 'user', 'data');

        expect(libPath).toContain(expectedBase);
        expect(libPath).toContain('Library');

        ConfigService.setLibraryPath('/custom/lib');
        expect(ConfigService.getLibraryPath()).toBe('/custom/lib');
    });

    it('should handle JSON parse errors by resetting to defaults', () => {
        // Arrange
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

        // Act
        const settings = ConfigService.getSettings();

        // Assert
        expect(settings.aiSettings.faceSimilarityThreshold).toBe(0.65);
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});
