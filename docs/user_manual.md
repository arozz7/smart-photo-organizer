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

---

## 🖼️ 2. Library View: Interacting with Your Photos

The **Library** is your main hub. 

-   **Grid Navigation:** Scroll through your entire library smoothly. Use the **Date Filter** in the sidebar to jump to specific years or months.
-   **Photo Details:** Click any photo to see a large preview, its EXIF metadata (camera, lens, ISO), and any AI-generated tags.
-   **Context Menu:** Right-click a photo to:
    -   **Enhance:** Open the photo in the AI Enhance Lab.
    -   **Delete:** Remove the photo from the database (does not delete the original file).
    -   **Re-scan:** Force the AI to re-analyze the photo.

---

## 👤 3. People Management: Organizing Faces

The AI automatically detects faces during the scan. Your job is to give them names!

1.  **Unnamed Faces:** Go to the **People** tab. You'll see groups of similar looking faces that haven't been named yet.
2.  **Naming:** Click a group, type a name (e.g., "Mom"), and hit Enter. The AI will now know what "Mom" looks like and will attempt to auto-assign her to other photos.
3.  **Merging:** If you accidentally created two entries for the same person (e.g., "John" and "John Doe"), simply rename one to match the other. The app will ask if you want to **merge** them.
4.  **Cleaning Up:** Use the **"Cleanup Blurry Faces"** tool in the People view to find and remove low-quality face captures that might be cluttering your view.

---

## 🪄 4. AI Enhance Lab: Upgrading Your Memories

Found an old, blurry, or low-resolution photo? Use the **Enhance Lab**.

1.  **Open Lab:** Click the magic wand icon on any photo.
2.  **Choose a Task:**
    -   **Upscale (x4):** Increases resolution for crisp details.
    -   **Restore Faces:** Fixes grainy or "melted" faces in old photos.
3.  **Model Selection:** Use "General" for standard photos and "Anime" for illustrations or cartoons.
### 💻 Hardware Requirements & Performance
AI enhancement is a computationally intensive task. For the best experience:
- **NVIDIA GPU (Recommended):** A modern NVIDIA GPU with **at least 2GB of VRAM** will provide the fastest results (seconds vs minutes). **Note:** Requires downloading the **AI GPU Runtime** (see Section 6).
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

## 🎨 5. Create & Export: Building Sets

The **Create** view is for when you want to gather specific photos for a project or album.

1.  **Filter:** Use the sidebar to find photos. You can combine filters:
    -   *Example:* "Person: Alice" AND "Tag: Beach".
    -   **Tags (Type-ahead):** Start typing in the "Tags" input to see a sorted list of matches.
2.  **Add to Set:** Click photos in the results to add them to your **"Current Set"** in the right panel.
3.  **Export:** Once happy with your set, click **"Export Album"**. Choose a destination folder, and the app will copy all selected photos into that folder, organized and ready to share!

---

## 🛠️ 6. Advanced Settings & Maintenance

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
- **Deduplicate Faces:** Scans for and merges potential duplicate face entries in your database.
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
- **Tagging Creativity (Temperature):** 
    - **LOWER (0.1 - 0.3):** Factual, consistent descriptions. 
    - **HIGHER (0.7+):** Multi-sentence, descriptive, and "creative" tagging.
-   **Queue Management:** In the **Queues** tab, you can watch the AI working in real-time and adjust how many photos it processes at once to manage your computer's performance.
