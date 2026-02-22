# Phase 96 — SPO ↔ Photo Repair Shop Integration

**Branch:** `feature/v0.6.5-advanced-filtering`
**Date:** 2026-02-21
**Status:** Code-complete; 36 new tests pass; 13 pre-existing failures (FaceRepository, Scanner) not introduced by this phase.

---

## Summary

Integrated Smart Photo Organizer with Photo Repair Shop (PRS), enabling users to send corrupt
scan-error files to PRS for analysis and repair, then automatically re-ingest the repaired file
back into the library — all without leaving SPO.

The integration follows a poll-based model: SPO calls PRS's local HTTP API
(`http://127.0.0.1:3847`) using a UUID bearer token that PRS writes on startup.

---

## Files Created

| File | Purpose |
|------|---------|
| `electron/lib/prs/PrsTokenReader.ts` | Reads `~/.photo-repair-shop/api-token`; returns `null` if PRS never ran |
| `electron/lib/prs/PrsClient.ts` | Typed HTTP client: `analyze`, `repair`, `getStatus`, `pollUntilDone`. Auth header on every request (except health). `PrsApiError` for non-2xx. |
| `electron/lib/prs/PrsLauncher.ts` | `ensurePrsRunning(executablePath?)` — health-checks first; launches exe via `shell.openPath`; polls for up to 5 s |
| `electron/data/repositories/ReferenceRepository.ts` | `findCandidates({cameraModel, resolution, limit})` — queries healthy (non-errored) photos as header-grafting references for PRS |
| `electron/ipc/prsHandlers.ts` | Registers 5 IPC channels: `prs:checkAvailability`, `prs:analyzeFile`, `prs:pollStatus`, `prs:submitRepair`, `prs:completeRepair` |
| `src/types/prs.ts` | Shared TS types: `PrsAvailability`, `RepairStatus`, `RepairState`, `PrsJobResult` |
| `src/hooks/useRepairJob.ts` | React hook that polls `prs:pollStatus` every 2 s; calls `onDone`/`onError` on terminal state; clears interval on unmount |
| `src/components/ScanWarningsModal.tsx` | New file — complete rewrite of existing inline component (was embedded in Settings.tsx) with full PRS repair UI |
| `tests/backend/unit/lib/PrsClient.test.ts` | 9 tests: health check, analyze, getStatus, pollUntilDone (done/failed/multi-poll), auth header, PrsApiError |
| `tests/backend/unit/lib/PrsLauncher.test.ts` | 5 tests: already running, not configured, launch failed, becomes healthy after launch, timeout |
| `tests/backend/unit/ReferenceRepository.test.ts` | 5 tests: candidate mapping, null passthrough, param correctness, empty result, DB error propagation |
| `tests/backend/unit/prsHandlers.test.ts` | 11 tests: all 5 IPC channels including verify/commit path and unrepairable paths |
| `tests/frontend/unit/hooks/useRepairJob.test.ts` | 7 tests: no poll on null, immediate poll, interval re-poll, onDone, onError, state reflection, cleanup on null |

---

## Files Modified

| File | Change |
|------|--------|
| `electron/main.ts` | Added `import { registerPrsHandlers }` and `registerPrsHandlers()` call in app-ready startup |
| `electron/data/repositories/PhotoRepository.ts` | Added `deletePhotoById(id)`, `markUnrepairable(id, reason)` (sets `is_unrepairable=1` on `scan_errors`) |
| `src/views/Settings.tsx` | Imports and renders `<ScanWarningsModal>` (previously inline) |

---

## Behavior Changes

### New: `prs:checkAvailability`
- Reads token file; if absent returns `{ available: false }` immediately (no network call).
- Calls `/health` (unauthenticated, 3 s timeout); returns `{ available: boolean }`.

### New: `prs:analyzeFile`
- Validates `filePath` (required string). Looks up `metadata_json` from `PhotoRepository` if `photoId` provided.
- Calls `PrsClient.analyze()`; returns `{ jobId }`.

### New: `prs:pollStatus`
- Single status poll — renderer manages polling cadence via `useRepairJob`.

