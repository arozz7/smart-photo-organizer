# Smart Photo Organizer - User Manual

Welcome to the **Smart Photo Organizer**! This guide will help you navigate the various features and tools available to help you organize, enhance, and rediscover your photo library—all locally and privately on your machine.

---

## 🚀 1. Getting Started: First Launch

When you first open the application, you'll need to tell it where to store its data and where your photos are.

1.  **Select Library Path:** Go to the **Settings** tab. Here you can choose a directory where the application will store its database, preview images, and AI indices. 
    > [!TIP]
    > Choose a drive with plenty of space if you have a large photo library, as preview images can take up significant storage over time.
2.  **Add Photo Folders:** Click **"Select Photo Folder"** to choose the root directory where your photos are stored.
3.  **Initial Scan:** Click **"Scan Library"** in the sidebar. 
    - **Scan (Default):** Runs an incremental scan, skipping files already in the database.
    - **Force Rescan (Dropdown):** Click the arrow next to the button to **Force Rescan**. This checks every file, regenerates previews if missing, and queues everything for AI analysis.
        - **Scanning Indicator:** The button will show a spinner ("Scanning...") while the analysis is active. This process runs in the background.
    - **RAW Support:** The app natively supports Professional RAW formats (NEF, CR2, ARW). If a RAW decoder fails (e.g., "Unsupported file format"), the system automatically falls back to using the embedded preview image, ensuring your photo is always visible and analyzable.


---

## 🏠 2. Home Dashboard

Your personal command center for your photo library.

- **On This Day:** Relive memories from this exact date in previous years. Uses the actual photo capture date (from EXIF metadata), not the import date.
- **Library Stats:** Visualize your collection growth and composition.
- **People Spotlight:** Quick access to your top-identified people.
- **Recent Activity:** See the latest photos scanned or imported.
- **Fun Facts:** Discover interesting insights about your library (peak year, busiest day, most-used camera, and more).
- **Photo Timeline:** Interactive bar chart showing photo counts by year. Click a year to drill down into monthly counts, then click a month to jump directly to the **Search** view filtered to that time period.
- **Library Health:** A visual health gauge showing your library's processing completeness, with an error breakdown by scan stage and a CSV export option for diagnostics.
- **Photo Collage:** Auto-generated collage from your "On This Day" memories (or best library photos as fallback). Choose from three layout modes — **Grid** (2x2 or 3x3), **Feature** (one hero + supporting photos), or **Mosaic** (variable-height masonry). Click **Regenerate** to shuffle photos, or **Export PNG** to save the collage to disk.
- **Location Heatmap:** A world map showing where your photos were taken. GPS coordinates from your photos' EXIF metadata are clustered and displayed as color-coded dots (blue = few photos, orange = many). Hover over a dot to see the count and approximate coordinates. Photos without GPS data are simply ignored. Enable via the **Power** preset or the Customize modal.
- **Scan Entertainment:** Watch live updates and memory flashbacks while you scan.

### Widget Layout
- **Drag-and-Drop Reorder:** Hover over any widget to reveal a **grip icon** (top-right). Drag and drop widgets to rearrange your dashboard layout. Your custom order is automatically saved.
- **Snap-to-Grid Resize:** Stat-type widgets (Library Stats, Fun Facts, Library Health, etc.) show a **resize handle** (bottom-right corner) on hover. Drag to resize — widgets snap to column widths of 4, 8, or 12 columns. Some widgets like Scan Entertainment and On This Day always span full width.

**Customization:** Click the **Gear Icon** in the dashboard header to toggle individual widgets on/off, or choose from layout presets (**Minimal**, **Balanced**, **Power User**).

> [!NOTE]
> **Date Accuracy:** All date-based dashboard features (On This Day, Fun Facts, Timeline) use the `date_taken` field, which is sourced from EXIF metadata (`DateTimeOriginal`, `CreateDate`, or `MediaCreateDate`). If no EXIF date is available, the file's filesystem creation date is used as a fallback. This ensures your memories and statistics reflect when photos were actually taken, not when they were imported into the library.

---

## 🖼️ 3. Library View: Interacting with Your Photos

The **Library** allows you to browse and manage your entire photo collection. 

