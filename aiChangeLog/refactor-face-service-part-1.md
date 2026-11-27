# Refactor: FaceService, part 1 (settings in one place, matching moved out)

**Branch:** `feature/pictures-suggestions`. **Behavior change for the user's settings: none** (see "Settings").

## Why
`FaceService.ts` was 914 lines (hard limit 900), and `processAnalysisResult` read the scan settings in six separate places, one of them (`largeFaceThreshold`) not at all: the code had a hardcoded 300 while the setting said 300.

## Order followed (refactoring protocol)
1. **Tests first.** `FaceService_ScanResult.test.ts` (new, 15 tests against a real in-memory library) pins what a scan does with a photo's detections today: insert, human or suspect, reject below the line, the large-face exception, rejection memory, update of an existing face, clash, orphan cleanup, overlap cleanup, stored photo size.
2. **Settings in one place.** New `scanThresholds.ts`: `buildScanThresholds(aiSettings, advancedSettings)` returns every number the scan compares against (assign distance, review distance, search cutoff, accept score with strict mode, reject floor, overlap, large-face width). Built once per scan. `scanThresholds.test.ts` (5 tests): defaults, each setting changes the result, strict mode, zero means unset.
3. **Overlap math in one place.** New `faceBoxes.ts` (`boxIoU`, `boxIoMin`) replaces three copies of the same arithmetic. `faceBoxes.test.ts` (7 tests).
4. **Matching moved out.** New `FaceMatcher.ts` holds the descriptor-to-person matching, copied verbatim by script (no retyping).

## File mappings
- Moved `FaceMatch`, `MatchOptions`, `matchFace`, `matchBatch`, `matchAgainstCentroids`, `calculateL2Distance` from `FaceService.ts` -> `FaceMatcher.ts` (class `FaceMatcher`).
- `FaceService` keeps one-line delegates with the same names and signatures and re-exports the two types, so no caller and no test spy had to change (tests spy on `FaceService.matchBatch` and `matchAgainstCentroids`).
- Moved the inline settings reads in `processAnalysisResult` -> `scanThresholds.ts`.
- Moved the three inline overlap blocks in `processAnalysisResult` -> `faceBoxes.ts`.
- Nothing deleted.

## Settings
- `largeFaceThreshold` (the "large face" width) is now read by the scan. It was ignored (hardcoded 300). The saved value is 300, so nothing changes for the current library; a new test shows the setting takes effect.
- Still hardcoded (unchanged, listed so they are not mistaken for settings): the large-box area (4,000,000), the face-shape limits (0.6 to 1.6), and the low-score exception (score at least 0.15, and above 0.25 for a square box). Settings that no scan code reads: `minFaceSize`, `nmsIoMinThresh`, `enableAreaBasedNMS`.

## Findings (not changed here)
- An unconfirmed face marked ignored (thrown out by the vision check) is deleted at the end of a rescan when no new detection matches it, although the code comment says ignored faces must not be deleted. The rejection memory still blocks the new detection that overlaps it, but the memory itself is lost. Pinned by a test named "currently removes...", to be decided separately.

## Result
`FaceService.ts` 914 -> 621 lines. Backend tests: 123 files, 1,377 tests pass. Typecheck clean.

## Still to do (next parts)
`autoAssignFaces` to its own service, and `processAnalysisResult` (about 330 lines) split into small functions (existing-face matching, rejection memory, low-score screening, assignment decision), one at a time with the tests above.
