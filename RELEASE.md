# Release v0.2.0-beta - AI Powerhouse Update

This release introduces significant AI capabilities and architectural improvements to the Smart Photo Organizer.

## New Features

### ✨ AI Enhance Lab
- **Upscaling (x4):** Boost resolution of low-quality images using Real-ESRGAN.
- **Face Restoration:** Fix grainy or blurry faces using GFPGAN.
- **Hybrid Processing:** Combine upscaling and face restoration for optimal results.

### 🕵️ Performance & Search
- **FAISS Indexing:** Face similarity searches are now near-instant regardless of library size.
- **Sets (Create View):** Build custom collections by combining complex filters (people, tags, dates) and export them to disk.
- **Configurable Storage:** Choose where your application data (DB, previews, indices) is stored.

## Technical Improvements
- **Bundled Python Backend:** No longer requires a local Python installation to run.
- **Improved RAW Handling:** Faster preview extraction and orientation preservation.
- **AI Performance Profiles:** Choose between "Balanced" and "High Accuracy" based on your hardware.

## Known Issues
- Large installer size due to bundled AI models.
- First launch may take longer while assets are initialized.
