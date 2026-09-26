# Phase 128 — Versioned Migrations, Backups & Legacy Fixture

## Summary
Foundation for the library roadmap (`docs/plans/library-foundations-roadmap.md`). Almost every later phase adds schema, and `electron/db.ts` was 934 lines of ad-hoc, unversioned migrations with no backup. This phase adds versioned migrations with automatic pre-migration backups, and a frozen legacy-library test fixture, **with no user-visible change** to existing libraries.

## Files created
- `electron/data/migrations/types.ts` — `Migration`, `MigrationBackup`, `MigrationLogger`, `MigrationResult`, `MigrationError`
- `electron/data/migrations/MigrationRunner.ts` — applies pending migrations by `PRAGMA user_version`, each in its own transaction
- `electron/data/migrations/DatabaseBackup.ts` — SQLite online backup with retention
- `electron/data/migrations/index.ts` — `MIGRATIONS` registry (currently empty) and `migrateDatabase()`
- `electron/data/migrations/legacyBaseline.ts` — frozen legacy schema/data setup (moved verbatim)
- `electron/data/migrations/messages.ts` — pure user-facing text for a failed upgrade / newer-library notice
- `electron/windows/migrationDialogs.ts` — thin Electron adapter: blocking error dialog + quit, non-blocking notice
- `tests/tools/libraryUpgradeSmoke.test.ts` — env-gated smoke test that opens a COPY of a real library (`LIBRARY_SMOKE_DB=<path to library.db>`)
- `electron/utils/exifDate.ts` — `parseExifDate` (moved verbatim)
- `scripts/fixtures/build-legacy-db.ts`, `tests/tools/buildLegacyFixture.test.ts` — fixture generator (gated by `BUILD_LEGACY_FIXTURE=1`)
- `tests/fixtures/legacy-v0.8.1.db`, `tests/fixtures/legacy-v0.8.1.snapshot.json`, `tests/fixtures/legacyFixture.ts`

## Files modified / refactor mappings
- Moved the schema/backfill block (`initDB` body) from `electron/db.ts` -> `electron/data/migrations/legacyBaseline.ts` (`applyLegacyBaseline`). Body is line-for-line identical apart from three type-only `as` casts, which were needed because `db` changed from `any` to `Database.Database`.
- Moved `parseExifDate` from `electron/db.ts` -> `electron/utils/exifDate.ts`; `db.ts` re-exports it, so all existing imports and test mocks still work.
- `electron/db.ts`: 934 -> ~80 lines. `initDB` now calls `applyLegacyBaseline` then `migrateDatabase`, **returns the `MigrationResult`**, and on a migration failure **closes the database and rethrows** (fail closed).
- `electron/main.ts`: shows a non-blocking notice when `downgradeDetected`; on a `MigrationError` shows a blocking dialog with the backup path and **quits without starting any service**. (Previously a failed `initDB` was only logged and every service still started.)
- `electron/ipc/settingsHandlers.ts` (library move): a `MigrationError` now returns `{ success: false, error: <message>, migrationFailed: true, backupPath }` instead of a raw `Error` object; services are not restarted.
- `MigrationError` now carries `backupPath` (set when a migration fails after the backup was taken).

## Behaviour changes
- None for existing libraries. `user_version` stays 0, no backup is taken, no `backups/` folder is created, until the first numbered migration (Phase 130) is pending.
- When migrations are pending: one backup is written to `<library>/backups/library.v<from>-to-v<to>.<timestamp>.db` (newest 3 kept) before any migration runs. If the backup fails, nothing is migrated.
- A database with a newer `user_version` than the app knows is left untouched (warning logged).

## Design decision: the legacy baseline is not a runner migration
The plan originally moved the legacy block into migration 000. That is not possible: the block is `async`, runs `VACUUM`, and toggles `PRAGMA foreign_keys`, none of which are valid inside a migration transaction. It therefore stays an idempotent every-start function, exactly as before, and the runner handles only new additive, synchronous migrations. The plan was updated to match.

