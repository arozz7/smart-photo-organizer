# Phase 74: NMS High Quality Exception

## Objective
Fix Rule B in `nms.py` to prevent merging distinct high-quality faces that overlap (e.g., Mother holding Baby).

## Problem
**Rule B** (Trash/Ghost Rule) was incorrectly merging faces when:
- High Overlap (`io_min > 0.60`)
- Different Identity (`dist > threshold`)

The logic assumed "one must be trash/ghost" and deleted the lower quality face, but this failed for legitimate overlapping faces like Mother+Baby (~64% overlap, distinct embeddings).

## Solution

### Modified Files
- [`src/python/facelib/nms.py`](file:///J:/Projects/smart-photo-organizer/src/python/facelib/nms.py#L110-L130)

### Changes Made

#### Rule B Enhancement (Lines 110-130)
Added **High Quality Exception** logic:

```python
# [Phase 74 Fix] High Quality Exception
# If BOTH faces are high quality (> 0.70), they are likely distinct valid faces
# (e.g., Mother + Baby). Do NOT merge.
q_a = f.get('faceQuality', 0)
q_b = existing.get('faceQuality', 0)
high_quality_threshold = 0.70

if q_a > high_quality_threshold and q_b > high_quality_threshold:
    # Both are high quality - keep both (likely Mother+Baby scenario)
    should_merge = False
    logger.info(f"[NMS] High Quality Exception: Both faces are high quality (QA={q_a:.2f}, QB={q_b:.2f}). Keeping Separate despite overlap ({io_min:.2f}).")
else:
    # One is likely trash/ghost - merge (keep existing higher quality)
    should_merge = True
    logger.info(f"[NMS] RESOLVED by Quality Rule (>60% overlap, diff people): Dist={dist:.2f}, QA={q_a:.2f}, QB={q_b:.2f}. Keeping existing (Better Quality).")
    break
```

### Key Logic
1. **Extract Quality Scores:** Get `faceQuality` for both faces
2. **High Quality Threshold:** `0.70` (conservative to avoid false positives)
3. **Conditional Merge:**
   - If BOTH `quality > 0.70` → **Keep Separate** (High Quality Exception)
   - If ONE `quality <= 0.70` → **Merge** (Original Trash/Ghost logic preserved)

### Behavior Changes

| Scenario | Old Behavior | New Behavior |
|----------|--------------|--------------|
| Mother+Baby (both quality > 0.70, overlap 64%, diff identity) | ❌ Merged (baby deleted) | ✅ Both kept |
| Ghost face (quality < 0.65, overlap 70%, diff identity) | ✅ Merged (ghost deleted) | ✅ Merged (preserved) |
| TTA duplicates (same identity, high overlap) | ✅ Merged | ✅ Merged (handled by other rules) |

## Testing Plan

### Primary Test Case
- **Photo:** `pexels-filiamariss-14994487.jpg` (Mother holding Baby)
- **Expected:** Both faces detected and kept
- **Verification:** Check logs for "High Quality Exception" message

### Regression Tests
1. **Ghost Faces:** Verify low-quality faces still merged
2. **TTA Duplicates:** Verify same-face duplicates still merged
3. **Age/Gender Vetoes:** Verify existing veto logic still works

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| False negatives (keeping ghost faces) | Quality threshold of 0.70 is conservative; ghosts typically < 0.65 |
| Breaking existing behavior | Regression tests planned |
| Threshold needs tuning | Can make configurable in future iteration |

## Next Steps
1. Test with Mother+Baby photo
2. Verify logs show correct decision path
3. Run regression tests on ghost faces
4. Document results in walkthrough

## Test Results ✅

All tests passing (8/8):
- `test_high_quality_exception` - New test for Phase 74 fix
- `test_ghost_face_still_merged` - Regression test for ghost filtering
- `test_mother_child_separation` - Existing regression test
- `test_camera_in_face` - Nested trash scenario
- `test_ghost_tta_duplicate` - TTA duplicate merging
- `test_crowd_moderate_overlap` - Moderate overlap distinct faces
- `test_group_photo_distinct` - No overlap distinct faces
- `test_import_exists` - Module import test

### Key Findings
1. **Rule A Enhancement Required:** Initial implementation only modified Rule B, but tests revealed that 100% overlap cases (IoMin=1.0) were hitting Rule A first. Enhanced Rule A with the same quality check.
2. **Test Geometry Issues:** Fixed test box geometries to create actual 64-70% overlap instead of 100% overlap.
3. **Embedding Distance:** Used `embedding_B` (inverted) for distinct faces to ensure distance = 2.0 (well above threshold of 1.1).

## Assumptions
- Face quality scores are reliable (0-1 scale)
- Quality > 0.70 indicates a clear, well-detected face
- Ghost/trash faces typically have quality < 0.65

## Dependencies
- None (self-contained change to `nms.py`)

## Rollback Plan
If issues arise, revert to original Rule A and Rule B logic (simple merge on `dist > threshold`).

---

## Phase 74 Extension: Configuration Centralization 

### Additional Problems Found
1. **Duplicate Deduplication in FaceService.ts:** Lines 568-606 contained duplicate deduplication logic using hardcoded iou > 0.3
2. **Duplicate NMS Rules in nms.py:** Lines 144-157 contained old Rule A/B code overriding enhanced logic
3. **7 Hardcoded Threshold Values:** Scattered across Python and TypeScript

### Root Cause of Mother+Baby Bug
TypeScript FaceService.ts was re-merging faces that Python NMS correctly kept separate.

### Additional Changes
- Removed duplicate deduplication in FaceService.ts (lines 568-606)
- Removed duplicate NMS rules in nms.py (lines 144-157)
- Added 5 new threshold keys to ai-config.json
- Updated nms.py to load high_quality_face_threshold from config

### Final Results
- Mother+Baby: 2 faces (fixed!)
- Ghost faces: Still merged correctly
- All 8 unit tests passing

---

## Phase 74 Final Fix: Container Rejection & Quality Threshold (2026-02-08)

### Problem Analysis
The Mother+Baby photo still showed incorrect bounding boxes despite earlier fixes because:

1. **Multi-Face Detector Artifact:** InsightFace was outputting a 781x780px box covering BOTH faces as a single "face" with high score (0.83) and high quality (0.92). This large box was winning over the smaller individual face boxes.

2. **Quality Threshold Too High:** The mother's individual face box (564-width) had quality=0.68, which was below the 0.70 threshold for the high-quality exception. This caused it to be filtered out due to its low detection score (0.45).

### Changes Made

#### 1. Container Rejection Rule (nms.py)
Added pre-pass logic in `resolve_conflicts()` that detects and rejects "container" boxes:

```python
# [Phase 74] Pre-Pass: Reject "Container" boxes
# If a large box fully contains a smaller high-quality face with distinct embedding,
# the large box is likely a multi-face detection artifact.
if io_min > 0.9 and area_large > area_small * 1.5:
    if dist > 1.0 and q_small > high_quality_threshold:
        logger.info(f"[NMS] Container Rejection: Large box contains smaller high-quality face. Rejecting large box.")
        container_ids_to_remove.add(i)
```

**Logic:**
- Detect when a large box contains (IoMin > 0.9) a smaller box
- Check if large box is 1.5x bigger than small box
- Verify distinct identity (embedding distance > 1.0)
- Verify small face is high quality
- If all conditions met, REJECT the large box

#### 2. Quality Threshold Lowered (0.70 → 0.65)
Updated across all config locations:
- `ai-config.json`: `high_quality_face_threshold: 0.65`
- `config.py`: `high_quality_face_threshold: 0.65`
- `ConfigService.ts`: `highQualityFaceThreshold: 0.65`
- User's `config.json` (had cached 0.70)

### Detection Pipeline After Fix

| Step | Before Fix | After Fix |
|------|-----------|-----------|
| Raw Candidates | 3 (781px, 564px, 359px) | 3 (same) |
| Container Rejection | N/A | Removes 781px merged box |
| After NMS | 2 (781px merged, 359px baby) | 2 (564px mother, 359px baby) |
| Quality Filter | Baby kept (0.82>0.70), Mother dropped (0.68<0.70) | Both kept (0.82>0.65, 0.68>0.65) |
| Final Faces | 1 (wrong box) | 2 (correct boxes) ✅ |

### Files Modified
- [`src/python/facelib/nms.py`](file:///J:/Projects/smart-photo-organizer/src/python/facelib/nms.py) - Container Rejection pre-pass
- [`src/python/config.py`](file:///J:/Projects/smart-photo-organizer/src/python/config.py) - Threshold 0.65
- [`ai-config.json`](file:///J:/Projects/smart-photo-organizer/ai-config.json) - Threshold 0.65
- [`electron/core/services/ConfigService.ts`](file:///J:/Projects/smart-photo-organizer/electron/core/services/ConfigService.ts) - Threshold 0.65, interface update
- [`electron/core/services/FaceService.ts`](file:///J:/Projects/smart-photo-organizer/electron/core/services/FaceService.ts) - Debug logging

### Verification
- **Photo 58:** Both mother and baby faces now display with correct individual bounding boxes
- **Logs show:** `[NMS] Container Rejection: Large box (781x780) contains smaller high-quality face (359x360). Rejecting large box.`
