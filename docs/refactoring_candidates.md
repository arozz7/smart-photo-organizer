# Refactoring Candidates

## Criteria
Based on `refactoring-protocol.md`:
- **Hard Limit**: > 600 lines
- **Soft Limit**: > 400 lines
- **Protocol Violations**: Mixed concerns, Monolithic files, Circular dependencies.

## Phase 2 Candidates (Jan 2026)

### 1. `electron/db.ts` (Critical)
- **Lines**: 1116
- **Violations**:
  - **Hard Limit**: > 600 lines.
  - **God Object**: Handles DB Connection, Schema Migrations, AND Business Logic (Auto-Assign, Tag Cleanup).
  - **Logic Dump**: Contains `autoAssignFaces`, `cleanupTags` which belong in Services.
- **Plan**: Split into `core/services/FaceService.ts`, `data/repositories/FaceRepository.ts`, `data/migrations.ts`.

### 2. `electron/ipc/dbHandlers.ts` (Critical)
- **Lines**: 1272
- **Violations**:
  - **Hard Limit**: > 600 lines.
  - **Mixed Concerns**: IPC Handlers contain raw SQL queries and heavy logic (e.g., duplicate removal IoU logic).
- **Plan**: Extract logic to `core/services/` and SQL to `data/repositories/`. Retain only thin IPC wrappers.

### 3. `src/python/main.py` (High)
- **Lines**: 811
- **Violations**:
  - **Hard Limit**: > 600 lines.
  - **Monolith**: `handle_command` is a 400+ line switch statement mixing Image Processing, VLM, and Vector Store logic.
- **Plan**: Use Command Pattern or separate Handlers module. Extract `generate_thumbnail` logic.

### 4. `electron/ipc/aiHandlers.ts` (Medium)
- **Lines**: 610
- **Violations**:
  - **Soft Limit**: > 400 lines (Borderline Hard).
  - **Coupling**: Directly depends on `db.ts` for SQL queries instead of a Repository.
  - **Logic Leak**: Contains logic for `rotateImage` face preservation.
- **Plan**: Move rotation/face logic to `core/services/ImageService.ts`.

---

## Historical (Phase 1 - Resolved)

### 1. `electron/main.ts` (Refactored)
- **Status**: ✅ RESOLVED
- **Changes**:
  - Extracted IPC handlers to `electron/ipc/`.
  - Extracted Window management to `electron/windows/windowManager.ts`.
  - Extracted Image Protocol to `electron/services/imageProtocol.ts`.
  - Extracted Python entry point to `electron/services/pythonService.ts`.
  - Main file reduced from 3000+ lines to ~100 lines.

### 2. `src/python/main.py` (Refactored)
- **Status**: ✅ RESOLVED (Regression Detected - See Phase 2)
  - *Note*: It seems `src/python/main.py` has grown again to 800+ lines.
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

### 4. `src/views/PersonDetail.tsx` (Refactored)
- **Status**: ✅ RESOLVED
- **Changes**:
  - Extracted sub-components: `PersonHeader`, `PersonPhotoGrid`, `PersonFaceGrid`.
  - Moved data fetching logic to `usePersonDetail` hook.
  - Reduced main file complexity significanty.

## Priority 3: Complex Contexts

### 5. `src/context/ScanContext.tsx` (Refactored)
- **Status**: ✅ RESOLVED
- **Changes**:
  - Extracted `useScanErrors` hook for error management.
  - Extracted `usePhotoNavigation` hook for viewing/refreshing photos.
  - Extracted `useLibraryMetadata` hook for tags/folders/people loaders.
  - Main context file simplified to focus on state orchestration.

### 6. `electron/services/imageProtocol.ts` (Refactored)
- **Status**: ✅ RESOLVED
- **Changes**:
  - Decomposed into `ImageService` (Reasoning), `MetadataRepository` (Memory), and `ImageProcessor` (Tools).
  - Implemented modular layers with dependency injection.
