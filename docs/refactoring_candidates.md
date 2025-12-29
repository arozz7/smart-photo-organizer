# Refactoring Candidates

## Criteria
Based on `refactoring-protocol.md`:
- **Hard Limit**: > 600 lines
- **Soft Limit**: > 400 lines
- **Protocol Violations**: Mixed concerns, Monolithic files, Circular dependencies.

## Priority 1: Critical Monoliths

### 1. `electron/main.ts` (Refactored)
- **Status**: ✅ RESOLVED
- **Changes**:
  - Extracted IPC handlers to `electron/ipc/`.
  - Extracted Window management to `electron/windows/windowManager.ts`.
  - Extracted Image Protocol to `electron/services/imageProtocol.ts`.
  - Extracted Python entry point to `electron/services/pythonService.ts`.
  - Main file reduced from 3000+ lines to ~100 lines.

### 2. `src/python/main.py` (1691 lines)
- **Status**: CRITICAL VIOLATION
- **Issues**:
  - Contains imports, CLI arguments, VLM logic, InsightFace logic, Command Loop, and DBSCAN clustering.
  - Huge "if name == main" block and global event loop.
- **Refactoring Plan**:
  - Create `python/facelib/` module.
  - Move Face Logic to `python/facelib/faces.py`.
  - Move VLM Logic to `python/facelib/vlm.py`.
  - Move Image Ops (Blur/Sharpness) to `python/facelib/image_ops.py`.
  - Keep `main.py` as a thin orchestrator.

## Priority 2: UI/Logic Layout Violations

### 3. `src/views/People.tsx` (621 lines)
- **Status**: HARD VIOLATION
- **Issues**:
  - Handles Virtualization (Virtuoso), API calls, State Management, and Modal logic.
  - Complex `renderClusterRow` functions embedded inside component.
- **Refactoring Plan**:
  - Extract `ClusterList` to separate component.
  - Move logic to `usePeopleCluster` hook.

### 4. `src/views/PersonDetail.tsx` (524 lines)
- **Status**: SOFT VIOLATION (High Priority)
- **Issues**:
  - Similar to `People.tsx`, mixes Modal logic with Page layout.
  - `RenameModal` and `EditPersonNameModal` defined in same file.
- **Refactoring Plan**:
  - Move Modals to `src/components/modals/`.
  - Extract data loading logic to custom hook.

## Priority 3: Complex Contexts

### 5. `src/context/ScanContext.tsx`
- **Status**: WATCHLIST (371 lines)
- **Issues**:
  - Handles Scanning, Folder Loading, Tag Loading, Error Management.
  - Mixed responsibilities.
- **Refactoring Plan**:
  - Split `ScanError` management to separate context or hook.
  - Separate `PhotoView` logic from `Scan` logic.
