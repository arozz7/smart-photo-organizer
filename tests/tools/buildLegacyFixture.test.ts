/**
 * Tool entry (not a behaviour test): regenerates the committed legacy library fixture.
 * Skipped unless BUILD_LEGACY_FIXTURE=1. See scripts/fixtures/build-legacy-db.ts.
 *
 *   $env:BUILD_LEGACY_FIXTURE = "1"; node scripts/run-tests.cjs tests/tools/buildLegacyFixture.test.ts
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildLegacyFixture } from '../../scripts/fixtures/build-legacy-db';

describe.skipIf(process.env.BUILD_LEGACY_FIXTURE !== '1')('build legacy fixture', () => {
    it('writes tests/fixtures/legacy-v0.8.1.db and its snapshot', async () => {
        const outDir = path.resolve(__dirname, '../fixtures');
        fs.mkdirSync(outDir, { recursive: true });

        const { dbPath, snapshotPath } = await buildLegacyFixture(outDir);

        expect(fs.statSync(dbPath).size).toBeGreaterThan(0);
        expect(fs.existsSync(snapshotPath)).toBe(true);
    });
});
