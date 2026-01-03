/**
 * FaceAnalysisService Unit Tests
 * 
 * Tests the core face analysis functionality:
 * - Distance computation between embeddings
 * - Outlier detection for misassigned faces
 * 
 * Following TDD principles:
 * - Test behavior, not implementation
 * - AAA pattern (Arrange, Act, Assert)
 * - Mock external dependencies (repositories)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 1. Mock dependencies BEFORE importing the service
// This prevents the import chain from loading real db.ts which requires Electron
vi.mock('../../../../electron/data/repositories/PersonRepository', () => ({
    PersonRepository: {
        getPersonWithDescriptor: vi.fn()
    }
}));

vi.mock('../../../../electron/data/repositories/FaceRepository', () => ({
    FaceRepository: {
        getFacesWithDescriptorsByPerson: vi.fn()
    }
}));

// 2. Now import the service and repositories
import { FaceAnalysisService } from '../../../../electron/core/services/FaceAnalysisService';
import { PersonRepository } from '../../../../electron/data/repositories/PersonRepository';
import { FaceRepository } from '../../../../electron/data/repositories/FaceRepository';

// Helper to create mock face data with all required fields
const createMockFace = (id: number, descriptor: Buffer, blur_score: number) => ({
    id,
    descriptor,
    blur_score,
    box_json: JSON.stringify({ x: 0, y: 0, width: 100, height: 100 }),
    photo_id: 1,
    file_path: '/test/photo.jpg',
    preview_cache_path: null,
    width: 1920,
    height: 1080
});

describe('FaceAnalysisService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ========================================
    // computeDistance() Tests
    // ========================================
    describe('computeDistance()', () => {
        it('should return 0 for identical vectors', () => {
            // Arrange
            const vecA = [1, 0, 0, 0];
            const vecB = [1, 0, 0, 0];

            // Act
            const distance = FaceAnalysisService.computeDistance(vecA, vecB);

            // Assert
            expect(distance).toBe(0);
        });

        it('should return correct Euclidean distance for different vectors', () => {
            // Arrange
            const vecA = [1, 0, 0];
            const vecB = [0, 1, 0];

            // Act
            const distance = FaceAnalysisService.computeDistance(vecA, vecB);

            // Assert
            // sqrt((1-0)^2 + (0-1)^2 + (0-0)^2) = sqrt(2) ≈ 1.414
            expect(distance).toBeCloseTo(Math.sqrt(2), 5);
        });

        it('should return Infinity for null or undefined vectors', () => {
            // Act & Assert
            expect(FaceAnalysisService.computeDistance(null as any, [1, 2])).toBe(Infinity);
            expect(FaceAnalysisService.computeDistance([1, 2], null as any)).toBe(Infinity);
            expect(FaceAnalysisService.computeDistance(undefined as any, [1, 2])).toBe(Infinity);
        });

        it('should return Infinity for vectors of different lengths', () => {
            // Arrange
            const vecA = [1, 0, 0];
            const vecB = [1, 0, 0, 0, 0];

            // Act
            const distance = FaceAnalysisService.computeDistance(vecA, vecB);

            // Assert
            expect(distance).toBe(Infinity);
        });

        it('should handle 512-dimensional face embeddings', () => {
            // Arrange: Create two 512-dim vectors with known relationship
            const vecA = new Array(512).fill(0).map((_, i) => Math.sin(i * 0.1));
            const vecB = new Array(512).fill(0).map((_, i) => Math.sin(i * 0.1 + 0.01)); // Slightly shifted

            // Act
            const distance = FaceAnalysisService.computeDistance(vecA, vecB);

            // Assert: Should be a small positive number (similar vectors)
            expect(distance).toBeGreaterThan(0);
            expect(distance).toBeLessThan(1);
        });
    });

    // ========================================
    // parseDescriptor() Tests  
    // ========================================
    describe('parseDescriptor()', () => {
        it('should return null for null/undefined input', () => {
            expect(FaceAnalysisService.parseDescriptor(null)).toBeNull();
            expect(FaceAnalysisService.parseDescriptor(undefined)).toBeNull();
        });

        it('should return the array directly if already an array', () => {
            // Arrange
            const input = [0.1, 0.2, 0.3];

            // Act
            const result = FaceAnalysisService.parseDescriptor(input);

            // Assert
            expect(result).toEqual(input);
        });

        it('should parse JSON string to array', () => {
            // Arrange
            const jsonString = '[0.1, 0.2, 0.3]';

            // Act
            const result = FaceAnalysisService.parseDescriptor(jsonString);

            // Assert
            expect(result).toEqual([0.1, 0.2, 0.3]);
        });

        it('should parse Buffer (BLOB) to array', () => {
            // Arrange: Create a Float32Array buffer (mimics SQLite BLOB)
            const floats = new Float32Array([0.1, 0.2, 0.3, 0.4]);
            const buffer = Buffer.from(floats.buffer);

            // Act
            const result = FaceAnalysisService.parseDescriptor(buffer);

            // Assert
            expect(result).toHaveLength(4);
            expect(result![0]).toBeCloseTo(0.1, 5);
            expect(result![1]).toBeCloseTo(0.2, 5);
        });

        it('should return null for invalid JSON string', () => {
            // Arrange
            const invalidJson = 'not valid json';

            // Act
            const result = FaceAnalysisService.parseDescriptor(invalidJson);

            // Assert
            expect(result).toBeNull();
        });
    });

    // ========================================
    // findOutliersForPerson() Tests
    // ========================================
    describe('findOutliersForPerson()', () => {
        it('should throw error if person not found', () => {
            // Arrange
            vi.mocked(PersonRepository.getPersonWithDescriptor).mockReturnValue(null);

            // Act & Assert
            expect(() => FaceAnalysisService.findOutliersForPerson(999)).toThrow(
                'Person with ID 999 not found'
            );
        });

        it('should return centroidValid=false if person has no descriptor', () => {
            // Arrange
            vi.mocked(PersonRepository.getPersonWithDescriptor).mockReturnValue({
                id: 1,
                name: 'Test Person',
                descriptor_mean_json: null
            });

            // Act
            const result = FaceAnalysisService.findOutliersForPerson(1);

            // Assert
            expect(result.centroidValid).toBe(false);
            expect(result.outliers).toHaveLength(0);
            expect(result.personName).toBe('Test Person');
        });

        it('should identify faces above threshold as outliers', () => {
            // Arrange
            const centroid = [1, 0, 0, 0];
            const nearCentroid = new Float32Array([0.9, 0.1, 0, 0]); // Close to centroid
            const farFromCentroid = new Float32Array([0, 1, 0, 0]); // Far from centroid (distance ≈ 1.41)

            vi.mocked(PersonRepository.getPersonWithDescriptor).mockReturnValue({
                id: 1,
                name: 'Test Person',
                descriptor_mean_json: JSON.stringify(centroid)
            });

            vi.mocked(FaceRepository.getFacesWithDescriptorsByPerson).mockReturnValue([
                createMockFace(100, Buffer.from(nearCentroid.buffer), 50),
                createMockFace(101, Buffer.from(farFromCentroid.buffer), 60)
            ]);

            // Act
            const result = FaceAnalysisService.findOutliersForPerson(1, 0.5);

            // Assert
            expect(result.centroidValid).toBe(true);
            expect(result.totalFaces).toBe(2);
            expect(result.outliers.length).toBeGreaterThan(0);
            expect(result.outliers.some(o => o.faceId === 101)).toBe(true);
        });

        it('should return empty outliers array when all faces are within threshold', () => {
            // Arrange
            const centroid = [1, 0, 0, 0];
            const nearFace = new Float32Array([0.99, 0.01, 0, 0]);

            vi.mocked(PersonRepository.getPersonWithDescriptor).mockReturnValue({
                id: 1,
                name: 'Test Person',
                descriptor_mean_json: JSON.stringify(centroid)
            });

            vi.mocked(FaceRepository.getFacesWithDescriptorsByPerson).mockReturnValue([
                createMockFace(100, Buffer.from(nearFace.buffer), 50)
            ]);

            // Act
            const result = FaceAnalysisService.findOutliersForPerson(1, 0.5);

            // Assert
            expect(result.outliers).toHaveLength(0);
        });

        it('should sort outliers by distance (worst first)', () => {
            // Arrange
            const centroid = [1, 0, 0, 0];
            const medium = new Float32Array([0.5, 0.5, 0, 0]); // Distance ~0.71
            const far = new Float32Array([0, 1, 0, 0]); // Distance ~1.41

            vi.mocked(PersonRepository.getPersonWithDescriptor).mockReturnValue({
                id: 1,
                name: 'Test Person',
                descriptor_mean_json: JSON.stringify(centroid)
            });

            vi.mocked(FaceRepository.getFacesWithDescriptorsByPerson).mockReturnValue([
                createMockFace(100, Buffer.from(medium.buffer), 50),
                createMockFace(101, Buffer.from(far.buffer), 60)
            ]);

            // Act
            const result = FaceAnalysisService.findOutliersForPerson(1, 0.5);

            // Assert
            expect(result.outliers.length).toBe(2);
            expect(result.outliers[0].faceId).toBe(101); // Furthest first
            expect(result.outliers[0].distance).toBeGreaterThan(result.outliers[1].distance);
        });

        it('should use default threshold of 1.2 when not specified', () => {
            // Arrange
            const centroid = [1, 0, 0, 0];
            const justAbove = new Float32Array([0, 1, 0, 0]); // Distance ~1.41 (above 1.2)

            vi.mocked(PersonRepository.getPersonWithDescriptor).mockReturnValue({
                id: 1,
                name: 'Test Person',
                descriptor_mean_json: JSON.stringify(centroid)
            });

            vi.mocked(FaceRepository.getFacesWithDescriptorsByPerson).mockReturnValue([
                createMockFace(100, Buffer.from(justAbove.buffer), 50)
            ]);

            // Act
            const result = FaceAnalysisService.findOutliersForPerson(1);

            // Assert
            expect(result.threshold).toBe(1.2);
            expect(result.outliers.length).toBe(1); // Should be flagged at default 1.2
        });
    });
});
