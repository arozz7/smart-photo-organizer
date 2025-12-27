# Phase 01: Maintenance & Bug Fixes

## Diff Narrative
### 2025-12-18 - Fix AI Runtime Error Handling
- **File Modified**: `src/python/main.py`
- **Change**: Renamed `photoId` to `photo_id` in `handle_command` exception blocks.
- **Reason**: Variable name typo `NameError` masked the actual `AttributeError` from the AI engine, causing a hard crash.
- **Impact**: The application now gracefully catches AI runtime errors and returns them to the frontend instead of crashing.

### 2025-12-18 - Fix AI CPU Fallback Initialization
- **File Modified**: `src/python/main.py`
- **Change**: Updated `init_insightface` to accept `ctx_id` and forced `ctx_id=-1` (CPU) during fallback. Added `traceback` logging.
- **Reason**: `AttributeError: 'NoneType' object has no attribute 'shape'` occurred during CPU fallback because `FaceAnalysis` was likely initializing with a default GPU context (0) despite being passed `CPUExecutionProvider`.
- **Impact**: CPU fallback now correctly initializes an on-device/CPU session, preventing crashes when GPU is unavailable or fails.

### 2025-12-18 - Smart Fallback & Safe Mode
- **File Modified**: `src/python/main.py`
- **Change**: Implemented multi-stage fallback: GPU -> CPU -> Safe Mode (Detection/Recognition only).
- **Reason**: Some hardware configurations cause crashes in 3D landmark models even on CPU. Safe Mode disables these non-critical models to ensure core functionality works.
- **Impact**: Application will automatically degrade to "Safe Mode" if standard AI initialization fails, preventing total application failure.

### 2025-12-18 - AI Status Indicator
- **Files Modified**: `src/components/Layout.tsx`, `src/context/AIContext.tsx`, `src/components/AIStatusIndicator.tsx`
- **Change**: Added visual indicator in Sidebar and `aiMode` tracking in context.
- **Impact**: Users can now see if they are running in High Performance (GPU), Standard (CPU), or Safe Mode.

### 2025-12-19 - Face Detection Robustness (Smart Queue)
- **Files Modified**: `src/python/main.py`, `src/context/AIContext.tsx`
- **Change**: 
    - **Backend**: Implemented `scanMode` parameter (`FAST`, `BALANCED`, `MACRO`) to dynamically configure detection Size/Threshold.
    - **Frontend**: Implemented "Smart Batch Queue".
      - **Pass 1 (FAST)**: Scans all photos at 1280x1280.
      - **Logic**: If 0 faces found but Tags indicate a person (or are missing), re-queue for Pass 2.
      - **Pass 2 (BALANCED)**: Re-scans difficult photos at 640x640 with high sensitivity.
      - **Pass 3 (MACRO)**: Final attempt at 320x320 for extreme close-ups.
- **Reason**: Atomic retries (waiting for 3 scans per photo) slowed down processing for entire libraries.
- **Impact**: Fast processing for landscapes/easy portraits, with deep "Circling Back" only for difficult photos that likely contain people.

### 2025-12-19 - Force Face Scan & Queue Debugging
- **Files Modified**: `src/components/PhotoDetail.tsx`, `electron/main.ts`, `src/context/AIContext.tsx`
- **Change**: 
    - **Frontend**: Added "Force Face Scan" button to manually trigger MACRO mode.
    - **IPC**: Fixed `scanMode` parameter dropping between Frontend/Electron/Python.
    - **Logic Fix**: Resolved infinite loop in Batch Queue where `completeProcessing` failed to remove BALANCED mode tasks due to race condition with VLM tagging events.
- **Reason**: Users reported "Force Scan" doing nothing (defaulting to FAST) and Queue getting stuck looping on retries.
- **Impact**: "Force Scan" now correctly runs high-sensitivity macro scan. Smart Queue allows full progression (FAST->BALANCED->MACRO) without getting stuck.

### 2025-12-19 - Fix System Status & FAISS Integration
- **Files Modified**: `src/python/main.py`, `src/views/Queues.tsx`
- **Change**: 
    - **Backend**: Fixed JSON key mismatch (`cuda` -> `cuda_available`) and resolved `NameError` in FAISS handlers by using `faiss_lib`.
    - **Frontend**: Updated Queues UI to handle "lazy loading" state as "Standby" instead of "Failed".
- **Reason**: Users saw conflicting status reports (CPU vs GPU) and "Failed" errors due to incorrect keys and lazy loading logic. FAISS rebuilds crashed due to variable scoping error.
- **Impact**: System Status now accurately reflects GPU acceleration and library versions. FAISS index syncing works correctly.

### 2025-12-19 - Disable Auto-Refresh on Unnamed Faces
- **File Modified**: `src/views/People.tsx`
- **Change**: Disabled the `useEffect` trigger that automatically reloaded faces when new ones were detected. Added logic to clear the "New" indicator only on manual refresh.
- **Reason**: The auto-refresh was disrupting user interaction (naming/grouping) by reloading the grid unexpectedly.
- **Impact**: Users now see a "New" badge when faces are detected but can choose when to refresh the view.

### 2025-12-19 - Remove Default File Menu
- **File Modified**: `electron/main.ts`
- **Change**: Explicitly called `win.setMenu(null)` in the main process.
- **Reason**: The user requested that the file menu is not needed for this application.
- **Impact**: The cleaner UI without the standard file menu bar.

### 2025-12-20 - Documentation Updates (GIFs)
- **Files Modified**: `README.md`, `docs/assets/*`
- **Change**: Added animated GIFs to `README.md` to demonstrate key features (Scan, Organize, Smart Tags, Set Builder).
- **Reason**: User request to improve documentation visibility and demonstrate app capabilities visually.
- **Impact**: README now visually demonstrates core workflows.

### 2025-12-25 - Smart Tag Optimization & Cleanup
- **Feature**: Enforce strict single-word, lowercase normalization for all smart tags.
- **Files Modified**: src/python/main.py, electron/db.ts, electron/main.ts, src/views/Settings.tsx, src/views/Create.tsx, docs/*`n- **Impact**: Improved tag consistency. Added Cleanup Tags tool to Settings. Replaced Create page tag dropdown with sorted Type-ahead filter.
