# Phase 50: Schema Recovery (Update)

## Goal
Fix `SqliteError: no such table: app_state` startup crash caused by migration logic querying `app_state` before creation.

## Changes
- **Refactored `initDB`**: Moved all `CREATE TABLE` definitions (`app_state`, `face_buckets`, `person_eras`, etc.) to the initial `db.exec` block at the top of the function.
- **Initialization Order**: Guaranteed that all tables exist before any migration logic or queries execute.

## Verification
- Application should now start cleanly without any `SqliteError`.
