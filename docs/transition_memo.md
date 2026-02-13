# Transition Memo: Fixing Face Merging Logic (Mother+Baby Case)

## Current State
We are investigating a persistent issue where distinct faces in close proximity (e.g., Mother holding Baby, ~64% overlap) are being merged/deleted despite having `NMS=0.45` and `Dedup=0.55`. We fixed a configuration bug (persistence) and the "Physics Rule" (100% overlap), but the issue persists.

## Technical Details
- **Target Photo:** `pexels-filiamariss-14994487.jpg` (Mother & Baby).
- **Key File:** `src/python/facelib/nms.py`
- **Current Settings (Fixed):** `NMS=0.45`, `Dedup=0.55`, `Strict Dist=1.1`, `Lax Dist=1.2`.
- **Identified Root Cause:** **Rule B (Trash/Ghost Rule)** in `nms.py`.
    - Logic: `if io_min > 0.60` (High Overlap) AND `dist > threshold` (Different Identity).
    - Action: `should_merge = True` (assumes one is a Ghost/Trash).
    - **Flaw:** For Mother+Baby (High Overlap + Different Identify), this deletes the "lower quality" face (often the baby).
    - **Expected:** Only merge/delete if one face is notably lower quality (e.g. < 0.65). If **BOTH** are high quality (e.g. > 0.8), keep **BOTH**.

## Next Steps / Priority 1
1.  **Modify Rule B in `src/python/facelib/nms.py`**:
    - Add a check for `faceQuality`.
    - If `io_min > 0.60` and `dist > threshold` (Different People):
        - Check if **BOTH** faces have `quality > 0.70` (High Quality Exception).
        - If YES -> **DO NOT MERGE** (Treat as valid overlapping faces).
        - If NO (one is likely trash) -> **MERGE/DELETE** (Keep existing logic).

## Opening Instruction for Next AI
"Review `src/python/facelib/nms.py` specifically **Rule B** (IoMin > 0.60); it is currently merging distinct high-quality faces (Mother+Baby) because it interprets 'Different Identity + High Overlap' as a Ghost—please implement a 'High Quality Exception' to keep both faces if they are distinct and clear."
