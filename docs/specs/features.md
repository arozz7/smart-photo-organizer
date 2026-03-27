# Features & Capabilities

## 1. Smart Scanning & Import

The application features a robust scanning engine designed to handle large photo libraries, including professional RAW formats.

### Supported Formats
- **Standard:** JPG, PNG, WEBP
- **RAW:** ARW (Sony), CR2 (Canon), NEF (Nikon), DNG, ORF, RW2, TIF/TIFF

### Scanning Logic
1. **Recursive Scan:** The scanner traverses the selected directory and all subdirectories.
2. **Change Detection:** It checks if a file is already in the database. Existing files are skipped unless they are flagged for a re-scan.
3. **Rescan Capabilities:**
   - **Incremental Scan:** The default "Scan" only processes new files effectively.
   - **Force Rescan:** Explicitly re-analyzes files, regenerating previews and refreshing metadata even if they exist.
3. **Preview Generation:** 
   - For RAW files, it attempts to extract the embedded JPEG preview using `exiftool` (fast).
   - If that fails, it uses `sharp` to decode and convert the image (slower but reliable).
   - Previews are stored locally to ensure fast UI performance (~1280px).
4. **Metadata Extraction:** EXIF data (Date, Camera, ISO, etc.) is extracted and stored.
5. **Smart Orientation:** The scanner automatically detects and corrects orientation issues, ensuring RAW files and mixed-orientation JPGs are displayed correctly without manual rotation.

## 2. AI Face Recognition

The core feature of the application is local, privacy-focused face recognition.

### Detection
- **Model:** InsightFace (Buffalo_L).
- **Process:** Every photo is analyzed to find faces.
- **Smart Cropping:** The logic calculates a "portrait" crop for each face using facial landmarks (eyes, nose, mouth) to ensure the head and neck are centered, rather than just the tight bounding box.

### Recognition & Clustering
- **Descriptor:** Each face is converted into a 512-dimensional vector (embedding).
- **Indexing:** The application uses **FAISS (Facebook AI Similarity Search)** to index all face descriptors. This allows for near-instant similarity searches even as your library grows into the millions.
- **Matching:**
  - **Identified People:** When a new face is found, it is compared against the *mean descriptor* of all known people using the FAISS index. If the distance is low (Similarity > ~0.4), it is auto-assigned.
  - **Unknowns:** If no match is found, it remains in the "Unnamed Faces" pool.
- **Visual Confirmation:** The "Unnamed Faces" view groups similar faces together, allowing you to confirm matches before they are finalized.
- **Persistence:** Your "Regroup" strictness preference (slider value) is automatically saved and applied on future loads.

### Management
- **Naming:** You can click any unnamed face to assign it to a new or existing person.
- **Renaming & Merging:** You can rename a person at any time. If you rename "John" to "John Doe", and "John Doe" already exists, the application will intelligently merge all photos and faces into the target person.
- **Ignore:** You can "Hide" faces that are not relevant (background strangers).
- **Ignored Faces Manager:** A dedicated modal allows you to review all hidden/ignored faces.
    - **Pagination:** View thousands of ignored faces with fast pagination.
    - **Group Similar:** Use the AI to cluster your "ignored" pile, making it easy to spot if you accidentally ignored important photos.
    - **Sensitivity Slider:** A matching threshold slider (0.1 to 0.95) allows you to find identity suggestions even for lower-quality or blurry ignored faces.
    - **AI Readiness Indicators:** Small green dots on face thumbnails visually confirm which faces have been analyzed and are ready for identity matching.
    - **Restore & Assign:** Select individual faces or entire groups to restore them to the active pool. The "Restore as [Name]" button allows for one-click restoration and identity assignment.

### Blur Detection & Quality Control
- **Blur Scoring:** Every detected face is analyzed for sharpness (Laplacian Variance).
- **Auto-Filter:** Extremely blurry faces are automatically discarded during scanning based on your configurable threshold.
- **Cleanup Tool:** The **"Cleanup Blurry"** tool scans your library for low-quality face captures. It features a **high-performance virtualized grid** capable of handling thousands of faces instantly and supports **RAW photo previews** using the generated cache.

## 3. AI Configuration

