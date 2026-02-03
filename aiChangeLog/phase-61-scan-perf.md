# Phase 61: Scan Performance Optimization

## 🎯 Goal
Reduce global scan time (especially for Macro/TTA modes) by eliminating redundant AI model initializations.

## 🛠️ The Changes
### 1. Model Caching (`facelib/faces.py`)
- **Implemented `APP_CACHE`**: An LRU-style cache that stores up to 4 instances of `FaceAnalysis`.
- **Why?** Previously, the system would destroy and re-create the AI model (taking ~500ms-1s) every time the resolution changed or TTA rotated the image. This happened 4-5 times *per photo* in Macro mode.
- **Now:** The system keeps the standard `1280x1280`, `640x640`, and `safe_thresh` instances in memory. TTA and multi-pass scans now switch instantly.

### 2. Benefits
- **Speed:** Expected scan time reduction of **40-60%** per photo in Macro/TTA modes.
- **Efficiency:** Drastically reduced CPU/GPU overhead from constant model loading/unloading.

## ⚠️ Notes
- **VRAM Usage:** This increases VRAM usage by holding ~3-4 model instances instead of 1.
- **Safety:** Added a `MAX_CACHE_SIZE=4` limit to prevent memory leaks. Added `clear_model_cache()` for explicit cleanup if needed.
