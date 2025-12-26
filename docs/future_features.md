# Future Features & Roadmap

## 🚀 Priority Roadmap

### 1. User Experience & Feedback
- **Scan vs Rescan Logic:**
    - **Goal:** Differentiate between incremental scans and full re-processing.
    - **Status:** ✅ Implemented in v0.3.5 (Incremental vs Force Rescan).

### 2. Face Management & Productivity
- **Person Thumbnail Management**
    - **Goal:** Customize the representative image for a person.
    - **Plan:** "Set as Cover" button, Smart Variety algorithms for "Top Faces", and "Shuffle" option.

### 3. Organization & Management
- **Advanced Library Filtering**
    - **Goal:** Combine multiple filter types with conditional logic (AND/OR).
    - **New Filters:** Blur Score, Date (Year/Month), Compound Logic.
- **Expanded Create View Integration**
    - **Goal:** Centralize creative tools (Gallery, Collage, Export) as output modes in the Create View.

---

## 🔮 Feature Backlog

### AI & Computer Vision
- **Hardware Compatibility:** Force Mode Selection (GPU/CPU), Multi-GPU support, OpenVINO/ONNX runtime.
- **Face Restoration Config:** Expose GFPGAN blending weight, Restoration Strength slider.
- **Custom AI Models:** Load user-provided `.pth` models from a `models/` directory.
- **Batch Enhancement:** Background queue for upscaling multiple photos.

### Organization & Metadata
- **Batch Renaming & Cleanup:** Template-based renaming (`{Date}_{Location}`), Deduplication via perceptual hash.
- **Duplicate Photo Detection:** SHA-256 (exact) and pHash (visual) detection with "Safe Deduplication" UI.
- **Saved Smart Searches:** Save active filters as "Smart Albums".
- **Batch Tagging:** Multi-select context menu actions (Add/Remove Tags).
- **Exif Metadata Injection:** Write application tags back to file headers (IPTC/XMP).
- **Location Heatmap:** World map visualization with "Trip" clustering.
- **Library Analytics:** Extended graphs (Photos per Year, Top Cameras/Lenses).

### Creative Tools
- **Collage Creator:** Masonry/Grid layouts, Face-Aware cropping.
- **Static Gallery Generator:** Export album as a static HTML site.
- **Face Dataset Export:** Generate cleaned, high-res face crops for LORA training.

### Platform & Connectivity
- **Cross-Platform:** Mac & Linux support (Docker/Python venv).
- **External Agent API:** Local REST server for folder watching and automation (`/scan`, `/tag`).
- **Containerized Backend:** Run Python backend in Docker for remote access.

---
---

# ✅ Implemented Features

## v0.3.5 (Current Release)
- **Retrieve Ignored Faces:**
    - View, Manage, and Restore faces previously marked as ignored.
    - "Group Similar" AI clustering for ignored faces.
    - Bulk Restore & Assign functionality with Pagination.
- **Interactive Feedback System:**
    - **Toasts & Notifications:** Unified feedback system.
    - **Scan Progress:** Real-time counters in the status bar.
    - **Smart Throttling:** Prevents UI stutter during heavy scanning.
- **Scan vs Rescan Logic:**
    - **Incremental Scan:** Only processes new files.
    - **Force Rescan:** Option to force re-extraction of metadata and previews for all files.
    - **Unified Rescan:** "Rescan Selected" now performs a full refresh + AI scan.

## v0.3.0: Core Intelligence
- **Smart Face Storage:** Vectors stored as BLOBs, on-demand crops (no disk thumbnails), vector pruning for known faces.
- **High-Performance Clustering:** Backend DBSCAN logic replacing frontend clustering.
- **Processing Metrics:** `scan_history` table and "Recent Activity" dashboard.
- **AI Runtime Polish:** Better validation, robust protocol handling, restart prompts.
- **User Experience:**
    - "View Original Photo" context.
    - Targeted Scanning (Person/All).
    - "Go to Folder" navigation.
    - Multi-select Face Assignment.
    - Hide "Unnamed" tags toggle.

## Previous Versions (v0.2.x)
- **UI Polish:** Responsive layouts, Window state persistence.
- **Organization:** Manual Image Rotation (Left/Right), Metadata updates.
- **Basics:** Scanning history tracking, Performance dashboard.
