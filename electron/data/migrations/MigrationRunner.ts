import type Database from 'better-sqlite3';
import {
    MigrationError,
    type Migration,
    type MigrationBackup,
    type MigrationLogger,
    type MigrationResult,
} from './types';

/**
 * Applies pending migrations tracked by `PRAGMA user_version`.
 *
 * Guarantees:
 *  - a backup is taken once, before the first pending migration (and the run aborts if it fails)
 *  - every migration runs in its own transaction; a failure rolls that migration back and stops the run
 *  - a database newer than this app is left untouched (schema changes are additive, so it stays usable)
 */
export class MigrationRunner {
    private readonly ordered: readonly Migration[];

    constructor(
        migrations: readonly Migration[],
        private readonly backup: MigrationBackup,
        private readonly logger: MigrationLogger,
    ) {
        const versions = new Set<number>();
        for (const migration of migrations) {
            if (!Number.isInteger(migration.version) || migration.version < 1) {
                throw new Error(`Invalid migration version ${migration.version} (${migration.name})`);
            }
            if (versions.has(migration.version)) {
                throw new Error(`Duplicate migration version ${migration.version} (${migration.name})`);
            }
            versions.add(migration.version);
        }
        this.ordered = [...migrations].sort((a, b) => a.version - b.version);
    }

    get latestVersion(): number {
        return this.ordered.length > 0 ? this.ordered[this.ordered.length - 1].version : 0;
    }

    async run(db: Database.Database): Promise<MigrationResult> {
        const fromVersion = db.pragma('user_version', { simple: true }) as number;

        if (fromVersion > this.latestVersion) {
            this.logger.warn(
                `Database schema v${fromVersion} is newer than this app (v${this.latestVersion}); leaving it untouched`,
            );
            return { fromVersion, toVersion: fromVersion, applied: [], downgradeDetected: true };
        }

        const pending = this.ordered.filter(m => m.version > fromVersion);
        if (pending.length === 0) {
            return { fromVersion, toVersion: fromVersion, applied: [], downgradeDetected: false };
        }

        const backupPath = await this.takeBackup(db, fromVersion);

        const applied: string[] = [];
        for (const migration of pending) {
            this.apply(db, migration);
            applied.push(migration.name);
        }

        return {
            fromVersion,
            toVersion: this.latestVersion,
            applied,
            downgradeDetected: false,
            backupPath,
        };
    }

    private async takeBackup(db: Database.Database, fromVersion: number): Promise<string> {
        try {
            const backupPath = await this.backup.create(db, fromVersion, this.latestVersion);
            this.logger.info(`Pre-migration backup written to ${backupPath}`);
            return backupPath;
        } catch (error) {
            this.logger.error(`Pre-migration backup failed; no migrations were applied: ${String(error)}`);
            throw new MigrationError('Could not back up the database before migrating', fromVersion + 1, error);
        }
    }

    private apply(db: Database.Database, migration: Migration): void {
        this.logger.info(`Applying migration ${migration.version} (${migration.name})`);
        const transaction = db.transaction(() => {
            migration.up(db);
            db.pragma(`user_version = ${migration.version}`);
        });

        try {
            transaction();
        } catch (error) {
            this.logger.error(`Migration ${migration.version} (${migration.name}) failed and was rolled back: ${String(error)}`);
            throw new MigrationError(`Migration ${migration.version} (${migration.name}) failed`, migration.version, error);
        }
    }
}
