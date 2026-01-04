# Phase 21: Scan-Time Confidence Tiering

**Date:** 2026-01-03
**Status:** Completed

## Diff Narrative

### 1. Database Schema
- **Migration:** Added `confidence_tier`, `suggested_person_id`, and `match_distance` columns to the `faces` table.
- **Purpose:** Store classification results from the initial AI scan to enable smart auto-assignment and suggestions.
- **Default:** Existing faces default to `'unknown'` tier.

### 2. Node.js Backend (FaceService)
- **New Logic:** `FaceService.processAnalysisResult` now performs immediate face matching against the vector library *before* inserting into the database.
- **Hybrid Matching:** Implemented `matchBatch` which uses a robust **Centroid-First** strategy followed by FAISS fallback.
- **Tiering Logic:**
    - **High Confidence (< 0.4 distance):** Automatically assigns the face to the person.
    - **Review Tier (0.4 - 0.6 distance):** Marks face as `review` and sets `suggested_person_id`.
    - **Unknown (> 0.6 distance):** Marks as `unknown`.
- **Bug Fix:** Corrected a critical property mismatch (`person.mean` -> `person.descriptor`) that was causing massive match failures.

### 3. Frontend (UI)
- **Unmatched Faces Modal:** Added **Amber Ring** visual indicator for 'Review' tier faces.
- **Cluster Row:** Added Amber Ring logic to the "Identify People" view for identifying suggestions within clusters.
- **Force Rescan:** Updated `ScanContext` to correctly handle forced rescanning of filtered files.

## Files Created/Modified
- `electron/db.ts`
- `electron/core/services/FaceService.ts`
- `electron/data/repositories/FaceRepository.ts`
- `src/components/UnmatchedFacesModal.tsx`
- `src/components/ClusterRow.tsx`
- `src/context/ScanContext.tsx`
- `src/pages/Library.tsx` (UI for Rescan buttons)
