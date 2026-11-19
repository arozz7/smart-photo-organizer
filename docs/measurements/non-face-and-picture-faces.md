# Phase A measurement: non-face detections and pictures of faces

**Date:** 2026-11-19. **Plan:** `docs/plans/non-face-and-picture-faces-plan.md` (Phase A). **Status:** measured; labels reviewed by the user on 2026-11-19 (section 7). Sections 2 to 6 are the numbers with the assistant's original labels; section 7 has the corrected numbers, which are the ones to use.
Read-only on the real library. No private images or face ids are stored in the repository; the review sheets live outside it (`J:\Projects\spo-phaseA-review`).

## 1. Method
- **Sample:** 500 random faces from the review queue (unassigned, not ignored, human; 55,665 at the time) and 100 random re-matched faces (unconfirmed `auto_rematch`; 4,404 at the time). Contact sheets with the detected box and its surroundings.
- **Labels (by the assistant, from the sheets):** `real` (any real face, even small, dark, blurry or in profile; also a real face in front of a poster or statue), `not a face` (blob, back of head, hair, object, animal), `picture` (framed photo, poster, billboard, illustration, statue, toy figure), `unsure`.
  Queue: 396 real, 59 not a face, 15 picture, 30 unsure. Re-matched: 100 real.
- **Signals tested:** stored detector score, quality, blur, pose, face width, embedding norm; and three questions to the shipped vision-language model (SmolVLM2 2.2B, answer score = log-odds of the first word, no tuning on this sample):
  Q1 "real, living person, or only a picture of one?", Q2 "is the face inside a frame, painting, poster, mural or screen?" (wider crop), Q3 "is a clearly visible human face in the middle of this image?" (tight crop).
- **Measure:** AUC (0.5 = no signal, 1.0 = perfect) and how many true cases are in the top N of the sample. Unsure faces are left out of the numbers.

## 2. Prevalence in the review queue (455 labelled queue faces without the unsure ones)
| Class | Count | Share | 95% range | Extrapolated to 55,665 |
|---|---|---|---|---|
| Not a face | 59 | 13.0% | 10.2% to 16.3% | about 7,200 (5,700 to 9,100); up to about 18% if every unsure one were a non-face |
| Picture of a face | 15 | 3.3% | 2.0% to 5.3% | about 1,800 (1,100 to 2,900) |
| Pictures among 100 re-matched faces | 0 | 0% | up to about 3.7% | none seen; their model scores were lower than every picture in the queue |

The first small look (160 faces, "about 6 to 8% not faces") understated non-faces: it counted by eye without a protocol.

## 3. Signals
| Signal | Not a face vs real (AUC) | Picture vs real (AUC) |
|---|---|---|
| Detector score (lower = worse) | **0.93** | 0.82 |
| Embedding norm (lower = worse) | 0.85 | 0.51 |
| Quality / blur / pose / width | 0.5 to 0.68 | 0.57 to 0.73 |
| All stored signals combined (cross-validated) | 0.93 (no better than the detector score alone) | not tried |
| Q1 real or picture | 0.61 | **0.96** |
| Q2 in a frame, poster or screen | 0.49 | 0.73 |
| Q3 visible face | **0.94** | 0.48 |
| Q3 + detector score | **0.96** | 0.68 |
| Q1 + Q2 | 0.59 | 0.95 |
| Q1 + Q2 + detector score | 0.79 | **0.97** |

**Correction to the plan's first draft:** it said the detector score "does not separate" non-faces. That came from 8 examples picked from a list already selected for high picture scores. On 455 random labelled faces it is the best cheap signal.

### Not a face, by detector score alone (no model, free)
| Flag when score is below | Faces flagged in the sample | Non-faces | Real faces | Precision | Recall | Faces in the whole queue |
|---|---|---|---|---|---|---|
| 0.55 | 41 | 29 | 9 (and 3 pictures) | 71% | 49% | **3,846** |
| 0.65 | 52 | 34 | 14 (and 4 pictures) | 65% | 58% | 5,992 |
| 0.75 | 98 | 45 | 45 | 46% | 76% | not counted |

Adding Q3 (model, about 0.6 s per face): the top 10 of the 455 are all non-faces, the top 20 contain 18, the top 40 contain 32 (**80%**). Top 40 of 455 is about 8.8% of the queue, about 4,900 faces.

### Picture of a face, by Q1 + Q2 + detector score
Top 10 of 455: 7 pictures; top 20: 12 pictures (**60%**, recall 80%); top 40: 13 pictures (33%). Top 20 is about 4.4% of the queue, about 2,450 faces.
Pictures found: framed photos and portraits, billboards and posters, a cake print, an illustration, statues, a toy figure, a character decoration.

