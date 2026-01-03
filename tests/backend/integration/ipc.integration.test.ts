/**
 * IPC Integration Tests
 * 
 * Verifies that IPC handlers are correctly registered and 
 * delegate to the appropriate repository or service.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 1. Setup mocks BEFORE imports
const mockHandlers = new Map<string, Function>();

vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => '/mock/path')
    },
    ipcMain: {
        handle: vi.fn((channel, handler) => {
            mockHandlers.set(channel, handler);
        }),
        on: vi.fn()
    }
}));

// Mock repositories with vitest mock functions
vi.mock('../../../electron/data/repositories/PhotoRepository', () => ({
    PhotoRepository: {
        getLibraryStats: vi.fn(),
        getPhotos: vi.fn()
    }
}));

vi.mock('../../../electron/data/repositories/FaceRepository', () => ({
    FaceRepository: {
        getFacesByPhoto: vi.fn()
    }
}));

vi.mock('../../../electron/core/services/PersonService', () => ({
    PersonService: {
        renamePerson: vi.fn()
    }
}));

vi.mock('../../../electron/data/repositories/PersonRepository', () => ({
    PersonRepository: {
        getPeople: vi.fn()
    }
}));

vi.mock('../../../electron/db', () => ({
    getDB: vi.fn(() => ({
        prepare: vi.fn(() => ({
            all: vi.fn(() => [])
        }))
    }))
}));

vi.mock('../../../electron/infrastructure/PythonAIProvider', () => ({
    pythonProvider: {
        sendRequest: vi.fn(),
        searchFaces: vi.fn()
    }
}));

vi.mock('../../../electron/core/services/ConfigService', () => ({
    ConfigService: {
        updateSettings: vi.fn(),
        getAISettings: vi.fn(() => ({ faceSimilarityThreshold: 0.65 }))
    }
}));

// Now import the modules which use the mocks
import { registerDBHandlers } from '../../../electron/ipc/dbHandlers';
import { PhotoRepository } from '../../../electron/data/repositories/PhotoRepository';
import { PersonService } from '../../../electron/core/services/PersonService';

describe('IPC Integration', () => {
    beforeEach(() => {
        mockHandlers.clear();
        vi.clearAllMocks();
        registerDBHandlers();
    });

    it('should register expected handlers', () => {
        expect(mockHandlers.has('db:getLibraryStats')).toBe(true);
        expect(mockHandlers.has('db:getPhotos')).toBe(true);
        expect(mockHandlers.has('db:renamePerson')).toBe(true);
    });

    it('should delegate db:getLibraryStats to PhotoRepository', async () => {
        // Arrange
        const mockStats = { photos: 100 };
        // Use direct mock property access if vi.mocked fails
        (PhotoRepository.getLibraryStats as any).mockReturnValue(mockStats);
        const handler = mockHandlers.get('db:getLibraryStats')!;

        // Act
        const result = await handler();

        // Assert
        expect(result.success).toBe(true);
        expect(result.stats).toEqual(mockStats);
    });

    it('should delegate db:renamePerson to PersonService', async () => {
        // Arrange
        const mockResponse = { success: true };
        (PersonService.renamePerson as any).mockResolvedValue(mockResponse);
        const handler = mockHandlers.get('db:renamePerson')!;

        // Act
        const result = await handler(null, { personId: 1, newName: 'Alice' });

        // Assert
        expect(PersonService.renamePerson).toHaveBeenCalledWith(1, 'Alice');
        expect(result).toEqual(mockResponse);
    });

    it('should handle errors in handlers gracefully', async () => {
        // Arrange
        (PhotoRepository.getLibraryStats as any).mockImplementation(() => {
            throw new Error('DB Error');
        });
        const handler = mockHandlers.get('db:getLibraryStats')!;

        // Act
        const result = await handler();

        // Assert
        expect(result.success).toBe(false);
        expect(result.error).toContain('DB Error');
    });
});
