# Fix: the match distance setting (config precedence, label, FAISS units). Version 0.8.8

**Branch:** `fix/match-distance-setting` (from main).

## What was wrong
- `ConfigService` applied `ai-config.json` as a *final override* on top of the values the user saved in the app, so in a run from the repo folder a saved value (for example the face match slider) was overwritten on the next load. The merged result was then saved back, which copied the file's values into `config.json`.
- `aiSettings.faceSimilarityThreshold` was filled from `face_detection.score_threshold_confident` in that file. That is a face **detection score**, not a match distance (0.85 on the installed library, where the default is 0.65).
- The slider "Face Recognition Confidence" was described as a similarity (higher = stricter) but the setting is an L2 **distance** (lower = stricter) in the centroid match.
- `FaceService.matchFace` converted the setting with `1/t - 1` for its FAISS fallback (a third meaning). FAISS reports **squared** L2 distances.
- `smartIgnore.autoAssignThreshold` / `reviewThreshold` (0.4 / 0.6 in `config.json`) are read by nothing. The scan-time values live in `aiSettings` (saved by the slider), and the code silently fell back to 0.7 / 0.9 when they were absent.

## Changes
- `ConfigService.ts`: order is hardcoded defaults, then `ai-config.json`, then **the user's saved values**. `score_threshold_confident` is no longer mapped to the match distance. `aiSettings` defaults now state `autoAssignThreshold` 0.7 and `reviewThreshold` 0.9 (the values the code already used). The `smartIgnore` copies are marked `@deprecated` and kept, so old files load.
- `SettingsModal.tsx`: slider renamed "Face Match Distance", range 0.30 to 1.00, tooltip says lower = stricter and where it is used.
- `FaceService.matchFace`: FAISS fallback searches with the squared threshold and reports the square root of the returned distance.

## Not changed (needs a decision)
- `FaceService.matchBatch` (used by scans) passes the L2 threshold straight to FAISS and keeps the squared distances it returns, so its fallback compares squared distances with an L2 threshold and tiers them as if they were L2. Fixing it changes which faces a scan assigns, so it was left alone and a note was added in the code.
- The 0.85 already stored in an existing `config.json` is the user's saved value now, so it is respected; it was not rewritten.

## Tests (written first)
`tests/backend/unit/services/ConfigService_Precedence.test.ts`, `FaceService_FaissUnits.test.ts`.
