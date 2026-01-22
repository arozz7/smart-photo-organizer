# Phase 43: Robust Age-Based ERA Generation

## Summary
Fixed the generation of impossible eras (e.g., "Elderly" for a child) by implementing quality-weighted statistical filtering in `PersonService.generateEras()`.

## Problem
InsightFace's `genderage` module estimates age from visual appearance, which is unreliable. A child with 11,111 faces was incorrectly generating eras like "Young Adult" (6773 faces), "Adult" (3201 faces), and "Elderly" (200 faces) when the actual age range should have been ~3-9 years.

## Solution: Quality-Weighted Statistical Filtering

### Algorithm
1. **Quality Gate**: Identify high-quality faces (`blur_score >= 25`, `face_quality >= 0.4`)
2. **Reference Median**: Calculate median age from high-quality faces (minimum 10 samples)
3. **MAD-Based Outlier Rejection**: Reject ages outside `median ± min(3*MAD, 20 years)`
4. **Bucket Valid Faces**: Only faces with ages in the valid range are assigned to life-stage buckets

### Files Modified

- **`electron/data/repositories/FaceRepository.ts`**: Added `blur_score` and `face_quality` to `getAssignedFacesWithDates()` query
- **`electron/core/services/PersonService.ts`**: Rewrote `generateEras()` to include:
  - Helper functions for `median()` and `mad()` (Median Absolute Deviation)
  - Quality-weighted reference median calculation
  - Statistical outlier rejection before bucketing

### Tests Added

- **`tests/backend/unit/services/PersonService.eras.test.ts`**: Added 3 new tests:
  - `should reject impossible ages when child has adult/elderly estimates`
  - `should use high-quality faces as reference median`
  - `should fallback to all faces if not enough high-quality ones`

## Verification
- TypeScript compilation: ✅ Pass
- Unit tests: ✅ 8/8 pass
- Console output from test shows proper filtering:
  - `[PersonService] Quality filtering: X high-quality faces, reference median=Y, MAD=Z`
  - `[PersonService] Outlier rejection: N faces rejected (valid range: A-B)`

## Impact
- **No impact on face recognition/suggestions**: Age data is only used by ERA generation
- **Backward compatible**: If no quality data exists (`blur_score`/`face_quality` NULL), the filter treats them as valid
