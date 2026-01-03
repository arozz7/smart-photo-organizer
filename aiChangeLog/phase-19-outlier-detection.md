# Phase 19: Outlier Detection & Misassigned Faces

**Date:** 2026-01-03
**Status:** Completed

## Diff Narrative

### 1. Outlier Detection Core Logic
- **Fixed:** `FaceAnalysisService.computeDistance` now properly L2-normalizes vectors before calculation. This resolved the issue where distances were abnormally high (8-25) instead of the expected 0-2 range.
- **Tuned:** Increased default outlier threshold from `1.0` to `1.2` to reduce false positives while capturing true misassignments.
- **Optimized:** `findOutliersForPerson` now returns fully populated `OutlierResult` objects (including `box_json`, `file_path`, dimensions) by JOINing in the repository. This eliminates the need for the frontend to fetch face details separately, resolving display issues with large datasets (>1000 faces).

### 2. UI Improvements (OutlierReviewModal)
- **Direct Data Usage:** Modal now renders using the embedded outlier data, removing dependency on the `faces` prop or parent grid state.
- **UX Enhancement:** Modal no longer closes after removing faces. It now updates its local state to filter out removed items, allowing for rapid review and cleanup.
- **New Feature:** Added "Move / Rename" button allowing users to reassign selected outliers to another person directly from the modal.
- **Fixed:** Refactored `RenameModal` to use Radix UI `Dialog`, resolving focus issues when opened from another modal.
- **Enhanced:** Added keyboard navigation (Arrow Keys, Enter) for name suggestions in `RenameModal`.
- **UX Fix:** Implemented `resolveOutliers` in `usePersonDetail` to immediately sync local state and remove moved/deleted faces from view without requiring a full re-analysis.
- **Feedback:** Switched from blocking Alert modals to non-blocking **Toast Notifications** for "Move" and "Remove" actions, ensuring a smooth workflow.
- **Fixed:** Prevented `PersonDetail` from unmounting modals during background data refreshes (`loading` state fix).
- **Restored:** Re-added the "View Original Photo" button to `OutlierReviewModal` to allow checking the context of a face.
- **Fix:** Prevented `OutlierReviewModal` from mistakenly closing when interacting with or closing the `PhotoDetail` overlay.
- **Test:** Added regression test `tests/frontend/unit/components/OutlierReviewModal.test.tsx` for modal interactions.

### 3. Backend Services & IPC
- **New Service Method:** `PersonService.moveFacesToPerson(faceIds, targetName)` implemented.
  - Handles finding or creating the target person.
  - Updating face records.
  - **CRITICAL:** Recalculates means for *both* the target person and all affected source people (to clean up their centroids after removing bad faces).
- **Bug Fix:** Updated `PersonService.unassignFaces` (used by "Remove" action) to also recalculate source person means. Previously it only nulled the `person_id`.
- **IPC:** Added `db:moveFacesToPerson` handler (replacing/cleaning up duplicates).

### 4. Testing
- **New Tests:** Added `PersonService.moveFaces.test.ts` covering:
  - Moving faces to existing person (+ mean recalc verification on both sides).
  - Moving faces to new person (+ creation verification).
  - Unassigning faces (+ source mean recalc verification).
- **Updated Tests:** Fixed `FaceAnalysisService.test.ts` mocks to include new display fields (`box_json`, etc.) and updated threshold assertions.

## Files Created/Modified
- `electron/core/services/FaceAnalysisService.ts`
- `electron/core/services/PersonService.ts`
- `electron/data/repositories/FaceRepository.ts`
- `electron/ipc/dbHandlers.ts`
- `src/components/OutlierReviewModal.tsx`
- `src/hooks/usePersonDetail.ts`
- `src/views/PersonDetail.tsx`
- `tests/backend/unit/services/FaceAnalysisService.test.ts`
- `tests/backend/unit/services/PersonService.moveFaces.test.ts`
