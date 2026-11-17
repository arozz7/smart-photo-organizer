# Feat: show the real app version; bump to 0.8.2

**Branch:** `feat/show-real-app-version` (stacked on `fix/vite8-main-externals`, PR #80)

## Problem
The sidebar and the loading screen showed `v0.7.5`, typed directly into `src/components/Layout.tsx` and `src/components/LoadingScreen.tsx`. It never followed `package.json`.

## Changes
- `electron/ipc/appHandlers.ts`: new `app:getVersion` handler returning `app.getVersion()`.
- New hook `src/hooks/useAppVersion.ts`: asks for the version once and returns `vX.Y.Z`; returns an empty string until known, or if it cannot be read (no label rather than a wrong one).
- `Layout.tsx` (sidebar) and `LoadingScreen.tsx` use the hook instead of the literal.
- `package.json` / `package-lock.json`: version 0.8.1 -> **0.8.2**, so a build goes to `release/0.8.2/` instead of overwriting `release/0.8.1/`. Interim version for local builds; the next real release number is still a separate decision (roadmap: v0.9.0 at the end of step 2).
- `README.md` "Releasing": bump the version first; manual build steps for a bash shell; smoke test on a scratch data folder.

## Not changed on purpose
- The fallback AI-runtime download URLs in `src/python/commands/utilities.py` and `src/python/main.py` still point at the `v0.8.1` GitHub release, because that is where the runtime asset exists. The in-app downloader in `electron/ipc/aiHandlers.ts` builds its URL from `app.getVersion()`, so a machine that does not have the AI runtime yet would look for `v0.8.2/ai-runtime-win-x64.zip`, which only exists once a v0.8.2 release is published. Machines that already have the runtime (such as the dev machine) are not affected.

## Tests
`tests/frontend/unit/hooks/useAppVersion.test.tsx` (3), `tests/backend/unit/appHandlers-version.test.ts` (1).
