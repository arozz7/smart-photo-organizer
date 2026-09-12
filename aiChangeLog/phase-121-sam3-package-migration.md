# Phase 121 — Migrate SAM 3 to Meta's official `sam3` package (dual-provider: GPU + CPU fallback)

## Summary
Added `Sam3PackageProvider` (`src/python/facelib/sam3_provider.py`), a rewrite using Meta's own `sam3` package (`facebookresearch/sam3`) instead of the community `transformers` SAM 3 integration — fixing the root cause behind Phase 120's failed SAM 3.1 attempt and removing a fragile tracker-weight remap hack. Deliberately targets the **base SAM 3** checkpoint, not 3.1 — see "Why not 3.1" below.

**Mid-implementation finding: Meta's `sam3` package has a real CPU bug.** Testing surfaced a device-handling bug in the package's text/exemplar (PCS) prompt path — a hardcoded CUDA reference independent of the `device` parameter passed to `build_sam3_image_model()` — that breaks on CPU-only machines. Since this app previously supported CPU-only segmentation (via `transformers`) and preserving that was the whole reason base SAM 3 was chosen over the GPU-only SAM 3.1 path, this became a dual-provider design: the original `transformers`-based implementation was restored as `Sam3TransformersProvider` (`sam3_provider_transformers.py`) and kept as the CPU fallback. A new `segmentation_factory.py` picks between them based on `torch.cuda.is_available()` (or an explicit `device` override in `ai-config.json`). Both call sites (`api/routes/segment.py`, `commands/segmentation.py`) now go through `create_segmentation_provider(cfg)` instead of instantiating a provider class directly.

## Why the previous integration had to go
Phase 120 found that `facebook/sam3.1`'s checkpoint wouldn't load through `transformers.Sam3Model`/`Sam3TrackerModel` — its weights use Meta's own internal module naming, not the `transformers` reimplementation's naming. Reading Meta's actual `facebookresearch/sam3` source this phase confirmed the base `facebook/sam3` checkpoint has the same mismatch: the officially correct way to load either checkpoint is Meta's own `sam3` pip package, not `transformers`.

## Why not SAM 3.1
SAM 3.1's actual improvement (`Sam3MultiplexVideoPredictor`, a faster shared-memory multi-object *video* tracker) doesn't apply here — Creative Tools segments one photo at a time and `get_capabilities()` already reports `video: False`. That predictor also hardcodes a CUDA bf16 autocast in `__init__` with no CPU path, which would regress CPU-only users. Base SAM 3 via the `sam3` package's single-image API (`build_sam3_image_model` + `Sam3Processor` + `predict_inst`) covers every prompt type this app uses, runs on CPU or GPU like before, and required zero PyTorch upgrade (works fine on the existing `torch==2.5.1+cu121`).

## What changed

### `src/python/facelib/segmentation_factory.py` — new
`create_segmentation_provider(cfg)`: returns `Sam3PackageProvider` when CUDA is available (or `device: "cuda"` is forced in config), else `Sam3TransformersProvider`. The only thing callers should import going forward.

### `src/python/facelib/sam3_provider_transformers.py` — new (restored from git history)
The pre-Phase-120 `transformers`-based implementation, unmodified except renaming the class to `Sam3TransformersProvider` and updating its docstring to explain why it's kept (CPU fallback). Reads `segmentation.model_checkpoint_cpu` from config.

### `src/python/api/routes/segment.py`, `src/python/commands/segmentation.py`
Both `get_provider()`/`_get_provider()` singleton factories now call `create_segmentation_provider(cfg)` instead of instantiating `Sam3Provider` directly.

### `src/python/facelib/sam3_provider.py` — new `Sam3PackageProvider` (GPU path)
- `initialize()` now calls `sam3.model_builder.build_sam3_image_model(checkpoint_path=..., enable_inst_interactivity=True)` + `Sam3Processor(model)` — one call loads detector and interactive predictor from a single checkpoint file. The old `_load_tracker()` prefix-remap method is gone entirely; not needed anymore.
- `set_image()` now precomputes and caches `Sam3Processor.set_image()`'s `inference_state` per session (previously the old code recomputed image embeddings on every single predict call). Real performance win: image embedding is the expensive part.
- `predict_from_text` / `predict_from_text_with_exclusions` / `predict_from_exemplar` → `Sam3Processor.set_text_prompt()` / `.add_geometric_prompt(box, label, state)` (PCS/concept prompts). `reset_all_prompts()` is called before each of these to keep calls independent (the underlying state object is otherwise stateful/cumulative across prompt calls).
- `predict_from_box` / `predict_from_points` / `predict_from_box_and_points` → `model.predict_inst(state, point_coords=, point_labels=, box=, multimask_output=False)`, Meta's SAM1/2-style interactive API. **`predict_from_box_and_points` now natively combines both prompt types in one model call** — the old ROI-mask-constraint fallback (`_predict_points_via_box`, ~40 lines) is deleted; it existed only to work around the old tracker API not accepting box+points together.
- `get_capabilities()` checks `importlib.util.find_spec("sam3")` instead of a `transformers.Sam3Model` hasattr check; `_INSTALL_CMD` updated.

