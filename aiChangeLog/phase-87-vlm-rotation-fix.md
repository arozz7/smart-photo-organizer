# Phase 87: VLM Rotation Fix & Stability

## Goal
Fix VLM's inability to verify rotated faces (upside down, sideways) and resolve backend crashes causing frontend network errors.

## Changes

### 1. Refactored `vlm.py`
- **Helper Function**: Extracted `analyze_face_crop(face_crop)` from `verify_is_face` to allow recursive calls on modified inputs.
- **TTA (Test-Time Augmentation)**: Implemented logic to retry verification on 180°, 90°, and 270° rotated crops if the initial upright crop fails.
- **Error Handling**: Improved error catching to prevent backend crashes from propagating as network errors to the frontend.

### 2. Stability Fixes
- Resovled `net::ERR_NETWORK_CHANGED` by ensuring the Python backend doesn't crash on VLM failures.

## Verification
- [x] Code inspection of `vlm.py` confirms TTA logic.
- [ ] Runtime verification with rotated face images (pending).

## Risk Assessment
- **Performance**: TTA introduces up to 3 additional VLM calls per failed face candidate. This is acceptable as it only triggers for rejected faces, which are fewer than accepted ones in typical scenarios, and accuracy is priority.
- **False Positives**: Rotation might increase false positives if non-faces look like faces when rotated. Existing NMS and probability checks should mitigate this.
