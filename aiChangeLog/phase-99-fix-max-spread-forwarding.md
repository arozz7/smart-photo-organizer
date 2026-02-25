# Phase 99 — Fix `max_spread` Not Forwarded to Python in `ai:clusterFaces`

**Branch:** `feature/v0.7.0-prs-integration`
**Date:** 2026-02-24

---

## Problem

After Phase 98, a 42-face heterogeneous garbage cluster (plants, car wheel, tomatoes, toilet, clothing) still appeared in the Ignored tab "Group Similar" view despite `max_spread: 0.7` being sent from the frontend.

**Python log evidence (`22:30:51`):**
```
Cluster quality filter: 6 clusters, min_cohesion=0.65, max_spread=0.0
Cluster 0: size=42, magnitude=0.705, spread=0.869   ← would be demoted if max_spread=0.7
Cluster 1: size=7,  magnitude=0.810, spread=0.667   ← genuine, keep
Cluster 2: size=5,  magnitude=0.858, spread=0.580   ← genuine, keep
Cluster 3: size=2,  magnitude=0.908, spread=0.418   ← genuine, keep
Cluster 4: size=2,  magnitude=1.000, spread=0.000   ← genuine, keep
Cluster 5: size=2,  magnitude=0.929, spread=0.370   ← genuine, keep
```

`max_spread=0.0` confirms the parameter was silently dropped at the IPC layer.

**Root cause:** `useIgnoredFaces.ts` correctly sent `max_spread: 0.7` in the IPC payload, but `electron/ipc/aiHandlers.ts` only destructured `{ faceIds, eps, min_samples, min_cohesion }` — `max_spread` was never extracted or forwarded to the Python `cluster_faces` command.

---

## Fix

### `electron/ipc/aiHandlers.ts` — `ai:clusterFaces` handler

**Before:**
```typescript
const { faceIds, eps, min_samples, min_cohesion } = args;
// ...
const payload = {
    faces: formattedFaces,
    eps: eps ?? 0.45,
    min_samples: min_samples ?? 2,
    min_cohesion: min_cohesion ?? 0.0
};
```

**After:**
```typescript
const { faceIds, eps, min_samples, min_cohesion, max_spread } = args;
// ...
const payload = {
    faces: formattedFaces,
    eps: eps ?? 0.45,
    min_samples: min_samples ?? 2,
    min_cohesion: min_cohesion ?? 0.0,
    max_spread: max_spread ?? 0.0
};
```

Default of `0.0` preserves backward-compatible behavior (no spread gate) for any callers that don't pass `max_spread`.

---

## Test Fix

### `tests/frontend/unit/components/OutlierReviewModal.test.tsx`

`OutlierReviewModal` now uses `useDynamicGrid` (Phase 97), which calls `useToast` internally. The test render had no `ToastProvider`, causing:

```
Error: useToast must be used within a ToastProvider
```

**Fix:** Added a `vi.mock` for `useDynamicGrid` at the top of the test file, returning a static stub (`containerRef: { current: null }`, `gridStyle: { gridTemplateColumns: 'repeat(8, 1fr)' }`). This avoids pulling in `ToastProvider` in a unit test that has no interest in grid-sizing behavior.

---

## Verification

Python log after fix:
```
Cluster quality filter: 6 clusters, min_cohesion=0.65, max_spread=0.7
Cluster 0: size=42, magnitude=0.705, spread=0.869 -> DEMOTED (spread 0.869 > 0.7)
Cluster 1: size=7,  magnitude=0.810, spread=0.667   ← kept
Cluster 2: size=5,  magnitude=0.858, spread=0.580   ← kept
Cluster 3: size=2,  magnitude=0.908, spread=0.418   ← kept
Cluster 4: size=2,  magnitude=1.000, spread=0.000   ← kept
Cluster 5: size=2,  magnitude=0.929, spread=0.370   ← kept
```

Only the 5 genuine face groups (sizes 7, 5, 2, 2, 2) appear in the UI.

---

## Files Modified

| File | Change |
|------|--------|
| `electron/ipc/aiHandlers.ts` | Added `max_spread` to destructure + payload in `ai:clusterFaces` handler |
| `tests/frontend/unit/components/OutlierReviewModal.test.tsx` | Added `vi.mock` for `useDynamicGrid` to eliminate `ToastProvider` dependency |

---

## Test Results

```
Test Files   45 passed (45)
Tests       335 passed (335)
```

(`better-sqlite3` also rebuilt from ABI 123 → ABI 127 to resolve native module mismatch.)
