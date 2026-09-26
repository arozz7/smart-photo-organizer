import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { MigrationBackup } from './types';

const BACKUP_PREFIX = 'library.v';
const BACKUP_PATTERN = /^library\.v\d+-to-v\d+\.[\dT-]+Z\.db$/;

/**
 * Writes restorable snapshots of the library database using SQLite's online backup
 * (safe while the database is open, including in WAL mode) and prunes old snapshots.
 *
 * Only files matching its own naming pattern are ever pruned.
 */
export class DatabaseBackup implements MigrationBackup {
    constructor(
        private readonly backupDir: string,
        private readonly keep = 3,
        private readonly now: () => Date = () => new Date(),
    ) {
        if (!Number.isInteger(keep) || keep < 1) {
            throw new Error('Backup retention must be at least 1');
        }
    }

    async create(db: Database.Database, fromVersion: number, toVersion: number): Promise<string> {
        fs.mkdirSync(this.backupDir, { recursive: true });

        const stamp = this.now().toISOString().replace(/[:.]/g, '-');
        const target = path.join(this.backupDir, `${BACKUP_PREFIX}${fromVersion}-to-v${toVersion}.${stamp}.db`);

        await db.backup(target);
        this.prune();
        return target;
    }

    private prune(): void {
        const backups = fs.readdirSync(this.backupDir).filter(name => BACKUP_PATTERN.test(name)).sort();
        const excess = backups.slice(0, Math.max(0, backups.length - this.keep));
        for (const name of excess) {
            fs.rmSync(path.join(this.backupDir, name), { force: true });
        }
    }
}
