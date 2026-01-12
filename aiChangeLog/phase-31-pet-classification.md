# Phase P3: Pet Classification (Schema & Matching)

## Summary
Added `entity_type` column to support pet/human classification. Faces of different entity types will no longer match each other, preventing pets from being assigned to human profiles.

## Changes

### Schema Migration
- **[db.ts](file:///j:/Projects/smart-photo-organizer/electron/db.ts)**: Added `entity_type TEXT DEFAULT 'human'` to both `faces` and `people` tables.

### Matching Logic
- **[PersonRepository.ts](file:///j:/Projects/smart-photo-organizer/electron/data/repositories/PersonRepository.ts)**: Updated `getPeopleWithDescriptors()` to include `entity_type` in query and return.
- **[FaceService.ts](file:///j:/Projects/smart-photo-organizer/electron/core/services/FaceService.ts)**: Updated `matchAgainstCentroids()` to filter candidates by entity_type (humans match humans, pets match pets).

### Test Infrastructure
- **[mockDatabase.ts](file:///j:/Projects/smart-photo-organizer/tests/backend/mocks/mockDatabase.ts)**: Added `entity_type` to test schema, `seedFace` helper, and `TestFace` interface.

## Verification
- TypeScript compilation: ✅ Passes

## Remaining P3 Work
- Python: Landmark confidence scoring for entity classification
- UI: Entity type selector in naming modal

## Next Steps
- Phase B1: Schema Migration + State Flags + Checkpoint Columns
