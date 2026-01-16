# Phase 41: Robust Move Library & Service Architecture

## Changes
- **Implemented `ServiceManager`**: Centralized service lifecycle management (Start/Stop) for `PythonAIProvider`, `BackgroundBucketingService`, and `ScanQueue`.
- **Global Database Logic**: Introduced `setDBLock`/`getDBLock` in `db.ts` to prevent "Database not initialized" errors during critical operations.
- **Robust Shutdown**: Updated `main.ts` and `settingsHandlers.ts` to use `ServiceManager.stopAll()` for clean shutdowns.
- **Fixed Move Library**: Replaced buggy `app.relaunch()` with a "Soft Restart" pattern (Stop -> Move -> Re-init -> Start) to fix "Process not found" crashes.
- **Enhanced UX**: Added a blocking "Moving Library..." modal with spinner in `Settings.tsx`.
- **Bug Fix**: Fixed regression in `ai:command` handler causing timeouts and "Unknown command: None" errors.

## Technical Details
- Added `IService` interface.
- Refactored `BackgroundBucketingService`, `ScanQueue`, and `PythonAIProvider` to implement `IService`.
- Guarded `ai:command` and `db:*` IPC handlers against access during locked DB state.
- Removed circular dependencies between `AppStateRepository` and `db.ts`.

## Verification
- Validated "Move Library" with large preview folders.
- Confirmed no errors in console during move.
- Confirmed application state persists correctly after soft restart.
