# Fix: near-duplicate check blocked the AI backend for minutes on every launch

**Branch:** `fix/near-duplicate-performance` (stacked on `feat/show-real-app-version`, PR #81). Version 0.8.3.

## Symptoms (0.8.1 / 0.8.2 on a 30,058-photo library)
"Starting AI..." for minutes, the People page and the AI Model Management dialog spinning, face-verification timeouts.
Fine in 0.8.0.

## Root cause (traced in code and data)
1. **0.8.0 never reached the duplicate check on this library.** `runPhashBackfillBatch` returns the number of photos it
   *tried*, and the service loop only moves on when that is 0. Eleven corrupt photos (the Sep 17 scan logged
   "cannot identify image file" for all of them) can never get a hash, so 0.8.0 retried them every 3 seconds forever
   and the exact/near passes were unreachable.
2. **0.8.1 fixed that** (commit 75bbf28, Sep 20: record unreadable photos in `scan_errors` and stop retrying them; rows
   stamped 2026-09-21 01:54:11). The backfill completed, so the near pass became reachable for the first time.
3. **The near pass cannot work at that size.** `group_near_duplicates` compared every pair in pure Python
   (0.61 microseconds per pair measured, so about 4.6 minutes for 30,058 hashes). The caller gave it 60 seconds.
   Python cannot cancel a running request, so the backend stayed busy for minutes and the result was thrown away.
4. **It repeated at every launch:** the loop marked the check "dirty" at every start, so each launch wasted the same minutes.
   While Python runs one request, every other request (status, model dialog, People clustering, face verification) waits.

## Changes
- `src/python/duplicate_detection.py`: `group_near_duplicates` is vectorised with numpy (XOR of blocks of hashes plus a
  bit-twiddling population count, union-find on the matches only). Measured on 30,058 hashes: **6.1 s instead of ~4.6 min**,
  identical groups. The original algorithm remains as the fallback for unusual input (hashes that are not 16 hex characters,
  or a threshold of 64 or more), so behaviour is unchanged there.
- `BackgroundDuplicateCheckerService.ts`:
  - near-pass request timeout 60 s -> 300 s;
  - the check no longer runs at every launch. It runs when no full check has ever completed on the library
    (`duplicate_check_completed_v2`, so a library whose near pass only ever timed out gets one fresh run), when new hashes
    were computed (SHA-256 or pHash backfill produced at least one), or when the user asks (`db:triggerDuplicateCheck`);
  - a failed or stopped near pass is not recorded as complete, and is retried no sooner than 30 minutes later.
- `AppStateRepository.ts`: `hasCompletedDuplicateCheck` / `markDuplicateCheckCompleted`.
- The service's docstring said "again whenever new photos are scanned" but nothing triggered that; the new-hash trigger makes it true.

## Tests
- `tests/python/unit/test_duplicate_detection.py` (20): the original algorithm is kept inside the test as the reference;
  the new code returns the same groups for thresholds 0/3/10/20 over random data with injected near-copies, chains,
  identical hashes, block boundaries, mixed hash lengths, threshold 64, plus a speed guard (10,000 hashes under 10 s).
- `tests/backend/unit/services/BackgroundDuplicateCheckerService.test.ts` (5): no repeat at launch after a completed check;
  one run when none ever completed; 300 s timeout; re-check after new hashes; failed pass not marked complete and retried
  only after the pause.

## Not changed / follow-ups
- The face verifier accepts a face as human when the AI backend times out (Phase 90 "VLM as negative filter only"). That is
  a data-quality risk whenever the backend is busy; separate decision.
- The AI status label shows "CPU" until face detection first initialises (default in `faces.py`); separate fix.
- Other long requests can still block the single AI backend; People clustering of 68k faces takes about 90 s.
