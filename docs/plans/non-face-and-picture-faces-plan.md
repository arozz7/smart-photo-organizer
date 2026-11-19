# Review Queue: Non-Face Detections and Pictures of Faces (Implementation Plan)

**Status:** DRAFT, awaiting approval. No code written. A first measurement was done read-only on 2026-11-19 (section 2).
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
| Detector score for 8 non-faces | 0.42 to 0.85 (queue median 0.84): it does **not** separate them | 8 examples |
| Stored embedding size (norm) for the same 8 | two clearly low (9.8, 11.6), the rest near the lower quartile (18); stored norms are a mix of raw (about 21) and unit-length (1.0) values | Weak signal, 8 examples |
| Head-through-cardboard cut-outs (the user's example) | **Not tested.** No such photos found by description search. | Needs examples |

Conclusion: a zero-shot model question is a usable *ranking* but not a clean classifier. Both buckets must be review lists with a human decision. The "not a face" case has not been tested with any model yet.

## 3. Principles

- **Nothing is ignored or deleted automatically.** A flag is a suggestion. The user confirms in bulk (select page, ignore) or dismisses.
- **Real people in front of a picture are real.** A cut-out with a real head, or a person in front of a billboard, must not be offered for bulk ignore as a "picture". Evaluated explicitly in Phase C.
- **Everything configurable in the app** (project rule): on/off switches, score cut-offs, background run on/off, how much of the GPU time it may use. No setting lives only in a config file.
- **Reversible:** bulk ignores carry their own `ignore_source` (`non_face_review`, `picture_review`) and an Undo like the re-match card.
- **Measure first.** Phase A decides which detector goes into B and C, with go/no-go numbers agreed up front.
- **Idle only and resumable,** like `RematchService`: pauses for scans and AI work, resumes after a restart. The Python process is single-threaded, so work goes in small batches with timeouts (a long call blocks every other command).

## 4. Architecture check (modular)

- **Memory:** table `face_flags (face_id, kind, score, model, created_at, PRIMARY KEY(face_id, kind))` (migration 003, additive) plus settings in app state. `kind` is `non_face` or `picture`. A dismissed flag stays (so the face is not offered again), a bulk ignore uses the normal `faces.is_ignored` columns.
- **Tools:** `FaceScorer` interface: `score(crops) -> numbers per kind`. Implementations: stored-signal scorer, vision-language model scorer, maybe a segmentation-based scorer. Wrapped behind the Python provider like the existing VLM calls.
- **Reasoning:** `FlagService` (pure logic, injected scorer and store): which faces are due, batching, cut-offs, resume. **Proof of modularity:** unit tests run it with a fake scorer and an in-memory store, no GPU and no database.

## 5. Phases

### Phase A: ground truth and measurement (no app code; about one session)
- Build a labelled set of about 600 random queue faces plus any extra the user supplies. Classes: `real`, `non_face`, `picture`, `cutout` (a real face in a cut-out board, to be kept).
  Labels come from contact sheets; the user spot-checks the ambiguous ones.
- Score every signal on it: stored signals (detector score, quality, blur, pose, size, embedding norm), the two model questions, and a segmentation-based test ("is the face inside a frame / poster / screen / painting region", using the installed SAM 3).
- Report precision and recall per signal and combined, **at a cut-off that gives the user a list worth reviewing**.
- **Go/no-go (proposed, to be agreed):** a bucket ships only if the top 200 of its list are at least 60% correct and bulk ignore is only offered for a sub-list that measures at least 95% correct on held-out data. Otherwise that bucket stays per-item.
- Output: `docs/measurements/non-face-and-picture-faces.md` and the chosen scorers. Tests: none (analysis); scripts kept under `scripts/dev/` if reusable.

### Phase B: "not a face" suggestions
- Likely candidates (decided by A): stored signals combined (cheap, no GPU), a stricter model question on a tight crop, embedding norm.
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
- Extra tasks over B: the scorer behind the Python provider with a timeout and batch size; GPU memory check before loading; the `cutout` class is part of the acceptance test (flag rate on cut-outs must be low, otherwise this bucket never gets a bulk ignore); filter "Possible pictures (suggested)".
- Open design point: pictures of **named** people. The re-match (0.8.8) assigns a framed portrait of a named person to that person as unconfirmed. Decide whether Phase C also scans unconfirmed `auto_rematch` faces and offers them as "picture of {person}".

### Phase D: background runner and cost control
- Runs only when no scan or AI work is on, small batches, one second between batches (same pattern as `RematchService`), time budget per day configurable.
- Order of work: highest review value first (faces with at least one twin, then the rest), so the useful part is flagged early.
- Estimated cost with the current model: about 8 hours of idle GPU for one question over the whole queue; Phase A decides whether a cheaper first pass (stored signals, tight crop) can cut that by most.

### Phase E: learn from the user's decisions (optional)
- Every bulk ignore and dismissal is a new label. Re-measure precision on them and offer a suggested cut-off ("at 0.4 you keep 95% of what you ignore"). Cut-off changes stay a user choice.

## 6. Tests (written before code, per phase)
Migration and repository tests on real SQLite; `FlagService` tests with fake scorer and store (due faces, batching, pause when busy, resume after restart, error handling, no re-offer of dismissed faces);
scorer tests against the labelled fixtures; IPC schema tests; hook and card tests like `useRematch`; legacy upgrade test. Full gate `scripts/dev/verify.ps1` before every push.

## 7. Risks
- **Model quality** (see section 2): mitigated by review-only buckets and the go/no-go in Phase A.
- **GPU and Python contention:** a long model call blocks the single Python process and can time out scans. Mitigation: idle only, small batches, per-call timeout, abort on scan start.
- **Cut-outs and pictures behind people:** may be flagged as pictures. Mitigation: `cutout` class in the acceptance test, per-item review only if it fails.
- **Model availability:** SmolVLM2 is cached locally today; the feature must degrade to "off" when it is missing (no crash, a clear message on the card).
- **Disk and time:** flags are small; the cost is GPU hours, shown on the card.
- **Downgrade:** older builds ignore `face_flags` (additive) but show a downgrade warning.

## 8. Decisions needed from the user
1. **Who labels** the Phase A set: the assistant labels from contact sheets and the user spot-checks, or the user labels in a small review page.
2. **Cut-out photos:** a folder or a few photo names (amusement park, face-through-board) so they can be part of the test.
3. **Bulk ignore policy:** allowed only for sub-lists that measure at least 95% correct (proposed), or always per-item?
4. **GPU budget:** idle-only background hours per day, or a one-off "run now" overnight.
5. **Order:** B (non-faces, no model needed, likely the larger win) before C (pictures), as proposed?
6. **Pictures of named people:** keep them matched to the person, or offer them as "picture of {person}"?

## 9. Change log and docs
Each phase writes `aiChangeLog/feat-<phase>.md` (files, behaviour, tests, assumptions and risks) and updates README settings notes. Version bump per released phase.
