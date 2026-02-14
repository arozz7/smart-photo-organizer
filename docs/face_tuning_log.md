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

### Phase 89.1: Macro Close-Up Sub-Face Artifact Fix (2026-02-13)
**Problem:**
- Extreme macro close-up photos (e.g. `CLOSEUP.jfif`) produced 4 face boxes instead of 1.
- The detector found sub-regions (eyes, partial face) as separate face candidates with very low scores (0.10-0.16).
- NMS's "Scale Exception" (designed for Mother+Baby) incorrectly preserved these artifacts because they had huge scale ratios (5x-68x) and high embedding distance (>1.1) — the exact criteria meant for keeping a baby's face inside a mother's bounding box.

**Root Cause:**
- The Scale Exception had no minimum detection score requirement. It treated low-confidence feature artifacts the same as real sub-faces.

**Fix (nms.py):**
- Added a **detection score floor of 0.25** to the Scale Exception at all three locations where `is_likely_subface` is evaluated:
  1. Container pre-pass (line ~124)
  2. Physics Rule (line ~228)
  3. Rule B High Quality Exception (line ~319)
- Uses `f.get('score', 1.0)` — default 1.0 when score field is missing, preserving backward compatibility.

**Threshold Rationale:**
- Real sub-faces (babies): score 0.34+ (well above 0.25)
- Macro artifacts: score 0.10-0.16 (well below 0.25)
- Gap: 0.09 below lowest real face, 0.09 above highest artifact

**Outcome:**
- Macro close-up photos now correctly produce 1 face box instead of 4. ✅
- Mother+Baby photos still correctly produce 2 face boxes. ✅
- All existing NMS tests pass unchanged (no `score` field = default 1.0). ✅

---

### Phase 89.2: High Detection Score + Quality VLM Override (2026-02-13)
**Problem (Initial):**
- Valid faces with high detection scores (e.g., 0.80+) were being rejected by VLM with vague "No" responses (`obj=unknown`).
- Example: Groom in wedding photo (`Boda en iglesia.jfif`) rejected despite high confidence from detector.
- VLM was being overly conservative on faces with shadows, angles, or partial occlusion.

**Problem (Refinement):**
- Initial fix (score >= 0.80) was too permissive — accepting many false positives.
- Example: `DSC_2480.NEF` showed 4 face boxes, only 1 was a real face (3 were blurred background/body parts).
- Logs showed 30+ override messages in short period — VLM was CORRECTLY rejecting false positives, but override ignored VLM's good judgment.
- Detection score alone is insufficient: detector assigns high scores (0.80-0.89) to blur artifacts and body parts.

**Root Cause:**
- Need BOTH high detection score AND high face quality to distinguish real faces from false positives.
- Blurred backgrounds/body parts have low quality scores (<0.70) despite high detection scores.

**Fix (BackgroundVerificationService.ts + FaceRepository.ts):**
- Added **Dual Threshold Override** after VLM verification (line ~117).
- Requires BOTH conditions:
  1. **Detection score >= 0.82** (raised from 0.80, more conservative)
  2. **Face quality >= 0.70** (high quality threshold - filters blur/artifacts)
- Quality calculation (from detector.py): 30% blur + 30% pose + 20% det_score + 20% size
- Updated `FaceRepository.getSuspectFaces` to include `face_quality` field in SELECT query
- When both thresholds met:
  - Override VLM rejection
  - Mark as `is_face=true` with reason `"High Detection Score + Quality Override (VLM Conservative)"`
  - Use detection score as confidence value

**Threshold Rationale:**
- **Score 0.82:** Slightly above VLM threshold (0.85), catching faces that should have auto-passed
- **Quality 0.70:** Standard "high quality" threshold used elsewhere in codebase (see FaceService.ts, ConfigService.ts)
- Consistent with existing quality-based filtering patterns

**Outcome:**
- False positives (blur/body parts) with quality < 0.70: NOT overridden, VLM rejection stands ✅
- Valid faces with quality >= 0.70 + score >= 0.82: Overridden and accepted ✅
- Groom in wedding photo: Correctly detected (high quality + high score) ✅
- Blurred background boxes (DSC_2480.NEF): Correctly rejected (low quality) ✅
- Backward compatible: NULL face_quality defaults to 0, fails quality check (conservative) ✅

---

### Phase 88: NMS Strict Tuning (Duplicate Removal & Preservation) (2026-02-12)
**Problem 1: Duplicate Faces in TTA (`hugs.jfif`)**
- "Test Time Augmentation" (TTA) created multiple crops of the same face with slightly different embeddings.
- Existing NMS "High Quality Exception" allowed them to coexist as "different people" because their embedding distance was slightly high (`> 1.0`).
- Result: Concentric "stacks" of red boxes on the same face.

**Problem 2: Mother+Baby merged into one box**
- "Mother holding Baby" scenarios often have the baby's face physically *inside* the mother's bounding box.
- NMS rules (especially "Containment" and "Physics Rule") aggressively merged them, deleting the baby.
- Sometimes the "VLM Split" logic would find the baby later, but NMS would kill the original detection first.

