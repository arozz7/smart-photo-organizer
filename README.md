# Smart Photo Organizer

> A local-first, AI-powered photo management tool. Organize your memories without leaving your hard drive.

![License](https://img.shields.io/badge/license-MIT-blue.svg) ![Electron](https://img.shields.io/badge/electron-v28+-blue) ![React](https://img.shields.io/badge/react-v18-blue)

## Overview

Smart Photo Organizer uses advanced AI (InsightFace for people, SmolVLM for objects) to classify and organize your photo library. Unlike cloud services, **all processing happens locally** on your machine, ensuring your privacy.

## Features at a Glance

*   **🕵️ Local AI Face Recognition:** Automatically detects and groups faces. learns as you name them.
*   **⚙️ Configurable AI:** Fine-tune face detection, blur sensitivity, and tagging creativity settings to match your needs.
*   **🧼 Blur Detection:** Automatically filters out blurry faces and provides tools to clean up low-quality captures.
*   **🏷️ Smart Tagging:** "Reads" your photos and generates searchable tags (e.g., "sunset", "dog", "birthday party").
*   **📷 RAW Support:** Native support for professional formats (Sony ARW, Canon CR2, Nikon NEF, etc.).
*   **⚡ High Performance:** Virtualized grid handles libraries with 100,000+ photos smoothly.
*   **🔍 Semantic Search:** Search your photos by content, date, or person.

## Documentation

For detailed examples of how the application works, logic flows, and architecture, please see the `docs/` folder:

*   [**Features Guide**](docs/features.md): Detailed breakdown of user-facing features.
*   [**System Architecture**](docs/architecture.md): Diagrams of how Electron, React, and Python communicate.
*   [**Logic Examples & Flows**](docs/logic_examples.md): Deep dive into the Scanning and AI logic.

## Usage Guide

### 1. Installation & Setup

**Prerequisites:**
*   Node.js (v18+)
*   Python 3.10+ (for the AI backend)
*   **Windows Users:** An NVIDIA GPU is recommended (with CUDA installed) for faster AI processing, but it will work on CPU.

**Running from Source:**

```bash
# 1. Install Dependencies
npm install

# 2. Setup Python Environment
cd src/python
python -m venv .venv
# Activate venv: .venv\Scripts\activate
pip install -r requirements.txt

# 3. Start Development Server
cd ../..
npm run dev
```

### 2. Getting Started

1.  **Select Library:** On first launch, go to **Settings** and choose your photo folder. The app will creating a `photos.db` and `previews/` folder in a location you choose (or default to AppData).
2.  **Scan Photos:** Click **"Scan Library"**. The app will recursively find all images, generate previews, and extract metadata.
3.  **Detect Faces:** The AI will automatically start processing photos to find faces. You can watch the progress in the status bar.
4.  **Organize People:** Go to the **"People"** tab. You will see groups of "Unnamed Faces". Click one, type a name (e.g., "Mom"), and the AI will auto-group similar faces under that name.
5.  **Generate Tags:** Select photos and click **"Generate Smart Tags"** to have the AI describe them.

## Development

This project uses a hybrid architecture:
-   **Frontend:** React + TypeScript + Vite
-   **Backend:** Electron (Main Process) + Python (Subprocess)

See [Architecture](docs/architecture.md) for more details.

## License

MIT
