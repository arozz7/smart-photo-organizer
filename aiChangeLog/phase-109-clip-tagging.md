# Phase 109 — Enhanced CLIP Tagging

## Summary
Upgraded the scanner web worker's tagging pipeline. Dropped `@tensorflow-models/coco-ssd` and `@tensorflow-models/mobilenet` (both unused after this change) and replaced the old flat `CANDIDATE_LABELS` array with a structured multi-taxonomy label system backed by a two-pass CLIP classification strategy.

---

## Files Modified
| File | Change |
|---|---|
| `src/workers/scanner.worker.ts` | Removed Coco-SSD import/logic; added `LABEL_TAXONOMY`; implemented two-pass `classifyScene` flow in `processImage` |
| `package.json` | Removed `@tensorflow-models/coco-ssd` and `@tensorflow-models/mobilenet` (both unused) |

---

## Completed Tasks
- [x] Initialized Phase 109 changelog
- [x] Removed `@tensorflow-models/coco-ssd` from `package.json`
- [x] Removed `@tensorflow-models/mobilenet` from `package.json` (also unused)
- [x] Removed all Coco-SSD object detection logic from `scanner.worker.ts`
- [x] Implemented `LABEL_TAXONOMY` with ~90 labels across 10 categories
- [x] Implemented two-pass classification in `processImage`:
  - Pass 1: broad category scoring (`nature`, `urban`, `interior`, `people`, `animals`, `objects`)
  - Pass 2: fine-grained labels from top 2 categories + always-on `scenes`, `style`, `mood`
- [x] Cleaned up stale `// We use COCO-SSD for now` comment in `humanConfig`

---

## Behavior

### `LABEL_TAXONOMY`
Ten categories, ~90 total labels:

| Category | Purpose |
|---|---|
| `scenes` | Always tested — broad photo context (outdoor, indoor, portrait, night…) |
| `nature` | Tested if `nature` is a top broad category |
| `urban` | Tested if `urban` is a top broad category |
| `interior` | Tested if `interior` is a top broad category |
| `people` | Tested if `people` is a top broad category |
| `animals` | Tested if `animals` is a top broad category |
| `objects` | Tested if `objects` is a top broad category |
| `activities` | Tested if `activities` is a top broad category |
| `style` | Always tested — photographic style (vintage, B&W, panorama…) |
| `mood` | Always tested — emotional tone (happy, peaceful, dramatic…) |

### Two-pass Classification Flow
1. **Pass 1** — CLIP scores the 6 broad categories; top 2 above 0.15 are selected.
2. **Pass 2** — Labels from `scenes` + `style` + `mood` (always) plus the top broad-category label sets are pooled into a single candidate list (~40–60 labels). CLIP scores all of them; any above 0.15 confidence threshold become tags on the photo.

### Tag Quality Improvement
- Before: ~30 hardcoded labels, flat list, no scene context
- After: up to ~60 contextually-selected labels per photo, taxonomy-aware

---

## Assumptions & Notes
- `@tensorflow/tfjs` is retained — still required by `@vladmandic/human` for face detection.
- The 0.15 score threshold (Pass 1 category selection and Pass 2 tag acceptance) is the same value used before. Users with very sparse libraries may want to tune this downward; it can be exposed as a config option in a future phase.
- No unit tests added — `scanner.worker.ts` runs in a browser Worker context and has no existing test harness. Manual verification via scan is the acceptance criterion.
