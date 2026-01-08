# Phase 26: Fix RAW Previews and Eras

## Goal
Resolve critical bugs discovered during v0.5.0 verification:
1. RAW photo previews failing to load ("Preview Unavailable").
2. "Generate Eras" button failing with undefined error and UI instability.

## Changes

### 1. RAW Photo Previews
- **Problem**: React Strict Mode caused race conditions where `onError` fired before the backend could generate the fallback preview. Also, `sharp` was failing on ARW files.
- **Fix**:
    - **Frontend**: `PhotoDetail.tsx` now requests `local-resource://<original_file_path>` instead of relying on cached paths. Added a **retry mechanism** with cache-busting to handle the race condition.
    - **Backend**: `ImageService.ts` enhanced to catch "missing preview" errors and transparently regenerate them on-the-fly using the Python fallback for RAW files.

### 2. Generate Eras
- **Problem**: Users with mostly "auto-assigned" (unconfirmed) faces could not generate eras because the repository query filtered for `is_confirmed = 1`. IPC handler also lacked error catching.
- **Fix**:
    - **Backend**: Wrapped `db:generateEras` in `try/catch`.
    - **Repository**: Renamed `getConfirmedFacesWithDates` to `getAssignedFacesWithDates` and removed the `is_confirmed` constraint. Now uses **all assigned faces** for clustering.

## Tests
- Updated `PhotoDetail.test.tsx` for retry logic.
- Updated `PersonService.eras.test.ts` for new repository method name and logic.
- Added `FaceAnalysisService.detectBackground.test.ts` for Era centroid inclusion verification.

### 3. Background Face Detection Performance
- **Problem**: `detect_background_faces` timed out on libraries with 30k+ unnamed faces due to:
    - Default 30s timeout (vs 5 min for similar operations).
    - Large JSON payloads slowing IPC transfer.
    - Era centroids being ignored (causing false positives).
- **Fix**:
    - **Timeout**: Wrapped `pythonProvider` with 5-minute timeout in `dbHandlers.ts`.
    - **File Transfer**: Added file-based data transfer for payloads >5000 faces in `FaceAnalysisService.ts`.
    - **Era Centroids**: `detectBackgroundFaces` now includes Era centroids alongside main person centroids.

