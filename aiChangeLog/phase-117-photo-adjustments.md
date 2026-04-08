# Phase 117 — Photo Adjustments

**Date:** 2026-04-07
**Phase:** 117

---

## Summary

Adds non-destructive photo adjustment controls — White Balance, Levels (Black/White Point), Brightness, Contrast, Shadows, and Highlights — applicable globally or scoped to the active segmentation mask. No new models required; pure PIL + numpy. Adjustments are surfaced in a collapsible panel in Creative Tools and as a dedicated tab in the Compositing Workspace (Phase 116 integration point).

---

## Files Created

| File | Description |
|------|-------------|
| `src/types/adjustments.ts` | Shared types: `AdjustmentParams`, `AdjustmentScope`, `DEFAULT_ADJUSTMENT_PARAMS`, `toSnakeAdjustParams()` |
| `electron/ipc/adjustmentHandlers.ts` | Electron IPC handler for `ai:segment:adjust` — Zod-validated, forwards to Python `segment_adjust` command |
| `src/components/AdjustmentsPanel.tsx` | Collapsible UI panel with 7 labeled sliders, per-control Reset, scope selector, Apply/Reset All buttons |
| `tests/python/unit/test_adjustments.py` | 35 unit tests for `apply_adjustments` — per-adjustment isolation, pipeline order, scope compositing |
| `tests/python/unit/test_adjustment_dispatch.py` | 13 unit tests for `apply_adjustments_command` dispatch (validation, mask decoding, invert, error paths) |
| `tests/backend/unit/adjustment-handler.test.ts` | 11 unit tests for `ai:segment:adjust` IPC handler |
| `aiChangeLog/phase-117-photo-adjustments.md` | This file |

---

## Files Modified

| File | Change |
|------|--------|
| `src/python/facelib/segmentation_ops.py` | Added `apply_adjustments(image, params, mask?)` — 6-step pipeline: WB → levels → brightness → contrast → shadows → highlights; scope compositing via alpha blend |
| `src/python/commands/segmentation.py` | Added `apply_adjustments_command(payload, req_id)` — validates, decodes image+mask, calls `apply_adjustments`, returns `result_b64` |
| `src/python/main.py` | Registered `segment_adjust` command route |
| `electron/main.ts` | Imported and registered `registerAdjustmentHandlers()` |
| `src/hooks/useSegmentation.ts` | Added `'adjust'` to `Operation` union; re-exported `AdjustmentParams`/`AdjustmentScope`/`toSnakeAdjustParams`; added `applyAdjustments(imageB64, params, scope)` callback |
| `src/components/CreativeToolsPanel.tsx` | Added `AdjustmentsPanel` below `CreativeOperationsBar`; `useEffect` encodes source image to base64 when `imagePath` changes; `adjustScope` state |
| `src/components/LayerRow.tsx` | Added optional `isActive` + `onSelect` props; active layer highlighted with indigo border |
| `src/views/Compose.tsx` | Right panel converted to 2-tab (Layers / Adjustments); active layer tracking via `activeLayerId` state; `handleApplyAdjustments` callback updates `sourceImageB64` on the layer (triggers `useCompositor` re-composite) |
| `package.json` / `package-lock.json` | Added `zod ^3.23.0` dependency |

---

## Architecture Decisions

- **Stateless image encoding (`image_b64` not `session_id`):** Adjustments use the raw image bytes rather than a SAM session reference. This makes the command work identically from Creative Tools (where a session may be active) and from the Compositing Workspace (where no SAM session exists). The caller encodes the image before sending.
- **Fixed pipeline order (WB → levels → brightness → contrast → shadows → highlights):** Prevents compounding artefacts. Applying levels before brightness ensures the remapped range is not further distorted.
- **Shadow/Highlight curves:** Simple piecewise gain on pixels < 128 (shadows) or > 128 (highlights). Avoids LUT complexity while meeting the spec.
- **Scope compositing:** Uses existing `_alpha3`/`_to_alpha` helpers to alpha-blend the adjusted image over the original. A full mask (all 1s) produces identical output to global scope.
- **Zod in IPC handler:** Added `zod` as a project dependency. Handler validates all fields including nested `params` dict — unknown params are stripped, missing fields use defaults.
- **`AdjustmentsPanel` as a separate component:** Kept `CreativeOperationsBar.tsx` and `CreativeToolsPanel.tsx` from growing. The panel is fully self-contained with its own slider state and calls back via `onApply`.
- **Compose.tsx Phase 116 integration:** `handleApplyAdjustments` calls `window.ipcRenderer.invoke('ai:segment:adjust', ...)` directly (no hook indirection) and updates `sourceImageB64` on the target layer. This naturally triggers `useCompositor`'s 200ms debounced `flattenLayers()` re-composite with no changes to `useCompositor.ts`.

---

## Test Results

```
✓ tests/python/unit/test_adjustments.py          — 35 tests passed
✓ tests/python/unit/test_adjustment_dispatch.py  — 13 tests passed
✓ tests/backend/unit/adjustment-handler.test.ts  — 11 tests passed
✓ Build clean (vite build) — no TS errors
✓ No regressions in existing test suite
```

---

## Risks & Assumptions

- `CreativeToolsPanel.tsx` was already over the 600-line hard limit before Phase 117. The additions (~40 lines for import, state, effect, JSX) are minimal. A full decomposition of `CreativeToolsPanel` is deferred to a dedicated cleanup sprint.
- The shadow/highlight tone curves use a simple threshold at pixel value 128. This is a linear approximation — a proper gamma curve would be more precise but is out of scope for this phase.
- Large images (near 2048px cap) + segment scope trigger two image decodes in the Python handler (source + mask). Performance is acceptable for interactive use.
