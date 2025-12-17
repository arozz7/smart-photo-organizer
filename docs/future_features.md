# Future Features & Roadmap

## AI Enhancements

### 1. Hardware Compatibility Options
- **Goal:** Support generic PCs without dedicated NVIDIA GPUs.
- **Plan:**
    - Add "Force CPU" toggle in settings.
    - Support `FP32` mode (disable half-precision) for better compatibility with older hardware.
    - Explore ONNX Runtime execution for broader hardware support (AMD/Intel).

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

