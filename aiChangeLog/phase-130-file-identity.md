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
- **A file edited outside the app is detected** on the next scan and its record is refreshed: new preview and metadata, new SHA-256, cleared perceptual hash (`contentChanged`). A file that is merely touched, copied or re-saved with identical bytes is not treated as edited.
- **Faces are only re-detected when the picture geometry changed** (`facesStale`: width, height or orientation differ from what was stored, i.e. crop, resize, rotation). Only then is the photo queued for AI with a **clean rescan**. A byte-only change (keywords, ratings or "write metadata to file" from Explorer, Lightroom or a phone gallery) refreshes the record but leaves faces, ignored faces and era assignments untouched and queues nothing. This matters because a clean rescan deletes *every* face on the photo, ignored ones included, and its recovery re-attaches only named faces (source and confirmed flag; not era or ignore state). An unknown earlier geometry counts as "not changed" (nothing is destroyed on a guess).
- A clean rescan now logs a warning naming how many named faces could not be re-matched and are now unassigned (the plan promised to report lost names).
- The app's own rotation refreshes the stored identity so it is not mistaken for an outside edit.
- `file_id` is only stored when both the volume and the file index are known (see Findings).

## Design decisions worth knowing
- **Caution over sensitivity.** Destroying face data on a wrong guess is worse than missing an edit, so: timestamp jitter up to 2 s is ignored (FAT stores time in 2 s steps); when only the timestamp moved, the content hash decides; when there is no stored hash to compare against, the file is assumed *not* edited; and even a confirmed edit only re-detects faces if the geometry provably changed. Trade-offs: a genuinely edited, same-size file with no stored hash is not detected (rare; hashes are backfilled for nearly all photos), and an edit that replaces a photo with a *different picture of identical dimensions* would keep the old faces (detecting that would need a perceptual-hash comparison, which the scanner does not compute).
- **Orientation is normalised before comparing** (missing or unrecognised = normal, ExifTool text like "Rotate 90 CW" = 6), so an editor writing an explicit "Horizontal" where nothing was stored is not mistaken for a rotation.
- Identity is read *before* any content, so an edit made while a file is being processed is caught by the next scan.
- Recorded even when preview regeneration fails, so a persistently failing file is not re-analysed on every scan (the failure is visible in the scan errors).

## Tests added
- Migration: columns added, existing rows kept, idempotent, index present (6); `legacyUpgrade` now asserts the first-open upgrade takes exactly one backup, that the backup is the untouched pre-upgrade library (old schema, all rows), that identity is NULL for existing rows, that a second open is a no-op, and that splash progress is reported.
- Backup: progress 0-100 never going backwards, refuses when the disk is too full without writing anything, `hasRoomForBackup` boundaries (12).
- `fileIdentity` unit tests (11): file id volume/index rules incl. 64-bit exactness and unknown volume, verdicts incl. tolerance boundaries.
- `scannerIdentity.integration` (12, real SQLite/hashing/files; ExifTool and previews faked with a configurable geometry): identity recorded, unchanged left alone, legacy NULL filled in without flagging, byte-only edit (refreshed, **no** re-analysis), same-size edit found by hash, **crop** and **orientation change** queue a clean re-analysis, unknown earlier geometry is cautious, touched file not flagged (identity refreshed), sub-tolerance jitter ignored, no stored hash -> cautious, forced rescan.
- `imageMetadata` +12 (orientation normalisation, geometry comparison incl. unknown values), `photoIdentity.integration` (8), `FileIdentityBackfill` (6, incl. exiting on shutdown), `scanQueueItems` (7, incl. "a byte-only change never gets a clean rescan"), `PhotoService` +4 (identity refreshed after a successful rotation and not after a failed one; lost-names warning shown/not shown).
- **The Phase 129 golden equivalence test passes unchanged**, so adding identity tracking did not alter existing scan behaviour.

