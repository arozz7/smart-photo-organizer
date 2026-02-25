# Ctrl+Scroll Grid Size Control — Implementation Plan

## Overview

Add the ability to dynamically adjust grid density using Ctrl+scroll wheel across all pages and modals that display thumbnail grids. Each view persists its own column preference in localStorage.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Column range** | `min: 4`, `max: 12` | 4 = large thumbnails, 12 = dense review |
| **Persistence** | localStorage per view | Simple, no backend changes |
| **Scope** | Per-view (keyed by `viewId`) | Users want different densities per context |
| **Visual feedback** | Lightweight toast "Grid: X columns" | Non-intrusive, auto-dismiss ~1s |
| **Default columns** | Match current responsive breakpoint | No UX regression on first load |

---

## Grid Layout Inventory

### Type A: CSS Grid (face thumbnails — column count control)

These use Tailwind `grid grid-cols-N` classes. Ctrl+Scroll changes the column count.

| Component | File | Current Columns | viewId |
|-----------|------|-----------------|--------|
| AllFacesModal | `src/components/AllFacesModal.tsx` (318L, grid@L148) | 3→4→6→8→10→12→14 (VirtuosoGrid) | `allFaces` |
| OutlierReviewModal | `src/components/OutlierReviewModal.tsx` (428L, grid@L34) | 3→4→6→8→10→12→14 (VirtuosoGrid) | `outlierReview` |
| BlurryFacesModal | `src/components/BlurryFacesModal.tsx` (720L, grid@L28) | 3→4→6→8→10→12→14 (VirtuosoGrid) | `blurryFaces` |
| People: Identified | `src/views/People.tsx` (1326L) | 2→3→4→5→6 (PersonCards) | `peopleIdentified` |
| People: Singles | `src/views/People.tsx` (~L887) | 6→8→10→12 | `peopleSingles` |
| People: Ignored | `src/views/People.tsx` (~L1055) | 4→6→8→10 | `peopleIgnored` |
| People: Background | `src/views/People.tsx` (~L1104) | 4→6→8→10 | `peopleBackground` |
| People: Ungroupable | `src/views/People.tsx` (~L1184) | 6→8→10 | `peopleUngroupable` |
| ClusterRow | `src/components/ClusterRow.tsx` (346L, grid@L271) | 6→8→10 | `clusterRow` |
| FaceGrid | `src/components/FaceGrid.tsx` (148L, grid@L66) | 2→4→6→8 | `faceGrid` |
| GroupNamingModal | `src/components/GroupNamingModal.tsx` (145L, grid@L72) | 4→5→6 | `groupNaming` |
| PersonDetail | `src/views/PersonDetail.tsx` (534L) | TBD — read before Phase 4 | `personDetail` |

### Type B: Flex-Wrap (photo thumbnails — item size control)

These use `display: flex; flex-wrap: wrap` with a fixed item size (150×150px). Ctrl+Scroll changes the item size (120px–250px range).

| Component | File | Current Size | viewId |
|-----------|------|-------------|--------|
| Library | `src/views/Library.tsx` | 150×150px (VirtuosoGrid) | `library` |
| Search | `src/views/Search.tsx` | 150×150px (VirtuosoGrid) | `search` |

---

## File Size Constraints

Per refactoring protocol (600-line hard limit), these files **must not grow**:

| File | Lines | Strategy |
|------|-------|----------|
| `People.tsx` | 1326 | **Hook-only integration** — zero new logic in file |
| `BlurryFacesModal.tsx` | 720 | **Minimal 10-line change** — hook call + style swap |

All new logic goes into dedicated hooks and context files.

---

## New Files

| File | ~Lines | Purpose |
|------|--------|---------|
| `src/context/GridSizeContext.tsx` | ~100 | Provider + `useGridSize(viewId)` hook, localStorage sync |
| `src/hooks/useCtrlScroll.ts` | ~45 | Wheel event listener with ctrlKey detection, debounced |
| `src/hooks/useDynamicGrid.ts` | ~65 | Combines GridSizeContext + useCtrlScroll, returns `gridStyle` |
| `src/hooks/useFlexZoom.ts` | ~50 | Variant for flex-wrap grids (Library/Search), returns `itemSize` |
| `src/components/GridZoomToast.tsx` | ~35 | Floating toast "Grid: X columns" with auto-dismiss |

---

## Phase 1: Core Infrastructure (~5 new files)

