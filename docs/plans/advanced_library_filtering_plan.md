# Advanced Library Filtering - Implementation Plan

## Goal
Implement a comprehensive filtering system with **AND/OR/NOT** logic, a dedicated **Search View**, and **Smart Albums** for saving filter presets.

---

## Approved Scope

✅ **All 3 phases** will be implemented  
✅ **NOT logic** supported in compound filters  
✅ **Dual date filtering**: File creation date + EXIF DateTimeOriginal  
✅ **Dedicated Search View**: New tab/page separate from scanning  
✅ **Smart Albums**: Save filter presets for reuse

> [!NOTE]
> **Performance**: Camera model filters require parsing `metadata_json`. May need column denormalization for 50k+ photo libraries.

---

## Proposed Changes

### Phase 1: Core Photo Filters + Search View

---

#### [MODIFY] [PhotoRepository.ts](file:///j:/Projects/smart-photo-organizer/electron/data/repositories/PhotoRepository.ts)

Extend `getPhotos()` to support new filter parameters:

**New Filter Parameters:**
```typescript
interface PhotoFilter {
  // Existing
  folder?: string;
  search?: string;
  tag?: string;
  people?: number[];
  untagged?: boolean;
  
  // NEW - Phase 1
  blurScoreMin?: number;      // Min sharpness (0-100)
  blurScoreMax?: number;      // Max sharpness (0-100)
  
  // Dual Date Support
  dateType?: 'file' | 'exif'; // Which date to filter on
  dateFrom?: string;          // ISO date string
  dateTo?: string;            // ISO date string
  year?: number;              // Specific year
  month?: number;             // Specific month (1-12)
  
  camera?: string;            // Camera model substring
  fileType?: string;          // Extension (e.g., '.arw')
  hasFaces?: boolean;         // true = has faces, false = no faces
}
```

**Implementation Changes:**
- Add blur score range condition: `blur_score >= ? AND blur_score <= ?`
- Add date range with `dateType` switch:
  - `'file'`: Use `created_at` column
  - `'exif'`: Use `json_extract(metadata_json, '$.DateTimeOriginal')`
- Add camera filter: `json_extract(metadata_json, '$.Model') LIKE ?`
- Add file type filter using `EXTNAME()` function
- Add face presence: `id IN/NOT IN (SELECT photo_id FROM faces)`

---

#### [NEW] [filterTypes.ts](file:///j:/Projects/smart-photo-organizer/src/types/filterTypes.ts)

Create shared filter type definitions:

```typescript
export interface PhotoFilter {
  // Core
  folder?: string;
  search?: string;
  tag?: string;
  people?: number[];
  untagged?: boolean;
  
  // Photo Quality
  blurScoreMin?: number;
  blurScoreMax?: number;
  
  // Date
  dateFrom?: string;
  dateTo?: string;
  year?: number;
  month?: number;
  
  // Technical
  camera?: string;
  fileType?: string;
  
  // Faces
  hasFaces?: boolean;
  faceQualityMin?: number;
  frontalFacesOnly?: boolean;
  
  // Meta
  initial?: boolean;  // Existing flag
}
```

---

#### [MODIFY] [dbHandlers.ts](file:///j:/Projects/smart-photo-organizer/electron/ipc/dbHandlers.ts)

Add new IPC handlers for filter metadata:

- `db:getCameraModels`: Returns distinct camera models from library
- `db:getYears`: Returns distinct years from photos
- `db:getFileTypes`: Returns distinct file extensions

---

#### [NEW] [Search.tsx](file:///j:/Projects/smart-photo-organizer/src/views/Search.tsx)

Create a dedicated **Search View** as a new navigation tab, separate from Library (scanning).

**Layout:**
- Left sidebar: Filter panel with all filter options
- Main area: Photo grid with results
- Top bar: Active filter chips + Clear All button

**Filter Panel Sections:**
1. **Quality**: Blur score range slider
2. **Date**: Type toggle (File/EXIF) + Year/Month dropdowns + date range picker
3. **Camera**: Dropdown of detected camera models
4. **File Type**: Multi-select extension chips (.jpg, .arw, .nef, etc.)
5. **Faces**: Has faces toggle, unnamed faces toggle
6. **Smart Albums**: Saved filter presets dropdown

---

#### [MODIFY] [App.tsx](file:///j:/Projects/smart-photo-organizer/src/App.tsx)

Add new route: `/search` → `Search.tsx`

#### [MODIFY] [Layout.tsx](file:///j:/Projects/smart-photo-organizer/src/components/Layout.tsx)

Add "Search" navigation tab alongside Library, People, etc.

---

### Phase 2: Face-Based Filters

These filters leverage the face analysis data from Phase 5 (Challenging Face Recognition).

---

#### [MODIFY] [PhotoRepository.ts](file:///j:/Projects/smart-photo-organizer/electron/data/repositories/PhotoRepository.ts)

**New Filter Parameters:**
```typescript
// Phase 2 additions
faceQualityMin?: number;      // Min face quality score
frontalFacesOnly?: boolean;   // Only photos with frontal faces (|yaw| < 30°)
hasUnnamedFaces?: boolean;    // Only photos with unassigned faces
confidenceTier?: 'high' | 'review' | 'unknown';
```