-   **Grid Navigation:** Scroll through your entire library smoothly. Use the **Date Filter** in the sidebar to jump to specific years or months.
-   **Active Filter Chips:** When filters are applied (folder, person, date, tag), they appear as removable pills in the Library header. Click the **×** on any chip to remove that individual filter without clearing the rest.
-   **Folder Disambiguation:** Folder filter pills show the last two path segments (e.g., `2024 / Birthday`) rather than just the leaf name, so duplicate folder names are distinguishable.
-   **Photo Details:** Click any photo to open the full-screen detail view, showing a large preview, EXIF metadata (camera, lens, ISO), people detected, and AI-generated tags.
    -   **Navigation:** Use the **← / →** arrow buttons on the sides of the photo, or press `←` / `→` arrow keys to move between photos.
    -   **Closing:** Click the **✕ Close** button in the top-left corner, or press `ESC`.
-   **Scan Errors:** If photos fail to scan (corrupt files, unsupported formats, etc.), a red error badge appears in the Library header. Click it to open the **Scan Errors Modal**:
    -   **Export CSV:** Download all errors as a CSV file (`scan-errors-YYYY-MM-DD.csv`) with columns for File Path, Error Type, Error Message, Scan Type, and Timestamp. Useful for diagnosing issues or sharing with support.
    -   **Retry All:** Re-queue all failed photos for AI processing. The app will attempt to scan them again with the current settings.
    -   **Clear List:** Remove all errors from the database. Use this after you've fixed the underlying issues (e.g., moved corrupt files, updated codecs).
-   **Context Menu:** Right-click a photo to:
    -   **Enhance:** Open the photo in the AI Enhance Lab.
    -   **Delete:** Remove the photo from the database (does not delete the original file).
    -   **Re-scan:** Force the AI to re-analyze the photo.
    -   **Force Face Scan:** In the Photo Detail view, if no faces are found, click the "Force Face Scan" button (or the magnifying glass icon) to run a high-sensitivity MACRO scan. This is useful for finding small faces or faces in difficult lighting. The button will disable and spin until the scan is complete.

---

## 👤 4. People Management: Organizing Faces

The AI automatically detects faces during the scan. Your job is to give them names!

1.  **Unnamed Faces:** Go to the **People** tab. You'll see groups of similar looking faces that haven't been named yet.
2.  **Naming:** Click a group, type a name (e.g., "Mom"), and hit Enter. The AI will now know what "Mom" looks like and will attempt to auto-assign her to other photos.
3.  **Merging:** If you accidentally created two entries for the same person (e.g., "John" and "John Doe"), simply rename one to match the other. The app will ask if you want to **merge** them.
    - **Performance:** Optimized to handle selecting thousands of faces without slowing down.
    - **RAW Support:** View original "Context" photos even for RAW files (ARW, CR2, etc.).
    - **Confidence Tiers & Visual Indicators:**
        - **Green Ring:** High confidence match (75%+ similarity). The AI has automatically assigned this face.
        - **Amber Ring:** Suggestions requiring review (60-75% similarity). Click "Accept" to confirm.
        - **'?' Badge:** Weak matches or side-profile detections that require manual verification.
        - **No Ring:** Unknown faces with no close matches in your library.
5.  **Refining Groups:**
    - **Ungroup:** If a suggested group contains mixed faces, click the **"Ungroup"** button on the row to break it apart and return the faces to the "Unmatched" pool for individual sorting.
    - **Group by AI Suggestion:** Switch to this mode to have the AI automatically group faces by who it thinks they are.
        - **Smart Grouping:** The AI preserves coherent clusters (e.g., 50 faces from the same event) and tags the entire group with a suggestion (e.g., "Suggested: Mom").
        - **Bulk Action:** Clicking "Accept" on a group assigns **all** faces in that cluster at once.
## ⚡ 4.1 High-Density Review UX (Power Users)
When managing libraries with 10,000+ unnamed faces, use these tools to speed up your workflow:

#### ⌨️ Keyboard Navigation
*   `Arrow Keys` / `J` / `K`: Move focus between groups.
*   `A`: **Accept Suggestion** (names the group and moves to next).
*   `N`: **Open Naming Modal** (manual naming).
*   `X`: **Ignore Group** (hides from view).
*   `/`: Quick-start keyboard focus.

#### 🔍 Filtering & Searching
*   **Progressive Loading:** Scroll down to the bottom of the list and click **"Show More"** to load the next 100 groups. This keeps the interface fast while managing massive datasets.
*   **Cluster Size Filters:** Toggle buttons in the toolbar to focus on **Large (10+)**, **Medium (5-9)**, or **Small (2-4)** groups.
*   **Find Ungroupable Faces:** A specialized tool to find faces that definitely *don't* belong to your current people.
*   **View Original Photo:** Hover over any face thumbnail — including ungrouped single faces — to reveal an eye icon button. Click it to open the full photo in the Photo Detail view.

