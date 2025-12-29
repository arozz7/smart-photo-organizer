# Changelog

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
