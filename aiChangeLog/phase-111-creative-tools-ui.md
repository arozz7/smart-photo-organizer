# Phase 111 — Creative Tools UI

## Overview
Implemented the React frontend for the SAM 3 Creative Tools segmentation pipeline (Phase 110 backend). Added an interactive canvas-based UI for photo segmentation, mask editing, and AI-powered operations.

## Files Created
- `src/hooks/useSegmentation.ts` — Full state management hook for the Creative Tools UI
  - `SegmentState`, `MaskResult`, `Capabilities`, `PointPrompt` interfaces
  - `sessionRef` pattern to avoid stale closures in async callbacks
  - `predict()` reads latest state via functional updater (avoids closure bugs)
  - Functions: `checkCapabilities`, `openImageDialog`, `setPromptMode`, `setText`, `addPoint`, `setBox`, `clearPrompts`, `setSelectedMaskIdx`, `predict`, `applyOperation`, `reset`
- `src/components/CreativeToolsPanel.tsx` — Interactive canvas-based Creative Tools panel
  - 680×480 canvas renders image + box + point overlays
  - Positioned `<img>` overlay for mask tint (indigo filter via CSS)
  - Result preview panel with checkerboard transparency background
  - Three prompt modes: **Text** (input + Segment button), **Box** (drag-to-draw), **Points** (click + Shift+click)
  - Operations bar: Remove BG, Isolate, Blur (with radius slider), Sharpen, Download
  - Mask selector pills when multiple masks returned
  - Loading overlay states (loading image / segmenting / applying)
  - Model-not-ready warning banner

## Files Modified
- `src/views/Tools.tsx`
  - Added `'creative-tools'` to the `Tool` type
  - Added Creative Tools entry to `TOOLS` array
  - Added `CreativeToolsPanel` render branch
- `src/python/facelib/segmentation_ops.py` *(Phase 110/111 boundary)*
  - Extracted shared helpers: `decode_mask`, `encode_image`, `apply_background_remove`, `apply_isolate`, `apply_blur`, `apply_enhance`
  - Imported by both `api/routes/segment.py` and `commands/segmentation.py`
- `src/python/commands/segmentation.py` *(Phase 111)*
  - `get_capabilities`, `set_image`, `predict`, `apply_operation` IPC command handlers
  - Module-level singleton provider via `_get_provider()`
- `src/python/main.py` *(Phase 111)*
  - Added `segment_capabilities`, `segment_set_image`, `segment_predict`, `segment_apply` dispatch branches
- `electron/ipc/aiHandlers.ts` *(Phase 111)*
  - Added 4 IPC handlers: `ai:segment:capabilities`, `ai:segment:setImage`, `ai:segment:predict`, `ai:segment:apply`

## Architecture Notes
- **Canvas coordinate conversion**: `toImageCoords()` converts canvas-space mouse events to image-space coordinates using the stored `CanvasTransform` (scale + offset from fit-in-canvas calculation)
- **Mask overlay**: Rendered as a positioned `<img>` tag on top of the canvas (not drawn on canvas) to avoid async `Image.onload` draw race conditions. CSS `filter: sepia(1) saturate(10) hue-rotate(220deg)` colorizes the grayscale mask to indigo.
- **Result preview**: Checkerboard background via `repeating-conic-gradient` to visualize transparency in background-remove/isolate results
- **Box drag**: `dragStartRef` tracks mousedown start; live box (`liveBox` state) previewed on canvas during drag; committed via `setBox` + auto-`predict` on mouseup
- **Points auto-predict**: Each point click immediately calls `predict()` with updated points list

## IPC Channels Added
| Channel | Direction | Purpose |
|---|---|---|
| `ai:segment:capabilities` | Renderer→Main→Python | Model readiness + feature flags |
| `ai:segment:setImage` | Renderer→Main→Python | Load image, get session_id |
| `ai:segment:predict` | Renderer→Main→Python | Run segmentation (text/box/points) |
| `ai:segment:apply` | Renderer→Main→Python | Apply operation to mask |

## Canvas Prompt Editing (Phase 111 continuation)

### Files Added
- `src/components/canvasHelpers.ts` — Pure geometry helpers (no React deps)
  - `CanvasTransform`, `BoxHandle`, `DragAction` types
  - `toImageCoords`, `isInsideImage`, `getBoxHandlePositions`, `hitTestHandle`, `hitTestPoint`, `isInsideBox`, `applyResizeHandle`, `getCursorForHandle`
- `src/components/CreativeOperationsBar.tsx` — Extracted operations bar (Remove BG, Isolate, Blur slider, Sharpen, Save)

### Files Modified
- `src/components/CreativeToolsPanel.tsx` — Full canvas editing + responsive layout
  - **Box mode editing**: 8 resize handles (squares drawn on canvas); mousedown-on-handle → resize drag; mousedown-inside → move drag; `Delete` key clears box. Re-predicts on mouseup.
  - **Points mode editing**: mousedown within 10px of existing point → drag to move (visual tracks cursor); click within 10px → delete; click elsewhere → add. Re-predicts on commit.
  - **Combined Box+Points mode**: switching Box→Points preserves the box; both sent simultaneously to backend via `predict_from_box_and_points`. Hint text in toolbar shows combined mode is active.
  - **Responsive layout**: Canvas container uses `flex-[3]` (65%), result panel uses `flex-[2]` (35%) with `min-w-[180px]`. Canvas element uses `maxWidth/maxHeight: 100%` to fill container without distortion (intrinsic aspect ratio preserved). Mask overlay positioned as percentages of canvas element size so it tracks correctly at any CSS scale. Minimum panel width `min-w-[680px]` prevents collapse.
  - **Drag state machine**: `DragAction` discriminated union (`draw-box`, `move-box`, `resize-box`, `move-point`, `none`). `stateRef` mirrors state for handlers. `redrawCanvasRef` ref allows handlers to call latest redrawCanvas without listing it as a dep.
  - **Cursor management**: CSS cursor changes dynamically (`crosshair`, `move`, resize cursors, `pointer`, `cell`).
  - Mouse leave cancels active drag to prevent stuck state.
- `src/hooks/useSegmentation.ts`
  - `setPromptMode`: preserves box when switching Box→Points (for combined mode); guards same-mode no-op
  - Added `removePoint(index)` and `movePoint(index, pt)` helpers
  - `predict()` dispatch updated: when both `box` and `points` are present, sends combined payload; removed mode-gating on box/points routing
- `src/python/facelib/sam3_provider.py`
  - Added `predict_from_box_and_points()` — runs Sam3Model with both `input_boxes` and `input_points`/`input_labels`; falls back to box-only if combined call fails
- `src/python/commands/segmentation.py`
  - `predict()` dispatcher: new branch when both `box` and `points`+`point_labels` present → calls `predict_from_box_and_points()`

## Risks / Assumptions
- SAM 3 text prompting requires `text_prompts: true` in capabilities — UI hides text mode gracefully when not available (no guard added; backend returns error which surfaces in error banner)
- `file://` prefix used for canvas image src — works in Electron renderer; would need adjustment for web-only builds
- No undo/redo history — each `clearPrompts` or mode switch resets the session state