## 4. Cut-out test (9 stock images, 13 real faces in boards; the detector found all 13)
At the Q1 + Q2 cut-off of rank 20 in the sample, **3 of the 13 cut-out faces are flagged** (23%), at rank 40 five of 13. Pictures versus (real faces + cut-outs): AUC 0.95.
Cut-outs score lower than true pictures (median 1.7 against 3.3) but not low enough to be safe from a bulk action. These are stock images, not the user's photos.

## 5. Against the plan's go/no-go bars
- **Not a face:** top of the list is at least 60% correct for the first 8.8% of the queue (80% for the top 40 of 455 with Q3). **Passes for a review list.** Bulk ignore of a sub-list: the top 10 are 10 of 10, but 10 examples only prove about 72% with 95% confidence; a sub-list needs about 100 held-out labels with at most 3 mistakes. **Not yet.**
- **Picture:** 60% at the top 20 of 455 (about 2,450 faces) with the detector score added. **Passes for a review list.** Cut-outs are flagged, so **no unseen bulk ignore** (as agreed).

## 6. Cost and caveats
- The model questions took 1,014 s for 1,800 answers (0.56 s each, RTX 4070 Ti SUPER, app closed). Stored signals cost nothing.
- Single labeller (the assistant), 15 pictures, thresholds read off the same sample (in-sample): expect the numbers to shrink somewhat on new data. The 160 + 300 face earlier sets were not labelled and are kept as a held-out check.
- The segmentation-based test (SAM 3) from the plan was **not run**: the model questions already reach AUC 0.95 for pictures. It stays an option if the cut-out flag rate must come down.
- Review sheets and `labels.csv` in `J:\Projects\spo-phaseA-review` (outside the repository: private photos).

## 7. After the user's review (2026-11-19)
The user changed 25 of the 600 labels: 13 of my 59 "not a face" and 10 of my 30 "unsure" were real faces, and 2 of my "real" were not (tile 51: the box is on a pitcher, my error; tile 460: a turned face, mostly hair, borderline). Corrected queue counts: 417 real, 48 not a face, 15 picture, 20 unsure (the re-matched 100 stay real).
The user's note on most of the changes: side profile, turned or looking down, or blurry and noisy.

| Class | Count | Share of 480 labelled | Extrapolated to 55,665 |
|---|---|---|---|
| Not a face | 48 | 10.0% (7.6% to 13.0%) | about 5,600 (4,200 to 7,200) |
| Picture of a face | 15 | 3.1% (1.9% to 5.1%) | about 1,700 |
| Real face with |yaw| of 45 degrees or more | 116 of 417 real | 28% of real faces, about 13,000 faces |

**Junk signals got better, not worse** (the removed confusion was real profiles): not a face versus real, detector score AUC 0.95 (was 0.93); Q3 + detector AUC 0.97 with 10 of the top 10, 18 of the top 20 and 33 of the top 40 non-faces (82%). Detector score below 0.55 flags 41 of 480 (8.5%): 28 non-faces, 3 pictures, 10 real (precision 68% for non-faces, recall 58%). Only 2 of those 10 real faces are profiles; the rest are looking down, covered, partial or blurry. Pictures are unchanged (Q1 + Q2 + detector: 12 of 15 in the top 20).

**Profile and blurry faces do not match, and this is a separate problem from junk:**
| Group (queue, labelled real unless noted) | n | median distance to nearest confirmed face | within 0.90 |
|---|---|---|---|
| Real, agreed | 394 | 1.21 | 25% |
| I said not a face, user said real (mostly profiles) | 13 | 1.29 | 0% |
| I said unsure, user said real (blurry, noisy) | 10 | 1.29 | 0% |
| Not a face (final) | 48 | 1.29 | 0% |
| Re-matched (for reference) | 100 | 0.64 | 100% |

- The corrected profile faces sit as far from every named person as non-faces do (random unit vectors are about 1.41 apart). Distance to a centroid or an index cannot tell them from junk.
- Confirmed library faces: 2,544 at |yaw| under 15, 1,298 at 15 to 30, 216 at 30 to 45, **93 at 45 or more (2%)**. A person's own face against their own frontal centroid (leave one out): median 0.56 at under 30, 0.66 at 30 to 45, **0.97 at 45 or more (6% within 0.70, 36% within 0.90)**.
- Profile faces of the same person do cluster with each other: 120 confirmed faces with |yaw| of 40 or more (10 people): same-person pairs median 0.85, different-person pairs 1.40; at distance 1.0, 89% of same-person pairs and 0% of different-person pairs. Caveat: 10 people only, and burst shots from one moment can inflate the same-person pairs.
- The matching code already has a per-person profile centroid (`profile_centroid_json`), but only 11 of 38 people have one, and scan-time FAISS matching compares against individual faces, of which only 2% are profiles.
- Reading: the profile faces are not junk and must never go in an ignore list. They are not matched because the named side has almost no profile examples, so they stay in the queue. Needs its own plan (profile-aware matching), see the plan's change log.

