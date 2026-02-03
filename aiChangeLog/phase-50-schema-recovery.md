# Phase 50: Schema Recovery

## Goal
Fix startup crash caused by database schema initialization order mismatch (`SqliteError: no such column: bucket_id`).

## Changes
- **Updated Schema Definitions**: Modified `electron/db.ts` to include all modern columns (`bucket_id`, `needs_bucketing`, `descriptor_v2`, etc.) in the initial `CREATE TABLE` definitions.
- **Fixed Initialization Order**: Moved the creation of `idx_faces_bucket_id` to execute only *after* the `bucket_id` column exists (either via creation or migration).

## Verification
- Application should now start without SQL errors.
- `BackgroundBucketingService` should initialize correctly.
