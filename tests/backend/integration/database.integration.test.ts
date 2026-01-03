/**
 * Database Integration Tests
 * 
 * Tests the real SQLite schema constraints and interactions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, closeTestDatabase, seedPhoto, seedPerson, seedFace } from '../mocks/mockDatabase';
import Database from 'better-sqlite3';

describe('Database Integration', () => {
    let db: Database.Database;

    beforeEach(() => {
        db = createTestDatabase();
    });

    afterEach(() => {
        closeTestDatabase();
    });

    describe('Photo-Face Relationship', () => {
        it('should cascade delete faces when a photo is deleted', () => {
            // Arrange
            const photoId = seedPhoto(db);
            seedFace(db, photoId);
            seedFace(db, photoId);

            // Assert setup
            const initialFaces = db.prepare('SELECT count(*) as count FROM faces WHERE photo_id = ?').get(photoId) as any;
            expect(initialFaces.count).toBe(2);

            // Act
            db.prepare('DELETE FROM photos WHERE id = ?').run(photoId);

            // Assert
            const finalFaces = db.prepare('SELECT count(*) as count FROM faces WHERE photo_id = ?').get(photoId) as any;
            expect(finalFaces.count).toBe(0);
        });

        it('should prevent adding a face for a non-existent photo (Foreign Key)', () => {
            // Act & Assert
            expect(() => {
                db.prepare('INSERT INTO faces (photo_id, box_json) VALUES (?, ?)').run(999, '{}');
            }).toThrow(); // SqliteError: FOREIGN KEY constraint failed
        });
    });

    describe('Person-Face Relationship', () => {
        it('should set person_id to NULL when a person is deleted (SET NULL)', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const personId = seedPerson(db, 'Alice');
            const faceId = seedFace(db, photoId, { person_id: personId });

            // Assert setup
            const faceBefore = db.prepare('SELECT person_id FROM faces WHERE id = ?').get(faceId) as any;
            expect(faceBefore.person_id).toBe(personId);

            // Act
            db.prepare('DELETE FROM people WHERE id = ?').run(personId);

            // Assert
            const faceAfter = db.prepare('SELECT person_id FROM faces WHERE id = ?').get(faceId) as any;
            expect(faceAfter.person_id).toBeNull();
        });
    });

    describe('Constraints', () => {
        it('should enforce unique file paths for photos', () => {
            // Arrange
            const path = '/duplicate/path.jpg';
            seedPhoto(db, { file_path: path });

            // Act & Assert
            expect(() => {
                seedPhoto(db, { file_path: path });
            }).toThrow();
        });

        it('should enforce unique names for people', () => {
            // Arrange
            seedPerson(db, 'Bob');

            // Act & Assert
            expect(() => {
                seedPerson(db, 'Bob');
            }).toThrow();
        });
    });
});
