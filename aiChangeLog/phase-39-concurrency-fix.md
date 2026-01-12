# Phase 39: Background Bucketing Concurrency Fix

## Goal
Prevent the Background Bucketing service from processing batches while the AI Processing Queue is active (e.g., analyzing new photos), to avoid resource contention and UI confusion.

## Changes

### Backend
- **AppStateRepository**: Added `ai_processing_active` flag.
- **BackgroundBucketingService**: 
    - Updated `loop()` and inner batch loops (`processNextBatch`, `processRecheckBatch`) to check `isScanActive()` OR `isAIProcessingActive()`.
    - If active processing is detected, the service instantly pauses/aborts the current batch and yields execution.
    - Fixed logic to correctly track progress offsets even when batches are interrupted.
- **DB Handlers**: Updated `db:getBucketingStatus` to report `active: false` if the service is paused due to concurrency, even if work is pending.

### Frontend
- **AIContext**: Added synchronization logic to call `ai:setProcessingStatus` via IPC whenever the local processing queue becomes active or empty.

## Verification
- Verified manually that "Grouping Faces" status disappears from the status bar immediately when "Processing (X)" begins.
- Confirmed background logs show "Interrupted by active processing" and resume automatically after queue completion.
