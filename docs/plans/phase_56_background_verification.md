# Phase 56: Background VLM Verification

## Problem
To detect difficult faces (e.g., sleeping, profile, occluded), we must lower the detection threshold (e.g., to 0.25). However, this introduces false positives like knees, elbows, and flowers being detected as faces. Simple geometric filters (size, aspect ratio) are insufficient to distinguish these.

## Solution: Background VLM Verification
To avoid slowing down the main scan (currently ~7s/photo), we will perform VLM verification **asynchronously** in the background.

### 1. The "Suspect" Flag
-   Repurpose the existing `entity_type` column in the `faces` table.
-   Standard detections: `entity_type = 'human'` (Default).
-   Low-confidence TTA/Macro detections (0.20 - 0.45): `entity_type = 'suspect'`.
-   "Suspect" faces are saved immediately but **hidden from the UI** until verified.

### 2. Background Verification Service
A new service `BackgroundVerificationService` will:
1.  Poll for faces with `entity_type = 'suspect'`.
2.  Send them to the Python backend for VLM analysis ("Is this a face?").
3.  **If YES**: Update `entity_type` to `'human'` (Face appears in UI).
4.  **If NO**: Mark `is_ignored = 1` (Face hidden but retained for audit).

This keeps the scanning loop fast while ensuring high precision for difficult faces.

### 3. User Feedback & Retroactive Handling
-   **UI**: Add a `PendingVerificationCounter` in Settings → Advanced tab.
-   **Status**: Users see "X Faces Pending Verification" with spinner.
-   **Retroactive Tool**: "Audit Low Confidence Faces" button in Settings.
    -   Query: `score < 0.45 AND entity_type = 'human'`
    -   Action: Updates to `entity_type = 'suspect'`, triggering background service.

---

## Proposed Changes

### [database] `electron/db.ts` (Schema)
-   **Add column** `faces.verification_attempts INTEGER DEFAULT 0`.
-   Used to track VLM verification retries; auto-ignore face after 3 failures.

---

### [python] `src/python/config.py`
-   Add `VERIFICATION_THRESHOLD = 0.45` constant.
-   Add `SUSPECT_ENTITY_TYPE = 'suspect'` constant.

---

### [python] `src/python/main.py`
-   Update `scan_results` to include `entityType` field.
-   Logic: If `score < VERIFICATION_THRESHOLD`, set `entityType = 'suspect'`. Default `'human'`.

---

### [python] `src/python/facelib/vlm.py`
-   Add `verify_is_face(image_path: str, box: dict) -> dict`:
    ```python
    def verify_is_face(image_path: str, box: dict) -> dict:
        """
        Use VLM to verify if the cropped region is a human face.
        
        Args:
            image_path: Path to the source image.
            box: Dict with x1, y1, x2, y2 coordinates.
        
        Returns:
            {
                "is_face": bool,
                "confidence": float,  # 0.0-1.0
                "reason": str | None  # e.g., "elbow", "flower" if rejected
            }
        """
    ```
-   VLM Prompt: `"Is this a human face? Answer YES or NO, then briefly explain why."`
-   Error Handling: On VLM error/timeout, return `{"is_face": None, "error": "..."}`

---

### [typescript] `electron/ipc/aiHandlers.ts`
-   Add IPC handler `ai:verifyFace`:
    ```typescript
    ipcMain.handle('ai:verifyFace', async (_, imagePath: string, box: object) => {
        return await aiProvider.verifyFace(imagePath, box);
    });
    ```

---

### [typescript] `electron/infrastructure/PythonAIProvider.ts`
-   Add method `verifyFace(imagePath: string, box: object)`:
    -   Calls Python `verify_is_face` command.
    -   Returns `{ is_face: boolean, confidence: number, reason?: string }`.

---

### [typescript] `electron/data/repositories/FaceRepository.ts`
-   **Modify** `getAllFaces()`: Add `WHERE entity_type = 'human'` filter.
-   **Modify** `getUnclusteredFaces()`: Add `WHERE entity_type = 'human'` filter.
-   **Add** `getSuspectFaces(limit: number)`: Fetch faces with `entity_type = 'suspect'`, ordered by `photo.created_at DESC` (recent first).
-   **Add** `countSuspectFaces()`: Return count for UI badge.
-   **Add** `updateFaceEntityType(id: number, entityType: string)`: Update entity_type.
-   **Add** `markFaceAsRejected(id: number)`: Set `is_ignored = 1` for failed verification.
-   **Add** `incrementVerificationAttempts(id: number)`: Increment `verification_attempts` column, return new count.

---

