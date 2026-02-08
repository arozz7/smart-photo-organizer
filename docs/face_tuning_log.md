## Summary of Current Best Settings (as of 2026-02-08)

| Setting | Value | Logic |
| :--- | :--- | :--- |
| **Strict Floor** | `0.65` | Faces < 0.65 are REJECTED (restore profiles). |
| **VLM Threshold** | `0.85` | Faces < 0.85 are 'suspect' (Queue profiles + ghosts for verifying). |
| **High Confidence** | `> 0.85` | Faces > 0.85 are ACCEPTED immediately. |
| **High Quality Threshold** | `0.65` | Faces with quality > 0.65 bypass low detection score filter. |
| **VLM Prompt** | `Hardened` | Includes explicit warnings for rocks/foliage. |

---

## Tuning History

### Phase 75: VLM Plural Forms Fix + Split Duplicate Prevention (2026-02-08)
**Problem 1: VLM rejecting valid multi-face descriptions**
- Photo `pexels-filiamariss-14994487.jpg` (two men with faces pressed together) showed "No people detected"
- NMS was working correctly (detected 2 unique faces with High Quality Exception)
- VLM verified faces but then rejected them both

**Root Cause 1:**
- VLM described the crop as "two men" but the `face_proof` list only contained "man" (singular)
- Word-boundary matching (`\bman\b`) does not match "men"
- Both faces were rejected with: `"Overriding is_face=True -> False because NO anatomical proof was found"`

**Fix 1 (vlm.py):**
- **face_proof list:** Added plural forms: `"men", "women", "children", "people", "adults", "faces"`
- **person_indicators list:** Added: `"men", "women", "people"`
- **details list:** Added: `"men", "women", "adults", "faces"`

---

**Problem 2: Extra duplicate box inside face**
- After fixing Problem 1, the photo showed 3 boxes instead of 2
- NMS correctly returned 2 unique faces
- BUT the split logic in `BackgroundVerificationService` created duplicate faces

**Root Cause 2:**
- VLM flagged faces as `is_multi_face=True` (because it saw "two men")
- Split logic triggered and detected NEW faces in the region
- These new faces overlapped heavily with existing NMS faces
- Duplicates were inserted, creating extra boxes

**Fix 2 (BackgroundVerificationService.ts):**
- Added IoMin overlap check in `createSplitFaces()` before inserting
- If new split face overlaps >50% with an existing face, skip creating it
- Logs: `[BackgroundVerificationService] Skipping duplicate split face: IoMin=X.XX with existing face`

---

**Problem 3: Python scoping error**
- `cannot access local variable 'np' where it is not associated with a value`

**Root Cause 3:**
- `nms.py` had a redundant `import numpy as np` inside a conditional block (line 79)
- Python treated `np` as a local variable due to the import statement
- This caused scoping errors when `np` was used before that import executed

**Fix 3 (nms.py):**
- Removed redundant `import numpy as np` from inside the function
- File already had `import numpy as np` at top (line 1)

**Outcome:**
- Multi-face photos are no longer rejected due to plural descriptions
- Split logic no longer creates duplicate boxes for faces NMS already separated
- Python scoping error resolved

### Phase 74: Container Rejection & Quality Threshold (2026-02-08)
**Problem:**
- Mother+Baby photo showed incorrect bounding boxes despite NMS quality exception
- **Root Cause 1:** InsightFace outputting a 781px "merged" box covering both faces
- **Root Cause 2:** Quality threshold (0.70) was too high for mother's face (0.68)

**Change:**
- **Container Rejection Rule:** Added pre-pass in `nms.py` that rejects large boxes which fully contain smaller high-quality distinct faces (multi-face detector artifacts)
- **Quality Threshold:** Lowered from **0.70 → 0.65** across all configs

**Outcome:**
- Photo 58 now correctly shows 2 individual face boxes (mother + baby)
- Container boxes rejected: `[NMS] Container Rejection: Large box (781x780) contains smaller high-quality face`

### Phase 71: Face Logic Persistence Fix (2026-02-07)
**Problem:**
- "Disappearing Faces" and "Aggressive Merging" issues persisted despite code changes.
- **Root Cause:** `ConfigService.ts` was loading stale user configuration (likely cached in `AppData`) **after** loading `ai-config.json`, causing the new tuning values (NMS 0.45, Dedup 0.55) to be overwritten by old defaults (0.3).

**Change:**
- **Config Precedence:** Updated `ConfigService.load()` to apply `ai-config.json` settings **after** user configuration. This enforces the "Enterprise Policy" for critical AI parameters.
- **Enforced Settings:**
    - `nms_iou_threshold`: **0.45** (was 0.3) -> Separates close faces like Mother + Baby.
    - `deduplication_iou_threshold`: **0.55** (was 0.3) -> Prevents aggressive garbage collection of overlapping faces.
    - `enable_tta`: **false** (was true) -> Fixes alignment drift.

**Outcome:**
- The application now correctly respects the tuned `ai-config.json`.
- Logs should now show `NMS=0.45` and `TTA=False`.
- "Mother + Baby" case should now be correctly separated (or at least not aggressively merged/deleted).

