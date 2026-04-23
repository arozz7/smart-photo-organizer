# Phase 118 — Per-Layer Transform (Resize & Rotate)

## Summary
Adds interactive transform handles (resize, rotate, move, flip) directly on the
Compose view canvas for the active layer. The `LayerSpec` already carried
`x/y/scaleX/scaleY/rotation` from Phase 116, and Python's `compose_layers` already
applied them — this phase is entirely a UI addition.

## Files Created
- `src/components/TransformBox.tsx` — SVG overlay with 8 scale handles, rotation
  grip, move drag, flip mini-toolbar, and numeric HUD (W×H + rotation angle).
- `tests/backend/unit/compositor-transform.test.ts` — 17 unit tests covering
  `rotatePoint`, `snapAngle`, and `computeHandles` geometry helpers.

## Files Modified
- `src/types/compositor.ts`
  - Added `LayerTransform { x, y, scaleX, scaleY, rotation }` interface
  - Extended `LayerSpec` with `sourceWidth: number` and `sourceHeight: number`
  - Extended `SendToComposePayload` with optional `sourceWidth?` / `sourceHeight?`
- `src/hooks/useCompositor.ts`
  - Added `updateLayerTransform(id, transform)` (thin wrapper around `updateLayer`)
  - Added `sourceWidth/sourceHeight` to `addFromCreativeTools` spec
- `src/views/Compose.tsx`
  - Imports `TransformBox` and `LayerTransform`
  - Destructures `updateLayerTransform` from hook
  - Passes `sourceWidth/sourceHeight` into `addLayer` (from `encodeImageFile`)
  - Wraps composition `<img>` in a `<div className="relative">` with `TransformBox`
    overlay rendered when `activeLayerId` is set

## Behavior Changes
- Selecting a layer in the Layers tab now shows transform handles on the
  composition preview. Drag handles to resize; drag inside the box to move; drag
  the circular grip above the top-center to rotate (Shift snaps to 15°).
- Flip H / Flip V buttons appear in a mini-toolbar above the selected layer.
- A numeric HUD below the box shows W × H and rotation angle as editable inputs.

## Tests Added
- 17 TypeScript unit tests (`compositor-transform.test.ts`) — all green
  - `rotatePoint`: identity, 90° CW, 180° around custom centroid
  - `snapAngle`: rounding at thresholds, negative angles
  - `computeHandles`: centroid, corners, scale, 90° rotation, negative scale (flip)

## Assumptions & Risks
- `sourceWidth/sourceHeight` default to `0` for layers added via `addFromCreativeTools`
  without explicit dims (e.g., sent from Creative Tools before this phase). The
  TransformBox will not render meaningful handles for such layers; this is acceptable
  until Creative Tools propagates dims in its "Send to Compose" payload.
- The SVG overlay uses `foreignObject` for the flip toolbar and HUD inputs. This
  renders correctly in Chromium (Electron) but is known to have quirks in some
  browsers — acceptable for this Electron-only app.
- `TransformBox.tsx` is 280 lines — within the 300-line soft limit.
