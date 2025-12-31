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

### Management
- **Naming:** You can click any unnamed face to assign it to a new or existing person.
- **Renaming & Merging:** You can rename a person at any time. If you rename "John" to "John Doe", and "John Doe" already exists, the application will intelligently merge all photos and faces into the target person.
- **Ignore:** You can "Hide" faces that are not relevant (background strangers).
41: - **Ignored Faces Manager:** A dedicated modal allows you to review all ignored faces.
42:   - **Pagination:** View thousands of ignored faces with fast pagination.
43:   - **Group Similar:** Use the AI to cluster your "ignored" pile, making it easy to spot if you accidentally ignored 20 photos of "Grandma".
44:   - **Restore:** Select individual faces or entire groups to restore them to the active pool (optionally assigning them to a person immediately).

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

## 7. Privacy & Performance
- **Local-First:** No photos are ever uploaded to the cloud. All AI runs on your GPU/CPU.
- **Virtualization:** The gallery uses `react-window` to handle libraries with 100,000+ photos without lagging.

## 8. Detailed Hardware Requirements

| Feature | CPU Only (Minimum) | GPU (Recommended) | Notes |
| :--- | :--- | :--- | :--- |
| **Face Detection** | ~2-5s per photo | < 0.2s per photo | CPU is viable for background scanning overnight. |
| **Face Recognition** | Workable | Instant | Vector search is CPU-based (FAISS) and always fast. |
| **Smart Tagging (VLM)** | **Not Available** | **Required** (4GB+ VRAM) | Current implementation requires NVIDIA GPU + AI Runtime. |
| **Upscaling (x4)** | ~30-60s per photo | ~2-5s per photo | massive speed difference. |
| **Face Restoration** | ~10-20s per photo | ~1-2s per photo |  |

> [!IMPORTANT]
> **VLM / Smart Tagging** requires the **AI GPU Runtime** (~5.8GB) to be installed. It currently **does not support CPU-only mode** due to memory bandwidth constraints on standard system RAM.
