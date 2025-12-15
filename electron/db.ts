import Database from 'better-sqlite3';
import path from 'node:path';

let db: Database.Database;

export function initDB(basePath: string) {
  const dbPath = path.join(basePath, 'library.db');
  console.log('Initializing Database at:', dbPath);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT UNIQUE NOT NULL,
      file_hash TEXT,
      preview_cache_path TEXT,
      created_at DATETIME,
      width INTEGER,
      height INTEGER,
      blur_score REAL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS photo_tags (
      photo_id INTEGER,
      tag_id INTEGER,
      source TEXT,
      PRIMARY KEY (photo_id, tag_id),
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      descriptor_mean_json TEXT
    );

    CREATE TABLE IF NOT EXISTS faces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id INTEGER,
      box_json TEXT,
      descriptor_json TEXT,
      person_id INTEGER,
      is_ignored BOOLEAN DEFAULT 0,
      blur_score REAL,
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS scan_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id INTEGER,
      file_path TEXT,
      error_message TEXT,
      stage TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
    );
  `);

  // Migration for existing databases
  try {
    db.exec('ALTER TABLE faces ADD COLUMN blur_score REAL');
  } catch (e) {
    // Column likely already exists
  }

  try {
    db.exec('ALTER TABLE faces ADD COLUMN is_ignored BOOLEAN DEFAULT 0');
  } catch (e) {
    // Column likely already exists
  }

  try {
    db.exec('ALTER TABLE people ADD COLUMN descriptor_mean_json TEXT');
  } catch (e) {
    // Column likely already exists
  }

  try {
    db.exec('ALTER TABLE photos ADD COLUMN blur_score REAL');
  } catch (e) {
    // Column likely already exists
  }

  try {
    // Migration: Remove "AI Description" tag if it exists (Cleanup)
    console.log('Running migration: Cleanup "AI Description" tag...');
    // 1. Get the tag ID
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get('AI Description') as { id: number };
    if (tag) {
      // 2. Delete from photo_tags
      db.prepare('DELETE FROM photo_tags WHERE tag_id = ?').run(tag.id);
      // 3. Delete from tags
      db.prepare('DELETE FROM tags WHERE id = ?').run(tag.id);
      console.log('Migration complete: "AI Description" tag removed.');
    }
  } catch (e) {
    console.error('Migration failed:', e);
  }

  console.log('Database schema ensured.');
}

export function getDB() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function closeDB() {
  if (db) {
    console.log('Closing Database connection.');
    db.close();
    db = undefined!;
  }
}
