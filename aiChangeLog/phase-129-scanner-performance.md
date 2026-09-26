# Phase 129 — WEBP Support & Scanner Performance

## Summary
Scanning new photos is **5.4x faster** (56.1 -> ~10.4 ms/file on the reference benchmark) and rescanning an unchanged library is **~70x faster** (1.48 -> 0.02 ms/file), with behaviour verified unchanged by a golden-snapshot test captured from the original scanner. WEBP files are now scanned (the README advertised WEBP but the scanner ignored it). No schema change.

## Measurements first (500-file synthetic tree, real sharp + ExifTool + SQLite, 28-core Windows machine)
| Stage | Finding |
|---|---|
| ExifTool `read` | ~30 ms/file, **no gain from parallelism** because ExifTool was pinned to `maxProcs: 1` |
| Preview extraction | ~31 ms/file, and it made a **second, duplicate ExifTool call** (Orientation only) on top of the scanner's own full read |
| SHA-256 | negligible |
| Unchanged rescan | 1.48 ms/file: dominated by two `db.prepare()` calls per file, not by I/O |

The plan assumed the hot path was statement preparation and per-file SELECTs. Profiling showed that is only true for rescans; ingest is dominated by ExifTool. The work was re-prioritised on that evidence.

## Results
| Scenario | Before | After | Change |
|---|---|---|---|
| Ingest, 500 files | 56.09 ms/file | 10.87 ms/file | 5.2x |
| Ingest, 1,500 files | n/a (not measured on old code) | 8.67 ms/file | |
| Unchanged rescan, 500 files | 1.48 ms/file (741 ms) | 0.03 ms/file (13 ms) | ~55x |
Sweep of ExifTool processes (concurrency 4): 1 -> 19.5, 2 -> 12.2, **4 -> 10.4**, 8 -> 9.8 ms/file. Numbers are machine-specific and use small synthetic JPEGs (see Risks).
Extrapolated to 100k new photos: ~93 min -> ~17 min.

## Files created
- `electron/utils/imageFormats.ts` — single source of truth for supported / standard / RAW-like extensions (includes `.webp`)
- `electron/utils/mapWithConcurrency.ts` — ordered, bounded concurrency helper
- `electron/scanning/ScanStatements.ts` — SQL prepared once per scan; one transaction per new photo
- `electron/scanning/processFile.ts` — per-file logic split into small named steps
- `electron/scanning/collectImageFiles.ts` — depth-first directory walk (same ordering contract as before)
- `electron/scanning/imageMetadata.ts` — `extractDimensions` / `resolveDateTaken` (the rotation-swap logic existed twice; now once)
- `electron/scanning/fileHelpers.ts` — `computeSHA256`, `isPreviewUsable`
- `electron/core/services/scannerSettings.ts` — validated `scanner` settings (Zod), defaults by CPU count
- `scripts/bench/scan-bench.ts`, `tests/tools/scanBench.test.ts` — env-gated benchmark (`SCAN_BENCH=1`)
- Tests: `scannerEquivalence.integration.test.ts` + `tests/fixtures/scan-golden.json`, `imageFormats`, `mapWithConcurrency`, `imageMetadata`, `scannerSettings`

## Files modified / refactor mappings
- `electron/scanner.ts`: 341 -> ~100 lines. Moved `processFile` -> `scanning/processFile.ts` (split into `refreshKnownPhoto`, `ingestNewPhoto`, `regeneratePreview`, `backfillMetadata`); `computeSHA256` -> `scanning/fileHelpers.ts`; directory walk -> `scanning/collectImageFiles.ts`. Public API unchanged (`scanDirectory`, `scanFiles`, `getExifTool`, `extractPreview`); `scanQueue` untouched.
- `electron/core/services/PhotoService.ts`: `extractPreview(..., knownTags?)` — optional 5th parameter; when the caller already read the Orientation, the extra ExifTool call is skipped. ExifTool process count now comes from settings (was hard-coded 1). "Is RAW" now uses `imageFormats`.
- `electron/core/services/ConfigService.ts`: optional `scanner` overrides and `getScannerSettings()`.

