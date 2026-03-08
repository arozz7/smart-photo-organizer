# Phase 105 — Hard Pose Handling & Contextual Label Propagation

**Branch:** `feature/phase-105-pose-context-propagation`
**Date:** 2026-03-07

## Summary

Improves face recognition accuracy for hard-pose (profile, severe) and blurry
faces through three complementary mechanisms:

1. **Pose-aware UI** — filter the People view by pose bin; see pose centroid
   counts per person; library-wide pose distribution widget.
2. **Multi-centroid matching** — per-person frontal + profile centroids stored
   and checked during `matchAgainstCentroids`, reducing false rejections.
3. **Contextual label propagation** — consensus voting across same-session /
   GPS-nearby faces assigns labels that geometric matching cannot.

---

## Phase 105-1 — Pose Statistics & DB Migrations

**Files modified:**
- `electron/db.ts` — migrations for `person_eras.pose_type`, `person_eras.pose_quality_score`, `photos.gps_lat`, `photos.gps_lon`; GPS backfill from `metadata_json`
- `electron/data/repositories/FaceRepository.ts` — `getPoseStatistics()` single-pass COUNT query
- `electron/ipc/dbHandlers.ts` — `db:getPoseStatistics` IPC handler
- `src/components/dashboard/LibraryHealthWidget.tsx` — stacked pose distribution bar

---

## Phase 105-2 — Pose Filter Toggle in People View

**Files created:**
- `src/hooks/usePoseFilter.ts` — `PoseFilterMode`, `filterByPose` callback
- `src/components/PoseFilterToggle.tsx` — 3-button segmented toggle (All / Frontal ≤30° / Profile >45°)

**Files modified:**
- `src/types/index.ts` — `Face` interface: added `pose_yaw`, `assignment_source`
- `electron/data/repositories/FaceRepository.ts` — `getFacesByIds` SELECT includes `pose_yaw`, `assignment_source`
- `src/views/People.tsx` — pose filter applied to singles section

---

## Phase 105-3 — Multi-Centroid Matching (Frontal + Profile)

**Files modified:**
- `electron/db.ts` — migrations adding `frontal_centroid_json`, `profile_centroid_json`, `frontal_face_count`, `profile_face_count` to `people` table
- `electron/data/repositories/PersonRepository.ts` — `getPeopleWithDescriptors` returns `poseCentroids[]`; new `updatePoseCentroids()`
- `electron/core/services/PersonService.ts` — pose centroid computation after combined centroid (min 3 faces per bin)
- `electron/core/services/FaceService.ts` — `matchAgainstCentroids` checks pose centroids
- `src/views/PersonDetail.tsx` — frontal/profile face count row in stats panel
- `tests/backend/mocks/mockDatabase.ts` — added 4 new people columns + `assignment_source` to faces
- `tests/backend/unit/services/PersonService.test.ts` — added `updatePoseCentroids` mock
- `tests/backend/unit/services/FaceService.drift.test.ts` — added `updatePoseCentroids` mock

---

## Phase 105-4 — Contextual Label Propagation Service

**Files created:**
- `electron/core/services/ContextualMatchingService.ts`
  - `propagateTemporalLabels(photoId)` — ±5 min / same session consensus
  - `propagateSpatialLabels(photoId)` — GPS ≤100 m consensus
  - `batchPropagateForLibrary()` — library-wide batch
  - Consensus threshold: ≥70% of high-confidence frontal anchors
  - Tags faces with `assignment_source = 'context_temporal' | 'context_spatial'`

**Files modified:**
- `electron/ipc/dbHandlers.ts` — `db:propagateLabelsInSession`, `db:batchPropagateLabels`
- `src/views/Settings.tsx` — Smart Assignment section with one-click library-wide run

---

## Phase 105-5 — Assignment Source Badge

**Files created:**
- `src/components/AssignmentBadge.tsx` — small colored circle badge ('T' = temporal, 'G' = GPS)

**Files modified:**
- `src/components/FaceGridItem.tsx` — renders `<AssignmentBadge source={face.assignment_source} />`

---

## Phase 105-6 — Background Propagation Service

**Files created:**
- `electron/core/services/BackgroundPropagationService.ts`
  - Idle-only loop, 30 s startup delay, 1 h rerun interval
  - Skips during active scans / AI queue

**Files modified:**
- `electron/main.ts` — instantiates + registers `BackgroundPropagationService`

---

## Tests

- All 45 test files | 357 tests passing throughout
- Mock DB schema kept in sync at each phase
- No new test files added (service logic tested via IPC + integration path)

## Assumptions & Risks

- GPS backfill reads `metadata_json`; photos without GPS simply skip spatial propagation.
- Pose centroid requires ≥3 faces per bin — sparse libraries may never build pose centroids.
- Consensus threshold (70%) is hardcoded; future work could expose it in Settings.
- Background propagation runs once per hour; library-wide pass on large libraries may take several seconds but runs on `setImmediate` yield points.
