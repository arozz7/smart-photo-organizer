# Phase 79: Face Detection Refinements & VLM Robustness

**Status:** ✅ Complete
**Date:** February 10, 2026

## Goal
Resolve persistent issues with missing faces (due to VLM rejection/hallucination) and false positive loops during photo rescans.

## Changes

### 1. Rescan Loop Prevention
**Issue:** Non-face boxes (detected but rejected by VLM) were being re-detected on subsequent scans, creating an infinite loop.
**Fix (`FaceService.ts`):**
- Modified `cleanRescan` logic to **preserve** ignored faces as "Rejection Memory".
- Added filtering in `deduplicateFaces` to skip new detections that significantly overlap (IoMin > 0.5) with existing ignored faces.

### 2. VLM Hallucination Handling (Fail Open)
**Issue:** The VLM model hallucinated garbage output (HTML, code comments, random JSON) for occluded faces (e.g., "Girl duo" with heart glasses), causing valid faces to be rejected.
**Fix (`src/python/facelib/vlm.py`):**
- **Garbage Detection:** Added checks for HTML tags, code comments (`//`, `/*`), and random text keywords.
- **Retry Logic:** Implemented a 3-attempt retry loop with increasing temperature (0.1 → 0.3 → 0.5) to break hallucination loops.
- **Fail Open:** If all retries fail or produce invalid JSON (missing `is_face`), the system defaults to `is_face=True` to avoid rejecting valid faces.

### 3. Fail Open Score Filtering
**Issue:** The "Fail Open" logic was too aggressive, accepting low-confidence noise (e.g., hair/shoulders with score 0.24).
**Fix (`electron/core/services/BackgroundVerificationService.ts`):**
- Added a safety check for "Fail Open" results.
- **Rule:** If VLM fails open, ONLY accept the face if the original detection score is **> 0.6**.
- **Outcome:** High-confidence occluded faces (0.80) are accepted, while low-confidence noise (0.24) is rejected.

## Files Modified
- `electron/core/services/FaceService.ts`
- `electron/core/services/BackgroundVerificationService.ts`
- `src/python/facelib/detector.py`
- `src/python/facelib/vlm.py`
- `docs/face_tuning_log.md`

## Verification
- **"Girl duo.jfif":** Verified that the woman on the left (score 0.80) is detected and accepted despite VLM hallucination.
- **Noise Rejection:** Verified that low-score false positives (score 0.24) are rejected by the new filter.
