# Phase 38: Fix Ignored Faces Sync

 **Date:** 2026-01-11
 **Status:** Completed

 ## Objective
 Correctly handle "Ignored" faces by removing them from the FAISS vector index and notifying the user via the "Face Index Needs Update" alert.

 ## Changes
 1. **Electron Backend**:
    - `FaceRepository.ignoreFaces`: Now unassigns the person (`person_id = NULL`) in addition to setting `is_ignored = 1`. This ensures faces are removed from the named index.
    - `dbHandlers.ts`: `db:ignoreFaces` and `db:ignoreFace` now check if the ignored face was assigned to a person. If so, they trigger `incrementFaissStaleCount`.
 2. **Frontend UI**:
    - `PeopleContext.tsx`: Added `syncFaissStatus` logic to ensure the frontend `faissStaleCount` state is synchronized with the backend on load and refresh.
    - `People.tsx`: Added a toast notification upon successful (or failed) index rebuild to provide user feedback.

 ## Verification
 - Verified that ignoring a named face triggers the "Index Needs Update" alert.
 - Verified that "Rebuild Index" clears the alert and shows a success toast.
 - Confirmed ignored faces are removed from the person's face list.
