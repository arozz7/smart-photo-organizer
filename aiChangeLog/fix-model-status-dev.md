# Fix — AI model status reported "missing" in a dev checkout

## Summary
In a source (dev) checkout, Settings -> AI Models showed the GPU runtime, AdaFace and SAM 3 as missing (with multi-GB **Download** buttons) even though they were installed and in use. Nothing was actually missing; the status check was looking in the wrong places. No download or manual setup is needed for dev.

## Root causes
1. **GPU runtime card** was a pure "does `<library>/ai-runtime` exist?" check. A dev checkout gets CUDA PyTorch from its own virtualenv (here: torch 2.5.1+cu121 on an RTX 4070 Ti SUPER) and never has that folder.
2. **AdaFace and SAM 3 cards** searched `src/python/models` and `<runtime>/models`. The loaders (`resolve_model_path`) look in the `models/` folder of the **current directory** first (the repo root in dev, e.g. `Loading SAM 3 from J:\...\models on cuda` in `python.log`), then the runtime. The status used a different search order than the code that actually loads the files.

## Changes
- `facelib/utils.py` `get_model_status`: new optional `torch_cuda_ready` argument. The GPU runtime card is Ready when the runtime folder exists **or** CUDA PyTorch is already usable in the process, with a note ("Using CUDA PyTorch from the Python environment"). The download location and URL are unchanged.
- `facelib/utils.py`: AdaFace and SAM 3 (`sam3.pt`, `sam3/`, `sam3_model.safetensors`) now also check `./models` (current directory) first, matching the loaders. The previous candidates are kept, so nothing that worked before is lost.
- `commands/utilities.py` `get_system_status`: determines CUDA availability once (guarded) and passes it in.

## Tests added
`tests/python/unit/test_model_status.py` (7): runtime folder present; CUDA PyTorch without a folder (Ready + note); neither (still offers the download, correct path); URL/path unchanged when ready via the environment; models found in the current directory (with size); models found in the runtime; genuinely missing models still reported missing.

## Verification
- Python suite: 190 passing.
- Real check against the actual dev library (`H:\DevWork\smart-photo-organizer`) with the dev virtualenv: GPU runtime, AdaFace, SAM 3, SmolVLM2, Buffalo_L, RealESRGAN_x4plus and GFPGANv1.4 all **Ready**. A PROD-style library (with `ai-runtime`) still reports Ready, run from a different working directory.
- Not changed: `RealESRGAN_x4plus_anime_6B` (optional anime upscaler, ~18 MB) is genuinely not installed in dev; use its Download button in Settings if wanted.

## Related observation (not changed)
`[Protocol] Transform failed for ... .CR2` warnings with `tiff2vips: Old-style JPEG compression support is not configured` are expected noise, not a fault. When a RAW photo is viewed at high quality the image protocol deliberately skips the stored preview, tries libvips on the original (which cannot decode some Canon CR2 / Sony ARW variants), logs the warning, and then falls back to the Python decoder, which succeeds. The same warnings appear in March logs, before the Phase 128/129 work.
