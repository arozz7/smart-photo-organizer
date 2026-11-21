# Pictures of faces: suggestions, including faces already assigned to people (Phase C Implementation Plan)

Status: **APPROVED 2026-11-20** (decisions in section 9). **Phase C0 done 2026-11-20: go** (`docs/measurements/pictures.md`): one question (Q1) is enough, default likelihood 70% (precision 82%), 0 pictures among 272 assigned faces; cost 0.64 s a face, about 12.7 hours for all assigned and unassigned faces. Detail of Phase C in `non-face-and-picture-faces-plan.md`; adds the user's request of 2026-11-20: also check faces that are **already assigned** to people, in case a bulk assignment gave someone a picture of a picture (a billboard, poster, framed photo, screen, statue).
No app code is written before this plan is approved.

## 1. Problem
- Pictures of faces sit in Review Needed (the user saw a billboard face), and some may already be assigned to a person. An assigned picture is in that person's centroids (the frontal and profile ones in full; the overall mean drops far faces) and in the face search index (FAISS) as that person, so later photos of the same billboard or poster match them.
- The detector cannot tell a picture from a face (it is a clear face). The Not a Face? list and the model check ("is a clear face visible?") do not catch pictures at all.

## 2. What was measured (Phase A, `docs/measurements/non-face-and-picture-faces.md`; scratch path, 15 pictures only)
- Pictures are about **3.1%** of the review queue (about 1,700 faces). Among 100 re-matched (assigned) faces none was a picture (the upper bound is about 3.7%): assigned faces were never measured on enough samples.
- Model question Q1 "a real, living person, or only a picture of one?" separates pictures from real faces at **AUC 0.96**; Q2 (inside a frame, poster or screen, wider crop) 0.73; Q1 + Q2 + detector score 0.97. Top 20 of 455 labelled faces held 12 of the 15 pictures (60% precision, 80% recall).
- Stock cut-out images (real faces in boards) are flagged too: 3 of 13 at that cut-off. So **no unseen bulk action**, as agreed: every list shows thumbnails and every action can be undone.
- Cost: one question is about 0.7 s a face on the GPU (8 faces about 6 s).

## 3. Principles
Suggestions only (the model ranks, the user decides); thumbnails and context shown before any action; Undo restores exactly; idle-only background work with the pause mechanism of the model check; configurable in the app; nothing is deleted.

## 4. What the user gets
One Edge Cases tab, **Pictures?**, with a switch between two lists, both ranked by the likelihood that the box is a picture:
- **Unassigned faces** (Review Needed): tile with the face and its surroundings, likelihood, pose. Actions: **Ignore as picture**, **Keep (real face)**, Undo.
- **Assigned faces**, grouped by person: tile, the person's name, **how it was assigned** (scan, re-match, naming a group; confirmed or not), likelihood. Actions: **Remove from {name} and ignore as picture**, **Keep**, Undo. Removing rebuilds that person's centroids; the search index follows (it is rebuilt when the set of named faces changes).
- Header: how many faces are checked out of all, assigned faces first, likelihood choice (50 to 95%), and what the check is doing (card in Settings, below).
- **On by default** (decision 3): "Hide possible pictures from Review Needed", the same idea as for non-faces: the faces of the unassigned list at its current likelihood are left out of Review Needed's clusters and count, with the same notice, and are reviewed in Pictures?. Turning it off brings them back. Because about 1 in 4 hits at the Phase A cut-off could be a real face on a board, the default likelihood is set by Phase C0 so that the hidden set is the high-confidence part of the list.