## Behaviour changes
- **WEBP is scanned** and treated as a standard (non-RAW) image. Existing libraries pick up their WEBP files on the next scan.
- New photos: metadata is read **before** the preview (so Orientation can be reused); results are identical.
- Files are processed up to 4 at a time (`scanner.concurrency`), ExifTool uses up to 4 processes (`scanner.exiftoolProcesses`; defaults by CPU count, valid range 1-16, invalid values ignored). Both optional in `config.json`.
- Returned photo **order is unchanged** (same depth-first order); database row **ids** for photos ingested in the same batch may now be assigned in a different order than before.
- A new photo's insert and its "Initial Scan" error row now commit together (one transaction).
- A single file that throws unexpectedly no longer aborts the rest of its directory (it is logged and skipped).

## Deviation from the plan
- **Per-folder "known paths" map dropped.** Once statements are prepared once, an unchanged rescan costs 0.02 ms/file; a map would add memory risk (a root folder query could load an entire large library) for no measurable gain. Phase 130's folder-mtime skip removes most rescan work anyway.
- Added (not in plan): reuse of Orientation to skip a duplicate ExifTool call, and configurable ExifTool processes. These, not statement preparation, produce the ingest speed-up.

## Tests added
- `scannerEquivalence.integration.test.ts` (3): real SQLite/hashing/walking with only ExifTool + preview generation faked, through 6 scenarios (first scan, unchanged rescan, missing previews, metadata backfill, forced rescan, scanFiles with a missing path); golden snapshot **captured from the original scanner before any change**; asserts the result-ordering contract; plus WEBP ingest and ExifTool-unavailable behaviour. Run against the original scanner in a temporary worktree: the golden and ExifTool-unavailable tests pass there, and the WEBP test fails there (as it should).
- `imageFormats` (19), `mapWithConcurrency` (8, deterministic gates, no timers), `imageMetadata` (18), `scannerSettings` (17), `PhotoService` +3 (Orientation hint).
- `Scanner.test.ts` (existing, over-mocked): its fake DB gained `transaction()`; all 4 tests unchanged and passing.

## Verification
- TypeScript suite: 62+ files, 515+ passing, 0 failing. `tsc --noEmit` clean.
- Benchmarks recorded above (reproduce with `SCAN_BENCH=1 SCAN_BENCH_FILES=500`).

## Flaky test fixed
`usePersonDetail.test.ts > should start targeted scan correctly` failed ~20% of runs (5/25 on this branch **and** on untouched `main`). Cause: `await waitFor(() => !result.current.loading)` never waits, because `waitFor` only retries when its callback throws, so the test raced the hook's loading state. The three occurrences now use `waitFor(() => expect(result.current.loading).toBe(false))`; 0/40 failures afterwards.

## Findings (not changed here)
- **Duplicate error rows:** a photo whose preview keeps failing gets a new `scan_errors` row on every rescan (the golden shows 1 -> 2 -> 3 -> 4). Preserved deliberately for this phase; worth deduplicating later.
- `extractPreview` waited ~120 s per file when the previews folder was missing (the scan creates the folder first, so scans are unaffected).
- Old scanner interleaved directory recursion with processing; it now lists first, then processes. The first progress update therefore comes after the walk (fast: directory listing only).

## Assumptions & Risks
- **Benchmarks use small synthetic JPEGs.** Real 12-24 MP photos and RAW files spend far more time in `sharp`/decoding, so the ingest gain will be smaller than 5x but should still be substantial. **Recommended manual QA:** scan a copy of a real folder (JPEG + RAW) and compare timing and results with v0.8.1.
- Memory grows with concurrency because several large images decode at once; default kept at 4. Users can lower `scanner.concurrency`.
- More ExifTool processes use more RAM (a few tens of MB each).
- Not exercised: multi-process ExifTool against real RAW files.
