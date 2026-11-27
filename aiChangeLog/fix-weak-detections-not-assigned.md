# Fix: weak detections are no longer assigned to people at scan time (0.8.27)

**Branch:** `feature/pictures-suggestions`.

## Why (found in the real library with 0.8.25)
- Animals (a camel), objects and pictures appeared under a named person with the orange "?" or a blue check. The scan assigns a face to a person when its descriptor is within 0.7 of the person's: it never looked at how sure the detector was that the box is a face. The rule "below 0.40 reject, 0.40 to 0.69 suspect, 0.70 and up human" ran only when a *new* face was inserted, not when the face was assigned.
- Result: 1,636 faces (all of one person) were assigned by the scan with a detector score below 0.70 or still marked suspect, none confirmed; 1,450 of them were still waiting for the vision-model check. The same library has two other sources of unreviewed assignments, not changed here: 5,218 faces confirmed by the one-time migration of 2026-09-16 (its comment: "assumed manually confirmed"), and 2,200 faces the Turned faces list assigned as confirmed on 2026-11-21 to 23.

## What changed
- **`core/services/detectionTier.ts`** (new): `classifyDetection(score, box, acceptScore)` returns 'human' or 'suspect'. It is the rule that decided the entity type of a new face (moved out of `FaceService`, same result), and now also decides whether a face may be assigned.
- **`FaceService.processAnalysisResult`**: a face is assigned to a person at scan time (tier 'high', `auto_scan`) only when its detection is 'human' and the existing face, if any, is not 'suspect'. A weaker detection that matches a person closely falls into the review tier: the person is kept as `suggested_person_id` (the orange "?"), `person_id` stays empty. The accept line is read once per scan from the advanced settings (0.70, or the strict-mode value).
- **Migration 007 `weak_scan_assignments`** (one time, every person): unconfirmed faces with `assignment_source = 'auto_scan'`, not ignored, with a score below 0.70 or entity 'suspect', go back to suggestions (`person_id` NULL, tier 'review', source 'ai_scan', the person stays as the suggestion). New table `assignment_repair_log` keeps each face's former person, tier and source, so it can be undone. Never touched: confirmed faces, assignments from any other source, ignored faces, faces with no score. The library is backed up before migrations run (existing behavior).

## Behavior notes
- Dry run on a copy of the real library (live file untouched): 1,636 faces move, all of one person; none remain; `integrity_check` ok. The rule found weak scan assignments for no other person.
- Undo (by hand, with the app closed): `UPDATE faces SET person_id = l.former_person_id, confidence_tier = l.former_tier, assignment_source = l.former_source FROM assignment_repair_log l WHERE faces.id = l.face_id`.
- The search index and person models follow the named faces in the background; they refresh on their own schedule.
- Faces moved back to suggestions are mostly 'suspect'; the vision-model check (background face verification) decides them when scanning has stopped.

## Tests (written first)
`detectionTier.test.ts`; `FaceService_Scanning.test.ts` (weak detection near a person: suggestion only; at the accept line: assigned; box not shaped like a face: suggestion); `migrations/weakScanAssignmentsMigration.test.ts` (several people, suspect with a high score, clear detections, confirmed, other sources, ignored, no score, unassigned, log content, run twice); registry and legacy-upgrade tests updated for version 7.

## Not done yet
- **Visibility check over assigned faces.** The face-visibility check only ever looks at unassigned faces (`person_id IS NULL`) with a low detector score, so it has scored 5 of the 5,218 migration-confirmed faces and 313 of the 2,200 Turned-faces assignments. Running it over assigned faces needs a new candidate query, a review list for assigned faces, and actions (unassign, ignore); planned next.
- The Turned faces list saves its assignments as confirmed; whether it should save loose ones as unconfirmed is undecided.
