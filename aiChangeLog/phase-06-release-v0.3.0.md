# Phase 6: Release v0.3.0 Logic & Build Fixes

## Diff Narrative
Updating core infrastructure to support the v0.3.0 release distribution. This includes pointing the AI Runtime downloader to the correct new release tag, fixing a critical build script failure on Windows, and updating all version references.

### 1. AI Runtime Download Update
- **Target:** Updated hardcoded download URL in `main.py` from `v0.2.0-beta` to `v0.3.0`.
- **Multi-part Support:** Verified and preserved logic for downloading multi-part zip files (`.001`, `.002`).

### 2. Build Script Fix (Windows)
- **Problem:** `npm run build:runtime` was failing with `Compress-Archive` file locking errors on Windows.
- **Fix:** Switched from PowerShell's `Compress-Archive` to the native `tar` command (bsdtar) which handles file access more robustly and is significantly faster.

### 3. Version Bump
- **Files:** Updated `RELEASE.md`, `README.md`, `LoadingScreen.tsx`, and `main.py` (error messages) to reflect `v0.3.0`.

## Changed Files
- `src/python/main.py`: URL update, error message version update.
- `scripts/build-runtime.js`: Replaced `Compress-Archive` with `tar`.
- `RELEASE.md`: Version update.
- `README.md`: Version update.
- `src/components/LoadingScreen.tsx`: UI version display update.
