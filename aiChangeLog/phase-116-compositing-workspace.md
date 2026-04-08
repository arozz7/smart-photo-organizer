# Phase 116 — Creative Compositing Workspace

**Date:** 2026-04-01
**Phase:** 116

---

## Summary

Implemented a dedicated Creative Compositing Workspace that allows users to build layered, Z-ordered compositions from segments extracted in Creative Tools (or photos chosen from Library). The compositor uses PIL `alpha_composite` for pixel-perfect transparency handling.

---

## Files Created

| File | Description |
|------|-------------|
| `src/python/commands/composite.py` | Python IPC command handler — dispatches `compose` type to `compose_layers` |
| `electron/ipc/compositeHandlers.ts` | Electron IPC handler for `ai:compose:layers` channel |
| `src/types/compositor.ts` | Shared TypeScript types: `LayerSpec`, `SendToComposePayload`, `CompositorState` |
| `src/hooks/useCompositor.ts` | State hook: layer CRUD, z-ordering, 200 ms debounced IPC call, `addFromCreativeTools` |
| `src/views/Compose.tsx` | Main compositor view: canvas preview (65%) + layers panel (35%) |
| `src/components/LayerRow.tsx` | Sortable dnd-kit layer row: visibility, name editing, opacity, z-order buttons, delete |
| `tests/backend/unit/composite-handler.test.ts` | 5 unit tests for the `ai:compose:layers` IPC handler |
| `tests/python/unit/test_compose_layers.py` | 7 unit tests for `compose_layers` Python function |

---

## Files Modified

| File | Change |
|------|--------|
| `src/python/facelib/segmentation_ops.py` | Added `compose_layers(layers, width, height) -> str` |
| `src/python/main.py` | Registered `compose` command in the router (Phase 116 block) |
| `electron/main.ts` | Imported and registered `registerCompositeHandlers()` |
| `src/components/CreativeOperationsBar.tsx` | Added `onSendToCompose?` prop and "Send to Compose ↗" in dropdown |
| `src/components/CreativeToolsPanel.tsx` | Added `handleSendToCompose` — encodes image, navigates to `/compose` with navigation state |
| `src/App.tsx` | Added `<Route path="compose" element={<Compose />} />` |
| `src/components/Layout.tsx` | Added **Compose** sidebar nav link (icon: `ShadowIcon`) below Create |

---

## Architecture Decisions

- **Layer model**: `{ id, name, sourceImageB64, maskB64, x, y, scaleX, scaleY, rotation, opacity, zIndex, visible }` — all transform in one place.
- **Compositing order**: `zIndex` ascending → z=0 is background (rendered first, lowest layer). Background layer delete is locked.
- **Image capping**: Source images are resized to max 2048px longest side before base64 encoding to keep IPC payloads manageable.
- **Debouncing**: Layer changes trigger `flattenLayers()` after 200 ms of silence to avoid hammering Python on every slider tick.
- **"Add from Library"**: Adds the full photo as an un-masked layer. Masked layers come in via "Send to Compose" from Creative Tools.
- **Icon**: Used `ShadowIcon` from `@radix-ui/react-icons` (no `LayersIcon` available in the installed version).

---

## Test Results

```
✓ tests/backend/unit/composite-handler.test.ts  — 5 tests passed
✓ tests/python/unit/test_compose_layers.py      — 7 tests passed
```

---

## Risks & Assumptions

- Large canvases (4K multi-layer) may have latency — the 200 ms debounce mitigates but doesn't eliminate this.
- `@dnd-kit/modifiers` is not installed — vertical-axis drag restriction was removed; drag works freely.
- `Compose.tsx` consumes `useLocation` navigation state on mount to auto-add the incoming segment as the first layer — the full "Send to Compose" round-trip is functional.
