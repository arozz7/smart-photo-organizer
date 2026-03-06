# Phase 103 — UX Modernization (v0.7.5)

**Branch:** `feature/v0.7.5-ux-modernization`
**Commits:** `496231d` → `f6ccf71`
**Status:** ✅ Complete

---

## Overview

Systematic UI polish pass across 6 phases. Elevated navigation, controls, typography, accessibility, z-index architecture, and component structure.

---

## Phase 1 — Navigation & Sidebar

**File:** `src/components/Layout.tsx` (rewritten)

- Extracted `SidebarLink` component with `icon`, `children`, `end?`, `badge?` props
- Added Radix icons to all 8 nav links (`@radix-ui/react-icons`)
- Grouped nav into Core / Tools / System with `border-t` dividers
- Version string (`v0.7.5`) now a clickable button (placeholder for changelog dialog)

---

## Phase 2a — Radix Switch in Settings

**File:** `src/components/SettingsModal.tsx`

- Replaced all 3 native `<input type="checkbox">` elements with `@radix-ui/react-switch`
- Affected settings: `hideUnnamedFacesByDefault`, `enableMacroLowRes`, `enableTTA`

## Phase 2b — Library Filter UX

**File:** `src/views/Library.tsx`

- Added `FilterPill` component: removable pill badge with × button
- Added active filter pills row between header and content (folder, person, year, month, tags)
- Fixed folder disambiguation — shows last 2 path segments (`2024 / Birthday`) instead of leaf name only
- Added 4 distinct empty state scenarios: awaiting selection, no search results, no filter results, empty library

---

## Phase 3 — Typography

**Files:** `src/main.tsx`, `src/index.css`

- Installed `@fontsource-variable/inter`
- Imported in `main.tsx` (was declared in CSS but not loaded — silently falling back to Segoe UI)
- Set `--font-sans` in `@theme` to `"Inter Variable", "Inter", "system-ui", "sans-serif"`

---

## Phase 4 — Empty States

**Files:** `src/components/ui/EmptyState.tsx` (new), `src/views/Library.tsx`, `src/views/People.tsx`

- Created reusable `EmptyState` component: `icon`, `title`, `description`, `action?` props
- Library: 4 distinct scenario messages with contextual actions
- People — Identified tab: empty state with link to Library
- People — Discoveries tab: "All caught up" empty state

---

## Phase 5 — Accessibility Audit

**Files:** `src/components/PersonCard.tsx`, `src/components/FaceThumbnail.tsx`, `src/components/StatusBar.tsx`, `src/index.css`

- `PersonCard`: `role="button"`, `tabIndex={0}`, `onKeyDown` (Enter/Space), `focus-visible` ring, computed `aria-label`
- `FaceThumbnail`: improved default `alt` text from `"face"` → `"Face thumbnail"`
- `StatusBar`: `role="status"`, `aria-live="polite"`, `aria-label` on pause button
- `index.css`: global `*:focus-visible` outline rule (`2px solid indigo-500`)

---

## Phase 6a — Semantic Z-Index Scale

**Files:** `src/index.css`, `src/components/StatusBar.tsx`, `src/components/FloatingActionBar.tsx`, `src/components/ConfirmationModal.tsx`

- Defined CSS custom properties in `@theme`:
  ```
  --z-navigation: 10   (sidebar/nav)
  --z-sticky: 20       (StatusBar, FloatingActionBar)
  --z-overlay: 30      (in-component overlays)
  --z-modal: 100       (full-screen modals)
  --z-toast: 200       (ConfirmationModal, alerts)
  --z-tooltip: 300     (tooltips)
  ```
- Defined utility classes via `@layer utilities` (required — Tailwind v4.1.x does NOT auto-generate utility classes from custom `@theme --z-*` variables; confirmed via compiled CSS inspection)
- Migrated: `StatusBar` `z-50` → `z-sticky`, `FloatingActionBar` `z-50` → `z-sticky`, `ConfirmationModal` `z-[200]/z-[201]` → `z-toast`

## Phase 6b — PhotoDetail Decomposition

**Refactor:** `src/components/PhotoDetail.tsx` (1008 lines) → 5 files

| File | Lines | Responsibility |
|------|-------|----------------|
| `PhotoDetail.tsx` | 192 | Orchestrator — state, effects, portal, layout |
| `PhotoViewer.tsx` | 207 | Image display, prev/next nav, face box overlay |
| `PhotoActions.tsx` | 102 | Enhance button, rotation controls |
| `FaceOverlay.tsx` | 289 | People panel, reassign/unassign/ignore, naming modal |
| `PhotoMetadata.tsx` | 228 | EXIF panel, tags, smart tags, AI description |

Key design decisions:
- `PhotoViewer` owns `imgRect`/`imgRef`/`photoAreaRef` internally; keyed by `photo.id` for clean remount
- `FaceOverlay` owns `reassigningGroup`/`reassignName` (sidebar-local state)
- `onFacesChanged={fetchTags}` is the single data refresh callback passed to both FaceOverlay and PhotoMetadata

---

## Bug Fixes (post-testing)

### z-index class generation (critical)
- **Root cause:** Tailwind v4.1.17 does not auto-generate utility classes from `@theme { --z-modal: 100 }`. The classes were silently no-ops (z-index: auto). Confirmed via compiled CSS grep showing only numeric z-index classes.
- **Fix:** Added explicit `@layer utilities` block in `index.css` defining all 6 semantic z-index classes.

### Close/nav button UX
- `PhotoDetail` close button: pill shape with "✕ Close ESC" label (was small circle, hard to find)
- `PhotoViewer` nav arrows: frosted glass panel style with ← → key hint labels

### Singles section missing view-photo button
- `People.tsx` Single Faces grid was missing the hover "View Original Photo" button present in all other face grids. Added.

### Z-index values
- `--z-modal: 40` (initial) was below People page's hardcoded `z-50` floating action bars
- Bumped to `--z-modal: 100`, `--z-toast: 200`, `--z-tooltip: 300`

---

## Files Created
- `src/components/ui/EmptyState.tsx`
- `src/components/PhotoViewer.tsx`
- `src/components/PhotoActions.tsx`
- `src/components/FaceOverlay.tsx`
- `src/components/PhotoMetadata.tsx`

## Files Modified
- `src/components/Layout.tsx`
- `src/components/SettingsModal.tsx`
- `src/components/StatusBar.tsx`
- `src/components/FloatingActionBar.tsx`
- `src/components/ConfirmationModal.tsx`
- `src/components/PersonCard.tsx`
- `src/components/FaceThumbnail.tsx`
- `src/components/PhotoDetail.tsx` (reduced from 1008 → 192 lines)
- `src/views/Library.tsx`
- `src/views/People.tsx`
- `src/main.tsx`
- `src/index.css`
- `docs/guides/user_manual.md`
- `docs/specs/future_features.md`
- `package.json` / `package-lock.json` (version bump + `@fontsource-variable/inter`)

## Dependencies Added
- `@fontsource-variable/inter`
