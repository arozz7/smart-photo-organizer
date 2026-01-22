# Ctrl+Scroll Grid Size Feature Plan

## Overview
Add the ability to change face thumbnail grid density using Ctrl+scroll wheel across all pages and modals that display face grids, with per-view persistence.

## Design Decisions

| Decision | Choice |
|----------|--------|
| **Column range** | `min: 4`, `max: 12` |
| **Persistence** | localStorage, per page/modal |
| **Scope** | Per-view (each modal/page remembers its own size) |
| **Visual feedback** | Brief toast showing "Grid: X columns" |

---

## File Size Constraints

Per refactoring protocol, files must stay under 600 lines (hard limit).

| File | Current Lines | Status | Action |
|------|---------------|--------|--------|
| `People.tsx` | **1225** | ⚠️ Already over limit | Do NOT add code - use hooks only |
| `BlurryFacesModal.tsx` | **650** | ⚠️ Over limit | Minimal 10-line change only |
| `OutlierReviewModal.tsx` | 395 | ✅ OK | Minimal changes |
| `AllFacesModal.tsx` | 293 | ✅ OK | Minimal changes |

---

## New Files (Modular Approach)

### Core Infrastructure
| File | Lines | Purpose |
|------|-------|---------|
| `src/context/GridSizeContext.tsx` | ~80 | Per-view column management with localStorage |
| `src/hooks/useCtrlScroll.ts` | ~40 | Wheel event detection with ctrlKey check |
| `src/hooks/useDynamicGrid.ts` | ~60 | Combines context + wheel handling |
| `src/hooks/usePeopleGridSize.ts` | ~50 | People.tsx-specific grid sizes |
| `src/components/GridZoomToast.tsx` | ~30 | Brief visual feedback toast |

### Key Implementation Details

**GridSizeContext:**
```typescript
// Usage: const { columns, zoomIn, zoomOut } = useGridSize('allFacesModal');
// Per-view storage using identifiers like 'allFacesModal', 'peopleIgnored'
// Syncs to localStorage with prefix 'gridSize:'
```

**useDynamicGrid:**
```typescript
function useDynamicGrid(viewId: string, containerRef: RefObject<HTMLElement>) {
  const { columns, zoomIn, zoomOut } = useGridSize(viewId);
  useCtrlScroll(containerRef, zoomIn, zoomOut);
  return {
    columns,
    gridStyle: { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` },
    gridClassName: 'grid gap-2'
  };
}
```

---

## Components to Modify

### VirtuosoGrid Modals (Large Datasets)
- `AllFacesModal.tsx` (+10 lines) - viewId: `'allFacesModal'`
- `OutlierReviewModal.tsx` (+10 lines) - viewId: `'outlierReview'`
- `BlurryFacesModal.tsx` (+10 lines) - viewId: `'blurryFaces'`

### People.tsx Sub-Views (Via usePeopleGridSize hook)
- Singles section - viewId: `'peopleSingles'`
- Ignored faces - viewId: `'peopleIgnored'`
- Background faces - viewId: `'peopleBackground'`
- Ungroupable faces - viewId: `'peopleUngroupable'`

### Other Components
- `ClusterRow.tsx` (+8 lines) - viewId: `'clusterRow'`
- `PersonDetail.tsx` (+8 lines) - viewId: `'personDetail'`
- `GroupNamingModal.tsx` (+8 lines) - viewId: `'groupNaming'`
- `FaceGrid.tsx` (+8 lines) - viewId: `'faceGrid'`

---

## Performance Optimizations

1. **Debounced Wheel Events (50ms):** Prevents excessive localStorage writes
2. **CSS-Only Changes:** Grid column updates don't trigger child re-renders
3. **VirtuosoGrid Memoization:** Only List wrapper recreates, not individual items
4. **useRef for Event Handlers:** Avoids stale closures without re-renders

---

## Verification Checklist

- [ ] Test AllFacesModal with 5000+ faces - verify no lag
- [ ] Test each People.tsx sub-filter independently
- [ ] Verify VirtuosoGrid virtualization works after resize
- [ ] Verify min/max bounds (4-12 columns)
- [ ] Verify toast feedback appears
- [ ] Verify persistence across sessions
- [ ] Verify different views remember different sizes
