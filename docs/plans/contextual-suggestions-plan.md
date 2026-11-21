# Contextual Label Propagation: from silent assignment to reviewed suggestions (Implementation Plan)

Status: **DRAFT, needs approval** (2026-11-19). Replaces Phase 3 and Phase 6 of `hard-pose-context-propagation-plan.md` (the service built from them) and becomes an input to Phase F of `non-face-and-picture-faces-plan.md`.
No app code is written before this plan is approved.

## 1. Problem
Settings > Smart Assignment > "Contextual Label Propagation" ("Run for Entire Library") finished at once with "Done - 0 faces assigned" on the real library (0.8.11). The hourly background pass (`BackgroundPropagationService`) has returned `propagated: 0` every hour since at least 2026-11-18.
The idea is sound: a turned or blurry face in a photo shot minutes after sharp, frontal, named faces probably belongs to someone in that group. The current implementation cannot work, and a naive repair would be unsafe.

## 2. What was found (real library, read-only; scratch scripts, nothing in the repo or the library changed)
Library: 30,069 photos, 92,680 faces; 15,616 unassigned faces in 8,121 photos are "targets" (|yaw| over 45 or blur score under 40); 9,605 faces are named.

**Why it assigns nothing (two defects):**
1. **No anchors exist.** The service only trusts named faces with `confidence_tier = 'high'`. All 9,605 named faces have tier `unknown` (4,512 assigned by `ai_scan`, 5,093 by `auto_rematch`; the scan only writes `high` when it assigns by itself). Anchors found by the service's own rule: 0. By a sensible rule (named, sharp, frontal): 8,613.
2. **The time window never matches.** `date_taken` is stored as `2000-01-01T12:01:01` (19 characters; 10,355 photos use `...T17:12:20.000Z`). The window is built with SQLite `datetime(...)`, which returns `2000-01-01 11:56:01` with a space. The comparison is textual and `T` sorts after the space, so a same-day photo is never "between" the bounds (checked: a photo compared with itself returns false). `session_folder` is empty on all faces and `gps_lat` on all photos, so the other two signals never apply.

**What a repair would reach, and why "assign the leader" is wrong (target faces within +-5 minutes of a sharp, frontal, named face in another photo):**

| Anchor rule | Same folder | Photos with a candidate | Photos where the window holds exactly one person | Target faces in those |
|---|---|---|---|---|
| any named | no | 5,769 | 935 | 1,750 |
| confirmed only | no | 4,980 | 1,078 | 2,145 |
| any named | yes | 5,677 | 1,086 | 2,059 |
| **confirmed only** | **yes** | 4,659 | **1,483** | **2,958** (of 15,616) |

- **Most windows hold several people** (about 70% of the photos with a candidate). The current code takes the person with the most anchors and assigns **every** hard face of the photo to that person if they hold 70% of the votes. With two or three hard faces in a group photo that is wrong by construction (a person appears once per photo).
- **Only 5,013 of the 5,093 `auto_rematch` faces are unconfirmed**, and the anchors would spread any earlier re-match mistake. Confirmed named faces: 4,512 + 80, of which 4,199 are sharp and frontal.
- **The background service writes.** Once the two defects are fixed, `BackgroundPropagationService` would start assigning names every hour, unseen, and tag them `propagated`. The "Run for Entire Library" button and the photo-viewer handler `db:propagateLabelsInSession` do the same. This is the reason not to just repair the two defects.
- No face carries `assignment_source` `context_temporal` or `context_spatial`: nothing was ever assigned by this feature, so there is nothing to clean up.

## 3. Principles
- **Suggestions only, never silent assignment.** Same rule as the junk lists: the user sees the thumbnails, chooses, and Undo exists.
- **Context narrows, the face decides.** Time and place say who could be there; the embedding must still agree (a distance gate), otherwise a turned face of a stranger inherits a name.
- **Anchors are confirmed, sharp and frontal.** Unconfirmed `auto_rematch` faces are not evidence.
- **One person once per photo.** A candidate is dropped if that person already has a face in the photo, and a photo's candidate person goes to at most one target face (the closest).
- **Configurable in the app** (window minutes, anchor rule, distance gate, run mode), saved as settings.
- Nothing is deleted; the old service and button are changed to suggest-only, not removed.

## 4. Architecture check (modular)
- **Memory:** read-only queries over `faces`, `photos`, `people`. Dismissals go to `face_flags` (kind `context_dismissed`, same pattern as `non_face`); accepted suggestions use the existing `FaceRepository.assignFacesToPerson` with `assignment_source = 'context_temporal'` (no CHECK on that column; confirmed in `legacyBaseline.ts`) and `is_confirmed = 1`, plus an `INSERT OR REPLACE` into `face_flags` (kind `context_assigned`) so Undo can find exactly what this list assigned, as in `non_face_ignored`.
- **No new migration expected:** `face_flags` (migration 003) already holds both kinds. The suggestions themselves are computed on demand (a few seconds over the whole library with a time-sorted index), not stored, so they cannot go stale.
- **Tools:** the descriptor distance to a person is computed in TypeScript from the stored descriptors and the person centroid (same as the re-match review); no Python call.
- **Reasoning:** a pure `ContextSuggester` (inputs: faces, photos, anchors, settings; output: candidate pairs with a reason and distance) with the data access behind a repository interface, testable with fakes and no network.
- **Modularity proof:** the suggester runs against an in-memory fake repository; the service runs with a fake clock and fake store.

## 5. Phases (each with its own approval; one task at a time)

