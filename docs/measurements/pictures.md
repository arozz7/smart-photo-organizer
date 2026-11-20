# Pictures of faces (Phase C0 measurement; in progress)

Plan: `docs/plans/pictures-suggestions-plan.md`. Read-only on the user's library (2026-11-20); the contact sheets contain private photos and stay outside the repository.

## 1. Pictures among faces already assigned to people (no GPU needed)
**Question (the user's):** did bulk assignment give a person a face that is only a picture of a face (billboard, poster, framed photo, screen, statue, toy)?
**Method:** 272 of the 12,340 assigned faces (not ignored, human): 150 drawn at random from all of them, plus about 2 to 3 per person for each of the 61 people with assigned faces (so small people are looked at too). Contact sheets as in Phase A: the face box in red with its surroundings, 30 faces per sheet, the person's name on each tile. The assistant looked at every tile; the user reviews.
**Result: 0 of 272 were pictures of faces.** Several tiles have pictures or statues in the background (framed photos on a wall, a statue behind the person, photos pinned up, a doll on a box), but in each the box was on the real person. A few small images with black borders are real small photos.
- Together with the 100 re-matched faces of Phase A (0 pictures), **0 of 372** assigned faces were pictures; the 95% upper limit is about 0.8% (about 100 of the 12,340 at the very most; most likely far fewer).
- Caveat: one labeller (the assistant); pictures with a very real-looking face (a good print or a screen close-up) could pass by eye. The model pass over the assigned faces (plan, order step 1) is what settles it.

## 2. Still to measure (needs the GPU, the app closed)
Q1 (and Q2) on the production path for the 600 labelled faces, the 9 stock cut-out images, this 272-face assigned sample and a random queue sample; then more labelled pictures from the top of the ranking; then the likelihood table and the go/no-go (section 6 of the plan).
