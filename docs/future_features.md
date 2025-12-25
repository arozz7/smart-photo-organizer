# Future Features & Roadmap

## Next Priority: Face Management & Productivity
- **Goal:** Streamline the organization of unnamed faces.

### 2. Person Thumbnail Management
- **Goal:** Customize the representative image for a person and ensure variety.
- **Plan:**
    - **Pick Thumbnail:** "Set as Cover" button on any face in the Person Detail view.
    - **Smart Variety:** Algorithms to ensure the "Top 1000" faces (if limited) represent a diverse range of ages/looks using vector clusters, rather than just the most recent.
    - **"Shuffle" Cover:** Option to randomly select a high-quality (sharp, centered) face as the cover.

## Next Priority: Organization & Management

### 3. Advanced Library Filtering
- **Goal:** Combine multiple filter types with conditional logic.
- **Plan:**
    - **Compound Filters:** "AND/OR" logic to combine Person, Tag, Date, etc.
    - **New Filter Types:**
        - **Blur Score:** Filter by image sharpness/quality.
        - **Date:** Year/Month filtering (using EXIF with file creation date fallback).
    - **UI:** Advanced Search bar or "Builder" interface (simplified version of Create view).

### 3. Expanded Create View Integration
- **Goal:** Centralize creative tools and integrate with Library filters.
- **Plan:**
    - **Library Handoff:** "Create" button in Library view passes current active filters to the Create view.
    - **Unified Actions:** Integrate "Static Gallery Generator", "Collage Creator", and "Face Dataset Export" as output modes in the Create View.

## Next Priority: User Experience & Polish

### 4. Interactive Feedback System
- **Goal:** Provide clear visual confirmation and prevent race conditions during async actions.
- **Plan:**
    - **Optimistic UI:** Immediately hide/update elements (like ignored faces) while backend processes.
    - **Toasts/Notifications:** Unified system for success/error messages (e.g. "5 faces assigned to 'Mom'").
    - **Loading States:** Disable buttons and show spinners during active operations to prevent double-submissions.


---

## AI Enhancements

### 4. Hardware Compatibility & Performance
- **Goal:** Support generic PCs and maximize high-end hardware.
- **Plan:**
    - **Force Mode Selection:** Allow users to force "Enhanced (GPU)", "Standard (CPU)", or "Safe Mode".
    - **Multi-GPU Support:** Leverage multiple video cards for parallel processing if available.
    - **Generic PC Support:** Support `FP32` mode and explore ONNX Runtime for AMD/Intel support.

### v0.3.5 (Current)
- **Retrieve Ignored Faces:**
    - View, Manage, and Restore faces previously marked as ignored.
    - Includes "Group Similar" AI clustering to find patterns in the ignored pile.
    - Bulk Restore & Assign functionality.
    - Pagination for managing large numbers of ignored faces.

### 5. Face Restoration Configuration
- **Goal:** Allow users to control the "aggressiveness" of the face restoration.
- **Plan:**
    - Expose the `GFPGAN` blending weight parameter.
    - Add a "Restoration Strength" slider (0-100%) in the Enhance Lab UI.
    - **Filter Update:** Filter by "Is Enhanced" or "Has Restored Face".

### 6. Custom AI Models
- **Goal:** Allow advanced users to bring their own upscaling models.
- **Plan:**
    - Scan a user-accessible `models/` directory for `.pth` files.
    - Auto-detect model architecture (RealESRGAN vs GFPGAN) or allow manual selection.
    - Dropdown selection in Enhance Lab.
    - Provide link to model repository in 'Configure AI Models' card for source review.

## Performance & Reliability

### 7. Batch Enhancement
- **Goal:** Enhance multiple photos in the background.
- **Plan:**
    - "Add to Enhance Queue" context menu action.
    - Background worker to process the queue sequentially.

## Creative Tools

### 8. Collage Creator
- **Goal:** Turn a set of photos into a single composition.
- **Plan:**
    - Auto-Layout: Masonry or Grid.
    - Face-Aware: Prevent cropping faces (using AI box).
    - Export as high-res JPG/PNG.

