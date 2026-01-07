# Phase 25: Era Generation & Configurable Settings

## Summary
This release introduces "Era Generation" to solve the "Aging Problem" in face recognition. Instead of a single average face model, the system now supports multiple "Eras" (reference centroids) for a single person, allowing accurate matching of a person throughout their life (e.g., Child -> Adult).

## Changes

### Era Generation (Phase E)
- **Visual Clustering:** Implemented K-Means clustering in `PersonService` to group confirmed faces into visual clusters.
- **Date Awareness:** Eras are automatically labeled with year ranges (e.g., "2010-2015") if metadata is available.
- **Multi-Centroid Matching:** `FaceService` now matches new faces against *all* of a person's eras, taking the best match.
- **UI:** Added "Generate Eras" and "Delete Era" controls to the Person Detail page.

### Configurable Settings (Phase F)
- **Settings UI:** Added sliders in `Settings > Era Generation` for:
    - `Min Faces for Era` (Default: 50)
    - `Merge Threshold` (Default: 0.75)
- **Backend Integration:** `PersonService` respects these settings dynamically during generation.

### Stability & Testing (Phase G)
- **Recalculate Model:** Added "Recalculate Model" button to clean up corrupted face models caused by bad merges.
- **Test Backfill:** Added comprehensive unit tests:
    - `PersonService.eras.test.ts`: Verified clustering logic.
    - `FaceService.autoAssign.test.ts`: Verified assignment thresholds.
    - `FaceService.drift.test.ts`: Verified mean recalculation.
    - `PersonRepository.test.ts`: Verified database integrity.

## Technical Details
- **Database:** Added `person_eras` table and `faces.era_id` column.
- **IPC:** Added `db:generateEras`, `db:deleteEra`, `db:recalculatePersonModel`.
- **Refactoring:** Moved clustering constants to `AISettings` store.

## Verification
- Validated that splitting "Baby" and "Adult" photos into Eras improves recognition of new baby photos.
- Confirmed that "Recalculate Model" effectively resets a person's centroid after removing incorrect faces.
