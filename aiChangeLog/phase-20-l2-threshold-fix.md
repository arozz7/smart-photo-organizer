# Phase 20: L2 Distance Threshold Fix & Face Matching Improvements

Date: 2026-01-04

## Summary
Fixed critical issue where FAISS face matching was using incorrect thresholds, preventing scan-time auto-assign and confidence tiering from working. Added configurable threshold settings to UI.

## Root Cause
The FAISS index uses L2 (Euclidean) distance on normalized vectors, which ranges from 0-2, not 0-1 like cosine similarity. The original thresholds (0.4, 0.6) were too strict, filtering out all valid matches.

## Changes Made

### Backend

#### `electron/core/services/FaceService.ts`
- Updated threshold values to L2 scale: `HIGH_THRESHOLD = 0.7`, `REVIEW_THRESHOLD = 0.9`, `SEARCH_CUTOFF = 1.0`
- Thresholds now read from `AISettings` for configurability
- Added detailed logging: `Tier Stats: ... (thresholds: high<X, review<Y)`

#### `electron/core/services/ConfigService.ts`
- Added `autoAssignThreshold` and `reviewThreshold` to `AISettings` interface

#### `electron/data/repositories/FaceRepository.ts`
- Added `getNamedFaceDescriptors()` method - returns ONLY faces assigned to named people
- **Critical fix:** FAISS index must only contain named person faces for correct matching

#### `electron/ipc/aiHandlers.ts`
- `ai:rebuildIndex` now uses `getNamedFaceDescriptors()` instead of `getAllDescriptors()`

### Frontend

#### `src/components/SettingsModal.tsx`
- Added "Face Matching Thresholds" section under General tab
- Sliders for Auto-Assign (0.4-1.0) and Review Tier (0.6-1.2)
- Improved tooltips explaining LOWER vs HIGHER effects

#### `src/components/SmartIgnorePanel.tsx`
- Redesigned to compact toolbar layout
- Shows "X assigned" and "Y to review" stats
- "Ignore All" button styled with red to indicate destructive action

#### `src/components/ClusterRow.tsx`
- Simplified highlight logic: shows amber ring if cluster has ANY suggestion

#### `src/views/People.tsx`
- "to review" count now shows total unnamed faces (clusters + singles)

### Tests

#### `tests/backend/unit/services/FaceService_Thresholds.test.ts` (NEW)
- Validates threshold ranges are in valid L2 scale
- Tests L2-to-similarity conversion math
- Tests tier classification logic

#### `tests/frontend/unit/components/SmartIgnorePanel.test.tsx`
- Updated to match new compact UI

## Testing
- All related tests pass (24 tests)
- Manual verification: amber rings now appear on suggested face clusters

## Migration Notes
After updating, users should:
1. **Rebuild FAISS Index** (Settings → AI → Rebuild Vector Index) to populate with only named faces
2. **Force Rescan** folders to apply new thresholds
