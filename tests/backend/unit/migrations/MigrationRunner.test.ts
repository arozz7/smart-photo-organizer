import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { MigrationRunner } from '../../../../electron/data/migrations/MigrationRunner';
import type { Migration, MigrationBackup, MigrationLogger } from '../../../../electron/data/migrations/types';

const silentLogger: MigrationLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const createTable = (version: number, table: string): Migration => ({
    version,
    name: `create_${table}`,
    up: db => { db.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY)`); },
});

const userVersion = (db: Database.Database): number => db.pragma('user_version', { simple: true }) as number;
const tableExists = (db: Database.Database, name: string): boolean =>
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined;

describe('MigrationRunner', () => {
    let db: Database.Database;
    let backup: MigrationBackup & { create: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        db = new Database(':memory:');
        backup = { create: vi.fn().mockResolvedValue('/backups/x.db') };
    });

    afterEach(() => db.close());

    it('applies pending migrations in version order and records the latest version', async () => {
        // Arrange
        const order: number[] = [];
        const migrations: Migration[] = [
            { version: 2, name: 'b', up: () => { order.push(2); } },
            { version: 1, name: 'a', up: () => { order.push(1); } },
        ];
        const runner = new MigrationRunner(migrations, backup, silentLogger);

        // Act
        const result = await runner.run(db);

        // Assert
        expect(order).toEqual([1, 2]);
        expect(userVersion(db)).toBe(2);
        expect(result).toMatchObject({ fromVersion: 0, toVersion: 2, applied: ['a', 'b'], downgradeDetected: false });
    });

    it('skips migrations that are already applied', async () => {
        // Arrange
        db.pragma('user_version = 1');
        const first = vi.fn();
        const second = vi.fn();
        const runner = new MigrationRunner(
            [{ version: 1, name: 'a', up: first }, { version: 2, name: 'b', up: second }],
            backup,
            silentLogger,
        );

        // Act
        await runner.run(db);

        // Assert
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
        expect(userVersion(db)).toBe(2);
    });

    it('is a no-op (and takes no backup) when the database is already current', async () => {
        // Arrange
        const runner = new MigrationRunner([createTable(1, 'alpha')], backup, silentLogger);
        await runner.run(db);
        backup.create.mockClear();

        // Act
        const result = await runner.run(db);

        // Assert
        expect(result.applied).toEqual([]);
        expect(backup.create).not.toHaveBeenCalled();
    });

    it('takes exactly one backup, before the first pending migration, labelled with both versions', async () => {
        // Arrange
        let backupTakenBeforeFirstMigration = false;
        backup.create.mockImplementation(async () => {
            backupTakenBeforeFirstMigration = !tableExists(db, 'alpha');
            return '/backups/x.db';
        });
        const runner = new MigrationRunner([createTable(1, 'alpha'), createTable(2, 'beta')], backup, silentLogger);

        // Act
        await runner.run(db);

        // Assert
        expect(backup.create).toHaveBeenCalledTimes(1);
        expect(backup.create).toHaveBeenCalledWith(db, 0, 2);
        expect(backupTakenBeforeFirstMigration).toBe(true);
    });

    it('rolls back a failing migration, keeps earlier ones, and reports the failing version', async () => {
        // Arrange
        const failing: Migration = {
            version: 2,
            name: 'explodes',
            up: d => { d.exec('CREATE TABLE half_done (id INTEGER)'); throw new Error('boom'); },
        };
        const runner = new MigrationRunner([createTable(1, 'alpha'), failing, createTable(3, 'gamma')], backup, silentLogger);

        // Act
        const attempt = runner.run(db);

        // Assert
        await expect(attempt).rejects.toMatchObject({ name: 'MigrationError', version: 2 });
        expect(userVersion(db)).toBe(1);
        expect(tableExists(db, 'alpha')).toBe(true);
        expect(tableExists(db, 'half_done')).toBe(false);
        expect(tableExists(db, 'gamma')).toBe(false);
    });

    it('fails closed: applies nothing when the backup cannot be taken', async () => {
        // Arrange
        backup.create.mockRejectedValue(new Error('disk full'));
        const runner = new MigrationRunner([createTable(1, 'alpha')], backup, silentLogger);

        // Act
        const attempt = runner.run(db);

        // Assert
        await expect(attempt).rejects.toMatchObject({ name: 'MigrationError' });
        expect(userVersion(db)).toBe(0);
        expect(tableExists(db, 'alpha')).toBe(false);
    });

    it('tolerates a database newer than the app: warns, applies nothing, does not throw', async () => {
        // Arrange
        db.pragma('user_version = 9');
        const runner = new MigrationRunner([createTable(1, 'alpha')], backup, silentLogger);

        // Act
        const result = await runner.run(db);

        // Assert
        expect(result).toMatchObject({ fromVersion: 9, toVersion: 9, applied: [], downgradeDetected: true });
        expect(userVersion(db)).toBe(9);
        expect(backup.create).not.toHaveBeenCalled();
    });

    it('rejects duplicate migration versions at construction', () => {
        // Act / Assert
        expect(() => new MigrationRunner([createTable(1, 'a'), createTable(1, 'b')], backup, silentLogger))
            .toThrow(/duplicate/i);
    });

    it('exposes the latest known version', () => {
        // Arrange
        const runner = new MigrationRunner([createTable(1, 'a'), createTable(3, 'c')], backup, silentLogger);

        // Assert
        expect(runner.latestVersion).toBe(3);
    });
});
