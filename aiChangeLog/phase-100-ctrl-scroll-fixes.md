# Phase 100 — Ctrl+Scroll Bug Fixes: Identified Grid + Callback Ref

**Branch:** `feature/v0.7.0-prs-integration`
**Date:** 2026-02-25

---

## Summary

Two distinct bugs prevented ctrl+scroll grid resizing from working in several views. Both are now fixed. Additionally, a `better-sqlite3` native module ABI mismatch was resolved and a `postinstall` hook added to prevent recurrence.

---

## Bug 1 — Identified People grid missing ctrl+scroll support

### Problem
The main "Identified People" tab grid in `People.tsx` used hardcoded responsive Tailwind classes (`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6`). Phase 97 wired up `usePeopleGridSize` for the 4 Edge Cases sub-grids (singles, ignored, background, ungroupable) but never added an `identified` key.

### Fix

**`src/hooks/usePeopleGridSize.ts`** — added `identified: DynamicGridResult` to the interface and a new `useDynamicGrid` call:
```ts
const identified = useDynamicGrid({ storageKey: 'people:identified', default: 6 });
return { identified, singles, ignored, background, ungroupable };
```

**`src/views/People.tsx`** — replaced the hardcoded grid div with a persistent wrapper bearing `containerRef` and an inner grid div with `gridStyle`:
```jsx
<div ref={gridSizes.identified.containerRef}>
    {loading && people.length === 0 ? (
        /* spinner */
    ) : people.length === 0 ? (
        /* empty state */
    ) : (
        <div style={{ ...gridSizes.identified.gridStyle, gap: '1.5rem' }}>
            {people.map(...)}
        </div>
    )}
</div>
```
The persistent wrapper ensures `containerRef` receives the DOM element on mount — before `people` data loads — so the wheel listener is always attached.

---

## Bug 2 — Ctrl+scroll broken on all conditionally-rendered grids (root cause fix)

### Problem
Ctrl+scroll did not work on `PersonDetail` (named person page), `ClusterRow` (each cluster in the Discoveries/Unnamed Faces tab), and any other grid whose containing element is conditionally rendered or behind an async data load.

**Root cause:** `useCtrlScroll` had `[containerRef]` as its effect dependency — a `RefObject` whose object identity never changes. The effect ran once on component mount. If the grid div wasn't in the DOM at that point (e.g., `if (loading && !person) return ...` in PersonDetail, `if (!loaded) return ...` in ClusterRow), `containerRef.current` was `null` and the listener was never attached. When data loaded and the div mounted, the effect did not re-run.

### Fix — Callback ref pattern

The fix is two-layer, entirely within the hooks. No callsites needed updating.

**`src/hooks/useCtrlScroll.ts`** — changed signature to accept `HTMLDivElement | null` directly instead of `RefObject<HTMLDivElement>`. Effect now depends on `[el]`, so it re-runs whenever the actual element mounts or unmounts:

```ts
// Before
export function useCtrlScroll(containerRef: RefObject<HTMLDivElement>, ...): void {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // ...
  }, [containerRef]);   // ← stable ref object, never re-runs
}

// After
export function useCtrlScroll(el: HTMLDivElement | null, ...): void {
  useEffect(() => {
    if (!el) return;
    // ...
  }, [el]);   // ← re-runs when element mounts/unmounts
}
```

**`src/hooks/useDynamicGrid.ts`** — replaced `useRef<HTMLDivElement>` with a callback ref backed by state:

```ts
// Before
const containerRef = useRef<HTMLDivElement>(null);
useCtrlScroll(containerRef, zoomIn, zoomOut);

// After
const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
}, []);
useCtrlScroll(containerEl, zoomIn, zoomOut);
```

When React attaches a DOM node to any `ref={containerRef}`, it calls the callback with the element → `setContainerEl(node)` triggers a state update → `useCtrlScroll`'s effect re-runs with the real element → listener attached. This fixes every consumer simultaneously: `PersonDetail`, `ClusterRow`, `AllFacesModal`, `GroupNamingModal`, `BlurryFacesModal`, `OutlierReviewModal`, and the People tab grids.

