# Phase 127 — Fix scan-queue deadlock from an uncaught FAISS search failure

## Summary
Diagnosed a total app freeze reported after a large library (56,237 faces) finished a bulk "find ungroupable faces" pass: the app remained open but at 0% CPU, fully unresponsive, with no errors in either `main.log` or `python.log` — logging simply stopped mid-operation.

## Root cause
`PythonAIProvider.handleMessage()` handles each `analysis_result` message from the Python backend by `await`-ing `FaceService.processAnalysisResult(...)` **before** notifying the renderer (`webContents.send('ai:scan-result', ...)`) that the photo's scan completed. `processAnalysisResult` calls `FaceService.matchBatch()`, which performs an uncaught FAISS search round-trip back to Python (`options.searchFn`, up to a 5-minute timeout with no try/catch around it).

If that FAISS call ever throws or times out, the exception propagates up through `processAnalysisResult` and `handleMessage` before the renderer notification line is ever reached — so the renderer never learns the photo finished. The renderer's `isProcessing` flag (`AIContext.tsx`) then never flips back to `false`, and since that flag is synced to a backend-wide `AppStateRepository.setAIProcessingActive` lock, every other background service (`BackgroundDuplicateCheckerService`, etc.) correctly — but now permanently — defers to it before doing anything. One stuck photo freezes the entire app: 0% CPU (everything is legitimately waiting its turn), and no error surfaces anywhere because the failure occurs one layer below anything that treats it as fatal.

## Fix
Three defensive fixes, applied at each point in the chain where a failure could otherwise go unnoticed and stall everything downstream:
1. `PythonAIProvider.handleMessage()`: wrapped the `processAnalysisResult` call in try/catch, logging the error. The renderer notification now always runs regardless of what happened inside, so the scan queue always advances.
2. `FaceService.matchBatch()`: wrapped the FAISS `searchFn` call in try/catch — a failed/timed-out search now returns partial results (centroid-pass matches only) instead of throwing and aborting the whole batch.
3. `PythonAIProvider`'s `process.on('close', ...)` handler now rejects any pending `scanPromises` immediately (previously only the deliberate `stop()` method did this) — if the Python process dies unexpectedly, in-flight requests no longer wait out their full multi-minute timeout before failing.

## Verification
- `tsc --noEmit` compiles clean.
- Direct code review confirms each try/catch is correctly scoped and the fallback return values (`results` in `matchBatch`, continuing past the caught error in `handleMessage`) are valid at that point in each function.
- **Not verified end-to-end**: reproducing the original trigger requires a very large library (56K+ faces) and a genuine Python-side stall, which wasn't practical to synthesize in this session. This is a structural fix based on tracing the actual failure chain in the code, not a live reproduction — flagged honestly rather than claimed as fully proven.

## Assumptions & Risks
- The exact reason the underlying FAISS search stalled in the reported incident (Python-side hang vs. a slow/large index) is still unconfirmed. These fixes prevent that stall from freezing the whole app, but don't address why a search might stall in the first place — if it recurs, the app should now at least log an error and recover (queue continues, other services resume) rather than hang silently forever.
- User's currently-frozen app instance needs a manual restart — these fixes only prevent the failure mode going forward, they can't unstick an already-hung process.
