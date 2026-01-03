# Phase 20: Background Face Filter (Smart Ignore Phase 1)

**Date:** 2026-01-03
**Status:** Complete

## Additional Fixes (Post-Implementation)

### Toast Confirmations Fixed
- **`usePersonDetail.ts`**: Added toast notifications for:
  - `handleReassign`: Shows "Faces Moved" toast on success
  - `handleUnassign`: Shows "Faces Removed" toast on success

### BackgroundFaceFilterModal Enhancements
- **Photo Preview**: Added hover button to view original photo using `useScan().viewPhoto()`
- **Naming Capability**: Added "Name" button that opens `RenameModal` to assign faces to new/existing person
- **Toast Feedback**: Added success toasts for ignore and name operations
- **Improved Layout**: Larger cards with better hover states matching `OutlierReviewModal` pattern
- **Nearest Person Label**: Shows "≠ PersonName" on faces to indicate which named person they're furthest from

## Diff Narrative

### 1. Configuration Layer
- **New:** Added `SmartIgnoreSettings` interface to `ConfigService.ts` with configurable thresholds:
  - `minPhotoAppearances`: Faces appearing in fewer photos are noise candidates (default: 3)
  - `maxClusterSize`: Clusters of this size or smaller are candidates (default: 2)
  - `centroidDistanceThreshold`: Faces further from any named centroid are candidates (default: 0.7)
  - `outlierThreshold`: For outlier detection (default: 1.2)
- **Updated:** `AppConfig` interface to include `smartIgnore` settings
- **Updated:** Deep merge in `ConfigService.load()` for backward compatibility
- **New:** Helper methods `getSmartIgnoreSettings()` and `updateSmartIgnoreSettings()`

### 2. Repository Layer
- **New:** `FaceRepository.getUnnamedFacesForNoiseDetection()` - fetches unnamed faces with descriptors and photo data for background face filtering

### 3. Python Backend
- **New:** `detect_background_faces()` function in `facelib/faces.py`:
  - Runs DBSCAN clustering on unnamed faces
  - Calculates distance to nearest named person centroid
  - Filters candidates meeting ALL noise criteria
  - Returns candidates sorted by distance (furthest first)
- **New:** `detect_background_faces` command handler in `main.py` with file-based payload support for large datasets

### 4. Service Layer
- **New:** `NoiseCandidate` and `NoiseAnalysis` interfaces in `FaceAnalysisService.ts`
- **New:** `FaceAnalysisService.detectBackgroundFaces()` orchestration method:
  - Fetches unnamed faces and person centroids
  - Sends to Python backend for processing
  - Transforms results for UI consumption

### 5. IPC Handler
- **New:** `db:detectBackgroundFaces` handler in `dbHandlers.ts`:
  - Merges user options with saved SmartIgnoreSettings
  - Calls FaceAnalysisService.detectBackgroundFaces()

### 6. Testing
- **New:** `FaceAnalysisService.detectBackground.test.ts` with 5 tests:
  - Empty face handling
  - Python backend integration
  - Custom threshold options
  - Response transformation
  - Error handling
- **Verified:** All 56 backend service tests pass (51 existing + 5 new)

## Files Created/Modified
- `electron/core/services/ConfigService.ts`
- `electron/data/repositories/FaceRepository.ts`
- `electron/core/services/FaceAnalysisService.ts`
- `electron/ipc/dbHandlers.ts`
- `src/python/facelib/faces.py`
- `src/python/main.py`
- `tests/backend/unit/services/FaceAnalysisService.detectBackground.test.ts` [NEW]

## Pending (Frontend)
- [x] `BackgroundFaceFilterModal.tsx` (created)
- [x] `People.tsx` UI button (added)
- [x] Manual verification

## Final Verification
- **Performance:** Verified batch loading (150 faces) works efficiently for large libraries.
- **Accuracy:** Confirmed noise detection correctly identifies background faces.
- **Workflow:** Verified "Ignore All" and "Name" actions working with auto-replenish.
- **Bug Fixes:** Resolved `db:ignoreFaces` argument mismatch.
