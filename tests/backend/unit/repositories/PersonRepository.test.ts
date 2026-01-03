/**
 * PersonRepository Unit Tests
 * 
 * Tests the PersonRepository class using an in-memory SQLite database.
 * Following testing-master.md guidelines: Test Behavior, Not Implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    createTestDatabase,
    closeTestDatabase,
    seedPerson,
    seedPhoto,
    seedFace
} from '../../mocks/mockDatabase';
import Database from 'better-sqlite3';

// Mock the getDB import before importing PersonRepository
vi.mock('../../../../electron/db', () => ({
    getDB: vi.fn()
}));

import { PersonRepository } from '../../../../electron/data/repositories/PersonRepository';
import { getDB } from '../../../../electron/db';

describe('PersonRepository', () => {
    let db: Database.Database;

    beforeEach(() => {
        // Arrange: Create a fresh in-memory database for each test
        db = createTestDatabase();
        // Add descriptor_mean_json column that wasn't in original mock schema
        db.exec('ALTER TABLE people ADD COLUMN descriptor_mean_json TEXT');
        // Make getDB return our test database
        vi.mocked(getDB).mockReturnValue(db);
    });

    afterEach(() => {
        closeTestDatabase();
        vi.clearAllMocks();
    });

    // ==========================================
    // createPerson
    // ==========================================
    describe('createPerson', () => {
        it('should create a new person with the given name', () => {
            // Act
            const result = PersonRepository.createPerson('Alice');

            // Assert
            expect(result).not.toBeNull();
            expect(result.name).toBe('Alice');
            expect(result.id).toBeGreaterThan(0);
        });

        it('should trim whitespace from name', () => {
            // Act
            const result = PersonRepository.createPerson('  Bob  ');

            // Assert
            expect(result.name).toBe('Bob');
        });

        it('should not create duplicate (returns existing person)', () => {
            // Arrange
            PersonRepository.createPerson('Charlie');

            // Act
            const result = PersonRepository.createPerson('Charlie');

            // Assert
            const allPeople = db.prepare('SELECT * FROM people WHERE name = ?').all('Charlie');
            expect(allPeople).toHaveLength(1);
            expect(result.name).toBe('Charlie');
        });

        it('should be case-insensitive for duplicates', () => {
            // Arrange
            PersonRepository.createPerson('DAVID');

            // Act
            const result = PersonRepository.createPerson('david');

            // Assert
            // Should return existing person (case insensitive match)
            expect(result.name).toBe('DAVID');
        });
    });

    // ==========================================
    // getPersonById
    // ==========================================
    describe('getPersonById', () => {
        it('should return undefined for non-existent person', () => {
            // Act
            const result = PersonRepository.getPersonById(999);

            // Assert
            expect(result).toBeUndefined();
        });

        it('should return person with all fields', () => {
            // Arrange
            const personId = seedPerson(db, 'Test Person');

            // Act
            const result = PersonRepository.getPersonById(personId) as any;

            // Assert
            expect(result).not.toBeNull();
            expect(result.id).toBe(personId);
            expect(result.name).toBe('Test Person');
        });
    });

    // ==========================================
    // getPersonByName
    // ==========================================
    describe('getPersonByName', () => {
        it('should return undefined for non-existent person', () => {
            // Act
            const result = PersonRepository.getPersonByName('Nobody');

            // Assert
            expect(result).toBeUndefined();
        });

        it('should find person case-insensitively', () => {
            // Arrange
            seedPerson(db, 'Emily');

            // Act
            const result = PersonRepository.getPersonByName('EMILY') as any;

            // Assert
            expect(result).not.toBeNull();
            expect(result.name).toBe('Emily');
        });

        it('should trim input before matching', () => {
            // Arrange
            seedPerson(db, 'Frank');

            // Act
            const result = PersonRepository.getPersonByName('  Frank  ') as any;

            // Assert
            expect(result).not.toBeNull();
            expect(result.name).toBe('Frank');
        });
    });

    // ==========================================
    // updatePersonName
    // ==========================================
    describe('updatePersonName', () => {
        it('should update person name', () => {
            // Arrange
            const personId = seedPerson(db, 'Old Name');

            // Act
            PersonRepository.updatePersonName(personId, 'New Name');

            // Assert
            const person = db.prepare('SELECT name FROM people WHERE id = ?').get(personId) as any;
            expect(person.name).toBe('New Name');
        });

        it('should trim whitespace from new name', () => {
            // Arrange
            const personId = seedPerson(db, 'Original');

            // Act
            PersonRepository.updatePersonName(personId, '  Trimmed  ');

            // Assert
            const person = db.prepare('SELECT name FROM people WHERE id = ?').get(personId) as any;
            expect(person.name).toBe('Trimmed');
        });
    });

    // ==========================================
    // deletePerson
    // ==========================================
    describe('deletePerson', () => {
        it('should remove person from database', () => {
            // Arrange
            const personId = seedPerson(db, 'To Delete');

            // Act
            PersonRepository.deletePerson(personId);

            // Assert
            const person = db.prepare('SELECT * FROM people WHERE id = ?').get(personId);
            expect(person).toBeUndefined();
        });

        it('should not throw when deleting non-existent person', () => {
            // Act & Assert
            expect(() => PersonRepository.deletePerson(999)).not.toThrow();
        });
    });

    // ==========================================
    // updateDescriptorMean
    // ==========================================
    describe('updateDescriptorMean', () => {
        it('should set descriptor_mean_json', () => {
            // Arrange
            const personId = seedPerson(db, 'Test');
            const descriptorJson = JSON.stringify([0.1, 0.2, 0.3]);

            // Act
            PersonRepository.updateDescriptorMean(personId, descriptorJson);

            // Assert
            const person = db.prepare('SELECT descriptor_mean_json FROM people WHERE id = ?').get(personId) as any;
            expect(JSON.parse(person.descriptor_mean_json)).toEqual([0.1, 0.2, 0.3]);
        });

        it('should set descriptor_mean_json to null', () => {
            // Arrange
            const personId = seedPerson(db, 'Test');
            db.prepare('UPDATE people SET descriptor_mean_json = ? WHERE id = ?').run(
                JSON.stringify([0.1, 0.2]),
                personId
            );

            // Act
            PersonRepository.updateDescriptorMean(personId, null);

            // Assert
            const person = db.prepare('SELECT descriptor_mean_json FROM people WHERE id = ?').get(personId) as any;
            expect(person.descriptor_mean_json).toBeNull();
        });
    });

    // ==========================================
    // getPeopleWithDescriptors
    // ==========================================
    describe('getPeopleWithDescriptors', () => {
        it('should return only people with descriptor_mean_json', () => {
            // Arrange
            const person1 = seedPerson(db, 'With Descriptor');
            const person2 = seedPerson(db, 'Without Descriptor');
            db.prepare('UPDATE people SET descriptor_mean_json = ? WHERE id = ?').run(
                JSON.stringify([0.1, 0.2, 0.3]),
                person1
            );

            // Act
            const result = PersonRepository.getPeopleWithDescriptors();

            // Assert
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('With Descriptor');
            expect(result[0].descriptor).toEqual([0.1, 0.2, 0.3]);
        });

        it('should return empty array when no people have descriptors', () => {
            // Arrange
            seedPerson(db, 'No Descriptor');

            // Act
            const result = PersonRepository.getPeopleWithDescriptors();

            // Assert
            expect(result).toEqual([]);
        });
    });

    // ==========================================
    // setPersonCover
    // ==========================================
    describe('setPersonCover', () => {
        it('should set cover_face_id for person', () => {
            // Arrange
            const personId = seedPerson(db, 'Test');
            const photoId = seedPhoto(db);
            const faceId = seedFace(db, photoId);

            // Act
            PersonRepository.setPersonCover(personId, faceId);

            // Assert
            const person = db.prepare('SELECT cover_face_id FROM people WHERE id = ?').get(personId) as any;
            expect(person.cover_face_id).toBe(faceId);
        });

        it('should set cover_face_id to null', () => {
            // Arrange
            const personId = seedPerson(db, 'Test');
            const photoId = seedPhoto(db);
            const faceId = seedFace(db, photoId);
            db.prepare('UPDATE people SET cover_face_id = ? WHERE id = ?').run(faceId, personId);

            // Act
            PersonRepository.setPersonCover(personId, null);

            // Assert
            const person = db.prepare('SELECT cover_face_id FROM people WHERE id = ?').get(personId) as any;
            expect(person.cover_face_id).toBeNull();
        });
    });

    // ==========================================
    // getPeople
    // ==========================================
    describe('getPeople', () => {
        it('should return all people with correct face counts', () => {
            // Arrange
            const person1 = seedPerson(db, 'Person 1');
            const person2 = seedPerson(db, 'Person 2');
            const photoId = seedPhoto(db);

            // Person 2 has more faces
            seedFace(db, photoId, { person_id: person1 });
            seedFace(db, photoId, { person_id: person2 });
            seedFace(db, photoId, { person_id: person2 });

            // Act
            const result = PersonRepository.getPeople() as any[];

            // Assert
            expect(result).toHaveLength(2);

            // Find each person in results and verify their face count
            const p1 = result.find((p: any) => p.name === 'Person 1');
            const p2 = result.find((p: any) => p.name === 'Person 2');

            expect(p1.face_count).toBe(1);
            expect(p2.face_count).toBe(2);
        });

        it('should return empty array when no people exist', () => {
            // Act
            const result = PersonRepository.getPeople();

            // Assert
            expect(result).toEqual([]);
        });
    });
});