`DynamicGridResult.containerRef` type updated from `RefObject<HTMLDivElement>` to `(node: HTMLDivElement | null) => void`. React accepts callback refs in the `ref` prop identically to ref objects — no JSX changes needed anywhere.

---

## Bug 3 — `better-sqlite3` ABI mismatch (Electron vs system Node.js)

### Problem
`better-sqlite3` was compiled against system Node.js v22 (NODE_MODULE_VERSION 127). Electron 30 bundles Node 20 (NODE_MODULE_VERSION 123), causing `ERR_DLOPEN_FAILED` on app startup.

### Fix
- Ran `npx @electron/rebuild -f -w better-sqlite3` to recompile against Electron headers
- Added `@electron/rebuild ^4.0.3` to `devDependencies`
- Added `"postinstall": "electron-rebuild -f -w better-sqlite3"` to `scripts` so every `npm install` automatically rebuilds for Electron

---

## Files Modified

| File | Change |
|------|--------|
| `src/hooks/usePeopleGridSize.ts` | Added `identified` key (interface + `useDynamicGrid` call) |
| `src/views/People.tsx` | Replaced hardcoded Tailwind grid with `containerRef` wrapper + dynamic `gridStyle` |
| `src/hooks/useCtrlScroll.ts` | Changed signature: `RefObject<HTMLDivElement>` → `HTMLDivElement \| null`; effect dep `[containerRef]` → `[el]` |
| `src/hooks/useDynamicGrid.ts` | Replaced `useRef` with callback ref (`useState` + `useCallback`); passes element (not ref) to `useCtrlScroll`; updated `DynamicGridResult.containerRef` type |
| `package.json` | Added `postinstall` script + `@electron/rebuild` devDependency |
| `tests/frontend/unit/hooks/useCtrlScroll.test.ts` | Updated `renderAndAttach` to pass `container` element directly (not ref object) |
| `tests/frontend/unit/hooks/useCtrlScroll.test.tsx` | Updated `HookHarness` to use `useState` + callback ref pattern |
| `tests/frontend/unit/hooks/useDynamicGrid.test.ts` | Updated "returns a containerRef" assertion: `toHaveProperty('current')` → `typeof === 'function'` |
| `tests/frontend/unit/components/OutlierReviewModal.test.tsx` | Updated `useDynamicGrid` mock: `containerRef: { current: null }` → `containerRef: () => {}` |

---

## Test Results

All tests related to these changes pass:

| File | Tests |
|------|-------|
| `useCtrlScroll.test.ts` | 6 ✓ |
| `useCtrlScroll.test.tsx` | 6 ✓ |
| `useDynamicGrid.test.ts` | 11 ✓ |
| `OutlierReviewModal.test.tsx` | 1 ✓ |

4 test files fail due to a pre-existing `better-sqlite3` ABI mismatch between the Electron-compiled binary (ABI 123) and the vitest Node.js runtime (ABI 120/127). These are unrelated to this phase.

---

## Behavior Changes

- Ctrl+scroll now works on the **Identified People** tab grid (was silently doing nothing)
- Ctrl+scroll now works on the **PersonDetail** faces grid (click into any named person)
- Ctrl+scroll now works on every **ClusterRow** in the Discoveries/Unnamed Faces tab
- Ctrl+scroll continues to work on all Edge Cases sub-grids (unchanged)
- `people:identified` column count persists in `localStorage` under `spo:grid:people:identified`; default: 6 columns

---

## Key Technical Decision

The callback ref pattern (`useState` + `useCallback`) is the idiomatic React solution for "run an effect when a conditionally-rendered element mounts". An alternative would have been adding a persistent wrapper div at each callsite, but that would require changes to every consumer. The hook-level fix is self-contained and correct for all present and future consumers.
