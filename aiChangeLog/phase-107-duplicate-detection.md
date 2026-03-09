# Phase 107 — Duplicate Photo Detection

## Overview
Implemented full duplicate photo detection pipeline: SHA-256 exact matching + perceptual hash (pHash) near-duplicate detection. Includes background service for idle-time checking, backfill for pre-existing photos, and a "Safe Deduplication" UI.

## Files Created

### `electron/core/services/BackgroundDuplicateCheckerService.ts`
Idle-only background service (implements `IService`):
- 30s startup delay, 3s between backfill batches, 60s idle interval
- Loop order: SHA-256 backfill (100/batch) → pHash backfill (20/batch) → duplicate detection passes
- `runSha256BackfillBatch()` — Node.js streaming SHA-256 for photos missing hashes
- `runPhashBackfillBatch()` — delegates to Python `compute_phash_batch`
- `runExactPass()` — SQL `GROUP BY sha256_hash` to find identical files
- `runNearPass()` — delegates to Python `group_near_duplicates` (Hamming distance ≤ 10)
- Respects `shouldStop`, `isScanActive()`, `isAIProcessingActive()`, `isShutdownRequested()`

### `electron/data/repositories/DuplicateGroupRepository.ts`
CRUD for `duplicate_groups` table:
- `createGroup(type)`, `getGroupById(id)`, `getPendingGroups()`
- `getGroupsWithPhotos(status, limit, offset)` — paginated groups with photo arrays
- `getStats()` — pending_exact, pending_near, resolved, dismissed counts
- `resolveGroup(groupId, winnerPhotoId)`, `dismissGroup(groupId)`
- `findExistingGroup(photoIds)` — deduplication guard (skip if group already exists)
- `deleteGroup(groupId)`

### `src/python/duplicate_detection.py`
Python duplicate detection utilities:
- `compute_phash(file_path)` — 64-bit pHash via `imagehash` library (16-char hex)
- `compute_phash_batch(entries)` — batch pHash for list of `{id, file_path}` dicts; uses `preview_cache_path` fallback for RAW files
- `hamming_distance(hash_a, hash_b)` — bit-level Hamming distance between two hex pHash strings
- `group_near_duplicates(entries, threshold=10)` — Union-Find clustering of pHashes within threshold

### `src/components/DuplicateGroupCard.tsx`
Filmstrip UI for a duplicate group:
- Horizontal scrollable list of all N photos with lazy-loaded thumbnails
- Auto-selects winner (highest resolution → earliest date)
- Click any photo to switch the winner; selected photo shows ✓ badge
- "Move duplicates to trash" checkbox (default: on) via `shell.trashItem`
- "Keep selected & trash others" → `db:resolveDuplicateGroup`
- "Not duplicates" → `db:dismissDuplicateGroup`
- Shows exact/near badge, photo count, file size

### `src/views/Duplicates.tsx`
Full duplicates management view:
- Stats header pills: Exact matches / Similar / Resolved
- `HashingBanner` — spinning banner while SHA-256/pHash backfill is in progress (polls every 5s)
- 3-tab layout: Pending / Resolved / Dismissed with live counts
- Paginated group list (20/page, "Load more" button)
- "Check now" button → `db:triggerDuplicateCheck`
- Empty state with "Run check now" for the pending tab

## Files Modified

### `electron/db.ts`
Phase 107 migration block:
- Added `sha256_hash TEXT`, `phash TEXT`, `duplicate_group_id INTEGER` columns to `photos`
- Created `duplicate_groups` table: `id`, `type` (exact/near), `status` (pending/resolved/dismissed), `winner_photo_id`, `created_at`
- Indexes: `idx_photos_sha256`, `idx_photos_dup_group`
- Initialized `app_state` key `duplicate_check_dirty = '0'`

### `electron/data/repositories/PhotoRepository.ts`
New methods:
- `getPhotosNeedingSha256(limit)`, `getPhotosNeedingPhash(limit)` — backfill queries
- `countPhotosNeedingHash()` — for the backfill stats IPC handler
- `updatePhotoSha256(id, hash)`, `updatePhotoPhash(id, hash)` — targeted column updates
- `getPhotosWithPhash()` — returns `{id, phash}[]` for near-duplicate clustering
- `findExactDuplicateGroups()` — SQL GROUP BY sha256_hash with count ≥ 2
- `getPhotosByGroupId(groupId)` — fetch all photos in a duplicate group
- `setDuplicateGroup(photoIds, groupId)` — bulk UPDATE duplicate_group_id

### `electron/data/repositories/AppStateRepository.ts`
- Added `isDuplicateCheckDirty()`, `markDuplicateCheckDirty()`, `clearDuplicateCheckDirty()`
- Modified `endScan()` to also set `duplicate_check_dirty = '1'` after each scan

### `electron/scanner.ts`
- Imports `createReadStream` from `node:fs`, `createHash` from `node:crypto`
- Added `computeSHA256(filePath)` helper (streaming read)
- Computes SHA-256 in `processFile()` and stores it immediately after photo insert

### `electron/infrastructure/PythonAIProvider.ts`
- Saves `phash` from `analyze_image` response into `updatePhoto()` call (alongside `blur_score`, `description`)

### `electron/ipc/dbHandlers.ts`
New IPC handlers:
- `db:getDuplicateGroups` — paginated groups by status
- `db:getDuplicateStats` — pending/resolved/dismissed counts
- `db:resolveDuplicateGroup` — mark resolved, set winner, trash others via `shell.trashItem`
- `db:dismissDuplicateGroup` — mark dismissed
- `db:triggerDuplicateCheck` — sets `duplicate_check_dirty` flag
- `db:getHashBackfillStats` — returns `{needsSha256, needsPhash}` counts for UI banner

### `electron/main.ts`
- Instantiates `BackgroundDuplicateCheckerService` with `aiProvider`
- Starts it via `ServiceManager`

### `src/python/commands/scan.py`
- Imports `compute_phash` from `duplicate_detection`
- Computes pHash at end of `analyze_image()` and includes `phash` in response dict

### `src/python/main.py`
- Registered `compute_phash_batch` command
- Registered `group_near_duplicates` command

### `src/python/requirements.txt`
- Added `imagehash` dependency (installed: `imagehash-4.3.2`, `PyWavelets-1.9.0`)

### `src/App.tsx`
- Added `<Route path="duplicates" element={<Duplicates />} />`

### `src/components/Layout.tsx`
- Added `useDuplicateCount()` hook polling `db:getDuplicateStats` every 60s
- Added "Duplicates" `SidebarLink` in Tools section with yellow badge for pending count

## Bug Fixed
- `BackgroundDuplicateCheckerService.ts` originally imported `createReadStream` from `node:crypto` (wrong module). Corrected to import from `node:fs`.

## Architecture Notes
- Backfill is continuous and automatic — no user action required; the background service processes all photos missing hashes before running detection passes
- Groups support N ≥ 2 photos (not just pairs)
- Near-duplicate threshold is 10 Hamming bits out of 64 (~15% difference) — safe for resized/compressed copies
- `shell.trashItem` is used for trash (recoverable), not permanent delete
- `findExistingGroup` guard prevents duplicate group creation on re-runs
