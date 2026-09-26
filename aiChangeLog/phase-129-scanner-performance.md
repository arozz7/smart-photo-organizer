# Phase 129 — WEBP Support & Scanner Performance

## Summary
Scanning new photos is **~5x faster on small synthetic files and 3.6x faster on real photos**, and rescanning an unchanged library is **~50x faster**, with behaviour verified unchanged on synthetic scenarios (golden snapshot from the original scanner) **and on real photos and RAW files** (side-by-side against the original scanner). WEBP files are now scanned (the README advertised WEBP but the scanner ignored it). No schema change.

## Measurements first (500-file synthetic tree, real sharp + ExifTool + SQLite, 28-core Windows machine)
| Stage | Finding |
|---|---|
| ExifTool `read` | ~30 ms/file, **no gain from parallelism** because ExifTool was pinned to `maxProcs: 1` |
| Preview extraction | ~31 ms/file, and it made a **second, duplicate ExifTool call** (Orientation only) on top of the scanner's own full read |
| SHA-256 | negligible |
| Unchanged rescan | 1.48 ms/file, dominated by two `db.prepare()` calls per file, not by I/O |

The plan assumed the hot path was statement preparation and per-file SELECTs. Profiling showed that is only true for rescans; ingest is dominated by ExifTool. The work was re-prioritised on that evidence.

## Results (final defaults: 4 ExifTool processes, 4 files at once)
| Scenario | Before | After | Speed-up |
|---|---|---|---|
| Ingest, 500 small synthetic JPEGs | 56.1 ms/file | 9.9-10.9 ms/file (two runs) | 5.2-5.7x |
| Ingest, 1,500 small synthetic JPEGs | not measured on old code | 8.7 ms/file | |
| Unchanged rescan, 500 files | 1.48 ms/file | 0.02-0.03 ms/file | ~50-70x |
| Ingest, **70 real photos** (avg 2.4 MB JPEG/JFIF) | **262 ms/file** | **72 ms/file** | **3.6x** |
| Ingest, 8 real RAW files (scanner only, Python stubbed) | 171 ms/file | 86 ms/file | 2.0x |

ExifTool process sweep (500 small files, 4 at once): 1 process 19.5, 2 -> 12.2, **4 -> 10.4**, 8 -> 9.8 ms/file. Low-core case (1 ExifTool process, 4 files at once): 17.4 ms/file, still 3.2x faster than before, and all rows complete. Real photos gain less than synthetic ones because resizing large images (sharp) dominates. Numbers are machine-specific.
Extrapolated to 100k new photos at the real-photo rate: ~7.3 h -> ~2 h (dominated by image resizing, not scanning logic).