> [!IMPORTANT]
> **Understanding Filters: Background vs. Ungroupable**
> *   **Background Filter:** A "trash disposal" for mass noise. It finds people who only appear once or twice in your library (strangers in crowds, blurry background faces) so you can bulk-ignore them.
> *   **Ungroupable Search:** A "sorting tool" to find potential new people. It looks for faces that have clear AI data but are far (distant) from your *Identified People*.

### 🧠 4.2 Automated Suggestions & Discoveries
The app works in the background to organize your photos even when you aren't naming them.
- **Suggestion Buckets:** Groups of faces that match people you've already named. Click "Confirm" to accept them all at once.
- **Discovery Buckets:** New groups of unknown people found by the AI. You can name these groups to create a new Person.
- **Cleaning Groups:** If a group has mixed faces, you can select individual faces to name them correctly, or click "Ungroup" to dissolve the bucket.

6.  **Ignored Faces:** Managing ignored faces is easy. Open the Ignored Faces modal to review hidden faces. 
    - **Group Similar**: Automatically cluster the "ignored" pile to quickly find accidental ignores.
    - **Sensitivity Slider**: Use the slider to increase matching sensitivity if you don't see suggestions for blurry or lower-quality photos.
    - **AI Readiness**: Look for small **green dots** on the thumbnails; these indicate that the face has high-quality AI fingerprint data ready for matching.
    - **Restore as [Name]**: One-click action to restore and correctly name faces simultaneously.
