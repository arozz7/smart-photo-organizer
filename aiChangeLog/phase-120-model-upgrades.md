# Phase 120 — AI Model Upgrades (SmolVLM2 adopted, SAM 3.1 deferred)

## Summary
Evaluated two model upgrades: SmolVLM → SmolVLM2 (adopted) and SAM 3 → SAM 3.1 (deferred — checkpoint format incompatible with the current `transformers` integration).

## SmolVLM2 — Adopted

### Files Modified
- `src/python/facelib/vlm.py` — `init_vlm()` now loads `HuggingFaceTB/SmolVLM2-2.2B-Instruct` (was `HuggingFaceTB/SmolVLM-Instruct`) via both the `AutoModelForImageTextToText` path and the older-transformers `AutoModelForVision2Seq` fallback. Same ~2.2B size class as before — a version upgrade, not a size change.
- `src/python/main.py`, `src/python/facelib/utils.py` — "Manage Models" status checks (`models_info["SmolVLM-Instruct"]` → `"SmolVLM2-2.2B-Instruct"`) now point at the new HF cache path (`models--HuggingFaceTB--SmolVLM2-2.2B-Instruct`), otherwise the app would report the model as "not downloaded" after the upgrade.
- `src/python/commands/utilities.py` — status response `'model'` field updated to `'SmolVLM2-2.2B-Instruct'`.
- `src/python/requirements.txt` — added `num2words`, a hard runtime dependency of the SmolVLM2 processor (`AutoProcessor.from_pretrained` raises `ImportError` without it — not needed by SmolVLM v1).
- `README.md` — three mentions of "SmolVLM" updated to "SmolVLM2".

### Verification (manual smoke test, matches how this pipeline is validated elsewhere)
- `generate_captions()` on a real screenshot produced a coherent description and tag list (tag-extraction fell back to its existing heuristic path since the model's raw output didn't include a literal "Tags:" line for this particular image — pre-existing parsing behavior in `vlm.py`, unrelated to the model swap, not something this phase changed).
- `verify_is_face()` on a real face crop returned `{'is_face': True, 'confidence': 0.968, 'reason': 'A human is present in the picture (object: person)', 'suggested_metadata': {'gender': 'M', 'age': 30}}` — correct classification with sane confidence and evidence.

## SAM 3.1 — Deferred

### What was tried
Downloaded `facebook/sam3.1`'s `sam3.1_multiplex.pt` checkpoint and attempted to load it through the existing `transformers` `Sam3Model` / `Sam3TrackerModel` classes in `src/python/facelib/sam3_provider.py`, per the approved plan's "try the existing integration first" path.

### Why it failed
- The checkpoint is a raw PyTorch state dict (`.pt`), not `model.safetensors` — first had to be converted, and 32 RoPE `freqs_cis` buffers (complex64, derived from `rope_theta` at model init, not present in the current SAM 3 checkpoint either) had to be dropped since `safetensors` doesn't support complex dtypes.
- After conversion, `Sam3Model.from_pretrained()` reported almost the entire model as **MISSING** (`vision_encoder.*`, `mask_decoder.*`, `prompt_encoder.*` all randomly initialized) while the checkpoint's actual weights sat under **UNEXPECTED** keys (`detector.*`, `tracker.model.*`). A test `predict_from_box()` call returned zero masks, confirming the model did not actually load real weights.
- Root cause: the `facebook/sam3.1` "multiplex" checkpoint is packaged for Meta's own `sam3` pip package (`facebookresearch/sam3`, its own `build_sam3_image_model`/`Sam3Processor`), which uses a different internal module-naming scheme than the HF `transformers` SAM 3 integration this codebase depends on. This isn't a simple key-prefix remap (like the existing tracker-weight remap in `_load_tracker()`) — the submodule structure itself differs between the two implementations.

### Outcome
No code or checkpoint changes made. `models/sam3_model.safetensors` and `sam3_provider.py` are unchanged; the app continues running SAM 3 (not 3.1). Per the approved plan, migrating to Meta's own `sam3` package (a much larger rewrite of `sam3_provider.py`, new pip dependency, PyTorch 2.10+/CUDA 12.8 requirement) was explicitly out of scope for this phase and needs a separate go-ahead.

## Assumptions & Risks
- SmolVLM2-2.2B-Instruct is a larger/slower model than the smaller 256M/500M SmolVLM2 variants; this phase kept the same size class as the outgoing model to isolate the version upgrade from any speed/quality tradeoff. A future phase could evaluate the 500M variant for faster bulk tagging.
- The SAM 3.1 checkpoint (3.5GB, downloaded to `build-temp/sam31-staging/` during evaluation) was deleted after the failed load — nothing persisted since `models/` and `build-temp/` are both gitignored.
