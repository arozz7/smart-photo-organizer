/**
 * PersonService Era Generation Unit Tests
 * 
 * Tests the era generation capabilities of PersonService.
 * Focuses on Phase E (Visual Clustering) and Phase F (Configurable Settings).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies
// 1. Mock Electron first
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => '/tmp'),
        getVersion: vi.fn(() => '1.0.0')
    },
    ipcMain: { handle: vi.fn() }
}));

vi.mock('../../../../electron/data/repositories/PersonRepository', () => ({
    PersonRepository: {
        updateDescriptorMean: vi.fn(),
        addEra: vi.fn(),
        clearEras: vi.fn(),
        deleteEra: vi.fn(),
        getEras: vi.fn()
    }
}));

vi.mock('../../../../electron/data/repositories/FaceRepository', () => ({
    FaceRepository: {
        getConfirmedFacesWithDates: vi.fn(),
        updateFaceEra: vi.fn()
    }
}));

// Mock FaceService for L2 distance calculations
// We need real calculations for K-Means to work in tests
vi.mock('../../../../electron/core/services/FaceService', () => ({
    FaceService: {
        calculateL2Distance: (a: number[], b: number[]) => {
            if (!a || !b || a.length !== b.length) return 10;
            return Math.sqrt(a.reduce((sum, val, i) => sum + Math.pow(val - b[i], 2), 0));
        }
    }
}));

vi.mock('../../../../electron/store', () => ({
    getAISettings: vi.fn(() => ({ minFacesForEra: 50 }))
}));


import { PersonService } from '../../../../electron/core/services/PersonService';
import { PersonRepository } from '../../../../electron/data/repositories/PersonRepository';
import { FaceRepository } from '../../../../electron/data/repositories/FaceRepository';

describe('PersonService - Era Generation', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('generateEras', () => {
        const mockPersonId = 123;

        // Helper to create mock faces
        const createFace = (id: number, descriptor: number[], timestamp?: number) => ({
            id,
            descriptor,
            timestamp: timestamp || 1672531200000 // 2023-01-01
        });

        it('should fail gracefully if not enough faces', async () => {
            // Arrange
            vi.mocked(FaceRepository.getConfirmedFacesWithDates).mockReturnValue([
                createFace(1, [0.1]),
                createFace(2, [0.2])
            ]);

            // Act
            // Default min faces is 50
            const result = await PersonService.generateEras(mockPersonId);

            // Assert
            expect(result.success).toBe(false);
            // @ts-ignore
            expect(result.error).toContain('Not enough faces');
            expect(PersonRepository.addEra).not.toHaveBeenCalled();
        });

        it('should succeed with custom config allowing fewer faces', async () => {
            // Arrange
            vi.mocked(FaceRepository.getConfirmedFacesWithDates).mockReturnValue([
                createFace(1, [0.1]),
                createFace(2, [0.1])
            ]);

            const config = { minFacesForEra: 2, eraMergeThreshold: 0.75 };

            // Act
            const result = await PersonService.generateEras(mockPersonId, config);

            // Assert
            expect(result.success).toBe(true);
            // With only 2 faces and K=1 logic for small sets, expect 1 era
            expect(result.count).toBe(1);
            expect(PersonRepository.clearEras).toHaveBeenCalledWith(mockPersonId);
            expect(PersonRepository.addEra).toHaveBeenCalledTimes(1);
        });

        it('should cluster distinct groups into separate eras', async () => {
            // Arrange
            // Group A: [0, 0] (Young)
            // Group B: [10, 10] (Old) - Distance is sqrt(200) ~ 14.1
            const faces = [
                ...Array(10).fill(0).map((_, i) => createFace(i, [0, 0])),
                ...Array(10).fill(0).map((_, i) => createFace(i + 10, [10, 10]))
            ];

            vi.mocked(FaceRepository.getConfirmedFacesWithDates).mockReturnValue(faces);

            const config = { minFacesForEra: 10, eraMergeThreshold: 0.5 }; // Strict merge

            // Act
            const result = await PersonService.generateEras(mockPersonId, config);

            // Assert
            expect(result.success).toBe(true);
            expect(result.count).toBeGreaterThanOrEqual(2); // Should split
            expect(PersonRepository.addEra).toHaveBeenCalledTimes(result.count);
        });

        it('should merge similar clusters if threshold is high', async () => {
            // Arrange
            // Group A: [0, 0]
            // Group B: [0.3, 0.3] - Distance ~ 0.42
            const faces = [
                ...Array(10).fill(0).map((_, i) => createFace(i, [0, 0])),
                ...Array(10).fill(0).map((_, i) => createFace(i + 10, [0.3, 0.3]))
            ];

            vi.mocked(FaceRepository.getConfirmedFacesWithDates).mockReturnValue(faces);

            // Merge threshold 0.75 > 0.42, so they should merge
            const config = { minFacesForEra: 10, eraMergeThreshold: 0.75 };

            // Act
            const result = await PersonService.generateEras(mockPersonId, config);

            // Assert
            expect(result.success).toBe(true);
            expect(result.count).toBe(1); // Should merge into single era
        });

        it('should calculate correct date ranges for eras', async () => {
            // Arrange
            const faces = [
                createFace(1, [0, 0], new Date('2020-07-01').getTime()),
                createFace(2, [0, 0], new Date('2022-07-01').getTime())
            ];
            vi.mocked(FaceRepository.getConfirmedFacesWithDates).mockReturnValue(faces);
            const config = { minFacesForEra: 2, eraMergeThreshold: 1.0 };

            // Act
            await PersonService.generateEras(mockPersonId, config);

            // Assert
            const addEraCall = vi.mocked(PersonRepository.addEra).mock.calls[0][0];
            expect(addEraCall.start_year).toBe(2020);
            expect(addEraCall.end_year).toBe(2022);
        });
    });
});
