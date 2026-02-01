# Face Detection Tuning Guide

## Overview

This guide helps you optimize face detection settings for your photo library. The Smart Photo Organizer uses a multi-stage detection pipeline with configurable thresholds to balance accuracy and performance.

---

## Detection Pipeline

### Stage 1: InsightFace Detection
- **What it does**: Scans photos at multiple resolutions to find faces
- **Output**: Bounding boxes with detection scores (0.0-1.0)
- **Settings**: Detection threshold, TTA (Test Time Augmentation)

### Stage 2: NMS (Non-Maximum Suppression)
- **What it does**: Merges duplicate detections of the same face
- **Filters**: Embedding distance, aspect ratio, rotation awareness
- **Output**: Unique face boxes

### Stage 3: VLM Verification (Optional)
- **What it does**: Verifies low-confidence detections using AI vision model
- **Trigger**: Faces with score < VLM threshold OR large/unusual boxes
- **Output**: Confirmed faces or rejected false positives

---

## Key Settings

### 1. VLM Verification Threshold

**Location**: Settings → Advanced Face → VLM Verification Threshold

**Range**: 0.30 - 0.80 (Default: 0.65)

**What it controls**: Faces with detection scores **below** this threshold are marked as 'suspect' and verified by VLM.

#### Recommended Values by Use Case

| Threshold | Use Case | Pros | Cons |
|-----------|----------|------|------|
| **0.50-0.60** | Strict Mode | Fewer false positives (shoulders, knees) | Slower scans, more VLM work |
| **0.65** | Balanced (Default) | Good accuracy/speed balance | Some false positives may slip through |
| **0.70-0.80** | Fast Mode | Faster scans, less VLM work | More false positives |

#### When to Adjust

**Lower the threshold (0.50-0.60)** if you see:
- Shoulders, knees, or body parts detected as faces
- Objects (flowers, patterns) detected as faces
- You want maximum accuracy and don't mind slower scans

**Raise the threshold (0.70-0.80)** if you see:
- Too many valid faces being flagged for verification
- Scans are too slow
- You have a clean photo library with few false positives

---

### 2. Detection Threshold

**Location**: Settings → Advanced Face → Detection Threshold

**Modes**:
- **STANDARD**: 0.65 (high confidence faces only)
- **MACRO**: 0.24 (low threshold for distant/small faces)

**When to use MACRO mode**:
- Photos with distant subjects (landscapes, group photos)
- Small faces in large images
- You're willing to verify more suspect faces

**When to use STANDARD mode**:
- Close-up portraits
- High-quality photos
- You want fewer false positives

---

### 3. TTA (Test Time Augmentation)

**Location**: Settings → Advanced Face → Enable TTA

**What it does**: Detects faces at multiple rotations (0°, 90°, 180°, 270°)

**Enable TTA if**:
- You have photos with sideways/upside-down faces
- You want maximum recall (find all faces)

**Disable TTA if**:
- All your photos are properly oriented
- You want faster scans
- You're seeing duplicate detections (rare with Phase 57 fixes)

---

## Common Scenarios & Solutions

### Scenario 1: False Positives (Shoulders, Knees, Objects)

**Symptoms**:
- Shoulders, knees, or body parts detected as faces
- Objects (flowers, patterns, reflections) detected as faces

**Solution**:
1. **Lower VLM threshold** to 0.55-0.60
2. **Enable VLM verification** (Settings → Advanced Face)
3. **Rescan affected photos** with "Force Rescan (Clean)"
4. **Check logs** for VLM rejections:
   ```
   [BackgroundVerificationService] Face X rejected (confidence: 0.3, reason: "shoulder")
   ```

**Expected Results**:
- More faces flagged as 'suspect'
- VLM automatically rejects false positives
- Cleaner face library

---

### Scenario 2: Duplicate Bounding Boxes

**Symptoms**:
- Same face detected multiple times
- Overlapping boxes on single face

**Causes** (Phase 57 fixes address these):
- TTA rotations creating duplicates ✅ Fixed (rotation-aware NMS)
- Multi-resolution scans ✅ Fixed (embedding distance check)

**Solution** (if still occurring):
1. **Rescan with Phase 57 fixes** (already applied)
2. **Check logs** for NMS merges:
   ```
   [NMS] Prevented merge: embedding distance 1.397 > 1.2 (different faces)
   [Face] Post-TTA NMS reduced count from 7 to 2
   ```
3. **Report issue** if duplicates persist (may indicate new edge case)

---

### Scenario 3: Multi-Face Boxes

**Symptoms**:
- Single bounding box contains 2+ faces
- Box is unusually wide or tall

**Phase 57 Improvements**:
- **Aspect ratio filter**: Rejects boxes with ratio >1.5 or <0.67
- **Size-based VLM trigger**: Flags boxes >4M pixels (2000x2000) for verification

**Current Limitation**:
- SmolVLM cannot reliably count faces in cropped regions
- Large multi-face boxes may be incorrectly verified as 'human'

**Workaround**:
1. **Manually ignore** multi-face boxes in UI
2. **Use "Ignore" feature** to exclude from person matching
3. **Wait for Phase 2** (re-detection workflow) - deferred pending VLM research

**Expected Logs**:
```
[Filter] Rejected multi-face box: aspect ratio 1.58 (box: 3045x1932)
[FaceService] Flagged face as suspect: large box (12,891,690px)
[VLM] Response: {"face_count": "one", "is_face": true, "reason": "the two people are looking at each other"}
```

---

### Scenario 4: Missed Faces (False Negatives)