### [typescript] `electron/core/services/BackgroundVerificationService.ts` [NEW]
-   Implements `IService` interface (start/stop/isRunning).
-   **Loop Pattern** (mirrors `BackgroundBucketingService`):
    1.  Check `isScanning` flag → pause if true.
    2.  Fetch batch of suspect faces (batch size = 10, ordered by recent photos first).
    3.  For each face, call `ai:verifyFace`.
    4.  If `is_face = true` → `updateFaceEntityType(id, 'human')`.
    5.  If `is_face = false` → `markFaceAsRejected(id)`.
    6.  If `is_face = null` (VLM error):
        -   `incrementVerificationAttempts(id)`.
        -   If attempts >= 3 → `markFaceAsRejected(id)` (auto-ignore after 3 failures).
        -   Otherwise, skip for retry next loop.
    7.  Sleep 5s, repeat.
-   **Yield**: Call `yield()` between faces to prevent UI blocking.
-   **Shutdown**: Graceful stop with promise resolution.

---

### [typescript] `electron/core/services/ServiceManager.ts`
-   Register `BackgroundVerificationService`.
-   Start order: After `BackgroundBucketingService`.

---

### [typescript] `electron/ipc/faceHandlers.ts`
-   Add IPC handler `face:auditLowConfidence`:
    ```typescript
    ipcMain.handle('face:auditLowConfidence', async () => {
        const count = FaceRepository.markLowConfidenceAsSuspect();
        return { updated: count };
    });
    ```

---

### [typescript] `src/stores/appState.ts`
-   Add `pendingVerifications: number` state.
-   Add action to update count from IPC.

---

### [typescript] `src/components/SettingsModal.tsx`
-   **Advanced Tab**:
    -   Status indicator: `"Background Verification: [Active/Idle] | Pending: X"`
    -   "Audit Low Confidence Faces" button → triggers `face:auditLowConfidence`.

---

## Verification Plan

### Manual Testing
1.  **Scan Wedding Photo**: Confirm 0 faces initially (all suspects), faces appear as service validates.
2.  **Scan Sleeping Girl**: Confirm marked 'suspect' initially, then 'human' after VLM check.
3.  **False Positive Rejection**: Scan image with knees/flowers, confirm they are ignored after service runs.

---

## Test Plan

### Unit Tests

#### `FaceRepository.test.ts`
| Test Case | Description |
|-----------|-------------|
| `getSuspectFaces returns only suspect faces` | Insert faces with various entity_types, verify only suspects returned |
| `countSuspectFaces returns correct count` | Insert 5 suspect faces, verify count = 5 |
| `updateFaceEntityType changes type` | Update suspect → human, verify change persists |
| `markFaceAsRejected sets is_ignored` | Call method, verify is_ignored = 1 |
| `getAllFaces excludes suspect faces` | Insert human + suspect faces, verify only human returned |
| `getUnclusteredFaces excludes suspect faces` | Same as above for unclustered query |

#### `main.py` / `scan_tests.py`
| Test Case | Description |
|-----------|-------------|
| `low confidence returns suspect entityType` | Mock detection with score 0.35, verify entityType = 'suspect' |
| `high confidence returns human entityType` | Mock detection with score 0.85, verify entityType = 'human' |
| `threshold boundary (0.45) returns human` | Score exactly at threshold → human |
| `threshold boundary (0.44) returns suspect` | Score just below threshold → suspect |

#### `vlm.py` / `vlm_tests.py`
| Test Case | Description |
|-----------|-------------|
| `verify_is_face returns True for valid face` | Use known face crop, verify is_face = True |
| `verify_is_face returns False for non-face` | Use knee/flower crop, verify is_face = False |
| `verify_is_face handles VLM timeout` | Mock timeout, verify graceful error return |
| `verify_is_face handles corrupt image` | Pass invalid path, verify error return |

---

### Integration Tests

#### `BackgroundVerificationService.test.ts`
| Test Case | Description |
|-----------|-------------|
| `service promotes suspect → human` | Insert suspect face, run service, verify entity_type = 'human' |
| `service rejects non-face → is_ignored` | Insert suspect non-face, mock VLM false, verify is_ignored = 1 |
| `service pauses during scan` | Set isScanning = true, verify no faces processed |
| `service handles VLM errors gracefully` | Mock VLM error, verify face remains suspect for retry |
| `service respects batch size` | Insert 50 suspects, verify only 10 processed per loop |

#### `faceHandlers.test.ts`
| Test Case | Description |
|-----------|-------------|
| `face:auditLowConfidence marks faces` | Insert low-score human faces, call handler, verify entity_type = 'suspect' |

---

### E2E / Browser Tests

| Test Case | Description |
|-----------|-------------|
| `Settings shows pending count` | Navigate to Settings → Advanced, verify "Pending: X" visible |
| `Audit button updates count` | Click audit button, verify pending count increases |
| `Suspect faces hidden from People view` | Scan with low-confidence face, verify not shown until verified |
