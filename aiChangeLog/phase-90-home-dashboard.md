# Phase 90: Home Page Dashboard

## Summary
Replaced Library as default startup page with an engaging Home Page Dashboard featuring 6 widgets: On This Day memories, Library Stats, People Spotlight, Recent Activity, Fun Facts, and Scan Entertainment (live scan progress with memory flashbacks).

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `electron/data/repositories/DashboardRepository.ts` | 168 | Database queries for dashboard data (memories, stats, people, recent scans, fun facts) |
| `electron/ipc/dashboardHandlers.ts` | 37 | IPC handler registration for 5 dashboard channels |
| `src/context/DashboardContext.tsx` | 97 | React context for dashboard state management (lazy-loaded) |
| `src/views/Home.tsx` | 55 | Home view — default startup page with header and WidgetGrid |
| `src/components/dashboard/WidgetGrid.tsx` | 34 | 12-column CSS Grid layout orchestrating all widgets |
| `src/components/dashboard/OnThisDayWidget.tsx` | 85 | Horizontal scrollable photo carousel grouped by year |
| `src/components/dashboard/LibraryStatsWidget.tsx` | 103 | CSS conic-gradient donut chart + stat cards |
| `src/components/dashboard/PeopleSpotlightWidget.tsx` | 86 | Horizontal carousel of top 10 people with FaceThumbnail |
| `src/components/dashboard/RecentActivityWidget.tsx` | 72 | 4-column grid of latest scanned photo thumbnails |
| `src/components/dashboard/FunFactsWidget.tsx` | 39 | Random library insight with refresh button |
| `src/components/dashboard/ScanEntertainmentWidget.tsx` | 113 | Live scan progress, stats, memory flashback (auto-hides when idle) |

## Files Modified

| File | Change |
|------|--------|
| `electron/main.ts` | Import + register `dashboardHandlers` |
| `src/App.tsx` | Add Home route at `/` (new default), move Library to `/library` |
| `src/components/Layout.tsx` | Add "Home" nav link with notification badge, update Library path |
| `src/main.tsx` | Add `DashboardProvider` to provider hierarchy |

## Behavior Changes
- **Default route:** App now opens to Home (`/`) instead of Library
- **Library route:** Moved from `/` to `/library`
- **Navigation:** "Home" is now the first sidebar item with a purple notification dot when memories are available
- **Lazy loading:** Dashboard data only fetched when Home view mounts (no impact on other views)

## Key Design Decisions
- **Separate DashboardRepository** — PhotoRepository already exceeds 600-line hard limit
- **Separate dashboardHandlers.ts** — dbHandlers.ts already at ~1077 lines
- **CSS conic-gradient** for pie chart — no charting library dependency
- **On This Day date math** handled in TypeScript with year-boundary-safe logic
- **DashboardContext is lazy** — only fetches on Home mount, not app startup

## IPC Channels Added
- `dashboard:getOnThisDayPhotos` — Photos from ±3 days in prior years
- `dashboard:getStats` — Aggregate library statistics
- `dashboard:getTopPeople` — Top N people by face count
- `dashboard:getRecentScans` — Latest scanned photos
- `dashboard:getFunFact` — Random library insight

## Phase 2 Additions (Scan-Time Entertainment)
- **ScanEntertainmentWidget:** Auto-shows during scans/AI processing, hides 30s after completion
  - Live stats: photos scanned, AI queue size, scan speed
  - Random Flashback: cycles through memories every 10s during scans
  - Indigo border accent to visually distinguish from static widgets
- **Enhanced Fun Facts:** Added 4 new fact types — camera model, popular tag, busiest day of week, monthly average

## Phase 3 Additions (Widget Customization)
- **ConfigService:** Added `DashboardConfig` interface with `widgets[]`, `preset`, `reduceMotion` fields
  - Deep-merged during config load, widget array preserved from user config
  - Helper methods: `getDashboardConfig()`, `updateDashboardConfig()`
- **IPC Handlers:** `dashboard:getLayout` and `dashboard:saveLayout` for config persistence
- **WidgetCustomizationModal:** Radix Dialog with:
  - Per-widget toggle switches (ON/OFF)
  - Layout presets: Minimal (stats + people only), Balanced (all), Power User (all)
  - Reduce Motion toggle for accessibility
  - Gear icon in Home header triggers modal
- **WidgetGrid:** Respects `isWidgetEnabled()` — disabled widgets are not rendered
  - Grid columns auto-adapt when sibling widgets are disabled (e.g., stats expands to full width)
- **DashboardContext:** Added `layoutConfig`, `updateLayoutConfig()`, `isWidgetEnabled()` to context

### Phase 3 Files
| File | Change |
|------|--------|
| `electron/core/services/ConfigService.ts` | Added `DashboardConfig`, `DashboardWidgetConfig` interfaces, default config, helpers |
| `electron/ipc/dashboardHandlers.ts` | Added `dashboard:getLayout` and `dashboard:saveLayout` handlers |
| `src/context/DashboardContext.tsx` | Added layout config state, `isWidgetEnabled()`, loads config on refresh |
| `src/views/Home.tsx` | Added gear icon button, WidgetCustomizationModal integration |
| `src/components/dashboard/WidgetGrid.tsx` | Conditional rendering based on `isWidgetEnabled()` |
| `src/components/dashboard/WidgetCustomizationModal.tsx` | **New** — full customization modal (~175 lines) |

## Future Phases (Not Implemented)
- Phase 4+: Auto-Generated Collages, Drag-and-Drop Grid
