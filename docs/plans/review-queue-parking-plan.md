# Review Queue: Parking Low-Value Faces (Implementation Plan)

**Status:** Phase 0 built on `feature/parked-faces` (0.8.6), verified, PR #87 not yet merged. Phase 2 (re-match, approved design below) built on `feature/rematch-unassigned` (0.8.7), verified on a scratch copy, see `aiChangeLog/feat-rematch-unassigned-phase2.md`. Phases 1 and 3 await approval.
**Date:** 2026-11-18
**Goal:** Cut the hours spent reviewing and ignoring faces of people the user does not want to track, without ignoring or deleting anything.

## 1. Problem

Importing many thousands of photos produces tens of thousands of unassigned faces, most of them strangers who appear once. Reviewing and ignoring them
by hand takes hours. Matching new faces against already-ignored faces does not help (measured below), because ignored faces are mostly different strangers.

## 2. Measurements (real library, read-only, 2026-11-18)

Library: 92,680 faces; 60,666 unassigned and not ignored; 3,562 faces in 36 named people; 28,452 ignored (14,998 by the user, 13,454 by the background verifier).

| Question | Result |
|---|---|
| Unassigned faces within L2 0.5 of an ignored face | 252 (0.4%); at 0.55: 403 (0.7%). Zero were closer to a named person. Too small to matter. |
| Unassigned faces with no other unassigned face within L2 0.5 ("singletons") | 42,389 (69.9%) |
| Faces you ignored that were singletons | 99% |
| Named faces that are singletons (no other face within 0.5) | 26.8% (953 of 3,562); 4 of 36 people have over half their faces as singletons. **A singleton is not proof of a stranger.** |
| Face area under 8,000 px² (about 90x90): named vs unassigned | 1.8% vs 15.5% (9,424 faces) |
| Blur score under 60: named vs unassigned | 0.9% vs 9.2% |
| Low quality (area under 8,000 or blur under 60) | 13,789 unassigned faces |
| Quality passes **and** has at least one twin | **14,126** (the "worth reviewing" queue) |
| Quality passes and has 2 or more twins | 7,498 |
| Quality passes but singleton | 32,751 |

Parked = 60,666 minus 14,126 = **46,540** faces (13,789 low quality + 32,751 quality singletons). The review queue would be 77% smaller.

Scripts used (scratchpad, not in repo): `ignored_match.py`, `workload.py`, `risk.py`, `combined.py`. They measured on `descriptor` (not `descriptor_v2`).

## 3. What exists today (found in code, not assumed)

- `BackgroundBucketingService` clusters faces with `needs_bucketing = 1` in batches, auto-assigns those within L2 0.8 of a named centroid, puts clusters of 2 or more into
  discovery buckets (DBSCAN eps 0.17 cosine, min_samples 2), and marks singles as processed noise. Singles are **never looked at again**: on the real library all
  60,666 unassigned faces have `needs_bucketing = 0`, and 54,726 are in no bucket (5,940 are in 3,016 discovery buckets).
- `FaceRepository.getUnassignedDescriptors()` returns all 60,666 unassigned faces and feeds the People-page clustering (`aiHandlers.ts`), which is what the user reviews.
- **Ignored-face re-check** (Phase B5): `db:startIgnoredRecheck` plus `BackgroundBucketingService.processRecheckBatch()` re-match ignored faces against named centroids and
  put matches in a bucket, leaving `is_ignored = 1`. This is the "catch what was missed" mechanism the user pointed to; this plan reuses it for parked faces.
- `entity_type = 'suspect'` (12,217 ignored faces) marks faces likely not human; it is a separate mechanism and stays as is.
- `FaceRepository.ts` is over the file-size limit and may not grow. New queries go in new repository files.

## 4. Design

**Parked is a computed view, not a new state and not "ignored".** A face is parked when it is unassigned, not ignored, and either:
1. low quality: face area under `minFaceArea` (default 8,000 px²) or blur score under `minBlurScore` (default 60); or
2. a singleton: no other unassigned face within `twinDistance` (default L2 0.5) and not within the suggestion distance of a named person.

Nothing is deleted or ignored. Parked faces stay in the database, can be browsed ("Review parked"), and return to the queue by themselves when they get a twin or
match a named person. All three numbers are settings.

Why this answers the concern "ignored faces would be different people": no decision is made about the face. A stranger who shows up in a second photo
gets a twin and moves into the queue; a stranger who appears once stays parked and costs nothing.

## 5. Phases

### Phase 0: Read-only Parked count (no behaviour change)
Tasks:
- `electron/data/repositories/ParkedFaceRepository.ts` (new): the unassigned faces with area, blur and descriptor.
- `src/python/commands/neighbour_counts.py` (new Python command): for N descriptors return how many others lie within `twinDistance`; chunked float32 matrix product
  (the scratch version took about 20 s for 60k faces). Runs only when no scan or AI work is active.
