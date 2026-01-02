# Phase 15: Person Thumbnail Management

## Diff Narrative
This phase introduced manual control over Person Thumbnails (Cover Photos), a highly requested customization feature.

### 1. Database Schema
- **Modified** `people` table: Added `cover_face_id` (INTEGER NULL).
- **Migration**: Added safe schema upgrade logic in `db.ts`.

### 2. Backend Logic
- **Updated** `PersonRepository`:
    - `getPeople()` now LEFT JOINs on `cover_face_id` to override the default "best blur score" face if a manual cover is set.
    - Added `setPersonCover(personId, faceId)` to update the record.
- **Updated** `dbHandlers`:
    - New IPC channel `db:setPersonCover` exposed to frontend.

### 3. Frontend Experience
- **Updated** `PersonDetail` View:
    - Added "Shuffle Cover" button (picks random high-quality face).
    - Added "Unpin" button (reverts to auto-selection).
- **Updated** `PersonFaceItem`:
    - Added "Set as Cover" action button on hover.
    - Added "Pinned" badge for the current cover.

### 4. Verification
- Verified schema migration on startup.
- Tested:
    - Pinning a specific face -> Immediate update on People list? (Requires refresh, added `loadData` trigger).
    - Shuffling -> Updates cover_face_id.
    - Unpinning -> `cover_face_id` becomes NULL, repo falls back to `BestFaces` CTE.

## Files Modified
- `electron/db.ts`
- `electron/data/repositories/PersonRepository.ts`
- `electron/ipc/dbHandlers.ts`
- `src/types/index.ts`
- `src/hooks/usePersonDetail.ts`
- `src/components/PersonFaceItem.tsx`
- `src/views/PersonDetail.tsx`
