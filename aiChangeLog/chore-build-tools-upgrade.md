# Chore: upgrade build tooling (vulnerability plan, PR A of 3)

**Branch:** `chore/build-tools-upgrade`
**Goal:** clear the build-time and dev-only npm advisories. Nothing here ships inside the app.
**Result:** `npm audit` 36 -> 8 findings. The 8 left are all in packages that PR B (`@xenova/transformers`) and PR C (Electron, `exiftool-vendored`) replace.

## Dependency changes
| Package | From | To |
| --- | --- | --- |
| `vite` | 5.4 | 8.3 |
| `@vitejs/plugin-react` | 4.x | 6.3 |
| `vite-plugin-electron` | 0.28 | 1.2 |
| `vite-plugin-electron-renderer` | 0.14 | 1.0 |
| `electron-builder` | 24.13 | 26.18 |
| `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser` | 7.x | 8.73 (works with the existing ESLint 8) |
| lockfile | transitive packages (brace-expansion, picomatch, js-yaml, flatted, browserslist, ...) | patched versions within their ranges via `npm audit fix` |

`package.json` now has an `overrides` block: `app-builder-lib` and `@electron/universal` use `minimatch` ^11.0.1. electron-builder 26.18 is the latest release and still depends on a minimatch with a denial-of-service advisory (fixed in 11.0.1), so the override is how it gets patched. Remove it when electron-builder ships its own fix.

## File changes
- `package.json`, `package-lock.json`: as above. npm 11.3 crashes on installs here, so the install ran with `npx -y npm@latest` (see memory note); that npm skips install scripts, and `node scripts/run-tests.cjs` rebuilds better-sqlite3 afterwards.
- `electron-builder.json5`: `win.icon` now points at `build/icon-1024.png`.
- New `build/icon-1024.png`: a real PNG copy of `build/icon.png`. **Why:** `build/icon.png` is really a JPEG (starts with `FF D8 FF`) with a `.png` name. electron-builder 24 accepted it; 26 rejects it ("Input is not a valid PNG"). The original file is untouched (nothing deleted).

## Verification
- `scripts/dev/verify.ps1`: type check, lint (0 errors, 61 warnings, same as before), file sizes, vite build, 767 TypeScript tests, 190 Python tests all pass.
- `vite build` produces the renderer (`dist/`), main process and preload bundles with vite 8 (Rolldown).
- `electron-builder --dir --win --x64` (output in a scratch folder, `npmRebuild=false`) produces `win-unpacked/Smart Photo Organizer.exe` with the Python runtime and exiftool included.

## Not verified (needs a real run)
- The packaged app was **not launched** (it would open and migrate a real library). Manual check: build the installer (`npm run build`), start the app, confirm the window loads, scanning works and images show.
- The default `npmRebuild` step of electron-builder (native rebuild of better-sqlite3 and sharp for Electron 30) was skipped in the smoke test; a full `npm run build` exercises it.
- `vite dev` (hot-reload dev session) was not started for the same reason.
- Vite 8 prints a notice that `vite.config.ts` uses `__dirname` under `configLoader: 'native'`. It works today; switch to `import.meta.dirname` when Vite makes native loading the default.
- `@electron/universal` and `dmg-builder` only run for macOS builds; the minimatch override there is untested on Windows.
