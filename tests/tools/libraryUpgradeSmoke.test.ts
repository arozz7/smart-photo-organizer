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
    it('opens a copy without losing rows, changing user_version or creating backups', async () => {
        // Arrange
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-smoke-'));
        fs.copyFileSync(source as string, path.join(dir, 'library.db'));
        const before = new Database(path.join(dir, 'library.db'), { readonly: true });
        const countsBefore = rowCounts(before);
        const versionBefore = before.pragma('user_version', { simple: true });
        before.close();

        try {
            // Act
            const result = await initDB(dir);
            const countsAfter = rowCounts(getDB());
            const versionAfter = getDB().pragma('user_version', { simple: true });
            closeDB();

            // Assert
            const lost = Object.keys(countsBefore).filter(t => (countsAfter[t] ?? 0) < countsBefore[t]);
            expect(lost, `tables that lost rows: ${lost.join(', ')}`).toEqual([]);
            expect(versionAfter).toBe(versionBefore);
            expect(result.applied).toEqual([]);
            expect(fs.existsSync(path.join(dir, 'backups'))).toBe(false);
            console.log(`[smoke] ${Object.keys(countsBefore).length} tables, photos=${countsBefore.photos}, faces=${countsBefore.faces}, people=${countsBefore.people}`);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
