# Feat: scan progress shows done of total, the folder and the time left (0.8.22)

**Branch:** `feature/pictures-suggestions`.

## Why
During a big folder import the app only showed a running count ("Scanning Files (412)"), so there was no way to tell how much was left. The total was already known: `scanDirectory` collects the whole file list before it processes anything, but never sent it. The count was also sent from `ScanContext`, so every update re-rendered everything that uses that context.

## What changed
- `electron/scanning/scanProgress.ts` (new): `ScanProgress` (`phase`, `done`, `total`, `folder`) and `createProgressReporter`, which counts every finished file (stored, skipped or failed) so it reaches the total, and sends at most one update per 250 ms (the first at once, the last always).
- `electron/scanner.ts`: `scanDirectory` sends a `collecting` update, then the reporter's updates; `scanFiles` the same with its own total. `processAll` now hands the finished file to the callback.
- `electron/scanQueue.ts`: sends the `ScanProgress` object on `scan-progress` (it was a bare number).
- `src/utils/scanProgress.ts` (new): the same type, `estimateRemainingMs` (only after 20 files and 5 s, so the first guess is not wild), `formatDuration`, `scanPercent`, `describeScanProgress` ("412 of 5,354 · Orlando Trip\April 07 · about 3 min left").
- `src/hooks/useScanProgress.ts` (new): listens to `scan-progress`; the figures stay after a scan ends and reset when the next one starts.
- `ScanContext`: no longer holds `scanCount` or the listener, so progress updates no longer re-render its consumers.
- `StatusBar` and `ScanEntertainmentWidget`: show the percentage, done of total, the folder and the time left; the widget has a progress bar that is always present (empty until the total is known) so its height does not change.

## Behavior notes
- "Photos Scanned" now counts every file looked at, not only new or changed ones, so it reaches the total.
- The time left is a straight extrapolation from the speed so far; a folder with a different mix of files (RAW, large) can move it.
- While files are being listed the total is not known; the bar says "Looking for photos…".

## Tests (written first)
`tests/backend/unit/scanProgress.test.ts`, `tests/frontend/unit/utils/scanProgress.test.ts`, `ScanEntertainmentWidget.test.tsx` (bar and text, empty before the first update).

## Lag monitor (measurement only)
A sample of the running 0.8.21 app during face detection (after the 19,211-photo import) showed the main process at 0.2 of a core and the renderer at 0.1, with the Python engine at 1.9 cores and 7.6 GB. So the window stalls during the file scan were not visible in that sample, and their cause is unknown.
- `electron/utils/EventLoopLagMonitor.ts` (new): a 100 ms timer; a tick that arrives 200 ms or more late means the main process was blocked. Delays are collected for 10 s and written as one line when there were any: `[Lag] main process blocked N times in 10 s (worst X ms, total Y ms) while: scan, 3 image jobs`. Unref'd timer, no behavior change; quiet when nothing blocks.
- `electron/main.ts` starts it when the app is ready; `ScanQueue.busy` (new getter) and `imageJobs.inFlight()` supply the "while:" label.
- Tests: `tests/backend/unit/EventLoopLagMonitor.test.ts` (quiet on time, quiet below the threshold, one report per window with count, worst and total, fresh window, activity labels, stop).
- Next: after the next scan, read the `[Lag]` lines in `logs\main.log` and fix what they name. Nothing about the stalls is changed in this version.

## Not done
- The cause of the stalls is not known; no fix for them is in this version.
