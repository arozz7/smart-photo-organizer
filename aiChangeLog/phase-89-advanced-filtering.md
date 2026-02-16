# Phase 89: Advanced Library Filtering (v0.6.5)

## Goal
Implement a comprehensive Search & Filter system with dedicated Search View, core photo filters, face-based filters, compound AND/OR/NOT logic, and Smart Albums (saved filter presets).

## Files Created
| File | Purpose |
|------|---------|
| `src/types/filterTypes.ts` | Shared filter interfaces (`PhotoFilter`, `CompoundFilter`, `SmartAlbum`, etc.) |
| `src/hooks/useSearch.ts` | Independent search state hook (decoupled from ScanContext) |
| `src/views/Search.tsx` | Search view with filter sidebar + virtualized photo grid |
| `src/components/FilterPanel.tsx` | Collapsible filter sidebar (Quality, Date, Camera, File Type, Faces, Smart Albums) |
| `src/components/FilterBuilder.tsx` | Visual compound AND/OR/NOT filter builder modal |
| `electron/data/repositories/SmartAlbumRepository.ts` | Smart Album CRUD operations |
| `electron/types/filterTypes.ts` | Backend-side filter types (avoids cross-boundary import) |

## Files Modified
| File | Changes |
|------|---------|
| `electron/data/repositories/PhotoRepository.ts` | Extended `getPhotos()` with 13 new filter conditions; added `getCameraModels()`, `getYears()`, `getFileTypes()`, `getPhotosByCompoundFilter()` |
| `electron/db.ts` | Added `smart_albums` table migration |
| `electron/ipc/dbHandlers.ts` | Added IPC handlers for metadata queries, search, and Smart Album CRUD |
| `electron/infrastructure/PythonAIProvider.ts` | **Bug fix:** Now saves `globalBlurScore` and `description` to `photos` table after scan |
| `src/App.tsx` | Added `/search` route |
| `src/components/Layout.tsx` | Added "Search" NavLink |

## Behavior Changes
- New **Search** tab in navigation between Library and Create
- **Filter sidebar** with collapsible sections: Search, Quality (blur presets), Date (year/month + range), Camera, File Type, Faces (has faces, unnamed, frontal, quality, confidence), Folder/Tag/Person, Smart Albums
- **Blur presets**: Sharp (100+), Medium (30-100), Blurry (<30) with manual min/max override
- **Active filter chips** in top bar with individual remove and "Clear all"
- **Sort options**: Newest, Oldest, Name A-Z, Name Z-A
- **Compound filter builder**: Groups of conditions with per-condition NOT toggle, per-group AND/OR, top-level AND/OR
- **Smart Albums**: Save current filters as named presets, load/delete from sidebar
- **Landing state** when no filters active (prevents loading entire library)
- **Bug fix**: Photo-level blur scores (`photos.blur_score`) are now persisted during scanning — previously computed by Python but never saved by Electron

## Assumptions & Risks
- Existing photos have NULL `blur_score` — users must rescan to populate blur data
- Compound filter queries build SQL dynamically; all values use parameterized queries for safety
- Smart Albums store filter config as JSON; schema changes to `PhotoFilter` could invalidate saved albums
