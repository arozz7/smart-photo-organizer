# AI start and Edge Cases speed

**Evidence (logs of 2026-11-26, 0.8.28 and 0.8.29, same library):**
- Main process blocked about 3.5 s in every 10 s while idle, in both versions. Cause found and fixed in 0.8.30 (grouping status count).
- Opening People starts a clustering of about 83,000 unassigned faces (Review Needed). In both versions it takes about 2.5-3.5 minutes: DBSCAN 20 s, then splitting one chain-linked cluster of about 19,700 faces with Ward linkage (O(n^2), about 100 s).
- The Python engine handles one command at a time, in arrival order. `find_ungroupable_faces` waited about 47 s behind caption, verification and grouping commands.
- Engine start: 9 s (0.8.28, warm) against 48 s (0.8.29, first launch). The engine folder is identical in both; to be checked with a warm second start.

## Phases
1. **0.8.30** (done): covering index for the grouping status; Ungroupable centroid bug; Doubtful crop.
2. **0.8.31** (done; measurements in `aiChangeLog/perf-review-clustering-cache.md`: split 125.9 s -> 10.1 s, 562 fewer grouped faces of 18,318): (a) cache the Review Needed clustering, keyed on the filtered face set and options, stored in the user data folder so it survives restarts; faces that only leave the set are pruned from the cached clusters instead of re-clustering, new faces force a re-cluster; (b) replace the Ward split of a very large cluster with a cheaper split after an offline comparison on the real library (count the groups that survive the cohesion and spread filter) and the user's go/no-go; the packaged engine needs `build:python`.
3. **0.8.32** (done; `aiChangeLog/perf-foreground-lane.md`): a foreground lane in the Python request queue: background services mark their requests, those are held back while a user request is pending. A request's timeout starts when it is written to the engine, not when it is queued. Fire-and-forget commands keep their order. The queue is its own class with injected I/O, tested against a fake process. Does not shorten a running clustering.

Each phase: tests first, a change log, a version bump, `scripts/dev/verify.ps1`, a build, and a measurement from the log after a warm start.