**Goal:** Build the reusable hooks/context. No UI changes yet.

### Task 1.1: GridSizeContext
Create `src/context/GridSizeContext.tsx`:
- `GridSizeProvider` wrapping the app
- `useGridSize(viewId: string, defaultColumns: number)` → `{ columns, setColumns, zoomIn, zoomOut }`
- localStorage read/write with key `gridSize:<viewId>`
- Clamp to `[4, 12]` range for face grids (per spec)

### Task 1.2: useCtrlScroll hook
Create `src/hooks/useCtrlScroll.ts`:
- Attach `wheel` event listener to `containerRef`
- Only fires when `event.ctrlKey === true`
- Call `event.preventDefault()` to suppress browser zoom
- Debounce 50ms via `useRef` timer
- Call `onZoomIn`/`onZoomOut` based on `deltaY` sign
- **VirtuosoGrid note:** Use `{ capture: true, passive: false }` on the listener so it intercepts before VirtuosoGrid's own scroll handler. The `containerRef` must be on the **outer wrapper div**, not on `<VirtuosoGrid>` itself.

### Task 1.3: useDynamicGrid hook
Create `src/hooks/useDynamicGrid.ts`:
- Combines `useGridSize` + `useCtrlScroll`
- Returns `{ columns, gridStyle, gridClassName }` for Type A grids
- `gridStyle` = `{ gridTemplateColumns: repeat(${columns}, minmax(0, 1fr)) }`
- `gridClassName` = `'grid gap-2'` (or `gap-4` variant)

### Task 1.4: useFlexZoom hook
Create `src/hooks/useFlexZoom.ts`:
- For Type B (Library/Search) flex-wrap grids
- Stores item size (pixels) instead of column count
- `useGridSize` under the hood with range `[80, 300]`, step ±20px
- Returns `{ itemSize, itemStyle: { width, height } }`

### Task 1.5: GridZoomToast component
Create `src/components/GridZoomToast.tsx`:
- Renders a small floating badge in bottom-right of container
- Shows "Grid: X columns" or "Size: Npx"
- Auto-fades after 800ms
- Uses `position: absolute` within the grid container (no portal needed)

### Task 1.6: Wire Provider
Add `<GridSizeProvider>` to `App.tsx` (wrap at app root).

### Tests (Phase 1)
- `useCtrlScroll`: Verify fires on ctrl+wheel, ignores plain wheel
- `GridSizeContext`: Verify localStorage persistence, clamp bounds, per-view isolation
- `useDynamicGrid`: Verify correct gridStyle output for given columns

---

## Phase 2: VirtuosoGrid Face Modals (3 components)

**Goal:** Integrate into the three VirtuosoGrid-based face modals.

### Task 2.1: AllFacesModal.tsx
- Import `useDynamicGrid`
- Add `containerRef` to the modal's scrollable wrapper
- Replace static Tailwind grid class in `gridComponents.List` with dynamic `gridStyle`
- viewId: `'allFaces'`, defaultColumns: `8`

### Task 2.2: OutlierReviewModal.tsx
- Same pattern as AllFacesModal
- viewId: `'outlierReview'`, defaultColumns: `8`

### Task 2.3: BlurryFacesModal.tsx
- Same pattern — **minimal change only** (file is 720L)
- viewId: `'blurryFaces'`, defaultColumns: `8`

### Tests (Phase 2)
- Verify VirtuosoGrid still virtualizes correctly after column change
- Verify grid resizes visually on ctrl+scroll (manual test)

---

## Phase 3: People.tsx Sub-Views (hook-only)

**Goal:** Add grid zoom to all 5 People.tsx sub-views without adding logic to People.tsx.

### Task 3.1: Create usePeopleGridSize hook
Create `src/hooks/usePeopleGridSize.ts`:
- Wraps `useDynamicGrid` for each People sub-view
- Returns grid props keyed by view: `{ identified, singles, ignored, background, ungroupable }`
- Each with its own viewId and appropriate default columns

### Task 3.2: Integrate into People.tsx
- Import `usePeopleGridSize` (single import + destructure, ~3 lines)
- Replace each sub-view's static Tailwind grid class with `style={gridStyle}` + `className="grid gap-2"`
- Add `ref={containerRef}` to each section's scrollable container
- Net change: ~15 lines (5 sections × 3 lines each)

### Tests (Phase 3)
- Verify each sub-view remembers its own size independently
- Verify no regression in face selection/actions

