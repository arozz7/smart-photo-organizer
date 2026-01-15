# Phase 40: Frontend Streamlining (UX Consolidation)

## Goal
Simplify the People management workflow by consolidating tabs and automating high-confidence assignments.

## Changes

### Schema Changes
- **Table**: `faces`
    - [NEW] `assignment_source` (TEXT): Tracks how the face was assigned ('manual', 'auto_suggestion', 'auto_identify').
    - [NEW] `is_confirmed` (INTEGER): 0/1 flag. 0 means auto-assigned and pending review; 1 means confirmed by user.

### Auto-Assignment Logic
- **Service**: `BackgroundBucketingService`
    - Now auto-assigns 'suggestion' buckets directly to the suggested person.
    - Sets `assignment_source='auto_suggestion'` and `is_confirmed=0`.
