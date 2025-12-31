# Phase 12: Refactor People.tsx

**Date:** 2025-12-30
**Status:** Completed

## Diff Narrative

### Refactoring `src/views/People.tsx`
This phase focused on breaking down the `People.tsx` view which had grown too large (>600 lines) and violated Single Responsibility principles.

#### Files Created
- `src/components/ClusterList.tsx`: Extracted the `Virtuoso` list and `renderClusterRow` logic.
- `src/hooks/usePeopleCluster.ts`: Extracted state management for clusters, selection, and bulk actions.

#### Files Modified
- `src/views/People.tsx`: Removed extracted code, imported new component and hook.
    - Reduced size by ~65%.
    - Improved readability and maintainability.

### Tests
- Validated with `npx tsc`.

### Regression Fix (Post-Refactor)
- **Crash Fix**: Memoized all API functions in `PeopleContext` to prevent infinite re-render loops in consumers like `People.tsx`.
- **DevTools**: Restored `Ctrl+Shift+I` shortcut using `before-input-event` in `WindowManager`.
- **Missing IPC**: Implemented `ai:clusterFaces` in `electron/ipc/aiHandlers.ts` to support grouping in `IgnoredFacesModal`.
- **UI Fix**: Updated `IgnoredFacesModal` to correctly display faces as "Singles" if no clusters are found.
- **Validation Fix**: Removed strict `success: true` check in `IgnoredFacesModal` to handle API responses correctly.
- **AI Queue**: Disabled auto-start on app initialization. The queue now starts in a 'Paused' state and requires manual resumption.
- **Status**: ✅ VERIFIED

