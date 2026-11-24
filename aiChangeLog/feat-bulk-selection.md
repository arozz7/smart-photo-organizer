# Feat: faster review of long face lists (Not a Face?, Turned faces, Pictures?). Version 0.8.19

## Why
On a long list the user selects all loaded faces, scrolls through to check them, and reaches the bottom: the floating action bar covered Load More, the new page was not selected, and selecting it meant scrolling back to the top.

## What changed (all three lists behave the same)
- **Room for the bar:** space is left under the list while faces are selected, so Load More is never covered.
- **Toolbar stays in view:** "N selected, Select all loaded, Deselect" is sticky at the top of the list.
- **Load more and select:** a second button next to Load More loads the next page and selects exactly the faces it added (faces already selected stay selected). Turned faces that have two names are not selected, as with Select all.
- **Shift+click:** selects the range from the last plain click to the face clicked, in the order shown; it adds to the selection. A shift-click with no anchor acts as a plain click.
- **Keys:** `Ctrl+A` (Cmd+A) select all loaded, `Esc` clear the selection, `L` load more and select. Ignored while typing in a field or using a drop-down, and when another part of the page already handled the key.
- **Review Needed keys fixed:** the Review Needed cluster keys (A accept, X ignore, N name, J/K move) matched on the key alone, so `Ctrl+A` would also have accepted the focused cluster, and they stayed active while another Edge Cases tab was open (pressing X on Pictures? could ignore a Review Needed cluster out of sight). They now ignore Ctrl/Cmd/Alt combinations and run only while Review Needed is the open filter.

## Files
- New: `src/utils/selectionRange.ts`, `src/hooks/useListSelection.ts`, `src/hooks/useSelectionShortcuts.ts`, `src/components/SelectionControls.tsx` (`SelectionToolbar`, `LoadMoreControls`, `FloatingBarClearance`).
- Changed: `useNonFaceSuggestions`, `useProfileSuggestions`, `usePictureSuggestions` (shared selection, `loadMore` returns the ids it added, `loadMoreAndSelect`), `NonFaceSuggestions.tsx`, `ProfileSuggestions.tsx`, `PictureSuggestions.tsx`, `useClusterController.ts` (modifier guard), `People.tsx` (one condition and one dependency, still 1,344 lines).
- No migration, no main-process change.

## Tests (written first)
Range helper, selection hook, shortcuts hook, shared controls, each panel (shift flag, Load more and select, clearance, keys), each hook (load and select the new page, ranges, two-name faces), the cluster key guard.

## Risks
Shift+click adds to the selection and never removes; Deselect or a plain click removes. `L` is a new key on these tabs (not used elsewhere).
