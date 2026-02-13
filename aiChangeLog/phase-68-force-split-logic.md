# Phase 68: Force Split Logic for Merged Faces

## 1. Issue
- **Problem**: `BackgroundVerificationService` failed to split "merged" faces (e.g., two men in `pexels-filiamariss-14994487.jpg`) even when VLM correctly identified them as "Multi-Face".
- **Root Cause**: The underlying detector (`detectFacesInRegion`) using `RetinaFace` at default scale (1280x1280) still merged the faces into a single blob, returning `faceCount: 1`. This caused the service to reject the blob without creating split faces.
- **Diagnosis**: Debugging with `scripts/debug_region_split.py` revealed that downscaling the detection input to `640x640` successfully separated the two faces (finding 2 instead of 0/1).

## 2. Changes
- **Python Backend (`scan.py`)**: Updated `detect_faces_in_region` command to accept an optional `detSize` parameter from the payload, allowing custom detection scales.
- **TypeScript Provider (`PythonAIProvider.ts`)**: Updated `detectFacesInRegion` signature to support the `options` object with `detSize`.
- **Service Logic (`BackgroundVerificationService.ts`)**: Implemented a **Multi-Scale Split Strategy**.
    - If VLM confirms "Multi-Face" but the detector finds <= 1 face at default scale (1280):
    - The service now retries detection with `detSize: [640, 640]`.
    - If the low-res pass finds > 1 face, it uses those results to split the blob.

## 3. Verification
- **Debug Script**: Confirmed that `detSize=(640, 640)` finds 2 separate faces for the target photo.
- **DB Status**: Manually remediated the target faces (IDs 222, 223) from `IGNORED` to `ACTIVE/suspect` via `scripts/remediate_faces.py` so the service will re-process them on next run.

## 4. Next Steps
- User should restart the application (or ensure `BackgroundVerificationService` is running).
- The service will pick up the remediated faces, confirm "Multi-Face" via VLM, fail at 1280 scale, retry at 640 scale, and successfully split them into two new face records.