## 8. The model question on the production code path (Phase B part 2, 2026-11-19)
The Phase A model numbers came from a scratch script (bfloat16, default attention). The app loads the same model with `facelib.vlm.init_vlm` (**fp16, eager attention**), so the question was re-measured through the new engine command
(`commands/face_visibility.py`, the same crop: a square of 1.8 times the box on the preview image, 384 px) on the same 480 labelled queue faces with the user's corrected labels (48 non-faces). 0.7 s a face, no failures.

| Wording of the question | Model alone (AUC) | Model + detector (AUC) | Detector alone (AUC) |
|---|---|---|---|
| **A**: "clearly visible human face (eyes, nose and mouth, not the back **or side** of the head, not hair, not an object)" (the Phase A wording) | 0.930 | **0.972** | 0.946 |
| **B**: "a human face ... a face that is turned, seen from the side, looking down, partly covered, small, dark or blurry still counts ... NO only if there is no face at all" | 0.800 | 0.939 | 0.946 |
| Phase A path (bfloat16) for comparison | 0.930 | 0.970 | |

So the production path reproduces Phase A for wording A (the precision and dtype change nothing). Wording B, written to be fair to profile faces, **loses most of the signal**: with the detector it is no better than the detector alone.

**Wording A leans against turned faces, as its text says (it excludes "the side of the head").** The median model score (higher = "no face") is 2.61 for non-faces, -1.39 for frontal real faces and **+0.43 for real faces turned 45 degrees or more**: the model is half way to "no face" for them.
In the combined ranking this shows in the wider lists: of the top 20 by the combined score 18 are non-faces (1 turned real face); top 40: 30 (3 turned real); top 60: 38 non-faces and 10 turned real faces; top 80: 45 and 21.

**Calibrated likelihood** (logistic regression on the model score and the detector score, 5-fold cross-validated, AUC 0.968), wording A (wording C below is the same to within one face):
| Likelihood of not a face at least | Faces (share of the queue) | Non-faces | Turned real faces |
|---|---|---|---|
| 50% | 35 (7.3%) | 27 (77%) | 4 |
| 60% | 32 (6.7%) | 27 (84%) | 3 |
| 70% | 27 (5.6%) | 25 (93%) | 0 |
| 80% | 23 (4.8%) | 21 (91%) | 0 |
| 90% | 20 (4.2%) | 19 (95%) | 0 |

Against the detector list at a similar recall (detector score below 0.50: 36 faces, 26 non-faces = 72%), the 70% likelihood list holds about the same number of non-faces (25) with **93% instead of 72% precision** and no turned real face in this sample.
Caveats: 48 non-faces, in-sample cut-offs (cross-validated for the probabilities, not for the weights), one labeller; the lists at 70% and above hold about 27 of 480 faces, so the 93% is 25 of 27 (95% range about 76% to 99%).

### Two more wordings, and what ships
| Wording | Model alone (AUC) | Model + detector (AUC) | Median score, turned real faces | Calibrated list at 70% |
|---|---|---|---|---|
| A (original, "not the back or side of the head") | 0.930 | 0.972 | +0.43 | 27 faces, 25 non-faces, 0 turned real |
| **C**: A without "or side" ("not only the back of the head, not hair, not an object") | 0.930 | **0.971** | +0.40 | 27 faces, 25 non-faces, 0 turned real |
| D: "a human face ... seen from the front or from the side? NO only if the back of a head, hair, a hand, clothing, bare skin or an object" | 0.842 | 0.961 | +0.06 (but non-faces only +0.58) | 24 faces, 21 non-faces, 1 turned real |
| B (turned, side, looking down ... still counts) | 0.800 | 0.939 | -1.53 | 24 faces, 18 non-faces, 1 turned real |

- Removing "or side" changes nothing measurable: **the lean against turned faces belongs to the model, not to the wording** (turned real faces score about +0.4 under A and C, against -1.2 to -1.4 for frontal real faces and +2.5 for non-faces).
  The wordings that make turned faces score lower do so by flattening the whole scale (B, D), and lose the separation.
- **C ships**: same strength as A without a pose exclusion written into the question. Fitted weights (model, detector, intercept): 1.123, -7.312, 2.126.
- What this means for the lists: the model list is safe at 70% likelihood and above in this sample (no turned real face in 27), and the wider lists (60% and below) start to bring in turned real faces (2 to 4 of 30 to 35 at 50 to 60%; 10 of the top 60 by raw rank).
  The list therefore shows pose on every tile, counts the turned faces in its header, and says that the model leans against faces seen from the side. Profile matching (Phase F) does not depend on this list.
