# Phase 108 — Blurry Photo Export (Tools View)

## Summary
Added a **Tools** view with a **Blurry Photo Export** panel — lets users find photos below a configurable sharpness threshold, browse them grouped by folder or GPS location, and export a CSV report.

---

## Files Created
| File | Purpose |
|---|---|
| `src/views/Tools.tsx` | New Tools view with a tool-picker sidebar (extensible for future tools) |
| `src/components/BlurryPhotosPanel.tsx` | Blurry photo list UI — threshold slider, group-by toggle, table, CSV export |
| `tests/backend/unit/PhotoRepository.blurry.test.ts` | 6 unit tests for `getBlurryPhotos()` |
| `aiChangeLog/phase-108-blurry-export.md` | This changelog |

## Files Modified
| File | Change |
|---|---|
| `electron/data/repositories/PhotoRepository.ts` | Added `BlurryPhotoRow` interface + `getBlurryPhotos()` method |
| `electron/ipc/dbHandlers.ts` | Added `photo:getBlurryPhotos` IPC handler |
| `src/App.tsx` | Added `/tools` route |
| `src/components/Layout.tsx` | Added **Tools** sidebar link (MixerHorizontalIcon, Tools section) |

---

## Behavior

### `PhotoRepository.getBlurryPhotos(options)`
- Queries `photos` WHERE `blur_score IS NOT NULL AND blur_score < threshold`
- `groupBy: 'folder'` → orders by `DIRNAME(file_path) ASC, blur_score ASC`
- `groupBy: 'location'` → orders by `json_extract(metadata_json, '$.GPSLatitude') ASC, blur_score ASC`
- `groupBy: 'none'` → orders by `blur_score ASC`
- Returns `{ photos: BlurryPhotoRow[], total: number }` with pagination (limit/offset)

### IPC: `photo:getBlurryPhotos`
- Thin handler in `dbHandlers.ts`, delegates to `PhotoRepository.getBlurryPhotos`
- Returns `{ success, photos, total, error? }`

### BlurryPhotosPanel
- Threshold slider: 1–500 (default 50), higher = sharper
- Group by: Folder / Location / None (segmented toggle)
- Paginated table (100/page) with "Load more"
- Score color coding: red < 10, orange < 25, yellow otherwise
- **Export CSV** — downloads `blurry-photos-threshold-<timestamp>.csv`
  - Columns: File Path, Folder, Blur Score, Date Taken, Location

### Tools View
- Side panel with "Library Tools" section for future tool additions
- Currently: Blurry Photo Export

---

## Tests Added (`PhotoRepository.blurry.test.ts`)
1. Returns photos and total for `groupBy=none`
2. Uses `ORDER BY DIRNAME(file_path)` for `groupBy=folder`
3. Uses GPS ORDER BY for `groupBy=location`
4. Passes threshold as WHERE parameter
5. Respects custom limit and offset
6. Returns empty results when no photos below threshold
7. Throws descriptive error on DB failure

---

## Assumptions & Notes
- Blur score is Variance of Laplacian (higher = sharper). Threshold 50 is a reasonable default for typical library photos.
- Export CSV exports only the currently-loaded page batch, not all pages — the button label shows the count to make this transparent. Users can increase the limit or load all pages before exporting.
- The Tools view is designed for future expansion (Corrupt File Recovery, Face Dataset Export, etc.).