### New: `prs:submitRepair`
- Derives `outputPath` as `<originalDir>/<basename>_repaired<ext>`.
- Calls `ReferenceRepository.findCandidates()` to auto-supply healthy local photos as `candidateReferences`.
- Calls `PrsClient.repair()`; returns `{ jobId }`.

### New: `prs:completeRepair` (two-stage verification)
1. **Sharp decode** — if `sharp(repairedFilePath).metadata()` throws → `markUnrepairable` + return `{ success: false, unrepairable: true }`.
2. **Python AI analysis** — if `pythonProvider.sendRequest('analyze_image', ...)` returns error → same.
3. On success: `deleteScanErrorAndFile(scanErrorId, false)` + `deletePhotoById(originalPhotoId)` (if provided) + `scanQueue.enqueueFiles([repairedFilePath])`.

### New: ScanWarningsModal UI
- "🔧 PRS ready" badge in header when PRS is available.
- Per-row 🔧 repair button (disabled + tooltip when PRS not running or file marked unrepairable).
- State machine per row: `idle → checking_prs → analyzing → repairing → verifying → done | failed | unrepairable`.
- Progress bar with `%` and `stage` label during active repair.
- Failed state shows error text + Retry button.
- Unrepairable state shows persistent orange badge (persistent across modal reopens via `is_unrepairable` DB flag).
- On success: row auto-removes after 1.5 s; repaired file enters library ingest pipeline.

---

## Security Notes

- Token is never logged (only its existence is checked).
- `PrsTokenReader` returns `null` on any file-read error (graceful degradation).
- All IPC payloads validated (presence + type checks) before any DB or network call.
- `PrsClient` uses `AbortSignal.timeout(30_000)` on all authenticated requests; 3 s on health check.
- `shell.openPath` is used for launch (no `exec`/`spawn` with user-supplied paths).

---

## Assumptions & Risks

- **PRS API contract:** Assumes PRS `/analyze` response contains `result.suggestedStrategies[0].strategy` for repair strategy selection. If PRS changes its shape, `startRepair()` in ScanWarningsModal will get `strategy = undefined` and fail gracefully (shows "No repair strategy suggested" error).
- **Token race:** If PRS restarts between `checkAvailability` and `analyzeFile`, the stale token will produce a 401. The user will see "PRS token not found — is PRS running?" and can retry.
- **`is_unrepairable` column:** Assumed to exist on `scan_errors` table (added in a prior phase). `markUnrepairable` runs `UPDATE` — if column is absent, it will throw and the handler returns `{ success: false, unrepairable: true, reason: ... }` from the outer `catch`.

---

## Tests Summary

| Suite | Tests | Pass |
|-------|-------|------|
| `PrsClient.test.ts` | 9 | ✅ |
| `PrsLauncher.test.ts` | 5 | ✅ |
| `ReferenceRepository.test.ts` | 5 | ✅ |
| `prsHandlers.test.ts` | 11 | ✅ |
| `useRepairJob.test.ts` | 7 | ✅ |
| **Total new** | **36** | **✅** |

Pre-existing failures (13): `FaceRepository.test.ts`, `Scanner.test.ts` — not caused by this phase.

---

## Manual QA Checklist

- [x] Settings → Scan Warnings: "🔧 PRS ready" badge visible when PRS running
- [x] 🔧 button disabled + tooltip "Photo Repair Shop is not running" when PRS not running
- [x] Clicking 🔧 shows `checking_prs` → `analyzing` → `repairing` progress bar
- [x] Progress bar % updates as PRS reports progress (2 s poll interval)
- [x] On success: row disappears after 1.5 s; repaired photo appears in Library grid
- [x] On failure: red error text + Retry button visible; clicking Retry restarts flow
- [ ] Unrepairable badge shown for files that failed verification (persists on modal reopen)
- [ ] Token not present in SPO log files (`main.log`, `python.log`)
- [ ] Closing and reopening modal while repair in progress does not crash (useRepairJob cleanup)

---

## QA Bug Fixes (2026-02-22)

Five bugs discovered and resolved during manual QA session on `feature/v0.6.5-advanced-filtering`.