**Symptoms**:
- Valid faces not detected
- Faces in shadows, profiles, or distant subjects missed

**Solutions**:
1. **Enable MACRO mode** (lower detection threshold to 0.24)
2. **Enable TTA** for sideways/rotated faces
3. **Check photo quality**:
   - Blur score (faces in motion may be skipped)
   - Face size (very small faces <50px may be missed)
   - Extreme poses (>90° yaw/pitch may be missed)

**Limitations**:
- InsightFace model has inherent limitations for extreme poses
- See [`face-recognition-technology.md`](file:///j:/Projects/smart-photo-organizer/docs/face-recognition-technology.md) for technical details

---

## Troubleshooting Workflow

### Step 1: Identify the Issue

Run this query to analyze your face data:

```sql
SELECT 
    entity_type,
    COUNT(*) as count,
    ROUND(AVG(score), 3) as avg_score,
    MIN(score) as min_score,
    MAX(score) as max_score
FROM faces
WHERE is_ignored = 0 OR is_ignored IS NULL
GROUP BY entity_type;
```

**What to look for**:
- High count of `entity_type = 'suspect'` → VLM is working, may need threshold adjustment
- Low avg_score for 'human' faces → May have false positives, lower VLM threshold
- High avg_score for 'suspect' faces → VLM threshold too high, raise it

---

### Step 2: Adjust Settings

Based on Step 1 results:

| Observation | Action |
|-------------|--------|
| Many 'suspect' faces with high scores (>0.70) | Raise VLM threshold to 0.70-0.75 |
| 'Human' faces with low scores (<0.50) | Lower VLM threshold to 0.55-0.60 |
| Missed faces in photos | Enable MACRO mode + TTA |
| Too many false positives | Lower VLM threshold to 0.50-0.60 |

---

### Step 3: Rescan & Verify

1. **Select problematic photos** in Library view
2. **Right-click → Force Rescan (Clean)** to re-detect with new settings
3. **Monitor logs** for VLM activity:
   ```
   [BackgroundVerificationService] Processing X suspect faces
   [VLM] Response: {"is_face": false, "reason": "shoulder"}
   ```
4. **Check results** in UI - false positives should be rejected

---

### Step 4: Fine-Tune

Iterate on Steps 1-3 until you achieve desired accuracy:

**Success Metrics**:
- <5% false positives in face library
- >95% of valid faces detected
- Acceptable scan time for your workflow

---

## Advanced Topics

### Understanding Detection Scores

**Score Range**: 0.0 - 1.0

| Score Range | Interpretation | Typical Content |
|-------------|----------------|-----------------|
| **0.90-1.00** | Very high confidence | Clear, frontal faces |
| **0.70-0.89** | High confidence | Good quality faces, slight angles |
| **0.50-0.69** | Medium confidence | Profiles, shadows, distant faces |
| **0.30-0.49** | Low confidence | Extreme poses, very small faces, potential false positives |
| **<0.30** | Very low confidence | Likely false positives (shoulders, objects) |

**VLM Threshold Logic**:
- Faces with score **< threshold** → Marked as 'suspect' → VLM verification
- Faces with score **≥ threshold** → Marked as 'human' → No verification (unless large/unusual box)

---

### NMS Filters (Phase 57)

The NMS stage applies multiple filters to prevent incorrect merges:

1. **Embedding Distance**: Don't merge if face embeddings differ by >1.2 (different people)
2. **Aspect Ratio**: Reject boxes with ratio >1.5 or <0.67 (likely multi-face)
3. **Rotation Awareness**: Only compare embeddings for same rotation angle
4. **Size-Based Trigger**: Flag boxes >4M pixels for VLM verification

**Logs to watch**:
```
[Filter] Rejected multi-face box: aspect ratio 1.58 (box: 3045x1932)
[NMS] Prevented merge: embedding distance 1.397 > 1.2 (different faces)
[FaceService] Flagged face as suspect: large box (12,891,690px)
```

---

## Performance Considerations

### VLM Verification Impact

**Overhead per face**: ~2-3 seconds (GPU), ~10-15 seconds (CPU)

**Optimization strategies**:
1. **Raise VLM threshold** to reduce verification workload
2. **Use GPU** for VLM (10x faster than CPU)
3. **Let background service work** - verification happens during idle time
4. **Batch scans** - scan multiple photos at once for better GPU utilization

### Scan Time Estimates

| Mode | TTA | VLM Threshold | Faces/Photo | Time/Photo (GPU) |
|------|-----|---------------|-------------|------------------|
| STANDARD | Off | 0.70 | 2-3 | ~1-2s |
| STANDARD | On | 0.65 | 2-3 | ~3-5s |
| MACRO | On | 0.60 | 3-5 | ~5-8s |
| MACRO | On | 0.50 | 5-10 | ~10-20s |

*Times include detection + NMS + VLM verification*

---

## Related Documentation

- [`phase-56-verification-guide.md`](file:///j:/Projects/smart-photo-organizer/docs/phase-56-verification-guide.md) - VLM verification system overview
- [`face-recognition-technology.md`](file:///j:/Projects/smart-photo-organizer/docs/face-recognition-technology.md) - Technical deep dive
- [`user_manual.md`](file:///j:/Projects/smart-photo-organizer/docs/user_manual.md) - General usage guide

---

## Changelog

**Phase 57** (2026-02-01):
- Added VLM threshold tuning recommendations
- Documented NMS improvements (embedding distance, aspect ratio, rotation awareness)
- Added multi-face box troubleshooting
- Added performance optimization strategies

**Phase 56** (2026-01-30):
- Initial VLM verification system
- Background verification service
