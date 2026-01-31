# Phase 55: Advanced Face Settings & TTA Fix

## Summary
Implemented advanced face detection settings to allow users to tune the trade-off between sensitivity (catching difficult faces) and precision (avoiding false positives). Also fixed a critical issue where low-threshold Macro scans were detecting knees/elbows as faces by implementing a TTA Safety Boost.

## Changes

### 1. Advanced Settings UI (`SettingsModal.tsx`)
-   Added "Advanced" tab to Settings.
-   Added granular sliders (0.01 step) for:
    -   `Standard Threshold`: Default 0.65 (High precision).
    -   `Macro Threshold`: Default 0.25 (High sensitivity).
    -   `NMS Threshold`: Default 0.3 (Overlap handling).
-   Added toggles for:
    -   `Enable TTA` (Rotation Augmentation).
    -   `Enable Macro Low Res` (Tiny face detection).

### 2. Backend Configuration (`ConfigService.ts`, `main.py`)
-   Updated `AppConfig` to support `advancedFace` object.
-   Updated `PythonAIProvider` to inject these settings into `analyze_image` payload.
-   Updated `main.py` to respect these dynamic thresholds instead of hardcoded constants.

### 3. TTA Safety Boost (`main.py`)
-   **Problem**: In Macro mode (thresh 0.25), TTA (Test Time Augmentation) rotates images 90/180/270 degrees. This caused "pareidolia" where knees/elbows looked like faces upside down and passed the low threshold.
-   **Fix**: Implemented `TTA_THRESHOLD_BOOST` (+0.10).
-   **Logic**: Rotated detections must now meet a higher confidence floor (0.45) to be accepted, while standard detections can still pass at 0.25.
-   **Result**: False positives (knees) eliminated, while valid faces (Sleeping Girl) are still detected if they meet the criteria or visible in normal orientation.

### 4. 3D Landmark Model (`faces.py`)
-   Enabled `landmark_3d_68` module in InsightFace to improve pose estimation accuracy for difficult angles.

## Verification
-   **Unit Tests**: Verified `ConfigService` handles nested advanced config correctly.
-   **Integration Tests**: Verified `main.py` accepts and applies the config modifications.
-   **Manual**: Verified "Knee" false positive is gone in TTA mode.

## Next Steps (Phase 56)
-   Implement **Background VLM Verification** to handle the "Flowers vs. Sleeping Girl" dilemma (both low score, but one is semantic noise).