---

## Phase 4: Remaining Face Components (4 components)

**Goal:** Integrate into the remaining non-virtualized face grid components.

### Task 4.1: ClusterRow.tsx
- `useDynamicGrid('clusterRow', containerRef)`, defaultColumns: `8`
- Replace static Tailwind grid class with dynamic style

### Task 4.2: FaceGrid.tsx
- `useDynamicGrid('faceGrid', containerRef)`, defaultColumns: `6`
- Replace static Tailwind grid class with dynamic style

### Task 4.3: GroupNamingModal.tsx
- `useDynamicGrid('groupNaming', containerRef)`, defaultColumns: `5`
- Replace static Tailwind grid class with dynamic style

### Task 4.4: PersonDetail.tsx
- `useDynamicGrid('personDetail', containerRef)`, defaultColumns: `4`
- Replace static Tailwind grid class with dynamic style

### Tests (Phase 4)
- Verify ClusterRow grid zoom works within the Discoveries tab cluster headers
- Verify GroupNamingModal zoom works during naming flow

---

## Phase 5: Library & Search Photo Grids (flex-wrap variant)

**Goal:** Add Ctrl+Scroll zoom to the photo thumbnail grids in Library and Search.

### Task 5.1: Library.tsx
- Import `useFlexZoom`
- Replace hardcoded `width: '150px', height: '150px'` in `GridItem` with `itemStyle`
- Add `containerRef` to the VirtuosoGrid wrapper
- viewId: `'library'`, defaultSize: `150`

### Task 5.2: Search.tsx
- Same pattern as Library
- viewId: `'search'`, defaultSize: `150`

### Tests (Phase 5)
- Verify VirtuosoGrid re-renders item sizes correctly
- Verify photo thumbnails scale smoothly between 80px–300px

---

## Phase 6: Polish & Documentation

### Task 6.1: Toast refinement
- Adjust toast positioning per component type (modal vs. full-page)
- Ensure toast doesn't overlap with status bar or modal close button

### Task 6.2: Keyboard alternative
- Add `Ctrl + +` / `Ctrl + -` as alternative zoom controls (same hooks, keyboard listener variant)

### Task 6.3: Update changelog
- Write `aiChangeLog/phase-XX-ctrl-scroll-grid.md`

### Task 6.4: Update future_features.md
- Move Ctrl+Scroll Grid Size Control from Priority Roadmap to Implemented Features

---

## Performance Considerations

1. **Debounced wheel events (50ms):** Prevents excessive localStorage writes and re-renders
2. **CSS-only changes:** `gridTemplateColumns` / `width`+`height` updates don't trigger child re-renders
3. **VirtuosoGrid memoization:** Only the List wrapper style changes — individual items are not re-rendered
4. **useRef for handlers:** Avoids stale closures; no re-attachment of event listeners on column change
5. **No Tailwind purge issues:** Using inline styles instead of dynamic Tailwind classes avoids purge/JIT issues

---

## Verification Checklist

- [ ] AllFacesModal with 5000+ faces — no lag on zoom
- [ ] Each People.tsx sub-view zooms independently
- [ ] VirtuosoGrid virtualization works correctly after column change
- [ ] Bounds enforced (4–12 for face grids, 80–300px for photo grids)
- [ ] Toast appears and auto-dismisses
- [ ] Settings persist across page navigation and app restart
- [ ] Different views remember different sizes
- [ ] Library/Search photo grids zoom smoothly
- [ ] Browser zoom (Ctrl+scroll without our handler) is not broken on non-grid areas
- [ ] No regressions in face selection, drag, or right-click actions

---

## Recommended Follow-Up: Refactor Over-Limit Files

Both `People.tsx` (1326L) and `BlurryFacesModal.tsx` (720L) exceed the 600-line hard limit. These should be refactored **after** this feature ships, as separate efforts:

1. **People.tsx Decomposition** — Split into sub-view components (`IdentifiedPeopleView`, `SinglesView`, `IgnoredFacesView`, `BackgroundFacesView`, `UngroupableView`) with People.tsx as a thin orchestrator (~200L). Follows the same pattern proposed for PhotoDetail in UX Modernization item #6.
2. **BlurryFacesModal.tsx Cleanup** — Extract filter/sort logic into a `useBlurryFaces` hook and split the stats panel into a sub-component.

These refactors are intentionally excluded from this plan to avoid mixing feature work with structural changes (per refactoring protocol).
