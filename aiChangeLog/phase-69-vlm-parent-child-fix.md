# Phase 69: VLM Multi-Face & Context Fixes

## Summary
Improved Visual Language Model (VLM) verification by increasing context padding, adding multi-face detection logic (parent/child coupling), and utilizing centralized configuration for rejection lists.

## Changes Made

### VLM Refinements (`src/python/facelib/vlm.py`)
- **Increased Context:** Changed crop padding from 0.25 to 1.0 (doubling the context area) to help VLM see surrounding cues like bodies or other people.
- **Multi-Face Detection:** Added logic to detect "group", "couple", or parent/child terms (e.g., "woman holding baby") in the VLM description.
    - Sets `suggested_metadata['is_multi_face'] = True`.
- **Plural Form Support:** Added plural terms ("men", "women", "children", "people") to `face_proof` and `person_indicators` to prevent false rejections of groups.
- **Config Integration:** Replaced hardcoded `forbidden_objects` and `forbidden_keywords` with loads from `AI_CONFIG`.
- **Debug:** Commented out debug crop saving to reduce disk I/O.
- **Error Handling:** Added traceback printing for JSON decode errors.

## Impact
- Better detection of small faces (babies) when held by parents due to increased context.
- Prevention of false negatives when VLM sees multiple people and describes them collectively.
- Flags multi-face regions for potential splitting by downstream logic (FaceService).
