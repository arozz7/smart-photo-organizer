# Phase 47: AdaFace / Descriptor V2 Integration

## Summary
Integrated descriptor_v2 (quality-aware re-embedding) into the existing age backfill service. When age backfill runs, faces are re-analyzed with a padded crop and the resulting embedding is saved as `descriptor_v2`.

## Changes

### Database
| File | Change |
|------|--------|
| `db.ts` | Added `descriptor_v2 BLOB` column to faces table |

### Python
| File | Change |
|------|--------|
| `adaface_embedding.py` | New module with AdaFace stub (uses InsightFace quality-weighted) |
| `main.py` | `extract_age` now returns `descriptorV2` (normalized embedding) |

### TypeScript
| File | Change |
|------|--------|
| `PythonAIProvider.ts` | Added `descriptorV2` to return type |
| `BackgroundAgeRescanService.ts` | Saves `descriptor_v2` as BLOB during backfill |

## How It Works
1. Age backfill re-detects face in padded crop (100% padding)
2. This often gives better detection than original tight crop
3. Embedding from padded crop is normalized and saved as `descriptor_v2`
4. Can be used for improved matching in future

## Benefits
- **Reuses existing infrastructure** - no separate service needed
- **Better embeddings** - padded crop gives more context
- **163K faces** will get descriptor_v2 during age backfill
- **Future-proof** - column ready for true AdaFace when integrated

## Verification
- TypeScript compiles
- All tests pass
