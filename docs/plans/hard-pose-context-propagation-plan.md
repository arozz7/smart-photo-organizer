# Hard Pose Handling & Context Propagation — Implementation Plan

## Overview

Improve face recognition accuracy for challenging poses (side profiles, top-down views, extreme angles) by leveraging pose-aware processing, quality-weighted centroids, and contextual identity propagation using temporal/spatial proximity.

## Problem Statement

Standard face embeddings from extreme angles (yaw > 45°) produce lower-quality matches, leading to:
- **Missed identifications:** Side profiles not matched to known persons
- **False positives:** Low-confidence matches assigned incorrectly
- **Centroid drift:** Poor-quality embeddings pollute person models
- **User frustration:** Manually re-assigning obvious faces from the same photo session

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Pose thresholds** | Frontal: \|yaw\| ≤ 30°, Profile: \|yaw\| > 45°, Severe: \|yaw\| > 60° | Research-backed angles; InsightFace pose estimates align with this taxonomy |
| **Centroid weighting** | Linear decay: 1.0 (0° yaw) → 0.2 (90° yaw) | **Already implemented** in PersonService.ts (Phase 45); validates existing approach |
| **Temporal window** | ±5 minutes, same folder | Balances precision (burst shots) vs. recall (event coverage) |
| **Spatial proximity** | GPS cluster < 100m radius | Tight enough for single location, loose enough for GPS noise |
| **Multi-centroid strategy** | Store frontal + profile embeddings per era | Enables pose-aware matching without re-architecting existing centroid system |
| **UI filtering** | Toggle "Frontal Only" / "All Poses" | Reduces cognitive load during review; power users can expand to profiles |

---

## Current State (Already Implemented ✅)

The following infrastructure is **already in place** and does not require new work:

### Database Schema
- ✅ `faces.pose_yaw`, `faces.pose_pitch`, `faces.pose_roll` columns exist (db.ts lines 105-107)
- ✅ `faces.session_folder`, `faces.session_date` columns exist (db.ts lines 112-113)
- ✅ `photos.date_taken`, `metadata_json` (contains GPS) exist

### Python Detection
- ✅ Pose extraction from InsightFace (detector.py lines 332-339)
- ✅ Pose data flows to scan persist (stored in faces table)

### TypeScript Services
- ✅ Quality-weighted centroid calculation using pose (PersonService.ts lines 26-34)
  - Formula: `weight = 1.0 - (|yaw| / 90) * 0.8` (range 0.2–1.0)
  - Frontal faces weighted higher in person model
- ✅ Outlier detection uses distance-to-centroid (FaceOutlierService.ts)

---

## Implementation Gaps (What Needs to Be Built)

### 1. UI Pose Filtering (Unnamed Faces View)
**Missing:** No way to filter faces by pose in the UI.

**Needed:**
- Add "Pose Filter" toggle to People.tsx Discoveries tab
- Options: "All Poses" (default), "Frontal Only" (|yaw| ≤ 30°), "Profiles Only" (|yaw| > 45°)

### 2. Contextual Matching Service
**Missing:** No service to propagate labels via temporal/spatial proximity.

**Needed:**
- New `ContextualMatchingService.ts` to analyze photo sessions
- Logic: If photo A (12:00 PM) has high-conf face "Mom", propagate to unassigned faces in photo B (12:01 PM, same folder)
- Store assignment source as `assignment_source='context_temporal'` or `'context_spatial'`

### 3. Multi-Centroid Per-Person
**Missing:** Single centroid per person doesn't handle pose variance well.

**Needed:**
- Modify `person_eras` table or create new `person_pose_centroids` table
- Store separate embeddings for:
  - Frontal centroid (|yaw| ≤ 30°)
  - Profile centroid (30° < |yaw| ≤ 75°)
- Matching logic: Compare incoming face against appropriate centroid based on pose

### 4. UI Indicators for Context Assignments
**Missing:** No visual feedback for contextually assigned faces.

**Needed:**
- Badge/icon on FaceGridItem showing assignment source
- Tooltip: "Assigned via temporal context (±2 min)"

### 5. Pose Distribution Visualization
**Missing:** No analytics on pose distribution in library.

