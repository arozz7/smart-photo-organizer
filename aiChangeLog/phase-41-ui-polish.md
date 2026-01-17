# Phase 41: UI Polish & UX Improvements

## Description
Focused on improving user experience in the Person Details and Photo Details views, specifically addressing data loading states and action clarity.

## Changes

### 1. Fix "Load More" on Ignored Tab
- **Fix**: The "Load More" button on the Ignored Faces tab was incorrectly wired to the `reload()` function (reseting to page 0) instead of `handleLoadMore()` (appending page N+1).
- **Outcome**: Pagination now works correctly for ignored faces.

### 2. Refactor "Remove" to "Ignore"
- **Context**: On the *Named Person* page and *Review All* modal, the "Remove" button previously unassigned faces, sending them back to the "Unnamed" pool. This is often not what users want when removing a face from a person—they usually want to say "this is not a face" or "ignore this".
- **Change**:
    - Renamed "Remove" button to "Ignore".
    - Updated icon to the "circled slash" (ignore) icon.
    - Wired action to `db:ignoreFaces` instead of `db:unassignFaces`.
- **Outcome**: Removed faces are now explicitly marked as ignored and won't reappear as suggestions.

### 3. Photo Detail Loading Indicator
- **Context**: Large photos or RAW previews can take a moment to load in the lightbox, leaving the user with a blank black screen.
- **PhotoDetail**: Added loading spinner overlay for main image to prevent UI jumpiness.
- **Scroll Persistence**:
  - Refactored `AllFacesModal`, `BlurryFacesModal`, `OutlierReviewModal`, and `PersonDetail` to use a **Loading Overlay** pattern.
  - Previously, `loading` states unmounted the list/grid, causing the user to lose their scroll position after performing an action (like ignoring faces).
  - Now, the list remains mounted with a semi-transparent spinner overlay, preserving scroll context.

- **Performance Optimization**:
  - **Prioritized Cached Previews**: `PersonFaceItem` now attempts to load the lightweight cached preview image first, falling back to the original file only if needed. This significantly reduces I/O on the backend during scrolling.
  - **Scroll Virtualization**: Implemented `isScrolling` check in `AllFacesModal`. During fast scrolling, face items render a lightweight placeholder instead of attempting to load images, ensuring smooth 60fps scrolling even with thousands of faces.
- **Outcome**: Better perceived performance and feedback.

## Files Modified
- `src/views/People.tsx`
- `src/views/PersonDetail.tsx`
- `src/components/AllFacesModal.tsx`
- `src/components/PhotoDetail.tsx`
- `src/hooks/useIgnoredFaces.ts` (Viewed/Verified)
- `src/hooks/usePersonDetail.ts`
