# Face Data Upgrade Service Architecture & Optimizations

## Overview
The `FaceDataUpgradeService` is responsible for backfilling missing AI data (Pose, Descriptor V2) for existing faces. This data is critical for advanced features like "Age Eras" and "Side Profile Recognition".

## Performance Challenges & Solutions

### 1. Database Read Optimization
**Problem:** The query `getFacesNeedingUpgrade` was originally an O(N) operation, scanning all 65,000+ faces to find those with `NULL` descriptors.
**Solution:** Implemented a **Partial Index**:
```sql
CREATE INDEX idx_faces_upgrade_v2 ON faces(photo_id) WHERE descriptor_v2 IS NULL;
```
This transforms the query into an O(K) operation (where K is the number of incomplete faces), making retrieval virtually instantaneous regardless of total database size.

### 2. Database Write Optimization
**Problem:** Writing upgrades for 50 faces sequentially resulted in 50 separate synchronous database transactions. This blocked the main thread and caused UI freezes.
**Solution:** Implemented **Batch Transactions**:
- Faces are processed in memory and results are accumulated.
- A single `db.transaction()` commits all 10-50 updates at once at the end of the batch.
- This reduces filesystem sync operations by 98%.

### 3. IPC & UI Responsiveness
**Problem:** 
1. `setImmediate()` only yields to Node.js libuv loop, not Electron's Chromium message loop (Window events).
2. Aggressive polling from the frontend caused IPC floods.
**Solution:**
- **Yielding:** Switched to `setTimeout(resolve, 10)` which properly yields to the Chromium UI thread.
- **Event-Driven:** Removed all polling. The service now emits `face-upgrade-progress` events, and the frontend consumes them passively.
- **Throttling:** Progress updates are capped at 1Hz max.

### 4. Polling Optimization (FaceDataHealthCard)
**Problem:** The Health Card was polling `db:getFaceDataHealth` every 2 seconds. This query runs 6 full-table scan `COUNT(*)` operations.
**Solution:**
- Changed polling condition to `isRunning && !isPaused`.
- Increased polling interval to 10 seconds.
- Stops completely when paused.

## Current Architecture
- **Batch Size:** 10 faces (conservative to allow frequent UI yields)
- **Sleep Interval:** 3000ms (to prevent CPU starvation)
- **Yield Strategy:** Yield after *every* face processed using `setTimeout`.
- **Error Handling:** Failed faces are marked with empty buffers to prevent infinite retry loops.