## Tests added
- `tests/backend/integration/legacyUpgrade.integration.test.ts` (9): opening the frozen v0.8.1 fixture through the real `initDB` keeps all row counts, every table column and index, named people / confirmed assignments / eras, ignored faces / buckets / smart albums / duplicate groups; takes no backup; returns the migration result; reports and tolerates a newer-version library; is idempotent; and a fresh library gets the full schema. **The core tests were written and passing before the refactor, and pass after it.**
- `tests/backend/integration/migrationFailure.integration.test.ts` (2): a failing migration is rethrown with its backup path and leaves no open database.
- `tests/backend/unit/migrations/messages.test.ts` (3): failure text names the version and backup path; no-backup wording; downgrade wording.
- `tests/backend/unit/migrations/MigrationRunner.test.ts` (9, incl. `backupPath` on failure): ordering, skipping applied, no-op when current, single backup before first migration, rollback on failure, fail-closed on backup failure, newer-database tolerance, duplicate versions rejected.
- `tests/backend/unit/migrations/DatabaseBackup.test.ts` (4): consistent copy and naming, retention, never prunes foreign files, invalid retention rejected.
- `tests/backend/unit/migrations/registry.test.ts` (2): contiguous versions from 1, unique names.

## Verification
- `tsc --noEmit`: clean (was clean at baseline).
- TypeScript suite: 55 files, 441 passing, 1 skipped (the env-gated fixture generator). Python suite: 183 passing.
- Real-library drift check: the DEV and PROD `library.db` schemas were read read-only (schema only, no rows, no copy; opened with `immutable=1`, so any uncommitted `-wal` content was not seen) and compared with the fixture. No differences in tables, columns or indexes; both are `user_version = 0`.
- Real-data smoke test: a **copy** of the DEV library (580 photos, 1,821 faces, 14 tables) opened through the new code path with no rows lost, `user_version` unchanged (0), nothing applied, and no `backups/` folder. PROD (594 MB, in active use) was deliberately not touched.
- `vite build` succeeds (main process bundles with the new imports). The new `tests/` and `scripts/` files, which the root tsconfig does not cover, were type-checked separately: clean.

## Findings
- `tests/backend/mocks/mockDatabase.ts` uses a hand-written `TEST_SCHEMA` that differs from production (e.g. `file_name`, `scan_status` exist there but not in production). Tests that need the real schema must use `initDB`. Not changed here.
- `vitest` 4 has no `--include` flag, so the `test:backend` and `test:frontend` scripts in `package.json` are likely broken. Not changed here.

## What the characterization tests do and do not prove
The fixture already has all one-time `app_state` flags set, so the tests exercise the **idempotent re-open path**. They do **not** exercise the one-time branches (`descriptor_json` drop, `people_new` rebuild, date/GPS/confirmation backfills). For those, the evidence that behaviour is unchanged is the line-by-line diff of the moved block (identical apart from three type-only casts), not the tests. Real libraries are past those steps.

## Assumptions & Risks
- The legacy baseline file is ~860 lines, over the 600-line guideline. It is frozen legacy code that must not be edited, so it is exempt (noted in its header). Splitting it is possible later but adds risk for no behavioural gain.
- Pre-existing one-time destructive legacy steps (dropping `descriptor_json`, the `people` table rebuild) still run without a backup for very old libraries, as before. Real libraries checked are already past them.
- The runner cannot be exercised end to end against a real numbered migration until Phase 130 adds one; it is covered by unit tests with synthetic migrations.

## Python baseline fixes (roadmap Phase 128 task 1)
The 6 Python tests that were already failing at v0.8.0 are fixed; the suite is now 183/183 green (was 172 passing, 6 failing).

| Failure | Cause | Fix |
|---|---|---|
| `test_segment_api` x3 | **Real bug.** `api/routes/segment.py` called the stdlib logger in structured style (`logger.error({..}, "msg")`), so its own error handler raised `TypeError` and hid the real error. It also never resized a mismatched mask (the earlier fix `57264f4` only reached `commands/segmentation.py`) | New shared `fit_alpha_to_image` in `segmentation_ops.py`, used by both the API route and the IPC command (the inline resize block was replaced by it, same algorithm); fixed the 3 logger calls. 5 new tests |
| `test_smart_crop_fallback_to_expand` | Stale test: the fallback deliberately uses 0.25 (matching `expand_box`'s default) | Test updated to 0.25 |
| `test_vlm_tta::test_tta_180_degrees` | Stale test: the Phase 89.5 anti-hallucination rule requires descriptive evidence (eyes, nose, ...) before accepting a rotated face | Mock reason now includes evidence |
| `test_analyze_image_mocked` | Stale mocks: detection moved to `facelib.detector.FaceDetector`, which builds its own InsightFace instances, so the test was loading the real models | Test now mocks at the `FaceDetector` seam and asserts pipeline output (box expansion is detector logic, covered separately) |

## Remaining in this phase
Nothing. Not verified: the blocking error dialog and the downgrade notice were not exercised in a running Electron window (no numbered migration exists yet to trigger the failure path); the formatting and the fail-closed behaviour are unit/integration tested, the dialog calls are thin `dialog`/`app.quit` adapters.
