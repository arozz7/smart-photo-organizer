# Product Roadmap & Feature Backlog

This document tracks planned features and ideas for the Smart Photo Organizer. Usage: Mark items as compiled `[x]` as we enable them.

## 🟢 Phase 1: AI & Organization (Current Focus)

### 6. ✨ AI Enhancement Station (In Progress)
**Goal:** Improve photo quality locally using dedicated AI models.
- [x] **Upscaling:** Use models like Real-ESRGAN to increase resolution of old/cropped photos.
- [x] **Face Restoration:** Fix blurry or grainy faces (GFPGAN).
- [ ] **Colorization:** Auto-color black & white archival photos.
- [ ] **Denoising:** Reduce ISO noise in low-light shots (considering SwinIR).

### 2. 👤 Face Dataset Export
**Goal:** Export clean, cropped face images (useful for training AI models or contact photos).
- [ ] **Face Crop:** Export just the face region (plus padding).
- [ ] **Filtering:** Minimum resolution, blur score filtering (only clear faces).
- [ ] **Normalization:** Option to resize all to 512x512 or 1024x1024.
- [ ] **Structure:** Organizing folders by Person Name.

### 3. 📂 Batch Renaming & Organization
**Goal:** Clean up the actual file system.
- [ ] **Templates:** Rename files using patterns like `{YYYY}-{MM}-{DD}_{Location}_{OriginalName}`.
- [ ] **AI-Based:** Rename based on primary subject (e.g., `Dog_Playing_2024.jpg`).
- [ ] **Deduplication:** Find and remove duplicate files (using image hashing).

---

## 🟡 Phase 2: Visualization & Search

### 1. 🖼️ Collage Creator
**Goal:** Turn a set of photos into a single composition.
- [ ] **Auto-Layout:** Automatically arrange selected photos in a grid or masonry layout.
- [ ] **Face-Centric:** Use AI face bounding boxes to ensure faces aren't cropped out.
- [ ] **Customization:** Adjust spacing, background color, and aspect ratio (e.g., Instagram Story vs Desktop Wallpaper).
- [ ] **Export:** Save as a high-res JPG/PNG.

### 5. 🗺️ Location Heatmap
**Goal:** Visualize library on a map.
- [ ] **Clustering:** Show clusters of photos on a world map.
- [ ] **Trip Detection:** Auto-group photos into "Trips" based on location + date.
- [ ] **Map View:** dedicated library view mode.

### 8. 📊 Library Analytics
**Goal:** Visualize your data.
- [ ] **Stats:** Graphs showing photos taken per year/month.
- [ ] **Gear:** Most used Cameras and Lenses.
- [ ] **Top People:** Who do you photograph the most?

---

## 🔵 Phase 3: Sharing & Retention

### 4. 🧠 Saved Smart Searches (Smart Albums)
**Goal:** Make the "Create" view persistent.
- [x] **Set Builder:** Basic search and export functionality implemented in v0.2.0.
- [ ] **Save Query:** Save a complex filter (e.g., "Family in 2024") as a named "Smart Album".
- [ ] **Auto-Update:** As new photos are scanned, they automatically appear in relevant Smart Albums.

### 7. 📅 Memories & Timeline
**Goal:** Rediscover forgotten moments.
- [ ] **"On This Day":** Show photos from the same date in previous years.
- [ ] **Auto-Stories:** Generate thematic slideshows (e.g., "Summer 2023") with music syncing.

### 9. 🕸️ Static Gallery Generator
**Goal:** Share without the cloud.
- [ ] **HTML Export:** Generate a static website (HTML/JS) of a selected Set or Album.
- [ ] **Self-Hostable:** Ready to upload to S3, GitHub Pages, or a Raspberry Pi.
