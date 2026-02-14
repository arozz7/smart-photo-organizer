# Phase 51: Fix Face Detection on Large Portraits

## Changes
- **Modified `src/python/main.py`**:
    - Implemented `Multi-Scale Fallback` loop.
    - If initial scan (usually 1280x1280) returns 0 faces, automatically retries at:
        1. 640x640
        2. 320x320
    - Logic updates `target_size` on success so subsequent TTA (Rotation Augmentation) uses the effective size.

## Rationale
- InsightFace's `buffalo_l` detection model (RetinaFace) has fixed anchor sizes.
- Extremely large faces (macro portraits) often exceed the largest anchor at high resolutions (1280+).
- Downscaling the image makes the relative face size smaller, fitting it back into the anchor range.
- 320x320 was requested by the user to catch extreme close-ups.

## Risks
- **Performance**: Adds extra influence time for images with *actually* 0 faces (will run 3 inference passes instead of 1).
- **False Positives**: Lower resolution detection *might* increase false positives, though `det_thresh` is kept constant.

## Verification
- Validated against user request for 320x320 support.
- Requires manual testing with `IMG_9905.nef`.
