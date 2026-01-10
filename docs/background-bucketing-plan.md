# Background Auto Face Bucketing Plan

## Goal
Create a background process that continuously organizes unassigned faces into stable "Buckets" for easier user review, without blocking the UI or interfering with active scans.

## Problem Statement
Currently, face clustering happens **on-demand** when visiting the "Unnamed Faces" page:
- **Latency:** User waits for clustering to complete.
- **Volatility:** Clusters shift as new faces are added.
- **Lost Work:** Partial cluster actions may cause re-clustering.

## Solution: Hybrid Bucketing

### Two Types of Buckets
1. **Suggestion Buckets:** Faces matching a Named Person (below auto-assign threshold).
   - *Example:* "50 faces that look like John (Distance 0.45-0.6)"
2. **Discovery Buckets:** Faces clustering with *each other* (no named match).
   - *Example:* "New group of 20 faces (Unknown Person)"

### Temporary Vector Index
The background service builds an **in-memory FAISS index** of unassigned faces for efficient processing:
1. **Pass 1 (Suggestions):** Query Named People centroids (+ all Eras) against the temp index.
2. **Pass 2 (Discovery):** Run DBSCAN on remaining faces to find clusters.

## Scheduling & Resource Management

### Scan-Aware Execution
Background bucketing **yields only to active scans**:

```
Background Service Loop:
1. Check scan state:
   - scan_in_progress=1 AND scan_paused=0 → Sleep 30s, goto 1
   - scan_paused=1 → Continue (user paused = idle time)
   - scan_in_progress=0 → Continue
2. Check bucketing_dirty flag
3. If dirty=0 → Sleep 60s, goto 1
4. Run bucketing (batch of 1000 faces)
5. Set dirty=0, goto 1
```

### Trigger Conditions
| Event | Action |
|---|---|
| **Scan Starts** | `scan_in_progress=1` |
| **Scan Paused** | `scan_paused=1` (bucketing can run) |
| **Scan Resumed** | `scan_paused=0` (bucketing yields) |
| **Scan Completes** | `scan_in_progress=0`, `bucketing_dirty=1` |
| **Face Assigned/Named** | `bucketing_dirty=1` |
| **New Person Created** | `bucketing_dirty=1` |
| **Era Generated** | `bucketing_dirty=1` |

### Work Queue (Per-Face)
- Set `needs_bucketing=1` on new unassigned faces.
- Background queries `WHERE needs_bucketing=1 LIMIT 1000`.
- After processing, clears the flag.

## Scan-Time Handoff
Work done during photo scan to accelerate background bucketing:

| Scan-Time Action | Column Updated | Background Benefit |
|---|---|---|
| Match against all eras | `match_distance`, `suggested_person_id` | Skip re-matching |
| Capture parent folder | `session_folder` | Session grouping |
| Store photo date | `session_date` | Time-based grouping |
| Flag unassigned faces | `needs_bucketing=1` | Cheap work queue |

## Database Schema Changes

### Faces Table (Updates)
```sql
ALTER TABLE faces ADD COLUMN session_folder TEXT;
ALTER TABLE faces ADD COLUMN session_date TEXT;
ALTER TABLE faces ADD COLUMN needs_bucketing INTEGER DEFAULT 0;
ALTER TABLE faces ADD COLUMN bucket_id INTEGER REFERENCES face_buckets(id);
```

### Face Buckets Table (New)
```sql
CREATE TABLE face_buckets (
    id INTEGER PRIMARY KEY,
    centroid BLOB,
    status TEXT DEFAULT 'active', -- 'active', 'reviewed', 'ignored'
    session_folder TEXT,
    session_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
```

### App State Flags
```sql
INSERT INTO app_state (key, value) VALUES ('scan_in_progress', '0');
INSERT INTO app_state (key, value) VALUES ('scan_paused', '0');
INSERT INTO app_state (key, value) VALUES ('bucketing_dirty', '0');
```

## Backwards Compatibility

### Migration Script (On App Startup)
- Add columns if missing (safe `ALTER TABLE`).
- Backfill: Set `needs_bucketing=1` for existing unassigned, unignored faces.
- Set `bucketing_dirty=1` to trigger initial run.

### Graceful Degradation
- Missing `session_folder` → Skip session grouping, still bucket.
- Missing `match_distance` → Re-compute in background (slower).

## Lifecycle & Cleanup

### Suggestion Faces
| User Action | Database Mutation |
|---|---|
| **Confirm Suggestion** | Set `person_id`, clear `suggested_person_id` |
| **Reject/Ignore** | Clear `suggested_person_id`, set `is_ignored=1` |
| **"Not This Person"** | Clear `suggested_person_id` only (stays unassigned) |

### Discovery Buckets
| User Action | Database Mutation |
|---|---|
| **Name Bucket** | Set `person_id` on all faces, delete bucket row |
| **Ignore Bucket** | Set `is_ignored=1` on all faces, delete bucket row |
| **Split/Ungroup** | Clear `bucket_id` on selected faces (back to pool) |

### Automatic Cleanup
- Delete empty `face_buckets` where no faces reference it.
- Re-run Pass 1 when new person is named.

## Distance Tiers
| Range | Scan-Time Action | Background Action |
|---|---|---|
| `< 0.4` | Auto-Assign | Skip (already assigned) |
| `0.4 - 0.6` | Tag `review` tier | Suggestion Bucket |
| `0.6 - 0.8` | Tag `unknown` tier | Loose Suggestion |
| `> 0.8` | No match | Discovery Clustering |

## Prerequisites
These features should be completed first:
1. **Era-Aware Matching** - Ensure FAISS path uses era centroids.
2. **Photo Session Grouping** - Add `session_folder`/`session_date` columns.
3. **Pet vs Human Classification** - Add `entity_type` column.

## Implementation Phases
- [ ] **Phase P1:** Complete Era-Aware Matching
- [ ] **Phase P2:** Photo Session Grouping
- [ ] **Phase P3:** Pet Classification
- [ ] **Phase B1:** Schema migration + state flags
- [ ] **Phase B2:** Scan-time handoff (populate new columns)
- [ ] **Phase B3:** BackgroundBucketingService implementation
- [ ] **Phase B4:** UI updates (Suggestion/Discovery sections)
