# Profile faces: can turned faces be matched to named people? (Phase F0 measurement, 2026-11-19)

Plan: `docs/plans/non-face-and-picture-faces-plan.md`, Phase F. Read-only measurement on the user's library (30,069 photos); scratch scripts, no app code, no library change. The labels below were made by the user from contact sheets (private photos; sheets and CSV stay out of the repository).
Profile means |yaw| of 40 or more (the plan's F1 threshold). Distances are L2 on unit-length descriptors (random unit vectors are about 1.41 apart).

## 1. Reference data (confirmed named faces)
- 9,691 faces count as confirmed (`is_confirmed = 1`, not ignored, descriptor present) for 48 people. **Caveat:** these are the faces the matcher placed (and the scan marks as confirmed), not only faces the user checked one by one.
- Profile faces among them: **422** (|yaw| 40 or more), **318** (45 or more), **115** (60 or more). They come from 24 people; **12 people have 3 or more, 10 have 5 or more**. Zeus holds 143, Mimi 86. How they were assigned: 270 by the re-match, 152 by scans.
- The queue (unassigned, human, not kept): 53,604 faces, **14,779 with |yaw| of 40 or more**.

## 2. Same person or not, among the confirmed profile faces (leave one out)
Nearest other profile face, from another photo and at least one hour apart (removes bursts and same-event neighbours):

| Distance up to | Faces answered | Same person |
|---|---|---|
| 0.6 | 32% | 100% |
| 0.8 | 83% | 100% |
| 0.9 | 90% | 100% |
| 1.0 | 94% | 100% |
| 1.1 | 95% | 100% |

- **Different people stay far apart:** the closest profile pair of two different people is **1.12**, the median closest is 1.24. No confirmed profile face has another person's profile example within 1.1.
- Bias: these are faces that already matched, so this is the best case. It is why the user's labels below matter more.
- Using frontal and profile faces together as references gives the same precision at a slightly higher reach (99% answered within 0.8), so a profile face is not hard to place once any confirmed example of the person exists.

## 3. Reach on the queue
Unassigned profile faces whose nearest confirmed profile example is within a distance (always exactly one person within that distance):

| Distance up to | Faces | Share of the 14,779 |
|---|---|---|
| 0.8 | 405 | 2.7% |
| 0.9 | 1,022 | 6.9% |
| 1.0 | 1,837 | 12.4% |

Nearest people within 0.9: Mimi 218, Zeus 169, Kaley 106, Carlos 98, Eleni 87, Abo 78, Moe 74, Juanita 66. Reach is limited by who has profile examples (24 people).

## 4. A check that needs no labels
A person appears once per photo, so a suggestion for a person who is already confirmed in the same photo is wrong. Of the queue profile faces whose nearest example is within 1.0: **0 of 1,837 point to someone already in the photo**. At 1.0 to 1.1: 4 of 886 (0.5%); at 1.1 to 1.2: 23 of 1,316 (1.7%), which is the chance rate (1.3% for a random person and photo). Matches beyond about 1.1 behave like random pairings.

## 5. The user's labels (84 queue profile faces, 21 per distance bin, at most 4 per person per bin)
Question: is the turned face the suggested person? Faces already confirmed as that person in the same photo were left out of the sample.

| Distance | Same | Different | Unsure | Precision | 95% range (Wilson) |
|---|---|---|---|---|---|
| 0.6 to 0.8 | 21 | 0 | 0 | 100% | 85% to 100% |
| 0.8 to 0.9 | 21 | 0 | 0 | 100% | 85% to 100% |
| 0.9 to 1.0 | 21 | 0 | 0 | 100% | 85% to 100% |
| 1.0 to 1.1 | 20 | 1 | 0 | 95% | 77% to 99% |
| **up to 1.0** | **63** | **0** | **0** | **100%** | **94% to 100%** |
| up to 1.1 | 83 | 1 | 0 | 99% | 94% to 100% |

- The one mistake (tile 29, distance 1.08, yaw 47) was a **sibling** of the suggested person: the expected failure at the edge of the range.
- Spread: 18 people, none dominates (Mimi 14, Eleni 12, Kaley 12, Zeus 8, Carlos 8 ...).
- Side finding: for 12 of the 84 rows the sharp "frontal" reference shown for Kaley is a **postcard picture** that is assigned to her (photo of a framed postcard). Pictures of faces are also confirmed examples, so anchors and examples for any context or profile feature must not include them; Phase C (pictures) removes them from the pool. This does not change the results above (the profile examples were real faces) but matters for Phase G and for how much to trust a person's frontal centroid.

## 6. Go or no-go
Plan criterion: held-out precision of at least 95% at the suggested distance.
- **Go for profile-to-profile suggestions up to distance 1.0**: 63 of 63 correct, the lower end of the 95% range is 94% (a sample of 63 cannot show more than that), and the label-free checks agree (section 4). Default: **1.0**; the range 0.8 to 1.1 is a setting.
- **1.0 to 1.1 is not a default**: 20 of 21, the one error a sibling, and the range reaches down to 77%. Offered only as a wider setting, with the thumbnails shown.
- Every suggestion is shown with the person's examples before anything is assigned (no unseen bulk; Undo exists), so the remaining 1 to 5% error is caught on the page.
- Expected yield: about 1,837 faces (12% of the turned queue faces) at 1.0, about 1,000 at 0.9, for the 24 people who have profile examples. Every confirmation adds profile examples, which widens the reach (the loop of F1).

## 7. Caveats
- One labeller, 84 faces, up to 4 per person per bin; the sample came from people who already have profile examples. People without examples cannot be suggested.
- The reference set is matcher-confirmed (section 1), so the leave-one-out precision (section 2) is a best case; the labelled queue sample (section 5) is the unbiased part.
- Siblings and look-alikes are the failure mode at 1.0 and beyond; the examples are shown on every suggestion for this reason.
- Burst photos of one moment can appear several times in a list; a page can confirm them together.
