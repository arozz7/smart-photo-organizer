# Implementation Plan: AI Model Upgrade & SAM Creative Tools

> [!NOTE]
> **Execution order:** Phase 1 (CLIP enhancement) first, then Phase 2 (SAM 3 service).

## Goal
Two parallel improvements to the Smart Photo Organizer:

1. **Enhanced CLIP Tagging** — Supercharge the existing CLIP pipeline in the web worker with expanded labels and multi-pass classification. Drop Coco-SSD.
2. **SAM 3 Creative Tools Service** — Build a model-agnostic segmentation microservice (defaulting to SAM 3) that powers interactive photo editing features: background removal, subject isolation, selective enhancement, and selective blur.

> [!IMPORTANT]
> Since this is an open-source project, AGPL/licensing restrictions are not a concern. However, the SAM service must be **model-agnostic** so future models (SAM 4, etc.) can be swapped in without rewriting the app.

---

## Phase 1: Enhanced CLIP Tagging Pipeline

### Summary
The web worker ([scanner.worker.ts](file:///j:/Projects/smart-photo-organizer/src/workers/scanner.worker.ts)) already uses `@xenova/transformers` CLIP for zero-shot scene classification with ~30 hardcoded labels, alongside Coco-SSD for object detection. We will:

1. Replace the hardcoded `CANDIDATE_LABELS` array with a multi-taxonomy label system
2. Implement multi-pass classification (broad scene → domain-specific)
3. Remove the Coco-SSD dependency entirely (CLIP subsumes its functionality)
4. Expose label taxonomy in config so users can customize

### Proposed Changes

---

#### [MODIFY] [scanner.worker.ts](file:///j:/Projects/smart-photo-organizer/src/workers/scanner.worker.ts)

**Changes:**
- Remove `@tensorflow-models/coco-ssd` import and all Coco-SSD logic
- Remove `cocoModel` variable and `cocoModel.detect()` call
- Replace `CANDIDATE_LABELS` with a structured `LABEL_TAXONOMY` object organized by category
- Implement `classifyScene()` — first pass with broad scene labels (15-20), then second pass with domain-specific labels based on top scene result
- Update `processImage()` to use the new classification flow
- Keep the `@vladmandic/human` face detection as-is (it works well)

**New label taxonomy structure:**
```typescript
const LABEL_TAXONOMY = {
  scenes: ['outdoor', 'indoor', 'portrait', 'landscape', 'macro', 'aerial', 'underwater', 'night', 'studio'],
  nature: ['forest', 'mountain', 'lake', 'river', 'ocean', 'beach', 'desert', 'snow', 'garden', 'waterfall', 'sunset', 'sunrise', 'sky', 'clouds', 'rainbow', 'stars'],
  urban: ['city', 'building', 'street', 'bridge', 'skyline', 'architecture', 'parking', 'store', 'restaurant', 'cafe'],
  interior: ['room', 'kitchen', 'bedroom', 'bathroom', 'office', 'classroom', 'gym', 'church', 'museum', 'library'],
  people: ['portrait', 'group photo', 'selfie', 'crowd', 'wedding', 'party', 'concert', 'sports', 'graduation', 'birthday'],
  animals: ['dog', 'cat', 'bird', 'horse', 'fish', 'rabbit', 'deer', 'bear', 'butterfly', 'insect', 'reptile'],
  objects: ['car', 'bicycle', 'motorcycle', 'boat', 'airplane', 'train', 'food', 'drink', 'flower', 'book', 'phone', 'computer', 'guitar', 'clock', 'sign'],
  activities: ['cooking', 'eating', 'dancing', 'swimming', 'hiking', 'reading', 'playing', 'running', 'cycling', 'shopping'],
  style: ['black and white', 'vintage', 'artistic', 'minimalist', 'abstract', 'panorama', 'long exposure'],
  mood: ['happy', 'peaceful', 'dramatic', 'romantic', 'mysterious', 'festive', 'cozy'],
};
```

---

#### [MODIFY] [package.json](file:///j:/Projects/smart-photo-organizer/package.json)

**Changes:**
- Remove `@tensorflow-models/coco-ssd` from dependencies
- Keep `@tensorflow/tfjs` (still needed by `@vladmandic/human`)

---

## Phase 2: SAM 3 Creative Tools Service

### Architecture

The SAM service is built as a **new route module** within the existing FastAPI app (same pattern as `api/routes/debug.py`). A model-agnostic `SegmentationProvider` interface ensures swappability.

```
┌──────────────────────────────────────────────────────────────────┐
│  Existing FastAPI Server (api/server.py)                         │
│                                                                  │
│  /api/v1/debug/*     ← existing debug routes                    │
│  /api/v1/status      ← existing status route                    │
│  /api/v1/segment/*   ← NEW segmentation routes                  │
│                                                                  │
│  ┌──────────────────────────────────────┐                        │
│  │  SegmentationProvider (Interface)     │                        │
│  │  ├── initialize()                     │                        │
│  │  ├── set_image(path) → embedding      │                        │
│  │  ├── predict_from_points(points)      │                        │
│  │  ├── predict_from_box(box)            │                        │
│  │  ├── predict_from_text(text)          │                        │
│  │  └── get_capabilities() → dict        │                        │
│  └────────────┬─────────────────────────┘                        │
│               │                                                  │
│    ┌──────────┼──────────┐                                       │
│    ▼          ▼          ▼                                       │
│  SAM3      SAM2       Future                                     │
│  Provider  Provider   Provider                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Proposed Changes

---

#### [NEW] [segmentation_provider.py](file:///j:/Projects/smart-photo-organizer/src/python/facelib/segmentation_provider.py)

Abstract base class defining the segmentation interface:
```python
class SegmentationProvider(ABC):
    @abstractmethod
    def initialize(self) -> None: ...
    
    @abstractmethod
    def set_image(self, image_path: str) -> str: ...  # returns session_id
    
    @abstractmethod
    def predict_from_points(self, session_id: str, points: list, labels: list) -> dict: ...
    
    @abstractmethod
    def predict_from_box(self, session_id: str, box: dict) -> dict: ...
    
    @abstractmethod
    def predict_from_text(self, session_id: str, text: str) -> dict: ...
    
    @abstractmethod
    def get_capabilities(self) -> dict: ...  # e.g., {"text_prompts": True, "video": False}
    
    @abstractmethod
    def cleanup(self) -> None: ...
```

---

#### [NEW] [sam3_provider.py](file:///j:/Projects/smart-photo-organizer/src/python/facelib/sam3_provider.py)

Concrete SAM 3 implementation of `SegmentationProvider`:
- Manages SAM 3 model loading (lazy init, GPU preference)
- Caches image embeddings per session to avoid recomputing
- Returns masks as base64-encoded PNGs for efficient IPC
- `get_capabilities()` returns `{"text_prompts": True, "video": True}`
- Checks for local checkpoint; raises clear error if not downloaded yet

---

#### [NEW] [segment.py](file:///j:/Projects/smart-photo-organizer/src/python/api/routes/segment.py)

FastAPI route module with these endpoints:

| Endpoint | Method | Description |
|---|---|---|
| `/api/v1/segment/capabilities` | GET | Returns model name and supported features |
| `/api/v1/segment/set-image` | POST | Loads image, precomputes embedding, returns session ID |
| `/api/v1/segment/predict` | POST | Runs segmentation from points/box/text prompt → returns mask |
| `/api/v1/segment/apply/background-remove` | POST | Applies transparent background using mask |
| `/api/v1/segment/apply/isolate` | POST | Extracts masked subject as separate image |
| `/api/v1/segment/apply/enhance` | POST | Applies GFPGAN/RealESRGAN to masked region only |
| `/api/v1/segment/apply/blur` | POST | Applies Gaussian blur to masked region (privacy) |

---

#### [MODIFY] [server.py](file:///j:/Projects/smart-photo-organizer/src/python/api/server.py)

**Changes:**
- Import and register the new `segment` router: `app.include_router(segment.router, prefix="/api/v1/segment", tags=["Segmentation"])`
- Add SAM model config to `get_api_config()` (model path, device preference)

---

#### [MODIFY] [config.py](file:///j:/Projects/smart-photo-organizer/src/python/config.py)

**Changes:**
- Add `segmentation` config section for model selection, device, cache settings

---

#### [MODIFY] [ai-config.json](file:///j:/Projects/smart-photo-organizer/ai-config.json)

**Changes:**
- Add `segmentation` block:
```json
{
  "segmentation": {
    "provider": "sam3",
    "model_checkpoint": "models/sam3",
    "device": "auto",
    "max_cached_sessions": 5
  }
}
```

---

#### [MODIFY] [requirements-gpu.txt](file:///j:/Projects/smart-photo-organizer/src/python/requirements-gpu.txt)

**Changes:**
- Add `sam3` (the pip-installable package from facebookresearch/sam3)

---

### SAM 3 Model Download Strategy

The SAM 3 checkpoint is ~10GB and **cannot be bundled in the GitHub release**. The app will handle this via on-demand download, leveraging the existing `ai:downloadModel` IPC pattern in [aiHandlers.ts](file:///j:/Projects/smart-photo-organizer/electron/ipc/aiHandlers.ts).

**How it works:**
1. When a user opens Creative Tools for the first time, the UI checks `/api/v1/segment/capabilities`
2. If the model is not downloaded, the response includes `{"model_ready": false, "download_size": "~10GB"}`
3. The UI shows a download prompt: *"SAM 3 model required (~10GB). Download now?"*
4. On confirmation, the Electron main process uses `ai:downloadModel` (same pattern as AI Runtime download) to fetch the checkpoint from HuggingFace with progress reporting
5. The checkpoint is stored in `models/sam3/` (gitignored)
6. Once downloaded, `/api/v1/segment/capabilities` returns `{"model_ready": true}`

**Files involved:**
- [MODIFY] `aiHandlers.ts` — Add `sam3` case to `ai:downloadModel` pointing to HuggingFace URL
- [MODIFY] `ai-config.json` — Add `segmentation.model_checkpoint` path config
- [MODIFY] `.gitignore` — Ensure `models/sam3/` is excluded

---

### HuggingFace Setup (Developer Only)

> [!IMPORTANT]
> This is only required for **you** (the developer) to test SAM 3 locally. End users will download via the in-app downloader.

**Steps:**
1. Go to [huggingface.co/facebook/sam3](https://huggingface.co/facebook/sam3) and click **"Request Access"**
2. Wait for approval (usually instant for open models)
3. Generate an access token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) → New Token → Read access
4. Run in your terminal:
```powershell
pip install huggingface_hub
huggingface-cli login
# Paste your token when prompted
```
5. The SAM 3 provider will auto-download the checkpoint on first use via `huggingface_hub`

---

## Phase 3: Frontend Integration (Future — not in this plan)

> [!NOTE]
> The frontend Creative Tools UI (React canvas with click-to-select, mask overlay, apply actions) is a separate phase. This plan focuses on the **backend service** that the frontend will consume. Once the backend API is working, we'll plan the frontend in a follow-up.

---

## Verification Plan

### Phase 1 Verification (CLIP Enhancement)

#### Existing tests
- No existing unit tests for `scanner.worker.ts` were found — the web worker runs in a browser context.

#### Manual Verification
1. **Build check** — Run `npm run build` to verify the worker compiles without errors after removing Coco-SSD.
2. **Browser test** — Launch the app (`npm run dev`), scan a folder of test photos, and verify:
   - Tags are generated (visible in photo details panel)
   - Tags cover a wider range than before (check for taxonomy coverage)
   - No console errors related to model loading
3. **Regression check** — Verify face detection still works (it uses `@vladmandic/human`, which is independent of this change)

### Phase 2 Verification (SAM Service)

#### Unit Tests
Tests will follow the established pattern in [test_api.py](file:///j:/Projects/smart-photo-organizer/tests/python/unit/test_api.py) using FastAPI `TestClient` with mocked providers.

New test file: `tests/python/unit/test_segment_api.py`

| Test | Description |
|---|---|
| `test_capabilities_returns_model_info` | GET `/segment/capabilities` returns provider name and features |
| `test_set_image_returns_session_id` | POST `/segment/set-image` with valid image returns a session ID |
| `test_set_image_invalid_path_returns_404` | POST `/segment/set-image` with nonexistent path returns 404 |
| `test_predict_from_points_returns_mask` | POST `/segment/predict` with point coords returns base64 mask |
| `test_predict_from_box_returns_mask` | POST `/segment/predict` with box coords returns base64 mask |
| `test_predict_from_text_returns_mask` | POST `/segment/predict` with text prompt returns mask (SAM 3 only) |
| `test_predict_invalid_session_returns_404` | POST `/segment/predict` with bad session ID returns 404 |
| `test_background_remove_returns_png` | POST `/segment/apply/background-remove` returns transparent PNG |
| `test_blur_applies_to_masked_region` | POST `/segment/apply/blur` returns image with blurred region |

**Run command:**
```powershell
cd j:\Projects\smart-photo-organizer
python -m pytest tests/python/unit/test_segment_api.py -v
```

New test file: `tests/python/unit/test_segmentation_provider.py`

| Test | Description |
|---|---|
| `test_provider_interface_enforced` | Verify ABC prevents instantiation without implementing all methods |
| `test_mock_provider_implements_interface` | A `MockProvider` can be created and used by the routes |
| `test_provider_capabilities_schema` | `get_capabilities()` returns expected keys |

**Run command:**
```powershell
cd j:\Projects\smart-photo-organizer
python -m pytest tests/python/unit/test_segmentation_provider.py -v
```

#### Manual Verification (SAM 3 Integration)

> [!IMPORTANT]
> SAM 3 requires a GPU and a ~10GB model download. Unit tests will mock the provider. End-to-end testing with the real SAM 3 model requires manual verification on a machine with a compatible GPU.

1. Start the API server: `$env:API_MODE = "http"; python src/python/main.py`
2. Open Swagger UI at `http://localhost:3001/docs`
3. Test `/api/v1/segment/capabilities` — should show SAM 3 info
4. Test `/api/v1/segment/set-image` with a real photo path
5. Test `/api/v1/segment/predict` with point coordinates from the photo
6. Verify the returned mask by decoding the base64 PNG and visually inspecting
