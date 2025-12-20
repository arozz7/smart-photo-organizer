# Project Specification: Smart Photo Organizer

## 1. Project Overview
**Smart Photo Organizer** is a local-first, privacy-focused desktop application for managing, organizing, and enhancing large photo libraries. It leverages advanced AI (both on-device and optional GPU acceleration) to automatically tag photos, recognize faces, and assess image quality without sending data to the cloud.

## 2. Technical Architecture
The application is built on a hybrid architecture combining a modern web frontend with powerful system-level backends.

### Core Stack
- **Runtime:** Electron (v30)
- **Frontend:** React (v18), TypeScript, Vite
- **Styling:** TailwindCSS, Radix UI
- **Database:** Better-SQLite3 (Local SQL database)
- **Image Processing:** Sharp, ExifTool Vendored

### AI Engine (Python Backend)
To support heavy AI workloads, the app bundles a standalone Python environment.
- **Face Analysis:** InsightFace (Detection & Recognition), FAISS (Vector Search)
- **Image Enhancement:** GFPGAN (Face Restoration), RealESRGAN (Upscaling)
- **Object Detection:** TensorFlow.js (MobileNet/Coco-SSD running in Node/Browser for lightweight tasks)

## 3. Current Features

### 📸 Photo Management
- **Local Library Scanning:** fast recursive scanning of local directories.
- **EXIF Metadata:** Extraction of camera model, lens, ISO, aperture, and shutter speed.
- **RAW Support:** Preview generation and correct orientation for RAW formats (CR2, NEF, ARW, etc.).
- **Smart Filtering:** Filter by Date, Camera, Lens, Person, and Location.
- **Virtual Scrolling:** Efficient rendering of libraries with thousands of photos.

### 🧠 AI Intelligence
- **Face Recognition:**
  - Auto-detects faces in photos.
  - Clusters similar faces to identify unique people.
  - Supports naming and merging people.
  - **Vector Search:** Uses FAISS for high-performance facial similarity search.
- **Quality Assessment:**
  - **Blur Scoring:** analyzes image sharpness to highlight best shots.
  - **AI Tagging:** Automatic scene and object classification (e.g., "beach", "dog", "sunset").
- **GPU Acceleration:** Optional downloadable AI Runtime for NVIDIA GPUs to speed up processing.

### ✨ Enhance Lab
- **Face Restoration:** AI-powered restoration of old or blurry faces using GFPGAN.
- **Upscaling:** High-fidelity image upscaling.
- **Comparison View:** Before/After slider to verify enhancements.

### 🛠️ Utilities
- **PDF Creator:** Built-in tool to merge images into PDFs, extract pages, and compress documents.
- **Privacy First:** zero cloud dependencies; all processing happens on `localhost`.

### 🖥️ User Experience
- **Responsive Design:** Optimized layouts for various screen sizes (Laptop/PC).
- **State Persistence:** Automatically saves window size and position.
- **Modern UI:** Tabbed configuration screens and clean, clutter-free interfaces.

## 4. Future Roadmap & Backlog
*Sourced from `docs/future_features.md`*

### High Priority
- **Smart Face Storage:** Optimization to reduce DB size (Binary vectors + Pruning).
- **Hardware Compatibility & Performance:** 
  - **Force Mode:** User selection for Enhanced (GPU) / Standard (CPU) / Safe Mode.
  - **Multi-GPU:** Parallel processing across multiple video cards.
  - **Generic Support:** ONNX Runtime for non-NVIDIA hardware (AMD/Intel).
- **Cross-Platform:** Support for Mac OS and Linux.
- **Advanced Enhancement Control:**
  - Adjustable "Restoration Strength" (0-100%).
  - Custom Model support (load user provided `.pth` files).
- **Background Batch Processing:** Queue system for batch enhancement.

### Creative & Organization
- **Duplicate Detection:** Safe, user-controlled deduplication (Exact & Visual) with RAW stacking.
- **Batch Tagging:** Apply tags to multiple photos at once (Context menu & Filtered Views).
- **Metadata Injection:** Write tags back to standard file EXIF/IPTC/XMP headers.
- **Batch Renaming:** Template-based renaming and cleanup.
- **Collage Creator:** Auto-layout generator for photo collages.
- **Dataset Export:** Export aligned/cropped faces for training custom AI models (LoRAs).
- **Smart Albums:** Save search queries as persistent albums.
- **Location Heatmap:** Interactive world map of photo locations.
- **Library Analytics:** Visual stats of gear usage and photography habits.
- **Static Gallery Generator:** Export albums to static HTML for self-hosting.

## 5. File Structure Conventions
- `src/`: React Frontend code
- `electron/`: Main process and IPC handlers
- `python/`: AI backend scripts (`main.py`)
- `scripts/`: Build and utility scripts