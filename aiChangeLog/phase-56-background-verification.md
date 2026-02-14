# Phase 56: Background VLM Verification - Changelog

## Overview
Implemented asynchronous VLM-based verification for low-confidence face detections to eliminate false positives without impacting scan performance.

## Database Changes
- **Migration**: Added `verification_attempts INTEGER DEFAULT 0` column to `faces` table
- **Purpose**: Track retry count for VLM verification (auto-ignore after 3 failures)

## Python Backend

### New Files
- `src/python/config.py`: Configuration constants for verification thresholds

### Modified Files
- `src/python/facelib/vlm.py`:
  - Added `verify_is_face(image_path, box)` function
  - Uses SmolVLM to verify if cropped region is a human face
  - Returns `{is_face: bool | None, confidence: float, reason: str, error: str}`
  
- `src/python/main.py`:
  - Added `entityType` field to scan results (based on `VERIFICATION_THRESHOLD = 0.45`)
  - Faces with score < 0.45 marked as `'suspect'`, others as `'human'`
  - Added `verify_face` command handler

## TypeScript Infrastructure

### New Files
- `electron/core/services/BackgroundVerificationService.ts`:
  - Background service that processes suspect faces asynchronously
  - Batch size: 10 faces per iteration
  - Priority: Recent photos first (`ORDER BY photo.created_at DESC`)
  - Retry logic: Max 3 attempts, auto-ignore on failure
  - Pauses during active scanning

### Modified Files
- `electron/infrastructure/PythonAIProvider.ts`:
  - Added `verifyFace(imagePath, box)` method
  
- `electron/ipc/aiHandlers.ts`:
  - Added `ai:verifyFace` IPC handler
  - Added `face:auditLowConfidence` IPC handler (for manual audit)
  
- `electron/main.ts`:
  - Imported and registered `BackgroundVerificationService` in `ServiceManager`
  
- `electron/data/repositories/FaceRepository.ts`:
  - **Suspect Face Filtering**: Modified `getAllFaces()` and `getUnclusteredFaces()` to exclude `entity_type = 'suspect'` faces from UI
- **Priority Ordering**: `getSuspectFaces()` returns faces ordered by most recent photos first
  - Added `countSuspectFaces()`: Count pending verifications
  - Added `updateFaceEntityType(id, entityType)`: Promote suspect → human
  - Added `markFaceAsRejected(id)`: Mark as ignored after VLM rejection
  - Added `incrementVerificationAttempts(id)`: Track retry count
  - Added `markLowConfidenceAsSuspect()`: Audit existing low-confidence faces

## Bug Fixes

### FaceService INSERT Statement (Post-Implementation)
**Issue**: After deploying Phase 56, face scanning failed with parameter count mismatch errors. The `FaceService.processAnalysisResult()` INSERT statement was missing the new Phase 56 columns.

**Root Cause**: The database migration added `entity_type`, `score`, and `verification_attempts` columns, but the FaceService INSERT/UPDATE statements weren't updated to include them.

**Fix Applied**:
1. Updated INSERT statement to include all Phase 56 columns (23 parameters total)
2. Updated UPDATE statement to include `entity_type` and `score`
3. Added logic to automatically mark low-confidence faces (score < 0.45) as `'suspect'` during scanning
4. Ensured `verification_attempts` defaults to 0 for new faces

**Files Modified**:
- `electron/core/services/FaceService.ts` (lines 474-631)

**Impact**: Scanning now works correctly and automatically marks low-confidence detections (like the ear in the user's screenshot) as 'suspect' for background VLM verification.

## Verification Plan

## Behavior Changes

### Scan-Time
- Faces with detection score < 0.45 are now marked as `entity_type = 'suspect'`
- Suspect faces are hidden from UI until verified

### Background Processing
- `BackgroundVerificationService` runs continuously (5s sleep between batches)
- Processes 10 suspect faces per batch
- Prioritizes recent photos
- On VLM success (`is_face = true`): Promotes to `'human'` (visible in UI)
- On VLM failure (`is_face = false`): Marks as `is_ignored = 1`
- On VLM error (`is_face = null`): Increments retry counter, auto-ignores after 3 attempts

### Manual Audit
- Users can click "Audit Low Confidence Faces" button in Settings
- Marks all existing faces with score < 0.45 as `'suspect'` for background verification

## Testing Status
- [ ] Unit tests for FaceRepository methods
- [ ] Unit tests for Python VLM verification
- [ ] Integration tests for BackgroundVerificationService
- [ ] Manual verification testing

## Known Limitations
- VLM verification requires SmolVLM model (auto-downloaded on first use)
- Verification speed depends on GPU availability
- No UI indicator for pending verifications count (planned for future phase)

## Next Steps
- Implement UI state for `pendingVerifications` count
- Add status indicator in SettingsModal
- Write comprehensive unit and integration tests
