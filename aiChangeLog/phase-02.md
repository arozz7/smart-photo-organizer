# Phase 2: UI Polish & Configuration

## Diff Narrative

### Files Modified
- `src/components/SettingsModal.tsx`: Refactoring to use Tabs and Grid layout.
- `electron/main.ts`: 
    - Adding window bounds persistence.
    - Implementing Smart Face Storage (Top-100 Reference Pruning).
    - Adding Debounced Mean Recalculation for performance.
    - Adding Splash Screen Progress handler.
- `src/views/Settings.tsx`: Improving responsive layout.
- `electron/db.ts`: 
    - Schema update (faces `descriptor` BLOB, drop `descriptor_json`).
    - Async/Chunked `initDB` migration.
- `src/views/People.tsx`: Client-side clustering updates for instant UI response.
- `public/splash.html`: Added status text for migration progress.

### Behavior Changes
- Application window now remembers its size and position across restarts.
- "Configure AI Models" modal is organized into tabs (General, Tagging, Maintenance).
- Settings screens are more responsive on smaller displays.
- **Smart Face Storage**: Vectors are now BLOBs. Only top 100 reference vectors per person are kept, significantly reducing DB size.
- **Improved Startup**: Splash screen now shows real-time progress during database migrations.
- **Performance**:
    - Scanning no longer blocks the main thread (Debounced calculations).
    - Naming faces no longer causes "Organizing Faces" lag (Client-side optimization).

### Tests Added
- Manual verification of window persistence.
- Manual verification of settings layout on resize.
- Verified successful DB migration of 2000+ faces.
- Verified scanning performance and UI responsiveness.

## Completed Tasks
- [x] Implement Window State Persistence (electron-store)
- [x] Refactor SettingsModal to use Tabbed Layout
- [x] Update Settings.tsx to use Responsive Grid
- [x] Verify TypeScript Build (Passed)
- [x] Smart Face Storage (BLOB Migration, Pruning)
- [x] Splash Screen Migration Progress
- [x] Performance: Debounced Mean Recalculation
- [x] Performance: Client-Side Clustering Updates
