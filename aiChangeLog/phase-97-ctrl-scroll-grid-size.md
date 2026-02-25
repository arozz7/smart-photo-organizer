# Phase 97 — Ctrl+Scroll Grid Size Control

**Branch:** `feature/v0.7.0-prs-integration`
**Date:** 2026-02-23

---

## Summary

Replaced all hardcoded Tailwind `grid-cols-*` responsive classes in face and photo grid views with a user-controlled dynamic grid system. Users can now Ctrl+scroll over any grid to increase or decrease thumbnail density in real time. Each view remembers its own column count across sessions via localStorage.

---

## New Files

| File | Purpose |
|------|---------|
| `src/hooks/useCtrlScroll.ts` | Low-level hook: attaches Ctrl+wheel listener to a div ref with 80ms debounce and `capture:true` to intercept VirtuosoGrid's own scroll handler |
| `src/hooks/useDynamicGrid.ts` | Composes `useCtrlScroll` + localStorage + toast. Returns `{ cols, containerRef, gridStyle }`. Column range: 4–12; persisted under `spo:grid:<key>` |
| `src/hooks/useFlexZoom.ts` | Pixel-based variant for Library/Search flex-wrap grids (80–300px, 20px step). `itemStyle` is memoized to avoid VirtuosoGrid GridItem re-renders |
| `src/hooks/usePeopleGridSize.ts` | Wrapper for `People.tsx` — calls `useDynamicGrid` four times with independent storage keys (singles, ignored, background, ungroupable) |
| `src/context/GridSizeContext.tsx` | Lightweight context for propagating a parent view's grid size to deeply nested children without prop-drilling |

---

## Modified Files

### Face Modal Virtualized Grids (VirtuosoGrid)

| File | Change |
|------|--------|
| `src/components/AllFacesModal.tsx` | Added `useDynamicGrid({ storageKey: 'allFaces', default: 8 })`. Updated `gridComponents` useMemo to use `gridStyle` in List; added `containerRef` to content wrapper |
| `src/components/OutlierReviewModal.tsx` | Moved module-level `GridList` inside component as `useMemo`. Added `useDynamicGrid({ storageKey: 'outlierReview', default: 8 })`. Added `containerRef` to content wrapper |
| `src/components/BlurryFacesModal.tsx` | Removed module-level `BlurryGridList`. Added `useDynamicGrid({ storageKey: 'blurryFaces', default: 8 })`. Inlined List forwardRef in `gridComponents` useMemo |

### People Views

| File | Change |
|------|--------|
| `src/views/People.tsx` | Added `usePeopleGridSize()`. Replaced 4 hardcoded `grid grid-cols-*` classNames with `containerRef` + `gridStyle` per sub-view |

### Face Detail / Cluster Components

| File | Change |
|------|--------|
| `src/components/ClusterRow.tsx` | Added `useDynamicGrid({ storageKey: 'clusterRow', default: 8 })`. Replaced `p-3 grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2` with `ref` + `style` |
| `src/components/FaceGrid.tsx` | Added `useDynamicGrid({ storageKey: 'faceGrid', default: 6 })`. Replaced responsive `grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8` class with `style` |
| `src/components/GroupNamingModal.tsx` | Added `useDynamicGrid({ storageKey: 'groupNaming', default: 5, max: 10 })`. `containerRef` on scroll wrapper, `gridStyle` on inner grid |
| `src/views/PersonDetail.tsx` | Added `useDynamicGrid({ storageKey: 'personDetail', default: 6 })`. `containerRef` on outer scroll wrapper, `gridStyle` on inner grid |

### Photo Grids (Library / Search)

| File | Change |
|------|--------|
| `src/views/Library.tsx` | Added `useFlexZoom({ storageKey: 'library', default: 150 })`. `GridItem` useMemo now uses `itemStyle` in deps and spreads it into each item's style |
| `src/views/Search.tsx` | Added `useFlexZoom({ storageKey: 'search', default: 150 })`. Same pattern as Library |

---

## Tests Added

