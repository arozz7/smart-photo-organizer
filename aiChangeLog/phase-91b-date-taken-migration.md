# Phase 91b: `date_taken` Column Migration

## Summary
Added a `date_taken` column to the `photos` table, populated from EXIF metadata (`DateTimeOriginal → CreateDate → MediaCreateDate`) with file system `birthtime` as fallback. All date-based queries now use `date_taken` instead of `created_at` (which was the database import timestamp, not the actual photo capture date).

## Problem
`created_at` was set to `new Date().toISOString()` at scan/import time. This meant:
- Timeline widget showed import dates, not photo dates
- On This Day showed import anniversaries, not photo anniversaries
- Fun Facts (peak year, busiest day, etc.) reflected import patterns, not photography patterns
- All date-based filters and sorts were import-date-based

## Solution

### Schema Changes
**File:** `electron/db.ts`
- Added `date_taken DATETIME` to CREATE TABLE photos (fresh installs)
- ALTER TABLE migration for existing databases
- Index: `idx_photos_date_taken` for query performance
- One-time backfill migration (`migration_date_taken_backfill_v1`):
  - Parses EXIF date from `metadata_json` for each photo
  - Falls back to `fs.statSync(file_path).birthtime` if no EXIF date
  - Falls back to existing `created_at` if file is missing
  - Batched in transactions of 500 for performance

### New Utility
**File:** `electron/db.ts` — `parseExifDate()`
- Exported helper that parses EXIF date strings ("YYYY:MM:DD HH:MM:SS") to ISO 8601
- Handles ExifDateTime objects from exiftool-vendored (rawValue, toString)
- Returns null for invalid/missing dates

### Scanner Update
**File:** `electron/scanner.ts`
- New photos now set `date_taken` from EXIF metadata at insert time
- Fallback chain: EXIF → file birthtime → current date
- `created_at` still set to `new Date().toISOString()` for import tracking

### Query Updates (created_at → date_taken)
| File | Methods Updated |
|------|-----------------|
| `electron/data/repositories/DashboardRepository.ts` | `getOnThisDayPhotos()`, `getFunFact()` (6 sub-queries), `getPhotoTimeline()`, `getMonthlyBreakdown()` |
| `electron/data/repositories/PhotoRepository.ts` | `getPhotos()` (ORDER BY + 4 date filters), `getYears()`, `getPhotosByCompoundFilter()` (ORDER BY + buildConditionSQL) |
| `electron/data/repositories/FaceRepository.ts` | `getAllFaces()` ORDER BY |
| `src/components/FilterBuilder.tsx` | FILTER_FIELDS: `created_at` → `date_taken` |

### NOT Changed (Intentional)
- `photos.created_at` column — kept for import date tracking
- `person_history.created_at`, `person_alerts.created_at`, `smart_albums.created_at` — these correctly track DB event times
- `getRecentScans()` — correctly uses `scan_history.timestamp`
- `src/types/filterTypes.ts` SmartAlbum `created_at` — album creation time, not photo date
