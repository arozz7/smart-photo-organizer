# Fix: enhancement models in the AI runtime folder; truthful AI mode badge

**Branch:** `fix/model-location-and-ai-status` (stacked on `fix/near-duplicate-performance`, PR #82). Version 0.8.4.

## 1. Enhancement models (RealESRGAN x4plus, RealESRGAN x4plus anime, GFPGAN)
**Problem.** These three were stored and looked for only next to the Python code (`enhance.WEIGHTS_DIR`, inside the
version's install folder: `...\smart-photo-ai\_internal\weights`). That folder is empty in every packaged build and
is lost with each new version folder. AdaFace and SAM 3 already had a fallback to the AI runtime's models folder (0.8.1);
these three did not. Putting the files in `H:\PhotoLibrary\ai-runtime\models` had no effect: the dialog still offered Download
and the enhancement code (`load_upsampler`, `load_gfpgan`) would not have found them.

**Change.**
- `facelib/utils.py`: `find_enhancement_weights(name, legacy_dir)` (runtime `models` folder first, then the old
  folder) and `enhancement_weights_save_path(name, legacy_dir)` (runtime `models` folder when the AI runtime folder exists,
  otherwise the old folder; it never creates the runtime folder, because that folder's existence is what marks the GPU
  runtime as installed). `get_model_status` uses them.
- `enhance.py`: downloads reuse an existing file or save to the new location; `load_upsampler` and `load_gfpgan` find weights
  the same way. `main.py`'s second status block (`health_check`) uses the same helpers.
- Weights saved next to the code by earlier versions are still found. Nothing is moved or deleted.

## 2. AI mode badge ("Enhanced (CPU)" while the GPU works)
**Problem.** `faces.AI_MODE` was initialised to `"CPU"` and only became `"GPU"` when face detection first initialised
(first photo processed in a session). Until then the badge claimed CPU. The log of a real session shows the GPU is used
(`CUDA detected via Torch ... InsightFace initialized. Mode: GPU`).

**Change.** `AI_MODE` starts as an "uninitialised" marker and `faces.get_ai_mode()` returns the real mode once detection has
initialised, or, before that, predicts it exactly as `init_insightface` decides (CUDA PyTorch available means GPU, otherwise CPU).
`ping` (`aiMode`), the status route and the debug route use it. The first call may load PyTorch (1.4 s measured warm);
the backend loads it for the vision model anyway. No UI change: the badge's existing "Starting AI..." state still means
"the backend has not answered yet".

## Tests
`tests/python/unit/test_enhancement_weights.py` (15), `tests/python/unit/test_ai_mode.py` (8), one new ping test in
`tests/python/integration/test_main_commands.py`. Checked read-only against the real library folder: all three models report
Ready with their real sizes and the mode is predicted GPU on this machine.

## Not changed
- Moving the old copies out of `_internal\weights` (none exist in packaged builds).
- The face verifier still accepts a face as human when the AI backend times out (Phase 90 design); separate decision.
