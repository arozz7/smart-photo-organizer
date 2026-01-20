# Phase 45: Quality-Weighted Centroid Calculation

## Summary
Implemented pose-aware quality weighting for face recognition. Frontal faces now contribute more to person model calculations than profile views.

## Changes

### Phase 2.1: Pose Data Storage (Verified)
- Pose columns already exist: `pose_yaw`, `pose_pitch`, `pose_roll`
- Python extraction already implemented in `main.py`
- TypeScript storage already in `FaceService.ts`
- Added migration script as safety (Phase 2.1)
- Status: 600/163K faces have pose data (newly scanned only)

### Phase 2.2: Quality-Weighted Centroid
| File | Change |
|------|--------|
| `PersonService.ts` | `recalculatePersonMean()` now uses weighted mean |
| `FaceRepository.ts` | `getConfirmedFaces()` returns pose data |
| `db.ts` | Added pose column migrations |

### Algorithm
```
Weight = 1.0 - (abs(yaw) / 90) * 0.8

Frontal (0°):  weight = 1.0
Half-profile (45°): weight = 0.6
Full profile (90°): weight = 0.2
```

### Benefits
- More accurate person models
- Side profiles have reduced influence on centroid
- Improves matching accuracy for new scans

## Verification
- TypeScript compiles
- All 7 ERA tests pass
- Backward compatible (faces without pose get weight 1.0)
