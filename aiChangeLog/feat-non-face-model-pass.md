# Feat: model question for "Not a Face?" (Phase B part 2 of the non-face and picture plan). Version 0.8.11

**Branch:** `feature/non-face-model-pass` (from main, with the 0.8.10 ignore fix of PR #92 merged in). Plan: `docs/plans/non-face-and-picture-faces-plan.md`, Phase B part 2 and Phase D. Measurements: `docs/measurements/non-face-and-picture-faces.md`, section 8.

## What it does
A background check asks the app's vision model (SmolVLM2, the one the verifier already uses) **"is a clear human face visible in the middle of this crop?"** about every uncertain face in the review queue (detector score below 0.75, unassigned, not ignored, human, not kept: about a fifth of the queue).
Only the odds of the first word (NO against YES) are used. They are combined with the detector score into one calibrated number, the **likelihood that the box is not a face**, and Edge Cases > Not a Face? gets a second ranking.
**The model only ranks suggestions. Nothing is ignored or changed by it**; the user still sees the thumbnails and chooses (ignore, keep, undo), exactly as in the detector list.

- **List modes** (switch on the list, saved as `nonface_mode`): *Detector score* (as before) and *Model + detector*. In the model list the cut-off is a likelihood (50 to 95 percent, default 70, saved as `nonface_min_likelihood`), each choice shown with its count;
  tiles show the likelihood (detector score, model score, quality and pose in the tooltip and badges); the header says how much the model has looked at and how many of the list are turned 45 degrees or more, and that the model leans against faces seen from the side.
- **Settings card** "Check Uncertain Faces" (Settings > Database Management): run mode *Only when I am away* (default, no keyboard or mouse input for 1 to 60 minutes, default 5) / *Whenever no scan or AI work is running* / *Off*; Run now; progress; what it is doing; the last error.
- **Pause mechanism** (plan, Phase D): a scan or AI work always wins (checked before every batch, in every mode); in "away" mode the check also waits for the idle time (Electron `powerMonitor.getSystemIdleTime()`) and pauses at the next batch when input returns.
  A batch is 8 faces (about 6 seconds), so the pause happens within seconds. Progress is the database (a face with a score is done), so it resumes after a restart and never repeats a face. A face that cannot be read is recorded as failed and not retried.
  If the whole call fails (no GPU, engine down, timeout) the faces are left alone and it backs off for half an hour; Run now ends the back-off. Needs a GPU (about 0.7 s a face; about 2 hours for the user's roughly 11,000 uncertain faces); without one it says so on the card.
- Model scores are stored in `face_flags` (kind `face_visibility`, model name `smolvlm2-visible-face-v1`). A new wording, crop or weights means a new model name; old scores are then ignored and redone.

## Measured (docs/measurements/non-face-and-picture-faces.md, section 8)
On the app's own code path (fp16, eager attention) with the user's corrected labels (48 non-faces among 480): the model with the detector reaches AUC 0.972 (detector alone 0.946). At a likelihood of at least 70%: 27 faces, 25 non-faces (93%) and no turned real face, against 72% non-faces for the detector list at a similar recall.
Wordings that spell out that turned faces count measured much weaker (AUC 0.80 and 0.84 alone). The shipped wording (C) is the original without "or side" and measures the same as the original (0.971 against 0.972); the model's lean against turned faces is its own (turned real faces score about +0.4, frontal ones -1.2, non-faces +2.5), so the list shows pose, counts turned faces and says so. See the report, section 8.

## Files
- Python: new `src/python/commands/face_visibility.py` (command `score_face_visibility`: crop, question, batch of at most 16, per-face errors), `config.py` (`FACE_VISIBILITY_PROMPT`), `main.py` (one dispatch block), `commands/__init__.py`.
- New: `electron/core/services/FaceVisibilityService.ts` (logic), `BackgroundLoop.ts` (the step-wait-repeat loop, injectable sleep), `FaceVisibilityDeps.ts` (wiring), `visibilityEngine.ts` (request and reply validation), `visibilityModel.ts` (model name, weights, likelihood maths),
  `electron/data/repositories/VisibilityRepository.ts` (the queue of faces to score, counts, stored scores), `RankedNonFaceRepository.ts` (the model list), `electron/ipc/faceVisibilityHandlers.ts` (`visibility:getStatus`, `runNow`, `setMode`, `setAwayMinutes`),
  `src/hooks/useFaceVisibility.ts`, `src/components/FaceVisibilityCard.tsx`, `src/utils/visibilityText.ts`.
- Changed: `NonFaceSuggestionService.ts` (two modes; the overview now only computes the shown list, and its shape changed: `detector` and `model` sub-objects), `NonFaceDeps.ts`, `nonFaceHandlers.ts` (`nonface:setMode`, `nonface:setLikelihood`), `FlagRepository.ts` (the write halves of ignore and keep are shared by both lists),
  `useNonFaceSuggestions.ts`, `NonFaceSuggestions.tsx`, `DatabaseManagementSection.tsx` (mount the card), `electron/main.ts` (start the service, register the handlers), `Settings.test.tsx` (mock the new card).
- No migration: `face_flags` (migration 003) already holds the scores.

## Tests (written first)
Python `tests/python/unit/test_face_visibility.py` (crop geometry, batch behaviour with a fake model); `FaceVisibilityService.test.ts` (modes, idle, busy, run now, resume, failures, back-off), `BackgroundLoop.test.ts`, `visibilityEngine.test.ts`, `visibilityModel.test.ts`,
`VisibilityRepository.test.ts` and `RankedNonFaceRepository.test.ts` (real SQLite with the real legacy schema), `NonFaceSuggestionService.test.ts` (both modes), `nonFaceHandlers.test.ts`, `faceVisibilityHandlers.test.ts`, hook and component tests. Gate: `scripts/dev/verify.ps1`.

## Assumptions and risks
- The Python engine is single-threaded: while a batch runs (about 6 s, the first one also loads the model, about 40 s) other engine commands wait. Hence small batches, idle-only by default, and the busy check before every batch.
- The weights and the 93% figure come from 48 labelled non-faces (one labeller): expect them to shrink on new data. The likelihood is an estimate, not a guarantee, which is why nothing is bulk-ignored without the thumbnails.
- The shipped wording leans against faces seen from the side (see the report); the list shows pose and a turned-face count, and the detector list stays available.
- Not done: unloading the model after idle minutes (the model is shared with the verifier, which keeps it loaded today); a daily time budget (the idle rule and the pause cover the need); the pictures check (Phase C).
