# Phase 112 — SAM 3 Text Prompts & PCS Mode

## Summary
Activated SAM 3's Promptable Concept Segmentation (PCS) mode — text-based
segmentation that finds all matching instances in an image (e.g. "person" returns
one mask per person).  The `predict_from_text` method was previously a stub that
returned empty results; it now makes a real model call.

---

## Files Modified

### `src/python/facelib/sam3_provider.py`
- **`predict_from_text(session_id, text, threshold, mask_threshold)`** — replaced
  stub with real PCS call: `Sam3Processor(images, text=text)` → `Sam3Model` →
  `post_process_instance_segmentation`.  Returns `{masks: [{mask_b64, score, area}]}`.
- **`predict_from_text_with_exclusions(session_id, text, neg_boxes, threshold, mask_threshold)`** — new method: same as above but passes `input_boxes=[neg_boxes]` with
  `input_boxes_labels=[[0]*n]` to exclude regions from matching.
- **`get_capabilities()`** — changed `text_prompts: False → True`.

### `src/python/commands/segmentation.py`
- **`predict()`** — extracts `text_threshold` (default 0.5), `mask_threshold` (default 0.5), `exclusion_boxes` from IPC payload.  Routes text path to `predict_from_text_with_exclusions` when `exclusion_boxes` present, otherwise to `predict_from_text`.

### `src/hooks/useSegmentation.ts`
- Added `textThreshold: number` (default 0.5) and `maskThreshold: number` (default 0.5) to `SegmentState` and `INITIAL_STATE`.
- Added `textThresholdRef` / `maskThresholdRef` kept in sync after every render.
- Added `setTextThreshold` and `setMaskThreshold` actions.
- **`predict()`** text path now includes `text_threshold` and `mask_threshold` in the IPC payload.
- Added **`unionAllMasks()`** — canvas-based pixel-level OR of all current masks using `lighten` composite; collapses N masks into one unified mask.
- Exported `loadMaskImage` helper (module-level, used by `unionAllMasks`).

### `src/components/CreativeToolsPanel.tsx`
- **Text mode tooltip** — updated from "not available with SAM 3" to descriptive prompt hint.
- **Destructure** — added `setText`, `setTextThreshold`, `setMaskThreshold`, `unionAllMasks` from hook.
- **Text input row** — new panel visible when `promptMode === 'text'`: text input with placeholder "person on the left · red umbrella · dog", Enter key triggers predict, Segment button.
- **Confidence sliders** — two sliders in the text panel: Confidence (`textThreshold`) and Mask quality (`maskThreshold`), range 0.1–0.9.
- **Mask selector pills** — enhanced: shows "Found N instances:" label in text mode; adds "Union All" button (calls `unionAllMasks`) in text mode when `masks.length > 1`.
- Removed the stale yellow "Text prompts require a text-to-box model" warning.

## Files Created

### `tests/python/unit/test_sam3_text_prompts.py`
13 unit tests covering:
- `get_capabilities` returns `text_prompts: True`
- `predict_from_text`: processor called with `text=` kwarg; masks returned; thresholds forwarded; error handling; unknown session
- `predict_from_text_with_exclusions`: neg_boxes passed with `input_boxes_labels=[[0, ...]]`; single box; thresholds forwarded; error handling

---

## Behaviour Changes
- Text mode button in Creative Tools is now enabled (was greyed out).
- Entering a noun phrase and pressing Enter / clicking Segment runs PCS segmentation.
- Multiple instance masks are shown as numbered pills with "Found N instances:" label.
- "Union All" button merges all instance masks into one for single-operation workflows.
- Threshold sliders allow tuning match confidence and mask quality without re-running.

## Tests
- 13 new Python unit tests — all passing (`pytest tests/python/unit/test_sam3_text_prompts.py`)
- Full TypeScript suite: 343 passing (3 pre-existing Electron `app`-import failures unchanged)

## Assumptions & Risks
- **SAM 3 text encoder limit:** The paper documents a 32-token limit. Long descriptions
  are silently truncated by the tokenizer — no special handling added; short noun phrases
  are recommended in the UI placeholder.
- **PCS vs PVS:** Text mode always uses `Sam3Model` (PCS). If the model checkpoint does
  not include the text encoder weights, inference will fail at runtime and surface as an
  error mask result.  The UI shows the error banner in that case.
- **`unionAllMasks` area approximation:** The merged mask's `area` is the sum of
  component areas (may overcount overlapping pixels).
