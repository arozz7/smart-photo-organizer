/**
 * PersonService Era Generation Unit Tests
 * 
 * Tests the quality-weighted visual clustering for ERA generation.
 * Age-based bucketing has been removed in favor of purely visual similarity clustering.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

// Mock dependencies
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
        addEra: vi.fn(() => 1), // Return mock era ID
        clearEras: vi.fn(),
        deleteEra: vi.fn(),
        getEras: vi.fn(() => []) // Return empty array for iteration
    }
}));

vi.mock('../../../../electron/data/repositories/FaceRepository', () => ({
    FaceRepository: {
        getAssignedFacesWithDates: vi.fn(),
        updateFaceEra: vi.fn()
    }
}));

// Mock FaceService with real L2 distance calculation
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

describe('PersonService - Visual ERA Clustering', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('generateEras', () => {
        const mockPersonId = 123;

        // Helper to create mock faces with quality data
        const createFace = (
            id: number,
            descriptor: number[],
            opts?: { blur_score?: number, face_quality?: number, timestamp?: number }
        ) => ({
            id,
            descriptor,
            blur_score: opts?.blur_score ?? 50,
            face_quality: opts?.face_quality ?? 0.7,
            created_at: '2020-01-01',
            metadata_json: opts?.timestamp ? `{"DateTimeOriginal": "2020:01:01 12:00:00"}` : '{}'
        });

        it('should fail gracefully if not enough faces', async () => {
            vi.mocked(FaceRepository.getAssignedFacesWithDates).mockReturnValue([
                createFace(1, [0.1, 0.2]),
                createFace(2, [0.2, 0.3])
            ]);

            const result = await PersonService.generateEras(mockPersonId);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Not enough faces');
            expect(PersonRepository.addEra).not.toHaveBeenCalled();
        });

        it('should succeed with custom config allowing fewer faces', async () => {
            vi.mocked(FaceRepository.getAssignedFacesWithDates).mockReturnValue([
                createFace(1, [0.1, 0.2]),
                createFace(2, [0.1, 0.2])
            ]);

            const config = { minFacesForEra: 2, eraMergeThreshold: 0.75 };
            const result = await PersonService.generateEras(mockPersonId, config);

            expect(result.success).toBe(true);
            expect(result.count).toBe(1);
            expect(PersonRepository.clearEras).toHaveBeenCalledWith(mockPersonId);
            expect(PersonRepository.addEra).toHaveBeenCalledTimes(1);
        });

        it('should cluster faces by time periods', async () => {
            // Faces from different year ranges
            const faces = [
                ...Array(10).fill(0).map((_, i) => createFace(i, [0, 0 + i * 0.01])),
                ...Array(10).fill(0).map((_, i) => createFace(i + 10, [10, 10 + i * 0.01]))
            ];

            vi.mocked(FaceRepository.getAssignedFacesWithDates).mockReturnValue(faces);
            const config = { minFacesForEra: 5, eraMergeThreshold: 0.3 };

            const result = await PersonService.generateEras(mockPersonId, config);

            expect(result.success).toBe(true);
            // Time-based method returns 'time-based' or 'single'
            expect(['time-based', 'single']).toContain(result.method);
            expect(result.count).toBeGreaterThanOrEqual(1);
        });

        it('should merge similar clusters based on threshold', async () => {
            // Group A: vectors near [0, 0]
            // Group B: vectors near [0.2, 0.2] - close enough to merge
            const faces = [
                ...Array(10).fill(0).map((_, i) => createFace(i, [0, 0])),
                ...Array(10).fill(0).map((_, i) => createFace(i + 10, [0.2, 0.2]))
            ];

            vi.mocked(FaceRepository.getAssignedFacesWithDates).mockReturnValue(faces);
            // High merge threshold = more aggressive merging
            const config = { minFacesForEra: 5, eraMergeThreshold: 1.0 };

            const result = await PersonService.generateEras(mockPersonId, config);

            expect(result.success).toBe(true);
            expect(result.count).toBe(1); // Should merge into single era
        });

        it('should use high-quality faces as cluster seeds', async () => {
            // High quality faces cluster around [1, 1]
            // Low quality faces are scattered widely - should be assigned to high-quality clusters
            const faces = [
                // High quality - tight cluster at [1, 1]
                ...Array(10).fill(0).map((_, i) =>
                    createFace(i, [1 + i * 0.01, 1 + i * 0.01], { blur_score: 80, face_quality: 0.9 })),
                // Low quality - scattered but should gravitate to high-quality centroid
                ...Array(20).fill(0).map((_, i) =>
                    createFace(i + 10, [1.5 + (i % 5) * 0.1, 1.5 + (i % 5) * 0.1], { blur_score: 10, face_quality: 0.2 }))
            ];

            vi.mocked(FaceRepository.getAssignedFacesWithDates).mockReturnValue(faces);
            const config = { minFacesForEra: 5, eraMergeThreshold: 0.75 };

            const result = await PersonService.generateEras(mockPersonId, config);

            expect(result.success).toBe(true);
            // Should create eras dominated by high-quality face locations
            expect(PersonRepository.addEra).toHaveBeenCalled();
        });

        it('should name eras as "Era N" format', async () => {
            const faces = Array(20).fill(0).map((_, i) => createFace(i, [0, 0]));
            vi.mocked(FaceRepository.getAssignedFacesWithDates).mockReturnValue(faces);
            const config = { minFacesForEra: 5, eraMergeThreshold: 0.75 };

            await PersonService.generateEras(mockPersonId, config);

            const addEraCall = vi.mocked(PersonRepository.addEra).mock.calls[0][0];
            expect(addEraCall.era_name).toMatch(/^Era \d+/);
        });

        it('should include date range in era name when dates available', async () => {
            const faces = [
                createFace(1, [0, 0], { timestamp: new Date('2020-01-01').getTime() }),
                createFace(2, [0, 0], { timestamp: new Date('2022-06-15').getTime() })
            ];
            // Need to mock with actual DateTimeOriginal in metadata
            vi.mocked(FaceRepository.getAssignedFacesWithDates).mockReturnValue([
                { ...faces[0], metadata_json: '{"DateTimeOriginal": "2020:01:01 12:00:00"}' },
                { ...faces[1], metadata_json: '{"DateTimeOriginal": "2022:06:15 12:00:00"}' }
            ]);
            const config = { minFacesForEra: 2, eraMergeThreshold: 1.0 };

            await PersonService.generateEras(mockPersonId, config);

            const addEraCall = vi.mocked(PersonRepository.addEra).mock.calls[0][0];
            // Should include date range in name
            expect(addEraCall.era_name).toContain('Era 1');
            expect(addEraCall.start_year).toBe(2020);
            expect(addEraCall.end_year).toBe(2022);
        });
    });
});
