# Phase 131a — Send to ClearFrame (no photo copies)

## Summary
A "Send to…" action that opens photos in the ClearFrame enhancer by passing **only the file paths** of the originals on its command line. No photo is copied, staged or zipped, and no XMP or other metadata is written (coordinator decisions L-001, L-026, L-031). It works for a Library selection, a Smart Album and the Create-view set. The target list is extensible; only ClearFrame exists now.

Requested by the photo-suite coordinator session and approved by the user on 2026-11-15 as a one-feature exception while the Phase 131 work stays paused.

## Files created
- `electron/core/services/sendTo/` — `PathBatcher` (pure, command-line batching), `sendToSettings` (Zod-resolved settings), `SendTarget` (interface), `ClearFrameTarget`, `clearFrameInstall` (install probe, tasklist parsing, wait-for-window), `PhotoPathSource` + `createDbPhotoPathSource` (selection / Smart Album to paths), `SendToService` (orchestration), `sendRequestSchema` (IPC validation)
- `electron/lib/sendTo/launchDetached.ts`, `listClearFrameWindows.ts` (the only side-effecting code)
- `electron/data/repositories/PhotoPathRepository.ts` (read-only, chunked id lookup)
- `electron/ipc/sendToHandlers.ts` (`sendTo:getTargets`, `sendTo:send`, `sendTo:getSettings`, `sendTo:updateSettings`)
- `src/types/sendTo.ts`, `src/utils/sendToApi.ts`, `src/utils/sendToMessages.ts`, `src/hooks/useSendTo.ts`, `src/hooks/useSendToSettings.ts`, `src/components/SendToButton.tsx`, `src/components/SendToSettingsCard.tsx`
- Tests: `tests/backend/unit/sendTo/*` (PathBatcher, sendToSettings, SendToService, ClearFrameTarget, clearFrameInstall, PhotoPathSource, sendRequestSchema, launchDetached, `noPhotoCopies.guard`), `tests/backend/integration/sendToPaths.integration.test.ts`, `tests/frontend/unit/utils/sendToMessages.test.ts`

## Files modified
- `electron/core/services/ConfigService.ts` — optional `sendTo` config key
- `electron/main.ts` — registers the handlers
- `src/views/Library.tsx` (button in selection mode), `src/components/FilterPanel.tsx` (button per Smart Album), `src/views/Create.tsx` (button under Export Album), `src/views/Settings.tsx` (+2 lines to mount the card)
- `README.md`

## Behaviour
- **Paths only.** The renderer sends photo ids or a Smart Album id and a target name; the main process looks up the stored paths. A path or program path from the renderer is never accepted.
- **Missing photos are skipped and counted:** rows with `missing_since` set (column exists from Phase 130, set by the future Phase 131) and files that no longer exist on disk.
- **Confirmation above a threshold** (default 50, `config.json` → `sendTo.confirmThreshold`, editable in Settings; 0 = always ask). Read at send time, so changes apply immediately.
- **ClearFrame launch:** `cf-app.exe`, configured path or `%LOCALAPPDATA%\ClearFrame\cf-app.exe`. Everything is sent in one launch when it fits a command line (budget 24,000 of Windows' 32,767 characters, overridable in `config.json` only). Otherwise several launches, with a wait until a window titled "ClearFrame" exists before each further launch (ClearFrame can abort when a second launch arrives while the first is still starting). The wait is a single injected dependency so it can be dropped once ClearFrame ships its fix. Order across batches is not promised.
- **Honest count:** "sent" means handed to the operating system. The process is detached, so SPO cannot see whether ClearFrame accepted each file.
- Logging records counts only, never file paths.

## Duplicates and enhanced results
ClearFrame writes `<stem>_enhanced_<N>x.<ext>` beside each original (folder changeable in ClearFrame). After a scan the result is a new photo: different bytes, so no exact-duplicate match, but near-identical, so the near pass (pHash Hamming distance ≤ 10) will normally group it with the original. **Nothing is linked automatically in this phase.** README tells the user to check which file to keep before resolving such a group. An "enhanced version of" relation is a possible later feature; the output folder is user-changeable, so it cannot assume the same folder.

## Tests added
Unit and integration tests listed above (all green: full TS suite 716 passed, 7 skipped). The guard test fails the build if any file in the send code gains a copy, write, rename, delete or metadata call.

## Assumptions and risks
- The default install path `%LOCALAPPDATA%\ClearFrame\cf-app.exe` was read from ClearFrame's installer script, not from a real install. Manual QA owed with a real ClearFrame: single launch, multi-batch launch, large-set confirmation, a Smart Album, and the Settings path.
- The Create-view "Export Album" button calls `os:createAlbum`, for which no main-process handler was found. Not part of this phase; reported separately.
- `Settings.tsx` is 899 lines (hard limit 900), +2 from this phase; it needs the refactor protocol before further growth.
- Window detection uses `tasklist /v` (Windows only), matching the rest of the app.
