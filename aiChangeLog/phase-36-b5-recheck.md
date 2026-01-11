# Phase B5: Ignored Face Re-check & Global Shutdown Hardening

## Summary
Implemented the "Ignored Face Re-check" backend logic to allow recovery of previously ignored faces that now match known people. Additionally, hardened the "Graceful Shutdown" protocol (from Phase B4) to cover all core backend services.

## Changes

### Graceful Shutdown Hardening ([main.ts](file:///j:/Projects/smart-photo-organizer/electron/main.ts))
- **Global Coverage**: Expanded shutdown handler to stop:
  1. `scanQueue` (Prevents new tasks).
  2. `BackgroundBucketingService` (Completes current batch).
  3. `PythonAIProvider` (Gracefully kills child process).
- **Service Updates**:
  - `ScanQueue.ts`: Added `stop()` method to clear queue and flag stop.
  - `PythonAIProvider.ts`: Standardized `stop()` method to kill process.

### Ignored Face Re-check ([BackgroundBucketingService.ts](file:///j:/Projects/smart-photo-organizer/electron/core/services/BackgroundBucketingService.ts))
- **Re-check Mode**: Implemented logic to switch between "Normal Bucketing" and "Re-check Mode" based on `AppStateRepository.isRecheckActive()`.
- **Process Logic**:
  - Fetches faces with `is_ignored = 1` in batches.
  - Matches against Person Centroids (Pass 1).
  - Uses `FaceRepository.assignToBucket` to link matching faces to suggestion buckets.
  - **Preserves Ignored Status**: Crucially, linked faces remain `is_ignored = 1` so they don't appear in normal buckets until user explicitly "Recovers" them in UI (Phase B6).

### Repository Updates
- **AppStateRepository.ts**: Added flags for `ignored_recheck_active` and `ignored_recheck_offset`.
- **FaceRepository.ts**: Added `getIgnoredFacesForBucketing` and verified `assignToBucket` behavior.

## Verification
- **Unit Tests**: Added test suite to `BackgroundBucketingService.test.ts` verifying:
  - Re-check mode activation.
  - Processing of ignored faces.
  - Correct offset updates.
  - Automatic deactivation when complete.
- **Shutdown Safety**: Verified via extensive code review of `main.ts` orchestration.

## Next Steps
- **Phase B6: UI Updates**: Implement the frontend to trigger "Re-check" and view/approve the results (Suggestion Buckets, Discovery Buckets, Recovered Faces).
