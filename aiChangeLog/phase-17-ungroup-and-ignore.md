# Phase 17: Ungroup and Ignore Features

## Goal
Improve the usability of the "Unnamed Faces" page by allowing users to easily break up incorrect clusters and ignore irrelevant groups in bulk.

## Changes
- **Feature**: Added "Ungroup" button to individual cluster rows.
    - Moves faces from the cluster back to the "Unmatched Faces" (single) pool.
    - Optimistic update for immediate feedback.
- **Feature**: Added "Ignore All Groups" button to the main toolbar.
    - Allows one-click ignoring of all currently visible suggested groups.
    - Useful for bulk cleanup of non-faces or irrelevant people.
- **Testing**: Verified syntax and component integrity via linting. Manual verification confirmed that existing "Suggested Names" logic remains intact.

## Files Modified
- `src/components/ClusterList.tsx`
- `src/components/ClusterRow.tsx`
- `src/hooks/usePeopleCluster.ts`
- `src/views/People.tsx`

## Risks
- **Persistence**: The "Ungroup" action is session-based (optimistic). If the backend reclusters on reload, these groups might reappear unless the user names or ignores them individually. This is acceptable for the current "cleanup" workflow.
