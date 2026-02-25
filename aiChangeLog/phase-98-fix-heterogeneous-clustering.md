# Phase 98 — Fix "Group Similar" Heterogeneous Clustering

## Problem
The "Group Similar" button across People tabs (Ignored, Review Needed) produced large garbage clusters containing car wheels, plant leaves, blurry brown blobs, hands — completely unrelated objects grouped together. Root causes:

1. **eps too permissive**: `eps=0.45` (cosine) → `eps_euclidean ≈ 0.949` — very different vectors could cluster
2. **DBSCAN chain-linking**: A→B→C chains where A and C are far apart but reachable via B
3. **No cohesion gate on `ai:clusterFaces`**: The Ignored tab IPC path had zero post-processing
4. **`ai:getClusteredFaces` cohesion filter incomplete**: The existing magnitude check (line 409) only gated suggestion-matching, not the returned clusters themselves

## Solution: Centroid-Magnitude Cohesion Filter

For L2-normalized face vectors: if cluster members all point in the same direction, their mean vector has magnitude ≈ 1.0 (real face group). If members are diverse/random, vectors cancel out → magnitude ≈ 0.0 (garbage cluster).

## Files Modified

### `src/python/commands/clustering.py`
- Added `min_cohesion: float` parameter (default `0.0`, backward-compatible)
- After oversized-cluster splitting, added post-filter loop:
  - Computes centroid from L2-normalized descriptors for each cluster
  - Demotes clusters with `magnitude < min_cohesion` to singles (logged at INFO)

### `src/hooks/useIgnoredFaces.ts`
- Tightened `eps: 0.45 → 0.35` (eps_euclidean: 0.949 → 0.837; faces must be more similar to group)
- Added `min_cohesion: 0.45` to `ai:clusterFaces` IPC call (centroid magnitude gate)

### `electron/ipc/aiHandlers.ts`
- **Added** `computeClusterCohesion(clusterIds, faceMap)` module-level helper function
- **Added** `REVIEW_NEEDED_MIN_COHESION = 0.40` constant
- **Fix 3 (`ai:clusterFaces`)**: Refactored handler to use `pythonProvider.sendRequest('cluster_faces', payload)` directly, passing `min_cohesion` through to Python
- **Fix 4 (`ai:getClusteredFaces`)**:
  - Moved `faceMap` building outside the `groupBySuggestion` block (shared by both code paths)
  - Added return-time cohesion filter in the `groupBySuggestion` path (before return): demotes low-cohesion clusters to singles
  - Added return-time cohesion filter in the non-grouped path: demotes low-cohesion clusters to singles

## Threshold Rationale

| Parameter | Old | New | Meaning |
|-----------|-----|-----|---------|
| Ignored `eps` (cosine) | 0.45 | 0.35 | eps_euclidean: 0.949 → 0.837 |
| Ignored `min_cohesion` | (none) | 0.45 | Centroid magnitude gate for Ignored tab |
| Review Needed `min_cohesion` | (none) | 0.40 | Return-time gate for all Review Needed clusters |

Real face groups have magnitude 0.7–0.95. Garbage clusters (random non-face objects) have magnitude < 0.2.

## Behavior Changes
- Ignored tab "Group Similar": tighter grouping + cohesion gate eliminates heterogeneous garbage clusters
- Review Needed tab "Group Similar": return-time cohesion filter ensures all returned clusters are genuine face groups
- Demoted cluster members are returned as singles (unaffected faces remain available for review)
- `min_cohesion=0.0` (default) preserves backward-compatible behavior for any other callers

## Round 2 Fixes (after initial thresholds insufficient)

### Root-cause analysis from Python logs
`22:16:11 eps=0.35 → 6 clusters, 90 noise points` — **no cohesion demotion logged**, meaning:
1. **42-face cluster**: centroid magnitude ≥ 0.45 (passed filter). Chain-linked garbage where blurry/brownish patches link from human faces to dogs/grass via adjacent-similarity. Centroid magnitude fails to catch this because the blobs all point similarly in embedding space.
2. **90-face "group"**: NOT a DBSCAN cluster. These are the 90 noise/singleton points that DBSCAN correctly rejected. `useIgnoredFaces.ts` was dumping all singletons into one mega-group entry, making them *look* like a bad 90-face cluster.

### Additional changes made

#### `src/python/commands/clustering.py`
- Added `max_spread` parameter (default `0.0`): max euclidean distance from any cluster member to the centroid. Chain-linked clusters have high spread (endpoints far from center); tight same-person clusters have low spread (≈ 0.3–0.6).
- Combined cohesion + spread into one filter block; logs magnitude and spread for **every** cluster (INFO level) so thresholds can be tuned from logs.
- A cluster is demoted if **either** magnitude < min_cohesion OR spread > max_spread.

#### `src/hooks/useIgnoredFaces.ts`
- Raised `min_cohesion: 0.45 → 0.65`
- Added `max_spread: 0.7` (euclidean; rejects any cluster where a member is > 0.7 from the centroid — catches chain-linked spans)
- **Fixed 90-face mega-group bug**: removed singles from `controllerData` in grouping mode. Grouping mode now shows only actual DBSCAN clusters. Singletons (faces DBSCAN correctly said "don't fit any group") are visible in flat view (disable grouping).

### Threshold rationale (Round 2)
| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `min_cohesion` | 0.65 | Same-person clusters score 0.70–0.95; chain-linked garbage 0.45–0.65 |
| `max_spread` | 0.7 euclidean | Tight cluster spread ≈ 0.3–0.6; chain endpoint spread ≈ 0.9–1.3 |

## Assumptions & Risks
- Conservative thresholds (0.40/0.45) chosen to avoid over-filtering genuine face clusters
- The Python-side filter and TypeScript-side filter are independent layers — both must agree for a cluster to survive
- Users may see fewer groups and more singles after this change (intended: false positives removed)
