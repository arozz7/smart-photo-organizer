# Phase 92: Auto-Generated Collages Widget (Dashboard Phase 4)

## Summary
Added a Photo Collage widget to the Home Dashboard that auto-generates collages from library photos using HTML5 Canvas rendering, with three layout modes and PNG/JPG export.

## New Files
| File | Purpose |
|------|---------|
| `src/components/dashboard/collageLayouts.ts` | Pure layout algorithm functions (Grid, Feature, Mosaic) |
| `src/components/dashboard/CollageWidget.tsx` | Widget component with canvas rendering, layout switching, regenerate, and export |
| `electron/ipc/collageHandlers.ts` | IPC handlers for base64 photo loading (via sharp) and collage export (save dialog) |

## Modified Files
| File | Change |
|------|--------|
| `electron/main.ts` | Import + register `collageHandlers` |
| `electron/data/repositories/DashboardRepository.ts` | Added `getCollagePhotos()` — On This Day pool with quality fallback |
| `electron/ipc/dashboardHandlers.ts` | Added `dashboard:getCollagePhotos` handler |
| `src/components/dashboard/WidgetGrid.tsx` | Added CollageWidget slot (full-width, after On This Day) |
| `src/components/dashboard/WidgetCustomizationModal.tsx` | Added `collage` to WIDGET_LABELS and `PRESETS.power` |
| `src/context/DashboardContext.tsx` | Added `collagePhotos` state, fetch in refresh, exposed via context |
| `electron/core/services/ConfigService.ts` | Added `collage` widget to DEFAULT_CONFIG (disabled by default) |
| `README.md` | Updated dashboard feature description |
| `docs/guides/user_manual.md` | Added Photo Collage widget documentation |
| `docs/specs/dashboard-phase-4-plan.md` | Marked Phase 4 as Complete |

## Technical Details
- **Cross-origin solution:** Photos loaded as base64 data URLs via IPC (`collage:readPhotoBase64`) using sharp resize to 600px wide, avoiding canvas tainting from `local-resource://` protocol
- **Layout modes:** Grid (2x2/3x3), Feature (hero + sidekick), Mosaic (variable-height masonry)
- **Photo selection:** Prefers On This Day memories, fills remaining with highest blur_score photos
- **Export:** Canvas `toDataURL()` → IPC → `dialog.showSaveDialog()` → write buffer to disk
- **Default state:** Disabled by default, available in Power preset or via gear icon toggle
