# Profile views: suggested names for turned faces (Phase F1 Implementation Plan)

Status: **APPROVED 2026-11-19** (decisions in section 8). Detail of Phase F1 in `non-face-and-picture-faces-plan.md`. F0 (go, `docs/measurements/profile-matching.md`) measured it: up to distance 1.0, 63 of 63 labelled suggestions were the right person (95% range 94% to 100%).
No app code is written before this plan is approved.

## 1. What it does
A list of **unassigned turned faces** (|yaw| 40 or more) with a **suggested person**, found by comparing each face with that person's **confirmed turned faces** ("profile examples"), not with their frontal centroid. The user sees the face next to the person's examples, chooses, and nothing is assigned without that choice. Confirming adds the face to the person's examples, so the next search reaches further.
- Yield on the real library (F0): about 1,837 of 14,779 turned queue faces at distance 1.0 (about 1,000 at 0.9), for the 24 people who have profile examples.
- Why examples and not the centroid: a turned face sits at a median 0.97 from its person's frontal centroid but within 0.85 of that person's other turned faces; the scan/re-match compare with centroids (frontal, and a profile centroid for people with 3 or more turned faces in the 30 to 75 degree range), which is why these faces stay unassigned.

## 2. Principles
- **Suggestions only.** Same rules as the junk lists: thumbnails and the person's examples shown before "Assign selected"; Undo exists; nothing is bulk-assigned unseen. Scan-time matching is not touched (that is F3).
- **The user's decision is the label:** an assigned face is confirmed (`is_confirmed = 1`) so it joins the person's centroids like any confirmed face.
- **Configurable in the app:** distance (default 1.0, range 0.8 to 1.1; the 1.0 to 1.1 band is a wider setting because 20 of 21 were right there and the error was a sibling), turned from |yaw| (default 40, range 40 to 70; nothing below 40 was measured).
- **Heavy work does not block the app:** the comparison runs in small steps with yields (see 4).

## 3. Rules (what makes a suggestion)
- **Candidate face:** unassigned, not ignored, human, descriptor present, |yaw| at or above the turned setting, not kept as "not a face" (`face_flags` `non_face` dismissed), not already dismissed for that person.
- **Examples of a person:** confirmed, not ignored, human, descriptor present, |yaw| at or above the same setting, from any photo (no upper yaw limit; the measurement used none), not the candidate's own photo.
- **Suggested person:** the person owning the nearest example, if that distance is within the setting.
- **Two names (decision 5):** if examples of two different people are both within the setting, the face carries **both** names, nearest first (F0 found none up to 1.0, so this mainly matters at the wider setting). "Assign selected" assigns the nearest; the row also offers the second name. These rows are not part of "Select all": the user chooses them one by one. The main process checks that the chosen person is still one of that face's candidates within the distance setting (the renderer cannot pick an arbitrary person).
- **One person once per photo:** dropped if that person already has a face in the photo (assigned, any state); a person is suggested for at most one candidate face per photo (the nearest; the others fall back to their second name or to nothing).
- Burst photos of one moment can give several faces; they are grouped so a page confirms them together.

## 4. Architecture check (modular)
- **Memory:** read-only queries for candidates and examples; assignments by a **guarded** update in `ProfileMatchRepository` (`WHERE id = ? AND person_id IS NULL AND is_ignored = 0`, `assignment_source = 'profile_match'`, `is_confirmed = 1`, the log row only when a row changed, one transaction), not through `FaceRepository.assignFacesToPerson`, which un-ignores faces and has no guard. One **additive migration 004**, `profile_suggestion_log(face_id, person_id, status 'assigned' | 'dismissed', distance, created_at, PRIMARY KEY(face_id, person_id))`, same pattern as `rematch_log`: it remembers dismissals (no re-offer) and finds exactly what this list assigned for Undo. Undo keys on log rows with status `assigned` where the face is still that person's with source `profile_match` (not on `is_confirmed = 0`, as the re-match undo does, because these faces are confirmed); an undone face goes back to unassigned, `needs_bucketing = 1` so it is grouped again, and appears in Review Needed (tested). `face_flags` is not used because its key is the face alone and a dismissal is per person.
- **Reasoning (pure):** `ProfileSuggester`: inputs examples and candidates (unit descriptors), settings; output suggestions with the nearest examples and the reason for any skip. No database, no time, no network: testable with synthetic unit vectors.
- **Tools:** `ProfileMatchRepository` (reads, assign, dismiss, undo, log), `ProfileMatchService` (settings, run in steps, cache, paging), `electron/ipc/profileHandlers.ts` (zod `.strict()`), recalculation of the person's centroids with the existing `PersonService.recalculatePersonMean` after an assignment (no change to it: its overall-mean outlier rule drops far faces, its pose centroids keep them).
- **Compute and cost:** 14.8k candidates against about 420 examples at 512 dimensions is about 3 billion multiply-adds, a few seconds in JavaScript. It runs **per person** when the person is opened (about 150 examples at most: about 1 second) and for the whole list in steps of 250 candidates with a yield between steps, with progress shown; the result is cached in memory. The cache is keyed on the settings and on `NamedFaceFingerprintRepository` (16 ms; it changes when any named face is added, removed or ignored, including on the person page), not only on this service's own writes; assigning and dismissing update the cache in place, Undo and setting changes recompute. New unassigned faces from a scan appear on "Refresh". Python is not used (its single process is shared with scans and the model check). If a measurement on the real library shows the steps still make the window stutter, the same function moves to a worker thread (a contained change).
- **Modularity proof:** `ProfileSuggester` and the service run against fakes (in-memory repository, fake clock) with no database.