### 9. Face Dataset Export
- **Goal:** Export clean, cropped face images for training LORAs or contact photos.
- **Plan:**
    - **On-the-Fly Extraction:** Generate high-res crops from source images using stored coordinates (since we don't save crops).
    - Export face region + padding.
    - Filter by resolution and blur score (only high quality).
    - Organize folders by Person Name.

## Organization & Management Tools

### 10. Batch Renaming & Cleanup
- **Goal:** Clean up the actual file system.
- **Plan:**
    - Rename using templates: `{YYYY}-{MM}-{DD}_{Location}_{OriginalName}`.
    - AI Renaming: `Dog_Playing_2024.jpg` using generated tags.
    - Deduplication: Find duplicates via perceptual hash.

### 11. Duplicate Photo Detection
- **Goal:** Find and manage exact duplicates and similar photos.
- **Design:** [Design Document](design_duplicates.md)
- **Plan:**
    - **Safe Deduplication:** Zero auto-delete policy.
    - **Methods:** SHA-256 for exact matches, pHash for visual similarity.
    - **Workflow:** Background scanning queue -> User Review UI.
    - **Stacking:** Group RAW+JPG versions instead of deleting.
    - **Filter Update:** Add "Is Duplicate" and "Is Stacked" filters.

### 12. Saved Smart Searches (Albums)
- **Goal:** Make "Create" view persistent.
- **Plan:**
    - Save filters (e.g., "Family in 2024") as "Smart Albums".
    - Auto-update as new photos are scanned.

### 13. Batch Tagging
- **Goal:** Quickly organize large sets of photos (e.g., "Trip to Paris").
- **Plan:**
    - Multi-select photos or use "Select All" in a Filtered View.
    - Context Menu: "Add Tags".
    - Batch remove tags.
    - **Filter Update:** Ensure "Has Tag" / "Missing Tag" filters are robust.

### 14. Exif Metadata Injection
- **Goal:** Write application tags back to the file headers (EXIF/IPTC/XMP) for interoperability.
- **Plan:**
    - "Write Tags to File" action (Individual & Bulk).
    - Support standard fields (IPTC Keywords, XMP Subject).
    - Sync filtered views to file metadata in bulk.
    - Context Menu: "Add Tags".
    - Batch remove tags.
    - **Filter Update:** Filter by "Metadata Sync Status" (Synced/Pending).

### 15. Location Heatmap
- **Goal:** Visualize library on a map.
- **Plan:**
    - Show clusters on world map.
    - Auto-group into "Trips".
    - **Filter Update:** filtering by "Map Bounds" (Visible Region).

### 16. Library Analytics (Expansion)
- **Goal:** More detailed visualization of data.
- **Plan:**
    - Graphs: Photos per year/month.
    - Gear: Top Cameras/Lenses.
    - People: Who is photographed most?

### 17. Static Gallery Generator
- **Goal:** Share without cloud.
- **Plan:**
    - Generate static HTML site of an album.
    - Ready for GitHub Pages / S3.

## Cross-Platform

### 18. Mac & Linux Support
- **Goal:** Run the application on non-Windows OS.
- **Plan:**
    - Research options for agnostic AI Runtime (e.g., Docker, Python venv management on *nix).
    - ensure Electron build pipelines for Mac/Linux.

## Integration & APIs

### 19. External Agent API
- **Goal:** Allow external agents (e.g. folder watchers, automations) to programmatically control the library.
- **Plan:**
    - **Local API Server:** Optional background REST server (configurable port).
    - **Authentication:** Localhost-only binding with optional API Key.
    - **Endpoints:**
        - `POST /api/v1/scan`: Trigger a scan for a specific file or folder.
        - `POST /api/v1/tag`: Apply specific tags to a photo ID.
        - `GET /api/v1/status`: Check if the system is busy (scanning/processing).
        - `POST /api/v1/capture`: Register a new file into the database (without full scan).

### 20. Containerized Backend (Docker)
- **Goal:** Decouple the backend to run in Docker, enabling remote agents and consistent environments.
- **Plan:**
    - Dockerize the Python backend (FastAPI/Flask).
    - Expose API port for Frontend and Agents.
    - **Performance Considerations:**
        - **GPU Access:** Critical dependency. Requires NVIDIA Container Toolkit on host.
        - **Filesystem:** Volume mounts must be optimized for random read access to large photo libraries.

---
---

# Implemented Features

## Core Intelligence (v0.3.0)

### Smart Face Storage (Optimization)
- **Status:** Complete (v0.3.0)
- **Implemented:**
    - Store vectors as Binary (BLOB).
    - **Vector Pruning:** Only save face vectors for "Unknown" faces. Discard vectors for confirmed matches (saving only the Person ID).
    - **On-Demand Crops:** Ensure no face thumbnails are written to disk; extract on-the-fly for UI.

### High-Performance Face Clustering
- **Status:** Complete (v0.3.0)
- **Implemented:**
    - Moved clustering logic from Frontend (CPU-bound JS) to Backend (Python).
    - Uses DBSCAN algorithm for efficient grouping.
    - Optimized SQL queries to fetch only necessary descriptors.

### Processing Metrics & History
- **Status:** Complete (v0.3.0)
- **Implemented:**
    - `scan_history` table tracks per-photo processing stats (scan time, tag time).
    - "Recent Activity" dashboard in Queues view.
    - "Average Time per Item" calculation based on actual historical data.

### AI Runtime Polish (First Run)
- **Status:** Complete (v0.3.0)
- **Implemented:**
    - Clearer validation feedback during download & extraction.
    - "Restart Required" prompt after runtime installation.
    - Robust protocol handling for loading images during active scans.

## User Experience & Workflow (v0.3.0)
- **Status:** Complete (v0.3.0)
- **Implemented:**
    - **Full Photo Context:** "View Original Photo" button on face crops.
    - **Targeted Scanning:** "Scan for [Person]" and "Scan All Named Persons" actions.
    - **Folder Navigation:** "Go to Folder" from Photo Detail modal.
    - **Declutter Photo Viewer:** Option to hide "Unnamed" faces tags/boxes.
    - **Multi-Select Groups:** Select multiple face clusters to name them all at once.
    - **Blurry Face Assignment:** Assign "Low Quality" faces to a person directly from the cleanup tool.

## Previous Phases

### Phase 2: User Interface Polish & Responsiveness (v0.2.1)
- **Implemented:**
    - **Clean Layouts:** Debloated configuration screens.
    - **Responsive Controls:** Fixed UI control layout for flexible window sizing.
    - **State Persistence:** Window size and position are saved and restored.

### Phase 2b: Organization Tools
- **Implemented:**
     - **Manual Image Rotation:**
          - "Rotate Left/Right" buttons in Photo Detail view.
          - Updates file metadata (removes EXIF Orientation tag).
          - Updates cached previews immediately.

### Library Analytics (Basics)
- **Implemented:**
  - **Scanning History:** Database now tracks performance metrics per photo.
  - **Performance Dashboard:** `Queues` view now displays "Recent Activity" and detailed stats.
