# Performance: foreground lane for the AI engine (0.8.32)

**Branch:** `feature/pictures-suggestions`. Plan: `docs/plans/ai-and-edge-cases-speed-plan.md`, phase 3.

## Why
The Python engine reads one command at a time, in the order it receives them, and cannot be interrupted. Background services (captions, face verification, grouping batches, the face checks) kept it busy, and a request the user was waiting for stood in line behind them: in the log of 2026-11-26 `find_ungroupable_faces` waited about 47 s, and a face check timed out (and the face was then accepted as "human" without being checked).

## Files created
- `electron/infrastructure/RequestScheduler.ts`: decides when a request is written. Foreground (the default): at once. Background: only while no foreground request is waiting for its answer, one at a time, in order. A request's timeout counts from the moment it is written, not from when it was queued. Timers are injected. `reset()` for an engine that stopped.
- `tests/backend/unit/requestScheduler.test.ts` (13), `tests/backend/unit/pythonProviderLanes.test.ts` (5, against a fake engine process).

## Files modified
- `electron/infrastructure/PythonAIProvider.ts`: `sendRequest(type, payload, timeoutMs, options?)` goes through the scheduler; the answer (or timeout) releases the place; `reset` when the engine closes or stops (queued requests are rejected at once, as before). `clusterFaces`, `extractAgeFromFace`, `verifyFace`, `detectFacesInRegion` take the options.
- `electron/core/interfaces/IAIProvider.ts`: `RequestOptions`, the `BACKGROUND` constant, `clusterFaces(..., requestOptions)`.
- Marked as background: `BackgroundVerificationService` (4 calls), `BackgroundCaptionService` (via `PhotoService.generateTags`), `BackgroundBucketingService` (grouping batches), `BackgroundAgeRescanService`, `BackgroundDuplicateCheckerService` (2), and the three face checks (`FaceVisibilityDeps`, `PictureCheckDeps`, `AssignedVisibilityDeps`).
- `tests/backend/unit/services/BackgroundVerificationService.test.ts`: the region-detection call now expects the background lane; two new tests that suspect and orphan checks use it.
- `package.json`, `package-lock.json`: 0.8.32.

## Behavior changes
- A request made for the user (opening a page, the AI status, scans, the Review Needed grouping) waits for at most the one background command already running (a face check or a caption: a few seconds), instead of everything queued before it.
- Background work still runs, in order, one request at a time, whenever no foreground request is outstanding. While a scan or a page's own requests are running, background requests wait (the services already paused for scans).
- Background timeouts now count from the write; a request held back for minutes is no longer timed out before it ran.
- Fire-and-forget commands (`update_config`, `add_faces_to_vector_index`) are not queued and keep their order among themselves.

## Not changed
- A command already running in the engine cannot be interrupted: a user request still waits for it (the Review Needed grouping takes about 35 s now, see 0.8.31).
- Scans (`analyze_image`) stay foreground. `FaceRematch`, FAISS sync and propagation make only short requests and were not marked.

## Assumptions and risks
- If a foreground request runs very long (a 15-minute timeout), background work waits for it. Foreground requests all have timeouts.
- A background request that timed out may still be running inside the engine; the next one starts after the timeout, as before.
