# Phase 46: Unified Age + Pose Backfill

## Summary
Integrated pose data extraction into the existing age backfill service. When running age backfill, pose data (yaw, pitch, roll) is now automatically extracted and saved alongside age/gender.

## Changes

### Python
| File | Change |
|------|--------|
| `main.py` (extract_age) | Added pose extraction when re-analyzing face crops |

### TypeScript
| File | Change |
|------|--------|
| `PythonAIProvider.ts` | Updated `extractAgeFromFace` return type to include pose |
| `BackgroundAgeRescanService.ts` | Updated SQL to save pose_yaw, pose_pitch, pose_roll |

## How It Works
1. Age backfill already re-detects faces in crops using InsightFace
2. InsightFace provides pose data (yaw, pitch, roll) during detection
3. We now capture and save this pose data alongside age/gender
4. Uses COALESCE to not overwrite existing pose data

## Benefits
- No separate "pose backfill" service needed
- Reuses existing age backfill infrastructure
- Pose data populated as byproduct of age backfill
- Approximately 163K faces will get pose data when backfill runs

## Verification
- TypeScript compiles
- All 7 ERA tests pass