**Wanted (Nice-to-Have):**
- Settings → Library Health: Pie chart showing Frontal vs. Profile vs. Severe pose distribution
- Person Detail: Histogram of pose angles for that person

---

## New Files & Services

| File | ~Lines | Purpose |
|------|--------|---------|
| `electron/core/services/ContextualMatchingService.ts` | ~250 | Temporal/spatial clustering and label propagation logic |
| `electron/data/repositories/PoseCentroidRepository.ts` | ~150 | CRUD for multi-centroid storage (if using new table) |
| `src/hooks/usePoseFilter.ts` | ~60 | Hook for pose filtering state (All/Frontal/Profile) |
| `src/components/PoseFilterToggle.tsx` | ~80 | UI toggle component for pose filter dropdown |
| `src/components/AssignmentBadge.tsx` | ~50 | Badge showing assignment source (manual/auto/context) |
| `tests/backend/unit/services/ContextualMatchingService.test.ts` | ~200 | Unit tests for contextual matching logic |

**Total New Code:** ~790 lines (6 files)

---

## Phase 1: Database Migration & Pose Statistics (~150 lines)

**Goal:** Add multi-centroid support and expose pose statistics.

### Task 1.1: Schema Migration (Optional — Multi-Centroid Table)
**Decision Point:** Do we store pose-specific centroids in:
- **Option A:** `person_eras` table (add `pose_type` column: 'frontal', 'profile', 'combined')
- **Option B:** New `person_pose_centroids` table (cleaner separation)

**Recommendation:** Option A (simpler migration, reuses existing era infrastructure).

**Migration SQL:**
```sql
-- Add pose_type to person_eras (default 'combined' for backward compat)
ALTER TABLE person_eras ADD COLUMN pose_type TEXT DEFAULT 'combined';

-- Add pose quality score (optional — for weighting during matching)
ALTER TABLE person_eras ADD COLUMN pose_quality_score REAL DEFAULT 1.0;
```

**Files Modified:**
- `electron/db.ts`: Add migration logic
- `electron/ipc/dbHandlers.ts`: Add handler for pose stats query

### Task 1.2: Pose Statistics IPC Handler
Create `db:getPoseStatistics` IPC handler:
- Query: Count faces by pose bins (Frontal: |yaw| ≤ 30°, Profile: 30-60°, Severe: > 60°)
- Return: `{ frontal: 1200, profile: 450, severe: 80, unknown: 120 }`

### Task 1.3: Add Pose Distribution to Library Health Widget
**Files Modified:**
- `src/components/dashboard/LibraryHealthWidget.tsx`: Add pose pie chart segment
- Use existing SVG ring gauge pattern, add color coding:
  - Green: Frontal
  - Yellow: Profile
  - Red: Severe

### Tests (Phase 1)
- Migration test: Verify `pose_type` column added without breaking existing eras
- IPC test: Verify pose statistics query returns correct counts
- UI test: Verify pose chart renders in dashboard

---

## Phase 2: UI Pose Filtering (~190 lines)

**Goal:** Allow users to filter faces by pose in the Discoveries and Suggestions tabs.

### Task 2.1: Create usePoseFilter Hook
Create `src/hooks/usePoseFilter.ts`:
```typescript
export type PoseFilterMode = 'all' | 'frontal' | 'profile';

export function usePoseFilter() {
  const [mode, setMode] = useState<PoseFilterMode>('all');

  const filterByPose = (faces: FaceData[]) => {
    if (mode === 'all') return faces;
    return faces.filter(f => {
      const absYaw = Math.abs(f.pose_yaw ?? 0);
      if (mode === 'frontal') return absYaw <= 30;
      if (mode === 'profile') return absYaw > 45;
      return true;
    });
  };

  return { mode, setMode, filterByPose };
}
```

### Task 2.2: Create PoseFilterToggle Component
Create `src/components/PoseFilterToggle.tsx`:
- Dropdown with 3 options: "All Poses", "Frontal Only (0-30°)", "Profiles Only (>45°)"
- Shows current filter mode with icon (👤 frontal, 🔄 profile)
- Emits `onModeChange(mode: PoseFilterMode)` callback

