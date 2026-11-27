# Performance: grouping status index, Ungroupable centroids, Doubtful crop (0.8.30)

**Branch:** `feature/pictures-suggestions`. Plan: `docs/plans/ai-and-edge-cases-speed-plan.md`, phase 1 of 3 (0.8.30 index and fixes, 0.8.31 clustering cache and split, 0.8.32 foreground lane for the Python engine).

## Why
The log showed the main process blocked about 3.5 s in every 10 s while idle ("[Lag] ... blocked 10 times in 10 s (worst ~350 ms)"), in 0.8.28 as well as 0.8.29. The cause: the Review Needed progress calls `db:getBucketingStatus` every second while grouping is active, and its count (`needs_bucketing = 1 AND person_id IS NULL AND is_ignored = 0`) used only the `person_id` index, so it read every unassigned face (about 90,000 rows, each with a large descriptor) in 300-350 ms. Reproduced on a copy with realistic row width: 351 ms before, about 0 ms with a covering index. A plain partial index is not used by the planner and does not help.

## Files created
- `electron/data/migrations/009_bucketingStatusIndex.ts`: index `idx_faces_bucketing_status (needs_bucketing, person_id, is_ignored)`. Additive.
- `electron/data/repositories/bucketingQueries.ts`: `REMAINING_BUCKETING_SQL`, the one text of the count, shared by the handler and the test.
- `electron/core/services/ungroupableCentroids.ts`: `toUngroupableCentroids(people)`.
- `docs/plans/ai-and-edge-cases-speed-plan.md` is written with phase 2 (see below).

## Files modified
- `electron/data/migrations/index.ts`: migration 009 registered last.
- `electron/ipc/dbHandlers.ts`: `db:getBucketingStatus` uses `REMAINING_BUCKETING_SQL`.
- `electron/ipc/aiHandlers.ts`: `ai:findUngroupableFaces` builds its centroids with `toUngroupableCentroids`.
- `src/components/DoubtfulFaces.tsx`: tiles are cropped to the face box (they showed the surroundings, copied from the Pictures? list); the explanation text says to use the eye button for the photo.
- `README.md`: a Doubtful Faces section. `package.json`, `package-lock.json`: 0.8.30.

## Behavior changes
- The status count costs about 0 ms instead of about 330 ms, once a second while grouping runs.
- **Bug fix, Ungroupable:** the handler looked for `descriptor_mean_json` on people that already carry the parsed centroid as `descriptor`, so it always sent 0 centroids and Python answered "No named person centroids. All faces are ungroupable." (seen in 0.8.28 and 0.8.29). It now sends the real centroids, so the Ungroupable filter shows only faces farther than the threshold from every named person. Its count will drop sharply.
- Doubtful faces tiles show the face, not its surroundings.
- The first start of 0.8.30 backs up the library (as every schema change does) and builds the index; it takes a few seconds longer.

## Tests added (written first)
`bucketingStatusIndexMigration.test.ts` (4: registered last, plan is a COVERING INDEX, same count with and without the index, safe twice), `ungroupableCentroids.test.ts` (3), crop test in `DoubtfulFaces.test.tsx`. Updated: `doubtfulLogMigration.test.ts` (registered in order), `legacyUpgrade.integration.test.ts` (version 9; a "newer" library is now version 10).

## Assumptions and risks
- A library at version 9 opens in 0.8.29 and 0.8.28 (newer schemas are left untouched, additive only).
- The engine folder `python-bin` is identical in 0.8.28 and 0.8.29 (same file count, size and exe hash), so the slower 0.8.29 start (about 48 s against 9 s) is not engine code; likely a first launch with a cold disk. To be confirmed by a second start.
- `ai:getUnassignedCount` (also counts over wide rows, once a minute) is not changed here.
