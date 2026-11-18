# Chore: slimmer AI runtime zip and a reproducible runtime environment

**Branch:** `chore/runtime-packaging-cleanup` (from `main` at 0.8.4). Tooling only; no app behaviour change, no version bump.

## What is in the runtime, and what has to ship
Checked on 2026-11-18 (see the investigation in this session):
- **Cannot be downloaded by users, so it must ship:** SAM 3 weights (`sam3.pt`, 3.3 GiB; Hugging Face `facebook/sam3` is gated, HTTP 401)
  and the AdaFace ONNX model (`adaface_ir50_webface4m.onnx` + `.data`, 166 MiB; the old download URL returns 401 and the
  upstream repos publish `.safetensors`, not ONNX). Whether Meta's SAM license allows redistribution in a public release has not been checked.
- **Public downloads (not in the zip, or not needed in it):** GFPGAN and RealESRGAN weights (GitHub releases), SmolVLM2 (Hugging Face,
  fetched on first use), Buffalo_L (insightface downloads it).
- **Public, but only through pip, so shipped prebuilt:** torch/CUDA/TensorRT/NVIDIA libraries and the other heavy Python packages.

## Changes
1. **Leave the duplicate `model.safetensors` out of the zip** (`scripts/build-runtime.js`, logic in `scripts/lib/runtime-model-files.cjs`).
   It is a byte-identical copy of `sam3_model.safetensors` (verified with a byte compare) that the CPU SAM 3 provider creates by itself on
   first load (`facelib/sam3_provider_transformers.py`, "copy if needed"). It is skipped only when `sam3_model.safetensors` is present.
   Saves 3.20 GiB: the `models/` input drops from 9.79 to 6.58 GiB (the v0.8.1 zip was 14.5 GiB in 10 parts). Nested files are untouched.
   Consequence: the first time the CPU SAM provider loads, it writes that 3.2 GiB copy into `ai-runtime\models` (needs the disk space).
2. **`src/python/requirements-runtime.txt`**: the heavy packages pinned to the exact versions in the venv the runtime is built from
   (35 pins; `transformers` 5.3.0.dev0 at GitHub commit `3a3b59c`, `sam3` at commit `660a5e9`, torch 2.5.1+cu121 from the PyTorch CUDA 12.1 index).
   Before this, nothing in the repo recorded how to rebuild the runtime. Every pin was checked against the installed versions; a from-scratch
   install was **not** done (more than 10 GB).
3. README "Releasing" notes both.

## Tests
`tests/backend/unit/runtimeModelFiles.test.ts` (5). The builder's copy code was also run on a stand-in folder tree: the top-level duplicate is left out,
a nested file of the same name and all other files are copied. (That run caught a path-separator bug in my first filter; fixed with `path.resolve`.)
A full `npm run build:runtime` was not run (copies and zips more than 10 GB).

## Not done: optional separate CPU-SAM download
Making the CPU SAM 3 files (`sam3_model.safetensors` and the config/tokenizer files, about 3.2 GiB) a separate optional download would save a
further 3.2 GiB for GPU users, but it needs a new release asset, a new card in the Manage Models dialog and status/download handling. Proposed separately.
