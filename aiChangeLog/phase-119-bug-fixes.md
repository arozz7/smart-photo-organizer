# Phase 119 Bug Fixes — SAM3 Model Loading & Slider Reactivity

## Summary
Two post-Phase-119 bugs fixed: the SAM3 model silently loading during "Segmenting…" instead of "Loading image…", and threshold/feather sliders having no visible effect on the result.

## Files Modified

### `src/python/facelib/sam3_provider.py`
- Added `self._ensure_initialized()` as the first call in `set_image()`
- **Before:** model cold-load (~39s) happened inside the first `predict_from_*()` call, so the UI showed "Segmenting…" the entire time
- **After:** model loads during the "Loading image…" phase, so the spinner text correctly reflects what the app is doing

### `src/hooks/useSegmentation.ts`
- After a successful `predict()`, eagerly update `masksRef.current` and `selectedMaskIdxRef.current` to the fresh masks before any follow-on logic
- If `lastOpRef.current` is set at that point, immediately call `applyOperation()` with the new mask
- **Before:** threshold slider changes would re-run segmentation (update the mask internally) but the visible result image never changed — the user had to manually click Remove BG again to see the effect of the new mask
- **After:** threshold changes now cascade: re-predict → auto-reapply last operation → result updates automatically

## Behavior Notes
- Feather slider auto-reapply was already correct in code; it requires at least one operation to have been applied first (sets `lastOp`). The initial Remove BG click always picks up the current feather value via `featherRadiusRef.current`.
- The new auto-reapply-after-predict also benefits point/box prompt workflows: re-predicting (e.g. adding a point) with an existing `lastOp` now automatically refreshes the result.
