/**
 * PhotoRepository Unit Tests
 * 
 * Tests the PhotoRepository class using an in-memory SQLite database.
 * Following testing-master.md guidelines: Test Behavior, Not Implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    createTestDatabase,
    closeTestDatabase,
    seedPhoto,
    seedFace,
    seedPerson
} from '../../mocks/mockDatabase';
import Database from 'better-sqlite3';

// Mock the getDB import before importing PhotoRepository
vi.mock('../../../../electron/db', () => ({
    getDB: vi.fn()
}));

import { PhotoRepository } from '../../../../electron/data/repositories/PhotoRepository';
import { getDB } from '../../../../electron/db';

// Additional schema for PhotoRepository tests
const ADDITIONAL_SCHEMA = `
  -- Tags table
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  -- Photo tags linking table
  CREATE TABLE IF NOT EXISTS photo_tags (
    photo_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    source TEXT DEFAULT 'manual',
    PRIMARY KEY (photo_id, tag_id),
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );

  -- Scan history table
  CREATE TABLE IF NOT EXISTS scan_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id INTEGER,
    file_path TEXT,
    scan_ms INTEGER,
    tag_ms INTEGER,
    face_count INTEGER,
    scan_mode TEXT,
    status TEXT,
    error TEXT,
    timestamp INTEGER
  );

  -- Scan errors table
  CREATE TABLE IF NOT EXISTS scan_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT,
    error TEXT,
    timestamp INTEGER DEFAULT CURRENT_TIMESTAMP
  );

  -- Add blur_score column to photos
  ALTER TABLE photos ADD COLUMN blur_score REAL;
  
  -- Add description column to photos
  ALTER TABLE photos ADD COLUMN description TEXT;
`;

describe('PhotoRepository', () => {
    let db: Database.Database;

    beforeEach(() => {
        // Arrange: Create a fresh in-memory database for each test
        db = createTestDatabase();
        // Add additional tables needed by PhotoRepository
        db.exec(ADDITIONAL_SCHEMA);
        // Make getDB return our test database
        vi.mocked(getDB).mockReturnValue(db);
    });

    afterEach(() => {
        closeTestDatabase();
        vi.clearAllMocks();
    });

    // ==========================================
    // getPhotoById
    // ==========================================
    describe('getPhotoById', () => {
        it('should return undefined for non-existent photo', () => {
            // Act
            const result = PhotoRepository.getPhotoById(999);

            // Assert
            expect(result).toBeUndefined();
        });

        it('should return photo with all fields', () => {
            // Arrange
            const photoId = seedPhoto(db, {
                file_path: '/photos/test.jpg',
                file_name: 'test.jpg'
            });

            // Act
            const result = PhotoRepository.getPhotoById(photoId) as any;

            // Assert
            expect(result).not.toBeNull();
            expect(result.id).toBe(photoId);
            expect(result.file_path).toBe('/photos/test.jpg');
        });
    });

    // ==========================================
    // getPhotos
    // ==========================================
    describe('getPhotos', () => {
        it('should return empty result when no photos exist', () => {
            // Act
            const result = PhotoRepository.getPhotos();

            // Assert
            expect(result.photos).toEqual([]);
            expect(result.total).toBe(0);
        });

        it('should return paginated results', () => {
            // Arrange
            for (let i = 0; i < 10; i++) {
                seedPhoto(db);
            }

            // Act
            const result = PhotoRepository.getPhotos(1, 3); // Page 1, 3 items

            // Assert
            expect(result.photos).toHaveLength(3);
            expect(result.total).toBe(10);
        });

        it('should filter by folder', () => {
            // Arrange
            seedPhoto(db, { file_path: '/folder1/photo1.jpg' });
            seedPhoto(db, { file_path: '/folder1/photo2.jpg' });
            seedPhoto(db, { file_path: '/folder2/photo3.jpg' });

            // Act
            const result = PhotoRepository.getPhotos(1, 50, 'date_desc', { folder: '/folder1' });

            // Assert
            expect(result.photos).toHaveLength(2);
            expect(result.total).toBe(2);
        });

        it('should filter by search term', () => {
            // Arrange
            seedPhoto(db, { file_path: '/photos/birthday_party.jpg' });
            seedPhoto(db, { file_path: '/photos/vacation.jpg' });
            seedPhoto(db, { file_path: '/photos/party_time.jpg' });

            // Act
            const result = PhotoRepository.getPhotos(1, 50, 'date_desc', { search: 'party' });

            // Assert
            expect(result.photos).toHaveLength(2);
        });

        it('should filter by person', () => {
            // Arrange
            const personId = seedPerson(db, 'Alice');
            const photo1 = seedPhoto(db);
            const photo2 = seedPhoto(db);
            seedPhoto(db); // Photo without Alice

            seedFace(db, photo1, { person_id: personId });
            seedFace(db, photo2, { person_id: personId });

            // Act
            const result = PhotoRepository.getPhotos(1, 50, 'date_desc', { people: [personId] });

            // Assert
            expect(result.photos).toHaveLength(2);
        });
    });

    // ==========================================
    // updatePhoto
    // ==========================================
    describe('updatePhoto', () => {
        it('should update description', () => {
            // Arrange
            const photoId = seedPhoto(db);

            // Act
            PhotoRepository.updatePhoto(photoId, { description: 'Test description' });

            // Assert
            const photo = db.prepare('SELECT description FROM photos WHERE id = ?').get(photoId) as any;
            expect(photo.description).toBe('Test description');
        });

        it('should update blur_score', () => {
            // Arrange
            const photoId = seedPhoto(db);

            // Act
            PhotoRepository.updatePhoto(photoId, { blur_score: 42.5 });

            // Assert
            const photo = db.prepare('SELECT blur_score FROM photos WHERE id = ?').get(photoId) as any;
            expect(photo.blur_score).toBe(42.5);
        });

        it('should do nothing when no updates provided', () => {
            // Arrange
            const photoId = seedPhoto(db);

            // Act & Assert (should not throw)
            expect(() => PhotoRepository.updatePhoto(photoId, {})).not.toThrow();
        });
    });

    // ==========================================
    // getFilePaths
    // ==========================================
    describe('getFilePaths', () => {
        it('should return empty array for empty ids', () => {
            // Act
            const result = PhotoRepository.getFilePaths([]);

            // Assert
            expect(result).toEqual([]);
        });

        it('should return file paths for given ids', () => {
            // Arrange
            const id1 = seedPhoto(db, { file_path: '/path/to/photo1.jpg' });
            const id2 = seedPhoto(db, { file_path: '/path/to/photo2.jpg' });
            seedPhoto(db, { file_path: '/path/to/photo3.jpg' }); // Not requested

            // Act
            const result = PhotoRepository.getFilePaths([id1, id2]);

            // Assert
            expect(result).toHaveLength(2);
            expect(result).toContain('/path/to/photo1.jpg');
            expect(result).toContain('/path/to/photo2.jpg');
        });
    });

    // ==========================================
    // getUnprocessedPhotos
    // ==========================================
    describe('getUnprocessedPhotos', () => {
        it('should return photos without blur_score', () => {
            // Arrange
            seedPhoto(db); // Neither has blur_score by default
            seedPhoto(db);
            const processedId = seedPhoto(db);
            db.prepare('UPDATE photos SET blur_score = 50 WHERE id = ?').run(processedId);

            // Act
            const result = PhotoRepository.getUnprocessedPhotos();

            // Assert
            expect(result).toHaveLength(2);
        });
    });

    // ==========================================
    // Tags
    // ==========================================
    describe('addTags', () => {
        it('should add tags to photo', () => {
            // Arrange
            const photoId = seedPhoto(db);

            // Act
            PhotoRepository.addTags(photoId, ['sunset', 'beach', 'vacation']);

            // Assert
            const tags = PhotoRepository.getTagsForPhoto(photoId);
            expect(tags).toHaveLength(3);
            expect(tags).toContain('sunset');
            expect(tags).toContain('beach');
            expect(tags).toContain('vacation');
        });

        it('should normalize tags to lowercase', () => {
            // Arrange
            const photoId = seedPhoto(db);

            // Act
            PhotoRepository.addTags(photoId, ['SUNSET', 'Beach']);

            // Assert
            const tags = PhotoRepository.getTagsForPhoto(photoId);
            expect(tags).toContain('sunset');
            expect(tags).toContain('beach');
        });

        it('should not create duplicate tag links', () => {
            // Arrange
            const photoId = seedPhoto(db);
            PhotoRepository.addTags(photoId, ['sunset']);

            // Act - Add same tag again
            PhotoRepository.addTags(photoId, ['sunset']);

            // Assert
            const tags = PhotoRepository.getTagsForPhoto(photoId);
            expect(tags).toHaveLength(1);
        });
    });

    describe('removeTag', () => {
        it('should remove tag from photo', () => {
            // Arrange
            const photoId = seedPhoto(db);
            PhotoRepository.addTags(photoId, ['sunset', 'beach']);

            // Act
            PhotoRepository.removeTag(photoId, 'sunset');

            // Assert
            const tags = PhotoRepository.getTagsForPhoto(photoId);
            expect(tags).toHaveLength(1);
            expect(tags).not.toContain('sunset');
            expect(tags).toContain('beach');
        });

        it('should not throw when removing non-existent tag', () => {
            // Arrange
            const photoId = seedPhoto(db);

            // Act & Assert
            expect(() => PhotoRepository.removeTag(photoId, 'nonexistent')).not.toThrow();
        });
    });

    describe('getAllTags', () => {
        it('should return all tags', () => {
            // Arrange
            const photoId = seedPhoto(db);
            PhotoRepository.addTags(photoId, ['alpha', 'zebra', 'mountain']);

            // Act
            const result = PhotoRepository.getAllTags() as any[];

            // Assert
            expect(result).toHaveLength(3);
            // Should be ordered alphabetically
            expect(result[0].name).toBe('alpha');
            expect(result[1].name).toBe('mountain');
            expect(result[2].name).toBe('zebra');
        });
    });

    // ==========================================
    // factoryReset
    // ==========================================
    describe('factoryReset', () => {
        it('should delete all data from relevant tables', () => {
            // Arrange
            const photoId = seedPhoto(db);
            const personId = seedPerson(db, 'Test Person');
            seedFace(db, photoId, { person_id: personId });
            PhotoRepository.addTags(photoId, ['test']);

            // Act
            const result = PhotoRepository.factoryReset();

            // Assert
            expect(result.success).toBe(true);
            expect(db.prepare('SELECT COUNT(*) as c FROM photos').get()).toEqual({ c: 0 });
            expect(db.prepare('SELECT COUNT(*) as c FROM faces').get()).toEqual({ c: 0 });
            expect(db.prepare('SELECT COUNT(*) as c FROM people').get()).toEqual({ c: 0 });
            expect(db.prepare('SELECT COUNT(*) as c FROM tags').get()).toEqual({ c: 0 });
        });
    });

    // ==========================================
    // clearAITags
    // ==========================================
    describe('clearAITags', () => {
        it('should remove only auto-sourced tags', () => {
            // Arrange
            const photoId = seedPhoto(db);
            PhotoRepository.addTags(photoId, ['auto_tag']); // source = 'auto'

            // Manually add a 'manual' tag
            db.prepare('INSERT INTO tags (name) VALUES (?)').run('manual_tag');
            const manualTagId = (db.prepare('SELECT id FROM tags WHERE name = ?').get('manual_tag') as any).id;
            db.prepare('INSERT INTO photo_tags (photo_id, tag_id, source) VALUES (?, ?, ?)').run(photoId, manualTagId, 'manual');

            // Act
            const result = PhotoRepository.clearAITags();

            // Assert
            expect(result.success).toBe(true);
            const tags = PhotoRepository.getTagsForPhoto(photoId);
            expect(tags).toHaveLength(1);
            expect(tags).toContain('manual_tag');
        });
    });

    // ==========================================
    // getPhotosForTargetedScan
    // ==========================================
    describe('getPhotosForTargetedScan', () => {
        it('should filter by folder path', () => {
            // Arrange
            seedPhoto(db, { file_path: '/folder1/photo1.jpg' });
            seedPhoto(db, { file_path: '/folder1/subfolder/photo2.jpg' });
            seedPhoto(db, { file_path: '/folder2/photo3.jpg' });

            // Act
            const result = PhotoRepository.getPhotosForTargetedScan({ folderPath: '/folder1' });

            // Assert
            expect(result).toHaveLength(2);
        });

        it('should filter to only photos with faces', () => {
            // Arrange
            const photo1 = seedPhoto(db);
            const photo2 = seedPhoto(db);
            seedPhoto(db); // No face

            seedFace(db, photo1);
            seedFace(db, photo2);

            // Act
            const result = PhotoRepository.getPhotosForTargetedScan({ onlyWithFaces: true });

            // Assert
            expect(result).toHaveLength(2);
        });
    });
});
