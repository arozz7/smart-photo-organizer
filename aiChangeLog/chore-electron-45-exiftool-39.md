# Chore: Electron 30 -> 45, better-sqlite3 11 -> 13, exiftool-vendored 34 -> 39 (vulnerability plan, PR C of 3)

**Branch:** `chore/electron-45-exiftool-39` (stacked on `chore/remove-xenova-transformers`)
**Result:** `npm audit` 3 -> **0 vulnerabilities** (started at 52 this session: 52 -> 36 -> 8 -> 3 -> 0).

## Dependency changes
| Package | From | To | Why |
| --- | --- | --- | --- |
| `electron` | 30.x (Node 20) | 45.3.3 (Node 24.22.3, ABI 150) | Electron advisories (all <= 42, including a high use-after-free) |
| `better-sqlite3` | 11.3.0 | 13.2.0 (pinned exactly, as before) | Needed for Electron 45 (C++20, Node 24); ships N-API prebuilds |
| `exiftool-vendored` | ^34.0.0 | ^39.4.0 | Argument-injection advisory; needs Node >= 22, which Electron 45 provides |
| `node-abi` (inside `@electron/rebuild`) | 4.26.0 | 4.40.0 | 4.26 does not know Electron 45 ("Could not detect abi for version 45.3.3") |

## Other changes
- `scripts/run-tests.cjs`: a failed `electron-rebuild` restore now fails the run (exit 2) with a clear message. Before, it printed a warning and exited 0 when tests passed, so `verify.ps1` reported success while the Electron build of better-sqlite3 was broken. That is how the `node-abi` problem above was first missed.
- **Package size note (not changed):** better-sqlite3 13 ships N-API prebuilds for every platform in `node_modules/better-sqlite3/prebuilds/` (16.5 MB), and the Windows package includes them all although only `win32-x64.node` is loaded. A first trim attempt put exclusions in `win.files`; electron-builder then prepends `**/*` when the first pattern is an exclusion, which pulled the whole project (including a multi-GB `release/` zip) into the build, so it was reverted. If the installer size matters, the safe fix is a top-level `files` exclusion (this also affects mac/linux builds) or an `afterPack` hook; left for a decision.
- New `tests/backend/integration/exiftoolTags.integration.test.ts`: real exiftool-vendored (not a mock) writes a JPEG with a known capture date and orientation, then checks the app's own `parseExifDate`, `resolveDateTaken`, `normalizeOrientation` and `extractDimensions` on what it reads back. Every other test mocks ExifTool, so this is the only one that notices a changed tag shape in a future upgrade.

## What was checked against Electron 31-45 breaking changes
The app's Electron surface is small. None of these apply: `File.path` (no drag-drop of file objects), `window.open` and `setWindowOpenHandler`, `safeStorage`, permission handlers, renderer `clipboard` (the app uses `navigator.clipboard`), `registerFileProtocol` (the app uses `protocol.handle`), login-item settings, and webContents navigation methods. The preload only requires `electron` (`contextBridge`, `ipcRenderer`), which is what 45 still allows in a sandboxed preload.
- Behaviour change to expect: `dialog.showOpenDialog` without a `defaultPath` (both folder pickers in `electron/ipc/fileHandlers.ts`) now opens in Downloads, because Electron 43 stopped remembering the last folder. Pass a `defaultPath` if that matters.
- The breaking-changes list for Electron 31-42 was read from a summarised copy, not verbatim; the checks above were done against this repo's code.

## Verification
- `scripts/dev/verify.ps1`: type check, lint (0 errors, 61 warnings), file sizes, vite build, 769 TypeScript tests (767 + 2 new), 190 Python tests, and the Electron rebuild of better-sqlite3 all pass.
- Electron 45's own runtime (`ELECTRON_RUN_AS_NODE`) ran: better-sqlite3 (SQLite 3.54.1) create/insert/select in memory, sharp 0.35 (generate and read a JPEG), exiftool 13.64 (write and read tags).
- `electron-builder --dir --win --x64` with the default native rebuild (not skipped) builds the app with Electron 45.3.3; the better-sqlite3 binary packaged inside `app.asar` loads and runs under the packaged runtime.

## Not verified (needs a real run on your machine)
- The packaged app was **not launched**: it would open and could migrate a real library. Manual QA checklist (built app, ideally on a copy of a library):
  1. Start the app: splash, then the main window appears; Settings opens.
  2. Scan a folder with JPEG, RAW and HEIC files: photos appear with thumbnails and correct dates and rotation (this exercises exiftool 39, sharp 0.35 and better-sqlite3 13).
  3. Python AI: face detection and a tag run complete (IPC to the Python runtime).
  4. Open the preview protocol (`local-resource://`): full-size view of a photo, a rotated photo, a RAW.
  5. Move Library, Export Album and Send to ClearFrame still work.
  6. Folder pickers open (now in Downloads on first use).
  7. Ctrl+Shift+I opens DevTools; there are no red errors on load.
  8. An existing library opens with no migration or database error (better-sqlite3 13 bundles a newer SQLite).
- `vite dev` (hot-reload session) was not started, for the same reason.
- The stricter `run-tests.cjs` failure path (exit 2) was written and syntax-checked but not triggered on purpose.
