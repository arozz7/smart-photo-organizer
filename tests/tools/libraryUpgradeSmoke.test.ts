/**
 * Tool (not a behaviour test): opens a COPY of a real library through the current initDB and
 * verifies the upgrade path is lossless. Skipped unless LIBRARY_SMOKE_DB points at a library.db.
 * The original is only read (copied to a temp folder that is deleted afterwards).
 *
 *   $env:LIBRARY_SMOKE_DB = "H:\DevWork\smart-photo-organizer\library.db"
 *   node scripts/run-tests.cjs tests/tools/libraryUpgradeSmoke.test.ts
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDB, getDB, closeDB } from '../../electron/db';

const source = process.env.LIBRARY_SMOKE_DB;

const rowCounts = (db: Database.Database): Record<string, number> =>
    Object.fromEntries(
        (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[])
            .map(t => [t.name, (db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get() as { c: number }).c]),
    );

describe.skipIf(!source)('real library upgrade smoke test', () => {
    it('upgrades a copy without losing rows, and leaves a backup that matches the pre-upgrade library', async () => {
        // Arrange
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-smoke-'));
        fs.copyFileSync(source as string, path.join(dir, 'library.db'));
        const before = new Database(path.join(dir, 'library.db'), { readonly: true });
        const countsBefore = rowCounts(before);
        const versionBefore = before.pragma('user_version', { simple: true });
        before.close();

        try {
            // Act
            const t0 = performance.now();
            const result = await initDB(dir);
            const upgradeMs = Math.round(performance.now() - t0);
            const countsAfter = rowCounts(getDB());
            const versionAfter = getDB().pragma('user_version', { simple: true });
            closeDB();

            // Assert: no rows lost, schema advanced only if a migration was pending
            const lost = Object.keys(countsBefore).filter(t => (countsAfter[t] ?? 0) < countsBefore[t]);
            expect(lost, `tables that lost rows: ${lost.join(', ')}`).toEqual([]);
            expect(versionAfter).toBe(result.toVersion);

            // Assert: a backup exists exactly when something was applied, and it is the pre-upgrade library
            if (result.applied.length > 0) {
                const backup = new Database(result.backupPath as string, { readonly: true });
                expect(backup.pragma('user_version', { simple: true })).toBe(versionBefore);
                expect(rowCounts(backup)).toEqual(countsBefore);
                backup.close();
            } else {
                expect(fs.existsSync(path.join(dir, 'backups'))).toBe(false);
            }
            console.log(`[smoke] ${Object.keys(countsBefore).length} tables, photos=${countsBefore.photos}, faces=${countsBefore.faces}, people=${countsBefore.people}; applied=${JSON.stringify(result.applied)}; v${versionBefore}->v${versionAfter}; upgrade took ${upgradeMs} ms`);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
