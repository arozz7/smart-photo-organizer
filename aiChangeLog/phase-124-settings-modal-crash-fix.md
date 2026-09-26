# Phase 124 — Fix Settings/Manage Models blank-screen crash

## Summary
Reproduced and fixed the blank-screen crash reported when opening Settings → Configure Models → Manage Models. Root cause: an uncaught `TypeError: Cannot read properties of undefined (reading 'toFixed')` in `SettingSlider` (`src/components/SettingsModal.tsx`), thrown by `settings.faceDetectionThreshold` being `undefined` after settings loaded from the backend — with no error boundary anywhere in the tree, this crashes the entire React render, leaving `document.body` empty.

## How this was reproduced
Per the user's request to verify in dev mode before any release build: installed `playwright` locally (`npm install playwright --no-save`, not committed) and drove the actual dev-mode Electron app (`.venv` Python + live source, `IS_DEV=true`) via its `_electron` API — clicking through the sidebar Settings link → "Configure Models" → "Manage Models", capturing renderer console/pageerror events live. First attempt used the production-minified bundle, which gave an unreadable stack trace (`On`, `lf`, `Bu`, minified names). Rebuilding with `vite build --minify false` (no vite.config.ts change needed) gave a readable trace pointing directly at `SettingSlider`.

## Root cause
- `SettingsModal.tsx`'s `loadSettings()` did `setSettings(saved)` — a full state **replace**, not a merge with the component's default values (unlike the adjacent `advancedSettings` state, which correctly does `setAdvancedSettings(prev => ({...prev, ...savedAdv}))`).
- The backend's persisted settings object doesn't include every `AISettings` field — confirmed against a real `update_config` log line from this session showing `faceDetectionThreshold` absent.
- `<SettingSlider value={settings.faceDetectionThreshold} />` (and `faceBlurThreshold`) had no `|| default` fallback, unlike sibling sliders in the same file (`faceSimilarityThreshold || 0.65`, `autoAssignThreshold || 0.70`, etc.) — an inconsistency that made only some sliders safe against missing config fields.
- `SettingSlider` itself called `value.toFixed()` unguarded, so any caller passing `undefined` crashes the whole app with no recovery.

## Fix
- `SettingsModal.tsx`: `loadSettings()` now merges (`setSettings(prev => ({...prev, ...saved}))`), so any field missing from the backend's response falls back to its default instead of becoming `undefined`.
- `SettingSlider`: added a defensive `safeValue` fallback (`typeof value === 'number' && !Number.isNaN(value) ? value : min`) so this reusable component can never crash the app from a bad caller again, regardless of where it's used or what state management mistake happens upstream.

## Verification
Full reproduction cycle re-run after the fix, same automated click path (Settings → Configure Models → Manage Models): zero `pageerror` events, modal renders correctly with "AI Model Management" title and multiple "Ready" badges for installed models. Confirms the exact reported bug is resolved end-to-end, not just patched in isolation.

## Assumptions & Risks
- This was root-caused and verified in dev mode as requested, before any release build — per instruction, no release should be cut until this fix is confirmed. A production (minified, full `npm run build`) rebuild still needs to happen before distribution.
- `playwright` was installed locally for this debugging session only (`--no-save`) and is not part of the committed dependency tree; the ad-hoc repro script used to drive it was not committed (scratch file under `build-temp/`, gitignored).
