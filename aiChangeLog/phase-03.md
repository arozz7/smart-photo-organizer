# Phase 3: UX & Identification Workflow - Change Log

## [Unreleased]

### Added
- Global `PhotoDetail` overlay controlled by `ScanContext`.
- "View Original Photo" button on face crops in `FaceGridItem` and `PersonFaceItem`.
- "Go to Folder" functionality in `PhotoDetail`.
- Targeted Scanning foundation (`scan_history.scan_mode` tracking).
- "Scan Library for [Person]" buttons in `PersonDetail` and `People` views.
- Added `TargetedScanModal` for scoped scanning and identification.
- Implemented **Quick Scan (Vector Match)** mode using existing FAISS vectors for instant identification.
- Added **Clear Queue** functionality to the AI processing view.
- Introduced new backend IPC handlers for bulk face association and person vector retrieval.
- "Hide Unnamed Faces" toggle in `PhotoDetail` and global settings persistence.

### Changed
- Refactored `Library` and `PhotoDetail` to use global state for photo viewing.

### Fixed
- Rotation-aware face box positioning in `PhotoDetail`.

### Added
- **Rotation Augmentation (TTA)** for Deep Scan: Automatically retries analysis with 90°, 180°, and 270° rotations if MACRO scan finds no faces, or always (merged) if configured.
- Implemented intelligent bounding box coordinate transformation for rotated faces.

### Changed
- Upgraded **Force Deep Scan (MACRO)** mode to use High Resolution (1280x1280) and Lower Threshold (0.25) for maximum sensitivity.
- Improved "Force Deep Scan" button logic in `PhotoDetail` to ensure it catches difficult faces (sideways, upside down).

### Fixed
- Fixed issue where "Force Deep Scan" would fail to find rotated faces even when manually triggered.
- Fixed bounding box misplacement for rotated faces by correcting geometric inversion formulas.
- Fixed scroll position loss on "People" page when returning from detail view (implemented robust `localStorage` backup with multi-retry restoration).

### Added
- Re-enabled Developer Tools via `Ctrl+Shift+I` global shortcut (only when window is focused).

### Risks & Assumptions
- **Risk:** Scaling face boxes in `PhotoDetail.tsx` might be tricky due to `object-fit: contain` and varying image aspect ratios.
- **Assumption:** The Python backend can be easily extended to support targeted scanning by providing a person-specific descriptor or filtering photos before analysis.