### `models/`
- Added `models/sam3.pt` (base SAM 3 checkpoint from `facebook/sam3`, ~3.5GB). `models/` stays gitignored.
- `models/sam3_model.safetensors`, `models/config.json`, and sibling tokenizer files from the old `transformers`-based checkpoint are now unused and were left in place (not deleted per the project's no-deletion rule) — safe to remove manually to reclaim ~3.2GB.

### `ai-config.json`, `src/python/config.py`
Added `segmentation.model_checkpoint_cpu` (`models/sam3_model.safetensors`, used by `Sam3TransformersProvider`) alongside the existing `segmentation.model_checkpoint` (now `models/sam3.pt`, used by `Sam3PackageProvider`).

### `scripts/build-runtime.js`
Added `sam3` and its undeclared transitive runtime dependencies (`timm`, `einops`, `triton`, `ftfy`, `iopath`, `portalocker`, `pycocotools`) to `heavyPackages` so they ship in `ai-runtime-win-x64.zip`. `scripts/build-python.js`'s PyInstaller exclude-list was deliberately left unchanged — `sam3`, like `transformers`, doesn't need explicit exclusion since it's already unusable without `torch`, which is excluded.

### Environment (this venv only — not yet reflected in any requirements file, matching the existing convention of `transformers` being a manually-installed heavy dependency)
```
pip install git+https://github.com/facebookresearch/sam3.git
pip install einops triton-windows pycocotools
```
Notes for whoever sets up a new machine:
- `triton-windows` (not `triton` — mainline `triton` has no Windows wheels on PyPI) installs as the `triton` package; `sam3`'s tracker module hard-imports it at module load time even for CPU inference paths that never use it.
- `einops` and `pycocotools` are real runtime dependencies `sam3`'s own package metadata doesn't declare — import fails without them.
- Installing `sam3` downgrades `numpy` from 2.2.6 → 1.26.4 (pip reports a version conflict with `opencv-python`'s `numpy>=2` requirement). Verified this doesn't break anything at runtime: `cv2.resize`, `insightface`, and `onnxruntime` all still work correctly on `numpy==1.26.4`.

## Verification
Manual smoke test against `docs/assets/PeopleUnnamedSuggestion.png`, all paths returning non-empty masks with plausible scores:

**GPU path (`Sam3PackageProvider`, this dev machine's real CUDA GPU):**
- `get_capabilities()` → `model_ready: true`
- text prompt: 10 masks, scores 0.53–0.93
- text + negative-box exclusion (verified against a *real* detected box, not a throwaway corner): baseline 10 masks → 7 masks after exclusion — confirms exclusions genuinely remove specific instances
- exemplar (positive box, no text): 2 masks
- box-only: 1 mask, score 0.32
- points-only: 1 mask, score 0.36
- box+points combined: 1 mask, score 0.62 (higher than either alone — the combined prompt is doing real work, not just falling back to one or the other)

**CPU path (`Sam3TransformersProvider`), verified via `torch.cuda.is_available = lambda: False`** (a rigorous simulation — an initial attempt using `CUDA_VISIBLE_DEVICES=""` was unreliable and produced a false-positive crash unrelated to this code):
- `segmentation_factory.create_segmentation_provider()` correctly routes to `Sam3TransformersProvider` when no CUDA is available
- text prompt: 9 masks, `model_ready: true` — confirms the pre-existing `transformers`-based path (restored unmodified) still works correctly as the CPU fallback

**Confirmed real bug in Meta's `sam3` package**, isolated via three test iterations: `Sam3PackageProvider.predict_from_text` on a CPU-only simulated environment (with `sam3` importing successfully — ruling out the package being CUDA-only at import time) throws `Expected all tensors to be on the same device, but found at least two devices, cuda:0 and cpu!` from inside `Sam3Processor._forward_grounding()` → `model.forward_grounding()`. This is Meta's own bug, not something fixable from this codebase without patching their package.

## Assumptions & Risks
- `triton-windows` is a community-maintained fork, not an official Meta or PyTorch package — worth monitoring for compatibility if `sam3` or `torch` versions change later. Only relevant to the GPU path.
- If Meta fixes the CPU device bug in a future `sam3` release, `segmentation_factory.py`'s CPU branch could be simplified back to a single provider — worth revisiting then rather than maintaining two implementations indefinitely.
- `Sam3TransformersProvider` still carries the same `predict_from_box_and_points` ROI-constraint fallback and tracker-weight remap hack as before (Phase 121 didn't touch this file's internals, only renamed the class and updated its docstring) — those quirks are pre-existing, not new.
