import type Database from 'better-sqlite3';

/**
 * A numbered, one-time schema/data migration.
 *
 * Rules (see docs/plans/library-foundations-roadmap.md, Backward Compatibility Policy):
 *  - additive only: new tables, or new nullable/defaulted columns. Never drop or rename.
 *  - `up` must be synchronous and runs inside a transaction that is rolled back on error.
 *  - expensive data population belongs in a background service, not here.
 */
export interface Migration {
    /** Unique, positive integer. Stored in `PRAGMA user_version` once applied. */
    readonly version: number;
    /** Short stable identifier used in logs, e.g. `legacy_baseline`. */
    readonly name: string;
    up(db: Database.Database): void;
}

/** Takes a restorable copy of the database before migrations run. */
export interface MigrationBackup {
    create(db: Database.Database, fromVersion: number, toVersion: number): Promise<string>;
}

export interface MigrationLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export interface MigrationResult {
    fromVersion: number;
    toVersion: number;
    /** Names of the migrations applied during this run, in order. */
    applied: string[];
    /** True when the database was written by a newer app version than this one. */
    downgradeDetected: boolean;
    /** Path of the pre-migration backup, when one was taken. */
    backupPath?: string;
}

export class MigrationError extends Error {
    override readonly name = 'MigrationError';

    constructor(
        message: string,
        readonly version: number,
        readonly cause?: unknown,
        /** Backup taken before the failed run, when one exists. */
        readonly backupPath?: string,
    ) {
        super(message);
    }
}
