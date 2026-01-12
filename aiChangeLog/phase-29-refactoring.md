# Phase 29: FaceAnalysisService Refactoring

**Version:** v0.5.5
**Date:** 2026-01-10

## Summary
Refactored `FaceAnalysisService.ts` to improve maintainability by extracting outlier detection and noise detection logic into separate service modules.

## Changes

### New Files
- **`FaceOutlierService.ts`** (~230 lines)
  - `OutlierResult` interface
  - `OutlierAnalysis` interface
  - `findOutliersForPerson()` - Reference-based and IQR-based outlier detection

- **`FaceNoiseService.ts`** (~175 lines)
  - `NoiseCandidate` interface
  - `NoiseAnalysis` interface
  - `detectBackgroundFaces()` - Background face detection via Python backend

### Modified Files
- **`FaceAnalysisService.ts`** (564 → 196 lines)
  - Removed extracted methods
  - Added `export type` re-exports for backward compatibility
  - Added deprecated proxy methods to support existing callers
  - Kept core utilities: `normalizeVector`, `computeDistance`, `parseDescriptor`, `getQualityAdjustedThreshold`, `consensusVoting`

- **`FaceAnalysisService.detectBackground.test.ts`**
  - Updated imports to use `FaceNoiseService` directly
  - Added mock for `FaceAnalysisService.parseDescriptor`

### Version Bump
- `package.json`: 0.5.0 → 0.5.5
- `LoadingScreen.tsx`: v0.5.0 → v0.5.5
- `Layout.tsx`: v0.5.0 → v0.5.5
- `future_features.md`: Updated version header and Phase 4 status

## Verification
- All 16 FaceAnalysisService tests passing (pre and post refactor)
- No breaking changes to public API (backward compatible re-exports)
