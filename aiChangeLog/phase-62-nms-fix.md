# Phase 62: NMS Refinement (Duplicate Fix)

## 🎯 Goal
Eliminate persistent duplicate bounding boxes, especially in group shots or TTA scans where embeddings drift slightly.

## 🛠️ The Changes
### 1. High Overlap Bypass (`scan.py`)
- **Problem:** TTA (Test Time Augmentation) creates multiple crops of the same face. Occasionally, the embeddings for these texturally different crops vary by > 1.2 (L2 distance). The NMS logic previously treated these as "Different People" and kept both boxes.
- **Fix:** Added a **High Overlap Bypass**. If two boxes overlap by more than **85% (IoMin)**, we force a merge regardless of the embedding distance.
- **Rationale:** It is physically impossible for two different humans to occupy the same 85% of screen space.

### 2. Benefits
- **Cleaner Results:** Eliminates "Ghost" faces (duplicate boxes on the same face).
- **Recovered Faces:** Prevents one version of the face from suppressing the other incorrectly in edge cases.

## ⚠️ Notes
- This fix requires a **restart** of the Python backend (Main App) to take effect.
