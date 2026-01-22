# Phase 42: Age-Based ERA Categorization

## Summary
Replaced visual clustering with actual age estimation for ERA generation, enabling meaningful life-stage tracking (Newborn → Child → Teen → Adult → Elderly).

## Problem
The ERA categorization system used K-Means visual clustering, which grouped all faces into one bucket instead of recognizing a person across different life stages.

## Changes

### Python AI Service
- **`src/python/facelib/faces.py`**: Added `genderage` to `allowed_modules`
- **`src/python/main.py`**: 
  - Extract `face.age` and `face.gender` in scan response (both normal scan and TTA sections)
  - Added `extract_age` command handler for age backfill

### Database
- **`electron/db.ts`**: Added migration for `estimated_age` and `gender` columns

### Face Storage
- **`electron/core/services/FaceService.ts`**: Updated INSERT/UPDATE statements to persist age and gender data

### ERA Generation
- **`electron/core/services/PersonService.ts`**: Rewrote `generateEras` to:
  - Group faces by age buckets (Newborn, Infant, Toddler, Child, Teen, Young Adult, Adult, Senior, Elderly)
  - Label ERAs by life stage name instead of date ranges
  - Fall back to visual clustering if <50% of faces have age data

### Repository
- **`electron/data/repositories/FaceRepository.ts`**: Updated `getAssignedFacesWithDates` to include `estimated_age`

### Background Backfill Service
- **`electron/core/services/BackgroundAgeRescanService.ts`** [NEW]:
  - Resumable checkpoints via app_state
  - Graceful shutdown support (no exceptions on exit)
  - Auto-resume on app startup if session was interrupted
  - Processes ALL faces (not just named ones)
  - Progress reporting to UI
  - Auto-generates ERAs for all named persons on completion
- **`electron/infrastructure/PythonAIProvider.ts`**: 
  - Added `extractAgeFromFace` method
  - Error suppression during shutdown

### IPC Handlers
- **`electron/ipc/dbHandlers.ts`**: Added 5 handlers:
  - `db:getAgeBackfillStatus` - Get backfill progress
  - `db:startAgeBackfill` - Start background service
  - `db:cancelAgeBackfill` - Cancel and reset state
  - `db:pauseAgeBackfill` - Pause processing
  - `db:resumeAgeBackfill` - Resume processing

### Frontend
- **`src/hooks/useAgeBackfill.ts`** [NEW]: React hook for backfill control
- **`src/components/AgeBackfillCard.tsx`** [NEW]: UI component with progress bar
- **`src/views/Settings.tsx`**: Integrated AgeBackfillCard in Database Management section

## Age Buckets
| Bucket | Age Range | Label |
|--------|-----------|-------|
| Newborn | 0-1 | Newborn |
| Infant | 1-2 | Infant |
| Toddler | 2-4 | Toddler |
| Child | 5-12 | Child |
| Teen | 13-19 | Teen |
| Young Adult | 20-35 | Young Adult |
| Adult | 36-55 | Adult |
| Senior | 56-69 | Senior |
| Elderly | 70+ | Elderly |

## Testing
- Build verified successful
- Requires manual testing with library containing photos at different ages
