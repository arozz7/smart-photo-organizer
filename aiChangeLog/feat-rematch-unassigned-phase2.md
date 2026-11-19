# Feat: Re-match unassigned faces against named people (Phase 2 of the review-queue plan). Version 0.8.7

**Branch:** `feature/rematch-unassigned` (from `feature/parked-faces`, PR #87 not merged yet). Plan: `docs/plans/review-queue-parking-plan.md`, Phase 2.

## What it does
People named after a face was first processed never got a look at it: the background grouping matches a face once. This service compares every unassigned face with the named people again and
assigns matches **unconfirmed** (`assignment_source = 'auto_rematch'`, `match_distance` stored). They appear on the person's page behind the existing Unconfirmed filter with the distance badge;
the user confirms them or removes them.

- **Distance (changed after the first build, 0.8.8):** follows the scan **Auto-Assign** setting (Settings > AI Performance; 0.70 unless changed), limited to 0.40 - 0.80, so one setting decides what is matched automatically. The card can **pin** another value (0.50 to 0.80, stored as `rematch_distance`) and "Same as Auto-Assign" goes back to following. 0.65 is the fallback if the setting is unusable. The Face Match Distance setting (`faceSimilarityThreshold`) is not used (it steers other things and was stored as 0.85 here, see `fix-match-distance-setting.md`). A run keeps the distance it started with; a change of the effective distance allows a new automatic run.
  The first build (0.8.7) used 0.65. Moving to 0.70 adds about 1,400 faces (all between 0.65 and 0.70) on top of the 3,000 already matched (measured on a fresh read-only copy of the library with the real matcher).
- **Automatic (switch on by default):** a background loop checks every minute and starts a run when no scan or AI work is running and either it never ran, or the named people's centroids or the threshold changed since the last run
  (not more often than every 30 minutes). A run is a series of steps of 300 faces, one step per second, stored in app state, so it pauses for scans and resumes after a restart.
- **Card** in Settings > Database Management (next to Parked Faces): Run now, Undo re-match (with the count), the automatic switch, progress, last result.
- **A rejected match is not repeated:** every assignment is recorded in the new table `rematch_log (face_id, person_id)`. A face is not re-assigned to a person it was already re-matched to, so removing a face one by one sticks and the automatic run cannot loop.
- **Undo** is a true revert: it returns every face still `auto_rematch` and unconfirmed to unassigned (source back to `ai_scan`) and forgets those pairs in the log, so a later run (for example at another distance) can match them again.
  Confirmed faces and the pairs of faces the user removed one by one are untouched. Undoing also **switches the automatic runs off** (the user does not trust the matches); the switch or Run now bring them back.
- **The face search index (FAISS, used to match new scans) leaves out unconfirmed re-matches** until the user confirms them (`getNamedFaceDescriptors` and `NamedFaceFingerprintRepository`, the same set), so a wrong suggestion cannot pull new photos towards the wrong person
  and the index is not rebuilt when the re-match assigns 3,000 faces. (The existing scan-time suggestions are still in the index, unchanged.)
- Checked against the rest of the app: person centroids use confirmed faces only (so the fingerprint does not move when faces are re-matched); the background verifier and the propagation service only select unassigned faces,
  so re-matched faces leave their queue and undone ones return to it. The distance choice is locked while a run is under way.
- Ignored faces, non-human faces and faces without a full descriptor are never looked at. A face assigned or ignored since it was read is left alone.
- A failed run records its error and does not retry until the people or the distance change.

## Files
- New `electron/data/migrations/002_rematchLog.ts` (additive; registered in `migrations/index.ts`), `electron/data/repositories/RematchRepository.ts`, `electron/core/services/RematchService.ts` (logic, injected dependencies),
  `electron/core/services/RematchDeps.ts` (real wiring and singleton), `electron/ipc/rematchHandlers.ts` (`rematch:getStatus`, `rematch:run`, `rematch:undo`, `rematch:setAuto`, `rematch:setDistance`, payloads validated with zod),
  `src/hooks/useRematch.ts`, `src/components/RematchCard.tsx`.
- Modified: `electron/main.ts` (start and register the service, register the handlers), `DatabaseManagementSection.tsx` (mount the card), `legacyUpgrade.integration.test.ts` (schema is now version 2), version 0.8.6 to 0.8.7.
- `FaceRepository.ts`, `dbHandlers.ts` and `People.tsx` did not change (over the size limit).

## Tests (written first)
`tests/backend/unit/services/RematchService.test.ts`, `unit/repositories/RematchRepository.test.ts` (real SQLite in memory), `unit/migrations/rematchLogMigration.test.ts`, `tests/frontend/unit/hooks/useRematch.test.tsx`;
`legacyUpgrade.integration.test.ts` now expects version 2 and the empty log. Full gate: `scripts/dev/verify.ps1`.

## Measured on a scratch copy of the real library (the real code: repository, migration, FaceService matcher, service; the library itself was only read)
60,362 unassigned faces, 82 centroids, distance 0.65: **3,021 matched** (51 s, 203 steps of about 0.25 s each): within 0.4: 80; 0.4 to 0.5: 343; 0.5 to 0.6: 1,332; 0.6 to 0.65: 1,266.
Largest single person: 425 faces. Nothing ignored or non-human changed. Undo returned all 3,021; the only difference from the original was the discovery-bucket link (and bucketing flag) of 1,102 of them.
No second run starts by itself when nothing changed. (In that first check undo kept the log, so a run straight after matched 0; undo now forgets the pairs it returns, covered by repository tests.)
Earlier read-only estimate for 0.65 was 2,604; the copy is a little newer (more faces named since), and the matcher counts eras and pose centroids the same way as the app's grouping.

## Assumptions and risks
- Assigning a face clears its discovery-bucket link (as the app's own auto-assign does; bucket lists do not filter by person). **Undo cannot restore that link**; the faces are back in the People-page clustering, but not in their old discovery bucket.
- A person can receive many unconfirmed faces at once (the largest here: 425). They stay unconfirmed, so they do not change the person's centroid until confirmed, and the badge shows the distance.
- The automatic run repeats when the named people change, at most every 30 minutes; while the user is naming faces it can run several times, each only adding matches not tried before.
- The run uses the main process in steps of about a quarter of a second, with a one second pause between steps; it never runs during a scan or AI work.
- There is no per-person cap (the background grouping has none either; the cap of 50 belongs to the manual auto-assign tool). If a person absorbs wrong faces, Undo re-match or removing them from the Unconfirmed list fixes it, and the log stops them returning.
