# Phase 125 — Fix "Save Rotation" doing nothing for standard image files

## Summary
Rotating a standard (non-RAW) photo in the Library view and clicking "Save Rotation" / confirming "Save & Re-Scan" rotated the file's pixels correctly, but the user saw no visible effect: the thumbnail stayed unrotated and faces were never re-scanned, despite the confirmation dialog explicitly promising "This will modify the original file and re-scan for faces."

## Root cause
`PhotoService.rotatePhoto()` (`electron/core/services/PhotoService.ts`) has two branches — RAW (via ExifTool) and non-RAW/standard (via Python/Pillow). The RAW branch already does three things after rotating: (1) triggers a face re-scan via `analyzeImage({cleanRescan: true})`, (2) regenerates the preview thumbnail via `extractPreview()`, (3) returns a result. The non-RAW branch (JPG/PNG — the common case) did none of this — it just forwarded the Python rotation result straight back to the renderer.

A second, compounding bug: the Python `rotate_image` handler (`src/python/main.py`) *did* attempt to write a preview thumbnail itself, but used a different, incompatible naming scheme (`preview_{photoId}.jpg`) than the one `PhotoService.extractPreview()` uses everywhere else in the app (`{md5(filePath)}.jpg`). Even if this had been wired up, the file it wrote would never have been read by the UI, which only ever requests the hash-named path.

## Fix
- `PhotoService.rotatePhoto()`'s non-RAW branch now mirrors the RAW branch: after a successful Python rotation, it calls `analyzeImage({photoId, filePath, scanMode: 'FAST', cleanRescan: true})` to re-scan faces, then `extractPreview(filePath, previewsDir, true, true)` to regenerate the thumbnail at the correct hash-based path.
- Removed the dead/incorrectly-named preview-writing code from Python's `rotate_image` handler (and the now-unused `previewStorageDir` payload field) — preview generation is now handled exclusively by the Node side, matching the RAW path.

## Verification
Full live reproduction in dev mode, isolated from the real library: launched the app with `--user-data-dir` pointing at a scratch directory (fresh, empty config and DB — zero risk to the real `H:\PhotoLibrary` library), inserted one test photo row via `db:query ... RETURNING id` pointing at a throwaway JPEG copy, then called `ai:rotateImage` directly.

Before the electron main bundle was rebuilt (i.e. against the stale pre-fix compiled code), the test confirmed the original bug exactly: rotation succeeded but no scan log and no preview file at the expected path. After rebuilding with the fix:
- `Successfully rotated ...` (Python log) — unchanged, was already working
- `[PhotoService] Starting scan for Photo 1 (cleanRescan=true)` — **new**, confirms face re-scan now runs
- Preview file exists at the correct `{md5hash}.jpg` path, 123KB, real content — **new**, confirms thumbnail regeneration now works
- Rotated dimensions correctly swapped for a 90° rotation (1202×1475 → 1475×1202)

Scratch test directory and photo deleted after verification; nothing touched the user's real library.

## Assumptions & Risks
- None identified — this fix makes the non-RAW path structurally identical to the already-correct RAW path.
