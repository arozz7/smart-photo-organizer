# Phase 52: Fix cleanRescan Issue

## Overview
Fixed an issue where manually triggering a "Force Face Scan" from the Photo Detail view was not sending the `cleanRescan: true` flag to the backend. This resulted in duplicate faces accumulating instead of replacing old scan data.

## Changes
### Frontend
- **PhotoDetail.tsx**: Updated `handleForceScan` and the "Force Face Scan" button logic to explicitly include `{ cleanRescan: true }` in the IPC payload.
- **Library.tsx**: Updated "Rescan" selected/filtered actions to log force status and ensure `forceRescan` is true when requested.
- **ScanContext.tsx**: Updated `rescanFiles` to explicitly pass `cleanRescan: forceRescan` to the IPC `scan-files` handler, ensuring downstream queue processing respects the flag.

### Backend (Python)
- **main.py**:
    - **False Postive Tuning**:
        - Increased `MACRO` mode detection threshold to `0.50` (was 0.35 -> 0.45).
        - **Strict Small Object Filter**: Faces < 50px now require > 0.70 confidence (removes distant shoes/flowers).
        - **General Integrity Filter**: Rejects faces with < 0.50 confidence unless they are massive profiles (>300px).
    - **False Negative Tuning (Portraits)**:
        - Relaxed `Tenengrad` (Sharpness) threshold from `100.0` to `40.0` for Standard mode. This fixes the issue where soft-focus/bokeh portraits were being rejected as "blurry".
    - **Robustness**:
        - Added **RAW Loading Fallback**: If `rawpy` (high-quality decoder) fails to open a RAW file (e.g. "Unsupported format"), the system now seamlessly falls back to the system's standard loader (using embedded previews). This fixes the error seen on `IMG_9905.nef`.





## Verification
- [ ] Open a photo details view.
- [ ] Click "Force Face Scan" (or the magnifying glass).
- [ ] Check logs: verify `[IPC] cleanRescan=TRUE received!` appears.
