
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackgroundBucketingService } from '../../../../electron/core/services/BackgroundBucketingService';
import { PythonAIProvider } from '../../../../electron/infrastructure/PythonAIProvider';
import { FaceService } from '../../../../electron/core/services/FaceService';
import { FaceRepository } from '../../../../electron/data/repositories/FaceRepository';
import { PersonRepository } from '../../../../electron/data/repositories/PersonRepository';
import { BucketRepository } from '../../../../electron/data/repositories/BucketRepository';
import { AppStateRepository } from '../../../../electron/data/repositories/AppStateRepository';
import { getAISettings } from '../../../../electron/store';

// Mocks
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => 'C:\\tmp')
    }
}));
vi.mock('../../../../electron/infrastructure/PythonAIProvider');
vi.mock('../../../../electron/core/services/FaceService');
vi.mock('../../../../electron/data/repositories/FaceRepository');
vi.mock('../../../../electron/data/repositories/PersonRepository');
vi.mock('../../../../electron/data/repositories/BucketRepository');
vi.mock('../../../../electron/data/repositories/AppStateRepository');
vi.mock('../../../../electron/store');
vi.mock('../../../../electron/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

describe('BackgroundBucketingService', () => {
    let service: BackgroundBucketingService;
    let mockAiProvider: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockAiProvider = new PythonAIProvider();
        service = new BackgroundBucketingService(mockAiProvider);

        // Default settings
        (getAISettings as any).mockReturnValue({ faceSimilarityThreshold: 0.6 });
        // Default candidates
        (PersonRepository.getPeopleWithDescriptors as any).mockReturnValue([]);
    });

    it('should process suggestions correctly', async () => {
        // Arrange
        const faces = [
            { id: 1, descriptor: Buffer.alloc(128 * 4), entity_type: 'human' },
            { id: 2, descriptor: Buffer.alloc(128 * 4), entity_type: 'human' }
        ];
        (FaceRepository.getFacesNeedingBucketing as any).mockReturnValue(faces);

        // Mock Pass 1 Matches using sequential returns
        // Face 1 matches Person 10
        // Use 'as any' to bypass strict return type check for mock
        vi.spyOn(FaceService, 'matchAgainstCentroids')
            .mockReturnValueOnce({ personId: 10, distance: 0.1, similarity: 0.9, matchType: 'centroid', personName: 'P10' } as any)
            .mockReturnValueOnce(null);

        (BucketRepository.createBucket as any).mockReturnValue(100);

        // Act
        // Access private method via casting
        await (service as any).processNextBatch();

        // Assert
        // Face 1 should be assigned to suggestion bucket
        expect(BucketRepository.createBucket).toHaveBeenCalledWith(expect.objectContaining({
            bucketType: 'suggestion',
            suggestedPersonId: 10
        }));
        expect(FaceRepository.assignToBucket).toHaveBeenCalledWith([1], 100);

        // Face 2 should fall through to discovery (mock python clustering to empty for now)
        expect(mockAiProvider.clusterFaces).toHaveBeenCalled();
    });

    it('should process discovery correctly via DBSCAN', async () => {
        // Arrange
        const faces = [
            { id: 1, descriptor: Buffer.alloc(128 * 4), entity_type: 'human' },
            { id: 2, descriptor: Buffer.alloc(128 * 4), entity_type: 'human' },
            { id: 3, descriptor: Buffer.alloc(128 * 4), entity_type: 'human' }
        ];
        (FaceRepository.getFacesNeedingBucketing as any).mockReturnValue(faces);

        // No suggestion matches
        vi.spyOn(FaceService, 'matchAgainstCentroids').mockReturnValue(null);

        // Mock DBSCAN result: Face 1 & 2 -> Cluster 0, Face 3 -> Noise (-1)
        mockAiProvider.clusterFaces.mockResolvedValue({
            labels: [0, 0, -1]
        });

        (BucketRepository.createBucket as any).mockReturnValue(200);

        // Act
        await (service as any).processNextBatch();

        // Assert
        // Faces 1 & 2 -> Discovery Bucket
        expect(BucketRepository.createBucket).toHaveBeenCalledWith(expect.objectContaining({
            bucketType: 'discovery'
        }));
        expect(FaceRepository.assignToBucket).toHaveBeenCalledWith([1, 2], 200);

        // Face 3 -> Noise handling (setNeedsBucketing false)
        expect(FaceRepository.setNeedsBucketing).toHaveBeenCalledWith([3], false);
    });

    it('should respect update entity_type in matching', async () => {
        // Arrange
        const faces = [
            { id: 1, descriptor: Buffer.alloc(128 * 4), entity_type: 'cat' }
        ];
        (FaceRepository.getFacesNeedingBucketing as any).mockReturnValue(faces);

        const matchSpy = vi.spyOn(FaceService, 'matchAgainstCentroids').mockReturnValue(null);

        // Act
        await (service as any).processNextBatch();

        // Assert
        expect(matchSpy).toHaveBeenCalledWith(
            expect.any(Array),
            expect.any(Array), // candidates
            expect.any(Number), // threshold
            'cat' // assert 'cat' was passed
        );
    });


    describe('Phase B5: Ignored Face Re-check', () => {
        it('should process ignored faces when re-check is active', async () => {
            // Setup
            (AppStateRepository.isRecheckActive as any).mockReturnValue(true);
            (AppStateRepository.getRecheckOffset as any).mockReturnValue(0);

            const ignoredFaces = [
                { id: 99, descriptor: Buffer.alloc(128 * 4), entity_type: 'human' }
            ];
            // Mock getIgnoredFacesForBucketing
            (FaceRepository.getIgnoredFacesForBucketing as any).mockReturnValue(ignoredFaces);

            // Mock Match
            vi.spyOn(FaceService, 'matchAgainstCentroids')
                .mockReturnValue({ personId: 5, distance: 0.1, matchType: 'centroid', personName: 'P5' } as any);

            // Mock Bucket Create
            (BucketRepository.createBucket as any).mockReturnValue(500);

            // Act
            // Call private method directly
            const count = await (service as any).processRecheckBatch();

            // Assert
            expect(count).toBe(1);
            expect(AppStateRepository.getRecheckOffset).toHaveBeenCalled();
            expect(FaceRepository.getIgnoredFacesForBucketing).toHaveBeenCalledWith(1000, 0);

            // Should create bucket for suggested person
            expect(BucketRepository.createBucket).toHaveBeenCalledWith(expect.objectContaining({
                bucketType: 'suggestion',
                suggestedPersonId: 5
            }));

            // Should assign ignored face to bucket
            expect(FaceRepository.assignToBucket).toHaveBeenCalledWith([99], 500);

            // Should increment offset
            expect(AppStateRepository.setRecheckOffset).toHaveBeenCalledWith(1);
        });

        it('should deactivate re-check when no faces remain', async () => {
            // Setup
            (AppStateRepository.isRecheckActive as any).mockReturnValue(true);
            (AppStateRepository.getRecheckOffset as any).mockReturnValue(100);

            // Empty result
            (FaceRepository.getIgnoredFacesForBucketing as any).mockReturnValue([]);

            // Act
            const count = await (service as any).processRecheckBatch();

            // Assert
            expect(count).toBe(0);
            expect(AppStateRepository.setRecheckActive).toHaveBeenCalledWith(false);
            expect(AppStateRepository.setRecheckOffset).toHaveBeenCalledWith(0);
        });
    });
});
