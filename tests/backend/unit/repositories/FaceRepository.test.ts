/**
 * FaceRepository Unit Tests
 * 
 * Tests the FaceRepository class using an in-memory SQLite database.
 * Following testing-master.md guidelines: Test Behavior, Not Implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    createTestDatabase,
    closeTestDatabase,
    seedPhoto,
    seedFace,
    seedPerson,
    createTestDescriptor
} from '../../mocks/mockDatabase';
import Database from 'better-sqlite3';

// We need to mock the getDB import before importing FaceRepository
vi.mock('../../../../electron/db', () => ({
    getDB: vi.fn()
}));

import { FaceRepository } from '../../../../electron/data/repositories/FaceRepository';
import { getDB } from '../../../../electron/db';

describe('FaceRepository', () => {
    let db: Database.Database;

    beforeEach(() => {
        // Arrange: Create a fresh in-memory database for each test
        db = createTestDatabase();
        // Make getDB return our test database
        vi.mocked(getDB).mockReturnValue(db);
    });

    afterEach(() => {
        closeTestDatabase();
        vi.clearAllMocks();
    });

    // ==========================================
    // getFacesByIds
    // ==========================================
    describe('getFacesByIds', () => {
        it('should return empty array when given empty ids array', () => {
            // Act
            const result = FaceRepository.getFacesByIds([]);

            // Assert
            expect(result).toEqual([]);
        });

        it('should return faces matching the given ids', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const faceId1 = seedFace(db, photoId, { descriptor: createTestDescriptor(1) });
            const faceId2 = seedFace(db, photoId, { descriptor: createTestDescriptor(2) });
            seedFace(db, photoId); // Face 3, not requested

            // Act
            const result = FaceRepository.getFacesByIds([faceId1, faceId2]);

            // Assert
            expect(result).toHaveLength(2);
            expect(result.map((f: any) => f.id)).toContain(faceId1);
            expect(result.map((f: any) => f.id)).toContain(faceId2);
        });

        it('should parse box_json into box object', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const box = { x: 50, y: 75, width: 100, height: 120 };
            const faceId = seedFace(db, photoId, { box_json: JSON.stringify(box) });

            // Act
            const result = FaceRepository.getFacesByIds([faceId]);

            // Assert
            expect(result[0].box).toEqual(box);
        });

        it('should convert descriptor blob to number array', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const descriptor = createTestDescriptor(42);
            const faceId = seedFace(db, photoId, { descriptor });

            // Act
            const result = FaceRepository.getFacesByIds([faceId]);

            // Assert
            expect(result[0].descriptor).toBeInstanceOf(Array);
            expect(result[0].descriptor).toHaveLength(512);
            expect(typeof result[0].descriptor[0]).toBe('number');
        });
    });

    // ==========================================
    // ignoreFaces
    // ==========================================
    describe('ignoreFaces', () => {
        it('should not throw when given empty array', () => {
            // Act & Assert
            expect(() => FaceRepository.ignoreFaces([])).not.toThrow();
        });

        it('should set is_ignored to 1 for specified faces', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const faceId1 = seedFace(db, photoId, { is_ignored: 0 });
            const faceId2 = seedFace(db, photoId, { is_ignored: 0 });
            const faceId3 = seedFace(db, photoId, { is_ignored: 0 });

            // Act
            FaceRepository.ignoreFaces([faceId1, faceId2]);

            // Assert
            const face1 = db.prepare('SELECT is_ignored FROM faces WHERE id = ?').get(faceId1) as any;
            const face2 = db.prepare('SELECT is_ignored FROM faces WHERE id = ?').get(faceId2) as any;
            const face3 = db.prepare('SELECT is_ignored FROM faces WHERE id = ?').get(faceId3) as any;

            expect(face1.is_ignored).toBe(1);
            expect(face2.is_ignored).toBe(1);
            expect(face3.is_ignored).toBe(0); // Not affected
        });
    });

    // ==========================================
    // restoreFaces
    // ==========================================
    describe('restoreFaces', () => {
        it('should not throw when given empty array', () => {
            // Act & Assert
            expect(() => FaceRepository.restoreFaces([])).not.toThrow();
        });

        it('should set is_ignored to 0 for specified faces', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const faceId = seedFace(db, photoId, { is_ignored: 1 });

            // Act
            FaceRepository.restoreFaces([faceId]);

            // Assert
            const face = db.prepare('SELECT is_ignored FROM faces WHERE id = ?').get(faceId) as any;
            expect(face.is_ignored).toBe(0);
        });

        it('should assign person_id when provided', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const personId = seedPerson(db, 'Test Person');
            const faceId = seedFace(db, photoId, { is_ignored: 1 });

            // Act
            FaceRepository.restoreFaces([faceId], personId);

            // Assert
            const face = db.prepare('SELECT is_ignored, person_id FROM faces WHERE id = ?').get(faceId) as any;
            expect(face.is_ignored).toBe(0);
            expect(face.person_id).toBe(personId);
        });

        it('should set person_id to null when null is explicitly passed', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const personId = seedPerson(db, 'Test Person');
            const faceId = seedFace(db, photoId, { is_ignored: 1, person_id: personId });

            // Act
            FaceRepository.restoreFaces([faceId], null);

            // Assert
            const face = db.prepare('SELECT person_id FROM faces WHERE id = ?').get(faceId) as any;
            expect(face.person_id).toBeNull();
        });
    });

    // ==========================================
    // getIgnoredFaces
    // ==========================================
    describe('getIgnoredFaces', () => {
        it('should return only ignored faces', () => {
            // Arrange
            const photoId = seedPhoto(db);
            seedFace(db, photoId, { is_ignored: 1 });
            seedFace(db, photoId, { is_ignored: 1 });
            seedFace(db, photoId, { is_ignored: 0 }); // Not ignored

            // Act
            const result = FaceRepository.getIgnoredFaces();

            // Assert
            expect(result.faces).toHaveLength(2);
            expect(result.total).toBe(2);
        });

        it('should paginate results correctly', () => {
            // Arrange
            const photoId = seedPhoto(db);
            for (let i = 0; i < 10; i++) {
                seedFace(db, photoId, { is_ignored: 1 });
            }

            // Act - Get page 2 with 3 items per page
            const result = FaceRepository.getIgnoredFaces(2, 3);

            // Assert
            expect(result.faces).toHaveLength(3);
            expect(result.total).toBe(10);
        });
    });

    // ==========================================
    // getFaceById
    // ==========================================
    describe('getFaceById', () => {
        it('should return null for non-existent face', () => {
            // Act
            const result = FaceRepository.getFaceById(999);

            // Assert
            expect(result).toBeNull();
        });

        it('should return face with parsed box, descriptor, and confidence tier', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const box = { x: 10, y: 20, width: 30, height: 40 };
            const faceId = seedFace(db, photoId, {
                box_json: JSON.stringify(box),
                descriptor: createTestDescriptor(1),
                confidence_tier: 'review',
                match_distance: 0.55
            });

            // Act
            const result = FaceRepository.getFaceById(faceId);

            // Assert
            expect(result).not.toBeNull();
            expect(result!.id).toBe(faceId);
            expect(result!.box).toEqual(box);
            expect(result!.descriptor).toHaveLength(512);
            expect(result!.confidence_tier).toBe('review');
            expect(result!.match_distance).toBe(0.55);
        });
    });

    // ==========================================
    // getFacesByPhoto
    // ==========================================
    describe('getFacesByPhoto', () => {
        it('should return empty array for photo with no faces', () => {
            // Arrange
            const photoId = seedPhoto(db);

            // Act
            const result = FaceRepository.getFacesByPhoto(photoId);

            // Assert
            expect(result).toEqual([]);
        });

        it('should return all non-ignored faces for a photo', () => {
            // Arrange
            const photoId = seedPhoto(db);
            seedFace(db, photoId, { is_ignored: 0 });
            seedFace(db, photoId, { is_ignored: 0 });
            seedFace(db, photoId, { is_ignored: 1 }); // Ignored, should not appear

            // Act
            const result = FaceRepository.getFacesByPhoto(photoId);

            // Assert
            expect(result).toHaveLength(2);
        });

        it('should include person_name when face is assigned to a person', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const personId = seedPerson(db, 'Alice');
            seedFace(db, photoId, { person_id: personId });

            // Act
            const result = FaceRepository.getFacesByPhoto(photoId);

            // Assert
            expect(result[0].person_name).toBe('Alice');
        });
    });

    // ==========================================
    // deleteFaces
    // ==========================================
    describe('deleteFaces', () => {
        it('should not throw when given empty array or null', () => {
            // Act & Assert
            expect(() => FaceRepository.deleteFaces([])).not.toThrow();
        });

        it('should delete specified faces from database', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const faceId1 = seedFace(db, photoId);
            const faceId2 = seedFace(db, photoId);
            const faceId3 = seedFace(db, photoId);

            // Act
            FaceRepository.deleteFaces([faceId1, faceId2]);

            // Assert
            const remaining = db.prepare('SELECT id FROM faces').all() as any[];
            expect(remaining).toHaveLength(1);
            expect(remaining[0].id).toBe(faceId3);
        });
    });

    // ==========================================
    // updateFacePerson
    // ==========================================
    describe('updateFacePerson', () => {
        it('should not throw when given empty array', () => {
            // Act & Assert
            expect(() => FaceRepository.updateFacePerson([], 1)).not.toThrow();
        });

        it('should assign person_id to specified faces', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const personId = seedPerson(db, 'Bob');
            const faceId1 = seedFace(db, photoId);
            const faceId2 = seedFace(db, photoId);
            const faceId3 = seedFace(db, photoId);

            // Act
            FaceRepository.updateFacePerson([faceId1, faceId2], personId);

            // Assert
            const face1 = db.prepare('SELECT person_id FROM faces WHERE id = ?').get(faceId1) as any;
            const face2 = db.prepare('SELECT person_id FROM faces WHERE id = ?').get(faceId2) as any;
            const face3 = db.prepare('SELECT person_id FROM faces WHERE id = ?').get(faceId3) as any;

            expect(face1.person_id).toBe(personId);
            expect(face2.person_id).toBe(personId);
            expect(face3.person_id).toBeNull();
        });
    });

    // ==========================================
    // getUnclusteredFaces
    // ==========================================
    describe('getUnclusteredFaces', () => {
        it('should return faces without person_id', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const personId = seedPerson(db, 'Test');
            seedFace(db, photoId, { descriptor: createTestDescriptor(1), person_id: null });
            seedFace(db, photoId, { descriptor: createTestDescriptor(2), person_id: personId });

            // Act
            const result = FaceRepository.getUnclusteredFaces();

            // Assert
            expect(result.faces).toHaveLength(1);
            expect(result.total).toBe(1);
        });

        it('should exclude ignored faces', () => {
            // Arrange
            const photoId = seedPhoto(db);
            seedFace(db, photoId, { descriptor: createTestDescriptor(1), is_ignored: 0 });
            seedFace(db, photoId, { descriptor: createTestDescriptor(2), is_ignored: 1 });

            // Act
            const result = FaceRepository.getUnclusteredFaces();

            // Assert
            expect(result.faces).toHaveLength(1);
        });

        it('should exclude faces without descriptors', () => {
            // Arrange
            const photoId = seedPhoto(db);
            seedFace(db, photoId, { descriptor: createTestDescriptor(1) });
            seedFace(db, photoId, { descriptor: null });

            // Act
            const result = FaceRepository.getUnclusteredFaces();

            // Assert
            expect(result.faces).toHaveLength(1);
        });

        it('should exclude blurry faces (blur_score < 10)', () => {
            // Arrange
            const photoId = seedPhoto(db);
            seedFace(db, photoId, { descriptor: createTestDescriptor(1), blur_score: 50 }); // Good
            seedFace(db, photoId, { descriptor: createTestDescriptor(2), blur_score: 5 });  // Too blurry

            // Act
            const result = FaceRepository.getUnclusteredFaces();

            // Assert
            expect(result.faces).toHaveLength(1);
        });
    });

    // ==========================================
    // getBlurryFaces
    // ==========================================
    describe('getBlurryFaces', () => {
        it('should return faces with blur_score below threshold', () => {
            // Arrange
            const photoId = seedPhoto(db);
            seedFace(db, photoId, { blur_score: 5 });  // Blurry
            seedFace(db, photoId, { blur_score: 15 }); // Blurry
            seedFace(db, photoId, { blur_score: 50 }); // Clear, should not appear

            // Act
            const result = FaceRepository.getBlurryFaces({ threshold: 20 });

            // Assert
            expect(result.faces).toHaveLength(2);
            expect(result.total).toBe(2);
        });

        it('should filter by personId when provided', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const personId = seedPerson(db, 'Alice');
            seedFace(db, photoId, { blur_score: 5, person_id: personId });
            seedFace(db, photoId, { blur_score: 5, person_id: null });

            // Act
            const result = FaceRepository.getBlurryFaces({ personId, threshold: 20 });

            // Assert
            expect(result.faces).toHaveLength(1);
        });

        it('should exclude ignored faces', () => {
            // Arrange
            const photoId = seedPhoto(db);
            seedFace(db, photoId, { blur_score: 5, is_ignored: 0 });
            seedFace(db, photoId, { blur_score: 5, is_ignored: 1 });

            // Act
            const result = FaceRepository.getBlurryFaces({ threshold: 20 });

            // Assert
            expect(result.faces).toHaveLength(1);
        });
    });

    // ==========================================
    // getAllDescriptors
    // ==========================================
    describe('getAllDescriptors', () => {
        it('should return only faces with descriptors', () => {
            // Arrange
            const photoId = seedPhoto(db);
            seedFace(db, photoId, { descriptor: createTestDescriptor(1) });
            seedFace(db, photoId, { descriptor: createTestDescriptor(2) });
            seedFace(db, photoId, { descriptor: null });

            // Act
            const result = FaceRepository.getAllDescriptors();

            // Assert
            expect(result).toHaveLength(2);
            expect(result[0].descriptor).toHaveLength(512);
        });
    });

    // ==========================================
    // getUnassignedDescriptors
    // ==========================================
    describe('getUnassignedDescriptors', () => {
        it('should return only unassigned, non-ignored faces with descriptors', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const personId = seedPerson(db, 'Named');
            seedFace(db, photoId, { descriptor: createTestDescriptor(1), person_id: null, is_ignored: 0 }); // Include
            seedFace(db, photoId, { descriptor: createTestDescriptor(2), person_id: personId, is_ignored: 0 }); // Exclude (assigned)
            seedFace(db, photoId, { descriptor: createTestDescriptor(3), person_id: null, is_ignored: 1 }); // Exclude (ignored)
            seedFace(db, photoId, { descriptor: null, person_id: null, is_ignored: 0 }); // Exclude (no descriptor)

            // Act
            const result = FaceRepository.getUnassignedDescriptors();

            // Assert
            expect(result).toHaveLength(1);
        });
    });
});
