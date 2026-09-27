import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { MigrationBackup } from './types';

const BACKUP_PREFIX = 'library.v';
const BACKUP_PATTERN = /^library\.v\d+-to-v\d+\.[\dT-]+Z\.db$/;

/** Headroom over the database size, so a nearly full disk is caught before the copy starts. */
const REQUIRED_HEADROOM = 1.1;

/** Pages copied per step; small enough that progress updates and the app stays responsive. */
const PAGES_PER_STEP = 256;

const MB = 1024 * 1024;

/** True when `freeBytes` comfortably fits a copy of a `databaseBytes`-sized database. */
export function hasRoomForBackup(freeBytes: number, databaseBytes: number): boolean {
    return freeBytes >= databaseBytes * REQUIRED_HEADROOM;
}

/** Free bytes on the volume that holds `directory` (or its nearest existing parent). */
function freeBytesOnVolume(directory: string): number {
    let probe = directory;
    while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    const stats = fs.statfsSync(probe);
    return Number(stats.bavail) * Number(stats.bsize);
}

export interface DatabaseBackupOptions {
    /** Free bytes for a directory. Injected in tests; defaults to the real volume. */
    freeBytes?: (directory: string) => number;
}

/**
 * Writes restorable snapshots of the library database using SQLite's online backup
 * (safe while the database is open, including in WAL mode) and prunes old snapshots.
 *
 * Before copying it checks there is enough free disk space and refuses, without writing
 * anything, if not. Only files matching its own naming pattern are ever pruned.
 */
export class DatabaseBackup implements MigrationBackup {
    private readonly freeBytes: (directory: string) => number;

    constructor(
        private readonly backupDir: string,
        private readonly keep = 3,
        private readonly now: () => Date = () => new Date(),
        options: DatabaseBackupOptions = {},
    ) {
        if (!Number.isInteger(keep) || keep < 1) {
            throw new Error('Backup retention must be at least 1');
        }
        this.freeBytes = options.freeBytes ?? freeBytesOnVolume;
    }

    async create(
        db: Database.Database,
        fromVersion: number,
        toVersion: number,
        onProgress?: (percent: number) => void,
    ): Promise<string> {
        this.assertEnoughSpace(db);
        fs.mkdirSync(this.backupDir, { recursive: true });

        const stamp = this.now().toISOString().replace(/[:.]/g, '-');
        const target = path.join(this.backupDir, `${BACKUP_PREFIX}${fromVersion}-to-v${toVersion}.${stamp}.db`);

        await db.backup(target, {
            progress: ({ totalPages, remainingPages }) => {
                const done = totalPages > 0 ? Math.round(((totalPages - remainingPages) / totalPages) * 100) : 100;
                onProgress?.(done);
                return PAGES_PER_STEP;
            },
        });
        onProgress?.(100);
        this.prune();
        return target;
    }

    private assertEnoughSpace(db: Database.Database): void {
        const databaseBytes = this.sizeOnDisk(db.name);
        const free = this.freeBytes(this.backupDir);
        if (!hasRoomForBackup(free, databaseBytes)) {
            throw new Error(
                `Not enough free disk space for the backup: the library is ${Math.ceil(databaseBytes / MB)} MB and only ${Math.floor(free / MB)} MB is free. Free up space and start the app again`,
            );
        }
    }

    /** Main database file plus its write-ahead log, which the backup also has to capture. */
    private sizeOnDisk(databasePath: string): number {
        const sizeOf = (file: string): number => (fs.existsSync(file) ? fs.statSync(file).size : 0);
        return sizeOf(databasePath) + sizeOf(`${databasePath}-wal`);
    }

    private prune(): void {
        const backups = fs.readdirSync(this.backupDir).filter(name => BACKUP_PATTERN.test(name)).sort();
        const excess = backups.slice(0, Math.max(0, backups.length - this.keep));
        for (const name of excess) {
            fs.rmSync(path.join(this.backupDir, name), { force: true });
        }
    }
}
