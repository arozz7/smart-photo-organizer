# Features & Capabilities

## 1. Smart Scanning & Import

The application features a robust scanning engine designed to handle large photo libraries, including professional RAW formats.

### Supported Formats
- **Standard:** JPG, PNG, WEBP
- **RAW:** ARW (Sony), CR2 (Canon), NEF (Nikon), DNG, ORF, RW2, TIF/TIFF

### Scanning Logic
1. **Recursive Scan:** The scanner traverses the selected directory and all subdirectories.
2. **Change Detection:** It checks if a file is already in the database. Existing files are skipped unless they are flagged for a re-scan.
3. **Preview Generation:** 
   - For RAW files, it attempts to extract the embedded JPEG preview using `exiftool` (fast).
   - If that fails, it uses `sharp` to decode and convert the image (slower but reliable).
   - Previews are stored locally to ensure fast UI performance (~1280px).
4. **Metadata Extraction:** EXIF data (Date, Camera, ISO, etc.) is extracted and stored.

## 2. AI Face Recognition

The core feature of the application is local, privacy-focused face recognition.

### Detection
- **Model:** InsightFace (Buffalo_L).
- **Process:** Every photo is analyzed to find faces.
- **Smart Cropping:** The logic calculates a "portrait" crop for each face using facial landmarks (eyes, nose, mouth) to ensure the head and neck are centered, rather than just the tight bounding box.

### Recognition & Clustering
- **Descriptor:** Each face is converted into a 512-dimensional vector (embedding).
- **Matching:**
  - **Identified People:** When a new face is found, it is compared against the *mean descriptor* of all known people. If the distance is low (Similarity > ~0.4), it is auto-assigned.
  - **Unknowns:** If no match is found, it remains in the "Unnamed Faces" pool.
- **Visual Confirmation:** The "Unnamed Faces" view groups similar faces together, allowing you to confirm matches before they are finalized.

### Management
- **Naming:** You can click any unnamed face to assign it to a new or existing person.
- **Renaming & Merging:** You can rename a person at any time. If you rename "John" to "John Doe", and "John Doe" already exists, the application will intelligently merge all photos and faces into the target person.
- **Ignore:** You can "Hide" faces that are not relevant (background strangers).

### Blur Detection & Quality Control
- **Blur Scoring:** Every detected face is analyzed for sharpness (Laplacian Variance).
- **Auto-Filter:** Extremely blurry faces are automatically discarded during scanning based on your configurable threshold.
- **Cleanup Tool:** The **"Cleanup Blurry"** tool scans your existing library for low-quality face captures, allowing you to bulk-delete blurry faces while keeping the high-quality ones.

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

## 4. Smart Tagging (Generative AI)

The application uses a small Vision-Language Model (SmolVLM) to "see" your photos.

### How it works
- **Captioning:** The AI looks at the photo and generates a descriptive caption (e.g., "A golden retriever running in a park on a sunny day").
- **Tag Extraction:** It parses the caption to extract keywords (e.g., `dog`, `park`, `running`, `sunny`).
- **Storage:** These tags are saved to the database and linked to the photo.

### Search
- You can search for photos using these tags (e.g., typing "dog" will find the photo above, even if "dog" isn't in the filename).

## 5. Privacy & Performance
- **Local-First:** No photos are ever uploaded to the cloud. All AI runs on your GPU/CPU.
- **Virtualization:** The gallery uses `react-window` to handle libraries with 100,000+ photos without lagging.
