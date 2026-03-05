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

**Range**: 0.30 - 0.90 (Default: 0.85)

**What it controls**: Faces with detection scores **below** this threshold are marked as 'suspect' and verified by VLM.

#### Recommended Values by Use Case

| Threshold | Use Case | Pros | Cons |
|-----------|----------|------|------|
| **0.65** | Fast Mode | Faster scans, less VLM work | More false positives (ghosts) |
| **0.85** | Balanced (Default) | Catches ghosts & verifies profiles | Slower scans (more verification) |
| **0.90+** | Strict Mode | Verifies almost everything | Slowest |

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

### Scenario 1.5: "Ghost Faces" (Rocks, Foliage with High Score)

**Symptoms**:
- Inanimate objects (rocks, leaves, ground) detected as faces with high scores (0.75-0.80).
- VLM fails to kick in because score > old threshold (0.65).

**Solution**:
1. **Raise VLM threshold** to **0.85** (Default in v0.5.5+).
   - This checks everything below 0.85, catching the 0.80 ghosts.
2. **Ensure VLM Prompt is hardened** (Automatic in v0.5.5+).
   - Prompt now explicitly rejects "rocks, stones, foliage".
3. **Rescan** affected photos.

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

## Face Grouping (Clustering) Parameters

Clustering runs *after* detection, on the unnamed faces in your library. These parameters control how faces are grouped in the **Discoveries** tab (the Regroup pipeline).

### DBSCAN Algorithm

The app uses DBSCAN (Density-Based Spatial Clustering) on L2-normalized ArcFace embeddings. All distances are euclidean on normalized vectors (equivalent to cosine similarity).

**Key concept — chain-linking:** DBSCAN only requires each member to be within epsilon of *at least one* other member. This can cause A → B → C chains where A and C are completely different people. The spread and cohesion filters below break these up.

---

### Parameter Reference

#### `eps` (Similarity Threshold in UI)

Converted: `eps_cosine = 1 - threshold`, then `eps_euclidean = √(2 × eps_cosine)`.

| Threshold (UI) | eps cosine | eps euclidean | Character |
|----------------|-----------|---------------|-----------|
| 0.55 | 0.45 | 0.949 | Permissive — catches weak matches |
| 0.65 | 0.35 | 0.837 | Balanced default |
| 0.68 | 0.32 | 0.800 | Slightly strict |
| 0.80 | 0.20 | 0.632 | Strict — only near-identical faces |

Lowering the threshold → fewer but purer groups (faces must be more similar to cluster).
Raising the threshold → more groups, looser matching.

---

#### `max_spread` (Cluster Purity in UI)

**What it measures:** After DBSCAN, for each cluster, compute the centroid (mean of L2-normalized members), then measure the maximum euclidean distance from any member to the centroid. If `spread > max_spread`, the cluster is demoted to singles.

**Typical values:**
| Cluster type | Spread |
|---|---|
| Tight same-person cluster | 0.3 – 0.5 |
| Same person, diverse poses/ages | 0.5 – 0.7 |
| Chain-linked mixed-person cluster | 0.7 – 1.3+ |

**Default:** `0.75` — eliminates obvious chains, preserves same-person diversity.

**Tuning:**
- Mixed faces still appearing in groups → lower to `0.60–0.65`
- Genuine large groups being split too aggressively → raise to `0.85–0.95`

**Log signal to watch:**
```
Cluster 0: size=42, magnitude=0.705, spread=0.869 -> DEMOTED (spread 0.869 > 0.75)
Cluster 1: size=7,  magnitude=0.810, spread=0.510   <- kept
```

---

#### `min_cohesion` (hardcoded, not exposed in UI)

**What it measures:** The L2 magnitude of the cluster centroid vector.
- Same-person cluster (all vectors point the same direction): magnitude ≈ 0.7–1.0
- Garbage cluster (random objects, vectors cancel): magnitude ≈ 0.0–0.4

**Hardcoded default:** `0.6` for the main Regroup path. Rarely needs adjustment — this catches pure non-face object clusters (hands, objects, cartoon characters) that somehow formed a DBSCAN cluster.

---

### Scenario: Mixed Faces in Groups (Chain-Linking)

**Symptom:** A Discoveries group contains clearly different people or non-face objects.

**Diagnosis in Python logs:**
```
Cluster 0: size=12, magnitude=0.721, spread=0.834
```
High spread (> 0.75) with moderate magnitude = chain-linked cluster.

**Fix:** Lower Cluster Purity slider (e.g., `0.75` → `0.65`) and run Regroup.

---

### Scenario: Too Many Singles (Over-Splitting)

**Symptom:** After Regroup, most faces appear as singles instead of groups.

**Diagnosis:** `max_spread` or Similarity Threshold may be too strict.

**Fix sequence:**
1. Raise Cluster Purity toward `0.85` — allows more intra-cluster variation
2. If still too many singles, lower Similarity Threshold (`0.68` → `0.60`) — widens the neighborhood

---

### Current Default Values (Regroup Pipeline)

| Parameter | Value | Source |
|-----------|-------|--------|
| Similarity Threshold | `0.68` (localStorage) | User-adjustable |
| Cluster Purity (`max_spread`) | `0.75` (localStorage) | User-adjustable |
| Min Cohesion | `0.60` | Hardcoded in `aiHandlers.ts` |
| Min Samples | `2` | Hardcoded |
| Max Cluster Size | `200` | Hardcoded |

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

**Phase 101** (2026-03-02):
- Added "Face Grouping (Clustering) Parameters" section: `max_spread`, `min_cohesion`, `eps` reference table
- Documented chain-linking problem and spread/cohesion filter mechanics
- Added two troubleshooting scenarios: mixed faces in groups, over-splitting into singles

**Phase 57** (2026-02-01):
- Added VLM threshold tuning recommendations
- Documented NMS improvements (embedding distance, aspect ratio, rotation awareness)
- Added multi-face box troubleshooting
- Added performance optimization strategies

**Phase 56** (2026-01-30):
- Initial VLM verification system
- Background verification service
