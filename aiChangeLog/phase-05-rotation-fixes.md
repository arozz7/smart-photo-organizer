# Phase 5: Rotation & Face ID Preservation

## Diff Narrative
Addressed the critical issue where rotating an image caused face bounding boxes to become invalid or misaligned. Instead of purely mathematical transformation (which failed due to initial detection inaccuracies), we now perform a full re-scan of the rotated image while preserving person identities.

### 1. Safe Rotation with Re-Scan
- **Workflow:** When an image is rotated, the system now:
  1. Captures existing faces.
  2. Rotates the image file (and updates EXIF).
  3. **Re-scans** the image using the AI engine to find fresh, accurate face bounding boxes.
  4. Maps old faces to new faces to preserve `person_id`.

### 2. ID Preservation Logic
- **Heuristic Matching:** Uses a distance-based heuristic (tolerant to 8% of image dimension) to match "transformed" old face locations to newly detected faces.
- **Strict Mapping:** Ensures 1:1 mapping to prevent multiple new faces from claiming the same identity or merging incorrectly.

### 3. UI Feedback
- **Feedback Loop:** Added a "Saving & Re-Scanning..." state to the UI to inform the user of the longer processing time (due to the re-scan).
- **Timeout Fix:** Increased IPC timeout to 5 minutes to accommodate model cold-starts during re-scan.

## Changed Files
- `electron/main.ts`: Implemented `ai:rotateImage` with re-scan logic, promise handling fixes, and ID mapping.
- `src/python/main.py`: Updated `rotate_image` to return full dimensions; verified `analyze_image` fits re-scan needs.
- `src/components/PhotoDetail.tsx`: Added loading state and spinner to Rotation "Save" button.