### Task 2.3: Integrate into People.tsx
**Files Modified:**
- `src/views/People.tsx` (1326L) — **Minimal change only**
- Add `usePoseFilter()` at top
- Add `<PoseFilterToggle />` to Discoveries/Suggestions tab header
- Apply `filterByPose()` to face list before rendering

**Change footprint:** ~15 lines (import + filter + component)

### Tests (Phase 2)
- Unit test: `usePoseFilter` correctly filters by yaw ranges
- UI test: Toggle changes filter mode, face list updates
- Edge case: Faces with `pose_yaw = null` default to "All Poses" filter

---

## Phase 3: Contextual Matching Service (~300 lines)

**Goal:** Implement temporal/spatial identity propagation for hard-to-recognize faces.

### Task 3.1: Create ContextualMatchingService
Create `electron/core/services/ContextualMatchingService.ts`:

**Core Algorithm:**
```typescript
export class ContextualMatchingService {
  static async propagateLabelsInSession(photoId: number): Promise<number> {
    // 1. Get photo metadata (date_taken, session_folder)
    // 2. Find nearby photos (±5 min, same folder)
    // 3. Get high-confidence faces from nearby photos (confidence_tier='high')
    // 4. Get unassigned/low-conf faces from target photo
    // 5. For each unassigned face:
    //    - Check if nearby photos have only 1 unique person
    //    - If consensus exists, assign with source='context_temporal'
    // 6. Return count of propagated faces
  }

  static async propagateLabelsByGPS(photoId: number): Promise<number> {
    // Similar logic but using GPS clustering (<100m radius)
  }

  static async batchPropagateForLibrary(): Promise<PropagationStats> {
    // Background job to process entire library
  }
}
```

**Confidence Rules:**
- **Source face requirements:** `confidence_tier='high'` AND `blur_score >= 50` AND `|yaw| <= 30°`
- **Target face requirements:** `person_id IS NULL` AND (`|yaw| > 45°` OR `blur_score < 40`)
- **Consensus threshold:** ≥ 70% of high-conf faces in session belong to same person

### Task 3.2: Add IPC Handlers
Add to `electron/ipc/dbHandlers.ts`:
- `db:propagateLabelsInSession` → Calls `ContextualMatchingService.propagateLabelsInSession()`
- `db:batchPropagateLabels` → Background job trigger

### Task 3.3: Add "Propagate Labels" Button to Settings
**Files Modified:**
- `src/views/Settings.tsx`: Add "Smart Assignment" section
- Button: "Propagate Labels via Context" → Calls `db:batchPropagateLabels`
- Progress indicator: "Processing 234/5000 photos..."

### Tests (Phase 3)
- Unit test: Temporal clustering correctly groups photos by 5-min window
- Unit test: GPS clustering correctly groups by 100m radius
- Unit test: Consensus logic requires ≥70% agreement
- Integration test: End-to-end propagation assigns correct person_id with correct source
- Edge case: Photos with multiple unique people → no propagation (ambiguous)

---

## Phase 4: Multi-Centroid Matching (~200 lines)

**Goal:** Store and match against pose-specific centroids per person.

### Task 4.1: Modify PersonService for Multi-Centroid Generation
**Files Modified:**
- `electron/core/services/PersonService.ts`: Extend `recalculatePersonMean()`

**New Logic:**
1. Calculate **3 centroids** per person (if enough faces):
   - Frontal centroid: Faces with |yaw| ≤ 30°
   - Profile centroid: Faces with 30° < |yaw| ≤ 75°
   - Combined centroid: All faces (backward compatibility)
2. Store in `person_eras` with `pose_type='frontal'`, `'profile'`, `'combined'`
3. Minimum faces per centroid: 3 (otherwise skip that pose type)

### Task 4.2: Modify FaceMatchingService for Pose-Aware Matching
**Files Modified:**
- `electron/core/services/FaceMatchingService.ts` (if exists) or add to `FaceService.ts`

**New Logic:**
1. When matching a new face:
   - Check incoming face's `pose_yaw`
   - If |yaw| ≤ 30°, compare against frontal centroid
   - If |yaw| > 30°, compare against profile centroid
   - Fallback to combined centroid if specific centroid unavailable
2. Scoring: Apply slight penalty for cross-pose matching (frontal face vs. profile centroid)