**Fix (nms.py):**
1.  **Geometric Veto:** Added a rule to **FORCE MERGE** faces if they are "Geometric Duplicates" even if they look different (Dist > 1.0).
    - Condition: `IoU > 0.75` OR `NormCenterDist < 0.25` (Centers very close).
    - This cleans up the TTA duplicates in `hugs.jfif`.
2.  **Scale Exception:** Added a safety check to **PRESERVE** faces if they are "Geometric Duplicates" but have a huge size difference.
    - Condition: `ScaleRatio > 3.0` AND `Dist > 1.1` (Look different).
    - This allows the "Big Box" (Mother) and "Small Box" (Baby) to coexist, even if they are concentric.

**Outcome:**
- `hugs.jfif`: Concentric duplicates (similar size) are merged. Clean single box. ✅
- `Mother+Baby`: Concentric faces (different size) are preserved. Two valid boxes. ✅
- The "Big Box" for the mother naturally encompasses the baby due to proximity, but they are tracked as separate identities.

---

### Phase 87: VLM TTA for Rotated Faces (2026-02-11)
**Problem:**
- Upside-down faces (e.g. "stacked heads" or "laying down") were rejected by VLM.
- VLM is trained on upright images and fails to recognize inverted faces as "human".
- It typically returns "No" or describes them as "hair" or "clothing".

**Fix (vlm.py):**
- **Test Time Augmentation (TTA):** If the initial upright crop is rejected (`is_face=False`), the system now:
    1. Rotates the crop 180 degrees.
    2. Retries verification.
    3. If the rotated version is accepted, the face is marked as Valid.
- **Refactor:** Extracted VLM analysis logic into `analyze_face_crop` helper to support the retry loop.

**Outcome:**
- Upside-down faces are now correctly identified.
- No impact on normal face processing speed (only triggered on rejection).

---

### Phase 86: NMS Container Arbitration (2026-02-11)
**Problem:**
- "Mother+Baby" photos sometimes resulted in 3 boxes: 1 Large (Head), 2 Small (Face + Artifact).
- Previous "Container Rejection" rule (Phase 74) blindly rejected the Large Box because it contained smaller distinct boxes.
- **Real World:** The Large Box was actually the *better* detection (Quality 0.90) compared to the partial inner box (Quality 0.77).

