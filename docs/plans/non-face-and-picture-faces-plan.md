# Review Queue: Non-Face Detections and Pictures of Faces (Implementation Plan)

**Status:** Phases approved 2026-11-19. **Phase A measured and the user's label review done** (`docs/measurements/non-face-and-picture-faces.md`, section 7). **Phase F (profile matching) added 2026-11-19, draft, needs approval.** No app code written yet. A first measurement was done read-only on 2026-11-19 (section 2). The user's answers to the open questions (2026-11-19) are in section 8 and are built into the phases.
**Date:** 2026-11-19
**Goal:** Take two kinds of junk out of the review queue without ignoring or deleting anything by itself:
1. **Non-face detections:** the detector boxed something that is not a face (dark blobs, backs of heads, hair, crowd texture, grass).
2. **Pictures of faces:** a real face, but of a picture, not of a person who was there (framed portraits, posters and billboards, TV and LED screens, paintings and murals, packaging, toys).

Both appear as **suggestions the user reviews in bulk**, never as automatic ignores. Related plan: `review-queue-parking-plan.md` (Phase 1 there parks low-value faces; this plan feeds it).

## 1. Problem

The review queue (unassigned, not ignored, human) holds about 55,700 faces. Looking at 160 random ones (2026-11-19) about 4% were pictures of faces and about 6 to 8% were not faces at all.
The user ignores these by hand today. The existing background verification (a small vision-language model asked "is this a real human face?") does not catch them:
it already ran on about 51,500 of the 55,700 queue faces (`verification_attempts > 0`) and these still passed. A face in a painting is still "a human face", and a dark blob often gets a "yes".

## 2. What was measured (real library, read-only; scratch scripts, nothing in the repo changed)

