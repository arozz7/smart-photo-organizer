# Phase 102 — Large Payload Streaming Fix

## Problem

With 53K+ faces in the library, three IPC operations were crashing with
`RangeError: Invalid string length`:

- `ai:getClusteredFaces` (Edge Cases / Regroup pages)
- `ai:findUngroupableFaces` (Edge Cases page)
- `FaceNoiseService.detectBackgroundFaces` (excludeBackground filter inside clustering)

Root cause: `JSON.stringify()` on an array of 53K face objects — each carrying a
512-float descriptor — produces a string that exceeds V8's maximum string length
(~512 MB / ~256 M UTF-16 code units). The call throws before anything reaches
Python.

The `detect_background_faces` path already had a file-based transfer branch, but
it still called `JSON.stringify({ faces, centroids })` in a single shot to write
the temp file, hitting the same limit.

## Fix

Applied the streaming-write pattern (already used by `ai:rebuildIndex`) to all
three affected paths. Instead of building a single giant JSON string, each face
is serialized individually and written to a temp file incrementally via a
`WriteStream`. Python receives only the file path and reads it directly.

### Files Modified

| File | Change |
|------|--------|
| `electron/core/services/FaceNoiseService.ts` | Replaced `fs.writeFile(path, JSON.stringify(...))` with streaming `createWriteStream` + per-face writes |
| `electron/ipc/aiHandlers.ts` | Added file-based transfer branch (threshold: 5000 faces) to `ai:findUngroupableFaces` handler |
| `electron/ipc/aiHandlers.ts` | Added file-based transfer branch (threshold: 5000 faces) to `ai:getClusteredFaces` handler |

### Files Modified (unrelated, pre-existing)

| File | Change |
|------|--------|
| `src/hooks/useFlexZoom.ts` | Converted `containerRef` from `useRef` to callback ref (`useCallback`) for correct dynamic-mount handling |

## Python Side

No Python changes needed. All three Python handlers (`detect_background_faces`,
`find_ungroupable_faces`, `cluster_faces`) already supported the `dataPath`
protocol — they check for `dataPath` in the payload and read the temp file
directly when present.

## Threshold

Streaming write is activated at **> 5 000 faces**, matching the threshold used
by `FaceNoiseService` and `ai:rebuildIndex`. Below that, direct IPC JSON is
used as before.

## Behavior Change

- Edge Cases page now loads successfully with large libraries (53K+ faces)
- Clustering and ungroupable-face detection now work at any library scale
- No change to results — only the transport mechanism differs
