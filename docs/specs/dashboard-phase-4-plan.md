# Home Page Dashboard — Phase 4+ Plan

## Status
- Phase 1 (MVP Dashboard): Complete
- Phase 2 (Scan-Time Entertainment): Complete
- Phase 3 (Widget Customization): Complete
- **Phase 4 (Auto-Generated Collages):** Complete
- Phase 5+ — see below

---

## Phase 4: Auto-Generated Collages Widget

### Goal
Daily auto-generated photo collage from the user's library with export and regeneration support.

### Features
1. **Daily Collage Generation**
   - Pick 4-9 photos from the "On This Day" memories pool (or random if no memories)
   - Fallback: use highest-rated photos (by blur_score, face count, or recency)
   - Compose into a grid layout (2x2, 3x3, or masonry)

2. **Layout Modes**
   - **Grid:** Equal-sized cells (2x2 or 3x3)
   - **Feature:** One large hero photo + 3-4 smaller supporting
   - **Mosaic:** Variable-height masonry layout
   - Layout mode selectable via dropdown in widget header

3. **Canvas Rendering**
   - Use HTML5 `<canvas>` API for compositing
   - Load photos via `local-resource://` protocol → draw to canvas
   - Apply rounded corners, subtle borders, optional date watermark
   - Render at 1920x1080 or 2:3 portrait for social sharing

4. **Export**
   - "Save as PNG" and "Save as JPG" buttons
   - Use Electron `dialog.showSaveDialog()` → `canvas.toBlob()` → write to disk
   - New IPC handler: `dashboard:exportCollage` (receives blob, opens save dialog)

5. **Regenerate**
   - "Regenerate" button shuffles photo selection and layout
   - Optional: "Lock" individual photos to keep them while shuffling the rest

### New Files
| File | ~Lines | Purpose |
|------|--------|---------|
| `src/components/dashboard/CollageWidget.tsx` | ~250 | Widget UI with canvas, layout selector, export/regenerate buttons |
| `src/components/dashboard/collageLayouts.ts` | ~120 | Layout algorithms (grid, feature, mosaic) — pure functions |
| `electron/ipc/collageHandlers.ts` | ~40 | IPC handler for save dialog + file write |

### Modified Files
| File | Change |
|------|--------|
| `electron/main.ts` | Register `collageHandlers` |
| `src/components/dashboard/WidgetGrid.tsx` | Add CollageWidget slot (full width, below On This Day) |
| `src/components/dashboard/WidgetCustomizationModal.tsx` | Add 'collage' to WIDGET_LABELS and PRESETS |
| `src/context/DashboardContext.tsx` | Add 'collage' to DEFAULT_LAYOUT widgets |
| `electron/core/services/ConfigService.ts` | Add collage widget to DEFAULT_CONFIG |

### Risks
- Large photo loading into canvas may be slow — use preview_cache_path (smaller) instead of full-res
- Canvas cross-origin restrictions with `local-resource://` protocol — may need to load via IPC as base64 or use `createImageBitmap()` from fetch

---

## Phase 5: Drag-and-Drop Widget Grid

### Goal
Allow users to rearrange dashboard widgets by dragging them into new positions on the grid.

### Library Evaluation
| Library | Size | React Support | Grid Snap | Notes |
|---------|------|---------------|-----------|-------|
| `@dnd-kit/core` | ~12KB | Native React | Via modifiers | Lightweight, composable, accessible |
| `react-grid-layout` | ~40KB | Native React | Built-in | Full grid system with resize handles |
| `react-beautiful-dnd` | ~30KB | Native React | No | List-focused, deprecated |

**Recommendation:** `@dnd-kit/core` + `@dnd-kit/sortable` for Phase 5a (reorder only). Evaluate `react-grid-layout` for Phase 5b if resize handles are needed.

### Phase 5a: Reorderable Widgets
1. Install `@dnd-kit/core` + `@dnd-kit/sortable`
2. Wrap WidgetGrid items in `<SortableItem>` components
3. Persist widget order to ConfigService (save `position` index per widget)
4. Add drag handle icon to widget headers (visible on hover)
5. Animate drop transitions with CSS

### Phase 5b: Resizable Widgets (Optional)
1. Add resize handles to widget corners (drag to resize)
2. Snap to grid columns (4, 6, 8, 12)
3. Update `size` in widget config on resize
4. Respect minimum sizes per widget type (e.g., Stats min 4 cols, On This Day min 8 cols)

### Modified Files
| File | Change |
|------|--------|
| `src/components/dashboard/WidgetGrid.tsx` | Wrap in DndContext, SortableContext |
| `src/components/dashboard/DraggableWidget.tsx` | **New** — SortableItem wrapper with drag handle |
| `src/context/DashboardContext.tsx` | Add `reorderWidgets()` method |
| `package.json` | Add `@dnd-kit/core`, `@dnd-kit/sortable` |

### Risks
- CSS Grid + dnd-kit interaction may need custom collision detection
- Responsive breakpoints (mobile stacking) should disable drag-and-drop

---

## Phase 6: Library Health Widget