## Correctness verification on real data (never modifies the originals)
- **Real JPEGs (70 files, from the DEV library's sample photos):** original scanner vs this branch, same files, same harness. Identical: width, height, date taken, SHA-256, preview file name **and preview pixel dimensions**, result order, `scan_errors`. `metadata_json` identical after ignoring `FileAccessDate` (the OS "last read" timestamp, which changes every time a file is opened) and, in 1 row, JSON key order.
- **Real RAW files (8: ARW, CR2, DNG, NEF, with EXIF orientation 6, 8 and 1):** original vs branch identical in every field including the rotated width/height swap (Python backend stubbed identically for both, so preview generation fails identically).
- **Orientation assumption:** the optimisation reuses Orientation from the full ExifTool read instead of a second targeted read. Compared on **all 580 real files** (JPEG/JFIF + DNG/ARW/NEF/CR2/RW2): **0 mismatches**.
- **Benchmark self-check:** the benchmark now asserts every ingested row has non-empty metadata, dimensions, SHA-256 and a non-empty preview file on disk (a speed-up is meaningless if ExifTool silently timed out). 0 incomplete rows in all configurations, including 1 process with 4 lanes and photo-sized (3000x2000) images.
- An early comparison against the DEV database's stored RAW dimensions showed 3 of 8 mismatches. That was not the scanner: the original scanner produces the same values as this branch, so the stored values must have been overwritten later (the analysis step reports the decoded full-sensor size).

## Files created
- `electron/utils/imageFormats.ts` — single source of truth for supported / standard / RAW-like extensions (includes `.webp`)
- `electron/utils/mapWithConcurrency.ts` — ordered, bounded concurrency helper
- `electron/scanning/ScanStatements.ts` — SQL prepared once per scan; one transaction per new photo
- `electron/scanning/processFile.ts` — per-file logic split into small named steps
- `electron/scanning/collectImageFiles.ts` — depth-first directory walk (same ordering contract as before)
- `electron/scanning/imageMetadata.ts` — `extractDimensions` / `resolveDateTaken` (the rotation-swap logic existed twice; now once)
- `electron/scanning/fileHelpers.ts` — `computeSHA256`, `isPreviewUsable`
- `electron/core/services/scannerSettings.ts` — validated `scanner` settings (Zod), defaults by CPU count, ExifTool timeout budget
- `scripts/bench/scan-bench.ts`, `tests/tools/scanBench.test.ts` — env-gated benchmark with correctness self-check (`SCAN_BENCH=1`)
- `tests/tools/realFilesCheck.test.ts` — env-gated tool to compare scanner versions on real photos (`REAL_FILES_DIR`, `SPO_ELECTRON_DIR`, `REAL_ORIENTATION_LIST`)
- Tests: `scannerEquivalence.integration.test.ts` + `tests/fixtures/scan-golden.json`, `imageFormats`, `mapWithConcurrency`, `imageMetadata`, `scannerSettings`

## Files modified / refactor mappings
- `electron/scanner.ts`: 341 -> ~100 lines. Moved `processFile` -> `scanning/processFile.ts` (split into `refreshKnownPhoto`, `ingestNewPhoto`, `regeneratePreview`, `backfillMetadata`); `computeSHA256` -> `scanning/fileHelpers.ts`; directory walk -> `scanning/collectImageFiles.ts`. Public API unchanged (`scanDirectory`, `scanFiles`, `getExifTool`, `extractPreview`); `scanQueue` untouched.
- `electron/core/services/PhotoService.ts`: `extractPreview(..., knownTags?)` — optional 5th parameter; when the caller already read the Orientation, the extra ExifTool call is skipped. ExifTool process count and task timeout now come from settings (were hard-coded 1 process / 5 s). "Is RAW" uses `imageFormats`.
- `electron/core/services/ConfigService.ts`: optional `scanner` overrides and `getScannerSettings()`.
- `tests/setup.ts`: the Electron mock's `userData` path now points at the system temp folder (see Findings).

## Behaviour changes
- **WEBP is scanned** and treated as a standard (non-RAW) image. Existing libraries pick up their WEBP files on the next scan.
- New photos: metadata is read **before** the preview (so Orientation can be reused); results are identical.
- Files are processed up to 4 at a time (`scanner.concurrency`), ExifTool uses up to 4 processes (`scanner.exiftoolProcesses`; defaults by CPU count, valid range 1-16, invalid values ignored). Both optional in `config.json`.
- **ExifTool task timeout scales with queue depth** (5 s x ceil(concurrency / processes); 5 s at the defaults on 8+ cores, 20 s with 1 process). ExifTool starts a task's timeout clock when the task is *queued*, so with more files in flight than processes, healthy reads on low-core machines could otherwise time out. A genuinely hung ExifTool is now detected after up to 20 s instead of 5 s.
- Returned photo **order is unchanged** (same depth-first order); database row **ids** for photos ingested in the same batch may now be assigned in a different order than before.
- A new photo's insert and its "Initial Scan" error row now commit together (one transaction).
- A single file that throws unexpectedly no longer aborts the rest of its directory (it is logged and skipped).

## Deviation from the plan
- **Per-folder "known paths" map dropped.** Once statements are prepared once, an unchanged rescan costs 0.02 ms/file; a map would add memory risk (a root folder query could load an entire large library) for no measurable gain. Phase 130's folder-mtime skip removes most rescan work anyway.
- Added (not in plan): reuse of Orientation to skip a duplicate ExifTool call, configurable ExifTool processes, and the ExifTool timeout budget. These, not statement preparation, produce the ingest speed-up.

## Tests added
- `scannerEquivalence.integration.test.ts` (3): real SQLite/hashing/walking with only ExifTool + preview generation faked, through 6 scenarios (first scan, unchanged rescan, missing previews, metadata backfill, forced rescan, scanFiles with a missing path); golden snapshot **captured from the original scanner before any change**; asserts the result-ordering contract; plus WEBP ingest and ExifTool-unavailable behaviour. Run against the original scanner in a temporary worktree: the golden and ExifTool-unavailable tests pass there, and the WEBP test fails there (as it should).
- `imageFormats` (19), `mapWithConcurrency` (8, deterministic gates, no timers), `imageMetadata` (18), `scannerSettings` (23, incl. timeout budget), `PhotoService` +4 (Orientation hint, ExifTool start-up options).
- `Scanner.test.ts` (existing, over-mocked): its fake DB gained `transaction()`; all 4 tests unchanged and passing.

## Flaky test fixed
`usePersonDetail.test.ts > should start targeted scan correctly` failed ~20% of runs (5/25 on this branch **and** on untouched `main`). Cause: `await waitFor(() => !result.current.loading)` never waits, because `waitFor` only retries when its callback throws, so the test raced the hook's loading state. The three occurrences now use `waitFor(() => expect(result.current.loading).toBe(false))`; 0/40 failures afterwards.

## Verification
- TypeScript suite: 62 files, 523 passing, 0 failing, 5 skipped (env-gated tools), `tsc --noEmit` clean, `vite build` OK, Python suite 183 passing.
- Benchmarks and real-file comparisons above (reproduce with `SCAN_BENCH=1`, and `REAL_FILES_DIR` + `SPO_ELECTRON_DIR`).

## Findings (not changed here unless stated)
- **Test-suite pollution (fixed):** `tests/setup.ts` mocked Electron's `userData` as `/tmp/test-user-data`, which on Windows resolves to the drive root (`J:\tmp\...`, outside the repo), so every test run wrote `config.json` and logs there. My benchmark's settings override leaked into it and skewed a later run before I noticed. Now uses the system temp folder. (An old `J:\tmp\test-user-data` folder may remain; it is safe to delete.)
- **Duplicate error rows:** a photo whose preview keeps failing gets a new `scan_errors` row on every rescan (the golden shows 1 -> 2 -> 3 -> 4). Preserved deliberately for this phase; worth deduplicating later.
- `extractPreview` waited ~120 s per file when the previews folder was missing (the scan creates the folder first, so scans are unaffected).
- Without a Python backend every RAW preview waits out the 120 s Python timeout; with 4 files in flight those waits overlap (8 RAW files: 135 s vs ~16 min sequentially).
- Old scanner interleaved directory recursion with processing; it now lists first, then processes. The first progress update therefore comes after the walk (fast: directory listing only).

## Assumptions & Risks
- **Not verified end to end with the real Python backend:** RAW previews (and any file sharp cannot decode) fall back to the single-threaded Python IPC, which now receives up to 4 concurrent requests instead of 1. Worst-case queueing is a few seconds against a 120 s timeout, and the harness stubbed Python, so this was reasoned about (and the timeout source-checked) but not run. **Recommended manual QA:** scan a folder of real RAW files in the built app and compare timing and results with v0.8.1.
- Memory grows with concurrency because several large images decode at once; default kept at 4. Users can lower `scanner.concurrency`.
- More ExifTool processes use more RAM (a few tens of MB each).
- Real-photo timings come from 70 JPEGs and 8 RAW files on one machine.
