# Phase 40: Cluster & UI Improvements

## Changes

### 1. Cluster Size Limits (Backend)
- **Goal**: Prevent massive, unmanageable face groups (e.g. 5000+ faces).
- **Implementation**:
    - Updated `src/python/main.py` to recursively split oversized clusters using Hierarchical Clustering (Ward's method) if `size > max_size`.
    - Set default `max_size = 200` in IPC handler (`aiHandlers.ts`).
    - **Note**: "Group by Suggestion" logic in backend now tags split clusters with the same suggestion rather than re-merging them, preserving manageability.

### 2. UI/UX Fixes (People View)
- **'A' Key Shortcut**:
    - Fixed issue where 'A' key didn't accept suggestions.
    - Reason: Suggestion object structure varied (`person.name` vs `personName`). Added robust property checking.
- **Cluster Selection**:
    - Fixed mouse click not setting active selection index.
    - Added missing `onFocus` prop wiring to `ClusterList.tsx`.
- **TypeScript Cleanup**:
    - Removed valid/unused destructuring in `People.tsx` to fix build warnings.

## Verification
- **Test Script**: Verified cluster splitting logic with `tests/python/unit/test_start_cluster_split.py` (simulated 300-face cluster splitting into 2x150).
- **Manual**: Confirmed 'A' key works and clicking groups updates focus for keyboard navigation.
