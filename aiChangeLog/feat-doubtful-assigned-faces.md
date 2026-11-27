# Feature: Doubtful faces (a check and a review list for faces assigned to people) (0.8.29)

**Branch:** `feature/pictures-suggestions`. Plan: `docs/plans/doubtful-assigned-faces-plan.md`.

## Why
The "is a clear face visible?" check only looked at unassigned faces, so non-faces assigned to named people (through the scan, the 2026-09-16 migration, or the Turned faces list) were never checked and had no list.

## Files created
- `electron/data/repositories/AssignedVisibilityRepository.ts`: the queue of assigned faces to check (biggest person first), progress counts; scores go to the shared `face_visibility` place.
- `electron/core/services/AssignedVisibilityDeps.ts`, `electron/ipc/assignedCheckHandlers.ts`: a second instance of `FaceVisibilityService` with its own mode and away time; channels `assignedcheck:*`.
- `electron/data/migrations/008_doubtfulLog.ts`: table `doubtful_log` (additive).
- `electron/data/repositories/DoubtfulFaceRepository.ts`: list, counts, people, ignore, unassign, keep, undo, each write re-checking in SQL that the face is still doubtful.
- `electron/core/services/DoubtfulFaceService.ts`, `DoubtfulFaceDeps.ts`, `electron/ipc/doubtfulHandlers.ts`: the cut-off (saved in app state), people rebuilt after changes, input validated with Zod; channels `doubtful:*`.
- `src/hooks/useDoubtfulFaces.ts`, `src/components/DoubtfulFaces.tsx`, `src/components/AssignedCheckCard.tsx`, `src/utils/assignmentSource.ts`.
- `docs/plans/doubtful-assigned-faces-plan.md`.

## Files modified
- `electron/main.ts`: starts the assigned-face check, registers its handlers and the list's handlers.
- `electron/data/migrations/index.ts`: migration 008 registered last.
- `src/components/EdgeCaseFilters.tsx` (new tab "Doubtful faces"), `EdgeCaseSuggestionPanels.tsx`, `src/hooks/useEdgeCaseSuggestions.ts` (the list and its count), `src/components/settings/DatabaseManagementSection.tsx` (the card).
- Moved `describeSource` from `PictureSuggestions.tsx` -> `src/utils/assignmentSource.ts` (shared by both lists).
- `People.tsx` is not touched (it was already over the size limit).

## Behavior
- Nothing changes a face until the user selects faces and chooses. The background check only writes scores.
- Undo restores person, confirmed state, source, distance, tier and suggestion; a face the user changed since is left alone; a deleted person's face comes back unassigned.
- Measured on the real library (read-only): `loadDue` 122 ms per batch, counts 346 ms, list 68 ms. First batch is the person with the most faces.

## Tests added (written first)
`AssignedVisibilityRepository.test.ts` (10), `doubtfulLogMigration.test.ts` (4), `DoubtfulFaceRepository.test.ts` (15), `DoubtfulFaceService.test.ts` (13), `assignedCheckHandlers.test.ts` (3), `doubtfulHandlers.test.ts` (14), `useDoubtfulFaces.test.tsx` (10), `DoubtfulFaces.test.tsx` (11). Registry and legacy-upgrade tests updated for version 8; `useEdgeCaseSuggestions.test.tsx` checks the new count.

## Assumptions and risks
- The default level (3) is a starting point; the right level is known only after the check has run.
- About 3.4 hours of GPU work for the assigned pool; it pauses for scans and AI work and runs in "away" mode by default.
- Ignore and unassign change many faces in one action (up to 2,000); the person's centroids are rebuilt once per person afterwards.
