# Performance: Review Needed clustering cache and cheaper split (0.8.31)

**Branch:** `feature/pictures-suggestions`. Plan: `docs/plans/ai-and-edge-cases-speed-plan.md`, phase 2.

## Why
Opening the People page clusters all unassigned faces (89,000 on the real library) in the Python engine. The log of 2026-11-26 shows 2.5 to 3.5 minutes in both 0.8.28 and 0.8.29: DBSCAN 20-25 s, then about 100-125 s splitting the chain-linked clusters with Ward linkage (cost grows with the square of the cluster size: a 23,353-face cluster needs over 2 GB), and every other engine request (Ungroupable, AI status) waits behind it. The same answer was recomputed on every open.

## Files created
- `electron/core/services/clusterCache.ts`: `ClusterCache` (remembers the last grouping; a lookup fits when the settings and algorithm version are the same and no face is new; faces that left the list are removed from the clusters, a cluster under two faces becomes singles), `clusterOptionsKey`, `CLUSTER_ALGORITHM_VERSION` (now 2).
- `electron/infrastructure/ClusterCacheFileStore.ts`: the cache as `cluster-cache.json` in the user data folder (survives restarts); Zod-validated on read, written to a temporary file and renamed; a missing, damaged or unwritable file means "nothing remembered".
- `electron/core/services/ReviewClustering.ts`: `clusterUnassignedFaces` (cache first, engine only when needed; failed answers are not remembered).
- `electron/infrastructure/ClusterRequest.ts`: the Python request (large sets through a file) moved out of `aiHandlers.ts`, unchanged in behavior.
- `tests/python/unit/test_split_oversized_cluster.py`.

## Files modified
- `electron/ipc/aiHandlers.ts`: `ai:getClusteredFaces` goes through `clusterUnassignedFaces`; 833 -> 688 lines.
- `src/python/facelib/faces.py`: `split_oversized_cluster` uses MiniBatchKMeans (deterministic, `random_state=0`) instead of Ward linkage.
- `package.json`, `package-lock.json`: 0.8.31.

## Measured on the real library (read-only, 89,048 unassigned faces)
| | Ward (before) | k-means (now) |
|---|---|---|
| split time, 20 oversized clusters (largest 23,353) | 125.9 s | 10.1 s |
| groups surviving the quality filter | 6,193 | 6,196 |
| faces in those groups | 18,318 | 17,756 |

6,179 groups are identical. Ward grouped 781 faces that k-means leaves as singles; k-means grouped 219 that Ward did not (net 562 faces, 3% of the grouped faces, 0.6% of all unassigned faces). Faces not grouped appear as singles in Review Needed as before.

## Behavior changes
- The first open after this version clusters once (about 35 s instead of about 150 s); later opens, also after a restart, reuse the saved answer while no face is new. After a scan adds faces, the next open clusters again.
- Review Needed groups of very large chain-linked clusters differ slightly (see above).
- **Bug fix:** the old split recursed without end (RecursionError) on faces that cannot be told apart; now such a piece is cut into slices, and no face is lost.

## Tests added (written first)
`clusterCache.test.ts` (9), `reviewClustering.test.ts` (6), `clusterCacheFileStore.test.ts` (7), `clusterRequest.test.ts` (3), `test_split_oversized_cluster.py` (5; four pass with the old code too, so they describe behavior that was kept).

## Assumptions and risks
- The packaged app runs the frozen engine: `npm run build:python` is needed for the split change to ship. The cache works without it, but then the old Ward split still runs on a cache miss.
- Faces that return to the list (Undo) count as new and cause one re-clustering.
- The cache is keyed on settings, not on the hidden-from-review set; faces hidden or shown change the set of faces, which the rules above handle.
