# Pictures of faces (Phase C0 measurement, 2026-11-20: go)

Plan: `docs/plans/pictures-suggestions-plan.md`. Read-only on the user's library (2026-11-20); the contact sheets contain private photos and stay outside the repository.

## 1. Pictures among faces already assigned to people (no GPU needed)
**Question (the user's):** did bulk assignment give a person a face that is only a picture of a face (billboard, poster, framed photo, screen, statue, toy)?
**Method:** 272 of the 12,340 assigned faces (not ignored, human): 150 drawn at random from all of them, plus about 2 to 3 per person for each of the 61 people with assigned faces (so small people are looked at too). Contact sheets as in Phase A: the face box in red with its surroundings, 30 faces per sheet, the person's name on each tile. The assistant looked at every tile; the user reviews.
**Result: 0 of 272 were pictures of faces.** Several tiles have pictures or statues in the background (framed photos on a wall, a statue behind the person, photos pinned up, a doll on a box), but in each the box was on the real person. A few small images with black borders are real small photos.
- Together with the 100 re-matched faces of Phase A (0 pictures), **0 of 372** assigned faces were pictures; the 95% upper limit is about 0.8% (about 100 of the 12,340 at the very most; most likely far fewer).
- Caveat: one labeller (the assistant); pictures with a very real-looking face (a good print or a screen close-up) could pass by eye. The model pass over the assigned faces (plan, order step 1) is what settles it.

## 2. The picture questions on the app's own code path (GPU, 2026-11-20)
Q1 ("a real, living person, or only a picture of one?", crop 3.5 times the box) and Q2 ("inside a frame, painting, poster, mural or screen?", crop 5 times) through the app's model loader (`facelib.vlm.init_vlm`: fp16, eager attention) and its crop code, for 3,845 faces: the 600 labelled faces of Phase A, the 272 assigned faces above, and 3,000 random review-queue faces. 7,690 scores, no failures, about 0.64 s a face per question.

| Model | Picture vs real, cross-validated AUC (480 labelled queue faces, 15 pictures) |
|---|---|
| **Q1 only** | **0.950** (0.965 not cross-validated; Phase A scratch path: 0.96) |
| Q1 + detector score | 0.952 |
| Q1 + Q2 | 0.949 |
| Q1 + Q2 + detector score | 0.951 |
| Detector score only | 0.801 |
**Q1 alone is enough**: adding Q2 or the detector changes nothing, so the final check asks one question (half the GPU time).

### Labelled sample (labels by the assistant from contact sheets; the user reviews)
216 faces from the 3,000: the top 120 by rank (Q1 + detector) not labelled before, 60 random of the next 380, 30 random of the other 2,470, and the 6 highest-scoring assigned faces. Pictures found: framed photos and portraits, billboards and posters, statues, toys and Lego figures, dolls, a puppet, cartoon murals, screens, printed collages, a cup with a print, mascots.
| Group | Pictures | Real | Not a face | Unsure |
|---|---|---|---|---|
| Top 120 | 54 | 38 | 20 | 8 |
| Mid 60 | 3 | 42 | 8 | 7 |
| Low 30 | 0 | 30 | 0 | 0 |
| 6 top assigned faces | 0 | 6 | 0 | 0 |
- **Pictures are about 2.5% of the review queue** (about 1,450 of 59,160), with wide error bars (the low group of 30 carries a weight of 82).
- Q1 ranks them well; at the likelihood cut-offs fitted on these labels (`likelihood = sigmoid(4.607 * Q1 + 9.687)`):

| Likelihood of picture at least | Faces in the queue (est.) | Precision | Recall |
|---|---|---|---|
| 50% (Q1 -2.10) | about 900 | 71% | 44% |
| 60% | about 720 | 75% | 37% |
| **70% (Q1 -1.92)** | **about 540** | **82%** | **30%** |
| 80% | about 360 | 94% | 23% |
| 90% | about 240 | 92% | 15% |
The same cut-offs on the Phase A random sample (independent): 7 flagged at 50%, all pictures; 6 at 70%, all pictures; 2 at 90%, both pictures. **Recall is low** (pictures sit between Q1 -2.75 and -1.6; the list is a ranking, and a lower cut-off adds more pictures and more real faces).
- **Not a face is not what this question finds** (the 20 non-faces in the top 120 are objects, animals and blobs that the question also rates picture-like; the Not a Face? list handles those).
- **Stock cut-out faces** (13, Phase A scratch path): flagged 1 of 13 at 70%, 3 of 13 at 50%, 0 at 90%.

### Assigned faces
None of the 272 assigned faces reaches likelihood 50% (their highest Q1 is -2.36, a real man in front of a painting). So the model agrees with the eye: **0 pictures among 272 assigned faces**, 0 of 372 with Phase A.

## 3. Go or no-go
- Criterion (plan, section 6): at least 60% precision at the default cut-off: **met** (82% at 70%; 71% at 50%).
- **Go.** One question (Q1), default likelihood **70%** for the list and for hiding from Review Needed, choices 50 to 95%.
- Caveats: labels are the assistant's (user review pending); 57 labelled pictures in all; the weights come from a rank-stratified sample, so thresholds shrink somewhat on new data; the model also rates some real faces on boards, masks and toys as picture-like (the review list shows the surroundings).
- Cost: one question, 0.64 s a face: assigned faces (12,340) about 2.2 hours, then the queue (about 59,000) about 10.5 hours, 12.7 hours in all.
