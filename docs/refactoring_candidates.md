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

### 2. `src/python/main.py` (Refactored)
- **Status**: ✅ RESOLVED
- **Changes**:
  - Extracted Face Logic to `src/python/facelib/faces.py`.
  - Extracted VLM Logic to `src/python/facelib/vlm.py`.
  - Extracted Image Ops to `src/python/facelib/image_ops.py`.
  - Extracted Vector Store to `src/python/facelib/vector_store.py`.
  - Main file reduced to orchestrator.

## Priority 2: UI/Logic Layout Violations

### 3. `src/views/People.tsx` (Refactored)
- **Status**: ✅ RESOLVED
- **Changes**:
  - Extracted `ClusterList` component.
  - Moved logic to `usePeopleCluster` custom hook.
  - Reduced complexity and line count.

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
