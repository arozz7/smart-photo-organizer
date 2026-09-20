# Phase 126 — Stop re-logging corrupt photos forever, fix read-only rotation failures

## Summary
Two related reliability fixes surfaced while reviewing logs after the rotation fix (Phase 125):
1. Photos with unreadable/corrupt files were logged as pHash/SHA-256 failures on *every* background backfill cycle (every ~3s), forever — not just once.
2. Rotating a file with the Windows read-only attribute set (common for camera-imported or archive-copied photos) failed with `PermissionError: [Errno 13] Permission denied`.

## Issue 1: Corrupt-photo logging spam

### Root cause
`BackgroundDuplicateCheckerService`'s SHA-256 and pHash backfill loops (`runSha256BackfillBatch`, `runPhashBackfillBatch`) query `PhotoRepository.getPhotosNeeding{Sha256,Phash}()`, which simply select photos where the hash column `IS NULL`. When a file can't be read (corrupt/missing), the hash is never computed, so the column stays `NULL` forever — and the very next cycle (3 seconds later) picks the exact same photo back up, fails again, logs again, indefinitely. This is what produced the same "cannot identify image file" warnings repeating in the log without end.

### Fix
Reused the app's existing `scan_errors` table (already used by the initial scan for this exact purpose — one-time-per-stage error tracking, visible in Settings → Scan Errors) instead of inventing a new mechanism:
- `PhotoRepository.getPhotosNeedingSha256`/`getPhotosNeedingPhash` now exclude photos that already have a `scan_errors` row for that specific stage (`'SHA256 Hash'` / `'pHash'`).
- Added `PhotoRepository.recordScanError(photoId, filePath, errorMessage, stage)`.
- `BackgroundDuplicateCheckerService` now calls it exactly once when a file fails SHA-256 hashing or is absent from the pHash batch's results.

Self-healing behavior preserved: `scanner.ts` already clears all `scan_errors` rows for a photo when it's successfully re-scanned (e.g. via the existing "Retry Scan Errors" flow), so if the user later fixes/replaces a corrupt file, its hash backfill naturally resumes on the next cycle — no special-casing needed.

## Issue 2: Read-only files fail to rotate

### Root cause
Neither the RAW rotation path (ExifTool write in `PhotoService.rotatePhoto`) nor the standard-file path (Python/Pillow `rotate_image` in `main.py`) checked whether the target file was writable before attempting to overwrite it. Files copied from cameras, CDs, or read-only archives commonly keep the Windows read-only attribute, causing a hard `PermissionError` on save.

### Fix
Both paths now check writability first and clear the read-only attribute if needed, before attempting the write:
- `src/python/main.py`'s `rotate_image` handler: `os.chmod(file_path, stat.S_IWRITE | stat.S_IREAD)` if `os.access(file_path, os.W_OK)` is `False`.
- `PhotoService.rotatePhoto`'s RAW branch: `fs.chmod(filePath, 0o666)` if `fs.access(filePath, fsConstants.W_OK)` rejects.
- Also fixed a pre-existing accidental duplicate `import os` in `main.py` while adding the needed `import stat`.

## Verification
- **Read-only fix**: real end-to-end test — copied a sample image, made it read-only (`chmod 444`), confirmed the *unfixed* code path reproduces the user's exact error (`PermissionError: [Errno 13] Permission denied`), then confirmed the fix's chmod step clears the attribute and the subsequent rotate+save succeeds.
- **Corrupt-photo exclusion**: real SQL verification against an in-memory SQLite DB with the actual schema — confirmed a photo with an existing `pHash`-stage `scan_errors` row is excluded from `getPhotosNeedingPhash`, while remaining correctly included in `getPhotosNeedingSha256` (stage-scoped, not a blanket exclusion).
- TypeScript compiles clean (`tsc --noEmit`); `main.py` parses clean.

## Face thumbnails after rotation (user question, no code change needed)
Investigated how face thumbnails are rendered: there is no pre-generated face-crop image file. `faces.box_json` (bounding box) is stored per face, and the `local-resource://` custom protocol (`electron/services/image/ImageService.ts`) crops the region from the photo's *current* file on disk at request time, using the box coordinates in the URL. Since Phase 125's fix now makes `rotatePhoto` call `analyzeImage({cleanRescan: true})` for standard files — deleting old face rows and creating entirely new ones with boxes computed against the freshly-rotated pixels — face thumbnails are regenerated as a natural consequence of the rescan, not a separate step that could be skipped.

One residual note, not confirmed as an active bug: the `local-resource://` protocol sets `Cache-Control: max-age=3600` on cropped responses. Since a rescan produces new face IDs and (almost always) different box coordinates, the resulting request URLs differ from the pre-rotation ones, so this shouldn't cause visibly stale crops in practice — but any UI that requests the *exact same* URL before and after rotation (e.g. a full, non-cropped photo preview without a cache-busting parameter) could theoretically show a stale cached image for up to an hour. `refreshPhoto()` (`usePhotoNavigation.ts`) already appends a `?t=timestamp` cache-buster specifically to defeat this for the single-photo view; flagging that the same protection may be worth checking on any other view that renders a photo/face without going through `refreshPhoto`, if a stale thumbnail is ever actually observed.
