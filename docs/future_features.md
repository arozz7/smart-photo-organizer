# Future Features & Roadmap

## 🚀 Priority Roadmap

### 1. Advanced Library Filtering
- **Goal:** Combine multiple filter types with conditional logic (AND/OR).
- **New Filters:** Blur Score, Date (Year/Month), Compound Logic.

### 2. Home Page Dashboard
- **Goal:** Replace Library as default startup page with an engaging, widget-based home experience.
- **Core Features:**
    - **Widget Grid System:** 12-column snap-to-grid layout with drag-and-drop. Supports 1x1, 2x1, 2x2 widget sizes.
    - **On This Day Memories:** Surface photos from same date in previous years (±3 day tolerance).
    - **Auto-Generated Collages:** Daily collage with "Save as PNG/JPG" export and "Regenerate" button.
    - **People Spotlight:** Carousel of named people with photo counts.
    - **Library Stats:** Pie chart of processed/pending/corrupt files.
    - **Notification Badge:** Purple dot on Home nav when new memories are available.
- **Scan-Time Entertainment:**
    - **Live Discovery Feed:** Show completed scan thumbnails with fade-in animation.
    - **Random Flashback:** Cycle through existing memories every ~10 seconds.
    - **Live Stats:** Faces found, people matched, new locations counters.
    - **Fun Facts:** Library insights ("You took 342 photos in March 2023!").
- **Widget Customization Modal:**
    - Toggle widgets ON/OFF, select sizes (1x1, 2x1, 2x2).
    - Layout presets: Minimal, Balanced, Power User.
    - Persistent layout saved to user preferences.
- **Performance:**
    - 60fps animations with "Reduce Motion" setting for lower-end hardware.
    - Offline-capable: Stats & memories work without AI backend.
