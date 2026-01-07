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
