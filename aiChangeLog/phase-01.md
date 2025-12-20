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
