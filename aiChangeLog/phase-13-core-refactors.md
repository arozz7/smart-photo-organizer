# Phase 13: Core Refactors & Reliability

**Date:** 2025-12-31
**Status:** Completed

## Diff Narrative

### Core Reliability Improvements
This phase focused on stabilizing core workflows (scanning, face assignment) and ensuring visual consistency between the frontend and backend.

#### Thumbnail & Image Consistency
- **Alignment Fix**: Resolved persistent misalignment between RAW/JPG thumbnails and face crops.
  - Ensured `imageProtocol.ts` (Sharp) and `main.py` (CV2/PIL) use consistent orientation and cropping logic.
  - Fixed "Ghost Crops" where face thumbnails didn't match the undetected faces.

#### Face Assignment Logic
- **Hybrid Matching**: Implemented a hybrid approach for `AutoAssign`:
  - Combines FAISS vector similarity with Centroid matching.
  - Reduces false negatives where a face is a match but falls outside strict cluster boundaries.
  - **Iterative Identification**: Automated the "Identify All" process to run iteratively until no further matches are found.

### Scan & Queue Management
- **Scan Association Debug**: Fixed an issue where the "Scan for All Named People" feature reported 0 matches despite finding candidates (metadata filtering issue).
- **AI Queue Control**: Disabled auto-start of the AI processing queue on application launch.
  - Queue now defaults to `Paused` state.
  - Prevents resource contention during startup.

### Codebase Refactoring
- **Refactoring Candidates**: Addressed major technical debt items from `docs/refactoring_candidates.md`.
  - modularized `imageProtocol` into `ImageService`, `MetadataRepository`, and `ImageProcessor`.
  - Refactored `People.tsx` and `PersonDetail.tsx` into smaller components and hooks.
  - Cleaned up `ScanContext` by extracting hooks (`useScanErrors`, `usePhotoNavigation`, `useLibraryMetadata`).

### Verification
- **Manual Testing**: Verified thumbnail generation, face assignment flows, and queue behavior.
- **Build**: Successful production build confirmed.
