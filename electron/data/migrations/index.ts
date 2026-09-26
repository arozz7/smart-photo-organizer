import type Database from 'better-sqlite3';
import path from 'node:path';
import logger from '../../logger';
import { DatabaseBackup } from './DatabaseBackup';
import { MigrationRunner } from './MigrationRunner';
import type { Migration, MigrationLogger, MigrationResult } from './types';

/**
 * Registry of numbered migrations, applied in ascending `version` order.
 *
 * Add new entries to the END with the next integer version. Each must be additive
 * (new tables / nullable or defaulted columns), synchronous, and transaction-safe:
 * no VACUUM, no PRAGMA foreign_keys changes, no dropping or renaming existing columns.
 *
 * Existing libraries have `user_version = 0` (the frozen legacy baseline predates versioning).
 */
export const MIGRATIONS: readonly Migration[] = [];

const BACKUP_FOLDER = 'backups';
const BACKUPS_TO_KEEP = 3;

const migrationLogger: MigrationLogger = {
    info: message => logger.info(`[Migrations] ${message}`),
    warn: message => logger.warn(`[Migrations] ${message}`),
    error: message => logger.error(`[Migrations] ${message}`),
};

/** Applies any pending migrations to an open library database, backing it up first. */
export async function migrateDatabase(db: Database.Database, libraryDir: string): Promise<MigrationResult> {
    const backup = new DatabaseBackup(path.join(libraryDir, BACKUP_FOLDER), BACKUPS_TO_KEEP);
    const runner = new MigrationRunner(MIGRATIONS, backup, migrationLogger);
    return runner.run(db);
}
