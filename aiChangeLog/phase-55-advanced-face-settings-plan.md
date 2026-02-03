# Phase 55: Advanced Face Recognition Settings

## Goal
Expose hardcoded face detection parameters (thresholds, NMS logic, scan scales) to the user via a new "Advanced" section in the Settings UI. This allows power users to tune sensitivity for specific photo sets (e.g. "Macro Mode" configuration) without code changes.

## Proposed Changes

### 1. Configuration Schema [TS]
**File:** `electron/core/services/ConfigService.ts`
- Add `AdvancedFaceConfig` interface:
  ```typescript
  interface AdvancedFaceConfig {
      // Detection
      detThreshStandard: number; // Default 0.65
      detThreshMacro: number;    // Default 0.25 (New default)
      
      // Filter
      minFaceSize: number;       // Default 40
      
      // NMS
      nmsIouThresh: number;      // Default 0.3 (Standard overlap)
      nmsIoMinThresh: number;    // Default 0.65 (Containment)
      enableAreaBasedNMS: boolean; // Default true (for size prioritization)
      
      // Scan Scales (Simplified for UI)
      enableMacroLowRes: boolean; // Enable 160px pass?
      enableTTA: boolean;         // Enable rotation augmentation?
  }
  ```
- Update `AppConfig` and `DEFAULT_CONFIG`.

### 2. Settings UI [React]
**File:** `src/components/SettingsModal.tsx`
- Add new Tab: "Advanced Face" (or split "General").
- Add Sliders/Toggles for:
    - Standard Sensitivity (`detThreshStandard`)
    - Macro Sensitivity (`detThreshMacro`)
    - Minimum Face Pixels (`minFaceSize`)
    - Overlap Threshold (`nmsIouThresh`)
    - Containment Threshold (`nmsIoMinThresh`)
    - Checkbox: "Prioritize Large Faces" (`enableAreaBasedNMS`)
    - Checkbox: "Enable Deep Composition Scan" (`enableMacroLowRes`)

### 3. Backend Propagation [TS]
**File:** `electron/infrastructure/PythonAIProvider.ts`
- In `analyzeImage` method:
    - distinct `ConfigService.getSettings().advancedFace`.
    - Inject this object into the `payload` sent to Python.
    - Example payload:
      ```json
      {
        "command": "analyze_image",
        "filePath": "...",
        "config": { ...advancedSettings }
      }
      ```

### 4. Python Backend [PY]
**File:** `src/python/main.py`
- Update `handle_command` / `analyze_image` (logic inside `main_loop` or handler function).
- Read `cmd['config']` if present.
- Replace hardcoded constants:
    - `0.25` -> `config.get('detThreshMacro', 0.25)`
    - `0.65` -> `config.get('nmsIoMinThresh', 0.65)`
    - `iou < 0.3` -> `iou < config.get('nmsIouThresh', 0.3)`
    - etc.

## Verification
1. Open Settings -> Advanced.
2. Change "Macro Sensitivity" to 0.99 (Extreme).
3. Rescan "Sleeping Girl".
4. Result should be 0 faces (proved that config works).
5. Change back to 0.25.
6. Result should be 1 face.
