# Phase 15: Naming Logic & State Fixes

## Goal
Resolve UI state persistence bugs in the "Unnamed Faces" views and fix non-functional actions in the "Unmatched Faces" modal.

## Changes Made

### 1. Unnamed Faces State Management
- **Issue:** When a clustered group was named and removed, the virtualized list (`Virtuoso`) reused the `ClusterRow` component for the next item. The internal `suggestion` state was not being reset, causing the previous name to briefly appear on the new row.
- **Fix:** Added a `useEffect` reset in `ClusterRow.tsx` triggered by `faceIds` changes to clear `loaded`, `clusterFaces`, and `suggestion` states.
- **Files:** `src/components/ClusterRow.tsx`

### 2. Unmatched Faces Global Modal
- **Issue:** The "Use Suggestion" button was non-functional as it called context methods directly without updating the local state hook (`usePeopleCluster`), and it lacked feedback or asynchronous waiting.
- **Fix:** 
    - Refactored `UnmatchedFacesModal.tsx` to accept an `onAutoName` prop from the parent hook.
    - Implemented `actionLoading` state to show spinners during processing.
    - Ensured selection is cleared after successful naming/ignoring actions.
    - Fixed a `ReferenceError` where `onAutoName` was not destructured.
- **Files:** `src/components/UnmatchedFacesModal.tsx`, `src/views/People.tsx`

### 3. Performance Optimization
- **Issue:** Naming dozens of faces sequentially was slow due to individual IPC calls.
- **Fix:** Refactored `autoNameFaces` in `PeopleContext.tsx` to use the batch reassign IPC handler (`db:reassignFaces`).
- **Files:** `src/context/PeopleContext.tsx`

## Verification
- Verified that accepted groups in the virtualized list now clear their state before loading the next item.
- Verified that "Use Suggestion" in the Unmatched Faces modal now names the faces, updates the UI, and provides visual feedback.
- Verified batch processing performance improvement.
