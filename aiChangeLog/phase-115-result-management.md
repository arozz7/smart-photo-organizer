# Phase 115 — Result Management

## Summary
Added Save to Library and Copy to Clipboard actions for creative operation results,
replacing the old browser-download `↓ Save` button with a persistent split-button UI.

## Files Modified

### `electron/ipc/aiHandlers.ts`
- Added `node:path` and `node:fs/promises` imports
- Added `creative:saveResult` IPC handler
  - Validates `resultB64` and `sourcePath` inputs
  - Decodes base64 PNG and writes to `<libraryPath>/Creative Results/<YYYY-MM-DD>/creative-<timestamp>.png`
  - Creates dated directory with `fs.mkdir({ recursive: true })`
  - Returns `{ success, savedPath }` or `{ success: false, error }`

### `src/hooks/useSegmentation.ts`
- Added `saveResult` action (calls `creative:saveResult` IPC, returns `{ savedPath }` or `{ error }`)
- Exported via hook return value

### `src/components/CreativeOperationsBar.tsx`
- Added `onSaveToLibrary` prop (replaces old `downloadBlob`)
- Added `SaveStatus` and `ClipStatus` types for inline feedback
- Added `dropdownOpen` state + outside-click handler (closes dropdown when clicking away)
- Replaced `↓ Save` button with split-button:
  - **Primary**: "Save to Library" — calls `onSaveToLibrary`, shows 3-second inline status
  - **Chevron**: opens dropdown with "Copy to Clipboard" option
  - **Copy to Clipboard**: uses `navigator.clipboard.write` with PNG Blob
- Added cleanup of status timers on unmount

### `src/components/CreativeToolsPanel.tsx`
- Destructured `saveResult` from `useSegmentation()`
- Passed `onSaveToLibrary={saveResult}` to `<CreativeOperationsBar />`

## Tests Added
- `tests/backend/unit/creative-save.test.ts` — 5 tests covering:
  - Missing `resultB64` returns error
  - Missing `sourcePath` returns error
  - Creates directory + writes file with correct path shape
  - `fs.writeFile` failure propagates as error response
  - Uses `ConfigService.getLibraryPath()` for base directory

## Behavior Changes
- Saved files land in `<libraryPath>/Creative Results/<YYYY-MM-DD>/` (not a browser download)
- Users can also copy results directly to the system clipboard via the split-button dropdown

## Assumptions & Risks
- `navigator.clipboard.write` requires a secure context (localhost satisfies this in Electron)
- `ConfigService.getLibraryPath()` is synchronous — safe to call in the IPC handler
