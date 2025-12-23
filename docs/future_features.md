# Future Features & Roadmap

## Next Priority: UX & Identification Workflow
- **Goal:** Improve the context and efficiency of naming people.

### 1. Full Photo Context for Face Crops [COMPLETED]
- **Plan:**
    - Add "View Original Photo" button to all face crops (Named & Unnamed).
    - Allow users to quickly review the source photo to confirm identification context.

### 2. Targeted Person Scanning [COMPLETED]
- **Plan:**
    - **Per-Person:** "Scan for [Person]" button in Person Detail page.
    - **Global:** "Scan for All Named Persons" in People view (prioritizing matching against Unnamed list).
    - **Options:** Scan complete library, specific folders, or only existing unnamed faces.

### 3. Folder Navigation from Modal [COMPLETED]
- **Plan:**
    - Add "Go to Folder" option in the Photo Detail modal.
    - Automatically opens the Library view filtered to the specific folder.

### 4. Declutter Photo Viewer [COMPLETED]
- **Plan:**
    - Option to hide "Unnamed" face tags/boxes in the photo preview.
    - Focus only on Identified people to reduce clutter in group shots.

---

## Implemented Features

### Phase 2: User Interface Polish & Responsiveness
- **Goal:** Professional and consistent look across all states.
- **Status:** Complete (v0.2.1)
- **Implemented:**
    - **Clean Layouts:** Debloated configuration screens (tabbed interface for 'Configure AI Models').
    - **Responsive Controls:** Fixed UI control layout for flexible window sizing (Grid Layout).
    - **State Persistence:** Window size and position are saved and restored on startup.

### Phase 2b: Organization Tools
- **Implemented:**
     - **Manual Image Rotation:**
          - "Rotate Left/Right" buttons in Photo Detail view.
          - Updates file metadata (removes EXIF Orientation tag after baking rotation).
          - Updates cached previews and thumbnails immediately.

## AI Enhancements

### 1. Smart Face Storage (Optimization)
- **Goal:** Minimize database size and avoid saving unnecessary face data.
- **Status:** Partially Implemented (v0.2.2)
- **Implemented:**
    - Store vectors as Binary (BLOB).
- **Plan:**
    - **Vector Pruning:** Only save face vectors for "Unknown" faces and "Reference" examples. Discard vectors for confirmed matches (saving only the Person ID).
    - **On-Demand Crops:** Ensure no face thumbnails are written to disk; extract on-the-fly for UI.

### 2. Hardware Compatibility & Performance
- **Goal:** Support generic PCs and maximize high-end hardware.
- **Plan:**
    - **Force Mode Selection:** Allow users to force "Enhanced (GPU)", "Standard (CPU)", or "Safe Mode".
    - **Multi-GPU Support:** Leverage multiple video cards for parallel processing if available.
    - **Generic PC Support:** Support `FP32` mode and explore ONNX Runtime for AMD/Intel support.

### 3. Face Restoration Configuration
- **Goal:** Allow users to control the "aggressiveness" of the face restoration.
- **Plan:**
    - Expose the `GFPGAN` blending weight parameter.
    - Add a "Restoration Strength" slider (0-100%) in the Enhance Lab UI.
    - **Filter Update:** Filter by "Is Enhanced" or "Has Restored Face".

## Performance & Reliability (v0.3.0)

### 1. High-Performance Face Clustering
- **Goal:** Handle large libraries (10k+ faces) without UI freezes.
- **Status:** Complete (v0.3.0)
- **Implemented:**
    - Moved clustering logic from Frontend (CPU-bound JS) to Backend (Python).
    - Uses DBSCAN algorithm for efficient grouping.
    - Optimized SQL queries to fetch only necessary descriptors.

### 2. Processing Metrics & History
- **Goal:** Provide visibility into system performance and scan history.
- **Status:** Complete (v0.3.0)
- **Implemented:**
    - `scan_history` table tracks per-photo processing stats (scan time, tag time).
    - "Recent Activity" dashboard in Queues view.
    - "Average Time per Item" calculation based on actual historical data.

### 3. AI Runtime Polish
- **Goal:** Improve the first-run experience.
- **Status:** Complete (v0.3.0)
- **Implemented:**
    - Clearer validation feedback during download & extraction.
    - "Restart Required" prompt after runtime installation.
    - Robust protocol handling for loading images during active scans.
- **Goal:** Allow advanced users to bring their own upscaling models.
- **Plan:**
    - Scan a user-accessible `models/` directory for `.pth` files.
    - Auto-detect model architecture (RealESRGAN vs GFPGAN) or allow manual selection.
    - Dropdown selection in Enhance Lab.
    - Provide link to model repository in 'Configure AI Models' card for source review.

### 5. Batch Enhancement
- **Goal:** Enhance multiple photos in the background.
- **Plan:**
    - "Add to Enhance Queue" context menu action.
    - Background worker to process the queue sequentially.

