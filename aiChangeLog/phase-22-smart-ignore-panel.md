# Phase 3: Smart Ignore UI Panel

## 🚀 Features

### Smart Ignore UI Dashboard
- Unified panel within the "Unnamed Faces" view.
- Provides real-time statistics on automated actions (Auto-assigned faces, Background faces).
- Quick access buttons for "Filter Background" and "Ignore All Groups".

### Configurable Tiering Thresholds
- **Auto-Assign Threshold**: Slider to control the confidence level (default: 0.4) for automatic person assignment.
- **Review Threshold**: Slider to control the confidence level (default: 0.6) for suggesting matches.
- **Persistence**: Settings are saved to `config.json` and persist across restarts.

## 🛠 Technical Implementation

### Frontend
- Created `SmartIgnorePanel` component using Radix UI for accessible sliders and switches.
- Connected to `PeopleContext` for settings state management.
- Refactored `People.tsx` to streamline the toolbar.

### Backend
- Updated `ConfigService` to support `SmartIgnoreSettings` schema.
- Added IPC handlers (`settings:getSmartIgnoreSettings`, `settings:updateSmartIgnoreSettings`) in `electron/ipc/settingsHandlers.ts`.
- Included unit tests to verify configuration persistence.

## 🧪 Testing
- **Backend**: `ConfigService` fully tested and passing.
- **Frontend**: Component integration verified manually. (Unit tests skipped due to environment constraints).
- **Environment**: Added `test:fix` script to `package.json` to resolve `better-sqlite3` ABI mismatches during local testing.