### Task 4.3: Add Multi-Centroid UI to PersonDetail
**Files Modified:**
- `src/views/PersonDetail.tsx`: Add "Pose Centroids" section

**Display:**
- Show count of faces per pose type:
  - "Frontal: 45 faces"
  - "Profile: 12 faces"
- Badge if multi-centroid matching is active for this person

### Tests (Phase 4)
- Unit test: Multi-centroid generation creates correct number of centroids
- Unit test: Pose-aware matching selects correct centroid based on incoming yaw
- Unit test: Fallback to combined centroid if specific pose unavailable
- Performance test: No regression in matching speed (<10ms per face)

---

## Phase 5: Assignment Source Indicators (~130 lines)

**Goal:** Show users how each face was assigned (manual, auto-high-conf, context).

### Task 5.1: Create AssignmentBadge Component
Create `src/components/AssignmentBadge.tsx`:
```tsx
type AssignmentSource = 'manual' | 'auto_high' | 'auto_review' |
                        'context_temporal' | 'context_spatial' | 'split_multiface';

export function AssignmentBadge({ source }: { source: AssignmentSource }) {
  const config = {
    manual: { icon: '👤', color: 'blue', label: 'Manual' },
    auto_high: { icon: '✓', color: 'green', label: 'Auto (High Confidence)' },
    context_temporal: { icon: '🕒', color: 'purple', label: 'Context (Time)' },
    context_spatial: { icon: '📍', color: 'orange', label: 'Context (Location)' },
    // ...
  };

  return <Badge {...config[source]} />;
}
```

### Task 5.2: Integrate into FaceGridItem
**Files Modified:**
- `src/components/FaceGridItem.tsx`: Add `<AssignmentBadge />` overlay (top-right corner)
- Only show for non-manual assignments
- Tooltip shows full explanation: "Assigned based on temporal proximity to high-confidence faces in the same photo session"

### Task 5.3: Add Filter by Assignment Source (Optional)
**Files Modified:**
- `src/views/PersonDetail.tsx`: Add dropdown to filter faces by source

### Tests (Phase 5)
- UI test: Badge renders correctly for each source type
- UI test: Tooltip shows detailed explanation
- Accessibility: Badge has aria-label for screen readers

---

## Phase 6: Background Propagation Job (~150 lines)

**Goal:** Process entire library to propagate labels to hard faces.

### Task 6.1: Create BackgroundPropagationService
Create `electron/core/services/BackgroundPropagationService.ts`:
- Service pattern similar to `BackgroundBucketingService.ts`
- Idle-time processing (only runs when no scans active)
- Processes photos in batches (100 photos at a time)
- Progress tracking: `processed_count`, `total_count`, `faces_propagated`

### Task 6.2: Add UI for Background Job
**Files Modified:**
- `src/views/Settings.tsx`: Add "Smart Assignment" section with:
  - "Enable Auto-Propagation" toggle
  - "Run Now" button
  - Progress: "Processing 1,234/5,000 photos (45 faces assigned)"

### Task 6.3: Add Job to ServiceManager
**Files Modified:**
- `electron/core/ServiceManager.ts`: Register `BackgroundPropagationService` alongside bucketing service

### Tests (Phase 6)
- Integration test: Background job processes photos correctly
- Concurrency test: Job pauses when scan starts, resumes when idle
- Performance test: Batch processing doesn't block UI

---

## Phase 7: Polish & Documentation (~100 lines)

### Task 7.1: Add Pose Histogram to PersonDetail
**Files Modified:**
- `src/views/PersonDetail.tsx`: Add histogram showing yaw distribution for this person

**Visualization:**
- Horizontal bar chart: bins for 0-15°, 15-30°, 30-45°, 45-60°, 60+°
- Color-coded: Green (frontal) → Yellow → Red (severe)

### Task 7.2: Update Settings: Pose Thresholds
**Files Modified:**
- `src/views/Settings.tsx`: Add "Advanced → Pose Matching" section
- Configurable thresholds:
  - Frontal max yaw (default: 30°)
  - Profile min yaw (default: 45°)
  - Temporal window (default: 5 minutes)
  - GPS radius (default: 100m)

