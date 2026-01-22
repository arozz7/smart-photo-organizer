# Phase 48: Face Data Upgrade Optimization

## Objective
Fix critical performance issues and UI unresponsiveness during the "Face Data Upgrade" process (used for Age Eras and Side Profile backfill).

## Changes

### Backend Optimization (`FaceDataUpgradeService.ts`)
- **Partial Index:** Added `idx_faces_upgrade_v2 ON faces(photo_id) WHERE descriptor_v2 IS NULL`. optimising query from O(N) to O(K).
- **Batch Transactions:** Replaced sequential DB updates with a single batched transaction per cycle.
- **Event-Driven:** Removed IPC polling support in favor of pure event emission.
- **Concurrency:** Adjusted to 10 faces/batch with 3000ms sleep and aggressive yielding (`setTimeout`) to prioritize UI responsiveness.

### Frontend Optimization (`FaceDataHealthCard.ts`, `useFaceDataUpgrade.ts`)
- **Removed Polling:** Hook now listens for `face-upgrade-progress` events instead of polling `getStatus` every 5 seconds.
- **Fixed Health Card Bug:** `FaceDataHealthCard` was running 6 full-table `COUNT` queries every 2 seconds because it didn't check `isPaused`. Added `!isPaused` check and increased interval to 10 seconds.

### Logic Improvements
- **Robustness:** Failed faces are now marked with empty buffers to prevent infinite retry loops.
- **Logging:** Reduced console noise by changing per-face logs to debug level.

## Verification
- Confirmed UI remains responsive (resizing, scrolling) while upgrade runs.
- Confirmed "Pause" effectively stops CPU/DB usage.
- Confirmed progress bar updates at 1Hz without flooding IPC.