## Verification
- TypeScript suite: 68 files, 581 passing, 0 failing, 6 skipped (env-gated tools); `tsc --noEmit` clean; `vite build` OK.
- **Real data:** the dev library was actually upgraded by hot reload during development (unplanned): backup written (12 MB), migration applied, backup verified as the old v0 library (584 photos, no new columns). The upgrade was then re-run on a copy of that backup: v0 -> v1 in 151 ms, no rows lost. Backfill on a copy of the real library: 584/584 photos recorded in 30 ms.
- **Real tools end to end** (`editDetectionReal`): real JPEGs, sharp, ExifTool and SQLite. A file replaced by a different-size image is flagged for re-analysis and its dimensions, hash and preview are refreshed; a touched file and an untouched file are left alone; **a keyword written into a file by ExifTool is detected as a content change but queues no re-analysis**; a crop does; a further scan is quiet.
- **Real photos:** the 4 photos imported during dev testing (2 JPEG, 1 DNG, 1 NEF) all have previews, dimensions, hashes, faces and tags with no scan errors, so the RAW preview path ran in the real app with concurrent scanning (partly closing the Phase 129 manual-QA item; a larger RAW folder would still be a better test).
- **Performance:** benchmarked `main` (Phase 129) and this branch back to back in the same session: ingest 11.1-14.6 vs 10.7-13.1 ms/file, rescan 0.14-0.2 vs 0.05-0.24 ms/file, i.e. no measurable regression. (An earlier, non-paired comparison looked like a regression; it was the machine being slower than earlier in the day, since `main` itself measured slower too. Always benchmark old and new in the same session.) A cached `stat` costs 13-40 us here, so the extra call per file is negligible on local and warm disks.
- **Cost on the photo drive (the input to the folder-skip decision):** `M:` is a WD Elements external USB hard disk (NTFS). A `stat` there costs 18 us when cached but **~744 us on first touch** (measured on a folder the app had never scanned, 222 files). Extrapolated, one extra `stat` per photo on a cold 100k-photo rescan is roughly 75 s, once per cold cache; later rescans hit the OS cache. This is what a folder skip would save.

## Findings
- **`file_id` volume portability:** Node 22 on Windows reports the volume (`dev`) as 0 for every file, while Electron 30's runtime (Node 20) reports the real volume serial (verified with Electron's own binary). An id like `0:index` would be identical on different drives, and a future Electron upgrade to Node 22 would silently make every id ambiguous. The rule is now: store the id only if both parts are known; otherwise NULL and let re-linking use content hashes. Note that ids recorded under Node 22 (i.e. by tests) are NULL, never wrong.
- **Hot reload can upgrade a real library.** While the dev app was running, registering the migration restarted the app on the new code and migrated the real dev library immediately. The backup made that safe, but developers should be aware that editing `electron/` code while a dev app is open against a real library can trigger a migration.
- The test runner (`scripts/run-tests.cjs`) replaces `better-sqlite3`'s native build, which Windows refuses while the dev app is running (it fails at its first step without changing anything). Close the dev app before running tests.
- Pre-existing, unchanged: a photo whose preview keeps failing gets a new `scan_errors` row on every rescan (see Phase 129).

## Assumptions & Risks
- A same-size edit with no stored SHA-256 is not detected (see design decisions).
- When a crop, resize or rotation triggers a clean rescan, faces are recovered on a best-effort basis (embedding distance < 0.35, as in the rotation flow). Ignored faces and era assignments are not preserved (a pre-existing property of `analyzeImage`'s clean rescan, shared with in-app rotation); faces that no longer match become unassigned and are now reported in the log.
- The blocking migration-failure dialog and the disk-space refusal were verified through unit/integration tests and the real backup path, but not by watching the dialog appear in a running window.
- The first launch of a build with this phase will pause on the splash while a ~600 MB production library is backed up (progress is shown). Have free disk space of at least ~1.1x the library size.
