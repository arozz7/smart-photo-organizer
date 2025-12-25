# Phase 02: Improved Face Management

### 2025-12-23 - Multi-Select for Unnamed Faces
- **File Modified**: `src/views/People.tsx`
- **Change**: Added checkboxes to face clusters and a floating action bar for bulk operations (Name, Ignore).
- **Reason**: Naming one group at a time was tedious for large libraries.
- **Impact**: Users can now merge multiple duplicate groups into one person in a single action.

### 2025-12-23 - Blurry Face Assignment
- **File Modified**: `src/components/BlurryFacesModal.tsx`
- **Change**: Added "Assign to Person" input in the footer.
- **Reason**: Users often found recognizable faces in the "Blurry" list but had no way to save them.
- **Impact**: Improved recall for rare photos where the only face might be slightly blurry.

### 2025-12-23 - Blurry Faces Improvements
- **File Modified**: `src/components/BlurryFacesModal.tsx`
- **Change**: Added "Select All" checkbox and optimized grid rendering (reduced overscan).
- **Reason**: User requested better bulk controls; logs indicated tile memory limits were exceeded due to aggressive pre-loading.
- **Impact**: Better performance when scrolling through hundreds of blurry faces and faster bulk selection.

### 2025-12-23 - View Original Popup for Blurry Faces
- **File Modified**: `src/components/BlurryFacesModal.tsx`
- **Change**: Added "View Original" button that triggers an in-modal image popup (3/4 size).
- **Reason**: Users found navigating away to the main photo view disruptive to the cleanup workflow.
- **Impact**: Streamlined review process for verifying blurry faces without losing context.

### 2025-12-23 - Memory Optimization (Server-Side Cropping)
- **File Modified**: `electron/main.ts`, `src/components/BlurryFacesModal.tsx`
- **Change**: Implemented on-the-fly server-side cropping for faces missing pre-generated thumbnails.
- **Reason**: Application was crashing ("Tile Memory Exceeded") when loading hundreds of 20MB+ images in the Blurry Faces modal.
- **Impact**: Eliminated memory crashes and significantly improved thumbnail load times for raw/high-res photos.
