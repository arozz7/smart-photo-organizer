# Phase 114 — SAM 3 Image Exemplar Prompts

## Summary
Added "Exemplar" as a fourth SAM 3 prompt mode. The user draws a reference box around one instance of a concept; SAM 3 returns all matching instances found anywhere in the photo (PCS via image exemplar). Optional negative exclusion boxes refine the results by suppressing unwanted instances.

## Files Modified

### `src/python/facelib/sam3_provider.py`
- Added `predict_from_exemplar(session_id, ref_box, neg_boxes, threshold, mask_threshold)` — calls `Sam3Model` (not `Sam3TrackerModel`) with `input_boxes=[[ref_box, *neg_boxes]]` and `input_boxes_labels=[[1, 0, 0, ...]]`. Distinct from `predict_from_box` (PVS — segments the specific instance inside the box); this is PCS — finds all conceptually similar instances.
- Updated `get_capabilities()` to include `exemplar_prompts: True`.

### `src/python/commands/segmentation.py`
- Added `exemplar_box` and `exemplar_neg_boxes` params to `predict()`.
- `exemplar_box` is checked first in the routing chain (before `text`, `box`, `points`) and routes to `predict_from_exemplar`.

### `electron/ipc/aiHandlers.ts`
- Extended `ai:segment:predict` payload type with `exemplar_box?: number[]` and `exemplar_neg_boxes?: number[][]`.

### `src/hooks/useSegmentation.ts`
- `PromptMode` extended: `'text' | 'box' | 'points' | 'exemplar'`.
- `SegmentState` gains `exemplarBox` and `exemplarNegBoxes` fields.
- Added refs: `exemplarBoxRef`, `exemplarNegBoxesRef` (synced after every render).
- New actions: `setExemplarBox`, `addExemplarNegBox`, `removeExemplarNegBox`, `clearExemplarBoxes`.
- `clearPrompts()` resets exemplar state as well.
- `setPromptMode()` clears exemplar state when switching away from exemplar mode.
- `predict()` override signature extended with `exemplarBox` and `exemplarNegBoxes`; routes to `exemplar_box` IPC payload in exemplar mode.

### `src/components/CreativeToolsPanel.tsx`
- Added `'⊡ Exemplar'` as the fourth mode button.
- Local state `exemplarDrawIsNeg` controls whether the next draw is a reference box or exclusion box (resets when leaving exemplar mode).
- `redrawCanvas` draws ref box in green (`#22c55e`) and neg boxes in red (`#ef4444`); live drag preview in dashed indigo.
- `handleMouseDown` starts a `draw-box` drag in exemplar mode.
- `handleMouseUp` routes finished draws: if `!exemplarDrawIsNeg` or no ref box → `setExemplarBox` + predict; otherwise → `addExemplarNegBox` + predict with updated neg list.
- Delete key clears all exemplar boxes (`clearExemplarBoxes`).
- Toolbar hint updates dynamically based on ref-box presence.
- Exemplar draw-mode toggle panel (Reference / Exclude) appears once a ref box is drawn.
- Mask selector pills show "Found N instances:" for exemplar mode (same as text mode).
- Union All button is available in exemplar mode when >1 instance returned.

## Tests Added

### `tests/python/unit/test_sam3_exemplar.py` — 17 tests
- `TestPredictFromExemplarRefOnly` (5) — processor called with positive label, mask returned, b64 valid PNG, Sam3Model called, tracker not called.
- `TestPredictFromExemplarWithNegBoxes` (4) — neg boxes get label=0, single neg, empty/None neg treated as no-negs.
- `TestPredictFromExemplarErrors` (3) — invalid session raises KeyError, failed provider returns empty masks, post-process exception handled.
- `TestExemplarCapabilities` (2) — `exemplar_prompts: True`, `text_prompts: True` both present.
- `TestSegmentationCommandRouting` (3) — routing to `predict_from_exemplar`, empty neg list default, exemplar takes priority over text.

## Behaviour Changes
- Segmentation canvas now has four modes: Box, Points, Text, Exemplar.
- In Exemplar mode, the first drawn box is the reference (green outline); subsequent draws (with Exclude toggle active) add red exclusion boxes.
- Multi-instance filmstrip (mask selector pills + Union All) works in exemplar mode identically to text mode.
- `exemplar_box` takes routing priority over `text`, `box`, and `points` in `commands/segmentation.predict`.

## Assumptions & Risks
- The SAM 3 PCS exemplar path uses `Sam3Model` with `input_boxes_labels` — this matches the paper's description but depends on the HuggingFace transformers 5.0 dev implementation exposing this API correctly. If the processor routes `input_boxes_labels` differently for mixed positive/negative, the exclusion boxes may not suppress instances as expected. Verify with a real checkpoint.
- `predict_from_exemplar` shares the same `post_process_instance_segmentation` call as `predict_from_box` and `predict_from_text`, so the same threshold parameters apply.
