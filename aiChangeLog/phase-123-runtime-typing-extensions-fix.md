# Phase 123 — Fix missing typing_extensions in AI Runtime bundle

## Summary
`torch` could not be imported at all from the downloaded AI GPU Runtime — a hard, silent failure that would break every torch-dependent feature (SAM 3 GPU path, VLM/SmolVLM2, Real-ESRGAN/GFPGAN enhancement) for any user who downloaded and installed the runtime.

## How this was found
Investigating a user report of a blank/frozen screen when opening Settings → Manage Models (which calls `get_system_status()`, and that function calls `utils.get_torch()` — likely the first `import torch` attempt in a session where VLM is disabled). Testing `scripts/build-runtime.js`'s packaging step directly showed:
```
Warning: Package typing_extensions not found in site-packages.
```
`typing_extensions` ships as a single top-level file (`typing_extensions.py` + a `.dist-info` folder), not a package directory. The copy loop in `build-runtime.js` only ever checked for a directory (`fs.existsSync(path.join(sitePackages, pkg))`), so this one dependency was silently skipped on every build — including the runtime zip built in Phase 121. `torch` hard-requires `typing_extensions`, so the shipped bundle's `torch` was never actually importable.

## Fix
`scripts/build-runtime.js`: the copy loop now checks for both a package directory and a `<pkg>.py` single-file module, copying whichever form exists. Verified no other `heavyPackages` entry has this problem (checked all 30 entries against the dev venv — only `typing_extensions` ships as a bare file).

## Verification
- Rebuilt the AI Runtime zip: `typing_extensions.py` + its `.dist-info` now copy correctly, no warning.
- Isolated import test using *only* the rebuilt runtime's `lib/site-packages` on `sys.path` (Python launched with `-I` to exclude the dev venv's own site-packages): `import torch` succeeds — `torch 2.5.1+cu121`, `cuda available: True`.

## Assumptions & Risks
- This is a confirmed, severe, pre-existing packaging bug (predates this session's other SAM 3 work) — not a regression introduced by Phase 121/122's code changes. It happened to surface via the Manage Models blank-screen report because that screen appears to be the first code path in a typical session (with VLM disabled) that actually calls `get_torch()`.
- Not yet confirmed whether this fully explains the reported blank-screen freeze — `get_torch()`'s `ImportError` is caught and returns `None` rather than propagating, so a hang would need a different explanation if it persists after this fix. Flagged to the user to retest and report back.
- Anyone who already downloaded the AI Runtime zip before this fix has a broken (torch-less) runtime and needs to re-download after this release.
