# Comprehensive Feature & Logic Documentation

## 1. Core Architecture
The application uses a **hybrid architecture**:
- **Frontend**: React 18, TypeScript, Vite. Handles UI, State, and Virtualization.
- **Main Process**: Electron 30. Handles File I/O, Database Access (SQLite), Image Processing (Sharp), and IPC.
- **AI Backend**: Python (standalone executable/script). Handles Heavy AI tasks (Face Recognition, Clustering, Restoration, Captions).

## 2. Photo Management Logic

### Library Scanning
- **Recursive Scanning**: Scans `LIBRARY_PATH` recursively.
- **File Watching**: (Needs verification) Likely uses `chokidar` or manual polling/rescan triggers.
- **Metadata Extraction**:
  - Uses `exiftool-vendored` for robust EXIF data (Camera, ISO, Lens, Date).
  - Normalizes "Date Taken" from multiple potential EXIF tags.
- **Thumbnail Generation**:
  - `sharp` is used for on-the-fly resizing and cropping.
  - **Protocol**: `local-resource://` custom protocol serves images.
  - **Optimizations**:
    - Generates 1x1 pixel transparent PNG for missing/corrupt files to prevent UI breakage ("Silent 404").
    - Supports `?box=x,y,w,h` for server-side cropping (critical for face thumbnails).
    - Supports `?width=N` for resizing to save bandwidth/memory.

### Database (Better-SQLite3)
- **Photos Table**: Stores paths, hashes (for deduplication?), metadata.
- **Faces Table**: Stores bounding boxes, vector embeddings (blobs), person assignments.
- **Clusters Table**: (Likely) Stores grouping results from DBSCAN.

## 3. Facial Recognition & Logic

### Detection (Python - InsightFace)
- **Model**: Buffalo_L (likely) or AntelopeV2.
- **Pipeline**:
  1. Detect faces in image.
  2. Extract 512-d embedding vector.
  3. Extract 5 facial landmarks (eyes, nose, mouth) for alignment.
  4. **Quality Filter**: Discards faces with low detection confidence or high blur.
- **Blur Detection**:
  - Uses Variance of Laplacian (`cv2.Laplacian`).
  - Logic: `score < BLUR_THRESH` (e.g., 20.0) marked as blurry.
  - **Constraints**: Blurry faces are often excluded from clustering reference mechanisms but may still be viewable.

### Clustering (Python - DBSCAN)
- **Algorithm**: DBSCAN (Density-Based Spatial Clustering of Applications with Noise).
- **Parameters**: `eps=0.5` (distance threshold), `min_samples=2` (min faces to form a cluster).
- **Metric**: Cosine Distance (or Euclidean on normalized vectors).
- **Logic**:
  - Groups similar face vectors into clusters.
  - "Noise" points (unclustered) remain as singleton faces.

### Face Naming & Management
- **Manual Assignment**: User assigns a name to a cluster/face.
- **Auto-Assign**:
  - Compares new faces against known "Person Means" (average vector of a named person).
  - **Threshold**: Stricter threshold (likely 0.4 or 0.5) for auto-assignment vs clustering.
- **Face Limits**:
  - **Legacy Constraint**: Previous versions capped faces at 1000 per person.
  - **New Logic**: "Review All Faces" implementation aims to bypass this limit using pagination/virtualization in `AllFacesModal`.
- **Ignore Logic**: Faces can be marked as "ignored" (e.g., background statues, posters).

## 4. Image Enhancement (Python)
- **Face Restoration**: Uses GFPGAN.
  - Logic: Crops face -> Upscales/Restores -> Pastes back.
- **Upscaling**: Uses RealESRGAN usually.
- **Logic**:
  - **Queueing**: Enhancement requests are queued (implicitly or explicitly via Python command loop).
  - **Output**: Writes new file (e.g., `_enhanced.jpg`) next to original or in separate folder.

## 5. Vision Language Model (VLM)
- **Feature**: Captioning and Semantic Search.
- **Model**: `SmolVLM` (or similar lightweight model) initialized via `init_vlm()`.
- **Logic**:
  - Generates captions for images.
  - Semantic Search: Encodes queries into vector space and searches image captions/embeddings.

## 6. IPC Channels & Data Flow
(Based on `electron/main.ts` analysis)
- `local-resource`: Custom protocol for image serving.
- `ai:command`: Main channel for sending commands to Python process (JSON-RPC style).
- `db:query`: (Inferred) Channel for renderer to query SQLite.
- `scan:start` / `scan:progress`: Controls scanning workflow.

## 7. Refactoring Considerations
- **Code Duplication**: Similar logic in `People.tsx` and `PersonDetail.tsx` for face interactions.
- **Monoliths**: `electron/main.ts` handles too many responsibilities (Window, IPC, Image logic).
- **Type Safety**: Some Python-Electron communication relies on `any` types or loose JSON contracts.
- **Error Handling**: Silent failures in image loading (intentional) need careful logging to not hide real bugs.
