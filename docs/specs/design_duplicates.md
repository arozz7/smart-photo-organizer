# Feature Design: Duplicate Photo Detection & Management

## 1. Core Philosophy
We distinguish between **Exact Duplicates** (waste of space) and **Visual Duplicates/Versions** (variations of the same shot). The system should enable users to *safely* delete the former and *organize* the latter.

## 2. Safety Principles (Crucial)
*   **Zero Automatic Deletion:** The system will NEVER automatically delete, move, or modify files based on similarity scores or hash matches.
*   **User Authority:** All destructive actions must be explicitly initiated by the user via the UI.
*   **Confirmation:** Bulk deletion actions requires a secondary confirmation prompt.
*   **Non-Destructive Stacking:** "Stacking" is a metadata operation (database only) and does not alter the physical file structure.

## 3. Technical Architecture

### A. Fingerprinting Strategy (Multi-Layered)
To handle the "Same filename but different photo" and "Edited versions" scenarios, we need three levels of identity:

1.  **File Identity (Path):** Already tracked.
2.  **Content Identity (Exact Hash):**
    *   **Algorithm:** BLAKE3 or XXHash (High speed) or SHA-256.
    *   **Scope:** Full file content.
    *   **Usage:** Identifies 100% identical byte-for-byte copies. Safe to delete.
3.  **Visual Identity (Perceptual Hash):**
    *   **Algorithm:** `dHash` (Difference Hash) or `pHash`.
    *   **Implementation:** 
        *   Resize to 32x32 gray-scale via `sharp` (Node) or `Pillow` (Python).
        *   Calculate 64-bit integer hash.
    *   **Usage:** Identifies resized, re-saved, or format-converted images.
    *   **Comparison:** Hamming Distance. Distance < 5 usually means "Same image".

### B. Database Schema Updates
Current schema has `file_hash` but it is unused. We should enhance it:
```sql
ALTER TABLE photos ADD COLUMN content_hash TEXT; -- BLAKE3/SHA256
ALTER TABLE photos ADD COLUMN perceptual_hash TEXT; -- Binary string or Hex of 64-bit int
ALTER TABLE photos ADD COLUMN size_bytes INTEGER;
```

### C. The "Stacking" Logic (Handling RAW+JPG)
Instead of treating RAW+JPG as duplicates, we introduce **Stacks**.
*   **Auto-Stacking Rules:**
    *   Same `capture_time` (within 1 sec) AND Same `camera_model` AND (Same `filename_stem` OR High Visual Similarity).
*   **Outcome:** The UI shows 1 item with a "Stack" badge. Deleting the stack deletes all versions (with confirmation), or user can "Unstack".

## 3. Workflow & UX

### Phase 1: Scan, Index & Queue
*   **Scanner Role:** 
    *   Fast filesystem scan.
    *   Insert key metadata (Path, Size, Date) into DB.
    *   Leave `content_hash` and `perceptual_hash` as `NULL`.
*   **Resilient Background Queue:**
    *   A dedicated background worker continuously polls `SELECT * FROM photos WHERE content_hash IS NULL`.
    *   **Persistence:** Since state is stored in the DB, processing automatically resumes after app restart.
    *   **Status Reporting:** UI shows "Analyzing Library: X remaining..." based on the count of null hashes.
    *   **Global Scope:** Hashes are compared across the entire `photos` table, enabling duplicate detection across different folders.

### Phase 3: "Review Duplicates" View (User Action Only)
A dedicated view where the user makes all decisions. No background cleanup agent exists.

#### Section 1: Exact Duplicates
*   **Layout:** List of duplicate groups.
*   **Selection:** User must manually select images to delete, or use "Select All in Group" helper buttons (e.g., "Select Oldest").
*   **Action:** "Move Selected to Trash" (Triggers Confirmation Dialog).

#### Section 2: Similar Photos
*   **Layout:** Side-by-side comparison.
*   **Smart Diff:** Highlight metadata differences (Resolution, Size, Date).
*   **Actions:**
    *   "Stack" (Group them together visually).
    *   "Keep Best" (User selects one winner, others are marked for deletion).

## 4. Implementation Plan (Proposed)

1.  **Backend (Node/Electron):**
    *   Update `scanner.ts` to compute `content_hash` (Stream-based XXHash).
    *   Update `db.ts` to add schema columns.
2.  **AI/Worker:**
    *   Implement `pHash` calculation (can be done in Node via `sharp` for speed, or Python).
3.  **Frontend:**
    *   New Route: `/duplicates`.
    *   UI Components for "Comparison Card" and "Resolver".

## 5. Potential Risks & Edge Cases
*   **Hash Collisions:** Extremely rare with SHA-256/BLAKE3.
*   **False Positives (Visual):** Burst mode shots might look like duplicates.
    *   *Mitigation:* Show "Time Difference". Burst shots usually have ms differences. Stacking is better than deleting here.
