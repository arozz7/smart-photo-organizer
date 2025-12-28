# Phase 08: Auto-Identify Logic Fixes & Enhancements

## Summary
Resolved critical issues with the "Auto-Identify Faces" feature where the "Confidence" setting was inverted, logic was single-pass, and logs were excessively verbose. Also optimized the Person Mean calculation to exclude blurry photos for better accuracy.

## Changes

### 1. Fix: Inverted "Confidence" Logic
- **Issue**: The system interpreted the configuration value as a "Distance Threshold" (Lower = Stricter), but the UI presented it as "Confidence" (Higher = Stricter). Setting a high confidence (0.9) resulted in a very loose distance match (0.9).
- **Fix**: Inverted the logic in `electron/db.ts` to calculate `Similarity = 1 / (1 + Distance)`. The system now matches if `Similarity >= Threshold`.
- **Result**:
    -   0.60 Confidence -> Matches Similarity > 60% (Distance < 0.66).
    -   0.90 Confidence -> Matches Similarity > 90% (Distance < 0.11).

### 2. Feature: Iterative "Snowball" Matching
- **Change**: Updated `autoAssignFaces` to run in a loop (up to 10 passes).
- **Logic**:
    1.  Match faces against current means.
    2.  Assign faces.
    3.  **Recalculate Means** using new faces.
    4.  Repeat until no new matches are found.
- **Benefit**: Captures faces that were initially "borderline" but become confident matches after the Person Model improves with more data.

### 3. Optimization: Blurry Face Filtering
- **Change**: Updated `recalculatePersonMean` to exclude faces with `blur_score < faceBlurThreshold` (default 20).
- **Benefit**: Ensures the "Reference Face" for a person is calculated only from high-quality photos, preventing noisy data from degrading recognition accuracy.

### 4. Improvement: Log Reduction
- **Change**: Reduced verbosity of logs in `main.ts` and `db.ts`.
- **Details**:
    -   Suppressed "Distance to..." logs for every candidate in Auto-Assign.
    -   Condensed Python IPC logs (`cluster_result`, `search_result`, `scan_result`, `tags_result`) to single-line summaries.
    -   Suppressed `download_progress` logs.

## Files Modified
- `electron/db.ts`
- `electron/main.ts`

## Tests
- [x] Manual Verification of Auto-Identify with 0.60 and 0.90 thresholds.
- [x] Verified Iterative "Pass" logs in Auto-Assign.
- [x] Verified reduced console noise during scanning/clustering.
