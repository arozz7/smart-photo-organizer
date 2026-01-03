# Future Features & Roadmap

## 🚀 Priority Roadmap


### 1. Advanced Library Filtering
- **Goal:** Combine multiple filter types with conditional logic (AND/OR).
- **New Filters:** Blur Score, Date (Year/Month), Compound Logic.
- **Goal:** Combine multiple filter types with conditional logic (AND/OR).
- **New Filters:** Blur Score, Date (Year/Month), Compound Logic.


---

## 🔮 Feature Backlog

### AI & Computer Vision
- **Hardware Compatibility:** Force Mode Selection (GPU/CPU), Multi-GPU support, OpenVINO/ONNX runtime.
- **Face Restoration Config:** Expose GFPGAN blending weight, Restoration Strength slider.
- **Custom AI Models:** Load user-provided `.pth` models from a `models/` directory.
- **Batch Enhancement:** Background queue for upscaling multiple photos.

### Smart Face Management
*Goal: Drastically reduce user effort and improve accuracy when managing faces (filtering noise, identifying misassignments, and matching profiles).*

**Details:** See [Smart Ignore Implementation Plan](file:///j:/Projects/smart-photo-organizer/docs/smart-ignore-implementation-plan.md) for full technical specs.

- **Background Face Filter (Phase 1):**
    - **Goal:** Auto-identify and bulk-ignore "noise" faces (background strangers, one-time appearances).
    - **Status:** ✅ Implemented in v0.4.5.
- **Scan-Time Confidence Tiering (Phase 2):**
    - **Goal:** Auto-classify new faces at scan time into high-confidence, review, or unknown tiers.
    - **Status:** Specification Complete.
- **Smart Ignore UI Panel (Phase 3):**
    - **Goal:** Unified dashboard for managing thresholds and bulk actions.
    - **Status:** Specification Complete (UI Drafted).
- **Misassigned Face Detection (Phase 4):**
    - **Goal:** Identify faces incorrectly assigned to a person using distance-to-centroid analysis.
    - **Status:** Specification Complete.
- **Challenging Face Recognition (Phase 5):**
    - **Goal:** Improve matches for side profiles, partial faces, and occlusions using pose-aware matching and multi-sample voting.
    - **Status:** Specification Complete.
- **Unified Person Name Input (Phase 6):**
    - **Goal:** Standardize AI-powered name suggestions and autocomplete across all assignment interfaces.
    - **Status:** Specification Complete.

- **Burst Photo Face Tracking (Future Consideration):**
    - **Goal:** Optimize face processing for burst/sports photography by tracking faces across consecutive frames.
    - **Approach:** Integrate a face tracker (ByteTrack or DCF-based) between detection and recognition stages.
    - **Benefit:** Only run embedding extraction for newly detected face IDs, not every frame.
    - **Considerations:**
        - Implementation complexity: High (requires frame-by-frame tracking logic).
        - Performance cost: Tracker adds overhead per-frame, but saves on redundant embeddings.
        - Use case: Primarily benefits burst sports photography, high-FPS captures.
    - **Status:** Deferred pending performance analysis of typical library composition.

### Organization & Metadata
- **Blurry Photo List Export:**
    - **Goal:** Generate and export lists of photos with blur scores below a threshold.
    - **Features:** Group by location/folder, filter by file type, usage for manual review/deletion.
- **Person Portfolio Export:**
    - **Goal:** Export catalog of named persons with high-res reference thumbnails and library statistics.
    - **Details:** Metrics per person (photo count), heatmaps for tags/years, and exportable format (PDF/HTML).
- **Batch Renaming & Cleanup:** Template-based renaming (`{Date}_{Location}`), Deduplication via perceptual hash.
- **Duplicate Photo Detection:** SHA-256 (exact) and pHash (visual) detection with "Safe Deduplication" UI.
- **Saved Smart Searches:** Save active filters as "Smart Albums".
- **Batch Tagging:** Multi-select context menu actions (Add/Remove Tags).
- **Exif Metadata Injection:** Write application tags back to file headers (IPTC/XMP).
- **Location Heatmap:** World map visualization with "Trip" clustering.
- **Library Analytics:** Extended graphs (Photos per Year, Top Cameras/Lenses).

### System Utilities & Repair
- **Corrupt File Recovery Center:**
    - **Goal:** Smart recovery studio to attempt repairs on problematic files found during scans.
    - **Integrated Tools:**
        - **Preview Extraction:** Use `LibRaw`/`ExifTool` to salvage embedded JPEGs from corrupted RAW files.
        - **Header Surgery:** Automated header reconstruction for ARW/NEF files using "healthy" reference files from the same camera (inspired by RAW-Repair-Tool).
        - **Deep Carving:** Integration with `PhotoRec` for signature-based recovery of files from damaged sectors.
    - **UI:** New "Tools" view with guided wizards for each recovery strategy.

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

## v0.4.5 (In Development)
- **Person Thumbnail Management:**
    - **Custom Covers:** Manually "Pin" any face as the person's cover photo.
    - **Shuffle:** Instantly pick a random high-quality face as the cover.
    - **Smart Fallback:** Auto-reverts to the sharpest available face if unpinned.

## v0.4.0 (Stability Release)
- **Architecture Refactor:** Modularized Main Process for better stability.
- **Data Safety:** Fixed Face Assignment data loss during re-scans.
- **Reduced Verbosity:** Cleaner logs for easier debugging.

## v0.3.6 (Upcoming/Main)
- **Auto-Identify Optimization:**
    - Improved "Scan for All Named People" and "Auto-Identify" logic to capture faces missed in initial scans.
- **Automatic Face Matching:**
    - Newly scanned faces are now automatically matched against known people immediately after scan persist.
- **Review All Faces:**
    - Implemented a dedicated modal to review, move, and remove all faces for a person, bypassing the 1000 face display limit.

## v0.3.5 (Current Release)
- **Unnamed Faces Performance & UX:**
    - **Virtualization:** Implemented `react-virtuoso` to handle 10,000+ faces smoothly.
    - **Optimistic Updates:** Instant UI feedback for "Name", "Ignore", and "Group" actions (no loading spinners).
    - **View Original Photo:** Added context button to view source image for any face thumbnail.
    - **Inline Actions:** "Ignore Group" button added directly to cluster headers.
- **Corrupt Photo Tracking:**
    - **Backend Safety:** Robust error handling for truncated/corrupt images (preventing silent crashes).
    - **Scan Warnings Report:** New "Settings" tab to list and manage (delete/dismiss) corrupt files.
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
- **Smart Tags Optimization:**
    - **Normalization:** Enforced single-word, lowercase tags.
    - **Cleanup Utility:** Settings tool to optimize existing tag database.
    - **Type-ahead Filter:** Improved tag filtering in Create view.

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