### Phase 70: VLM Multi-Face Merge Fix (2026-02-07)
**Problem:**
- Distinct faces (e.g. Mother + Baby) were merged into a single bounding box.
- VLM failed to flag `is_multi_face` because:
    1. Prompt focused on "absolute CENTER", missing the second person.
    2. Crop margin (25%) was too tight, cutting off context.
- Result: Split logic never triggered.

**Change:**
- **Prompt:** Broadened to "Analyze this image" (removed center bias) and explicitly request multi-face check.
- **Crop Logic:** Increased VLM verification crop padding from 25% to **100%** (double size) in `vlm.py`.

**Outcome:**
- VLM now sees the context (e.g. "Woman holding baby").
- Correctly flags `is_multi_face=True`.
- Background Service splits the box into individual faces.

### Phase 67: Centralization & Hardening (2026-02-07)
**Problem:**
- "Ghost Faces" persisted (e.g. "Woman in hat") because VLM descriptions were technically accurate but misleading for non-faces.
- "Man's Face" was misaligned/double-boxed due to TTA (Test Time Augmentation) drift.
- Settings were scattered across Python/TypeScript, leading to sync issues.

**Change:**
- **Central Config:** Created `ai-config.json` as single source of truth.
- **VLM Hardening:** Added `hat`, `camera`, `microphone`, `hand`, `clothing` to forbidden lists in `ai-config.json`.
- **TTA Disabled:** Set `enable_tta: false` in `ai-config.json` to fix misalignment.
- **Refactor:** Updated `vlm.py` and `detector.py` to use `AI_CONFIG`.

**Outcome:**
- Ghosts rejected (Forbidden Object: 'hat').
- Man's face detected as single, aligned box (Score ~0.82).

### Phase 65 v3: The Final Ghost Fix (2026-02-07)
**Problem:**
- Ghosts (0.77-0.81) persisted despite v2 settings.
- **Root Cause:** `src/python/facelib/detector.py` had a HARDCODED logic forcing `entity_type='human'` for anything > 0.65. This bypassed the TypeScript config of 0.85.

**Change:**
- **Python:** Removed `entity_type` logic from `detector.py` and `config.py`.
- **TypeScript:** `FaceService.ts` now exclusively controls the threshold (0.85).
- **Outcome:** Ghosts are correctly marked as 'suspect', verified by VLM, and rejected (thanks to Prompt Hardening).
- **Trade-off:** Extreme profile faces (low confidence) might also be rejected or queued. Accepted for now to ensure a clean library.

### Phase 65 v2: The Profile Recovery & Prompt Hardening (2026-02-06)
**Problem:** Phase 65 v1 (Floor 0.72) removed ghosts but also valid profile faces.
**Change:**
- **Strict Floor:** Lowered to `0.65`.
- **VLM Threshold:** Raised to `0.85`.
- **VLM Prompt:** Added "ROCKS, LEAVES, GROUND" to prompt instructions.
- **Blacklist:** Added `rock, stone, concrete` to keyword blacklist.
**Outcome:** (Superseded by v3 logic fix).
**NOTE:** Changes to `src/python/config.py` (Prompt) require a full application restart to take effect (Python backend reload).

### Phase 65 v1: The "Ghost Face" Fix (2026-02-06)
**Problem:**
- High-contrast objects (rocks, trash, foliage) were being detected as faces with high confidence scores (e.g., `0.77`).
- The previous "Strict Filter" only rejected faces `< 0.72`.
- These ghosts bypassed the filter and populated the library.
- They were NOT flagged as 'suspect' because the VLM threshold was `0.65`.

**Attempt 1: Suspect Queue (Partial Fail)**
- **Change:** Raised VLM Threshold to `0.80`. Allowed insertion of 'suspect' faces.
- **Result:** This inadvertently allowed **all** garbage (e.g., score `0.30`) to enter the DB because they were technically "suspect" (< 0.80). The library was flooded with low-score noise.

**Attempt 2: Strict Floor + Wide Suspect Range (Partial Success)**
- **Change:** Re-introduced a hard floor at `0.72`.
- **Outcome:** Removed ghosts but also removed valid profiles. Requires v2 adjustment.

### Phase 63: VLM Hallucination Fix (2026-02-04)
**Problem:**
- VLM was hallucinating faces in random patterns (leaves, fabric).
**Change:**
- Updated VLM prompt to be more strict about facial features.
- Added `is_face` JSON field to VLM response.

### Phase 57: VLM Improvements (2026-02-01)
**Problem:**
- Missing faces in complex scenes.
**Change:**
- Introduced `vlmVerificationThreshold` (default `0.65`).
- Added background verification service.

---

## Future Tuning Strategy

When adjusting settings, follow this decision tree:

1.  **Too many false positives (Rocks/Trash)?**
    - **Action:** RAISE `vlmVerificationThreshold` (e.g., to 0.85).
    - **Risk:** Slight delay in new faces appearing (queueing).

2.  **Too much low-quality garbage?**
    - **Action:** RAISE `Strict Floor` (e.g., to 0.75).
    - **Risk:** Missing blurry/dark valid faces.

3.  **Missing valid faces?**
    - **Action:** LOWER `Strict Floor` (e.g., to 0.65).
    - **Risk:** More garbage enters. Must ensure VLM Threshold is high enough to catch them.

4.  **VLM rejecting real faces?**
    - **Action:** Tuning VLM prompt (Python) or LOWER `vlmVerificationThreshold` (accept more as native).
