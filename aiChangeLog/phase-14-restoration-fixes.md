# Phase 14: Core Architecture Refactor & Ignored Faces Fixes

## Overview
This phase focused on a major modularization of the Electron backend to improve maintainability and resolve critical bugs in face management. We transitioned from monolithic IPC handlers and direct database access to a decoupled Architecture using Repositories, Services, and Adapters.

## Changes

### 🏛️ Architecture Modularization
- **Repositories**: Created `FaceRepository`, `PersonRepository`, and `PhotoRepository` to centralize all SQLite queries.
- **Services**: Introduced `FaceService` and `PersonService` to handle complex business logic (matching, assignment, mean calculation).
- **Adapters**: Implemented `PythonAIProvider` to wrap communication with the Python backend.
- **IPC Cleanup**: Refactored `aiHandlers.ts` and `dbHandlers.ts` to delegate work to services, removing "logic leaks" from the IPC layer.

### 🐛 Bug Fixes & Improvements
- **Face Clustering**: Fixed a `SyntaxError` in the clustering logic caused by incorrect handling of binary face descriptors. Descriptors are now correctly parsed as `Float32Array` before being sent to Python.
- **Ignored Faces restoration**:
    - Added missing `db:restoreFaces` and `db:restoreFace` IPC handlers.
    - Updated `FaceRepository.getIgnoredFaces` to include descriptors, enabling identity suggestions for ignored faces.
    - Implemented simultaneous restore-and-assign logic in the database for better performance.
- **Matching Reliability**: Added the missing `face:findPotentialMatches` handler to support the "Identify Matches" feature in the Blurry Faces modal.

### ✨ UI Enhancements (Ignored Faces Modal)
- **Sensitivity Slider**: Added a slider to control matching thresholds (0.1 to 0.95), allowing users to find matches for low-quality/blurry ignored faces.
- **AI Data Indicators**: Added green dots to face thumbnails to visually confirm when AI data is present and ready for matching.
- **Success Feedback**: Improved the "Restore as [Name]" action to immediately remove faces from both flat and grouped/clustered views.
- **Status Messaging**: Added helpful status text to explain why suggestions might be missing (e.g., "needs scan" vs "low confidence").

## Files Modified
- `electron/data/repositories/FaceRepository.ts`
- `electron/data/repositories/PersonRepository.ts`
- `electron/ipc/aiHandlers.ts`
- `electron/ipc/dbHandlers.ts`
- `electron/core/services/FaceService.ts`
- `electron/core/services/PersonService.ts`
- `src/components/IgnoredFacesModal.tsx`
- `src/components/UnmatchedFacesModal.tsx`

## Verification Results
- All face matching features are now operational across Blurry, Ignored, and Unmatched modals.
- Clustering no longer errors on binary data.
- Restored faces correctly sync across all UI views (flat and grouped).
