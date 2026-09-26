# Phase 122 — Fix model path resolution for AI Runtime installs

## Summary
Fixed a real bug in Phase 121's SAM 3 migration (and a pre-existing one affecting AdaFace) where model checkpoint paths were resolved relative to the wrong base directory, causing both the "Manage Models" status panel and the actual segmentation provider to report models as missing even when the user had correctly downloaded and extracted the AI GPU Runtime.

## How this was found
User report after downloading the AI Runtime and extracting it to `<LIBRARY_PATH>/ai-runtime`: AdaFace and SAM 3 both showed "Download" needed in the Manage Models panel despite `models/sam3.pt`, `models/adaface_ir50_webface4m.onnx`, etc. all being present under `<LIBRARY_PATH>/ai-runtime/models/`. AdaFace's download button additionally failed with a 401 from its (apparently stale or gated) source URL.

## Root cause
Two independent bugs, same shape:
1. **`facelib/utils.py`'s status-check function** (`models_root = os.path.dirname(__file__)/../models`) resolves relative to the Python module's own location, which in a packaged/PyInstaller build has no `models/` sibling directory at all — it never looks at `AI_RUNTIME_PATH` (`<LIBRARY_PATH>/ai-runtime`), which is where the downloaded runtime actually extracts model weights.
2. **`Sam3PackageProvider`/`Sam3TransformersProvider`'s checkpoint resolution** (`Path(self._checkpoint).resolve()`, introduced in Phase 121) resolves the configured relative path (`models/sam3.pt`) against the process's current working directory only — also never checking `AI_RUNTIME_PATH`. This is a functional bug, not just a UI cosmetic one: if CWD doesn't happen to contain a `models/` folder, segmentation actually fails to load in a packaged install, not just the status badge.

`facelib/adaface.py`'s `init_adaface()` already had the correct fallback pattern (try the path as configured, then the same relative path under `AI_RUNTIME_PATH`) — it just wasn't applied to the SAM 3 providers when they were written, and the separate Manage-Models status-check function never had it either.

## Fix
- Added `facelib/utils.py:resolve_model_path(relative_path)` — the same "try as-is, then try under AI_RUNTIME_PATH" pattern as `adaface.py`, as a reusable helper.
- `Sam3PackageProvider.initialize()` and `.get_capabilities()` (`sam3_provider.py`) now resolve `self._checkpoint` through `resolve_model_path()` before checking/loading.
- `Sam3TransformersProvider.initialize()` and `.get_capabilities()` (`sam3_provider_transformers.py`) — same fix.
- The Manage Models status-check function (`facelib/utils.py`) now checks both the dev-relative `models_root` and `AI_RUNTIME_PATH/models` for AdaFace and all three SAM 3 checkpoint layouts (`sam3.pt`, `sam3/` dir, `sam3_model.safetensors`), via a small `_first_existing()` helper.

`adaface.py` itself was left untouched — its existing fallback logic was already correct; only the parallel, out-of-sync status-check copy of that logic needed fixing.

## Not fixed (separate, lower-priority issue)
AdaFace's download button uses `https://huggingface.co/mk-minchul/adaface/resolve/main/adaface_ir50_webface4m.onnx`, which returns 401 Unauthorized — likely a stale or gated URL (research this session found the real upstream repos under a different username, `minchul/cvlface_adaface_ir50_ms1mv2` and `minchul/cvlface_adaface_ir101_webface4m`, storing weights as `.safetensors`, not `.onnx`). Not changed here since a correct replacement ONNX source wasn't verified — this only matters for a user who skips the full AI Runtime download and tries to fetch AdaFace individually; anyone with the full runtime already has the file, and with this phase's fix, the app now correctly recognizes it.

## Verification
- `resolve_model_path()`: unit-verified against a synthetic `AI_RUNTIME_PATH` pointing at a location where the CWD-relative path doesn't exist but the AI_RUNTIME_PATH-relative one does — resolves correctly.
- `Sam3PackageProvider.get_capabilities()`: run with CWD containing no `models/` folder and `AI_RUNTIME_PATH` overridden to point at the real checkpoint's location — returns `model_ready: true`, confirming the fallback engages end-to-end through the real provider class, not just the helper in isolation.

## Assumptions & Risks
- Did not verify against the user's actual packaged install (only simulated the CWD/AI_RUNTIME_PATH mismatch locally) — worth confirming the next packaged build resolves the two model badges correctly on their machine.
