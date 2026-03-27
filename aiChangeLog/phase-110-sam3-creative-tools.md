# Phase 110 — SAM 3 Creative Tools Backend Service

## Summary
Builds a model-agnostic segmentation microservice using SAM 3 (facebook/sam3 via
HuggingFace Transformers). New FastAPI routes sit inside the existing server alongside
the debug and status routes. A `SegmentationProvider` ABC ensures future models
(SAM 4, etc.) can be swapped in by adding a single new provider class and changing
one config value.

---

## Files Created

| File | Purpose |
|---|---|
| `src/python/facelib/segmentation_provider.py` | ABC — defines the 7-method provider interface |
| `src/python/facelib/sam3_provider.py` | SAM 3 concrete implementation |
| `src/python/api/routes/segment.py` | 7 FastAPI endpoints under `/api/v1/segment/` |
| `tests/python/unit/test_segmentation_provider.py` | 4 ABC enforcement tests |
| `tests/python/unit/test_segment_api.py` | 13 API endpoint tests (MockSegmentationProvider) |

## Files Modified

| File | Change |
|---|---|
| `src/python/api/server.py` | Imported `segment` router; registered at `/api/v1/segment` |
| `src/python/config.py` | Added `segmentation` defaults section to `load_ai_config()` |
| `ai-config.json` | Added `"segmentation"` block |
| `electron/ipc/aiHandlers.ts` | Added `sam3` case to `ai:downloadModel` → `hf://facebook/sam3` |
| `src/python/commands/utilities.py` | Added `hf://` download branch using `huggingface_hub.snapshot_download` |

---

## Architecture

### SegmentationProvider ABC (`segmentation_provider.py`)
Seven abstract methods define the full interface:

| Method | Description |
|---|---|
| `initialize()` | Load model weights (lazy, called on first use) |
| `set_image(path)` | Load PIL Image into session cache → `session_id` |
| `get_session_image(session_id)` | Retrieve cached image for apply operations |
| `predict_from_text(session_id, text)` | SAM 3 text prompt → masks |
| `predict_from_box(session_id, box)` | Bounding-box prompt → masks |
| `predict_from_points(session_id, points, labels)` | Click-point prompt → masks |
| `get_capabilities()` | Model info dict |
| `cleanup()` | Release models + clear session cache |

### Sam3Provider (`sam3_provider.py`)
- **Text + box prompts**: `Sam3Model` + `Sam3Processor` → `post_process_instance_segmentation`
- **Point prompts**: `Sam3TrackerModel` + `Sam3TrackerProcessor` → `post_process_masks`
- Both model pairs loaded lazily from local checkpoint (`models/sam3`)
- GPU auto-detected via `torch.cuda.is_available()`; falls back to CPU
- Session cache: max 5 entries, LRU eviction (oldest `created_at` removed when full)
- Mask output: boolean numpy → grayscale PNG → base64 string

### API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/v1/segment/capabilities` | GET | Provider name, `model_ready`, `text_prompts`, `video` |
| `/api/v1/segment/set-image` | POST | Load image → `{ session_id }` |
| `/api/v1/segment/predict` | POST | Text / box / points → `{ masks: [{mask_b64, score, area}] }` |
| `/api/v1/segment/apply/background-remove` | POST | Transparent PNG with non-mask pixels cleared |
| `/api/v1/segment/apply/isolate` | POST | Subject cropped to mask bounding box, transparent background |
| `/api/v1/segment/apply/blur` | POST | Gaussian blur over masked region (`radius` param, default 15) |
| `/api/v1/segment/apply/enhance` | POST | Unsharp-mask sharpening over masked region (`strength` param) |

### Dependency Injection
`get_provider()` is a FastAPI `Depends` function returning the module-level singleton.
Tests override it via `app.dependency_overrides[get_provider] = lambda: MockProvider()`.

---

## Model Download Flow (for new users)
1. User opens Creative Tools → UI calls `GET /api/v1/segment/capabilities`
2. If `model_ready: false`, UI prompts: *"SAM 3 model required. Download now?"*
3. On confirm, Electron calls `ai:downloadModel` with `modelName: "sam3"`
4. `aiHandlers.ts` sets `url = "hf://facebook/sam3"` and delegates to Python
5. `utilities.py` detects `hf://` prefix → calls `huggingface_hub.snapshot_download`
6. Model checkpoint saved to `models/sam3/` (already gitignored via `models/`)
7. Requires prior `huggingface-cli login` (SAM 3 is a gated HuggingFace model)

---

## Tests

### `test_segmentation_provider.py` (4 tests)
1. `test_abc_cannot_be_instantiated_directly`
2. `test_incomplete_subclass_cannot_be_instantiated`
3. `test_complete_subclass_can_be_instantiated`
4. `test_capabilities_schema_has_required_keys`

### `test_segment_api.py` (13 tests — no real SAM 3 model loaded)
| Class | Tests |
|---|---|
| `TestCapabilitiesEndpoint` | capabilities returns model info |
| `TestSetImageEndpoint` | valid path returns session_id, 404 for missing, 400 for bad extension |
| `TestPredictEndpoint` | text/box/points all return masks, 404 for bad session, 400 for no prompt |
| `TestApplyEndpoints` | background-remove, blur, isolate all return result_b64; 404 for bad session |

---

## Assumptions & Notes
- `transformers` was already in `requirements-gpu.txt` — no new pip dependency needed.
- `huggingface_hub` is automatically available as a `transformers` transitive dependency.
- `_do_enhance` uses PIL `UnsharpMask` as the initial implementation. Full GFPGAN/RealESRGAN
  integration over a masked region is deferred to a follow-on phase.
- `Sam3TrackerModel.predict_from_points` does not return per-mask confidence scores;
  all point-prompt masks are assigned `score: 1.0` as a placeholder.
- The frontend Creative Tools canvas UI (React) is a separate follow-on phase.
  This phase delivers the backend service only.
