import Database from 'better-sqlite3';
import path from 'node:path';
import logger from './logger';
import { applyLegacyBaseline } from './data/migrations/legacyBaseline';
import { migrateDatabase } from './data/migrations';
// import { getAISettings } from './store';
// Deprecated functions are removed.
// Deprecated functions are removed.

const INSTANCE_ID = Math.random().toString(36).slice(7);
logger.info(`[DB Module] Loading Module Instance: ${INSTANCE_ID}`);

let db: any;

export { parseExifDate } from './utils/exifDate';

export async function initDB(basePath: string, onProgress?: (status: string) => void) {
  const dbPath = path.join(basePath, 'library.db');
  if (onProgress) onProgress('Initializing Database...');
  logger.info(`[DB Module ${INSTANCE_ID}] Initializing Database at:`, dbPath);

  // Allow UI to breathe
  await new Promise(resolve => setTimeout(resolve, 100));

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  await applyLegacyBaseline(db, onProgress);
  await migrateDatabase(db, basePath);

  logger.info('Database schema ensured.');
}

export function getDB() {
  // Prevent access if DB is logically closed (even if instance exists)
  // We need to import AppStateRepository dynamically or via a helper to avoid circular dep issues during init?
  // Actually, AppStateRepository depends on getDB, so we can't import it here directly at top level.
  // BUT we can use a module-level variable set by AppStateRepository or just check the flag if we move the flag to db.ts?
  // Moving the flag to db.ts is cleaner and avoids circular dependency.

  if (!isDBOpen) {
    throw new Error('Database not initialized (Locked)');
  }

  if (!db) {
    logger.error(`[DB Module ${INSTANCE_ID}] Database not initialized. db is ${db}`);
    throw new Error('Database not initialized');
  }
  return db;
}

let isDBOpen = true;
export function setDBLock(isOpen: boolean) {
  isDBOpen = isOpen;
}

export function getDBLock() {
  return isDBOpen;
}

export function closeDB() {
  if (db) {
    logger.info('Closing Database connection.');
    db.close();
    db = undefined!;
  }
}
