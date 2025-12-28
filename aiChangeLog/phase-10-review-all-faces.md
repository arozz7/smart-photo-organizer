# Phase 10: Review All Faces & Roadmap Updates

## 📋 Overview
Implemented the "Review All Faces" feature to allow users to manage large face collections (bypassing the 1000 limit) and updated the roadmap documentation.

## ✅ Completed Tasks
- [x] **Backend Optimization:** Updated `db:getAllFaces` to optionally exclude heavy face descriptors, reducing IPC payload size.
- [x] **New Modal:** Created `AllFacesModal` using virtualization for performance with large datasets.
- [x] **UI Integration:** Added "Review All" button to Person Detail page.
- [x] **Documentation:** Updated `docs/future_features.md` to reflect implemented features (v0.3.5/v0.3.6) and add new roadmap items (Portfolio Export, Blurry Lists).
- [x] **Maintenance:** Fixed lint errors/unused variables in `ClusterRow.tsx`, `MemoizedFaceItem.tsx`, `People.tsx`.

## 🔄 Diff Narrative
- **[MODIFY] electron/main.ts**: `db:getAllFaces` now accepts `includeDescriptors` (default true). Set to false when fetching for the review modal.
- **[NEW] src/components/AllFacesModal.tsx**: New component for bulk face management.
- **[MODIFY] src/views/PersonDetail.tsx**: Integration of the new modal.
- **[MODIFY] docs/future_features.md**: Re-organized roadmap and marked completed features.

## 🧪 Verification
- Verified build and static analysis.
- Manual verification of modal opening and data loading (pending runtime check).
