# Phase 119 — Mask Refinement: Eraser, Brush, Undo/Redo, Zoom/Pan

## Files Created
- `src/types/segmentation.ts` — extracted all segment types (PromptMode, Operation, MaskResult, Capabilities, PointPrompt, LastOp, SegmentState, PredictOverride, INITIAL_STATE) from `useSegmentation.ts`
- `src/hooks/useCreativeCanvas.ts` — extracted canvas refs, draw logic, mouse handlers, zoom/pan from `CreativeToolsPanel.tsx`. Adds zoom-to-cursor (wheel), space+drag pan, middle-button pan, +/-/Fit controls
- `src/hooks/useMaskEditor.ts` — brush state: size (2–80, default 12), mode (paint/erase), toggleBrushMode
- `src/components/MaskEditorOverlay.tsx` — absolutely-positioned canvas overlay for pixel-level mask editing; brush/eraser drawing with RAF throttling, cursor preview circle, stroke-end export
- `aiChangeLog/phase-119-mask-refinement.md` — this file

## Files Modified
- `src/hooks/useSegmentation.ts`
  - Types replaced with imports from `../types/segmentation` (re-exported for backwards compat)
  - Added state fields: `editingMask`, `maskHistory`, `maskFuture`
  - Added actions: `enterEditMask`, `exitEditMask`, `applyMaskEdit`, `undoMask`, `redoMask`
  - Added computed flags: `canUndo`, `canRedo`
  - `predict` now clears `maskHistory` / `maskFuture` on new prediction
- `src/components/canvasHelpers.ts`
  - Added `pan` variant to `DragAction` union
  - Added `computeCanvasTransform(naturalW, naturalH, canvasW, canvasH, userZoom, panX, panY)` pure function
  - Updated `PointPrompt` import to come from `../types/segmentation` directly
- `src/components/CreativeToolsPanel.tsx`
  - Reduced from 829 → ~390 lines (well under 600 hard limit)
  - Canvas logic delegated to `useCreativeCanvas`
  - Brush state delegated to `useMaskEditor`
  - Wired: "✏ Edit Mask" button, mask editing toolbar (brush mode, size slider, Undo/Redo), "Done Editing" button
  - Added zoom +/-/Fit toolbar controls with live % readout
  - Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y shortcuts active only in edit mode

## Tests Added
- `tests/backend/unit/mask-editor.test.ts` — 15 tests
  - `computeCanvasTransform` at zoom=1, zoom=2, with pan
  - `toImageCoords` round-trips at zoom=1, zoom=2, zoom=0.5, with pan
  - Undo/redo pure-state logic: applyMaskEdit, undoMask, redoMask, history cap=20, future clear on new edit, multi-mask isolation

## Behavior Changes
- **Canvas zoom/pan:** Mouse wheel zooms to cursor; Space+drag or middle-button pans; +/-/Fit toolbar buttons; zoom level shown as %
- **Edit Mask mode:** "✏ Edit Mask" button visible when masks exist. Enters a pixel-editing mode where the mask `<img>` overlay is replaced by a drawable canvas. Prompt interactions disabled during edit.
- **Brush/Eraser:** Erase (black paint = remove mask) or Paint (white paint = add mask). Circle cursor preview. RAF-throttled drawing.
- **Undo/Redo stack:** Each completed stroke is pushed to history (max 20). Ctrl+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes. Stack cleared on new prediction.
- **Done Editing:** Exports overlay canvas to base64 PNG, calls `applyMaskEdit` to save to state, exits edit mode. Operations use the refined mask exactly like a predicted mask.

## Assumptions & Risks
- `MaskEditorOverlay` brush-size wheel adjusts a local ref but doesn't call parent `setBrushSize` — the toolbar slider and the overlay wheel can drift. A future fix would route wheel events through a shared callback prop.
- The overlay canvas is sized in CSS to fill the image render area; natural resolution (mask PNG size) is used for `canvas.width/height`. At high zoom the CSS scaling may alias fine strokes — acceptable for v1.
