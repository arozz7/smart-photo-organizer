# Refactor: FaceService, part 2, and two scan bugs fixed (0.8.28)

**Branch:** `feature/pictures-suggestions`. Continues `refactor-face-service-part-1.md`.

## Bugs fixed (tests written first, seen failing, then fixed)
1. **Rejection memory was erased on rescan.** A face marked ignored (thrown out by the vision check or the user) and not confirmed was deleted by the orphan cleanup at the end of a rescan, although the code comment said ignored faces must not be deleted. The next scan could then bring the same box back. The cleanup now never deletes an ignored face. Tests: "keeps an unconfirmed ignored face that no detection matches", "keeps an ignored face even when the rescan detects nothing".
2. **A skipped detection shifted the matches of the detections after it.** The scan took each detection's person match with a running counter, but a detection skipped by the rejection memory did not take its match. Every later detection in the photo then got the previous detection's match, so a face could be suggested or assigned to the wrong person. Each detection now looks up its own match. Test: "gives each detection its own match even when an earlier detection was skipped by the rejection memory". Only photos with a skipped detection were affected; the library has many ignored faces, so this was real.

## Refactor
- New `scanDecisions.ts`: pure functions with no database and no settings reads: `findOverlapGarbage`, `findExistingFace`, `findRejectingFace`, `screenNewDetection`, `decideAssignment`. 22 tests in `scanDecisions.test.ts`.
- New `AutoAssigner.ts`: the bulk assignment code. It gets its matcher as an argument (dependency injection); `FaceService.autoAssignFaces` passes its own `matchBatch`, so tests that replace `FaceService.matchBatch` still work.

## File mappings
- Moved `AUTO_ASSIGN_DEFAULTS`, `autoAssignFaces` (now `AutoAssigner.run`), the `SearchFn` type from `FaceService.ts` -> `AutoAssigner.ts`. `FaceService` keeps same-name delegates.
- Moved from `FaceService.processAnalysisResult` -> `scanDecisions.ts`: the overlap cleanup decision, the "is this a stored face seen again" search with the claim check, the rejection-memory check, the low-score screening, and the assignment decision (tiers, quality-adjusted lines, who may be assigned).
- Nothing deleted.

## Result
`FaceService.ts`: 914 -> 320 lines (part 1 took it to 621). Remaining in it: the database writes (update and insert of faces), the orphan cleanup, and the delegates. Backend tests: 124 files, 1,401 tests pass. Typecheck clean.

## Behavior notes
- Besides the two fixes above, behavior is unchanged: the same inputs give the same stored faces (pinned by the 18 characterization tests in `FaceService_ScanResult.test.ts`).
- Log lines for rejected and skipped faces are shorter (the overlap figure is no longer printed).
