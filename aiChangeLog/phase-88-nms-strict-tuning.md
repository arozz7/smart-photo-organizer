# Phase 88: NMS Strict Tuning

## Goal
Fix excessive duplicate bounding boxes (e.g., in `hugs.jfif`) by tightening NMS logic.

## Problem
The "High Quality Exception" in NMS allowed two faces to coexist if both were high quality (>0.70) and appeared to be different people (Dist > 1.0), even if they overlapped significantly. TTA (Test-Time Augmentation) can produce such variations (slight crops of the same face with different embeddings).

## Solution (Refined Phase 88.6)
- **Geometric Veto**: Added a "Center Distance Check" (`NormDist < 0.25`) to FORCE MERGE concentric faces even if they look different (Dist > 1.0).
- **Scale Exception**: EXCEPT if one face is significantly smaller (`ScaleRatio > 3.0`) AND they look different (`Dist > 1.1`). This preserves "Baby on Mother" while merging "TTA Duplicates".
- **Coverage**: Applied this logic to standard NMS, High Quality Exception, AND Stacked Face Protection.

## Rationale
- TTA duplicates are concentric and similar size.
- Mother+Baby are concentric but different sizes (Baby is small).

## Rationale
- TTA duplicates often have distinct embeddings but share the same geometric center.
- Distinct faces (Mother + Baby) typically have centers > 25% apart relative to their size.

## Changes
### `src/python/facelib/nms.py`
- Added `IoU` calculation in the High Quality Exception path.
- Enforced `should_merge = True` if `IoU > 0.75`.

## Verification
- [ ] Unit Test `test_nms_strict.py`: Simulates high-overlap duplicates.
- [ ] Manual: `hugs.jfif` rescan.
