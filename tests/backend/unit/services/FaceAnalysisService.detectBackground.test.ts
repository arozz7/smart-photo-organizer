/**
 * FaceNoiseService.detectBackgroundFaces Unit Tests
 * 
 * Tests the background face detection functionality:
 * - Empty face handling
 * - Filtering based on thresholds
 * - Integration with Python backend
 * 
 * Following TDD principles:
 * - Test behavior, not implementation
 * - AAA pattern (Arrange, Act, Assert)
 * - Mock external dependencies
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 1. Mock dependencies BEFORE importing the service
vi.mock('../../../../electron/data/repositories/PersonRepository', () => ({
    PersonRepository: {
        getPersonWithDescriptor: vi.fn(),
        getPeopleWithDescriptors: vi.fn()
    }
}));

vi.mock('../../../../electron/data/repositories/FaceRepository', () => ({
    FaceRepository: {
        getFacesWithDescriptorsByPerson: vi.fn(),
        getUnnamedFacesForNoiseDetection: vi.fn()
    }
}));

// Mock FaceAnalysisService for parseDescriptor
vi.mock('../../../../electron/core/services/FaceAnalysisService', () => ({
    FaceAnalysisService: {
        parseDescriptor: (raw: unknown) => {
            if (!raw) return null;
            if (Array.isArray(raw)) return raw;
            if (Buffer.isBuffer(raw)) {
                const floatArray = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
                return Array.from(floatArray);
            }
            return null;
        }
    }
}));

// 2. Now import the service and repositories
import { FaceNoiseService } from '../../../../electron/core/services/FaceNoiseService';
import { PersonRepository } from '../../../../electron/data/repositories/PersonRepository';
import { FaceRepository } from '../../../../electron/data/repositories/FaceRepository';

// Helper to create mock unnamed face
const createMockUnnamedFace = (id: number, descriptor: Buffer, photo_id = 1) => ({
    id,
    descriptor,
    box_json: JSON.stringify({ x: 0, y: 0, width: 100, height: 100 }),
    photo_id,
    file_path: '/test/photo.jpg',
    preview_cache_path: null,
    width: 1920,
    height: 1080
});

// Mock Python provider
const createMockPythonProvider = (response: any) => ({
    sendRequest: vi.fn().mockResolvedValue(response)
});

describe('FaceAnalysisService.detectBackgroundFaces', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return empty candidates when no unnamed faces exist', async () => {
        // Arrange
        vi.mocked(FaceRepository.getUnnamedFacesForNoiseDetection).mockReturnValue([]);
        const mockPython = createMockPythonProvider({ success: true, candidates: [], stats: {} });

        // Act
        const result = await FaceNoiseService.detectBackgroundFaces({}, mockPython);

        // Assert
        expect(result.candidates).toHaveLength(0);
        expect(result.stats.totalUnnamed).toBe(0);
        // Python should NOT be called when there are no faces
        expect(mockPython.sendRequest).not.toHaveBeenCalled();
    });

    it('should send unnamed faces and centroids to Python backend', async () => {
        // Arrange
        const faceDescriptor = new Float32Array([1, 0, 0, 0]);
        const faceBuffer = Buffer.from(faceDescriptor.buffer);

        vi.mocked(FaceRepository.getUnnamedFacesForNoiseDetection).mockReturnValue([
            createMockUnnamedFace(100, faceBuffer, 1),
            createMockUnnamedFace(101, faceBuffer, 2)
        ]);

        vi.mocked(PersonRepository.getPeopleWithDescriptors).mockReturnValue([
            { id: 1, name: 'John', descriptor: [1, 0, 0, 0] }
        ]);

        const mockPython = createMockPythonProvider({
            success: true,
            candidates: [{ faceId: 100, photoCount: 1, clusterSize: 1, nearestPersonDistance: 0.8, nearestPersonName: 'John' }],
            stats: { totalUnnamed: 2, singlePhotoCount: 2, twoPhotoCount: 0, noiseCount: 1 }
        });

        // Act
        await FaceNoiseService.detectBackgroundFaces({}, mockPython);

        // Assert
        expect(mockPython.sendRequest).toHaveBeenCalledWith('detect_background_faces', expect.objectContaining({
            faces: expect.any(Array),
            centroids: expect.any(Array),
            minPhotoAppearances: 3,
            maxClusterSize: 2,
            centroidDistanceThreshold: 0.7
        }));
    });

    it('should use custom threshold options when provided', async () => {
        // Arrange
        const faceDescriptor = new Float32Array([1, 0, 0, 0]);
        const faceBuffer = Buffer.from(faceDescriptor.buffer);

        vi.mocked(FaceRepository.getUnnamedFacesForNoiseDetection).mockReturnValue([
            createMockUnnamedFace(100, faceBuffer)
        ]);
        vi.mocked(PersonRepository.getPeopleWithDescriptors).mockReturnValue([]);

        const mockPython = createMockPythonProvider({ success: true, candidates: [], stats: {} });

        // Act
        await FaceNoiseService.detectBackgroundFaces({
            minPhotoAppearances: 5,
            maxClusterSize: 3,
            centroidDistanceThreshold: 0.5
        }, mockPython);

        // Assert
        expect(mockPython.sendRequest).toHaveBeenCalledWith('detect_background_faces', expect.objectContaining({
            minPhotoAppearances: 5,
            maxClusterSize: 3,
            centroidDistanceThreshold: 0.5
        }));
    });

    it('should transform Python response to NoiseCandidate format', async () => {
        // Arrange
        const faceDescriptor = new Float32Array([1, 0, 0, 0]);
        const faceBuffer = Buffer.from(faceDescriptor.buffer);

        vi.mocked(FaceRepository.getUnnamedFacesForNoiseDetection).mockReturnValue([
            createMockUnnamedFace(100, faceBuffer)
        ]);
        vi.mocked(PersonRepository.getPeopleWithDescriptors).mockReturnValue([]);

        const mockPython = createMockPythonProvider({
            success: true,
            candidates: [{
                faceId: 100,
                photoCount: 1,
                clusterSize: 1,
                nearestPersonDistance: 0.85,
                nearestPersonName: null,
                box_json: '{"x": 10, "y": 20, "width": 50, "height": 60}',
                photo_id: 1,
                file_path: '/photos/test.jpg',
                preview_cache_path: '/cache/test.jpg',
                width: 1920,
                height: 1080
            }],
            stats: { totalUnnamed: 1, singlePhotoCount: 1, twoPhotoCount: 0, noiseCount: 1 }
        });

        // Act
        const result = await FaceNoiseService.detectBackgroundFaces({}, mockPython);

        // Assert
        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0]).toMatchObject({
            faceId: 100,
            photoCount: 1,
            clusterSize: 1,
            nearestPersonDistance: 0.85,
            nearestPersonName: null,
            box: { x: 10, y: 20, width: 50, height: 60 },
            photo_id: 1,
            file_path: '/photos/test.jpg'
        });
    });

    it('should throw error when Python backend fails', async () => {
        // Arrange
        const faceDescriptor = new Float32Array([1, 0, 0, 0]);
        const faceBuffer = Buffer.from(faceDescriptor.buffer);

        vi.mocked(FaceRepository.getUnnamedFacesForNoiseDetection).mockReturnValue([
            createMockUnnamedFace(100, faceBuffer)
        ]);
        vi.mocked(PersonRepository.getPeopleWithDescriptors).mockReturnValue([]);

        const mockPython = createMockPythonProvider({
            success: false,
            error: 'DBSCAN clustering failed'
        });

        // Act & Assert
        await expect(FaceNoiseService.detectBackgroundFaces({}, mockPython))
            .rejects.toThrow('DBSCAN clustering failed');
    });
    it('should include Era centroids in the payload sent to Python', async () => {
        // Arrange
        const faceDescriptor = new Float32Array([1, 0, 0, 0]);
        const faceBuffer = Buffer.from(faceDescriptor.buffer);

        vi.mocked(FaceRepository.getUnnamedFacesForNoiseDetection).mockReturnValue([
            createMockUnnamedFace(100, faceBuffer)
        ]);

        // Mock a person with Eras
        vi.mocked(PersonRepository.getPeopleWithDescriptors).mockReturnValue([
            {
                id: 1,
                name: 'John',
                descriptor: [1, 0, 0, 0],
                eras: [
                    { name: 'Young John', centroid: [0.9, 0.1, 0, 0] },
                    { name: 'Old John', centroid: [0.8, 0.2, 0, 0] }
                ]
            }
        ]);

        const mockPython = createMockPythonProvider({ success: true, candidates: [], stats: {} });

        // Act
        await FaceNoiseService.detectBackgroundFaces({}, mockPython);

        // Assert
        expect(mockPython.sendRequest).toHaveBeenCalledWith('detect_background_faces', expect.objectContaining({
            // Should contain 3 centroids: 1 main + 2 eras
            centroids: expect.arrayContaining([
                expect.objectContaining({ personId: 1, name: 'John', descriptor: [1, 0, 0, 0] }),
                expect.objectContaining({ personId: 1, name: 'Young John', descriptor: [0.9, 0.1, 0, 0] }),
                expect.objectContaining({ personId: 1, name: 'Old John', descriptor: [0.8, 0.2, 0, 0] })
            ])
        }));

        // precise length check
        const callArgs = mockPython.sendRequest.mock.calls[0][1];
        expect(callArgs.centroids).toHaveLength(3);
    });
});
