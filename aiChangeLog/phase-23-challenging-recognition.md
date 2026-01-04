# Phase 23: Challenging Face Recognition (Phase 5)

**Feature:** Improved Robustness for Non-Frontal Faces
**Version:** v0.4.5

## 🎯 Goal
Improve face recognition accuracy for challenging scenarios such as side profiles (yaw > 30°), partial occlusions, and varied lighting by leveraging **Pose Estimation** and **Multi-Sample Voting**.

## 🏗 Key Changes

### 1. Pose & Quality Extraction (Backfilled)
- **New Columns:** Added `pose_yaw`, `pose_pitch`, `pose_roll`, and `face_quality` to `faces` table.
- **Backfill Logic:** Implemented a background process to extract this data for existing 6,000+ faces.
- **Fixes:** Resolved critical issues with RAW image orientation (EXIF) and crop padding that were causing failures on rotated images.

### 2. Multi-Sample Voting ("Consensus")
- **Problem:** Single-sample matching (Standard FAISS) is brittle for disjoint clusters (e.g., a person looking left vs. looking right).
- **Solution:** `FaceService.matchBatch` now retrieves the Top-K candidates from FAISS and applies a **Weighted Voting** algorithm.
- **Logic:**
    - Each candidate casts a vote weighted by its similarity score.
    - Multiple matches for the same `person_id` boost the confidence score.
    - The winner is the person with the highest consensus score.

### 3. Quality-Adjusted Thresholds
- **Problem:** Strict thresholds (0.6) reject valid side-profile matches. Relaxed thresholds (0.8) cause false positives on frontal faces.
- **Solution:** `FaceAnalysisService.getQualityAdjustedThreshold` dynamically adjusts the cut-off.
    - **High Quality (Frontal):** Stricter threshold (e.g. 0.65).
    - **Low Quality / Side Profile:** Relaxed threshold (e.g. 0.75).
- **Result:** Captures difficult angles without increasing false positives for easy faces.

### 4. UI Feedback
- **Badges:**
    - **`?` Badge:** Indicates a "Weak Match" (Review Tier), prompting user verification.
    - **Scores:** Tooltip shows the confidence percentage.
    - **Quality Icon:** (Internal logic prepares for this, though UI emphasizes match confidence).

## 🧪 Verification
- **Unit Tests:** Added extensive tests for `FaceAnalysisService` (voting logic, threshold curves) and `FaceRepository` (schema validation).
- **Manual Test:** Validated against problematic RAW files (`DSC07656.ARW`, `DSC08057.ARW`) that previously failed to match due to rotation issues.

## ⚠️ Notes
- **Requires Rescan (Phase 5 Upgrade):** Users must run the "Face Data Upgrade" in Settings to populate the pose columns for existing faces.
- **Performance:** Voting adds negligible overhead (<10ms) but significantly improves reliability.