**Fix (nms.py):**
- **Quality Check:** Before rejecting a "Container" (Large Box), check if it is **Lower Quality** than the "Content" (Small Box).
    - If `Quality(Large) < Quality(Small)` -> Reject Large (It's likely a frame/background).
    - If `Quality(Large) >= Quality(Small)` -> **Keep Large**.
- **Artifact Cleanup:** If properly keeping the Large Box, explicitly **Remove the Small Box** to prevent them from co-existing as "Stacked Faces".
- **Tuning:** Relaxed Area Ratio from 1.5x to **1.15x** to catch "Tight Containers" (Head just slightly larger than Face).

**Outcome:**
- Fixed "3 Box" issue. Now correctly returns the single best high-quality box.

---

### Phase 85: VLM "Yes" Override (2026-02-11)
**Problem:**
- Valid faces were rejected because VLM said "Yes" but provided a sparse description (e.g. "Yes, it is a face").
- The "Anatomical Check" (Phase 56.9) rejected it because it didn't find "eyes", "nose", etc. in the text.

**Fix (vlm.py):**
- **Explicit Override:** If VLM response starts with "Yes" (and no forbidden keywords found), **Bypass Anatomical Check**.
- Trust the model's direct classification when the description is lazy/sparse.

**Outcome:**
- Prevents rejection of clear faces where VLM gives a short answer.

---

### Phase 79 Part 2: Rescan Rejection Memory (2026-02-09)
**Problem:**
- Non-face boxes (hands, sand, body parts) were being re-detected on every rescan despite VLM correctly rejecting them
- Created infinite loop: detection → VLM rejection → rescan → re-detection → VLM rejection (repeat)
- Database showed only valid faces, but logs revealed 6+ VLM verifications for the same photo
- **Root Cause:** Ignored faces were being **deleted** during rescans instead of preserved as "rejection memory"

**Fix (FaceService.ts):**
```typescript
// OLD CODE (lines 443-452): Deleted ignored faces
const ignoredFaces = existingFaces.filter((f: any) => f.is_ignored === 1);
for (const f of ignoredFaces) {
    idsToDelete.add(f.id); // ❌ DELETED
}

// NEW CODE: Preserve ignored faces as rejection memory
const ignoredFaces = existingFaces.filter((f: any) => f.is_ignored === 1);
// ✅ KEEP them in database

// NEW CODE: Filter new detections against ignored faces (lines 624-654)
if (!bestMatch) { // Only for new faces
    for (const ignoredFace of ignoredFaces) {
        const ioMin = calculateOverlap(newBox, ignoredFace.box);
        if (ioMin > 0.5) {
            logger.info(`SKIPPING - overlaps with ignored face (rejection memory)`);
            continue; // Skip this detection
        }
    }
}
```

**Outcome:**
- Ignored faces now serve as "rejection memory" to prevent re-detection
- Rescans filter out boxes overlapping >50% with ignored faces
- VLM no longer called repeatedly on the same non-face boxes
- Logs show: "SKIPPING face X - overlaps with ignored face Y (rejection memory working)"

**Key Learning:**
- Soft-delete (is_ignored=1) must be **persistent** across rescans
- Deletion of ignored faces defeats the purpose of the ignore flag
- Overlap filtering (IoMin >50%) prevents detector from re-finding rejected boxes

### Phase 79 Part 3: VLM Hallucination Fix (2026-02-10)
**Problem:**
- "Girl duo.jfif" (woman on left) was not detected.
- Detection score (0.801) was < threshold (0.85), so sent to VLM.
- VLM hallucinated garbage (HTML, Cloudflare pages, or random JSON) due to occlusion (heart glasses).
- Heuristic fallback rejected it because "eyes/nose" checks failed against garbage text.

**Fix (vlm.py):**
1. **Garbage Detection:** Added check for HTML tags, code comments (`//`), and random text.
2. **Retry Logic:** Retries up to 3 times with increasing temperature (0.1 -> 0.3 -> 0.5) to break loops.
3. **Strict JSON Validation:** Requires `"is_face"` key in JSON response.
4. **FAIL OPEN:** If all retries produce garbage or missing keys, default to **`is_face=True`**.

**Outcome:**
- VLM now accepts faces when the model is confused/hallucinating (Fail Open)
- Prevents valid faces from being rejected due to model failure
- "Girl duo" face (score 0.801) is now accepted despite VLM hallucination
- **Update (Part 4):** Added score filter (> 0.6) for Fail Open results in `BackgroundVerificationService.ts` to reject low-confidence noise (e.g. hair box with score 0.24) that also caused VLM hallucinations.

---

### Phase 79: VLM Verification Refinements (2026-02-09)
**Problem 1: Rescan False Positive Loop**
- Non-face boxes (sand, hands, body parts) were reappearing after VLM rejection during rescans
- Created infinite loop: detection → VLM rejection → rescan → re-detection
- **Root Cause:** Rescan logic not properly filtering `is_ignored=1` faces from subsequent scans

**Fix 1 (detector.py, FaceService.ts):**
- Enhanced rescan filtering to respect VLM rejections
- Properly exclude ignored faces from new scan passes
- Added cleanup of rejected detections before rescan

---

**Problem 2: VLM Heuristic Fallback Accepting Non-Faces**
- When VLM returned malformed JSON, heuristic fallback incorrectly accepted sand/hands as faces
- **Evolution through 3 stages:**

**Stage 1: Forbidden Keywords (Initial Attempt)**
- Simple keyword matching against forbidden terms
- **Issue:** Too aggressive - rejected "hand on face" (valid)

**Stage 2: Word Boundaries (Refinement)**
- Used `\b` regex boundaries to match whole words only
- **Issue:** Still caught valid descriptions like "woman's hand near her face"

**Stage 3: Comment Stripping + Category Proof (Final Solution)**
- Strip VLM comments (parenthetical text) before analysis: `re.sub(r'\([^)]*\)', '', description)`
- Require **category proof** (face/person indicators) to accept detection
- Only reject based on forbidden keywords if NO facial features mentioned

**Fix 2 (vlm.py lines 320-360):**
```python
# Strip comments before analysis
desc_no_comments = re.sub(r'\([^)]*\)', '', description.lower())

# Check for category proof
category_proof = any(re.search(rf'\b{word}\b', desc_no_comments) 
                     for word in face_proof + person_indicators)

# Decision logic
if category_proof:
    return True, "Category proof found"
elif forbidden_present:
    return False, "Forbidden keywords without face proof"
else:
    return True, "Neutral description, allow"
```

---

**Problem 3: VLM False Negatives (Empty Descriptions)**
- Valid faces with minimal VLM descriptions rejected due to lack of "anatomical proof"
- Example: VLM returns "woman" without mentioning eyes/nose/mouth
- **Root Cause:** Verification required explicit facial features, but category labels ("woman", "person") are sufficient proof

**Fix 3 (vlm.py lines 280-310):**
- Modified main VLM verification to accept **category proof** even without anatomical details
- Aligns with heuristic fallback logic for consistency
- Category proof includes: face/person indicators (woman, man, child, person, etc.)

**Outcome:**
- ✅ Non-face boxes no longer reappear after VLM rejection
- ✅ Heuristic fallback correctly rejects sand/hands while accepting "hand on face" scenarios
- ✅ Valid faces with simple category labels ("woman", "person") now accepted
- ✅ VLM comment noise (parenthetical explanations) stripped before analysis

**Key Learnings:**
- Context matters more than exact word matching
- Category proof ("woman") more reliable than requiring anatomical details
- VLM comments must be stripped to avoid false positives
- Heuristic fallback must mirror main VLM logic for consistency

---

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
