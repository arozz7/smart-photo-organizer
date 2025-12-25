# Release v0.3.5 - Face Management Update

## New Features

### 👤 Retrieve Ignored Faces
- **View Ignored:** New modal to see faces you previously hid.
- **Restore:** Bring back ignored faces into your library.
- **Restore & Assign:** Immediately tag a person when restoring.

## Improvements
- **Application:** Version bump to v0.3.5.

---

# Release v0.3.0 - AI Powerhouse Update

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
- **Standalone Executable**: No Python installation required.
- **Slim AI Engine**: Reduced initial installer size by 80% (models now downloaded on-demand).
- **Transparent Model Management**: New UI to see exactly what is being downloaded and from where.
- **Improved Face Restoration**: Faster and more robust AI processing.
- **AI Performance Profiles:** Choose between "Balanced" and "High Accuracy" based on your hardware.

## Known Issues
- Large installer size due to bundled AI models.
- First launch may take longer while assets are initialized.
- AI Runtime download requires manual download of multi-part zip if automatic download fails.
