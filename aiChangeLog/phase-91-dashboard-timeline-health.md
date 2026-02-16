# Phase 91: Dashboard Timeline & Library Health Widgets

## Summary
Added two new dashboard widgets: **Photo Timeline** (Phase 8) and **Library Health** (Phase 6) from the dashboard-phase-4-plan spec.

## New Files
| File | Purpose |
|------|---------|
| `src/components/dashboard/TimelineWidget.tsx` | Horizontal bar chart showing photo count by year, with monthly drill-down and click-to-filter navigation |
| `src/components/dashboard/LibraryHealthWidget.tsx` | Health score ring, error breakdown by stage, recent error trend, CSV export |

## Modified Files
| File | Change |
|------|--------|
| `electron/data/repositories/DashboardRepository.ts` | Added `getPhotoTimeline()`, `getMonthlyBreakdown(year)`, `getLibraryHealth()` with interfaces |
| `electron/ipc/dashboardHandlers.ts` | Registered 3 new IPC handlers: `dashboard:getPhotoTimeline`, `dashboard:getMonthlyBreakdown`, `dashboard:getLibraryHealth` |
| `src/context/DashboardContext.tsx` | Added `timeline` and `libraryHealth` state, new interfaces, added to refresh() Promise.all and Provider value |
| `src/components/dashboard/WidgetGrid.tsx` | Added TimelineWidget (full width) and LibraryHealthWidget (half width) slots |
| `src/components/dashboard/WidgetCustomizationModal.tsx` | Added `timeline` and `libraryHealth` to WIDGET_LABELS; updated PRESETS (balanced includes timeline, power includes both) |
| `electron/core/services/ConfigService.ts` | Added `timeline` (enabled) and `libraryHealth` (disabled) to DEFAULT_CONFIG dashboard widgets |

## Preset Differentiation
- **Minimal:** libraryStats, peopleSpotlight (unchanged)
- **Balanced:** +timeline (all existing + Photo Timeline)
- **Power:** +timeline, +libraryHealth (everything enabled)

## Behavior
- Timeline widget defaults to enabled for all users (balanced preset)
- Library Health widget defaults to disabled, available in Power preset or via manual toggle
- Timeline: click year → monthly drill-down; click bar → navigates to /search with year/month filter params
- Library Health: SVG ring gauge with color coding (green >90%, yellow >70%, red <70%), CSV export via browser download
