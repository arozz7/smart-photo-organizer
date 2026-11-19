# Feat: Parked faces, Phase 0 (read-only count). Version 0.8.6

**Branch:** `feature/parked-faces` (from `main` at 0.8.5). Plan: `docs/plans/review-queue-parking-plan.md`.

## What it does
A new card, **Settings > Database Management > Review Queue: Parked Faces**, counts the unassigned faces that would be set aside from review
("parked") and those worth reviewing. **It only counts: no face is ignored, assigned, moved or deleted, and the review queue is unchanged.**
Opening Settings only reads the last saved result; the measuring starts when the user presses Calculate.

A face is parked when it is unassigned, not ignored, and either too small or blurry (face box under 8,000 px², or blur score under 60), or has
no twin (no other unassigned face within L2 0.5 from a *different shot*) and is not within 0.8 of a named person's centroid.

**Same shot = one appearance.** One shot is often saved several times: a RAW file and the JPG exported from it, an edited copy, a copy in another
folder, frames within one second. Faces from the same shot are not twins of each other. Two photos are the same shot when they are the same photo, the
same file name (ignoring extension) in the same folder, or taken in the same second, unless more than 20 photos share that second (a placeholder date:
see below). The links chain. Exact copies (descriptor distance 0.001 or less) are also never twins, whatever their file names.

## Files
- New `src/python/commands/neighbour_counts.py`, command `face_neighbour_counts` registered in `src/python/main.py`: for a range of rows of a raw float32
  descriptor file (and a raw int32 file of shot labels), counts twins at several distances, how many close faces were left out as copies or same-shot, and the
  distance to the nearest named centroid. Chunked float32 matrix products.
- New `electron/core/services/parkedFaces.ts`: pure logic (`assignShotIds`, `classifyFace`, `summariseParked`, `collectCentroids`, `faceBoxArea`, cache key).
- New `electron/core/services/ParkedFaceSummaryService.ts` (orchestration with injected dependencies) and `ParkedFaceSummaryDeps.ts` (real wiring):
  8,000 faces per request so the one-request-at-a-time AI backend is never held long; refuses to start (and stops between requests) while a scan or AI work is
  running; one measurement at a time; the result is saved in `app_state` (`parked_summary_cache`) and reused until the unassigned faces, the named people or the thresholds change.
- New `electron/data/repositories/ParkedFaceRepository.ts` (the same "unassigned" condition as the review queue; `FaceRepository.ts` is over the size limit and did not grow).
- New `electron/ipc/parkedFaceHandlers.ts` (`db:getParkedSummary`, payload validated with zod), registered in `electron/main.ts`.
- New `src/hooks/useParkedSummary.ts`, `src/components/ParkedFacesCard.tsx`, mounted in `DatabaseManagementSection.tsx`.
  The plan said "Edge Cases"; `People.tsx` is over the size limit and may not grow, so the card sits next to Face Data Health in Settings. Phase 1 puts Parked in the People page.
- Version 0.8.5 to 0.8.6.

## Tests (written first)
`tests/python/unit/test_neighbour_counts.py` (22), `tests/backend/unit/services/parkedFaces.test.ts`, `ParkedFaceSummaryService.test.ts`,
`tests/frontend/unit/hooks/useParkedSummary.test.tsx`. Full gate: `scripts/dev/verify.ps1`.

## Measured on the real library (read-only; the app's own `assignShotIds` and `summariseParked`, the app's Python command, same query, files and chunking)
60,666 unassigned faces in 18,114 shots; 82 named centroids; 8 requests, 37 s in total; fingerprint query 0.24 s; shot labelling 65 ms.

| | Faces |
|---|---|
| Low quality | 13,789 |
| Appear once (no twin from another shot, no named person within 0.8) | 35,492 |
| **Parked** | **49,281** |
| **Worth reviewing** | **11,385** (6,365 with a twin from another shot + 5,020 lone faces within 0.8 of a named person) |
| Clear faces whose only close faces are the same shot saved again | 7,761 |

How the numbers moved while building, and why:
- Counting exact copies as twins gave 14,126 worth reviewing. Excluding exact copies: 8,908 with a real twin. Also excluding other files of the same shot: 6,365.
  The library currently has no RAW files and one same-name pair, so the same-shot effect today is mostly frames in the same second and re-saved copies; RAW plus exported JPG pairs
  (more common in the newer folders, not imported yet) are covered by the same-name and same-second rules.
- **Placeholder capture times are real here:** 3,682 and 1,099 photos carry the same two default capture seconds (2002-01-01 04:00:00 and 05:00:00), and 6 more times are shared by over 20 photos.
  Without the cap of 20 they would merge into huge fake shots. With it the largest shot is 11 photos (usually a batch with an identical file time).
  Consecutive files that share a file time can be merged although they are different shots; that errs towards parking, and parked faces stay reachable.
- **Near a named person** has no natural cut-off: lone clear faces within 0.5 of a named person: 26; 0.6: 489; 0.7: 2,091; 0.8: 5,020. The card shows this table; 0.8 is the app's own suggestion distance and stays the default until
  the user reviews samples (Phase 3). These faces are inside the distance at which the background grouping would have suggested a person, but were processed before those people were named and are never looked at again;
  the Phase 2 re-check addresses this.
- Twin distance 0.58 instead of 0.5: 32,438 would appear once (against 35,492 at 0.5).

## Assumptions and risks
- Clustering and this count both use `descriptor` (not `descriptor_v2`): `getUnassignedDescriptors` does.
- Photos of one scene taken seconds apart (not the same second) still give twins, so a stranger in a short burst across seconds counts as recurring.
- The first measurement on 60k faces takes under a minute and loads the AI backend in short slices; it is manual and never starts by itself.
