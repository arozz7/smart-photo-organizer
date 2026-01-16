# Phase 40: Frontend Streamlining - Polish & Limits

## Changes
- **Live Face Counts**: Implemented polling in `People.tsx` to check for new unassigned faces every 2 seconds during active scans.
- **Group Size Limits**:
    - Reduced `useIgnoredFaces` fetch limit from 500 to 150.
    - Capped `ClusterRow` display to 150 faces to prevent UI freezing with massive clusters.
- **Move Modal Fixes**:
    - **Stability**: Fixed aggressive refreshing/flickering of the "Move Faces" modal by implementing snapshot state (`facesToMove`) and stabilizing `usePersonDetail` actions with `useMemo`.
    - **Suggestions**: Explicitly disabled AI suggestions in `RenameModal` default props and patched phantom usage in `OutlierReviewModal` and `AllFacesModal`.
    - **Refactor**: Replaced internal `MoveFacesModal` in `AllFacesModal.tsx` with the shared `RenameModal` component for consistency.
- **Edge Case Filters**: Fixed destructuring issues in `People.tsx` and removed duplicate `ungroupableFaces`.
- **Graceful Shutdown**: Fixed a race condition in `PythonAIProvider` to prevent "Object has been destroyed" errors when closing the app during active AI processing.
- **Activity Summary**: Fixed the "Items this Session" counter in `Queues.tsx` getting stuck at 10 by implementing a dedicated backend count query instead of client-side filtering of truncated history.

## Verification
- Confirmed "Move Faces" modal no longer shows "Suggested:" in both Main View and Review All View.
- Verified modal input does not clear when background processes refresh the app state.
- Confirmed "Edge Cases" view loads faster with 150 limit.
- Confirmed "New faces detected" banner appears when backend count > frontend count.
- Confirmed "Object has been destroyed" error is resolved during app shutdown.
- Confirmed "Items this Session" correctly displays the total count of items scanned in the last hour, exceeding the visual history limit.
- Verified build process completes successfully after fixing unused imports and missing type definitions.
