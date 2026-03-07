# Phase 104 — Upstream False Positive Reduction

**Branch:** `feature/phase-104-false-positive-reduction`
**Tests:** 352 TS (45 files) + 7 Python — all passing

## Summary

Three levers to catch cartoon/object false positives, unified behind a
"Strict False Positive Mode" toggle (off by default).

---

## Phase 1 — DB Migration: `ignore_source` column

**Files modified:**
- `electron/db.ts` — migration: `ALTER TABLE faces ADD COLUMN ignore_source TEXT DEFAULT NULL CHECK(...)`
- `electron/data/repositories/FaceRepository.ts` — `ignoreFaces(ids, source='user')`, `markFaceAsRejected` sets `ignore_source='user'`
- `tests/backend/mocks/mockDatabase.ts` — added `ignore_source` column to test schema
- `tests/backend/unit/repositories/FaceRepository.test.ts` — 2 new tests

**Behavior:** All existing callers default to `ignore_source='user'`. Background
verification sets `ignore_source='background_verification'` so audits can
distinguish manual vs auto-ignored faces.

---

## Phase 2 — `BackgroundVerificationService.processOrphanedFaces()`

**Files modified:**
- `electron/data/repositories/FaceRepository.ts` — `getOrphanedFaces(limit)`, `countOrphanedFaces()`
- `electron/core/services/BackgroundVerificationService.ts` — `processOrphanedFaces()` added to `runLoop()`
- `tests/backend/unit/repositories/FaceRepository.test.ts` — 7 new tests
- `tests/backend/unit/services/BackgroundVerificationService.test.ts` — 3 new tests

**Orphan definition:** `entity_type='human'`, `confidence_tier='human'`,
`needs_bucketing=0`, `bucket_id IS NULL`, `person_id IS NULL`, `is_ignored=0`,
`descriptor IS NOT NULL`.

**Behavior:** After each batch of suspect verification, orphaned faces are
re-verified by VLM. Rejects → `ignore_source='background_verification'`.

---

## Phase 3 — Re-Check button tooltip

**Files modified:**
- `src/views/People.tsx` — `title` updated to note auto-flagged faces

**Behavior:** No logic change. `getIgnoredFacesForBucketing` already queries
all `is_ignored=1` rows, so auto-ignored faces surface automatically on re-check.

---

## Phase 4 — `STRICT_SCORE_THRESHOLD_ACCEPT` constant

**Files modified:**
- `electron/core/services/ConfigService.ts` — `export const STRICT_SCORE_THRESHOLD_ACCEPT = 0.75`
- `ai-config.json` — `score_threshold_accept_strict: 0.75` documented
- `tests/backend/unit/services/ConfigService.test.ts` — 3 new tests

**Behavior:** Default `scoreThresholdAccept` remains `0.70`. Strict mode (Phase 6) raises it.

---

## Phase 5 — Pose-weighted DBSCAN anchors (Python)

**Files modified:**
- `src/python/facelib/faces.py` — `cluster_faces_dbscan()` gains `anchor_only_frontal` + `pose_yaws` params
- `tests/python/unit/test_clustering.py` — created with 5 tests

**Logic:** Post-DBSCAN filter: any cluster with no member having `|pose_yaw| < 55°` is
dissolved. `pose_yaws=None` → safe fallback (treat all as frontal).

---

## Phase 6 — "Strict False Positive Mode" UI toggle

**Files modified:**
- `electron/core/services/ConfigService.ts` — `strictFalsePositiveMode?: boolean` in `AdvancedFaceConfig` (default `false`)
- `src/components/SettingsModal.tsx` — toggle in Advanced Face Settings (yellow accent); co-updates `scoreThresholdAccept`
- `electron/ipc/aiHandlers.ts` — `ai:clusterFaces` includes `pose_yaw` per face + `anchor_only_frontal` from config
- `src/python/commands/clustering.py` — reads `anchor_only_frontal` + `pose_yaws` from payload
- `tests/backend/unit/services/ConfigService.test.ts` — 2 new tests
- `tests/python/unit/test_clustering.py` — 2 command-layer tests added

**Toggle behaviour:**
- ON → `scoreThresholdAccept=0.75`, `strictFalsePositiveMode=true` saved to config; clustering uses `anchor_only_frontal=true`
- OFF → `scoreThresholdAccept=0.70`, `strictFalsePositiveMode=false`

---

## Hotfix — `confidence_tier=unknown` orphan query fix

**Commit:** `fix(faces): include confidence_tier=unknown in orphaned face queries`

**Files modified:**
- `electron/data/repositories/FaceRepository.ts` — `getOrphanedFaces` and `countOrphanedFaces` now accept `(confidence_tier='human' OR confidence_tier='unknown')`
- `tests/backend/unit/repositories/FaceRepository.test.ts` — 4 new tests

**Root cause:** On a fresh database with no named people, all faces receive
`confidence_tier='unknown'` (no FAISS reference vectors to compare against).
The previous `confidence_tier='human'` filter made `processOrphanedFaces` a
complete no-op, so high-score false positives (e.g. couch texture scoring ≥0.70)
that bypassed the suspect queue were never VLM-re-checked and remained visible
in cluster view as false positives.

**Fix:** Including `'unknown'` tier allows `BackgroundVerificationService` to
VLM-verify these faces post-bucketing and mark genuine false positives as
`is_ignored=1` with `ignore_source='background_verification'`.

**Safety:** `entity_type='human'` guard remains — suspect-typed faces are still
excluded from the orphan queue.

---

## Test Totals

| Suite | Before | After |
|---|---|---|
| TypeScript (vitest) | 337 (45 files) | 357 (45 files) |
| Python (pytest) | 36 (excl. api/vlm) | 7 new clustering tests |