- `electron/core/services/ParkedFaceSummaryService.ts` (new): pure function `classifyParked(faces, counts, settings)` plus a thin service that caches the result keyed by a
  fingerprint of the unassigned set (count, id sum), so it recomputes only when the set changes.
- IPC `db:getParkedSummary` returning `{ unassigned, lowQuality, singleton, worthReviewing, parked, nearNamed }`; shown as a read-only card in Edge Cases and logged once at INFO.
  `nearNamed` (singletons within the suggestion distance of a named person, which would not be parked) is not yet measured.

Tests first:
- `classifyParked`: low quality; singleton; singleton near a named centroid is not parked; twin and good quality is worth reviewing; boundary values; empty set.
- `neighbour_counts.py`: known vectors, chunk boundaries, identical descriptors (duplicate photos), empty input.
- Fingerprint caching: unchanged set does not recompute; adding or assigning a face does.

Acceptance: on the real library the card shows numbers within 1% of section 2 (60,666 / 46,877 quality pass / 14,126 worth reviewing / 46,540 parked), the
computation does not block the People page, and it is skipped while a scan runs.

### Phase 1: Use it for the review queue (behind a setting, off by default)
- `getUnassignedDescriptors({ excludeParked })` in a new file (no growth of `FaceRepository.ts`); `ai:clusterFaces` and the unnamed-face count honour the setting.
- "Parked" count and a "Review parked" view (sorted by quality, then by size), so nothing is out of reach.
- Setting and thresholds in the clustering settings modal. Measure People-page open time with and without (hypothesis: a smaller input also shortens the roughly 69 s open; to be measured, not assumed).

Tests first: the queue excludes parked faces only when the setting is on; "Review parked" returns exactly the complement; thresholds change membership.

### Phase 2: Re-match unassigned faces against named people (proposal 2026-11-18, awaiting approval)

**Measured first (read-only, real library, `recheck_precision.py`):** 7,999 of the 60,666 unassigned faces are within 0.8 of a named person (351 within 0.5; 1,451 within 0.6; 2,604 within 0.65; 4,082 within 0.7; 5,903 within 0.75).
Reliability evidence: 0 of 2,781 human faces you ignored yourself are within 0.8 of any named person; for the 3,562 confirmed faces the nearest person is the right one in every band up to 0.9
(in-sample, so optimistic); 79% / 87% / 96% of confirmed faces lie within 0.65 / 0.7 / 0.8 of their own person. None of the 3,562 named faces came from auto-suggestion, so the unconfirmed review path has not been used on this library yet.
Why these faces were missed: the background grouping matches a face once, when it is first processed; people named afterwards are never compared against faces already processed.

**Design (approved 2026-11-18: default 0.65 from the existing setting, automatic with a switch):**
- **Distance: its own setting, default 0.65, 0.4 to 0.8, chosen on the card** (stored in app state as `rematch_distance`). The plan first said to reuse the Face Similarity Threshold, but the value stored in the installed app is **0.85** (a legacy fallback), which would have
  made the re-match far looser than the approved 0.65 and tied it to scan-time matching. A run keeps the distance it started with.
- **Automatic:** a background service checks every minute. When no scan or AI work is active, it starts a run if (a) it never ran, or (b) the named people's centroids or the threshold changed since the last run, and at least 30 minutes have passed since the last run.
  A switch "Run automatically" (default on) and a "Run now" button sit in a new card in Settings > Database Management, next to the Parked card, together with progress, the last result and "Undo re-match".
- A run matches each unassigned, not ignored, human face with a descriptor against the named people (same `FaceService.matchAgainstCentroids`, same centroids incl. eras and poses as the background grouping) and assigns matches **unconfirmed**,
  `assignment_source = 'auto_rematch'`, with `match_distance` stored. They appear on the person's page behind the existing "unconfirmed" filter with the distance badge; confirming makes them normal, removing sends them back to unassigned.
- **A rejected match is never repeated:** every assignment is recorded in a new table `rematch_log (face_id, person_id, distance, assigned_at)` (migration 002, additive). A face is not re-assigned to a person it was already re-matched to, so removing a face (or "Undo re-match") sticks, and the automatic run cannot loop.
- **Undo:** "Undo re-match" returns every face still `auto_rematch` and unconfirmed to unassigned (person cleared, source back to `ai_scan`), forgets those log pairs (a true revert) and switches the automatic runs off. Confirmed ones are never touched.
- **Face search index:** unconfirmed re-matches are kept out of the FAISS index (used to match new scans) until confirmed.
- Batches of 300 faces with yields, one batch per step, only while no scan or AI work is active; progress (last face id, counts) is stored in app state so a run resumes after a restart. Ignored faces and non-human faces are never touched.
- A failed run records the error and does not retry until the people or threshold change.

