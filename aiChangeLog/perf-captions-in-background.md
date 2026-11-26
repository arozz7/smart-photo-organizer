# Perf: descriptions and tags move out of the face scan into a background pass (0.8.23)

**Branch:** `feature/pictures-suggestions`.

## Why (measured, not guessed)
From the 636 photos in `logs\main.log` (all MACRO mode, Python timestamps): per photo the face stage took **0.63 s** (median) and the captioning model **2.59 s**: 3.2 s in total, 81% of it captioning. The gap between two photos outside the engine averaged about 3.6 s (one 46-minute pause excluded), so the real rate was about 6.8 s a photo.
Checked and ruled out: the extra detector passes (640, 320) cost about 0.05 s together; the model cache missed only 18 times in 636 photos; TTA is already off.
The description is shown only in the photo details panel and nothing searches it; tags feed tag browsing; a "Generate Smart Tags" button already makes them on demand.

## What changed
- **Captions follow the faces.** New setting `aiSettings.captionTiming`: `'background'` (default) or `'scan'` (the old behavior). In the main process `ai:analyzeImage` now sets `enableVLM` only when `captionsRunInScan(settings)`, so the engine skips the captioning model during the scan (`electron/ipc/aiHandlers.ts`, `electron/core/services/captionTiming.ts`). The window needs no change (`AIContext.tsx` is at the 900-line limit and was not touched).
- **`BackgroundCaptionService`** (new, registered in `main.ts`; 60 s start-up delay): one photo per step through the existing `PhotoService.generateTags` (which saves the description and the tags), newest first, only while no scan or face analysis is running (`AppStateRepository.isScanActive / isAIProcessingActive`), and only for photos whose faces were scanned. The logic is in `CaptionBackfill` (injected dependencies, tested): batches of 50, a photo that fails is skipped for the session, five failures in a row pause it for 10 minutes (the engine is probably down), and it checks rarely when there is nothing to do or the setting is off.
- **`CaptionRepository`** (new): the query for scanned photos without a description (`scan_history` has no index, so it reads batches, not one query per photo).
- **Settings:** "Descriptions and tags" choice under Smart Tags (shown only while Smart Tags are on): "In the background (faster scans)" or "While scanning". Takes effect at once (the main process reads it for each photo); no reload.
- **Engine:** `landmark_2d_106` removed from the default face modules (`faces.DEFAULT_MODULES`): nothing reads its output and it ran for every face on every detector pass. Pose (`landmark_3d_68`), age and gender (`genderage`) stay.
- **Smaller:** removed a `console.trace` that ran for every photo (`PhotoService.analyzeImage`).
- **Measurement for the gap:** `[Timing] Photo N: result handled in X ms (faces saved in Y ms)` in `main.log` (`PythonAIProvider`), to be read together with the `[Lag]` lines of 0.8.22.

## Behavior notes
- Existing backlog: about 4,380 face-scanned photos have no description; they are captioned in the background (about 3 hours at 2.6 s each), newest first. Photos scanned from now on are captioned after their faces.
- While captioning runs, the engine (one request at a time) answers other requests after the current caption (up to about 3 s). Scans, and face work in general, take priority: captioning stops as soon as a scan starts.
- Photos are not captioned while the window's scan queue is running: a long scan finishes first, then the captions follow. The "busy" flag drops for a moment between two photos of a scan, so captioning also needs 10 seconds of continuous quiet before it starts (and starts the wait again whenever work shows up).
- Switching to "While scanning" restores the old behavior; photos already scanned in the background mode keep their captions.

## Tests (written first)
`CaptionBackfill.test.ts`, `captionTiming.test.ts`, `repositories/CaptionRepository.test.ts`, `AiPerformanceSection.test.tsx`, `tests/python/unit/test_faces.py` (default modules).

## Not done (needs the numbers from this version)
- Preparing the next photo while the previous result is saved. The `[Timing]` and `[Lag]` lines will show whether the gap is saving, the second engine call (people matching) or the window round trip.
- The image is still read three times per photo (detection, perceptual hash, captioning); minor.

## Risks
- The engine must be rebuilt for the `landmark_2d_106` change (`node scripts/build-python.js`); without a rebuild the packaged engine keeps the old module list (harmless).
- If the background pass finds no work it logs nothing; it logs the size of the backlog once when it starts captioning.
