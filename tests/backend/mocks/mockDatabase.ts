/**
 * Mock Database Utility
 * 
 * Uses in-memory SQLite for integration tests.
 * Provides a clean database for each test suite.
 */

import { vi } from 'vitest';
console.log('--- MOCK DATABASE INIT ---');
console.log('RUNTIME NODE VERSION:', process.version);
console.log('RUNTIME ABI:', process.versions.modules);
console.log('PROCESS EXEC PATH:', process.execPath);
import Database from 'better-sqlite3';

let testDb: Database.Database | null = null;

/**
 * Schema for the test database
 * This mirrors the production schema in db.ts
 */
const TEST_SCHEMA = `
  -- Photos table
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT UNIQUE NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER,
    file_hash TEXT,
    width INTEGER,
    height INTEGER,
    date_taken TEXT,
    camera_make TEXT,
    camera_model TEXT,
    lens TEXT,
    iso INTEGER,
    aperture REAL,
    shutter_speed TEXT,
    focal_length REAL,
    gps_latitude REAL,
    gps_longitude REAL,
    preview_cache_path TEXT,
    blur_score REAL,
    description TEXT,
    metadata_json TEXT,
    scan_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- People table
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    face_count INTEGER DEFAULT 0,
    cover_face_id INTEGER,
    entity_type TEXT DEFAULT 'human',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Faces table
  CREATE TABLE IF NOT EXISTS faces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id INTEGER NOT NULL,
    person_id INTEGER,
    box_json TEXT NOT NULL,
    descriptor BLOB,
    confidence REAL,
    blur_score REAL,
    is_ignored INTEGER DEFAULT 0,
    is_confirmed INTEGER DEFAULT 0,
    is_reference INTEGER DEFAULT 0,
    source TEXT DEFAULT 'auto',
    confidence_tier TEXT DEFAULT 'unknown',
    suggested_person_id INTEGER,
    match_distance REAL,
    pose_yaw REAL,
    pose_pitch REAL,
    pose_roll REAL,
    face_quality REAL,
    session_folder TEXT,
    session_date TEXT,
    entity_type TEXT DEFAULT 'human',
    verification_attempts INTEGER DEFAULT 0,
    score REAL,
    needs_bucketing INTEGER DEFAULT 0,
    bucket_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL
  );

  -- Face Buckets table (Phase B1)
  CREATE TABLE IF NOT EXISTS face_buckets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bucket_type TEXT NOT NULL DEFAULT 'discovery',
    suggested_person_id INTEGER,
    centroid BLOB,
    status TEXT DEFAULT 'active',
    session_folder TEXT,
    session_date TEXT,
    face_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- App State table (Phase B1)
  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_faces_photo ON faces(photo_id);
  CREATE INDEX IF NOT EXISTS idx_faces_person ON faces(person_id);
  CREATE INDEX IF NOT EXISTS idx_faces_ignored ON faces(is_ignored);
  CREATE INDEX IF NOT EXISTS idx_photos_path ON photos(file_path);
`;

/**
 * Creates a fresh in-memory test database with the full schema
 */
export function createTestDatabase(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(TEST_SCHEMA);
    testDb = db;
    return db;
}

/**
 * Gets the current test database instance
 */
export function getTestDatabase(): Database.Database | null {
    return testDb;
}

/**
 * Closes and cleans up the test database
 */
export function closeTestDatabase(): void {
    if (testDb) {
        testDb.close();
        testDb = null;
    }
}

/**
 * Seed helper: Insert a test photo
 */
