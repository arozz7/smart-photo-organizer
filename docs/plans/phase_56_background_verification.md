# Phase 56: Background VLM Verification

## Problem
To detect difficult faces (e.g., sleeping, profile, occluded), we must lower the detection threshold (e.g., to 0.25). However, this introduces false positives like knees, elbows, and flowers being detected as faces. Simple geometric filters (size, aspect ratio) are insufficient to distinguish these.

## Solution: Background VLM Verification
To avoid slowing down the main scan (currently ~7s/photo), we will perform VLM verification **asynchronously** in the background.

### 1. The "Suspect" Flag
-   We will repurpose the existing `entity_type` column in the `faces` table.
-   Standard detections: `entity_type = 'human'` (Default).
-   Low-confidence TTA/Macro detections (0.20 - 0.45): `entity_type = 'suspect'`.
-   "Suspect" faces are saved immediately but **hidden from the UI** until verified.

### 2. Background Verification Service
A new service `BackgroundVerificationService` will:
1.  Poll for faces with `entity_type = 'suspect'`.
2.  Send them to the Python backend for VLM analysis ("Is this a face?").
3.  **If YES**: Update `entity_type` to 'human' (Face appears in UI).
4.  **If NO**: Delete the face (or mark `is_ignored=1`).

This keeps the scanning loop fast while ensuring high precision for difficult faces.

### 3. User Feedback & Retroactive Handling
-   **UI**: Add a `PendingVerificationCounter` in the Settings "Advanced" tab (or Sidebar).
-   **Status**: Users should see "X Faces Pending Verification" with a spinner.
-   **Retroactive Tool**: Add a "Audit Low Confidence Faces" button in Settings.
    -   Action: Queries DB for `score < 0.45 AND entity_type = 'human'`.
    -   Result: Updates them to `entity_type = 'suspect'`, triggering the background service.

## Proposed Changes

### [python] `src/python/main.py`
-   Update `scan_results` to include `entityType`.
-   Logic: If `score < VERIFICATION_THRESHOLD` (0.45), set `entityType = 'suspect'`. Default 'human'.

### [python] `src/python/facelib/vlm.py`
-   Implement `verify_is_face(image_path, box)` logic.

### [typescript] `electron/data/repositories/FaceRepository.ts`
-   Update `getAllFaces` and `getUnclusteredFaces` to filter `WHERE entity_type = 'human'`.
-   Add `getSuspectFaces(limit)`: Fetch pending faces.
-   Add `countSuspectFaces()`: For UI badge.
-   Add `updateFaceType(id, type)`.

### [typescript] `electron/core/services/BackgroundVerificationService.ts` (NEW)
-   Implement `IService`.
-   Pattern: Polling loop (5s interval), pauses on scan, handles shutdown.
-   Batch process "suspect" faces (size=10).

### [typescript] `src/stores/appState.ts` (or `settingsStore`)
-   Add `pendingVerifications` count.

### [typescript] `src/components/SettingsModal.tsx`
-   Add status indicator in Advanced tab: "Background Verification: [Active/Idle] | Pending: X".
-   Add "Audit Existing Faces" button (triggers IPC `face:auditLowConfidence`).

## Verification Plan
1.  **Scan Wedding Photo**: Confirm user sees 0 faces initially (if all are suspects), then faces appear one by one as background service validates them. (Or 0 if they are flowers).
2.  **Scan Sleeping Girl**: Confirm she is marked 'suspect' initially, then 'human' after VLM check.
