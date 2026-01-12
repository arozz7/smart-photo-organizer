# Phase B1: Schema Migration + State Flags + Checkpoint Columns

## Summary
Added all the foundational schema and repository infrastructure for the Background Bucketing feature.

## Changes

### Schema Migration ([db.ts](file:///j:/Projects/smart-photo-organizer/electron/db.ts))
- Added `needs_bucketing INTEGER DEFAULT 0` and `bucket_id INTEGER` columns to `faces` table
- Created `face_buckets` table for suggestion and discovery buckets
- Created `app_state` table as key-value store for service flags and checkpoints
- Initialized default app_state values for scan tracking, bucketing checkpoints, and shutdown protocol

### New Repositories
- **[AppStateRepository.ts](file:///j:/Projects/smart-photo-organizer/electron/data/repositories/AppStateRepository.ts)**: Manages app-wide state flags and checkpoints for background services and graceful shutdown.
- **[BucketRepository.ts](file:///j:/Projects/smart-photo-organizer/electron/data/repositories/BucketRepository.ts)**: Manages face buckets (suggestions and discoveries).

### Updated Repositories
- **[FaceRepository.ts](file:///j:/Projects/smart-photo-organizer/electron/data/repositories/FaceRepository.ts)**: Added bucketing methods:
  - `setNeedsBucketing()` - Mark faces for bucketing
  - `getFacesNeedingBucketing()` - Query faces pending bucketing
  - `getFacesNeedingBucketingCount()` - Count pending faces
  - `assignToBucket()` - Assign faces to a bucket
  - `getFacesByBucket()` - Get faces in a bucket

### Test Infrastructure
- **[mockDatabase.ts](file:///j:/Projects/smart-photo-organizer/tests/backend/mocks/mockDatabase.ts)**: Added `face_buckets` and `app_state` tables, plus `needs_bucketing`/`bucket_id` columns.

## Verification
- TypeScript compilation: ✅ Passes

## Next Steps
- Phase B2: Scan-Time Handoff (set flags during scanning)
- Phase B3: BackgroundBucketingService implementation
