import Database from 'better-sqlite3';
import path from 'node:path';
import logger from './logger';
// import { getAISettings } from './store';
// Deprecated functions are removed.
// Deprecated functions are removed.

const INSTANCE_ID = Math.random().toString(36).slice(7);
logger.info(`[DB Module] Loading Module Instance: ${INSTANCE_ID}`);

let db: any;

export async function initDB(basePath: string, onProgress?: (status: string) => void) {
  const dbPath = path.join(basePath, 'library.db');
  if (onProgress) onProgress('Initializing Database...');
  logger.info(`[DB Module ${INSTANCE_ID}] Initializing Database at:`, dbPath);

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
      name TEXT UNIQUE NOT NULL COLLATE NOCASE,
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
      score REAL,
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

    CREATE INDEX IF NOT EXISTS idx_faces_person_id ON faces(person_id);
    CREATE INDEX IF NOT EXISTS idx_faces_photo_id ON faces(photo_id);
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
    db.exec('ALTER TABLE faces ADD COLUMN score REAL');
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
    db.exec('ALTER TABLE scan_history ADD COLUMN scan_mode TEXT');
  } catch (e) {
    // Column likely already exists
  }

  try {
    db.exec('ALTER TABLE photos ADD COLUMN description TEXT');
  } catch (e) {
    // Column likely already exists
  }


  try {
    db.exec('ALTER TABLE people ADD COLUMN cover_face_id INTEGER');
  } catch (e) {
    // Column likely already exists
  }

  // --- MIGRATION: Scan-Time Confidence Tiering (Feature 2) ---
  try {
    db.exec("ALTER TABLE faces ADD COLUMN confidence_tier TEXT DEFAULT 'unknown'");
  } catch (e) { /* Column exists */ }

  try {
    db.exec('ALTER TABLE faces ADD COLUMN suggested_person_id INTEGER');
  } catch (e) { /* Column exists */ }

  try {
    db.exec('ALTER TABLE faces ADD COLUMN match_distance REAL');
  } catch (e) { /* Column exists */ }

  // --- MIGRATION: Challenging Face Recognition (Phase 5) ---
  try {
    db.exec('ALTER TABLE faces ADD COLUMN pose_yaw REAL');
  } catch (e) { /* Column exists */ }

  try {
    db.exec('ALTER TABLE faces ADD COLUMN pose_pitch REAL');
  } catch (e) { /* Column exists */ }

  try {
    db.exec('ALTER TABLE faces ADD COLUMN pose_roll REAL');
  } catch (e) { /* Column exists */ }

  try {
    db.exec('ALTER TABLE faces ADD COLUMN face_quality REAL');
  } catch (e) { /* Column exists */ }

  // --- MIGRATION: Centroid Stability & Face Confirmation ---
  try {
    db.exec('ALTER TABLE faces ADD COLUMN is_confirmed BOOLEAN DEFAULT 0');
  } catch (e) { /* Column exists */ }

  try {
    db.exec('ALTER TABLE faces ADD COLUMN era_id INTEGER');
  } catch (e) { /* Column exists */ }

  try {
    db.exec('ALTER TABLE people ADD COLUMN centroid_snapshot_json TEXT');
  } catch (e) { /* Column exists */ }

  try {
    db.exec('ALTER TABLE people ADD COLUMN last_drift_check INTEGER');
  } catch (e) { /* Column exists */ }

  // Create person_eras table for era-aware clustering
  db.exec(`
    CREATE TABLE IF NOT EXISTS person_eras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      era_name TEXT,
      start_year INTEGER,
      end_year INTEGER,
      centroid_json TEXT,
      face_count INTEGER DEFAULT 0,
      is_auto_generated BOOLEAN DEFAULT 1,
      created_at INTEGER,
      descriptor_mean_json TEXT,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_person_eras_person_id ON person_eras(person_id);

    -- Phase D: Centroid Drift Detection
    CREATE TABLE IF NOT EXISTS person_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      descriptor_json TEXT,
      face_count INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reason TEXT,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_person_history_person_id ON person_history(person_id);
  `);

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

  // --- MIGRATION: Case-Insensitive People Uniqueness ---
  try {
    const getCollate = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='people'").get();
    if (getCollate && !getCollate.sql.includes('COLLATE NOCASE')) {
      if (onProgress) onProgress('Upgrading People Table (Uniqueness)...');
      logger.info('Upgrading People Table to enforce case-insensitive uniqueness...');

      // 1. Find and merge duplicates in ID space
      const allPeople = db.prepare("SELECT id, name FROM people").all();
      const seen = new Map<string, number>(); // lowercase name -> first ID
      const merges: Map<number, number> = new Map(); // fromId -> toId

      for (const p of allPeople) {
        const lower = p.name.trim().toLowerCase();
        if (seen.has(lower)) {
          merges.set(p.id, seen.get(lower)!);
        } else {
          seen.set(lower, p.id);
        }
      }

      db.exec('PRAGMA foreign_keys = OFF');
      const transaction = db.transaction(() => {
        // 2. Update faces to point to kept person IDs
        // Using a single UPDATE for each merge is now fast due to idx_faces_person_id
        const updateFace = db.prepare('UPDATE faces SET person_id = ? WHERE person_id = ?');
        for (const [fromId, toId] of merges.entries()) {
          updateFace.run(toId, fromId);
        }

        // 3. Recreate table
        db.exec(`
          DROP TABLE IF EXISTS people_new;
          CREATE TABLE people_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL COLLATE NOCASE,
            descriptor_mean_json TEXT
          );
        `);

        // 4. Copy data (only unique entries)
        const keptIds = [...seen.values()];
        const insertPerson = db.prepare('INSERT INTO people_new (id, name, descriptor_mean_json) SELECT id, name, descriptor_mean_json FROM people WHERE id = ?');
        for (const id of keptIds) {
          insertPerson.run(id);
        }

        // 5. Swap tables
        db.exec('DROP TABLE people');
        db.exec('ALTER TABLE people_new RENAME TO people');
      });
      transaction();
      db.exec('PRAGMA foreign_keys = ON');

      // 6. Recalculate means for people who were merged into
      // Temporarily import inline or use raw helper if we want to support this migration logic here?
      // Since this is a "One-Time" migration that might have already run, we are keeping it.
      // However, `recalculatePersonMean` is now extracted.
      // We should probably instantiate PersonService or similar.
      // BUT `db.ts` should be low level.
      // If this migration runs, it needs to recalculate means.
      // I will leave a TODO or comment it out if it assumes the function exists in THIS file.
      // The original migration code called `recalculatePersonMean(db, pid)`.
      // I'll define a mini-helper LOCALLY for this migration to avoid circular dependencies.

      const localRecalc = (db: any, personId: number) => {
        try {
          // Minimal Recalc Logic for Migration ONLY
          const allDescriptors = db.prepare('SELECT descriptor FROM faces WHERE person_id = ? AND is_ignored = 0 AND (blur_score IS NULL OR blur_score >= 20)').all(personId);
          if (allDescriptors.length === 0) {
            db.prepare('UPDATE people SET descriptor_mean_json = NULL WHERE id = ?').run(personId);
            return;
          }
          const vectors: number[][] = [];
          for (const row of allDescriptors) {
            if (row.descriptor) {
              vectors.push(Array.from(new Float32Array(row.descriptor.buffer, row.descriptor.byteOffset, row.descriptor.byteLength / 4)));
            }
          }
          if (vectors.length == 0) return;
          const dim = vectors[0].length;
          const mean = new Array(dim).fill(0);
          for (const v of vectors) for (let i = 0; i < dim; i++) mean[i] += v[i];
          let mag = 0;
          for (let i = 0; i < dim; i++) { mean[i] /= vectors.length; mag += mean[i] ** 2; }
          mag = Math.sqrt(mag);
          if (mag > 0) for (let i = 0; i < dim; i++) mean[i] /= mag;
          db.prepare('UPDATE people SET descriptor_mean_json = ? WHERE id = ?').run(JSON.stringify(mean), personId);
        } catch (e) { console.error("Migration Recalc failed", e); }
      };

      const toRecalc = [...new Set(merges.values())];
      for (const pid of toRecalc) {
        localRecalc(db, pid);
      }

      logger.info('People Table Upgrade: Complete.');
    }
  } catch (e) {
    logger.error('Failed to migrate people table:', e);
  }

  try {
    // Migration: Remove "AI Description" tag if it exists (Cleanup)
    // console.log('Running migration: Cleanup "AI Description" tag...');
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
    logger.error(`[DB Module ${INSTANCE_ID}] Database not initialized. db is ${db}`);
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