## 5. Tasks (TDD: tests first; one task at a time; files over 900 lines may not grow)
1. **Migration 004** and `ProfileMatchRepository` (candidate, example, log queries) on real in-memory SQLite with the real legacy schema (`applyLegacyBaseline`), as for `FlagRepository`.
2. **`ProfileSuggester`** (pure): nearest-person, distance setting, ambiguity, person already in photo, one face per person per photo, dismissed pairs, unit-vector normalisation (some stored descriptors are not unit length), faces with no yaw.
3. **`ProfileMatchService`:** settings (`profile_distance`, `profile_min_yaw` flags), overview (counts by person and distance step), stepped compute with progress, cache and invalidation, assign (re-checks in SQL that the face is still unassigned and that the examples still stand; stale-id guard), dismiss, undo (returns exactly the faces this list assigned and the user has not moved, removes their log rows, rebuilds the centroids), a mutation-style test for undo as for the ignore fix.
4. **IPC** (`profile:getOverview`, `list`, `assign`, `dismiss`, `undo`, `setDistance`, `setMinYaw`; zod `.strict()`; preload) and tests.
5. **UI:** hook `useProfileSuggestions`; component `ProfileSuggestions.tsx` in a new Edge Cases tab "Turned faces" (`EdgeCaseFilters.tsx`, literal Tailwind classes). **`People.tsx` is at its 1,345-line cap and may not grow:** one hook `useEdgeCaseSuggestions(activeFilter)` (returns the Not a Face and Turned faces controllers and the tab counts) and one panel component replace the current Not a Face import, hook and render lines, so the net change in `People.tsx` is zero or negative. sections per person, each row = the face (pose and quality), the person's nearest examples and one sharp frontal face, distance, "Assign selected", "Not this person" (dismiss), "Undo"; header with the counts, the distance and yaw selectors, progress while computing. A button "Find profile views" on the person page (`PersonDetail.tsx`, 555 lines) opens the tab on that person.
6. **Docs and log:** `aiChangeLog/feat-profile-suggestions.md`, README settings note, plan updated, version bump; full gate `scripts/dev/verify.ps1`; build and a smoke test on a scratch folder.
- **Checks on a copy of the real database (not the live file):** the real query and suggester are run on a fresh copy and the counts must agree with the F0 script at 1.0 and 0.9 (a mismatch means a bug: unit normalisation, yaw filter, human or kept filter); a large batch of assignments for a big person (Zeus, Mimi) is replayed to see that `recalculatePersonMean` does not raise false drift alerts; every step of a full pass is timed (budget 50 ms).
- **Migration 004 housekeeping:** tests that pin the migration count or latest version are updated; the smoke test must show "Applying migration 4"; version 0.8.13 (this branch carries 0.8.12).
- **Manual check by the user (owed):** the page on the real library, 30 minutes: assign a page, see the person's profile centroid grow, Undo.

## 6. Tests (written first)
Migration and repository on real SQLite; suggester on synthetic unit vectors (no real photos); service with fake store and clock; IPC schema tests; hook and component tests like `useNonFaceSuggestions`; a test that an assignment is confirmed and recalculates the centroid; legacy upgrade test. Gate `scripts/dev/verify.ps1` before every push.

## 7. Risks
- **Side effect on automatic matching (disclose in the change log and the PR):** confirmed turned faces feed each person's profile centroid (30 to 75 degrees, 3 or more faces), which scans and the background re-match already compare against (re-match at the Auto-Assign distance, unconfirmed). Confirming suggestions therefore widens what the automatic re-match can assign for that person. F3 (scan-time matching) is still separate, but "scan matching untouched" is only partly true after F1.
- **Look-alikes and siblings** (the one F0 error, at 1.08): the examples are shown on every row; the default stops at 1.0.
- **Reference set is matcher-confirmed:** the examples are faces the matcher placed, so a wrong example would spread. Mitigation: a face assigned by this list is confirmed by the user's own look; the drift alert (`PersonService`) stays; the person's examples are visible on the page and can be removed on the person page.
- **Pictures as examples:** a person's confirmed faces include a postcard picture (F0, Kaley). A picture is not turned like a face but could be an example; Phase C removes pictures from the pool. Until then examples with a missing or odd pose are skipped and the examples are shown.
- **Compute:** a few seconds per full pass in the main process, chunked; measured on the real library before release (budget: no step above 50 ms).
- **Coverage:** only people with examples (24 of 48 have any turned example, 12 have 3 or more). Everyone else gets nothing; the list says how many faces had no person to compare with.
- **Small sample:** 84 labels, one labeller; the distance is a setting and is re-measured from the user's own accept and dismiss decisions (Phase E).

## 8. Decisions (answered by the user, 2026-11-19)
1. **Where it lives:** one Edge Cases tab "Turned faces" grouped by person, plus "Find profile views" on the person page (proposed; accepted).
2. **Dismissal memory:** yes, migration 004 `profile_suggestion_log`.
3. **Assigned faces are confirmed** (join the centroids immediately).
4. **Distance default 1.0 and turned from |yaw| 40**, both configurable.
5. **Faces near two people are shown with both names** (not skipped); see section 3.

## 9. Change log and docs
`aiChangeLog/feat-profile-suggestions.md` (files, behaviour, tests, assumptions and risks), README settings notes, the parent plan updated. Version bump per released phase.