### Task 7.3: Update Changelog
- Write `aiChangeLog/phase-XX-pose-context-propagation.md`
- Document:
  - Files created/modified
  - Database schema changes
  - New IPC handlers
  - UI changes

### Task 7.4: Update future_features.md
- Move "Hard Pose Handling & Context Propagation" from Priority Roadmap to Implemented Features (v0.7.0)

### Tests (Phase 7)
- Visual regression test: Pose histogram renders correctly
- Settings test: Threshold changes affect filtering behavior

---

## Performance Considerations

1. **Pose Centroid Calculation:**
   - Split into frontal + profile = ~2x centroid recalculation time
   - Mitigation: Only recalculate when significant new faces added (>10% change)
   - Expected impact: <50ms overhead per person update

2. **Temporal Clustering:**
   - Naive approach: O(N²) for N photos in library
   - Optimization: Index photos by `date_taken` and `session_folder`
   - Expected time: ~1-2 seconds per 1000 photos (background job)

3. **GPS Clustering:**
   - Requires parsing `metadata_json` for GPS coordinates
   - Optimization: Cache GPS in separate columns (`gps_lat`, `gps_lon`) if used frequently
   - Expected time: ~5-10ms per photo (one-time extraction)

4. **Pose Filtering:**
   - Client-side array filter: O(N) for N faces
   - No DB query needed (pose already loaded)
   - Expected time: <10ms for 5000 faces

5. **Multi-Centroid Matching:**
   - No additional FAISS queries (still 1 query per face)
   - Centroid selection: O(1) lookup based on yaw
   - Expected impact: <1ms overhead per face

---

## Database Schema Impact

### New Columns (person_eras)
```sql
ALTER TABLE person_eras ADD COLUMN pose_type TEXT DEFAULT 'combined';
ALTER TABLE person_eras ADD COLUMN pose_quality_score REAL DEFAULT 1.0;
```

### Optional New Columns (photos) — For GPS Caching
```sql
ALTER TABLE photos ADD COLUMN gps_lat REAL;
ALTER TABLE photos ADD COLUMN gps_lon REAL;
```

**Migration Strategy:**
- Backward compatible: Existing eras default to `pose_type='combined'`
- No data loss: Combined centroids remain functional
- Lazy migration: Pose centroids generated on-demand when person updated

---

## Verification Checklist

### Phase 1: Database & Stats
- [ ] Migration adds `pose_type` column without errors
- [ ] Pose statistics query returns correct counts
- [ ] Dashboard pose chart renders correctly

### Phase 2: UI Filtering
- [ ] Pose filter dropdown shows 3 options
- [ ] "Frontal Only" hides profile faces
- [ ] "Profiles Only" shows only side views
- [ ] Filter persists across tab switches

### Phase 3: Contextual Matching
- [ ] Temporal clustering groups photos within 5-min window
- [ ] GPS clustering groups photos within 100m radius
- [ ] Consensus logic requires ≥70% agreement
- [ ] Propagation assigns correct person_id with correct source
- [ ] Ambiguous sessions (multiple people) → no propagation

### Phase 4: Multi-Centroid
- [ ] Person with frontal + profile faces generates 2 centroids
- [ ] Matching selects appropriate centroid based on incoming yaw
- [ ] Fallback to combined centroid if specific pose unavailable
- [ ] PersonDetail shows pose counts per type

### Phase 5: Assignment Indicators
- [ ] AssignmentBadge renders for contextual assignments
- [ ] Tooltip explains assignment reason
- [ ] Badge colors match assignment source type

### Phase 6: Background Job
- [ ] Background propagation processes entire library
- [ ] Job pauses during scans
- [ ] Progress updates in Settings UI
- [ ] No UI blocking during batch processing

### Phase 7: Polish
- [ ] Pose histogram renders in PersonDetail
- [ ] Settings allows threshold customization
- [ ] Changelog documents all changes
- [ ] future_features.md updated

---

## Testing Strategy

### Unit Tests (~500 lines total)
1. **ContextualMatchingService.test.ts:**
   - Temporal clustering logic
   - GPS clustering logic
   - Consensus calculation
   - Edge cases: ambiguous sessions, no high-conf faces

2. **PersonService.test.ts (extend existing):**
   - Multi-centroid generation
   - Pose-aware weighting
   - Fallback to combined centroid