### Goal
Surface scan errors and library health metrics as a dashboard widget (ties into Future Feature #3: Error Export & Library Health).

### Features
1. **Health Score:** Calculated percentage (processed / total * 100)
2. **Error Summary:** Count by error type (corrupt, missing, permission denied)
3. **Quick Actions:** "View Errors" → opens Scan Errors modal, "Export CSV" → downloads error report
4. **Trend Indicator:** Arrow showing if health improved since last scan

### New Queries (DashboardRepository)
```sql
-- Error breakdown by stage
SELECT stage, COUNT(*) as cnt FROM scan_errors GROUP BY stage;

-- Health trend (compare current vs 7 days ago)
SELECT COUNT(*) FROM scan_errors WHERE timestamp > datetime('now', '-7 days');
```

### New Files
| File | ~Lines | Purpose |
|------|--------|---------|
| `src/components/dashboard/LibraryHealthWidget.tsx` | ~120 | Health score, error breakdown, export button |

---

## Phase 7: Location Heatmap Widget

### Goal
Mini world map showing where photos were taken (requires GPS data in metadata_json).

### Prerequisites
- Photos must have GPS coordinates in `metadata_json` (fields: `GPSLatitude`, `GPSLongitude`)
- Need to assess how many photos in typical libraries have GPS data

### Approach Options
| Approach | Pros | Cons |
|----------|------|------|
| Leaflet.js | Full interactive map, tiles, zoom | ~40KB, requires tile server or bundled tiles |
| CSS dot map | Zero dependencies, fast | Limited interactivity, no zoom |
| SVG world outline | Lightweight, no tiles needed | Medium complexity, no street-level zoom |

**Recommendation:** Start with SVG world outline (static dots), upgrade to Leaflet if users want interactivity.

### New Queries (DashboardRepository)
```sql
SELECT json_extract(metadata_json, '$.GPSLatitude') as lat,
       json_extract(metadata_json, '$.GPSLongitude') as lng,
       COUNT(*) as photo_count
FROM photos
WHERE metadata_json IS NOT NULL
  AND json_extract(metadata_json, '$.GPSLatitude') IS NOT NULL
GROUP BY ROUND(lat, 1), ROUND(lng, 1)  -- cluster nearby points
```

### New Files
| File | ~Lines | Purpose |
|------|--------|---------|
| `src/components/dashboard/LocationWidget.tsx` | ~200 | SVG map with photo location dots |

---

## Phase 8: Timeline Widget

### Goal
Horizontal timeline showing photo density by year/month, providing a visual history of the library.

### Features
1. **Bar chart:** Horizontal bars showing photo count per year
2. **Drill-down:** Click a year to see monthly breakdown
3. **Click-to-filter:** Clicking a bar navigates to Library view filtered to that time period
4. **Highlight:** Mark current month and "On This Day" range

### New Queries (DashboardRepository)
```sql
-- Yearly counts
SELECT CAST(strftime('%Y', created_at) AS INTEGER) as year, COUNT(*) as cnt
FROM photos WHERE created_at IS NOT NULL
GROUP BY year ORDER BY year ASC;

-- Monthly counts for a specific year
SELECT CAST(strftime('%m', created_at) AS INTEGER) as month, COUNT(*) as cnt
FROM photos WHERE created_at IS NOT NULL AND strftime('%Y', created_at) = ?
GROUP BY month ORDER BY month ASC;
```

### New Files
| File | ~Lines | Purpose |
|------|--------|---------|
| `src/components/dashboard/TimelineWidget.tsx` | ~180 | CSS bar chart with click-to-filter |

---

## Priority Order

| Phase | Feature | Effort | Impact | Priority |
|-------|---------|--------|--------|----------|
| 4 | Auto-Generated Collages | High | High | Medium — visually impressive but complex |
| 5a | Drag-and-Drop Reorder | Medium | Medium | Low — nice to have, not blocking |
| 6 | Library Health Widget | Low | High | **High** — ties into Error Export roadmap |
| 7 | Location Heatmap | Medium | Medium | Low — depends on GPS data availability |
| 8 | Timeline Widget | Low | High | **High** — easy win, great visual impact |

### Recommended Order
1. **Phase 8: Timeline Widget** — Easy CSS bars, high visual impact, no dependencies
2. **Phase 6: Library Health Widget** — Low effort, feeds into Error Export feature
3. **Phase 4: Collages** — Complex but visually impressive
4. **Phase 5a: Drag-and-Drop** — Polish feature, defer until widget count justifies it
5. **Phase 7: Location Heatmap** — Depends on GPS data; assess data availability first

---

## Balanced vs Power Preset Differentiation

Once more widgets exist, differentiate the presets:

| Widget | Minimal | Balanced | Power |
|--------|---------|----------|-------|
| Scan Entertainment | - | Yes | Yes |
| On This Day | - | Yes | Yes |
| Library Stats | Yes | Yes | Yes |
| People Spotlight | Yes | Yes | Yes |
| Recent Activity | - | Yes | Yes |
| Fun Facts | - | Yes | Yes |
| **Collage** | - | - | Yes |
| **Library Health** | - | - | Yes |
| **Timeline** | - | Yes | Yes |
| **Location Map** | - | - | Yes |

This gives each preset a distinct personality:
- **Minimal:** Stats + People only (fast, clean)
- **Balanced:** Core widgets + Timeline (informative without clutter)
- **Power:** Everything enabled (full data enthusiast mode)