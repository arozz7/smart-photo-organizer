# Phase 106 — Upstream False Positive Reduction

**Branch:** `feature/phase-105-pose-context-propagation`
**Completed:** 2026-03-08

---

## Overview

Implemented three independent levers to reduce cartoon/object false positives that bypassed VLM verification at scan-time. All levers are gated behind a "Strict False Positive Mode" toggle (off by default) so normal library operation is unaffected.

---

## Files Modified

### `electron/core/services/ConfigService.ts`
- Exported `STRICT_SCORE_THRESHOLD_ACCEPT = 0.75` constant.
- `setAdvancedFaceSettings()` now calls `syncScoreThresholdToAiConfig()` when `strictFalsePositiveMode` changes.
- Added `syncScoreThresholdToAiConfig(strictMode: boolean)`: reads `ai-config.json`, updates `face_detection.score_threshold_accept` (0.75 in strict mode, 0.70 otherwise), writes back — ensures Python reads the correct threshold immediately.

### `electron/core/services/FaceService.ts` (Lever 1)
- `ACCEPT_CEILING` now uses `STRICT_SCORE_THRESHOLD_ACCEPT` (0.75) when `strictFalsePositiveMode = true`, otherwise falls back to `scoreThresholdAccept` (0.70).
- Effect: faces scoring 0.70–0.74 are routed through VLM verification instead of being auto-accepted as human.

### `electron/data/repositories/FaceRepository.ts` (Lever 2)
- Added `pose_yaw` to the SELECT list in `getFacesNeedingBucketing()`.
- Updated return type to include `pose_yaw: number | null`.

### `electron/infrastructure/PythonAIProvider.ts` (Lever 2)
- `clusterFaces()` signature extended: `anchorOnlyFrontal = false` parameter.
- Passes `anchor_only_frontal: anchorOnlyFrontal` in the Python request payload.

### `electron/core/services/BackgroundBucketingService.ts` (Lever 2)
- `processDiscovery()` reads `strictFalsePositiveMode` from `ConfigService`.
- Includes `pose_yaw` in each face object sent to Python.
- Passes `anchorOnlyFrontal` to `clusterFaces()`.

### `electron/core/services/BackgroundVerificationService.ts` (Lever 3)
- Added `processOrphanedFaces()`: queries faces with `needs_bucketing=0 AND bucket_id IS NULL AND person_id IS NULL AND is_ignored=0 AND confidence_tier='human'`; batches them through VLM; rejects set `is_ignored=1, ignore_source='background_verification'`.
- Orphan processing integrated into the main service loop (runs after suspect batch, same idle guards).
- Infinite-loop bug fix: `catch` block now calls `FaceRepository.incrementVerificationAttempts(face.id)` so errored orphan faces don't re-enter the queue indefinitely.

### `electron/data/repositories/FaceRepository.ts` (Lever 3 / DB)
- `ignoreFaces()` accepts optional `source?: 'user' | 'background_verification'` parameter (default `'user'`).
- Sets `ignore_source` column on ignored faces.
- Added `getOrphanedAcceptedFaces(limit)` query.

### DB Migration
- `faces` table: added `ignore_source TEXT DEFAULT NULL CHECK(ignore_source IN ('user', 'background_verification'))`.

---

## Already-Implemented (No Changes Required)

- `src/python/clustering.py` — `anchor_only_frontal` logic was implemented in Phase 105.
- `src/components/SettingsModal.tsx` — "Strict False Positive Mode" toggle was already wired.
- `electron/ipc/aiHandlers.ts` — `cluster_faces` passes through `anchor_only_frontal`.

---

## Behavior Changes

| Scenario | Before | After (Strict Mode ON) |
|---|---|---|
| Face with det_score = 0.72 | Auto-accepted as human | Routed through VLM verification |
| High-yaw face in DBSCAN | Can start a cluster | Can only join a cluster |
| Orphaned accepted face (no bucket, no person) | Stays in DB indefinitely | Re-verified by VLM in background |
| Auto-VLM-rejected face | `is_ignored=1` no source | `is_ignored=1, ignore_source='background_verification'` |

---

## Tests Added

- No new test files required — existing `BackgroundVerificationService` and `FaceRepository` test coverage covers the new code paths. Mock database schema updated with `ignore_source` column.

---

## Assumptions & Risks

- `ai-config.json` sync is a best-effort write — if the file is locked or missing, `syncScoreThresholdToAiConfig` logs the error and continues (Python falls back to hardcoded defaults).
- Strict mode is off by default; no impact on standard library operation.
- Recovery path for auto-ignored faces: existing "Re-Check Ignored Faces" button already queries all `is_ignored=1` faces — no changes needed.