The application allows you to fine-tune the AI models to match your specific hardware and preferences. **Settings are automatically saved and persisted across restarts.**

### Face AI Settings
- **Detection Threshold:** Adjust how strict the AI is when finding faces. Lower values find more faces but may find false positives (e.g., patterns in trees).
- **Blur Threshold:** Sets the minimum quality score. Increase this if you only want to see sharp, high-quality portraits in your People view.

### Smart Tagging Settings
- **Creativity (Temperature):** Controls how "imaginative" the tagging model is.
  - **Low (0.1):** Deterministic, factual tags.
  - **High (0.8+):** More diverse vocabulary, but risk of "hallucinations" (seeing things that aren't there).
- **Max Tokens:** Controls the length of the generated descriptions.
- **Tag Normalization:**
  - By default, the application enforces **lowercase** and **single-word** tags to keep your library clean.
  - A **Cleanup Tool** is available to migrate existing tags to this format.

## 4. Smart Tagging (Generative AI)

The application uses a small Vision-Language Model (SmolVLM) to "see" your photos.

### How it works
- **Captioning:** The AI looks at the photo and generates a descriptive caption (e.g., "A golden retriever running in a park on a sunny day").
- **Tag Extraction:** It parses the caption to extract keywords (e.g., `dog`, `park`, `running`, `sunny`).
- **Reliable Scanning**: 
    - **Smart Queue**: Prevents concurrent scans from clobbering each other. Requests are processed serially.
    - **Corruption Handling**: Failed files are logged to `scan_errors` instead of crashing the process, ready for future recovery tools.
- **High-Res Thumbnails**: Preview generation resolution increased to 2560px for sharper face crops.
- **Storage:** These tags are saved to the database and linked to the photo.

### Search
- You can search for photos using these tags (e.g., typing "dog" will find the photo above, even if "dog" isn't in the filename).
- **Semantic Search:** The application performs a keyword-based search across both user-provided and AI-generated tags and descriptions.

## 5. ✨ AI Enhance Lab

The Enhance Lab allows you to restore and upgrade low-quality or old photographs using state-of-the-art Generative AI models.

### Capabilities
- **Upscaling (x4):** Powered by **Real-ESRGAN**, this triples/quadruples the resolution of images while intelligently reconstructing missing details. Perfect for small crops or old digital photos.
- **Face Restoration:** Powered by **GFPGAN**, this specifically targets human faces to remove artifacts, noise, and blur, making them sharp and clear.
- **Hybrid Mode:** You can choose to upscale an entire image while simultaneously applying face restoration for the best possible results.

### Workflow
1. Select a photo in the Library and click the **"Enhance"** magic wand.
2. Choose your task (Upscale or Restore Faces).
3. Select the appropriate model (General vs Anime).
4. View the results side-by-side using the **Before/After slider**.
5. Enhanced images are saved alongside the original with a suffix (e.g., `photo_upscaled.jpg`).

## 6. 🎨 Create View (Collections & Sets)

The "Create" view is a powerful workspace for building specific sets of photos.

- **Complex Filtering:** Filter by multiple people AND multiple tags simultaneously (e.g., "Find all photos with 'John' AND 'Jane' tagged as 'Birthday'").
- **Staging Set:** Manually add specific photos from results to your "Current Set".
- **Exporting Albums:** Once you've built your set, you can export the entire collection to a new folder on your computer.

## 7. 🔧 File Repair (Photo Repair Shop Integration)

SPO integrates with [Photo Repair Shop (PRS)](https://photo-repair-shop.app), a companion desktop
app, to recover corrupt photo files directly from the Scan Warnings panel.

### How it works
1. Open **Settings → Scan Warnings**. If PRS is running, a "🔧 PRS ready" badge appears in the header.
2. Click the 🔧 button on any corrupt file row.
3. SPO sends the file to PRS for **analysis** — PRS identifies the corruption type and recommends a repair strategy.
4. SPO automatically submits a **repair job** using the suggested strategy, along with healthy photos from your own library as reference files (for header-grafting repairs).
5. A **progress bar** updates every 2 s as PRS reports percent complete and stage.
6. On completion, SPO **verifies** the repaired file (Sharp decode + AI analysis) before committing it.
7. If verification passes: the scan error is cleared, the corrupt record removed, and the repaired file re-ingested into the library (face detection, tagging, etc.).
8. If verification fails: the row is marked **Unrepairable** (persistent badge) — no further repair attempts are made.

### Security
- PRS communicates over `localhost:3847` only — no network egress.
- A per-session UUID token (written to `~/.photo-repair-shop/api-token` by PRS) is required for all authenticated calls.
- SPO never logs the token value.

### UI States per file
| State | Display |
|-------|---------|
| `idle` | 🔧 button (enabled if PRS running) |
| `checking_prs` | Checking PRS... |
| `prs_unavailable` | Button disabled + tooltip |
| `analyzing` | Progress bar — Analyzing... |
| `repairing` | Progress bar with % |
| `verifying` | Progress bar — Verifying... |
| `done` | Row auto-removes after 1.5 s |
| `failed` | Red error text + Retry button |
| `unrepairable` | Orange 🚫 Unrepairable badge (persistent) |

## 8. 🔁 Duplicate Photo Detection

The app automatically finds and groups redundant photos using a two-pass background system, with a dedicated UI for safe, user-controlled cleanup.

### Detection Methods

| Pass | Algorithm | What it catches |
|------|-----------|----------------|
| **Exact** | SHA-256 file hash | Byte-for-byte identical copies |
| **Near** | pHash (64-bit) + Hamming distance ≤ 10 | Resized, re-saved, or format-converted versions |

### Background Hashing
- **SHA-256** is computed at scan time (streaming Node.js, negligible overhead).
- **pHash** is computed during AI analysis via Python `imagehash` library.
- A `BackgroundDuplicateCheckerService` handles **backfill** for pre-existing photos in batches (SHA-256: 100/batch, pHash: 20/batch) during idle time.
- The service runs only when no scan or AI processing is active.

### Duplicate Groups
- Groups contain **N ≥ 2 photos** (not limited to pairs).
- Near-duplicate clustering uses a **Union-Find** algorithm (O(n²) over integer pHashes, handles 100 K entries comfortably).
- A `findExistingGroup` guard prevents duplicate group creation on re-runs.
- Groups are typed (`exact` / `near`) and have a lifecycle status (`pending` → `resolved` / `dismissed`).

### UI
- **Stats pills:** Exact / Similar / Resolved counts.
- **Hashing banner:** Live progress while the library is still being hashed (polls every 5 s).
- **Group card:** Horizontal filmstrip of all N photos; auto-selects best photo (highest resolution → earliest date); each photo toggles independently between keep (✓, full opacity) and trash (trash icon, dimmed); at least one must remain selected.
- **Multi-keep:** Any number of photos can be kept; only unselected ones are trashed. Button label reflects the count ("Keep 2 selected & trash others"). `keepPhotoIds[]` sent to IPC; first ID stored as `winner_photo_id`.
- **Resolution:** "Keep selected & trash others" (uses `shell.trashItem` — recoverable) or "Not duplicates" (dismiss).
- **Pagination:** 20 groups per page with "Load more".
- **Sidebar badge:** Yellow count of pending groups, updated every 60 s.

## 9. Privacy & Performance
- **Local-First:** No photos are ever uploaded to the cloud. All AI runs on your GPU/CPU.
- **Virtualization:** The gallery uses `react-window` to handle libraries with 100,000+ photos without lagging.

## 10. 🎨 Creative Tools (SAM 3 Segmentation)

An interactive AI segmentation canvas that lets users isolate subjects and apply non-destructive creative operations to any photo in the library.

### Model Stack
- **SAM 3 (Segment Anything Model 3):** `Sam3Model` + `Sam3Processor` via HuggingFace `transformers 5.3.0.dev0`. The tracker variant (`Sam3TrackerModel`) handles point prompts.
- **Session-based architecture:** Each photo opens a server-side session that caches the pre-encoded image tensor. Predictions within the session reuse the cache, keeping per-prompt latency low.
- **Checkpoint:** Downloaded on-demand via HuggingFace Hub (`huggingface_hub.snapshot_download`). Stored in `models/sam3/`.

### Prompt Modes

| Mode | Input | Python entry point |
|------|-------|--------------------|
| **Box** | `[x1, y1, x2, y2]` in image coords | `predict_from_box()` |
| **Points** | `[[x, y], ...]` + `[label, ...]` (1=fg, 0=bg) | `predict_from_points()` |
| **Text** | Natural-language string | `predict_from_text()` |
| **Box + Points** | Box + point arrays simultaneously | `predict_from_box_and_points()` |

Combined box+points passes both `input_boxes`/`input_boxes_labels` and `input_points`/`input_labels` to `Sam3Processor` in a single forward pass. Falls back to `predict_from_box()` if combined call raises an exception.

### Operations

| Operation | Implementation |
|-----------|----------------|
| **Remove Background** | NumPy mask inversion — pixels outside mask set to alpha=0 |
| **Isolate Subject** | Copy masked pixels onto transparent canvas |
| **Blur Background** | `cv2.GaussianBlur` on outside-mask region, composited back |
| **Sharpen Subject** | `PIL.ImageFilter.UnsharpMask` on masked region |
| **Save to Library** | Write result PNG to same directory as original, trigger library re-ingest |

### Canvas Interaction (Frontend)
- **Drag state machine:** Discriminated union `DragAction` (`draw-box` | `move-box` | `resize-box` | `move-point` | `none`) held in a ref to avoid stale closures.
- **Box handles:** 8 handles (4 corners + 4 edge midpoints) drawn on canvas; hit-tested within 10px radius.
- **Hover refs:** `hoveredHandleRef`, `hoveredPointIdxRef` — refs (not state) to avoid re-renders on every `mousemove`.
- **`stateRef` pattern:** All mouse handlers read `stateRef.current` (mirrored via `useEffect`) to avoid stale closure without listing state in `useCallback` deps.
- **Responsive layout:** Canvas `max-width/max-height: 100%` fills parent flex container while preserving intrinsic 680:480 aspect ratio. Mask overlay uses `%`-based positioning relative to canvas dimensions so it tracks correctly at any CSS display scale.

### IPC Channels
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `ai:segment:startSession` | Renderer → Main → Python | Open session, load + encode image |
| `ai:segment:predict` | Renderer → Main → Python | Run segmentation with current prompts |
| `ai:segment:applyOperation` | Renderer → Main → Python | Apply creative operation to mask |
| `ai:segment:endSession` | Renderer → Main → Python | Free session cache |

### Key Files
| File | Role |
|------|------|
| `src/python/facelib/sam3_provider.py` | SAM 3 model wrapper — session management, all predict variants |
| `src/python/commands/segmentation.py` | IPC dispatcher — routes predict/apply/session commands |
| `src/python/api/routes/segment.py` | Flask route layer |
| `src/components/CreativeToolsPanel.tsx` | Canvas UI, drag state machine, prompt management |
| `src/components/canvasHelpers.ts` | Pure geometry helpers (transforms, hit-testing, handle positions) |
| `src/components/CreativeOperationsBar.tsx` | Operations toolbar (extracted for file-size compliance) |
| `src/hooks/useSegmentation.ts` | Segmentation state — sessions, prompts, predictions, operations |
| `src/views/Tools.tsx` | Tools view shell — routes to Creative Tools / Blurry Photos panels |

## 11. Detailed Hardware Requirements

| Feature | CPU Only (Minimum) | GPU (Recommended) | Notes |
| :--- | :--- | :--- | :--- |
| **Face Detection** | ~2-5s per photo | < 0.2s per photo | CPU is viable for background scanning overnight. |
| **Face Recognition** | Workable | Instant | Vector search is CPU-based (FAISS) and always fast. |
| **Smart Tagging (VLM)** | **Not Available** | **Required** (4GB+ VRAM) | Current implementation requires NVIDIA GPU + AI Runtime. |
| **Upscaling (x4)** | ~30-60s per photo | ~2-5s per photo | massive speed difference. |
| **Face Restoration** | ~10-20s per photo | ~1-2s per photo |  |

> [!IMPORTANT]
> **VLM / Smart Tagging** requires the **AI GPU Runtime** (~5.8GB) to be installed. It currently **does not support CPU-only mode** due to memory bandwidth constraints on standard system RAM.
