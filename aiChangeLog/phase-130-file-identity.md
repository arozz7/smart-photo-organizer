# Phase 130 — File Identity & Edit Detection

## Summary
Every photo now remembers its file's size, modified time and file id, so the app can tell that a file was **edited outside the app** (and re-analyse it) and, in Phase 131, that a file was **moved or renamed**. This is also the first real migration, which exercised the backup and fail-closed machinery from Phase 128 on real data. The planned folder-modified-time skip was deliberately not built (see "Scope change").

## Scope change (needs your decision)
The roadmap called for skipping unchanged folders on rescan. Phase 129 already made an unchanged rescan cost ~0.02 ms/file, so the skip would save roughly a second per 100k photos, while adding risk: repairs (missing previews, empty metadata) would stop happening in skipped folders, and edits there would go undetected without dirty marks and a periodic stat pass. Comparing size/time on every visit detects edits everywhere with none of that, so that was built instead. The skip can be added later as an opt-in setting if a real library (e.g. a network share) shows rescans are slow. Dropped with it: the `scan_folders` table, the periodic stat pass, dirty marks, the folder-skip "full rescan" option and the walked/skipped result contract.

## Files created
- `electron/data/migrations/001_fileIdentity.ts`, `helpers.ts` (`addColumnIfMissing`)
- `electron/scanning/fileIdentity.ts` — `readFileIdentity`, `compareIdentity`, `toFileId`, `MTIME_TOLERANCE_MS`
- `electron/data/repositories/PhotoIdentityRepository.ts` (DB only), `electron/core/services/PhotoIdentityService.ts` (reads the file)
- `electron/core/services/FileIdentityBackfill.ts` (logic, injected dependencies), `BackgroundFileIdentityService.ts` (lifecycle)
- `src/utils/scanQueueItems.ts`
- Tests: `fileIdentityMigration`, `fileIdentity`, `scannerIdentity.integration`, `photoIdentity.integration`, `FileIdentityBackfill`, `scanQueueItems`, plus additions to `legacyUpgrade`, `DatabaseBackup`, `MigrationRunner`, `PhotoService`
- Tools (env-gated): `tests/tools/editDetectionReal.test.ts`; `libraryUpgradeSmoke` now also runs the backfill; benchmark can target another `electron/` checkout (`SPO_ELECTRON_DIR`)

## Files modified
- `electron/data/migrations/index.ts` (registers migration 1), `DatabaseBackup.ts` (progress + disk-space check), `MigrationRunner.ts` (progress option; failure message includes the reason), `types.ts`
- `electron/db.ts` passes splash progress to the migration
- `electron/scanning/ScanStatements.ts`, `processFile.ts` (identity capture, edit detection, `contentChanged`)
- `electron/core/services/PhotoService.ts` (refresh identity after a successful rotation, both paths)
- `electron/main.ts` (registers `BackgroundFileIdentityService`)
- `src/context/ScanContext.tsx` (uses `buildScanQueueItems`; `rescanFiles` honours `contentChanged`)

## Behaviour changes
- **First launch after upgrade:** schema v1 with one automatic backup in `<library>/backups/`. The splash shows "Backing up your library before upgrading… N%". If free disk space is below the database + WAL size plus 10%, the upgrade refuses with a clear message and the app quits without changing anything (the existing fail-closed path).
- Each scanned photo stores size, modified time and `file_id` (`volume:index`). Existing photos are filled in on their next visit or by the background backfill.
- **A file edited outside the app is re-analysed** on the next scan: new preview and metadata, new SHA-256, cleared perceptual hash, and the photo is queued for AI with a **clean rescan** (old faces replaced, named people re-matched on a best-effort basis by embedding). A file that is merely touched, copied or re-saved with identical bytes is not.
- The app's own rotation refreshes the stored identity so it is not mistaken for an outside edit.
- `file_id` is only stored when both the volume and the file index are known (see Findings).

## Design decisions worth knowing
- **Caution over sensitivity.** A false "edited" verdict triggers a destructive face re-scan, so: timestamp jitter up to 2 s is ignored (FAT stores time in 2 s steps); when only the timestamp moved, the content hash decides; when there is no stored hash to compare against, the file is assumed *not* edited. Trade-off: a genuinely edited, same-size file with no stored hash is not detected (rare; hashes are backfilled for nearly all photos).
- Identity is read *before* any content, so an edit made while a file is being processed is caught by the next scan.
- Recorded even when preview regeneration fails, so a persistently failing file is not re-analysed on every scan (the failure is visible in the scan errors).

