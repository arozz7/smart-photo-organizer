# Phase 16: AI Model Management Fix

## Diff Narrative

### Files Modified
- **[aiHandlers.ts](file:///j:/Projects/smart-photo-organizer/electron/ipc/aiHandlers.ts)**: Unboxed the `status` object from the Python backend response in the `ai:getSystemStatus` IPC handler.
- **[main.py](file:///j:/Projects/smart-photo-organizer/src/python/main.py)**: Added a proactive progress message with `status: "extracting"` before the zip extraction of the AI Runtime to improve UI feedback.
- **[ModelDownloader.tsx](file:///j:/Projects/smart-photo-organizer/src/components/ModelDownloader.tsx)**: 
    - Updated `progress` state to include `status`.
    - Implemented UI logic to display a pulsing "Extracting..." indicator when the backend is in the extraction phase.
    - Cleaned up TypeScript `//@ts-ignore` comments by properly typing the progress state.

### Behavior Changes
- The "Manage Models" modal now correctly displays available and missing AI models (e.g., Buffalo_L, SmolVLM, GFPGAN).
- Users now see a distinct "Extracting..." state when installing the AI Runtime, preventing the UI from appearing hung during large file extractions.

### Tests Added
- Manual verification of modal display and progress signaling.

### Assumptions & Risks
- **Assumption**: The `res.status` key always contains the expected `models` structure in `main.py`.
- **Risk**: Large models (5GB+) extraction may still take significant time on slower disks, but the new UI state provides better feedback.
