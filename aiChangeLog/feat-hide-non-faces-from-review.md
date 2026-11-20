# Feat: Review Needed hides the faces of the Not a Face? list (on by default). Version 0.8.16

**Branch:** `feature/hide-non-faces-from-review` (stacked on `fix/home-flicker` 0.8.15, PR #94).

## Why
The user still saw faces that are not faces in Edge Cases > Review Needed. Nothing left Review Needed automatically by design: the Not a Face? tab only suggests, and the model check had looked at 88 of about 12,500 uncertain faces. The user chose an opt-out setting: faces that are in the Not a Face? list are left out of Review Needed and reviewed in that tab instead.

## What it does
- **Setting (on by default):** "Hide these faces from Review Needed" on the Not a Face? tab. Saved as `nonface_hide_from_review` (any value other than `0` means on).
- **Which faces:** exactly the faces of the list now shown (detector cut-off, or the model list in model mode) **except faces turned 45 degrees or more** (real faces seen from the side; they stay in Review Needed). An unknown pose counts as not turned. Changing the cut-off or the mode changes what is hidden.
- **Where it applies:** Review Needed's clusters and singles (`ai:getClusteredFaces`) and its count badge (`ai:getUnassignedCount`). Nothing else: the faces stay in the database, unassigned and unchanged; the background grouping still sees them; the Library stats and the dashboard still count them as unassigned.
- **Notice:** under the Edge Cases tabs, Review Needed says "N faces are not shown here because they are in Not a Face?" with a button to open that tab.
- **Review and release:** Keep sends a face back to Review Needed; Ignore moves it to the Ignored filter; turning the setting off brings everything back. Nothing is ignored by hiding.
- **Refresh:** a change made in Not a Face? or Turned faces marks Review Needed out of date; it reloads when the user goes back to it (grouping takes a while), not before.
- **Safe failure:** if the list cannot be read, nothing is hidden (Review Needed never loses faces to an error).

## Files
- Main: `FlagRepository.idsToHideBelow`, `RankedNonFaceRepository.idsToHideAtLeast`, `NonFaceSuggestionService` (setting, `hiddenFromReviewIds`, overview fields `hideFromReview`, `hideable`, `hiddenFromReview`), `NonFaceDeps`, new `reviewHiding.ts` (`hiddenFromReview`, `withoutHidden`, `countWithoutHidden`), IPC `nonface:setHide`, `aiHandlers.ts` (two call sites).
- Renderer: `useNonFaceSuggestions` (`setHideFromReview`, `onReviewChanged`), `useProfileSuggestions` (`onReviewChanged`), `useEdgeCaseSuggestions` (counts, reload when returning to Review Needed), `NonFaceSuggestions.tsx` (checkbox), `EdgeCaseFilters.tsx` (notice), `People.tsx` (one hook argument and one counts line: 1,345 to 1,344 lines; baseline lowered).
- No migration.

## Tests (written first)
Repositories on the real schema (hidden set = list minus turned faces; Keep releases a face), the service (default on, setting saved, detector and model lists, cut-off changes, off, Keep and Ignore, overview numbers), `reviewHiding` (fails open), the `nonface:setHide` handler, the hook, the checkbox, the notice and the reload-only-when-changed rule.

## Assumptions and risks
- **Real faces can be hidden until reviewed.** About a quarter of the default detector list are real faces (turned ones stay visible, but looking down, covered or blurry real faces do not). They are reviewed in Not a Face?, where Keep returns them. The notice and the count make that visible.
- The set is computed on each Review Needed load: about 0.3 s per query on the real library (a scan of the faces table; the score has no index), twice per load (count and clusters).
- The model list is nearly empty until the model check has run (it needs idle time and a rebuilt engine, 0.8.14+).