- **Wireframes:** See [Home Page Wireframes](file:///C:/Users/arozz/.gemini/antigravity/brain/e4c43ef8-5d37-4b2a-b227-6fbddeaf706b/home-page-wireframes.md)

### 3. Centroid Stability & Face Confirmation
- **Goal:** Improve face assignment accuracy for people whose photos span many years (children, long-term family archives).
- **Core Features:**
    - **Face Confirmation:** Mark potentially misassigned faces as "correct" to exclude from future outlier detection.
    - **Era-Aware Clustering:** Support multiple centroids per person based on photo date ranges (e.g., "Baby", "Teen", "Adult").
    - **Centroid Drift Detection:** Alert users after scanning when a person's face signature shifts significantly.
    - **Auto-Identify Fixes:** Freeze centroids during bulk operations, tier-based assignment, per-person caps to prevent cascade misassignment.
- **Migration Path:** "Auto-Generate Eras" button analyzes existing photo dates and creates 5-year bands automatically.
- **Implementation Plan:** See [Centroid Stability Plan](file:///C:/Users/arozz/.gemini/antigravity/brain/4b6766a5-9655-4ded-bc15-d934680dedc9/implementation_plan.md)

### 4. Code Refactoring - FaceAnalysisService
- **Goal:** Refactor `FaceAnalysisService.ts` to improve maintainability as it approaches file size limits.
- **Current Status:** ~560 lines (soft limit 400, hard limit 600).
- **Proposed Structure:**
    - Extract `OutlierDetection` logic to `FaceOutlierService.ts`.
    - Extract `NoiseDetection` logic to `FaceNoiseService.ts`.
    - Create `ipcUtils.ts` for file-based IPC transfer helpers.
- **Trigger:** Refactor when next feature addition would exceed 600 lines.

---

## 🔮 Feature Backlog

### AI & Computer Vision
- **Hardware Compatibility:** Force Mode Selection (GPU/CPU), Multi-GPU support, OpenVINO/ONNX runtime.
- **Face Restoration Config:** Expose GFPGAN blending weight, Restoration Strength slider.
- **Custom AI Models:** Load user-provided `.pth` models from a `models/` directory.
- **Batch Enhancement:** Background queue for upscaling multiple photos.

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
- **External Agent API:**
    - **Goal:** Enable external agents to programmatically trigger scans and manage the library.
    - **Core Architecture:**
        - **Standalone Backend:** The Python backend (with REST API) can run independently from the Electron frontend.
        - **Auto-Start:** If the frontend launches and no backend is detected, it starts the backend automatically.
        - **Shared State:** Both frontend and external agents communicate with the same backend instance.
    - **Scheduled Scanning:**
        - Agents monitor folders for changes but do NOT trigger immediate scans.
        - Changes are queued as "pending scan" markers.
        - A **configurable schedule** (e.g., "Only scan between 2 AM - 6 AM") processes the queue.
        - **Manual Override:** "Process Now" button in UI for immediate processing.
    - **API Endpoints:**
        - `POST /api/v1/queue-scan`: Add a file/folder to the pending scan queue.
        - `POST /api/v1/tag`: Apply tags to a photo by ID.
        - `GET /api/v1/status`: Check backend status (idle/scanning/queue depth).
        - `POST /api/v1/trigger-schedule`: Force immediate processing of the scan queue.
    - **Configuration UI (Settings Tab):**
        - **Backend Status:** Show if running standalone or Electron-managed.
        - **API Port:** Configure the listening port (default: 3001).
        - **API Key:** Generate/regenerate an optional API key for authentication.
        - **Schedule Editor:** Define scan windows (e.g., "Mon-Fri 2:00 AM - 6:00 AM").
        - **Pending Queue:** View queued items, manually trigger or clear the queue.
- **Containerized Backend:** Run Python backend in Docker for remote access.

---

## ⏸️ Future / On Hold

### Burst Photo Face Tracking
- **Goal:** Optimize face processing for burst/sports photography by tracking faces across consecutive frames.
- **Approach:** Integrate a face tracker (ByteTrack or DCF-based) between detection and recognition stages.
- **Benefit:** Only run embedding extraction for newly detected face IDs, not every frame.
- **Considerations:**
    - Implementation complexity: High (requires frame-by-frame tracking logic).
    - Performance cost: Tracker adds overhead per-frame, but saves on redundant embeddings.
    - Use case: Primarily benefits burst sports photography, high-FPS captures.
- **Status:** Deferred pending performance analysis of typical library composition.
- **Implementation Plan:** See [Burst Photo Face Tracking Plan](file:///j:/Projects/smart-photo-organizer/docs/burst-photo-face-tracking-plan.md)

---

# ✅ Implemented Features

## v0.5.0 (In Development)

### Smart Face Management
*Details: See [Smart Ignore Implementation Plan](file:///j:/Projects/smart-photo-organizer/docs/smart-ignore-implementation-plan.md) for full technical specs.*

- **Background Face Filter (Phase 1):** Auto-identify and bulk-ignore "noise" faces (background strangers, one-time appearances). [See Changelog](aiChangeLog/phase-20-background-filter.md)
- **Scan-Time Confidence Tiering (Phase 2):** Auto-classify new faces at scan time into high-confidence, review, or unknown tiers. [See Changelog](aiChangeLog/phase-21-confidence-tiering.md)
- **Smart Ignore UI Panel (Phase 3):** Unified dashboard for managing thresholds and bulk actions. [See Changelog](aiChangeLog/phase-22-smart-ignore-panel.md)
- **Misassigned Face Detection (Phase 4):** Identify faces incorrectly assigned to a person using distance-to-centroid analysis. [See Changelog](aiChangeLog/phase-19-outlier-detection.md)
- **Challenging Face Recognition (Phase 5):** Improve matches for side profiles, partial faces, and occlusions using pose-aware matching and multi-sample voting. [See Changelog](aiChangeLog/phase-23-challenging-recognition.md)
- **Unified Person Name Input (Phase 6):** Standardize AI-powered name suggestions and autocomplete across all assignment interfaces. [See Changelog](aiChangeLog/phase-24-unified-input.md)

### Era & Stability Features (v0.5.0)
- **Era Generation (Phase E):** Visual clustering of faces into time-based eras for improved multi-age recognition. [See Changelog](aiChangeLog/phase-25-eras-and-settings.md)
- **Configurable Settings (Phase F):** UI controls for Era generation parameters (K-Means, Merge thresholds).
- **Test Backfill (Phase G):** Comprehensive unit tests added for FaceService, PersonService, and Repositories.
- **Fixes & QoL (Phase 26):** Fixed RAW Previews, Era Generation bugs, Clustering Thresholds, and improved UX feedback (Toasts). [See Changelog](aiChangeLog/phase-26-fix-raw-and-eras.md)
- **Clustering & Performance (Phase 27):** Fixed clustering logic (Metric Mismatch), optimized background detection speed (20x), added Face Debug tools, and optimized FAISS Index (sync tracking & alerts). [See Changelog](aiChangeLog/phase-27-clustering-optimization.md)

### Other Features
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