**Implementation:**
- Join with `faces` table for quality/pose filtering
- Use aggregate conditions: `EXISTS (SELECT 1 FROM faces WHERE photo_id = photos.id AND face_quality >= ?)`

---

#### [NEW] [FilterPanel.tsx](file:///j:/Projects/smart-photo-organizer/src/components/FilterPanel.tsx)

Create a dedicated advanced filter panel component:

**Features:**
- Collapsible section design
- Face quality slider
- "Frontal Faces Only" toggle
- "Unnamed Faces" toggle
- Active filter chips with remove buttons

---

### Phase 3: Compound Logic

Enable combining filters with AND/OR logic.

---

#### [MODIFY] [PhotoRepository.ts](file:///j:/Projects/smart-photo-organizer/electron/data/repositories/PhotoRepository.ts)

**Compound Logic with AND/OR/NOT:**

```typescript
interface FilterCondition {
  field: string;           // e.g., 'tag', 'camera', 'blur_score'
  operator: '=' | '!=' | '>' | '<' | 'LIKE' | 'IN' | 'NOT IN';
  value: any;
  negate?: boolean;        // NOT modifier
}

interface FilterGroup {
  conditions: FilterCondition[];
  logic: 'AND' | 'OR';     // How to combine conditions within group
}

interface CompoundFilter {
  groups: FilterGroup[];
  groupLogic: 'AND' | 'OR'; // How to combine groups
}

// Example: (tag=vacation AND NOT camera=iPhone) OR (year=2024 AND hasFaces=true)
```

**NOT Support:**
- Individual condition negation via `negate: true`
- SQL generation: `NOT (condition)` wrapping
- UI: "Exclude" toggle per filter condition

---

#### [NEW] [FilterBuilder.tsx](file:///j:/Projects/smart-photo-organizer/src/components/FilterBuilder.tsx)

Visual filter builder component:

**Features:**
- Add/remove filter conditions
- Group conditions with AND/OR/NOT
- "Exclude" toggle per condition (NOT logic)
- Visual representation of filter logic tree
- Save as Smart Album button

---

### Phase 4: Smart Albums

---

#### [MODIFY] [db.ts](file:///j:/Projects/smart-photo-organizer/electron/db.ts)

Add new table:
```sql
CREATE TABLE IF NOT EXISTS smart_albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  filter_json TEXT NOT NULL,  -- Serialized CompoundFilter
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### [NEW] [SmartAlbumRepository.ts](file:///j:/Projects/smart-photo-organizer/electron/data/repositories/SmartAlbumRepository.ts)

CRUD operations for smart albums:
- `create(name, filter)`: Save new smart album
- `getAll()`: List all smart albums
- `getById(id)`: Get single album with filter
- `update(id, name, filter)`: Update existing
- `delete(id)`: Remove album

#### [MODIFY] [dbHandlers.ts](file:///j:/Projects/smart-photo-organizer/electron/ipc/dbHandlers.ts)

New IPC handlers:
- `db:createSmartAlbum`
- `db:getSmartAlbums`
- `db:updateSmartAlbum`
- `db:deleteSmartAlbum`

---

## Summary of New Files

| File | Purpose |
|------|---------|
| `Search.tsx` | Dedicated search/filter view |
| `filterTypes.ts` | Shared TypeScript interfaces |
| `FilterPanel.tsx` | Advanced filter sidebar component |
| `FilterBuilder.tsx` | Compound logic filter builder |
| `SmartAlbumRepository.ts` | Smart album persistence |

## Summary of Modified Files

| File | Changes |
|------|---------|
| `PhotoRepository.ts` | Extended filter logic with AND/OR/NOT |
| `dbHandlers.ts` | IPC handlers for metadata + smart albums |
| `db.ts` | Smart albums table |
| `App.tsx` | New /search route |
| `Layout.tsx` | Search nav tab |

---

## Verification Plan

### Automated Tests
- Unit tests for `PhotoRepository.getPhotos()` with new filter combinations
- Verify SQL injection prevention with parameterized queries
- Test edge cases: empty results, null blur_score, missing metadata_json

### Manual Verification
1. **Blur Score Filter**: Verify slider correctly filters blurry vs sharp photos
2. **Date Filter**: Filter by year, verify correct results
3. **Camera Filter**: Filter by camera model, verify EXIF parsing works
4. **File Type Filter**: Filter by .arw vs .jpg
5. **Has Faces Filter**: Verify face presence filter works
6. **Compound Logic**: Test AND/OR combinations produce correct results

### Browser Testing
- Use the browser subagent to verify filter UI responsiveness
- Test filter persistence across navigation
- Verify "Clear All" resets correctly

---

## Implementation Order

1. **Phase 1a**: Create `Search.tsx` view + navigation
2. **Phase 1b**: Backend filter logic (`PhotoRepository.ts`) with core filters
3. **Phase 1c**: IPC handlers for metadata (`dbHandlers.ts`)
4. **Phase 1d**: Frontend filter panel UI
5. **Phase 2**: Face-based filters (backend + frontend)
6. **Phase 3**: Compound AND/OR/NOT logic
7. **Phase 4**: Smart Albums (DB table + CRUD + UI)