### Phase G0: safety first (small, no new feature)
Why first: the two defects are the only thing stopping silent assignment, and other work in the library (Phase F, scans) will make anchors appear.
- **G0.1** `BackgroundPropagationService` stops calling the writing pass. It is kept registered (no deletion), does nothing until Phase G2 replaces its job; log line says why.
- **G0.2** The Settings button and `db:propagateLabelsInSession` / `db:batchPropagateLabels` stop writing: the button text and result say "suggestions" and point to the list once it exists; until then they return a clear "this feature is being redesigned, nothing was assigned" result instead of "Done - 0 faces assigned".
- **Tests first:** the service does not write when run on a database with anchors and targets (real SQLite, real schema); handler tests for the new result.
- **Deliverable:** version bump, `aiChangeLog/fix-context-propagation-safe.md`.

### Phase G1: measure on the user's labels (no app code)
- Build the candidate pairs on the real library read-only, for the four rules in section 2 plus the embedding gate and the one-person-once rule. Make contact sheets (target face with the candidate person's exemplar faces, pose and distance printed), the assistant labels, the user reviews, as in Phase A. About 150 pairs, stratified by rule, distance and window size.
- Report precision per rule and per distance, and the share of candidates that survive.
- **Go/no-go for a bulk-confirm page:** held-out precision of at least 90% for the rule and distance offered as the default, with the error bars stated (the junk lists used 95% for ignore; confirming a name is reversible and every thumbnail is shown, but a wrong name hides the face from the person's real review). Below 90% the list is per-face review only.
- Output: `docs/measurements/contextual-suggestions.md`, chosen defaults.

### Phase G2: reviewed suggestions (needs G0 and the G1 go)
- **G2.1** `ContextSuggester` (pure) and `ContextSuggestionRepository`: anchors = named, sharp (blur 50 or more), frontal (|yaw| 30 or less), confirmed; window = +-N minutes by parsed timestamp (both date formats, parsed in code, not by text comparison in SQL) and same folder (derived from `photos.file_path`, because `session_folder` is empty); candidate = a window with exactly one person (setting: allow the leader of a window with several people only if the embedding gate holds); drops people already in the photo; at most one target per person per photo; gate = distance of the face to the person's centroid (frontal and profile centroid by pose) below a setting.
- **G2.2** IPC (zod `.strict()`): `context:getOverview` (counts per rule), `context:list` (page), `context:assign`, `context:dismiss`, `context:undo`, `context:getSettings`/`setSettings`.
- **G2.3** Replace the Settings card with a "Suggestions from nearby photos" list on People > Edge Cases (new tab, literal Tailwind classes): tile = the target face with its pose and quality, the suggested person and the sharp anchor faces that led to it, distance, time gap; actions Assign selected, Dismiss selected, Undo; thumbnails always shown before assigning.
- **G2.4** The old hourly job becomes "refresh the counts" (no writes) or is switched off; setting and card text say so.
- **Files over 900 lines may not grow** (`People.tsx` is 1,345 and lowered in the baseline): the tab goes in `EdgeCaseFilters.tsx` and a new component.

### Phase G3: feed Phase F (after F0 measures profiles)
- Confirmed context assignments are new **profile examples** for a person (a turned face with a trusted name), the thing Phase F lacks (only 93 confirmed profile faces today). Accepting a suggestion for a turned face adds it to that person's profile examples and rebuilds the profile centroid (F1 mechanism).
- Together with F3 (scan-time profile matching), context becomes a prior, not a rule.
- Not before F0 reports; its own approval.

## 6. Tests (written before code, per phase)
- `ContextSuggester`: date formats (`T` and `.000Z`), window edges, same folder, exactly one person, several people, person already in the photo, two targets one person, no confirmed anchors, blurry or turned anchors excluded, distance gate.
- Repository and service on real in-memory SQLite with the real legacy schema (`applyLegacyBaseline`, as in `FlagRepository.test.ts`): the test that would have caught the two defects (anchors with tier `unknown`, `T`-format dates, expected suggestions found).
- Assign and undo: sets and restores exactly the faces this list assigned (a mutation check as for ignore); stale-id guard (a face assigned elsewhere meanwhile is skipped).
- IPC schema tests; hook and component tests like `useNonFaceSuggestions`; G0 test that nothing is written.
- Gate: `scripts/dev/verify.ps1` before every push.

## 7. Risks
- **Wrong names from crowded events:** mitigated by one-person windows by default, the embedding gate, confirmed anchors, thumbnails and Undo.
- **Time stamps are unreliable:** 2002 holds 9,512 photos and some dates are placeholders (17 targets on `2000-01-01`); mitigated by excluding placeholder dates and by the folder rule. The camera clock can be wrong by a constant offset, which still works inside one folder.
- **Anchor shortage:** only 4,199 sharp, frontal, confirmed faces; some people have none, so they never get suggestions. Phase G3 grows the pool.
- **Measuring on one labeller and a small sample** (as in Phase A): error bars stated, defaults re-measured from the user's own decisions (as in Phase E).
- **Compute:** the first count over 15,616 targets and 8,613 anchors takes a few seconds with a sorted time index; a naive SQL join with `replace()` did not finish in two minutes, so the index is built in code.

## 8. Decisions needed from the user
1. Approve Phase G0 now (stop the silent writing), separate from the rest?
2. The go/no-go precision for a bulk-confirm page: 90% (proposed) or 95%?
3. Same-folder rule on by default (proposed) or time window only?
4. Order: G0, then F0 (measure profiles), then G1/G2? Or G1/G2 first?

## 9. Change log and docs
Each phase writes `aiChangeLog/<type>-<name>.md` (files, behaviour, tests, assumptions and risks), updates `hard-pose-context-propagation-plan.md` with a pointer to this plan, and the README settings notes. Version bump per released phase.