### Bug 1 — `prs:checkAvailability` never called `ensurePrsRunning`
**Symptom:** "🔧 PRS ready" badge never appeared; 🔧 button always disabled.
**Root cause:** The handler only checked the token + health, but never invoked `PrsLauncher.ensurePrsRunning()`. The configured `prsExecutablePath` setting was silently ignored.
**Fix:** `prs:checkAvailability` now calls `ensurePrsRunning(prsExecutablePath)` first. If PRS is already running, it returns immediately (fast path). If not, it launches the exe and polls.
**Files:** `electron/ipc/prsHandlers.ts`

### Bug 2 — Wrong health endpoint URL
**Symptom:** PRS launched successfully (visible in Task Manager with `--headless`) but health check always timed out. Log showed `[PRS did not become healthy within timeout]` even with PRS running.
**Root cause:** `HEALTH_URL` was `http://127.0.0.1:3847/health`; actual PRS endpoint is `http://127.0.0.1:3847/api/health`.
**Fix:** Corrected `HEALTH_URL` constant.
**Files:** `electron/lib/prs/PrsClient.ts`

### Bug 3 — `shell.openPath` can't pass `--headless`; PRS launched in GUI mode
**Symptom:** Launching PRS via `shell.openPath` opened a GUI window (appeared as a second SPO instance). PRS's API server started unreliably and only after the 5 s polling window closed.
**Root cause:** `shell.openPath` uses Windows `ShellExecute` and cannot forward arguments. PRS requires `--headless` to run its HTTP API server without a window.
**Fix:** Replaced `shell.openPath` with `child_process.spawn(path, ['--headless'], { detached: true, stdio: 'ignore' })` + `child.unref()`. Timeout raised 5 s → 20 s.
**Security note:** `['--headless']` is hardcoded (not user-supplied); `spawn` (not `exec`) is used so no shell injection is possible.
**Files:** `electron/lib/prs/PrsLauncher.ts`, `tests/backend/unit/lib/PrsLauncher.test.ts`

### Bug 4 — Multiple concurrent PRS spawns on repeated modal opens
**Symptom:** Task Manager showed 3 PRS instances after opening/closing Scan Warnings modal a few times while PRS was still starting.
**Root cause:** Each `checkPrsAvailability()` call triggered `ensurePrsRunning()` independently. If PRS was still starting (health check failing), a new process was spawned each time.
**Fix:** Module-level `launchPromise` deduplicates concurrent calls — all callers share one in-flight promise until PRS is confirmed healthy or times out.
**Files:** `electron/lib/prs/PrsLauncher.ts`

### Bug 5 — "No output path in result" after successful repair job
**Symptom:** Repair job completed (`done` status returned from PRS) but SPO showed "No output path in result" failure.
**Root cause:** `handleJobDone` looked for `result.result?.outputPath` in the PRS status payload. PRS does not echo `outputPath` back in its `/api/status` response.
**Fix (two parts):**
1. `prs:submitRepair` handler now returns `{ jobId, outputPath }` — SPO derived the path itself so it can always carry it forward.
2. `startRepair` in `ScanWarningsModal` stores `outputPath` in `repairStates[id].repairedFilePath` when the repair is submitted.
3. `handleJobDone` falls back to `repairStatesRef.current.get(errId)?.repairedFilePath` if PRS status doesn't include the path. A `useRef` mirror of `repairStates` prevents stale-closure issues in the `useCallback`.
**Files:** `electron/ipc/prsHandlers.ts`, `src/components/ScanWarningsModal.tsx`

### Bug 6 — "0" rendered in Actions column for every non-unrepairable row
**Symptom:** A literal `0` appeared to the left of the 🔧 button on every scan error row.
**Root cause:** `err.is_unrepairable` is a SQLite integer (`0`/`1`). When the left side of `||` was `false`, `isUnrepairable` evaluated to `0` (falsy number). JSX renders `{0 && <Component/>}` as the literal character `0`.
**Fix:** `Boolean(err.is_unrepairable)` coerces the integer to a proper boolean.
**Files:** `src/components/ScanWarningsModal.tsx`
