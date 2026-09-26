/**
 * Helpers for tests that need a copy of the frozen legacy (v0.8.1) library.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LegacySnapshot } from '../../scripts/fixtures/build-legacy-db';

const FIXTURE_DIR = __dirname;
const DB_NAME = 'legacy-v0.8.1.db';
const SNAPSHOT_NAME = 'legacy-v0.8.1.snapshot.json';

/** Copies the frozen fixture into a fresh temp library folder and returns its path. */
export function createLegacyLibraryCopy(): string {
    const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-legacy-'));
    fs.copyFileSync(path.join(FIXTURE_DIR, DB_NAME), path.join(libraryDir, 'library.db'));
    return libraryDir;
}

export function loadLegacySnapshot(): LegacySnapshot {
    return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, SNAPSHOT_NAME), 'utf-8')) as LegacySnapshot;
}

export function removeLibraryCopy(libraryDir: string): void {
    fs.rmSync(libraryDir, { recursive: true, force: true });
}
