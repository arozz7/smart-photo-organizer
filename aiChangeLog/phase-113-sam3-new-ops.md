# Phase 113 — SAM 3 New Operations

## Summary
Added three new PIL-only creative operations (Pixelate BG, Spotlight, Color Tint)
and a global Invert Selection toggle that flips which side of the mask receives
every operation. No model changes; all effects are pure Python / numpy.

---

## Files Modified

### `src/python/facelib/segmentation_ops.py`
- Added `from PIL import ImageEnhance` import.
- **`apply_pixelate_background(image, mask, pixel_size=12)`** — resizes the full image down by `pixel_size` then back up with `NEAREST` interpolation to create a mosaic; composites subject from original on top.
- **`apply_spotlight(image, mask, brightness=0.35)`** — uses `ImageEnhance.Brightness` to darken the background region; subject pixels are taken from the original unchanged. Brightness clamped to [0, 1].
- **`apply_color_tint(image, mask, color=(255,165,0), opacity=0.5)`** — blends original background with a solid tint color at `opacity` via linear interpolation; subject unchanged. Opacity clamped to [0, 1].

### `src/python/commands/segmentation.py`
- **`apply_operation()`** — extended docstring and payload parsing:
  - New params: `invert_mask` (bool), `pixel_size` (int), `brightness` (float), `tint_opacity` (float).
  - After `feather_mask`: `if invert_mask: alpha = 1.0 - alpha` — runs before every operation, enabling all ops to target the subject instead of background.
  - Added dispatch cases: `pixelate-bg`, `spotlight`, `color-tint`.
  - Imports for new ops added to the local import block.

### `electron/ipc/aiHandlers.ts`
- `ai:segment:apply` payload type extended with all new fields: `invert_mask`, `feather_radius`, `pixel_size`, `brightness`, `tint_opacity`, updated `operation` union to include `desaturate-bg | fill-bg | pixelate-bg | spotlight | color-tint`.

### `src/hooks/useSegmentation.ts`
- **`Operation` type** — extended with `'pixelate-bg' | 'spotlight' | 'color-tint'`.
- **`LastOp.extra`** — extended with `pixelSize`, `spotlightBrightness`, `tintOpacity` fields.
- **`SegmentState`** — added `invertSelection: boolean` (default `false`).
- Added `invertSelectionRef` kept in sync every render.
- **`setInvertSelection(v)`** — new setter action.
- **`applyOperation()`** — always sends `invert_mask: invertSelectionRef.current`; forwards `pixel_size`, `brightness`, `tint_opacity` from params; captures them in `lastOp.extra` for feather re-apply.
- Added **invert-toggle re-apply effect** — instant (no debounce) re-apply of `lastOp` when `invertSelection` changes, so the result updates immediately on toggle.
- `setInvertSelection` added to hook return value.

### `src/components/CreativeOperationsBar.tsx`
- **Props** — added `invertSelection: boolean`, `onInvertChange`, extended `onApply` params signature.
- **Local state** — added `pixelSize` (12), `spotlightBrightness` (0.35), `tintColor` ('#ff9900'), `tintOpacity` (0.5).
- **Global modifiers row** — feather slider + Invert Selection checkbox in one row. Checkbox turns indigo when active; inline label reads "(ops apply to subject)" when inverted.
- **New operation controls:**
  - Pixelate BG button + pixel_size slider (range 4–40, step 2).
  - Spotlight button + brightness slider (range 0–1, step 0.05).
  - Color Tint: color swatch + button + opacity slider (range 0–1, step 0.05, shown as %).
- All buttons pass their local slider values to `apply()` as named params.

### `src/components/CreativeToolsPanel.tsx`
- Added `setInvertSelection` to hook destructure.
- Passes `invertSelection={state.invertSelection}` and `onInvertChange={setInvertSelection}` to `CreativeOperationsBar`.

---

## Files Created

### `tests/python/unit/test_sam3_new_ops.py`
16 unit tests covering:
- `apply_pixelate_background`: size, subject unchanged, background differs, pixel_size clamped, RGB output.
- `apply_spotlight`: size, subject unchanged, background darkened, brightness=1 is noop, out-of-range clamped.
- `apply_color_tint`: size, subject unchanged, opacity=0 noop, opacity=1 exact tint, RGB output.
- Invert mask: `1 - alpha` correctly swaps subject/background roles.

---

## Behaviour Changes
- **Pixelate BG** — new button in ops bar with block-size slider (4–40 px).
- **Spotlight** — new button with background brightness slider (0.0–1.0).
- **Color Tint** — new button with color swatch + opacity slider.
- **Invert Selection** — checkbox above the operations row. When checked, all operations (existing and new) apply to the **subject** instead of the background. Toggle instantly re-applies the last operation.
- **Auto-reapply on invert** — toggling Invert Selection immediately re-runs the last operation without re-clicking.

## Tests
- 16 new Python unit tests — all passing.
- Full TS suite: 343 passing (3 pre-existing Electron `app`-import failures unchanged).

## Assumptions & Risks
- `invert_mask` applies after feathering, so feathered edges are also inverted correctly.
- Spotlight uses `ImageEnhance.Brightness` which operates on the whole image then composites — this means the subject region is re-composited from the original (no brightness artefacts on subject edges).
- Color Tint and Fill BG both use the `color` payload field — they are separate operations and do not conflict.
