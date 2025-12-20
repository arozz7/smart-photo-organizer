## Implemented Features

### Phase 2: User Interface Polish & Responsiveness
- **Goal:** Professional and consistent look across all states.
- **Status:** Complete (v0.2.1)
- **Implemented:**
    - **Clean Layouts:** Debloated configuration screens (tabbed interface for 'Configure AI Models').
    - **Responsive Controls:** Fixed UI control layout for flexible window sizing (Grid Layout).
    - **State Persistence:** Window size and position are saved and restored on startup.

## AI Enhancements

### 1. Hardware Compatibility & Performance
- **Goal:** Support generic PCs and maximize high-end hardware.
- **Plan:**
    - **Force Mode Selection:** Allow users to force "Enhanced (GPU)", "Standard (CPU)", or "Safe Mode".
    - **Multi-GPU Support:** Leverage multiple video cards for parallel processing if available.
    - **Generic PC Support:** Support `FP32` mode and explore ONNX Runtime for AMD/Intel support.

### 2. Face Restoration Configuration
- **Goal:** Allow users to control the "aggressiveness" of the face restoration.
- **Plan:**
    - Expose the `GFPGAN` blending weight parameter.
    - Add a "Restoration Strength" slider (0-100%) in the Enhance Lab UI.

### 3. Custom Models
- **Goal:** Allow advanced users to bring their own upscaling models.
- **Plan:**
    - Scan a user-accessible `models/` directory for `.pth` files.
    - Auto-detect model architecture (RealESRGAN vs GFPGAN) or allow manual selection.
    - Dropdown selection in Enhance Lab.

### 4. Batch Enhancement
- **Goal:** Enhance multiple photos in the background.
- **Plan:**
    - "Add to Enhance Queue" context menu action.
    - Background worker to process the queue sequentially.

## Creative Tools

### 5. Collage Creator
- **Goal:** Turn a set of photos into a single composition.
- **Plan:**
    - Auto-Layout: Masonry or Grid.
    - Face-Aware: Prevent cropping faces (using AI box).
    - Export as high-res JPG/PNG.

### 6. Face Dataset Export
- **Goal:** Export clean, cropped face images for training LORAs or contact photos.
- **Plan:**
    - Export face region + padding.
    - Filter by resolution and blur score (only high quality).
    - Organize folders by Person Name.

## Organization & Management

### 7. Batch Renaming & Cleanup
- **Goal:** Clean up the actual file system.
- **Plan:**
    - Rename using templates: `{YYYY}-{MM}-{DD}_{Location}_{OriginalName}`.
    - AI Renaming: `Dog_Playing_2024.jpg` using generated tags.
    - Deduplication: Find duplicates via perceptual hash.

### 8. Saved Smart Searches (Albums)
- **Goal:** Make "Create" view persistent.
- **Plan:**
    - Save filters (e.g., "Family in 2024") as "Smart Albums".
    - Auto-update as new photos are scanned.

### 9. Location Heatmap
- **Goal:** Visualize library on a map.
- **Plan:**
    - Show clusters on world map.
    - Auto-group into "Trips".

### 10. Library Analytics
- **Goal:** Visualize data.
- **Plan:**
    - Graphs: Photos per year/month.
    - Gear: Top Cameras/Lenses.
    - People: Who is photographed most?

### 11. Static Gallery Generator
- **Goal:** Share without cloud.
- **Plan:**
    - Generate static HTML site of an album.
    - Ready for GitHub Pages / S3.

## Cross-Platform

### 13. Mac & Linux Support
- **Goal:** Run the application on non-Windows OS.
- **Plan:**
    - Research options for agnostic AI Runtime (e.g., Docker, Python venv management on *nix).
    - ensure Electron build pipelines for Mac/Linux.

