# Fix: built app failed to open its database after the Vite 8 upgrade

**Branch:** `fix/vite8-main-externals` (stacked on `chore/remove-tensorflow-tfjs`, PR #79; the bug was introduced by PR #76)

## Symptom
The packaged app logged `DB Init Failed {}` about 100 ms after start, then a flood of `Database not initialized`. Nothing worked. Found by starting the built app (against a throw-away `--user-data-dir`) while preparing a local release; no unit test, type check or build step noticed it.

## Cause
Vite 8 builds with Rolldown and reads `build.rolldownOptions`. `vite.config.ts` still set `build.rollupOptions.external = ['better-sqlite3', 'exiftool-vendored', 'sharp']`, which is now ignored, so the main-process build **bundled all three modules into `dist-electron/`**. better-sqlite3's JavaScript was then looking for its native binding relative to `dist-electron/` instead of its own `node_modules` folder, and failed. (The logger prints an Error as `{}`, which hid the real message.)

## Changes
- `vite.config.ts`: `rollupOptions` -> `rolldownOptions` for the externals (with a comment).
- New guard `scripts/dev/check-build-output.cjs` plus a new `verify.ps1` step, "Build output (native modules stay external)": fails if better-sqlite3, sharp or exiftool-vendored is bundled into, or never imported by, the files `main.js` loads (stale chunks from older builds in the same folder are ignored). Checked against the broken build: it reports all three.
- Test: `tests/backend/unit/checkBuildOutput.test.ts` (5 tests).

## Verification
- Rebuilt the Windows package (`electron-builder --win --x64`, output in the scratchpad-side folder `release/local-build`, not the existing `release/0.8.1`). Started it with a fresh `--user-data-dir`: the database opened, migration 1 ran with its pre-migration backup, the Python backend started, no errors in `main.log` after 30 s, window responsive.
- `scripts/dev/verify.ps1` passes (see PR).

## Not changed / notes
- Stale chunk files from old builds accumulate in `dist-electron/` and are packaged into `app.asar` (dead files, not loaded). Not touched here.
- PR #76 on its own leaves main with this bug; merge the stack through this PR, not only the first PRs.
