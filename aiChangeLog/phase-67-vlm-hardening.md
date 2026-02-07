# Phase 67: VLM Hardening & Configuration Centralization

## Changes
- **Configuration**:
    - Created `ai-config.json` in project root.
    - Centralized thresholds: `score_threshold_strict` (0.60), `score_threshold_vlm_verification` (0.85).
    - Added `forbidden_keywords` and `forbidden_objects` lists.
    - Added `enable_tta` flag (default false).

- **Python Backend**:
    - Refactored `src/python/config.py` to load `ai-config.json`.
    - Refactored `src/python/facelib/detector.py` to use `AI_CONFIG` and respect `enable_tta`.
    - Refactored `src/python/facelib/vlm.py` to use `AI_CONFIG` for keyword/object filtering.

- **TypeScript Backend**:
    - Updated `electron/core/services/ConfigService.ts` to load `ai-config.json`.
    - Updated `electron/core/services/FaceService.ts` to use centralized thresholds.

## Impact
- **Fixes**:
    - "Ghost Faces" (rocks, foliage, random objects) are now strictly rejected if they contain forbidden terms (e.g. "hat", "camera") or lack anatomical proof.
    - "Misaligned/Double Boxes" on faces are resolved by disabling TTA.
- **Maintenance**:
    - AI settings can now be tuned via `ai-config.json` without code changes.
