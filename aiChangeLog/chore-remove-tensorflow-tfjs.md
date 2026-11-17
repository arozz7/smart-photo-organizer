# Chore: remove unused @tensorflow/tfjs

**Branch:** `chore/remove-tensorflow-tfjs` (stacked on `chore/electron-45-exiftool-39`)

## Change
- Removed `@tensorflow/tfjs` (`^4.22.0`) from `package.json` and `package-lock.json` (about 280 lines of lock entries; packages only it needed are gone, a few others are now dev-only).
- Reason: its only importer was `src/deprecated/workers/scanner.worker.ts`, a parked file that is never instantiated and is excluded from `tsconfig.json` (see `chore-remove-xenova-transformers.md`). Nothing else in `src/`, `electron/`, `scripts/` or the build config references it. The parked file was not changed.
- Left alone: `@vladmandic/human` (still used by `scripts/download-models.js`).

## Verification
`scripts/dev/verify.ps1` passes: type check, lint (0 errors, 61 warnings), file sizes, vite build, 796 TypeScript tests, 190 Python tests.

## Audit note
`npm audit` now lists one finding, picomatch (GHSA-fc5q-39xc-vjpf, ReDoS, published 2026-10-19, updated 2026-11-17). It affects "through 4.0.7", which is the latest release, so no fixed version exists yet. It is reached only through dev tooling (vite, vitest, typescript-eslint, node-gyp, @electron/rebuild) and appears identically on the previous branch's lockfile, so it is not caused by this change. Re-check when picomatch publishes 4.0.8 or later.
