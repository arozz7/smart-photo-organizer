# Phase 28: Unnamed Faces UX Improvements

Enhanced the face statistics display in the "Unnamed Faces" view to provide a more comprehensive count of all faces left to review.

## Changes

### Backend (Electron)
- **aiHandlers.ts**: Updated `ai:getClusteredFaces` to calculate and return `totalUnassigned` (the count of all faces where `person_id IS NULL` and `is_ignored = 0`). This ensures that background faces (which are filtered out of the clusters/singles) are still accounted for in the overall total.

### Frontend
- **PeopleContext.tsx**: Updated the `loadUnnamedFaces` return type to include the optional `totalUnassigned` field.
- **usePeopleCluster.ts**: 
    - Added `totalUnassigned` state.
    - Updated `loadClusteredFaces` to populate `totalUnassigned` from the backend result.
    - Exposed `totalUnassigned` from the hook.
- **People.tsx**:
    - Updated the statistics display in the toolbar to show the new "total faces left to review" count.
    - Updated the `SmartIgnorePanel` to use `totalUnassigned` for its `pendingReview` statistic.
- **BackgroundFaceFilterModal.tsx**:
    - Added logic to disable auto-selection of faces when any filter is active.
    - Ensures users don't accidentally ignore or name faces that are hidden by the current filter view.

### Database (Optimization)
- **PersonRepository.ts**:
    - Implemented `updateAllCoverFaces` and `refreshPersonCover` to persist the "best face" (highest blur score) for each person in the `people` table.
    - Optimized `getPeople` query to join on the persisted `cover_face_id` instead of calculating `ROW_NUMBER()` over all faces on every request.
    - This drastically reduces load time for the "Identified People" page.

## Impact
Users now have a clear indication of exactly how many unnamed faces remain to be reviewed, regardless of whether they are currently being clustered or filtered out as noise.

## Verification
- Verified IPC communication returns correct counts.
- UI displays the total count as expected.