## Tests added
- Migration: columns added, existing rows kept, idempotent, index present (6); `legacyUpgrade` now asserts the first-open upgrade takes exactly one backup, that the backup is the untouched pre-upgrade library (old schema, all rows), that identity is NULL for existing rows, that a second open is a no-op, and that splash progress is reported.
- Backup: progress 0-100 never going backwards, refuses when the disk is too full without writing anything, `hasRoomForBackup` boundaries (12).
- `fileIdentity` unit tests (11): file id volume/index rules incl. 64-bit exactness and unknown volume, verdicts incl. tolerance boundaries.
- `scannerIdentity.integration` (8, real SQLite/hashing/files; ExifTool and previews faked): identity recorded, unchanged left alone, legacy NULL filled in without flagging, edit by size, edit with same size, touched file not flagged (identity refreshed), sub-tolerance jitter ignored, no stored hash -> cautious, forced rescan.
- `photoIdentity.integration` (8), `FileIdentityBackfill` (5), `scanQueueItems` (6), `PhotoService` +2 (identity refreshed after a successful rotation, not after a failed one).
- **The Phase 129 golden equivalence test passes unchanged**, so adding identity tracking did not alter existing scan behaviour.

## Verification
- TypeScript suite: 68 files, 581 passing, 0 failing, 6 skipped (env-gated tools); `tsc --noEmit` clean; `vite build` OK.
- **Real data:** the dev library was actually upgraded by hot reload during development (unplanned): backup written (12 MB), migration applied, backup verified as the old v0 library (584 photos, no new columns). The upgrade was then re-run on a copy of that backup: v0 -> v1 in 151 ms, no rows lost. Backfill on a copy of the real library: 584/584 photos recorded in 30 ms.
- **Real tools end to end** (`editDetectionReal`): real JPEGs, sharp, ExifTool and SQLite. One file replaced by a different-size image is flagged and its dimensions, hash and preview are refreshed; a touched file and an untouched file are left alone; a third scan is quiet.
- **Performance:** benchmarked `main` (Phase 129) and this branch back to back in the same session: ingest 11.1-14.6 vs 10.7-13.1 ms/file, rescan 0.14-0.2 vs 0.05-0.24 ms/file, i.e. no measurable regression. (An earlier, non-paired comparison looked like a regression; it was the machine being slower than earlier in the day, since `main` itself measured slower too. Always benchmark old and new in the same session.) A `stat` costs 13-40 us here, so the extra call per file is negligible.

## Findings
- **`file_id` volume portability:** Node 22 on Windows reports the volume (`dev`) as 0 for every file, while Electron 30's runtime (Node 20) reports the real volume serial (verified with Electron's own binary). An id like `0:index` would be identical on different drives, and a future Electron upgrade to Node 22 would silently make every id ambiguous. The rule is now: store the id only if both parts are known; otherwise NULL and let re-linking use content hashes. Note that ids recorded under Node 22 (i.e. by tests) are NULL, never wrong.
- **Hot reload can upgrade a real library.** While the dev app was running, registering the migration restarted the app on the new code and migrated the real dev library immediately. The backup made that safe, but developers should be aware that editing `electron/` code while a dev app is open against a real library can trigger a migration.
- The test runner (`scripts/run-tests.cjs`) replaces `better-sqlite3`'s native build, which Windows refuses while the dev app is running (it fails at its first step without changing anything). Close the dev app before running tests.
- Pre-existing, unchanged: a photo whose preview keeps failing gets a new `scan_errors` row on every rescan (see Phase 129).

## Assumptions & Risks
- A same-size edit with no stored SHA-256 is not detected (see design decisions).
- Face identity after an outside edit is recovered on a best-effort basis (embedding distance < 0.35, as in the rotation flow); faces that no longer match become unassigned.
- The blocking migration-failure dialog and the disk-space refusal were verified through unit/integration tests and the real backup path, but not by watching the dialog appear in a running window.
- The first launch of a build with this phase will pause on the splash while a ~600 MB production library is backed up (progress is shown). Have free disk space of at least ~1.1x the library size.
