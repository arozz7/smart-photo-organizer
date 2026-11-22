# Feat: Pictures? list (pictures of faces, among assigned and unassigned faces). Version 0.8.17

**Branch:** `feature/pictures-suggestions` (stacked on `feature/hide-non-faces-from-review`, 0.8.16). Plan: `docs/plans/pictures-suggestions-plan.md`. Measurement: `docs/measurements/pictures.md` (Phase C0, go with one question at 70%).

## Why
A face on a billboard, poster, framed photo or screen is detected as a face, can be assigned to a person in a bulk action, and then sits in that person's centroids and in the search index. The Not a Face? check cannot see these (the detector is confident about them). The user asked for a way to find them in Review Needed and, because bulk assigning may have let some through, among the faces already assigned.

## What it does
- **Background check ("Check for Pictures of Faces", Settings > Database Management):** the same service as the face visibility check with its own settings (`picture_mode`, `picture_away_minutes`; only when the user is away by default). Asks the vision model one question about a crop 3.5 times the face box: "real, living person, or only a picture of one?". Score = log-odds PICTURE vs REAL, stored in `face_flags` kind `picture`. Order: faces assigned to people first, then Review Needed by detector score, highest first.
- **Pictures? tab (Edge Cases):** two lists, "In Review Needed" and "Assigned to a person", most picture-like first, shown with their surroundings (3.5x). Likelihood 50 to 95 percent (default 70), each choice shown with its count for both lists. Assigned tiles show the person, how the face was assigned and whether it is confirmed.
- **Actions (never automatic):** "Ignore as picture" (unassigned) / "Remove from person and ignore as picture" (assigned): sets `is_ignored`, `ignore_source = 'user'`, takes the face out of its person and rebuilds that person's centroids; "Keep (real face)": not offered again; Undo of the last ignore restores person, confirmed state, source and distance exactly (`picture_log`).
- **Hide from Review Needed (on by default):** the unassigned list at the chosen likelihood is left out of Review Needed, together with the Not a Face? faces (`reviewHiding.ts` takes the union). Assigned faces are never hidden. Notice with a button to open the tab.
- **Safe failure:** a list that cannot be read hides nothing.

## Files
- Python: `src/python/commands/face_picture.py` (new), `face_visibility.py` (generalised: `make_vlm_ask`, `handle_batch_request`, `open_crop(item, multiplier)`), `config.py` (`FACE_PICTURE_PROMPT`), `commands/__init__.py`, `main.py` (`score_face_picture`).
- Main: migration `005_pictureLog.ts` (`picture_log`), `pictureModel.ts` (model name, weights 4.782 / 10.347, `q1ForLikelihood`), `PictureRepository`, `PictureListRepository`, `PictureSuggestionService`, `PictureDeps`, `PictureCheckDeps`, `FaceVisibilityService` (options `modeKey`, `awayKey`, `logTag`), `visibilityEngine.scoreWithEngine(command)`, `reviewHiding.ts`, IPC `pictureHandlers.ts` (`picture:*`), `pictureCheckHandlers.ts` (`picturecheck:*`), shared `registerCheckHandlers` in `faceVisibilityHandlers.ts`, `main.ts`.
- Renderer: `usePictureSuggestions`, `PictureSuggestions.tsx`, `FaceCheckCard.tsx` (generic) with `FaceVisibilityCard` and `PictureCheckCard`, `useFaceVisibility(prefix)`, `describeState(status, noun)`, `pictureCrop.ts`, `EdgeCaseFilters` (tab, notice), `EdgeCaseSuggestionPanels`, `useEdgeCaseSuggestions`.
- Migration 005 is additive. `People.tsx` and `AIContext.tsx` unchanged.

## Tests (written first)
Migration, model, Python module and generalised batch handler, repositories on the real schema (eligibility, order, ignore/keep/undo exact restore), service, handlers (zod limits), combined hiding, hooks, panel, card, tab and notice.

## Assumptions and risks
- At 70% about four in five faces on the list were pictures (C0); real faces in mirrors, on boards or behind glass look the same, so the list shows the surroundings and nothing is ignored without the user's choice.
- The check is slow (about two thirds of a second a face on the GPU): assigned faces about 2 hours, the whole library about 13 hours of away time.
- The packaged engine must be rebuilt (`node scripts/build-python.js`) so it answers `score_face_picture`; the stale-engine guard blocks a build with an old engine.
- Ignoring assigned faces changes people's centroids; Undo restores the face and rebuilds again.

## 0.8.18 fix: Pictures? counts went stale
The tab loaded its overview once, when People opened, so "Checked N of M faces" stayed frozen while Settings (which polls) kept moving. The overview now reloads when the tab is opened and every 30 s while it is open (`OVERVIEW_REFRESH_MS`); the tab count loads once when closed. The face tiles are not reloaded by the timer (it would disturb a selection); "Load More" picks up newly scored faces.
