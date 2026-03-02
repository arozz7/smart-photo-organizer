# Phase 101 — Cluster Purity Slider in Clustering Settings Modal

**Branch:** `feature/v0.7.0-prs-integration`
**Date:** 2026-03-02

---

## Problem

After Phases 98–99 applied `max_spread` and `min_cohesion` quality filters to the **Ignored** and **Review Needed** paths, the main **Regroup** path (`ai:getClusteredFaces`) still had neither filter active. Groups in the Discoveries tab occasionally contained visually unrelated faces due to DBSCAN "chain-linking":

> Face A → Face B → Face C can all land in the same cluster because DBSCAN only requires each member to be within epsilon of *at least one* other member. A and C may be completely different people.

The `max_spread` and `min_cohesion` parameters already existed in `commands/clustering.py` and were battle-tested in the Ignored tab, but were never forwarded from the Regroup pipeline — both defaulted to `0.0` (disabled) because the `ai:getClusteredFaces` handler did not include them in the Python payload.

Additionally, there was no user-facing control to tune cluster purity — the only slider was Similarity Threshold, which addresses *how many* clusters form, not *how pure* each cluster is.

---

## Solution

Two complementary fixes:

### Fix A — Backend default values (always-on)
`ai:getClusteredFaces` now always passes:
- `min_cohesion: 0.6` — safety floor for incoherent garbage clusters (centroid magnitude gate)
- `max_spread: options?.max_spread ?? 0.75` — purity filter; any cluster where a member is > 0.75 euclidean from the centroid is demoted to singles

### Fix B — "Cluster Purity" slider in the UI
The Clustering Settings modal gains a second slider:
- **Label:** Cluster Purity
- **Range:** 0.40 (strict) → 1.00 (loose)
- **Default:** 0.75
- **Persisted:** `localStorage('maxSpread')`
- **Direction:** Moving left → stricter (smaller, purer groups). Moving right → looser (allows more internal variation).

---

## Files Modified

| File | Change |
|------|--------|
| `electron/ipc/aiHandlers.ts` | Added `min_cohesion: 0.6` (hardcoded) + `max_spread: options?.max_spread ?? 0.75` to `ai:getClusteredFaces` Python payload; updated log line |
| `src/components/ClusteringSettingsModal.tsx` | Added `maxSpread` state (default `0.75`); localStorage load/save; new Cluster Purity slider UI; updated `onRecluster` interface to include `max_spread` |
| `src/hooks/usePeopleCluster.ts` | Added `max_spread` to `loadClusteredFaces` options type + localStorage persistence (`'maxSpread'` key) |
| `src/views/People.tsx` | Pass `max_spread: settings.max_spread` in `onRecluster` handler |
| `src/context/PeopleContext.tsx` | Added `max_spread?: number` to `loadUnnamedFaces` options type (interface + impl) |
| `docs/logs/face_tuning_log.md` | Phase 91 entry (uses separate numbering for face pipeline tuning) |
| `docs/guides/user_manual.md` | New §4.5 "Clustering Settings (Regroup)" covering both sliders and checkboxes |
| `docs/guides/face-detection-tuning-guide.md` | New "Face Grouping (Clustering) Parameters" section with technical tuning guidance |

---

## Default Value Rationale

| Param | Default | Why |
|-------|---------|-----|
| `max_spread` | `0.75` | Slightly looser than Ignored tab's `0.70`; generous enough for same-person clusters with diverse poses but strict enough to break obvious chains |
| `min_cohesion` | `0.60` | Matches the existing `groupBySuggestion` path threshold (line 427 in `aiHandlers.ts`); same-person clusters score 0.7–0.95, pure garbage scores < 0.3 |

---

## How the Filters Work

After DBSCAN produces clusters, for each cluster:
1. Extract L2-normalized member descriptors
2. Compute centroid (mean vector — not re-normalized)
3. **Cohesion check:** `magnitude = ‖centroid‖`. Same-person vectors point in the same direction → magnitude ≈ 0.8–1.0. Random garbage vectors cancel out → magnitude ≈ 0.0–0.4. Demote if `magnitude < min_cohesion`.
4. **Spread check:** Measure max euclidean distance from any member to the centroid. Tight same-person clusters ≈ 0.3–0.5. Chain-linked clusters ≈ 0.7–1.3+. Demote if `spread > max_spread`.

Demoted clusters become singles (individual faces in the unmatched pool).

---

## Behavior Changes

- Main Regroup now always applies `min_cohesion=0.6` and `max_spread=0.75` by default
- Users can tune `max_spread` via the Cluster Purity slider (persisted across sessions)
- Groups containing chain-linked unrelated faces are split into singles instead of appearing as mixed groups
- Fewer large groups; more singles — intended behavior when cluster quality improves
- No change to the Ignored tab or Review Needed paths (already had their own tuned values)

---

## Assumptions & Risks

- Conservative defaults (0.75 spread, 0.6 cohesion) err toward keeping genuine face clusters intact; power users can tighten via the slider
- If a user had very large groups before, they may see those split into multiple smaller groups after running Regroup — this is correct behavior
- Faces demoted to singles remain in the unmatched pool and are not lost
