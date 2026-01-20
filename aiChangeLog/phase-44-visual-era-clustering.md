# Phase 44: Time-Based ERA Generation

## Summary
Replaced unreliable age-based ERA generation with time-based bucketing using EXIF photo dates. Added inline ERA rename UI with preservation during regeneration.

## Changes

### Algorithm
- ERAs created using **3-year time buckets** based on photo EXIF dates
- Parses `DateTimeOriginal.rawValue` from photo metadata
- Faces without valid EXIF dates added to largest bucket
- Invalid dates (e.g., "0000:00:00") are skipped
- User-renamed ERAs preserved during regeneration (by year range match)

### Files Modified
| File | Change |
|------|--------|
| `PersonService.ts` | Rewrote `generateEras()` with time-based bucketing + preserve logic |
| `PersonRepository.ts` | Added `renameEra()`, updated `addEra()` to support `user_name` |
| `dbHandlers.ts` | Added `db:renameEra` IPC handler |
| `db.ts` | Added `user_name` column + migration |
| `EraCard.tsx` | New component with inline rename UI |
| `PersonDetail.tsx` | Integrated EraCard component |
| `usePersonDetail.ts` | Added `renameEra` action |

### Database Schema
```sql
ALTER TABLE person_eras ADD COLUMN user_name TEXT;
```

## Example Output
```
[PersonService] 7777 dated faces, 3363 undated
[PersonService] Year range: 2007-2015 (9 years)
Era 1 (2007-2009) - 510 faces
Era 2 (2010-2012) - 2967 faces
Era 3 (2013-2015) - 7663 faces
```

## Verification
- All 7 unit tests pass
- TypeScript compiles successfully
- Tested with real 11k face library
- Rename preservation tested
