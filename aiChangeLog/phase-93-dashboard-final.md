# Phase 93: Dashboard Final Phases (5a, 5b, 7)

## Summary
Completed all remaining Dashboard phases: Drag-and-Drop Widget Reorder (5a), Resizable Widgets (5b), and Location Heatmap Widget (7).

## Files Created
| File | Purpose |
|------|---------|
| `src/components/dashboard/DraggableWidget.tsx` | Sortable wrapper using @dnd-kit with drag handle and resize handle |
| `src/components/dashboard/LocationWidget.tsx` | SVG world map widget showing photo GPS clusters |

## Files Modified
| File | Change |
|------|--------|
| `src/components/dashboard/WidgetGrid.tsx` | Refactored to use DndContext/SortableContext; dynamic widget order from config; size-driven col-spans; LocationWidget slot |
| `src/context/DashboardContext.tsx` | Added `reorderWidgets()`, `resizeWidget()`, `locationClusters` state, `LocationCluster` interface, smart widget merging for forward-compat |
| `src/components/dashboard/WidgetCustomizationModal.tsx` | Added `locationHeatmap` to WIDGET_LABELS and Power preset |
| `electron/core/services/ConfigService.ts` | Added `locationHeatmap` to default dashboard widgets |
| `electron/data/repositories/DashboardRepository.ts` | Added `getPhotoLocations()` GPS clustering query with bounds validation |
| `electron/ipc/dashboardHandlers.ts` | Added `dashboard:getPhotoLocations` IPC handler |
| `package.json` | Added `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |

## Behavior Changes
### Phase 5a: Drag-and-Drop
- All dashboard widgets now display a drag handle (grip icon) on hover
- Dragging a widget reorders it within the grid
- Widget order persists to config.json via `dashboard:saveLayout` IPC

### Phase 5b: Resizable Widgets
- Stat-type widgets show a resize handle (diagonal lines) on hover at bottom-right
- Dragging the handle snaps to grid column sizes: 4-col (1x1), 8-col (2x1), 12-col (2x2)
- Full-width widgets (Scan Entertainment, On This Day, Collage) are not resizable

### Phase 7: Location Heatmap
- New "Location Heatmap" widget shows an SVG world map
- Photo GPS coordinates extracted from metadata_json, clustered by ~11km grid
- Dot size/color indicates photo density (blue=few, orange=many)
- Tooltip on hover shows count and coordinates
- Empty state if no GPS data available
- Enabled in Power preset, disabled by default

## Dependencies Added
- `@dnd-kit/core` — DnD primitives for React
- `@dnd-kit/sortable` — Sortable list abstraction
- `@dnd-kit/utilities` — CSS transform helpers

## Tests
- TypeScript compilation passes (`tsc --noEmit`)
- Dev server starts clean with no console errors
- Vite build successful

## Assumptions & Risks
- GPS data availability depends on user's camera/phone settings; widget handles gracefully with empty state
- SVG landmass paths are simplified approximations — not cartographically precise
- Resize behavior uses mouse events only (no touch support for tablet yet)
