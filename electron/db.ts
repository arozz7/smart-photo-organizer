import Database from 'better-sqlite3';
import path from 'node:path';
import logger from './logger';

let db: any;

export async function initDB(basePath: string, onProgress?: (status: string) => void) {
  const dbPath = path.join(basePath, 'library.db');
  if (onProgress) onProgress('Initializing Database...');
  logger.info('Initializing Database at:', dbPath);

  // Allow UI to breathe
  await new Promise(resolve => setTimeout(resolve, 100));

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
      descriptor BLOB,
      person_id INTEGER,
      is_ignored BOOLEAN DEFAULT 0,
      is_reference BOOLEAN DEFAULT 0,
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

  // --- MIGRATION: Smart Face Storage (BLOBs + Pruning) ---
  try {
    // 1. Add new columns
    try { db.exec('ALTER TABLE faces ADD COLUMN descriptor BLOB'); } catch (e) { /* ignore */ }
    try { db.exec('ALTER TABLE faces ADD COLUMN is_reference BOOLEAN DEFAULT 0'); } catch (e) { /* ignore */ }

    // 2. Check if migration is needed (if we have descriptor_json but no descriptor)
    let hasJson = { count: 0 };
    try {
      hasJson = db.prepare("SELECT count(*) as count FROM faces WHERE descriptor IS NULL AND (descriptor_json IS NOT NULL AND descriptor_json != 'NULL')").get() as { count: number };
    } catch (e) {
      // Likely 'no such column: descriptor_json' - Migration already done.
    }

    if (hasJson.count > 0) {
      if (onProgress) onProgress(`Migrating ${hasJson.count} faces...`);
      logger.info(`Starting Smart Face Storage Migration for ${hasJson.count} faces...`);

      const allFaces = db.prepare('SELECT id, descriptor_json, person_id, blur_score FROM faces').all();

      const updateFace = db.prepare('UPDATE faces SET descriptor = ?, is_reference = ? WHERE id = ?');

      // Group by Person to find Top 100 References
      if (onProgress) onProgress('Analyzing Face Quality...');
      const personFaces: Record<number, any[]> = {};
      const unknownFaces: any[] = [];

      for (const face of allFaces) {
        if (!face.person_id) {
          unknownFaces.push(face);
        } else {
          if (!personFaces[face.person_id]) personFaces[face.person_id] = [];
          personFaces[face.person_id].push(face);
        }
      }

      let processedCount = 0;
      const totalCount = hasJson.count;
      const CHUNK_SIZE = 500;

      const report = () => {
        if (onProgress) {
          const pct = Math.round((processedCount / totalCount) * 100);
          onProgress(`Migrating Database: ${pct}%`);
        }
      };

      // A. Handle Unknowns - Always keep vector
      const unknownChunks = [];
      for (let i = 0; i < unknownFaces.length; i += CHUNK_SIZE) {
        unknownChunks.push(unknownFaces.slice(i, i + CHUNK_SIZE));
      }

      for (const chunk of unknownChunks) {
        const transaction = db.transaction(() => {
          for (const face of chunk) {
            if (face.descriptor_json) {
              try {
                const arr = JSON.parse(face.descriptor_json);
                const buf = Buffer.from(new Float32Array(arr).buffer);
                updateFace.run(buf, 0, face.id);
              } catch (e) {
                logger.error(`Failed to migrate face ${face.id}`, e);
              }
            }
          }
        });
        transaction();
        processedCount += chunk.length;
        report();
        // Yield to event loop
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      // B. Handle Named People - Top 100 Logic
      const personIds = Object.keys(personFaces);
      for (let i = 0; i < personIds.length; i += 50) {
        const pIdsChunk = personIds.slice(i, i + 50);

        const transaction = db.transaction(() => {
          for (const pid of pIdsChunk) {
            const faces = personFaces[parseInt(pid)];
            // Sort by blur_score DESC
            faces.sort((a: any, b: any) => (b.blur_score || 0) - (a.blur_score || 0));

            faces.forEach((face: any, index: number) => {
              if (index < 100) {
                // Reference
                if (face.descriptor_json) {
                  try {
                    const arr = JSON.parse(face.descriptor_json);
                    const buf = Buffer.from(new Float32Array(arr).buffer);
                    updateFace.run(buf, 1, face.id);
                  } catch (e) { logger.error(`Failed to migrate reference ${face.id}`, e); }
                }
              } else {
                // Pruned
                updateFace.run(null, 0, face.id);
              }
            });
            processedCount += faces.length;
          }
        });
        transaction();
        report();
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      logger.info('Smart Face Storage Migration: Data converted.');

      // 3. Drop old column to free space
      try {
        if (onProgress) onProgress('Optimizing Database (VACUUM)...');
        await new Promise(resolve => setTimeout(resolve, 100));

        logger.info('Dropping old descriptor_json column...');
        db.exec('ALTER TABLE faces DROP COLUMN descriptor_json');
        db.exec('VACUUM');
      } catch (e) {
        logger.warn('Could not drop descriptor_json column (SQLite version might be old), setting to NULL instead.', e);
        db.exec("UPDATE faces SET descriptor_json = NULL");
        db.exec('VACUUM');
      }
      logger.info('Smart Face Storage Migration: Complete.');
    }

  } catch (e) {
    logger.error('Smart Face Storage Migration Failed:', e);
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
      logger.info('Migration complete: "AI Description" tag removed.');
    }
  } catch (e) {
    logger.error('Migration failed:', e);
  }

  logger.info('Database schema ensured.');
}

export function getDB() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function closeDB() {
  if (db) {
    logger.info('Closing Database connection.');
    db.close();
    db = undefined!;
  }
}