| Question | Result | Confidence |
|---|---|---|
| Pictures of faces in a random 160 of the queue | 6 (3 framed portraits, 1 LED screen, 1 painted icon, 1 mural) = **3.8%**, about 2,100 faces in the queue | Low: 95% range about 1.7% to 8% |
| Non-faces in the same 160 | about 10 (6%), by eye; not counted carefully | Low |
| Small vision-language model (SmolVLM2 2.2B, already shipped) asked two differently worded "is this a picture?" questions, scores combined | On those 160: all 6 pictures in the top 6. **On 300 new faces: about 5 real pictures in the top 40, about 3 in the top 10.** | The first result was tuned on 6 examples and is **not** trustworthy; the second is the honest one |
| What the false hits were | Real people with a picture behind them (billboard, mural, framed portrait on the wall). The same shape as the cardboard cut-out case. | Seen directly |
| Cost of the model question | about 0.6 s per face per question on the RTX 4070 Ti SUPER with the app idle: one question over 56,000 faces is about 8 hours, two about 17 hours | Measured on 460 faces |
| **Phase A (600 labelled faces, 2026-11-19):** detector score separates non-faces from real faces with AUC 0.93; model question Q3 "is a clear face visible" 0.94, both together 0.96; picture check Q1 (real or picture) AUC 0.96, Q1+Q2+detector 0.97 | See `docs/measurements/non-face-and-picture-faces.md`. **This replaces the earlier 8-example rows on the detector score and embedding norm, which were wrong** (the 8 were picked from a list already selected for picture scores). | Medium: one labeller, 15 pictures |
| Head-through-cardboard cut-outs (the user's example): 9 stock images in `M:\SamplePicturesCardCutouts` (scarecrows, sunflowers, witch, monster; 13 real faces) | The app's detector finds all 13 faces. **7 of the 13 score above the cut-off of the top 40 of the 300 held-out faces** (the "possible picture" list). The painted board around a real face looks like a picture to the model. | 13 faces, stock images, not the user's library |

Conclusion: a zero-shot model question is a usable *ranking* but not a clean classifier, and cut-outs show it cannot tell "a picture of a face" from "a real face inside a painted board".
Both buckets must be review lists with a human decision, and the picture list **never gets an unseen bulk ignore**. The "not a face" case has not been tested with any model yet.

## 3. Principles

- **Nothing is ignored or deleted automatically.** A flag is a suggestion. The user confirms in bulk (select page, ignore) or dismisses.
- **Real people in front of a picture are real.** A cut-out with a real head, or a person in front of a billboard, must not be offered for bulk ignore as a "picture". Evaluated explicitly in Phase C.
- **Everything configurable in the app** (project rule): on/off switches, score cut-offs, background run on/off, how much of the GPU time it may use. No setting lives only in a config file.
- **Reversible:** bulk ignores use the normal ignore (`faces.ignore_source` only accepts `user` and `background_verification`; the legacy CHECK cannot change without rebuilding the faces table) and remember that the list did it in `face_flags` (kinds `non_face_ignored`, `picture_ignored`), with an exact-batch Undo like the re-match card. Found when the first build failed on its own new value (see `aiChangeLog/feat-non-face-suggestions.md`).
- **Measure first.** Phase A decides which detector goes into B and C, with go/no-go numbers agreed up front.
- **Idle only and resumable,** like `RematchService`: pauses for scans and AI work, resumes after a restart. The Python process is single-threaded, so work goes in small batches with timeouts (a long call blocks every other command).

## 4. Architecture check (modular)

- **Memory:** table `face_flags (face_id, kind, score, model, created_at, PRIMARY KEY(face_id, kind))` (migration 003, additive) plus settings in app state. `kind` is `non_face` or `picture`. A dismissed flag stays (so the face is not offered again), a bulk ignore uses the normal `faces.is_ignored` columns.
- **Tools:** `FaceScorer` interface: `score(crops) -> numbers per kind`. Implementations: stored-signal scorer, vision-language model scorer, maybe a segmentation-based scorer. Wrapped behind the Python provider like the existing VLM calls.
- **Reasoning:** `FlagService` (pure logic, injected scorer and store): which faces are due, batching, cut-offs, resume. **Proof of modularity:** unit tests run it with a fake scorer and an in-memory store, no GPU and no database.

## 5. Phases

### Phase A: ground truth and measurement (no app code; DONE 2026-11-19, labels under review)
**Result (after the user's review of the labels: 25 of 600 changed, mostly side-profile and blurry faces I had called non-faces):** non-faces are about 10% of the queue (about 5,600 faces), pictures about 3% (about 1,700). Detector score below 0.55 flags 3,846 faces at about 68% precision (non-faces; another 7% are pictures) for free; with the model question Q3 the top 40 of 480 labelled faces are 82% non-faces. The picture check (Q1+Q2+detector) is 60% correct at its top 20 of 455 (about 2,450 faces) and flags 3 of 13 cut-out faces. Both buckets pass the go/no-go for a **review list**; neither qualifies for an unseen bulk ignore yet. Details: `docs/measurements/non-face-and-picture-faces.md`.
- Build a labelled set of about 600 random queue faces plus the cut-out images. Classes: `real`, `non_face`, `picture`, `cutout` (a real face in a cut-out board, to be kept).
  **The assistant labels from contact sheets, the user reviews** (every label can be overruled; the number of overrules is reported as the label error rate).
- Score every signal on it: stored signals (detector score, quality, blur, pose, size, embedding norm), the two model questions, and a segmentation-based test ("is the face inside a frame / poster / screen / painting region", using the installed SAM 3).
- Report precision and recall per signal and combined, **at a cut-off that gives the user a list worth reviewing**.
- **Go/no-go (agreed in principle):** a bucket ships only if the top 200 of its list are at least 60% correct. A sub-list may offer bulk ignore only if it measures at least 95% correct on held-out data, and for pictures it does not (cut-outs, section 2).
- Output: `docs/measurements/non-face-and-picture-faces.md` and the chosen scorers. Tests: none (analysis); scripts kept under `scripts/dev/` if reusable.

### Phase B: "not a face" suggestions
**Part 1 (detector-score list) built 2026-11-19, version 0.8.9** (`aiChangeLog/feat-non-face-suggestions.md`): migration 003, `FlagRepository`, `NonFaceSuggestionService`, IPC, hook, and the Edge Cases filter "Not a Face?" with select page, Ignore selected, Keep and Undo. Deviation: the cut-off is on the list (live counts), not in a Settings card; the card comes with part 2 (model pass, background run). Tasks 1, 2, 5 and 7 below are done for the detector list; task 4 (stored-signal scorer) turned out to be the detector score alone (no scorer class needed); tasks 3 (`FlagService` with fake scorer, background run) and 6 (settings card) come with part 2.
- **Revised by the Phase A result:** ship the **detector-score list first** (stored score below a cut-off the user can set, default 0.55; 3,846 faces now; no model, no GPU, no background run needed), then add the Q3 model question as a second pass that re-ranks the next faces (below 0.75) and finds non-faces with a good detector score.
- Likely candidates (decided by A): stored signals combined (cheap, no GPU), a stricter model question on a tight crop, embedding norm.
- **Profile and hard faces are real (user review, 2026-11-19):** side-profile, turned, looking-down, partly covered and blurry faces are real faces, not junk. Consequences for B: (a) the list shows the pose and quality next to each thumbnail and can be filtered by them; (b) a face is never flagged *because of* its pose (pose is not a scoring input); (c) the cut-off preview tells the user how many flagged faces are turned 45 degrees or more; (d) a face with no visible face (back of head, hair, a turned head showing only hair, e.g. tile 460) stays a non-face; (e) acceptance test: on the labelled set, at most about a quarter of the default list is real faces, and the real ones in it are shown, not hidden.
- Tasks, each test-first:
  1. Migration 003 `face_flags`; test: applies once, idempotent, legacy upgrade path 0 to 3 (extend `legacyUpgrade.integration.test.ts`).
  2. `FlagRepository` (upsert, list by kind and score, dismiss, count, undo of a bulk ignore); tests on real in-memory SQLite.
  3. `FlagService` with fake scorer: only unassigned, non-ignored human faces; skips faces already flagged; batches; pauses when busy; resumes; never throws; records errors.
  4. Stored-signal scorer: pure function, tests with the labelled examples as fixtures.
  5. IPC handlers (zod-validated) and a hook.
  6. Settings card (switch, cut-off, run now, progress, last result) in Database Management, like `RematchCard`.
  7. Review list: a new filter in People, Edge Cases ("Not a face (suggested)"), sorted by score, select page, "Ignore selected", "Not a mistake, keep", Undo. New component files; `People.tsx` is over the size limit and may not grow.

### Phase C: "possibly a picture" suggestions
- Uses the Phase A winner (the two model questions are the baseline; the segmentation test is the main alternative because it can say *where* the frame is).
- Extra tasks over B: the scorer behind the Python provider with a timeout and batch size; GPU memory check before loading; the `cutout` class is part of the acceptance test (the baseline flags 7 of 13 cut-out faces, so there is no unseen bulk ignore for pictures; Phase A/C try to lower that flag rate, for example with the segmentation test or a question about the face and its body); filter "Possible pictures (suggested)".
- **Pictures of named people (decided):** also scan unconfirmed `auto_rematch` faces (the re-match attaches a framed portrait of a named person to that person). A face flagged as a picture of a named person is offered as **"picture of {name}"**: confirming it removes the face from the person and marks it as a picture, remembering whose picture it is (a `picture_ignored` flag in `face_flags`, `suggested_person_id` kept), reversible.
- **Cut-outs:** the acceptance test includes the cut-out images. The list shows the face with its surroundings so the user can tell a real face in a board from a picture; "Keep" teaches the cut-off (Phase E).

### Phase D: background runner and cost control
- Runs only when no scan or AI work is on (see the pause mechanism below), small batches, one second between batches (same pattern as `RematchService`), time budget per day configurable.
- Order of work: highest review value first (faces with at least one twin, then the rest), so the useful part is flagged early.
- **Pause mechanism.** Today the app only knows three conditions: a scan is active, AI work is active, shutdown requested (`AppStateRepository`); the re-match checks them before every step (about a second apart) and a step takes about a quarter of a second. There is **no detection of the user working** in the app yet. Added here:
  1. the same busy check before every batch (scan, AI work, shutdown), so a scan always wins;
  2. a user-activity check with Electron's `powerMonitor.getSystemIdleTime()` (no new dependency): in "low usage" mode a batch only starts when the computer has had no keyboard or mouse input for N minutes (default 5, a setting), and the run pauses when input returns;
  3. a model batch cannot be interrupted once started, so batches stay small (about 8 faces, a few seconds) and the pause happens at the next batch boundary;
  4. the model is unloaded after a few idle minutes so its GPU memory is free again;
  5. setting **Run when: Off / Only when I am away / Whenever nothing else is running**, plus a daily time budget, all on the card.
- Estimated cost with the current model: about 8 hours of idle GPU for one question over the whole queue; Phase A decides whether a cheaper first pass (stored signals, tight crop) can cut that by most.

### Phase F: profile-aware matching (DRAFT, needs approval; separate from the junk lists)
**Why (Phase A review, `docs/measurements/non-face-and-picture-faces.md` section 7):** 28% of the real queue faces (about 13,000) are turned 45 degrees or more. They are not junk but they do not match: their distance to every named person is about 1.29, the same as non-faces. Only 93 of 4,151 confirmed faces (2%) are profiles, and a person's profile face sits at a median 0.97 from their own frontal centroid (frontal: 0.56). Profile faces of the same person do cluster with each other (89% of same-person pairs within 1.0, 0% of different-person pairs, 10 people, 120 faces). Only 11 of 38 people have a profile centroid.
**Principles:** profile faces are never offered for ignore; nothing is assigned without the user; scan-time matching is not changed until measured and approved.
**Phases (each with its own approval):**
- **F0 Measure: DONE 2026-11-19, go (`docs/measurements/profile-matching.md`).** User-labelled 84 queue profile faces: up to distance 1.0, 63 of 63 same person (95% range 94% to 100%); 1.0 to 1.1, 20 of 21 (the error a sibling). Default F1 distance **1.0**, 1.0 to 1.1 only as a wider setting. Reach: 1,837 queue profile faces (12%) at 1.0, about 1,000 at 0.9, for the 24 people with profile examples. Original scope: more profile ground truth from the user's own confirmations (leave-one-out on confirmed profile faces; per-person pose bins), false-pair rate of profile-to-profile at distance 0.8 to 1.0 against the whole queue (not only 10 people), and how many queue profiles each person's profile examples would reach. Output: a measurement note, go/no-go: held-out precision of at least 95% at the suggested distance.
- **F1 Profile examples per person (low risk, user in the loop):** on a person, "Find profile views": suggests unassigned faces with |yaw| of 40 or more that are close to that person's confirmed profile faces (profile-to-profile), shown as a page to confirm in bulk (like the re-match review), Undo. Each confirmation adds profile examples and rebuilds that person's profile centroid.
- **F2 Profile groups in the queue:** a filter "Profiles (grouped)": cluster the unassigned profile faces among themselves, so one name applies to a whole group.
- **F3 Scan-time pose-aware matching:** a separate profile threshold and the per-person profile centroid in `matchBatch`; changes what scans assign, so only after F0 to F2 show enough examples, behind a setting, with a before/after count on the real library.
- **Open dependency:** `matchBatch` compares FAISS squared distances with an L2 threshold (scan matches are looser than the setting says, effective L2 about 0.84 at 0.70). Decide this before F3 because profile distances sit near 0.8 to 1.0.
- **Not in F:** blurry and noisy faces. They are real but their embeddings carry little identity; they belong in the parking plan (`review-queue-parking-plan.md`, Phase 1), not in matching.
- **Tests:** profile-centroid builder and the F1 suggestion query on real in-memory SQLite with fixtures built from synthetic unit vectors; service tests with fake store; hook and card tests like `useRematch`.

### Phase E: learn from the user's decisions (optional)
- Every bulk ignore and dismissal is a new label. Re-measure precision on them and offer a suggested cut-off ("at 0.4 you keep 95% of what you ignore"). Cut-off changes stay a user choice.

## 6. Tests (written before code, per phase)
Migration and repository tests on real SQLite; `FlagService` tests with fake scorer and store (due faces, batching, pause when busy, pause when the user is active and resume when idle (fake idle clock), resume after restart, error handling, no re-offer of dismissed faces);
scorer tests against the labelled fixtures; IPC schema tests; hook and card tests like `useRematch`; legacy upgrade test. Full gate `scripts/dev/verify.ps1` before every push.

## 7. Risks
- **Model quality** (see section 2): mitigated by review-only buckets and the go/no-go in Phase A.
- **GPU and Python contention:** a long model call blocks the single Python process and can time out scans. Mitigation: idle only, small batches, per-call timeout, abort on scan start.
- **Profile and hard faces flagged as junk:** 10 of 41 faces under the default detector cut-off are real (looking down, covered, partial, blurry). Mitigation: review list, pose and quality shown, no bulk ignore without the thumbnails, Undo.
- **Cut-outs and pictures behind people:** may be flagged as pictures. Mitigation: `cutout` class in the acceptance test, per-item review only if it fails.
- **Model availability:** SmolVLM2 is cached locally today; the feature must degrade to "off" when it is missing (no crash, a clear message on the card).
- **Disk and time:** flags are small; the cost is GPU hours, shown on the card.
- **Downgrade:** older builds ignore `face_flags` (additive) but show a downgrade warning.

## 8. Decisions (answered by the user, 2026-11-19)
1. **Labelling:** the assistant labels from contact sheets, the user reviews the labels (disagreements are re-labelled and counted).
2. **Cut-out photos:** `M:\SamplePicturesCardCutouts` (9 stock images, 13 real faces) is part of the Phase A and C acceptance tests, as class `cutout` (real, keep). Photos of this kind from the user's own library are added when found.
3. **Bulk ignore:** sub-lists were considered; the plan's position (to be confirmed once the risks below are read): **no unseen bulk ignore for pictures** (cut-outs would be caught, section 2). For "not a face", a sub-list is allowed only if it measures at least 95% correct on held-out labels. In every case the user sees the thumbnails of the page before "Ignore selected", and Undo exists.
   - Risks of a sub-list: (a) the 95% is measured on a small labelled set, so it has error bars (0 mistakes in 100 held-out faces still allows about 3% real mistakes); (b) a cut-off measured on this library can drift when new photos come (different cameras, lighting), so it is re-measured from the user's own decisions (Phase E); (c) a wrong bulk ignore hides a real face from the review queue (recoverable with Undo and the `ignore_source` tag, but only if the user notices); (d) people mistrust a list they cannot inspect, so the sub-list is shown, not applied silently.
4. **When it may run:** idle-only, or at low usage. Mechanism in Phase D (what exists today and what is added).
5. **Order:** B (non-faces) before C (pictures), as proposed.
6. **Pictures of named people:** offered as "picture of {name}" (Phase C), not left matched to the person.
7. **Label review (2026-11-19):** the user changed 25 labels (13 not-a-face and 10 unsure became real, mostly profile or blurry faces). Tile 460 (a turned head showing only hair) stays "not a face" (user: "technically turned but you cannot see the face"). Profile faces are real; they get Phase F, not an ignore list. User: "proceed with plan changes".

## 9. Change log and docs
Each phase writes `aiChangeLog/feat-<phase>.md` (files, behaviour, tests, assumptions and risks) and updates README settings notes. Version bump per released phase.
