# Changelog

## [Unreleased]
### Fixes
- **Face Identification:** Implemented "Hybrid Matching" (FAISS + Centroid) to ensure new scans correctly match against named people even if vector distances vary slightly.
- **System Status:** Fixed "Dimensions: 0" display glitch for the vector index.
- **RAW/JPG Orientation Mismatch:** Fixed pervasive issue where RAW thumbnails were misaligned ("ghost crops") and JPGs were double-rotated. Implemented "Smart Conditional Rotation" in both Python and Electron backends.
- **Thumbnail Quality:** Implemented server-side cropping for face thumbnails, ensuring high-resolution displays even for small faces in large RAW files.
- **Analysis Errors:** Failures during analysis (e.g., corrupt files) now correctly log to the DB instead of failing silently.
- **Scan for All Named People:** Fixed "0 matches found" issue by correcting IPC payload nesting for `search_index` command. Improved vector search reliability.
- **Cluster Settings Persistence:** The "Regroup" similarity threshold now persists across sessions, page reloads, and auto-identifications.
- **UI Standardization:** Unified face thumbnail loading logic across all modals (Blurry, Ignored, Unmatched, Group Naming) to eliminate "Failed to load" errors and improve performance by leveraging backend caching.
- **Unnamed Faces:** Fixed state leak where naming suggestions persisted across rows when a group was accepted and removed (Virtualized list component reuse fix).
- **Unmatched Faces Modal:** 
    - Fixed non-functional "Use Suggestion" button by correctly routing actions through the state hook.
    - Added loading indicators and better UX feedback during batch naming/ignoring.
- **AI Model Management:** 
    - Fixed issue where available models were not displaying in the management modal.
    - Added an "Extracting..." status indicator during the final phase of model installation to improve UX feedback.
- **Batch Processing:** Optimized `autoNameFaces` to use bulk database updates, significantly improving performance when naming many faces simultaneously.

### Refactoring
- **Core Architecture Refactor (Modularization):** Completed a major transition of the Electron backend to a modular Service/Repository architecture.
    - Moved all SQLite logic from IPC handlers to dedicated Repositories (`FaceRepository`, `PersonRepository`, `PhotoRepository`).
    - Centralized business logic in Services (`FaceService`, `PersonService`).
    - Decoupled AI provider logic into a dedicated Infrastructure layer (`PythonAIProvider`).
- **IPC Layer:** Slimmed down `aiHandlers.ts` and `dbHandlers.ts` to focus solely on request routing, significantly improving maintainability.

### Fixes
- **Ignored Faces Modal:**
    - Fixed identity "suggestions" not appearing by ensuring descriptors are fetched from the DB.
    - Implemented a **Sensitivity Slider** (0.1 - 0.95) to allow matching blurry or low-quality ignored faces.
    - Added **AI Data Indicators** (green dots) to visually confirm which faces are ready for matching.
    - Fixed UI sync issues where assigned faces remained in the grid, particularly in clustered/grouped views.
    - Fixed a `SyntaxError` in clustering caused by incorrect binary descriptor parsing.
- **Blurry Faces Modal:** Added missing matching support (`face:findPotentialMatches`) to enable the "Identify Matches" feature.
- **Match Consistency:** Implemented simultaneous restore-and-assign logic to prevent data inconsistencies when naming ignored faces.

## v0.4.0 (Stability & Refactoring)
*Release Date: 2025-12-29*

### 🔧 Improvements & Refactoring
- **Major Architecture Refactor:** Split the monolithic `electron/main.ts` into modular services (`imageProtocol`, `pythonService`, `windowManager`) and IPC handlers. This improves maintainability and stability.
- **Log Verbosity:** Significantly reduced log noise in the protocol and Python services. Debug logs are now cleaner and easier to read.

### 🐛 Bug Fixes
- **Face Assignment Data Loss:** Fixed a critical issue where manually assigned names/ignored status were lost when a photo was re-scanned or re-analyzed.
    - Implemented smart "Intersection over Union" (IoU) matching to preserve assignments even if face coordinates shift slightly.
- **RAW Photo Rotation:** Fixed an issue where RAW photos (ARW/NEF) were not rotating correctly using the "Rotate Left/Right" tools. Now uses `exiftool` to modify metadata directly.
- **Preview Generation:** Addressed race conditions in preview generation for RAW files.

---

## v0.3.5
- **Unnamed Faces Performance:** Virtualized grid for 10k+ faces.
- **Corrupt Photo Tracking:** Better handling of truncated images.
- **Retrieve Ignored Faces:** UI to restore ignored faces.
- **Interactive Feedback:** New toast notifications and progress bars.