Tests first: only unassigned, not-ignored, human faces are matched; the setting's distance is used; matches are unconfirmed with source and distance stored; a logged face/person pair is skipped; undo reverts only unconfirmed `auto_rematch` faces; busy means no progress and resume continues at the stored position; automatic start rules (never ran, people changed, threshold changed, interval, switch off, nobody named); manual start refusals (busy, already running, nobody named); an error ends the run without a retry loop.
New files only (`FaceRepository.ts`, `dbHandlers.ts`, `People.tsx` are over the size limit): migration `002_rematchLog.ts`, `RematchRepository.ts`, `RematchService.ts`, `RematchDeps.ts`, `rematchHandlers.ts`, `useRematch.ts`, `RematchCard.tsx`, tests, change log, version 0.8.7.

**Phase 2b (after Phase 2, if wanted): re-check parked faces.** Generalise the ignored-face re-check (`processRecheckBatch`) to run over a source set, then use it for parked faces.
- Triggers: (a) after faces are named or assigned (existing dirty-flag path), so faces now near a new or updated centroid return to the queue or are suggested; (b) after a scan adds faces, so a face that just gained a twin is promoted.
- Reuses `FaceService.matchAgainstCentroids` and the same idle-only gating as the existing service.
- Keep the existing ignored re-check as is; both can be run from one control.

Tests first: parked face near a newly named person is released; parked face that gets a twin after a scan is released; faces still isolated stay parked; no run while a scan or AI work is active; resumable after shutdown.

### Phase 3: Tune and verify on real data
- Show 200 randomly chosen parked faces to the user (read-only) and count how many they would have wanted; adjust thresholds from that, not from my guess.
- Track "released from parked" counts for a few weeks of use.

## 6. Risks and open questions

- 27% of named faces are singletons (odd poses, one-off shots). That is why parked is not ignored, and why a face near a named person is never parked. Expect some wanted faces to sit in Parked until a second photo arrives.
- Twins are counted only among unassigned faces. After someone is named, their remaining faces leave that pool, so new photos of them look like singletons until matched to the named centroid; the `nearNamed` exemption is essential and must be tested.
- Open: which descriptor does clustering use, `descriptor` or `descriptor_v2` (both columns exist)? Phase 0 must use the same one.
- Open: `twinDistance` 0.5 vs the bucketing eps (0.17 cosine, about L2 0.58). Phase 0 reports counts for both so the choice is visible.
- The first computation on 60k faces takes tens of seconds; it must run in the background and never block the AI backend while the People page is loading (the Python backend handles one request at a time).

## 7. Housekeeping (project rules)

- Branch `feature/parked-faces` from `main`; version bump (0.8.6) and `aiChangeLog/feat-parked-faces.md` per phase; docs and README updated as each phase lands.
- `scripts/dev/verify.ps1` must pass before every push; new files keep under the file-size limit; `FaceRepository.ts` does not grow.
- No GitHub Actions; no deletions; no data is ignored, deleted or reassigned by Phase 0.
- Real library is only ever opened read-only by me; behaviour is tested on a scratch user-data directory.

## 8. Phase 0 result (2026-11-18)

Built as a Settings card (not Edge Cases: `People.tsx` is over the size limit). See `aiChangeLog/feat-parked-faces-phase0.md`. On the real library, measured with the
app's own logic, query, file format and chunking: 60,666 unassigned; 13,789 low quality; 35,492 appear once; **49,281 parked; 11,385 worth reviewing**; 37 s in eight requests.

What changed in the plan because of the measurement:
- **The same shot saved more than once is one appearance** (the user's point about RAW files and exported JPGs, which will matter more in the newer folders). Twins now must come from a different
  shot: not the same photo, not the same file name in the same folder (so `IMG_1.CR2` and `IMG_1.jpg`), not the same capture second, and never an exact copy. Counting copies as twins had given 14,126
  worth reviewing; with real twins only it is 6,365 plus 5,020 lone faces kept for being near a named person. Today's library has no RAW files, so the effect now is mostly frames in the same second and re-saved copies.
- **Placeholder dates exist:** 3,682 and 1,099 photos share two default capture seconds, so a capture time shared by more than 20 photos is ignored for grouping.
- **"Near a named person" has no natural cut-off:** lone clear faces within 0.5: 26; 0.6: 489; 0.7: 2,091; 0.8: 5,020. Default stays at the app's suggestion distance 0.8 until Phase 3 samples show where it should be.
- **5,020 lone faces are within the app's own suggestion distance of a named person** and were never re-matched after those people were named. This is a direct, concrete case for Phase 2's re-check, and may be worth doing before Phase 1.
- Answered: clustering and this count use `descriptor`, not `descriptor_v2`. Both twin distances (0.5 and 0.58) are reported: 35,492 vs 32,438 appear once.
- Still open: photos of one scene taken seconds apart (not the same second) still give twins.

## 9. Out of scope (later)

- **Pet recognition and tracking.** Needs an animal detector, a pet embedding model, naming UI and a separate index. Existing `pet-classification-plan.md` only keeps pets out of human people. Separate plan to follow.
- Auto-ignoring faces that match ignored faces (measured at 0.4–0.7%; not worth it).