## 5. Design
- **Scorer (Python):** command `score_face_picture` (`src/python/commands/face_picture.py`), same shape as `score_face_visibility`: batches of at most 16, per-face errors, refuses a non-GPU engine, the crop helpers of `face_visibility.py`, the question and crop measured in Phase C0: Q1 only, crop 3.5 times the box, `likelihood = sigmoid(4.607 * Q1 + 9.687)` (to be refitted after the user's review of the labels). Score = log-odds of the first answer word (PICTURE against REAL). The packaged engine must be rebuilt (`npm run build:python`; the release guard enforces it).
- **Order of the background pass:** (1) assigned faces (about 12,000 now: about 2.5 hours for one question), (2) unassigned faces by detector score, highest first (clear faces; the junk list covers the low scores): about 59,000, so the whole pass is about **15 hours for one question** (two nights; it resumes by itself and never repeats a face). Two questions would double that, so Phase C0 decides whether Q2 is worth it.
- **Service:** `PictureCheckService` built like `FaceVisibilityService` (`BackgroundLoop`, modes **Off / Only when I am away / Whenever no scan or AI work is running**, Run now, status, back-off after an engine failure, state in the database). A scan or AI work always wins. Both checks use the one Python engine: the picture check starts when the visibility check has nothing due.
- **Storage:** scores in `face_flags` (kind `picture`, `score`, `model` = a new version name; a new wording means new scores). **Migration 005** `picture_log(face_id PK, action 'ignored' | 'kept', former_person_id, former_confirmed, former_source, created_at)` so that Undo gives a face back **exactly** as it was (person, confirmed state, source). No change to existing constraints (the ignore uses `ignore_source = 'user'`).
- **Actions:** guarded writes in one transaction, re-checking that the face is still a suggestion and still assigned the way the list showed (a face the user changed meanwhile is skipped), the same pattern as the non-face and turned-face lists (not `assignFacesToPerson`, which un-ignores).
- **Lists:** repositories like `FlagRepository` / `RankedNonFaceRepository`; assigned list joins `people` and the assignment columns; IPC (zod `.strict()`): `picture:getOverview`, `list`, `setMode`, `setLikelihood`, `ignore`, `keep`, `undo`, `setHide`; hook `usePictureSuggestions`, component `PictureSuggestions.tsx`, a card `PictureCheckCard` in Settings; the tab goes through `EdgeCaseSuggestionPanels` (`People.tsx` may not grow).

## 6. Phase C0: measure first (needs the GPU; about 1 to 2 hours; no app code)
The numbers above are from the scratch path with 15 pictures. Before shipping a cut-off:
1. Re-run Q1 (and Q2) on the **production path** (fp16, eager attention, the app's crop code), on the existing 600 labels plus the 9 stock cut-out images.
2. Label **more pictures**: faces from the top of the ranking (stratified) until at least 40 labelled pictures, and a **sample of about 150 assigned faces** (every person represented) to see how many pictures bulk assignment really took in. Contact sheets as before: the assistant labels, the user reviews.
3. Fit the likelihood table (like `visibilityModel.ts`), choose Q1 alone or Q1 + Q2 by the numbers, and report precision at 50 to 95% with its error bars. **Go/no-go for a review list: at least 60% precision at the default cut-off** (it is only a ranking), and the cut-out flag rate stated.
The measurement runs on the GPU, so it runs when the user says the machine is free (or overnight).

## 7. Tasks (TDD: tests first; one task at a time; files over 900 lines may not grow)
1. C0 measurement and report `docs/measurements/pictures.md`; go/no-go; chosen question(s) and weights.
2. Python `face_picture.py` and tests (crop geometry, batch behaviour with a fake model, per-face errors), rebuild engine, check the packaged engine answers the command.
3. Migration 005 and repositories (real schema via `applyLegacyBaseline`): candidate queues (assigned first), score storage, lists, guarded ignore / keep / undo with exact restore, centroid rebuild hook.
4. `visibilityModel`-style likelihood module and `PictureCheckService` (modes, idle, busy, resume, back-off, order) with fake dependencies.
5. IPC and handler tests; hooks, tab, card; People.tsx unchanged in size.
6. Change log, version bump, `verify.ps1`, build (with `npm run build:python`), smoke test.
- **Manual check by the user (owed):** the Pictures? tab on the real library after the first night; the assigned list for people with many faces.

## 8. Risks
- **Real faces in boards, masks and costumes may be flagged** (cut-outs 3 of 13 in Phase A); never bulk without the thumbnails. The list shows the surroundings so the user can tell a real face on a board from a picture.
- **Small label set** (15 pictures so far): C0 raises it; thresholds are re-measured from the user's own decisions later (Phase E).
- **Removing a face from a person changes that person** (face count, centroids, index): shown on the card, reversible, done only on the user's action.
- **GPU time and heat:** about 15 hours in total, idle only, paused by any activity, Off by default until the user chooses a mode.
- **Both checks share one engine:** small batches, one at a time, the busy check before each batch.

## 9. Decisions (answered by the user, 2026-11-20)
1. **Assigned faces first** in the overnight order, then the queue by detector score.
2. **Removing an assigned picture** ignores it as a picture (out of the person, the centroids and the index); Undo restores it exactly.
3. **Hide possible pictures from Review Needed: ON by default** (see section 4 for how the default cut-off is chosen).
4. **Run mode default:** "Only when I am away" (no keyboard or mouse input for the set time; the user will leave it running overnight).
5. **Phase C0 first**: the cut-off comes from numbers on the real library, with the user's review of the sheets.

## 10. Change log and docs
`aiChangeLog/feat-pictures-suggestions.md`, README settings notes, `docs/measurements/pictures.md`, the parent plan updated. Version bump per released step.