## Creative Tools

### 6. Collage Creator
- **Goal:** Turn a set of photos into a single composition.
- **Plan:**
    - Auto-Layout: Masonry or Grid.
    - Face-Aware: Prevent cropping faces (using AI box).
    - Export as high-res JPG/PNG.

### 7. Face Dataset Export
- **Goal:** Export clean, cropped face images for training LORAs or contact photos.
- **Plan:**
    - **On-the-Fly Extraction:** Generate high-res crops from source images using stored coordinates (since we don't save crops).
    - Export face region + padding.
    - Filter by resolution and blur score (only high quality).
    - Organize folders by Person Name.

## Organization & Management



### 9. Batch Renaming & Cleanup
- **Goal:** Clean up the actual file system.
- **Plan:**
    - Rename using templates: `{YYYY}-{MM}-{DD}_{Location}_{OriginalName}`.
    - AI Renaming: `Dog_Playing_2024.jpg` using generated tags.
    - Deduplication: Find duplicates via perceptual hash.

### 10. Duplicate Photo Detection
- **Goal:** Find and manage exact duplicates and similar photos.
- **Design:** [Design Document](design_duplicates.md)
- **Plan:**
    - **Safe Deduplication:** Zero auto-delete policy.
    - **Methods:** SHA-256 for exact matches, pHash for visual similarity.
    - **Workflow:** Background scanning queue -> User Review UI.
    - **Stacking:** Group RAW+JPG versions instead of deleting.
    - **Filter Update:** Add "Is Duplicate" and "Is Stacked" filters.

### 11. Saved Smart Searches (Albums)
- **Goal:** Make "Create" view persistent.
- **Plan:**
    - Save filters (e.g., "Family in 2024") as "Smart Albums".
    - Auto-update as new photos are scanned.

### 12. Batch Tagging
- **Goal:** Quickly organize large sets of photos (e.g., "Trip to Paris").
- **Plan:**
    - Multi-select photos or use "Select All" in a Filtered View.
    - Context Menu: "Add Tags".
    - Batch remove tags.
    - **Filter Update:** Ensure "Has Tag" / "Missing Tag" filters are robust.

### 13. Exif Metadata Injection
- **Goal:** Write application tags back to the file headers (EXIF/IPTC/XMP) for interoperability.
- **Plan:**
    - "Write Tags to File" action (Individual & Bulk).
    - Support standard fields (IPTC Keywords, XMP Subject).
    - Sync filtered views to file metadata in bulk.
    - Context Menu: "Add Tags".
    - Batch remove tags.
    - **Filter Update:** Filter by "Metadata Sync Status" (Synced/Pending).

### 14. Location Heatmap
- **Goal:** Visualize library on a map.
- **Plan:**
    - Show clusters on world map.
    - Auto-group into "Trips".
    - **Filter Update:** filtering by "Map Bounds" (Visible Region).

### 15. Library Analytics
- **Goal:** Visualize data.
- **Status:** Partially Implemented (v0.3.0)
- **Implemented:**
  - **Scanning History:** Database now tracks performance metrics per photo.
  - **Performance Dashboard:** `Queues` view now displays "Recent Activity" and detailed stats.
- **Plan:**
    - Graphs: Photos per year/month.
    - Gear: Top Cameras/Lenses.
    - People: Who is photographed most?

### 16. Static Gallery Generator
- **Goal:** Share without cloud.
- **Plan:**
    - Generate static HTML site of an album.
    - Ready for GitHub Pages / S3.

## Cross-Platform

### 17. Mac & Linux Support
- **Goal:** Run the application on non-Windows OS.
- **Plan:**
    - Research options for agnostic AI Runtime (e.g., Docker, Python venv management on *nix).
    - ensure Electron build pipelines for Mac/Linux.


## Integration & APIs

### 18. External Agent API
- **Goal:** Allow external agents (e.g. folder watchers, automations) to programmatically control the library.
- **Plan:**
    - **Local API Server:** Optional background REST server (configurable port).
    - **Authentication:** Localhost-only binding with optional API Key.
    - **Endpoints:**
        - `POST /api/v1/scan`: Trigger a scan for a specific file or folder.
        - `POST /api/v1/tag`: Apply specific tags to a photo ID.
        - `GET /api/v1/status`: Check if the system is busy (scanning/processing).
        - `POST /api/v1/capture`: Register a new file into the database (without full scan).

### 19. Containerized Backend (Docker)
- **Goal:** Decouple the backend to run in Docker, enabling remote agents and consistent environments.
- **Plan:**
    - Dockerize the Python backend (FastAPI/Flask).
    - Expose API port for Frontend and Agents.
    - **Performance Considerations:**
        - **GPU Access:** Critical dependency. Requires NVIDIA Container Toolkit on host.
        - **Filesystem:** Volume mounts must be optimized for random read access to large photo libraries.