| File | Tests |
|------|-------|
| `tests/frontend/unit/hooks/useCtrlScroll.test.tsx` | 6 tests — zoom in/out, no-fire without Ctrl, debounce (ignore within window, allow after cooldown), deltaY=0 guard |
| `tests/frontend/unit/hooks/useCtrlScroll.test.ts` | 6 tests — same cases via `renderHook` + manual ref attachment |
| `tests/frontend/unit/hooks/useDynamicGrid.test.ts` | 11 tests — default init, localStorage restore, NaN fallback, GRID_MIN/MAX clamp, custom min/max, containerRef shape, gridStyle content, independent storage keys |
| `tests/frontend/unit/contexts/GridSizeContext.test.tsx` | 5 tests — cols value, gridStyle value, different cols, throws outside provider, nested provider wins nearest ancestor |

**Total: 28 new tests — all passing.**

---

## Key Technical Decisions

### `capture: true` for VirtuosoGrid
VirtuosoGrid installs its own wheel listener that consumes scroll events. `useCtrlScroll` uses `{ capture: true, passive: false }` so the Ctrl+scroll event is intercepted at the capture phase (before VirtuosoGrid sees it) and `preventDefault()` is called to stop page scroll.

### Inline styles over dynamic Tailwind classes
Dynamic Tailwind class names like `grid-cols-${cols}` are purged at build time if not statically present. Using `style={{ gridTemplateColumns: \`repeat(${cols}, minmax(0, 1fr))\` }}` is reliable and avoids JIT/purge configuration changes.

### `useMemo` for `gridComponents` in Virtuoso modals
VirtuosoGrid's `List` component must be stable across renders to avoid remounting all items. `gridStyle` is itself memoized (only changes when `cols` changes), so including it in `gridComponents` useMemo deps is efficient: the List only remounts when the user actually changes column count.

### `itemStyle` memoized in `useFlexZoom`
Without `useMemo`, `itemStyle` would be a new object reference every render, causing all `GridItem` useMemo callbacks in Library/Search to re-run on every parent render.

### Custom min/max clamp in `useDynamicGrid`
`readStorage()` applies global `GRID_MIN=4` / `GRID_MAX=12` clamps. A second clamp in the `useState` initializer (`Math.min(max, Math.max(min, stored))`) applies per-call custom limits on top — needed for `GroupNamingModal` which uses `max: 10`.

### happy-dom `WheelEvent.ctrlKey` workaround
happy-dom does not apply `init dict` properties like `ctrlKey` when constructing a `WheelEvent`. Tests use `Object.defineProperty(event, 'ctrlKey', { value: ctrlKey, configurable: true })` before dispatching.

---

## Behavior Changes

- All face-grid views now support Ctrl+scroll to resize thumbnails (range: 4–12 columns)
- Library and Search photo grids support Ctrl+scroll to resize items (range: 80–300px)
- A 1-second `info` toast ("Grid: N columns") appears on every column change
- Each view persists its own column count in localStorage under `spo:grid:<key>` or `spo:flex:<key>`
- Responsive breakpoint classes (`grid-cols-6 sm:grid-cols-8 md:grid-cols-10`) removed — column count is now fully user-controlled

---

## Assumptions & Risks

- **VirtuosoGrid remount cost:** Each `cols` change recreates the memoized `List` component, causing VirtuosoGrid to remount all visible items. This is a one-time cost per user gesture and is acceptable.
- **Library/Search flex-wrap layout:** `useFlexZoom` controls item width/height; the flex container continues to wrap naturally. No VirtuosoGrid remount cost here.
- **ClusterRow shared storage key:** All `ClusterRow` instances on the People page share `storageKey: 'clusterRow'`, so resizing any cluster affects all others. This is intentional (consistent density).
- **`.ts` test file redundancy:** `useCtrlScroll.test.ts` and `useCtrlScroll.test.tsx` cover identical cases. The `.ts` version uses manual ref injection via `renderHook`; the `.tsx` version uses a proper `HookHarness` component. Both pass. The `.ts` version can be deleted in a future cleanup pass.
