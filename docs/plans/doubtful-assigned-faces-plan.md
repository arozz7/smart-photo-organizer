# Doubtful faces: checking faces that are already assigned to people

**Status:** built in 0.8.29. Needs the first overnight run and a look at the list on the real library.

## Why
Animals, objects, hands and pictures of faces ended up under named people through three routes: the scan assigned weak detections (fixed in 0.8.27), the migration of 2026-09-16 confirmed every existing assignment, and the Turned faces list saves its assignments as confirmed. The "is a clear face visible?" check only looked at unassigned faces, so it never saw them. Of the 20,379 assigned faces, 347 had a score.

## What it is
1. **A background check over assigned faces** (`AssignedVisibilityRepository`, `AssignedVisibilityDeps`): the same question and the same stored score as the unassigned check (`face_flags` kind `face_visibility`, so a face is never scored twice), with its own run mode and away time (Settings > Database Management > Check Assigned Faces). It takes the person with the most faces first, then the lowest detector score. It waits for scans and AI work like the other checks.
2. **A list, Edge Cases > Doubtful faces** (`DoubtfulFaceRepository`, `DoubtfulFaceService`, `doubtful:*` channels, `useDoubtfulFaces`, `DoubtfulFaces`): assigned faces the model scored at or above a chosen level, the most doubtful first, filterable by person.
3. **Three actions, nothing automatic:**
   - *Keep (real face)*: not offered again here or in the other lists. Nothing else changes.
   - *Back to suggestions*: the face leaves the person (unconfirmed, tier review, the person stays as the suggestion) and appears in Review Needed.
   - *Not a face (ignore)*: the face is ignored.
   Both of the last two remember the former person, confirmed state, source, distance, tier and suggestion in `doubtful_log` (migration 008), and Undo restores exactly that. The person's centroids are rebuilt after every change.

## Decisions taken while building (differences from the plan as approved)
- **No detector-score cut-off.** The plan copied the 0.75 cut-off of the unassigned check. Measured on the real library, only 618 of 20,379 assigned faces score under 0.75 (most score 0.85 or more), so the cut-off would have skipped almost the whole pool. Every assigned face is checked: about 0.6 s a face on the GPU, about 3.4 hours for the pool.
- **The level is the model's own score, not a percentage.** The calibrated likelihood was fitted on unassigned faces with a detector score under 0.75, so it would be a guess for assigned faces. The list offers whole-number levels 1 to 5 (default 3), each shown with the number of faces it gives, and the page says it is not a percentage. The measured spread of the model's score: median 1.3, 75th percentile 2.5, 90th 3.7.

## Not done / open
- Which level is right is not known until the check has run over the pool; the counts per level will show it. The default of 3 is a starting point.
- The Turned faces list still saves its assignments as confirmed.
