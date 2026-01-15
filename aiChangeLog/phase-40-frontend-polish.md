# Phase 40: Frontend Streamlining - Polish & Limits

## Changes
- **Live Face Counts**: Implemented polling in `People.tsx` to check for new unassigned faces every 2 seconds during active scans.
- **Group Size Limits**:
    - Reduced `useIgnoredFaces` fetch limit from 500 to 150.
    - Capped `ClusterRow` display to 150 faces to prevent UI freezing with massive clusters.
- **Move Modal**: Removed AI suggestion field from "Move Faces" modal on Person Detail page (`PersonDetail.tsx` -> `RenameModal.tsx`).
- **Edge Case Filters**: Fixed destructuring issues in `People.tsx` and removed duplicate `ungroupableFaces`.

## Verification
- Confirmed "Move Faces" modal no longer shows "Suggested:".
- Confirmed "Edge Cases" view loads faster with 150 limit.
- Confirmed "New faces detected" banner appears when backend count > frontend count.
