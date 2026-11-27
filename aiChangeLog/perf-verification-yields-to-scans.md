# Perf: background face verification yields to scans and no longer blocks the main thread (0.8.24)

**Branch:** `feature/pictures-suggestions`.

## Why (measured in 0.8.23 on the real library)
- The new `[Timing]` lines showed that the main side of each photo took a median of **3.6 s** (up to 11.5 s), nearly all of it in `FaceService.processAnalysisResult`: it asks the engine to search the people index for each face, and the engine answers one request at a time. `BackgroundVerificationService` sends it batches of 10 face checks (about a second each) and only looked at "face analysis is running", a flag that drops for a moment between two photos, so batches slipped in and the scan's own request waited behind them. The gap between photos was a median of 8 s while it ran.
- The new `[Lag]` lines showed the main process blocked 3 to 5 times in every 10 s, up to 1.4 s each, with nothing else running. The verification service ran four queries on every loop (count and list, for suspect and orphaned faces); timed against the 117,121 faces of the library each took **300 to 570 ms**, on the thread that serves the window. The counts only fed a log line.
- The service did not pause for a folder import at all (`isScanActive` was not checked): a likely cause of the window stalling during an import (not proven).

## What changed
- **`QuietGate`** (new, `core/services/QuietGate.ts`): background work starts only after 10 s in a row without a scan or face analysis, and the wait starts again whenever work shows up. `CaptionBackfill` (0.8.23) now uses it instead of its own copy of the rule.
- **`BackgroundVerificationService`**: waits while a folder import (`isScanActive`) or the face queue (`isAIProcessingActive`) is running, plus the quiet stretch; leaves the rest of a batch of 10 as soon as work starts (checked before each face, for suspect and orphan batches); reads the pending counts only for the idle log line (at most every 30 s), no longer on every loop and not in the "processing" log lines.
- **Migration `006_verificationIndexes`**: two partial indexes (`idx_faces_suspect`, `idx_faces_orphan`) holding only the matching faces (tens of rows), so the four queries read those instead of all faces. Additive; the usual backup before migrating applies.
- **`repositories/verificationQueries.ts`** (new): the four SQL texts, used by `FaceRepository` (which got 40 lines shorter) and by the migration test, which checks with `EXPLAIN QUERY PLAN` that each query uses its index and that the results are unchanged. The conditions must stay identical to the index conditions (SQLite uses a partial index only then).

## Behavior notes
- After a scan or import ends, the face checks and the captions resume after 10 s of quiet. While the scan queue is paused they run as before (the paused queue counts as quiet).
- Face checks that were cut off mid-batch are simply picked up again by the next batch (a face is only changed after its check finishes).
- The first start of this version takes a little longer: backup, then two index builds on the faces table (about a second).

## Tests (written first)
`QuietGate.test.ts`, `BackgroundVerificationService.test.ts` (import pauses it, quiet before the first batch, stops mid-batch for suspect and orphan batches, counts only for the idle log), `migrations/verificationIndexesMigration.test.ts` (version, plan uses each index, same results, twice-safe).

## Not done / next
- Other background services also talk to the engine (face visibility, picture check, re-match, propagation, bucketing, index sync). Check in the next `[Timing]` and `[Lag]` lines whether any of them still delays a scan before changing them.
- Idle `[Lag]` lines before this change showed other blocks (one near the index sync at start-up); re-check after it.
