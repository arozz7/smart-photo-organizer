# Phase B2: Scan-Time Handoff

## Summary
Implemented the "handoff" mechanism where the scanner marks new unassigned faces for background processing and signals the bucketing service to wake up.

## Changes

### Face Processing ([FaceService.ts](file:///j:/Projects/smart-photo-organizer/electron/core/services/FaceService.ts))
- Updated `processAnalysisResult` to set `needs_bucketing = 1` for all new faces that are not immediately assigned to a person.
- Populated `session_folder` and `session_date` columns during face insertion.

### Scanning Lifecycle ([scanQueue.ts](file:///j:/Projects/smart-photo-organizer/electron/scanQueue.ts))
- Integrated `AppStateRepository` to manage service flags:
  - Sets `scan_in_progress = 1` when a scan starts.
  - Sets `scan_in_progress = 0` and `bucketing_dirty = 1` when the scan queue empties.
  - This ensures background bucketing pauses during active scans and wakes up immediately after.

### Database Migration ([db.ts](file:///j:/Projects/smart-photo-organizer/electron/db.ts))
- Added migration to backfill `needs_bucketing = 1` for existing unassigned/unbucketed faces. This ensures pre-existing unclustered faces will be processed by the new service.

## Verification
- **Unit Test**: Added `FaceService_Scanning.test.ts` case verifying:
  - `session_folder` and `session_date` are correctly inserted.
  - `needs_bucketing` is set to 1 for unassigned faces.
- **TypeScript**: Compilation passed ✅

## Next Steps
- Phase B3: BackgroundBucketingService implementation (The core service that processes the `needs_bucketing` queue).
