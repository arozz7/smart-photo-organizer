
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import { ConfigService, DEFAULT_CONFIG } from '../../../../electron/core/services/ConfigService';

// Mock electron app.getPath
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn().mockReturnValue('/tmp/userData') // Mock path
    }
}));

// Mock fs
vi.mock('fs');
vi.mock('node:fs');

describe('ConfigService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset private static config by reloading or mocking
        // Since ConfigService is a static class with private state, we need to be careful.
        // The load() method checks if (this.config) return; 
        // We can force reload by bypassing TS if needed, or by ensuring fs.readFileSync returns different values.

        // However, standard import caches might persist state.
        // For unit tests of Singletons, it's often easier to mock the storage mechanism (fs).
    });

    it('should load default smart ignore settings', () => {
        // Arrange
        vi.mocked(fs.existsSync).mockReturnValue(false); // No config file
        vi.mocked(fs.writeFileSync).mockImplementation(() => { });

        // Act
        // Access via public getter which triggers load()
        const settings = ConfigService.getSmartIgnoreSettings();

        // Assert
        expect(settings).toBeDefined();
        expect(settings.autoAssignThreshold).toBe(0.4);
        expect(settings.reviewThreshold).toBe(0.6);
        expect(settings.enableAutoTiering).toBe(true);
    });

    it('should update and persist smart ignore settings', () => {
        // Arrange
        vi.mocked(fs.existsSync).mockReturnValue(false);
        const writeSpy = vi.mocked(fs.writeFileSync);

        // Act
        ConfigService.updateSmartIgnoreSettings({
            autoAssignThreshold: 0.35,
            enableAutoTiering: false
        });

        // Assert
        const settings = ConfigService.getSmartIgnoreSettings();
        expect(settings.autoAssignThreshold).toBe(0.35);
        expect(settings.enableAutoTiering).toBe(false);
        expect(settings.reviewThreshold).toBe(0.6); // Should keep default

        // Verify file write
        expect(writeSpy).toHaveBeenCalled();
        const callArgs = writeSpy.mock.calls[0]; // [path, data]
        const savedData = JSON.parse(callArgs[1] as string);
        expect(savedData.smartIgnore.autoAssignThreshold).toBe(0.35);
    });

    it('should load existing settings from disk', () => {
        // Arrange
        const mockConfig = {
            ...DEFAULT_CONFIG,
            smartIgnore: {
                ...DEFAULT_CONFIG.smartIgnore,
                autoAssignThreshold: 0.9,
                reviewThreshold: 0.95
            }
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

        // Note: We need to ensure ConfigService reloads. 
        // In a real environment, we'd restart app. In test, we might need to reset the module or static prop.
        // Since we can't easily reset private static prop without reflection, we rely on test isolation or
        // we can add a 'reset' method to ConfigService just for testing, but that leaks test logic.
        // OR we just assume this test runs in isolation (it does in vitest if files are separate).

        // Actually, since previous tests ran in same file, the static state persists!
        // We need a way to clear `ConfigService["config"]`.
        // @ts-ignore
        ConfigService["config"] = undefined;

        // Act
        const settings = ConfigService.getSmartIgnoreSettings();

        // Assert
        expect(settings.autoAssignThreshold).toBe(0.9);
        expect(settings.reviewThreshold).toBe(0.95);
    });
});
