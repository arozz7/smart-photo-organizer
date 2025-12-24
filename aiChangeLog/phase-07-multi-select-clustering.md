# Phase 07: Multi-Select & Clustering Improvements

## Diff Narrative
### Features
- **Multi-Select for Unnamed Faces**: Added checkboxes and a bulk action bar to the `People` view, allowing users to name or ignore multiple faces simultaneously.
- **Enhanced Clustering**: Improved the automatic grouping of unnamed faces.

### Fixes
- **Backend (Python)**: Added critical L2 normalization to the `cluster_faces` function in `src/python/main.py`. This fixes the issue where similar faces were not grouping because their descriptor vectors were not normalized before Euclidean distance calculation.
- **Frontend (People.tsx)**: Fixed a JSX nesting error introduced during the implementation of the bulk action bar.
- **Backend (DB)**: (Previous) Added `autoAssignFaces` with normalization.

### Technical Details
- Modified `src/views/People.tsx`, `src/components/FaceGrid.tsx`, and `src/components/FaceGridItem.tsx` to propagate selection state.
- Updated `src/python/main.py` to normalize descriptors using `np.linalg.norm` before passing them to DBSCAN.

### Verification
- Validated that clicking checkboxes selects faces.
- Validated that "Name Selected" assigns the correct name to all selected faces.
- Validated that "Ignore Selected" removes faces from the list.
- Validated (via user feedback) that refreshing the "Unnamed Faces" list now shows better grouping due to the normalization fix.