export function seedPhoto(db: Database.Database, overrides: Partial<TestPhoto> = {}): number {
    const photo: TestPhoto = {
        file_path: `/test/photos/photo_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`,
        file_name: 'test_photo.jpg',
        file_size: 1024000,
        width: 1920,
        height: 1080,
        date_taken: '2024-01-01T12:00:00Z',
        metadata_json: null,
        ...overrides
    };

    const stmt = db.prepare(`
    INSERT INTO photos (file_path, file_name, file_size, width, height, date_taken, metadata_json, blur_score, description, created_at)
    VALUES (@file_path, @file_name, @file_size, @width, @height, @date_taken, @metadata_json, @blur_score, @description, @created_at)
  `);

    const result = stmt.run({
        ...photo,
        blur_score: photo.blur_score ?? null,
        description: photo.description ?? null,
        created_at: photo.created_at ?? new Date().toISOString()
    });
    return result.lastInsertRowid as number;
}

/**
 * Seed helper: Insert a test person
 */
export function seedPerson(db: Database.Database, name: string): number {
    const stmt = db.prepare('INSERT INTO people (name) VALUES (?)');
    const result = stmt.run(name);
    return result.lastInsertRowid as number;
}

/**
 * Create a test descriptor (512-dimensional float array as Buffer)
 */
export function createTestDescriptor(seed = 0): Buffer {
    const floats = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
        floats[i] = Math.sin(seed + i * 0.1);
    }
    return Buffer.from(floats.buffer);
}

/**
 * Seed helper: Insert a test face
 */
export function seedFace(
    db: Database.Database,
    photoId: number,
    overrides: Partial<TestFace> = {}
): number {
    const face: TestFace = {
        photo_id: photoId,
        box_json: JSON.stringify({ x: 100, y: 100, width: 50, height: 50 }),
        confidence: 0.95,
        blur_score: 50,
        is_ignored: 0,
        is_reference: 0,
        confidence_tier: 'unknown',
        ...overrides
    };

    const stmt = db.prepare(`
    INSERT INTO faces (
        photo_id, person_id, box_json, descriptor, confidence, blur_score, 
        is_ignored, is_reference, confidence_tier, suggested_person_id, match_distance,
        pose_yaw, pose_pitch, pose_roll, face_quality, session_folder, session_date, entity_type, verification_attempts, score
    )
    VALUES (
        @photo_id, @person_id, @box_json, @descriptor, @confidence, @blur_score, 
        @is_ignored, @is_reference, @confidence_tier, @suggested_person_id, @match_distance,
        @pose_yaw, @pose_pitch, @pose_roll, @face_quality, @session_folder, @session_date, @entity_type, @verification_attempts, @score
    )
  `);

    const result = stmt.run({
        ...face,
        person_id: face.person_id ?? null,
        descriptor: face.descriptor ?? null,
        suggested_person_id: face.suggested_person_id ?? null,
        match_distance: face.match_distance ?? null,
        pose_yaw: face.pose_yaw ?? null,
        pose_pitch: face.pose_pitch ?? null,
        pose_roll: face.pose_roll ?? null,
        face_quality: face.face_quality ?? null,
        session_folder: face.session_folder ?? null,
        session_date: face.session_date ?? null,
        entity_type: face.entity_type ?? 'human',
        verification_attempts: face.verification_attempts ?? 0,
        score: face.score ?? 0.95
    });

    return result.lastInsertRowid as number;
}

/**
 * Create a mock for the getDB function that returns the test database
 */
export function mockGetDB(db: Database.Database) {
    return vi.fn(() => db);
}

// Type definitions for seed helpers
interface TestPhoto {
    file_path: string;
    file_name: string;
    file_size: number;
    width: number;
    height: number;
    date_taken: string;
    metadata_json: string | null;
    blur_score?: number;
    description?: string;
    created_at?: string;
}

interface TestFace {
    photo_id: number;
    person_id?: number | null;
    box_json: string;
    descriptor?: Buffer | null;
    confidence: number;
    blur_score: number;
    is_ignored: number;
    is_reference: number;
    confidence_tier?: string;
    suggested_person_id?: number | null;
    match_distance?: number | null;
    pose_yaw?: number;
    pose_pitch?: number;
    pose_roll?: number;
    face_quality?: number;
    session_folder?: string | null;
    session_date?: string | null;
    entity_type?: string;
    verification_attempts?: number;
    score?: number;
}