7.  **Quality Control:**
    - **Review All Faces:** Click **"Review All"** on a Person's detail page to see every assigned face in a scrollable grid. You can bulk-select faces to Confirm, Move, or Ignore them.
    - **Misassigned Faces:** Click **"More Actions > Find Misassigned"** to scan for outliers (faces that look different from the person's typical model).
    - **Audit Confirmed Faces:** Select **"Find Misassigned (Audit Confirmed)"** from the dropdown to re-evaluate previously confirmed faces. This helps catch incorrect assignments that might have slipped through as the person's model evolved.

8.  **Face Index Maintenance:**
    - **Stale Index Alert:** If you see an amber "Face Index Needs Update" banner on the "Identified People" tab, it means faces have been removed or reassigned, and the search index is out of date.
    - **Rebuild Index:** Click the **"Rebuild Index"** button on the banner to refresh the AI search index. This is quick (usually < 10 seconds) and ensures accurate duplicate detection.

### 🔧 4.2.1 Clustering Settings (Regroup)

The **Regroup** button in the Discoveries toolbar opens the Clustering Settings modal, which lets you control how the AI groups unnamed faces together.

#### Similarity Threshold
Controls how similar two faces must be to be placed in the same group.

| Value | Effect |
|-------|--------|
| **Low (0.40–0.55)** | More groups, looser matching — catches similar faces even across lighting/pose variation |
| **Medium (0.60–0.70)** | Balanced default — good for most libraries |
| **High (0.75–0.95)** | Fewer, stricter groups — only the most visually identical faces cluster together |

> Internally, this maps to DBSCAN's epsilon (neighborhood radius). A threshold of `0.68` means faces must have ≥ 68% similarity to be considered neighbors.

#### Cluster Purity
Controls how internally consistent a group must be to survive. This catches "chain-linked" clusters where face A looks like face B, face B looks like face C, but A and C are actually different people.

| Value | Effect |
|-------|--------|
| **Low (0.40–0.55)** | Strict purity — breaks up groups with any outlier members. More singles. |
| **Medium (0.60–0.80)** | Balanced default (0.75) — eliminates obvious mixed groups |
| **High (0.85–1.00)** | Loose — allows more spread within a group. Use if same-person groups are being over-split. |

> If you see groups that contain faces of clearly different people, lower the Cluster Purity value and run Regroup again.

#### Advanced Options

| Option | Description |
|--------|-------------|
| **Exclude Background Noise** | Before clustering, filters out faces that appear very infrequently and don't match any named person. Reduces crowd-extra/stranger faces from polluting groups. |
| **Group by AI Suggestion** | After clustering, merges groups that the AI believes belong to the same already-named person. Useful for quickly assigning many faces at once. |

#### Troubleshooting: Rebuild Face Search Index
If the "Group by AI Suggestion" mode returns no suggestions, use **Rebuild Face Search Index** in the Troubleshooting section of this modal. This refreshes the FAISS vector index used for person matching.

---

## ⏳ 4.3 Era Generation (Advanced)
Some people change significantly over time (e.g., from child to adult). A single facial model might struggle to match both "Baby Nick" and "Adult Nick" accurately.

1.  **Generate Eras:** On a Person's detail page, click the **"Generate Eras"** button (Clock icon).
2.  **Visual Clustering:** The AI will analyze all confirmed faces and group them into "Eras" based on visual similarity.
3.  **Result:** You will see a list of eras (e.g., "Era 1: 2010-2015", "Era 2: 2020-2024").
4.  **Benefits:** Future scans will match against **all** era centroids, significantly improving recognition for people with large age gaps in your library.
5.  **Configuration:** You can fine-tune how eras are created in **Settings > Era Generation** (Min Faces, Merge Threshold).

> [!NOTE]
> **Prerequisite:** Era Generation requires advanced face data (Pose & V2 Embeddings). If this feature is disabled or inaccurate, please go to **Settings > Database Management** and run the **Face Data Upgrade**.

### 🤖 4.4 How Face Recognition Works

Understanding how the AI identifies faces can help you interpret confidence indicators and improve your workflow.

#### The Technology
The app uses **InsightFace**, a state-of-the-art face analysis library:
- **RetinaFace** (Detection): Finds faces in photos, even at angles or partially hidden
- **ArcFace** (Recognition): Creates a unique 512-dimensional "fingerprint" for each face
- **FAISS** (Matching): Rapidly searches through thousands of face fingerprints to find matches

#### Why Some Faces Are Harder to Match
Not all faces are equally easy to recognize:

| Face Type | Recognition Difficulty | What You'll See |
|-----------|----------------------|-----------------|
| **Frontal, well-lit** | Easy ✅ | High confidence (green ring) |
| **Side profile (45°+)** | Moderate ⚠️ | May appear as suggestion (amber) or unknown |
| **Top-down / back of head** | Very Hard ❌ | Likely unmatched; may need manual assignment |
| **Blurry / low resolution** | Hard | Lower confidence or flagged as "blurry" |
| **Occluded (sunglasses, mask)** | Hard | May not detect or low confidence match |

> [!TIP]
> For people with many side-profile photos, use **Generate Eras** to create multiple reference models. This helps the AI recognize them from different angles.

#### Contextual Clues
When the AI can't visually match a face (e.g., top-down view), you can use context:
- Photos taken within minutes of each other likely contain the same people
- Use **Session Grouping** to see faces from the same photo session together
- Manually assign hard cases based on your knowledge of the event

---

## 🔎 5. Search & Filtering

The **Search** view provides advanced tools for finding specific photos across your entire library.

### Getting Started
Click the **Search** tab in the navigation bar. You'll see a filter sidebar on the left and an empty grid area. Apply any filter to start seeing results.

### Filter Sidebar
The sidebar is organized into collapsible sections:

- **Search:** Free-text search across file names, tags, and descriptions.
- **Quality (Blur):** Filter by photo sharpness. Use the presets (**Sharp**, **Medium**, **Blurry**) or enter custom min/max blur scores.
- **Date:** Filter by **Year** and/or **Month** dropdowns, or specify a custom date range with **From** and **To** fields.
- **Camera:** Filter by camera model (populated from your library's EXIF data).
- **File Type:** Filter by image format (JPEG, PNG, RAW, etc.).
- **Faces:** Toggle filters for photos with/without faces, unnamed faces only, frontal faces only, minimum face quality, and confidence tier (High, Review, Unknown).
- **Folder / Tag / Person:** Filter by folder path, AI-generated tag, or identified person.
- **Advanced (Compound Filters):** Open the compound filter builder to create AND/OR/NOT logic across multiple conditions.

### Active Filter Chips
Applied filters appear as chips in the top bar. Click the **x** on any chip to remove that filter, or click **Clear all** to reset everything.

### Sorting
Use the dropdown in the top-right to sort results by **Newest**, **Oldest**, **Name A-Z**, or **Name Z-A**.

### Compound Filter Builder
Click **Open Compound Builder** in the Advanced section to build complex queries:
1. Add **groups** of conditions (e.g., "Person is Alice AND Year is 2024").
2. Toggle each group between **AND** / **OR** logic.
3. Use the **Exclude** toggle on individual conditions for NOT logic.
4. Combine multiple groups with a top-level AND/OR operator.

### Smart Albums
Save your current filter configuration as a **Smart Album** for quick reuse:
1. Apply your desired filters.
2. In the **Smart Albums** section of the sidebar, type a name and click **Save**.
3. To reload, select a saved album from the list.
4. Click the **delete** button next to an album to remove it.

> [!NOTE]
> **Blur scores** are computed during photo scanning. If you imported photos before v0.6.5, go to **Settings > Database Management** and rescan your library to populate blur data for the Quality filter.

---

## 🪄 6. AI Enhance Lab: Upgrading Your Memories


Found an old, blurry, or low-resolution photo? Use the **Enhance Lab**.

1.  **Open Lab:** Click the magic wand icon on any photo.
2.  **Choose a Task:**
    -   **Upscale (x4):** Increases resolution for crisp details.
    -   **Restore Faces:** Fixes grainy or "melted" faces in old photos.
3.  **Model Selection:** Use "General" for standard photos and "Anime" for illustrations or cartoons.
### 💻 Hardware Requirements & Performance
AI enhancement is a computationally intensive task. For the best experience:
- **NVIDIA GPU (Recommended):** A modern NVIDIA GPU with **at least 2GB of VRAM** will provide the fastest results (seconds vs minutes). **Note:** Requires downloading the **AI GPU Runtime** (see Section 7).
- **CPU Fallback:** The app will work on systems without a GPU or if the runtime is not downloaded. Processing will be slower but functional.
- **Memory (RAM):** We recommend at least **16GB of system RAM** for processing large RAW files.
- **Tagging (VLM):** Requires the **AI GPU Runtime** to be installed. Not available on CPU-only mode.

### 🧬 Model Selection & Downloading
To keep the initial app size small (~400MB), the large AI models and runtimes are managed via the **Manage Models** UI:
- **AI GPU Runtime:** To enable your NVIDIA card, you must download the GPU Runtime engine (approx 5GB) from the **Settings > Manage Models** menu.
- **On-Demand Models:** Weights for Real-ESRGAN or GFPGAN (and other enhancement models) are downloaded the first time you use them. You can also manually trigger downloads in the Enhance Lab if you encounter a "Model Not Found" error.
- **General (Real-ESRGAN x4 Plus):** The best all-rounder for photographs. It excels at removing noise and reconstructing natural textures.
- **Anime (Real-ESRGAN x4 Plus Anime):** Specifically tuned for illustrations, cartoons, and drawings. It preserves sharp edges and flat colors without adding realistic photographic noise.

4.  **Preview & Save:** Use the slider to compare the result with the original. If you like it, the enhanced version is automatically saved in the same folder as the original.

---

## 🎨 7. Create & Export: Building Sets

The **Create** view is for when you want to gather specific photos for a project or album.

1.  **Filter:** Use the sidebar to find photos. You can combine filters:
    -   *Example:* "Person: Alice" AND "Tag: Beach".
    -   **Tags (Type-ahead):** Start typing in the "Tags" input to see a sorted list of matches.
2.  **Add to Set:** Click photos in the results to add them to your **"Current Set"** in the right panel.
3.  **Export:** Once happy with your set, click **"Export Album"**. Choose a destination folder, and the app will copy all selected photos into that folder, organized and ready to share!

---

## 🔁 8. Duplicate Photos

The **Duplicates** view helps you find and safely remove redundant copies of your photos — whether they are byte-for-byte identical files or visually similar versions of the same shot.

### How Detection Works
The system uses two complementary methods:

| Method | What it finds | How |
|--------|--------------|-----|
| **Exact match** | 100% identical files | SHA-256 hash comparison |
| **Near match** | Resized, re-saved, or format-converted copies | Perceptual hash (pHash) — Hamming distance ≤ 10 bits out of 64 |

Hashes are computed **automatically in the background** during idle time:
- SHA-256 is computed when a photo is first scanned (fast, Node.js).
- pHash is computed during AI analysis (also fast, Python).
- For pre-existing photos scanned before this feature was available, the app will **backfill** hashes automatically in the background — no action required. A progress banner appears while hashing is still in progress.

### The Duplicates View

Open the **Duplicates** tab in the sidebar (Tools section). You'll see:

- **Stats pills:** Exact matches / Similar / Resolved counts at a glance.
- **Hashing banner:** Spinning indicator while your library is still being hashed. Duplicates appear after hashing completes.
- **3 tabs:** Pending · Resolved · Dismissed — each with a count badge.

### Reviewing a Duplicate Group

Each group shows a **horizontal filmstrip** of all N photos that were detected as duplicates.

- The **auto-selected best photo** starts with a ✓ badge (highest resolution, then earliest date). All others are initially marked for deletion.
- **Click any photo** to toggle it between "keep" (✓ badge, full opacity) and "trash" (trash icon, dimmed). You can keep **as many photos as you like** — only the unselected ones will be trashed.
- At least one photo must always remain selected; clicking the last kept photo is a no-op.
- Use the **"Move duplicates to trash" checkbox** (on by default) to send unselected photos to your system Trash when resolving. Uncheck it to keep all files and just mark the group resolved.

### Actions

| Button | What it does |
|--------|-------------|
| **Keep selected & trash others** | Marks the group as Resolved. Moves all unselected photos to system Trash (recoverable) if the checkbox is on. Keeping multiple photos is allowed — the button label updates to reflect the count (e.g., "Keep 2 selected & trash others"). |
| **Not duplicates** | Marks the group as Dismissed. No files are touched. |

> [!IMPORTANT]
> **Nothing is deleted automatically.** The system only takes action when you explicitly click the resolve button. Dismissed groups are preserved and can be reviewed in the Dismissed tab.

### Manual Check

Click **"Check now"** (top-right) to immediately queue a duplicate detection run, without waiting for the background service. Useful after a fresh scan.

### Tips

- **Exact duplicates** are safe to resolve — they are byte-for-byte the same file. You rarely need more than one copy.
- **Near duplicates** may be intentionally different (e.g., full-res original + web export, RAW + JPEG, two edits). Keep whichever versions you need.
- Files sent to Trash are **recoverable** from your system's Recycle Bin / Trash folder.
- Large libraries are processed in pages of 20 groups. Use "Load more" to see additional groups.

---

## 🛠️ 9. Advanced Settings & Maintenance

The **Settings** tab contains advanced controls to fine-tune the application's performance and manage your data.

### 📍 Library Storage
- **Current Location:** Displays where your `photos.db`, previews, and AI indices are stored.
- **Move Library:** Allows you to migrate your entire library data to a different drive or folder.

### ⚡ AI Performance Profile
Choose the balance between speed and accuracy for AI processing:
- **Balanced (Default):** Uses standard models suitable for most hardware. Offers fast scanning and tagging.
- **High Accuracy:** Uses larger, more advanced models (like `clip-vit-large`). This provides superior tagging and description quality but will be significantly slower and requires more VRAM (~2GB+).

### 🧹 Preview Cache
The app generates small preview images to keep the library fast.
- **Cache Statistics:** See how many preview files exist and how much space they occupy.
- **Cleanup Options:** You can clear previews older than 7 or 30 days, or "Clear All" to free up space. Previews will be automatically regenerated as you browse if missing.

### 💾 Database Management
Tools for maintaining the health and accuracy of your library:
- **Clear AI Tags:** Removes all AI-generated tags while preserving your manual ones. Useful if you want to re-scan with a different performance profile.
- **Cleanup Tags:** Normalizes all tags in the database (lowercase, single-word) and merges duplicates.
- **Deduplicate Faces:** Scans for and merges potential duplicate face entries in your database.
- **Face Data Upgrade:** Detects and processes missing pose estimation and high-res embedding data. This upgrade is **required** to enable "Age Eras" and significantly improves recognition of side profiles. Check the "Face Data Health" card to track progress.
- **Calculate Blur Scores:** Missing scores for old scans? Use this to calculate quality scores for existing faces, enabling the "Cleanup Blurry" feature.
- **Factory Reset:** ⚠️ **Extreme Caution.** Wipes the database and all settings to start fresh.

### ⚙️ AI Configuration & Model Management
Click **"Manage Models"** in Settings for a transparent overview of your AI engine:
- **AI GPU Runtime (REQUIRED FOR GPU):** The core Torch/CUDA engine. Download this to move from CPU to GPU processing.
- **Buffalo_L (InsightFace):** The model responsible for finding and identifying faces.
- **SmolVLM-Instruct:** The model that "reads" your photos and generates tags and descriptions.
- **Enhancement Models:** Models like `RealESRGAN` and `GFPGAN` for upscaling and restoration.

Other Fine-Tuning controls:
- **Face Detection Confidence:** Adjust how sure the AI must be to mark a face.
- **Face Blur Threshold:** Minimum quality score for faces.
- **Face Matching Thresholds:** (Settings → General → Face Matching Thresholds)
    - **Auto-Assign Threshold:** Controls which faces get automatically assigned during scanning. *Lower = stricter (fewer auto-assigns but more accurate). Higher = more auto-assigns but may include false matches.* Default: 0.70.
    - **Review Tier Cutoff:** Controls which faces are marked for review (amber ring). *Lower = fewer suggestions. Higher = more suggestions but includes weaker matches.* Default: 0.90.
- **Era Generation Settings:**
    - **Min Faces for Era:** Minimum number of confirmed faces required to form a distinct era. Default: 50.
    - **Merge Threshold:** Controls interpretation of "difference". Increase to force merging of similar-looking eras. Default: 0.75.
- **Tagging Creativity (Temperature):** 
    - **LOWER (0.1 - 0.3):** Factual, consistent descriptions. 
    - **HIGHER (0.7+):** Multi-sentence, descriptive, and "creative" tagging.

-   **Queue Management:** In the **Queues** tab, you can watch the AI working in real-time.
    -   **Manual Start:** The AI Queue starts in a **Paused** state to prevent slowing down your system on startup. Click **"Resume"** to begin processing pending tasks.

---

## 🎨 10. Creative Tools: AI Segmentation Canvas

The **Creative Tools** panel lets you apply AI-powered creative edits to any photo using an interactive canvas backed by **SAM 3 (Segment Anything Model 3)**.

### Opening Creative Tools

Open the **Tools** section in the sidebar and select **Creative Tools**. Click **Choose Photo** to pick a photo from your library. The photo loads in the canvas at a 680×480 logical resolution that scales to fill the available window area.

### Selecting a Subject

SAM 3 lets you isolate any part of a photo using three prompt modes — switch between them using the toolbar at the top of the canvas.

#### Box Mode

- **Draw:** Click and drag on the canvas to draw a bounding box around your subject.
- **Move:** Click inside the box and drag to reposition it anywhere on the image.
- **Resize:** Eight handles appear on the corners and edge midpoints — drag any handle to resize.
- **Delete:** Press the `Delete` key to clear the box and reset the canvas.

#### Points Mode

- **Add Foreground Point (+):** Click anywhere inside the subject (green dot — tells the AI "include this area").
- **Add Background Point (−):** Toggle to background mode in the toolbar, then click outside the subject (red dot — tells the AI "exclude this area").
- **Move a Point:** Click and drag any existing point to a new position.
- **Delete a Point:** Click directly on a point without dragging to remove it.

#### Combined Box + Points Mode

Switch to **Points** mode while a box is already drawn — the box is preserved and both prompts are sent to the AI together. The toolbar displays **"Box preserved — combined mode active"**. This typically produces the most accurate masks for complex subjects with fine edges.

#### Text Mode

Type a natural-language description (e.g., `"person"`, `"sky"`, `"red car"`) and click **Predict** to let the AI locate and segment the described subject.

### Applying Operations

Once a mask is predicted, the result panel on the right shows the output. Choose an operation from the toolbar:

| Operation | Effect |
|-----------|--------|
| **Remove Background** | Erases everything outside the mask — saves as a transparent PNG. |
| **Isolate Subject** | Extracts only the selected subject onto a transparent background. |
| **Blur Background** | Blurs the area outside the mask. Adjust the **Blur Radius** slider to control intensity. |
| **Sharpen Subject** | Applies unsharp-mask sharpening to the masked region. |
| **Save to Library** | Saves the result next to the original file and adds it to your library. |

> [!TIP]
> Click **Download** in the result panel to save the file to disk before committing it to the library.

### Canvas Interaction Tips

- For subjects with fine edges (hair, fur), combine a tight Box with a few foreground Points for best accuracy.
- Use background Points (−) near areas incorrectly included in the mask to refine the selection.
- The canvas scales to fill your window — resize the app to get more working area.
- Press `Delete` while in Box mode to clear a misdrawn box without switching modes.
- If the model warning banner appears, download the SAM 3 checkpoint via **Settings → Manage Models** before using Creative Tools.