3. **usePoseFilter.test.ts:**
   - Filtering by yaw ranges
   - Edge cases: null pose_yaw

### Integration Tests (~200 lines)
1. **Contextual Propagation E2E:**
   - Setup: Create photo session with 1 high-conf face + 2 unassigned hard faces
   - Execute: Run propagation service
   - Assert: Unassigned faces assigned to correct person with `context_temporal` source

2. **Multi-Centroid Matching E2E:**
   - Setup: Create person with 10 frontal + 5 profile faces
   - Execute: Generate centroids, match new profile face
   - Assert: Matched against profile centroid, correct distance

### Performance Tests (~100 lines)
1. **Temporal Clustering Benchmark:**
   - Test: Process 10,000 photos
   - Target: <10 seconds total

2. **Multi-Centroid Matching Benchmark:**
   - Test: Match 1000 faces
   - Target: <10ms per face (no regression)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Multi-centroid increases false negatives** | Medium | High | Add threshold adjustment in Settings; log match distances for analysis |
| **Temporal propagation creates wrong assignments** | Medium | High | Require ≥70% consensus; only propagate from high-conf faces; allow manual review |
| **GPS clustering too noisy** | Low | Medium | Increase radius to 200m if needed; make configurable |
| **Background job causes lag** | Low | Low | Use existing idle-detection pattern from BackgroundBucketingService |
| **User confusion about assignment sources** | Medium | Low | Clear tooltips, color coding, documentation in help modal |

---

## Dependencies & Synergies

### Depends On (Already Complete ✅)
- ✅ Age-Based ERA Categorization (Phase 42) — Era infrastructure used for multi-centroid storage
- ✅ Quality-Weighted Centroid (Phase 45) — Pose weighting already implemented
- ✅ Session Grouping (Phase P2) — `session_folder`, `session_date` metadata exists

### Synergies With
- **Frontend Streamlining (v0.5.5):** Pose filtering fits naturally into Discoveries tab
- **Advanced Filtering (v0.6.5):** Can add pose filter to Search view
- **UX Modernization (Roadmap):** Assignment badges align with polish goals

---

## Future Enhancements (Post-Implementation)

1. **3D Frontalization (Deferred):**
   - Use GAN-based models to rotate profile faces to frontal view
   - Very high complexity; contextual propagation is simpler and sufficient

2. **Part-Based Recognition:**
   - Learn local features (ear shape, nose bridge) for occluded faces
   - Requires advanced model architecture (attention mechanisms)

3. **Pose-Specific Augmentation:**
   - During training, augment frontal faces with synthetic profile views
   - Improves embeddings for underrepresented poses

4. **Active Learning for Hard Cases:**
   - Flag extreme pose faces for manual review
   - Use confirmed labels to fine-tune person models

---

## Success Metrics

After full implementation, measure:
1. **Reduction in unnamed profile faces:** Target ≥30% decrease
2. **Contextual propagation accuracy:** Manual audit of 100 propagated faces → ≥90% correct
3. **User satisfaction:** "Fewer manual assignments needed" in feedback
4. **Performance:** No regression in scan time, matching speed

---

## Implementation Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1: DB Migration & Stats | 1 day | None |
| Phase 2: UI Pose Filtering | 1 day | Phase 1 |
| Phase 3: Contextual Matching | 2-3 days | Phase 1 |
| Phase 4: Multi-Centroid | 2 days | Phase 1 |
| Phase 5: Assignment Indicators | 1 day | Phase 3 |
| Phase 6: Background Job | 1-2 days | Phase 3 |
| Phase 7: Polish & Docs | 1 day | All phases |

**Total: 9-11 days** (assumes 1 developer, includes testing)

---

## Recommended Execution Order

1. **Phase 1 + Phase 2** (Quickest user value) → Users can filter by pose immediately
2. **Phase 4** (Multi-centroid) → Improves matching accuracy
3. **Phase 3 + Phase 5** (Contextual propagation) → Reduces manual work
4. **Phase 6** (Background job) → Automates propagation at scale
5. **Phase 7** (Polish) → Final UX refinements

This order prioritizes **incremental value delivery** over sequential completion.
