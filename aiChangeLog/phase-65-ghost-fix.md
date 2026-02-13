# Phase 65: Fix Ghost Faces via VLM Verification (Refined v2)

## Problem (Initial Fix Regression)
The initial fix (Strict Floor 0.72) successfully removed "Ghost" faces but also removed valid **profile faces** (which often score ~0.65-0.70).
Additionally, VLM was still confirming some "rocks/foliage" as human because the prompt did not explicitly list them as false positives.

## Refined Solution
1.  **Lower Strict Floor**: Reduced to `0.65` to restore valid profile faces.
2.  **Raise VLM Threshold**: Increased to `0.85` (from 0.80).
    - Now faces `0.65 - 0.85` are verified.
    - This creates a SAFETY NET for the profiles (VLM will confirm them) and the ghosts (VLM will reject them).
3.  **Harden VLM Prompt**: Updated `src/python/config.py` to explicitly warn the model about "ROCKS, LEAVES, GROUND TEXTURES".
4.  **Expand Blacklist**: Added `rock, stone, concrete, pavement, foliage, leaf` to `non_face_keywords` in `vlm.py`.

## Changes
- `FaceService.ts`: Lowered `STRICT_FLOOR` to 0.65.
- `ConfigService.ts`: Raised `vlmVerificationThreshold` to 0.85.
- `src/python/config.py`: Hardened `VLM_VERIFICATION_PROMPT`.
- `src/python/facelib/vlm.py`: Added environmental keywords to blacklist.

## Impact
- **Profiles Restored**: Valid faces should reappear.
- **Ghosts Removed**: Rocks/leaves should be rejected by the hardened VLM.

## Final Fix (v3) - 2026-02-07
**Problem:** Ghosts persisted because `src/python/facelib/detector.py` was hardcoding `entity_type='human'` for faces > 0.65, bypassing TypeScript config.
**Solution:**
- Removed `entity_type` logic from Python `detector.py`.
- Deprecated `VERIFICATION_THRESHOLD` in `src/python/config.py`.
- Validated that `FaceService.ts` now correctly controls the threshold (0.85).

