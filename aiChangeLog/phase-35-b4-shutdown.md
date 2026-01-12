# Phase B4: Graceful Shutdown Protocol

## Summary
Implemented robust shutdown handling for the application, ensuring that background services (specifically `BackgroundBucketingService`) cleanly finish their current operations before the application exits. Also integrated startup recovery/cleanup tasks.

## Changes

### Shutdown Logic ([main.ts](file:///j:/Projects/smart-photo-organizer/electron/main.ts))
- **`before-quit` Handler**: Intercepts the quit signal, sets `isQuitting` flag.
  - Signals shutdown via `AppStateRepository.requestShutdown()`.
  - explicit `await bucketingService.stop()` to wait for the service loop to exit.
  - Records clean shutdown timestamp via `AppStateRepository.recordCleanShutdown()`.
- **Global Service Scope**: Promoted `bucketingService` to module scope to allow access in shutdown handler.

### App State ([AppStateRepository.ts](file:///j:/Projects/smart-photo-organizer/electron/data/repositories/AppStateRepository.ts))
- Utilized existing methods for setting shutdown flags and timestamps.

### Service Updates ([BackgroundBucketingService.ts](file:///j:/Projects/smart-photo-organizer/electron/core/services/BackgroundBucketingService.ts))
- **Promise-Based Stop**: Updated `stop()` to return a `Promise<void>` that resolves only when the `loop()` actually terminates. This ensures `main.ts` waits for the *actual* completion of the batch processing, not just the signal.

### Startup Recovery ([main.ts](file:///j:/Projects/smart-photo-organizer/electron/main.ts))
- **Orphan Cleanup**: On startup (`whenReady`), calls `BucketRepository.deleteOrphanBuckets()` to remove any empty buckets left from a potential dirty shutdown or failed batch.
- **Flag Reset**: Clears any stale `shutdown_requested` flags.

## Verification
- **TypeScript**: Compilation passed ✅
- **Logic**: Reviewed `before-quit` flow:
  1. User quits.
  2. `before-quit` fires.
  3. `bucketingService.stop()` sets `shouldStop=true`.
  4. Service finishes current batch (if any) or wakes from sleep.
  5. Service loop exits.
  6. Promise resolves.
  7. Main process records timestamp and quits.

## Next Steps
- Phase B5: Ignored Face Re-check Service.
