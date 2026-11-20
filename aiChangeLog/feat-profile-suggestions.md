# Feat: "Turned faces" suggestions (Phase F1 of the non-face and picture plan). Version 0.8.13

**Branch:** `feature/profile-suggestions` (stacked on `fix/context-propagation-safe` 0.8.12, which is stacked on PR #93 0.8.11). **Plan:** `docs/plans/profile-suggestions-plan.md` (approved 2026-11-19). **Measurement:** `docs/measurements/profile-matching.md` (F0).

## What it does
Edge Cases > **Turned faces**: unassigned faces turned 40 degrees or more, each with the person whose **confirmed turned faces** it resembles (nearest example, not the front-view centroid), shown beside two of that person's turned faces and a sharp front view.
The user selects faces and chooses **Assign selected** (the face becomes that person's, confirmed) or **Not this person** (remembered, not suggested again for that person); the last assignment can be **undone**. Nothing is assigned unseen.
- A face close to **two people** shows both names, nearest first, with a button "It's {second name}"; "Select all loaded" skips those faces.
- Rules: distance up to **1.0** by default (settable 0.8 to 1.1), turned from **40** degrees (settable 40 to 70); a person already in the photo is not suggested; a person is suggested for only the nearest face of a photo.
- "Find profile views" on a person's page opens the tab limited to that person. "Refresh" searches again (after a scan, or after assigning, when the examples have grown).
- Assigning rebuilds that person's centroids (`PersonService.recalculatePersonMean`).

## Measured (F0, `docs/measurements/profile-matching.md`)
63 of 63 labelled suggestions up to 1.0 were the right person (95% range 94% to 100%); 20 of 21 from 1.0 to 1.1 (the error a sibling).
On a fresh copy of the real library the new query and suggester agree **exactly** with an independent Python count at every distance: 376 / 1,003 / **1,920** / 2,954 faces within 0.8 / 0.9 / 1.0 / 1.1 (430 examples of 24 people, 14,726 candidates; the F0 note had 1,837 at 1.0 on an earlier state of the library).
Timing: a full search takes about 6.5 s in 247 steps (median 23 ms, 95th percentile 32 ms); two table scans of about 0.3 s each happen at the start of a search, with a pause between them.
Replay on the copy: assigning all 387 suggestions at 1.0 for Mimi (profile faces 173 to 495) and all 212 for Zeus changed their overall centroids by 0.049 and 0.024 (alert threshold 0.20), raised **no** drift alert, took about 0.1 s, and Undo restored the exact state.

## Files
- New: `electron/data/migrations/004_profileSuggestionLog.ts` (table `profile_suggestion_log`, additive), `electron/core/services/ProfileSuggester.ts` (pure logic), `ProfileMatchService.ts` (settings, stepped search, cache, assign, dismiss, undo), `ProfileMatchDeps.ts`, `electron/data/repositories/ProfileMatchRepository.ts`, `electron/ipc/profileHandlers.ts` (`profile:getOverview`, `refresh`, `setDistance`, `setMinYaw`, `list`, `assign`, `dismiss`, `undo`),
  `src/hooks/useProfileSuggestions.ts`, `useEdgeCaseSuggestions.ts`, `src/components/ProfileSuggestions.tsx`, `EdgeCaseSuggestionPanels.tsx`, `src/utils/edgeCaseIntent.ts`.
- Changed: `migrations/index.ts`, `electron/main.ts` (register handlers), `EdgeCaseFilters.tsx` (tab), `People.tsx` (one hook and one panel replace the Not a Face lines; still 1,345 lines), `PersonDetail.tsx` (button), tests that pinned the migration count (`faceFlagsMigration.test.ts`, `legacyUpgrade.integration.test.ts`).

## Behaviour that may surprise
- **Assigned turned faces feed the person's profile centroid** (30 to 75 degrees, 3 or more faces), which scans and the background re-match already compare against (re-match at the Auto-Assign distance, unconfirmed). Confirming suggestions therefore **widens what the automatic re-match can assign for that person**. Scan-time matching itself is not changed (that is F3).
- The search reads the whole faces table twice (about 0.3 s each) when it starts, then works in steps of 60 faces with a pause between them. It starts when the tab is opened, not when the People page opens.
- The cache is keyed on the settings and on the named-face fingerprint, so a confirmation on the person page or an ignore also triggers a new search. Assigning and dismissing update the list in place and mark it "may find more".
- Assignment is a guarded update (face still unassigned and not ignored) and does not use `FaceRepository.assignFacesToPerson`, which would un-ignore a face. Undo returns a face only while it is still that person's with source `profile_match`, and queues it for grouping again.
- A face the user kept in Not a Face? is a real face and stays eligible here.

## Tests (written first)
Migration (4 tests); `ProfileSuggester` (15, synthetic unit vectors); `ProfileMatchRepository` (15, real schema via `applyLegacyBaseline`: guarded assign, undo only of what the list assigned, Review Needed after undo); `ProfileMatchService` (22, fake dependencies: both names, in-photo and dismissed exclusion, one person per photo, assign refuses a person the face was not suggested for, cache and fingerprint, stale search dropped, steps and yields);
`profileHandlers` (15, zod schemas); `useProfileSuggestions` (12); `ProfileSuggestions` (13); `useEdgeCaseSuggestions`, `EdgeCaseSuggestionPanels` and the filter tab (7). Gate: `scripts/dev/verify.ps1`.

## Assumptions and risks
- Look-alikes and siblings can be close (the one F0 error); the examples are shown on every suggestion.
- The reference examples are matcher-confirmed faces; a wrong example would spread. Each assignment is the user's own confirmation, the drift alert stays, and Undo exists.
- Only the 24 people who have turned examples can be suggested; the page says how many examples it used.
- Pictures (a postcard assigned to a person) can be examples until Phase C removes them.
- One labeller, 84 labels; the distance is a setting.
