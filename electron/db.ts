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
      const toRecalc = [...new Set(merges.values())];
      for (const pid of toRecalc) {
        recalculatePersonMean(db, pid);
      }

      logger.info('People Table Upgrade: Complete.');
    }
  } catch (e) {
    logger.error('Failed to migrate people table:', e);
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



export function getUnclusteredFaces() {
  const db = getDB();
  try {
    // Fetch ALL faces that are not assigned to a person, joined with photos for display info
    // Return data needed for clustering AND display: id, descriptor, face info, photo info
    const faces = db.prepare(`
      SELECT f.id, f.photo_id, f.descriptor, f.blur_score, f.box_json, p.file_path, p.preview_cache_path, p.width, p.height
      FROM faces f
      JOIN photos p ON f.photo_id = p.id
      WHERE f.person_id IS NULL 
        AND f.descriptor IS NOT NULL
        AND (f.is_ignored = 0 OR f.is_ignored IS NULL)
        AND (f.blur_score IS NULL OR f.blur_score >= 10)  -- Basic quality filter for clustering (User request)
    `).all();

    // Convert Buffer to Array for JSON IPC
    const formatted = faces.map((f: any) => ({
      id: f.id,
      photo_id: f.photo_id,
      descriptor: f.descriptor ? Array.from(new Float32Array(f.descriptor.buffer, f.descriptor.byteOffset, f.descriptor.byteLength / 4)) : [],
      blur_score: f.blur_score,
      box: JSON.parse(f.box_json),
      file_path: f.file_path,
      preview_cache_path: f.preview_cache_path,
      width: f.width,
      height: f.height
    }));

    // Filter invalid descriptors
    const valid = formatted.filter((f: any) => f.descriptor.length === 512);

    return { success: true, faces: valid };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}


export function closeDB() {
  if (db) {
    logger.info('Closing Database connection.');
    db.close();
    db = undefined!;
  }
}

// Add IPC manually since this file is imported by main.ts which registers handlers?
// No, existing pattern is handlers are in db.ts or main.ts?
// Wait, `db.ts` exports `initDB` and `getDB`. It does NOT register IPC usually unless I see `ipcMain`.
// Ah, `db.ts` DOES contain `ipcMain` calls in the view I saw earlier? 
// Let's check line 257 in `db.ts` from previous views.
// In Step 112/117, I REMOVED `ipcMain` from `getUnclusteredFaces`.
// But `main.ts` handles IPC registration mostly.
// However, `db.ts` did have `ipcMain.handle` calls in the file I edited?
// Let's re-verify `db.ts` imports. If it imports `ipcMain`, it might register them on load? 
// BUT `db.ts` is imported by `main.ts`. 
// Best practice: Export the function here, register IPC in `main.ts`.
// BUT looking at `db.ts` lines 1-10 in step 167, it only imports `Database`, `path`, `logger`.
// It does NOT import `ipcMain` anymore (I removed it or it wasn't there in the top 20 lines).
// It seems `main.ts` registers handlers. 
// Wait, `ipcMain.handle` calls WERE inside `db.ts` in Step 92/102?
// Step 102 showed `ipcMain.handle` being added. 
// Step 117 showed removing `ipcMain.handle` and replacing with export `getUnclusteredFaces`.
// So currently `db.ts` is pure logic?
// No, `main.ts` Step 118 calls `const { getUnclusteredFaces } = await import('./db');`
// So `db.ts` should just export the function.

export function getMetricsHistory(limit = 1000) {
  const db = getDB();
  try {
    // Stats:
    // 1. Recent History
    // 2. Aggregate Stats (Average Scan Time per Face, Total Processed)

    const history = db.prepare('SELECT * FROM scan_history ORDER BY timestamp DESC LIMIT ?').all(limit);

    // Aggregate: Calculate avg time per photo (Total Processing Time)
    const stats = db.prepare(`
            SELECT 
                COUNT(*) as total_scans,
                SUM(CASE WHEN face_count > 0 THEN 1 ELSE 0 END) as face_scans,
                SUM(scan_ms + COALESCE(tag_ms, 0)) as total_processing_time,
                SUM(face_count) as total_faces
            FROM scan_history
            WHERE status = 'success'
        `).get();

    return { success: true, history, stats };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Re-calculates the mean descriptor for a person based on all their non-ignored faces.
 * Updates the people table with the resulting JSON array.
 */
export const recalculatePersonMean = (db: any, personId: number) => {
  try {
    console.time(`recalculatePersonMean-${personId}`);
    const allDescriptors = db.prepare('SELECT descriptor FROM faces WHERE person_id = ? AND is_ignored = 0').all(personId);

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

    if (vectors.length === 0) {
      db.prepare('UPDATE people SET descriptor_mean_json = NULL WHERE id = ?').run(personId);
      return;
    }

    const dim = vectors[0].length;
    const mean = new Array(dim).fill(0);

    for (const vec of vectors) {
      for (let i = 0; i < dim; i++) {
        mean[i] += vec[i];
      }
    }

    let mag = 0;
    for (let i = 0; i < dim; i++) {
      mean[i] /= vectors.length;
      mag += mean[i] ** 2;
    }

    // L2 Normalize
    mag = Math.sqrt(mag);
    if (mag > 0) {
      for (let i = 0; i < dim; i++) {
        mean[i] /= mag;
      }
    }

    console.timeEnd(`recalculatePersonMean-${personId}`);
    db.prepare('UPDATE people SET descriptor_mean_json = ? WHERE id = ?').run(JSON.stringify(mean), personId);
  } catch (e) {
    logger.error(`Failed to recalculate mean for person ${personId}:`, e);
  }
};

export function autoAssignFaces(faceIds: number[], threshold = 0.65) {
  const db = getDB();
  try {
    // 1. Get all people with computed means
    const people = db.prepare("SELECT id, name, descriptor_mean_json FROM people WHERE descriptor_mean_json IS NOT NULL").all();
    logger.info(`[AutoAssign] Found ${people.length} people with mean descriptors.`);
    if (people.length === 0) {
      return { success: true, count: 0, assigned: [] };
    }

    // Parse means into arrays
    const candidates = people.map((p: any) => ({
      id: p.id,
      name: p.name,
      mean: JSON.parse(p.descriptor_mean_json)
    }));

    // 2. Get descriptors for target faces
    let faces;
    if (faceIds && faceIds.length > 0) {
      const placeholders = faceIds.map(() => '?').join(',');
      faces = db.prepare(`SELECT id, descriptor FROM faces WHERE id IN (${placeholders}) AND descriptor IS NOT NULL`).all(...faceIds);
      logger.info(`[AutoAssign] Found ${faces.length} valid descriptors out of ${faceIds.length} requested IDs.`);
    } else {
      // If no IDs provided, scan ALL unnamed faces
      logger.info(`[AutoAssign] No IDs provided. Scanning ALL unassigned faces...`);
      faces = db.prepare("SELECT id, descriptor FROM faces WHERE person_id IS NULL AND descriptor IS NOT NULL").all();
      logger.info(`[AutoAssign] Found ${faces.length} unassigned faces to check.`);
    }

    let assignedCount = 0;
    const assigned: any[] = [];

    const updateFace = db.prepare("UPDATE faces SET person_id = ? WHERE id = ?");

    // 3. Compare
    const transaction = db.transaction(() => {
      for (const face of faces) {
        if (!face.descriptor) continue;

        // Convert blob to array
        const rawDescriptor = Array.from(new Float32Array(face.descriptor.buffer, face.descriptor.byteOffset, face.descriptor.byteLength / 4));

        // L2 NORMALIZE descriptor
        let mag = 0;
        for (const val of rawDescriptor) mag += val * val;
        mag = Math.sqrt(mag);

        const descriptor = mag > 0 ? rawDescriptor.map(v => v / mag) : rawDescriptor;

        let bestMatch = null;
        let minDist = Infinity;

        // Linear scan (fast enough for < 1000 people)
        for (const person of candidates) {
          // Euclidean distance calculation (assuming normalized vectors)
          // dist = sqrt(sum((a-b)^2))
          let sumSq = 0;
          for (let i = 0; i < descriptor.length; i++) {
            const diff = descriptor[i] - person.mean[i];
            sumSq += diff * diff;
          }
          const dist = Math.sqrt(sumSq);

          if (dist < minDist) {
            minDist = dist;
            bestMatch = person;
          }
        }

        if (bestMatch && minDist < threshold) {
          updateFace.run(bestMatch.id, face.id);
          assignedCount++;
          assigned.push({ faceId: face.id, personId: bestMatch.id, personName: bestMatch.name, distance: minDist });
        }
      }
    });

    transaction();

    // Recalculate means for affected people (optional/async?)
    // This makes it slow if we assign to many different people. 
    // Maybe skip auto-recalc for now and let user trigger it or do it lazily?
    // OR just recalc the unique set of updated people.
    const uniquePeople = new Set(assigned.map(a => a.personId));
    for (const pid of uniquePeople) {
      recalculatePersonMean(db, pid);
    }

    return { success: true, count: assignedCount, assigned };

  } catch (e) {
    logger.error("Auto-Assign failed:", e);
    return { success: false, error: String(e) };
  }
}
