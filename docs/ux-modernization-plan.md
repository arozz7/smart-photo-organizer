# UX Modernization Plan

> **Goal:** Modernize the application's user interface through systematic improvements to navigation, form controls, typography, accessibility, layout flexibility, and first-run experience — elevating the UI from functional to polished product quality.

---

## Executive Summary

A Principal UX Engineering review identified 12 categories of improvement across the existing UI. This plan organizes those findings into 6 implementable phases, ordered by user impact and implementation complexity. Each phase is independently shippable.

### Current Strengths (Preserve These)
- Dark theme execution (gray-900/800 + indigo-600 accents)
- AI status communication (StatusBar + AIStatusIndicator)
- Radix UI primitives (Dialog, Slider, Tabs, Tooltip)
- PersonCard design (gradient overlay, notification badges)
- FloatingActionBar pattern (pill shape, entrance animation)
- Toast notification system (5 variants, slide-in animation)

### Key Problems
1. **Navigation lacks icons and hierarchy** — 6 flat text links, growing to 8-9 with roadmap features
2. **Library filtering is confusing** — nested native `<select>` elements break theming and hide state
3. **Folder navigation is ambiguous** — leaf-only folder names cause duplicates (two "Birthday" folders from different paths)
4. **Native form controls break dark theme** — checkboxes and selects render with OS styling
5. **No empty states** — blank screens on first run, no search results, no people
6. **Typography may not load** — Inter font declared but not bundled
7. **Fixed photo grid** — 150px tiles don't adapt to viewport
8. **Accessibility gaps** — missing ARIA labels, no keyboard activation on clickable divs
9. **Z-index conflicts** — ad-hoc values with no defined scale
10. **PhotoDetail is 1000+ lines** — exceeds project's 600-line hard limit

---

## Phase 1: Navigation & Sidebar (Low Effort, High Impact)

### Rationale
The sidebar is the user's primary orientation mechanism. Adding icons improves scannability and prepares for the growing nav item count (Home Page, Search View, Tools are all on the roadmap).

---

### 1.1 [MODIFY] [Layout.tsx](file:///j:/Projects/smart-photo-organizer/src/components/Layout.tsx)

**Extract `SidebarLink` component and add icons:**

Replace the 6 copy-pasted NavLink blocks (lines 18-71) with a reusable component:

```tsx
import {
    ImageIcon, PersonIcon, GlobeIcon,
    ListBulletIcon, GearIcon, PlusCircledIcon
} from '@radix-ui/react-icons';

interface SidebarLinkProps {
    to: string;
    icon: React.ReactNode;
    children: React.ReactNode;
}

function SidebarLink({ to, icon, children }: SidebarLinkProps) {
    return (
        <NavLink
            to={to}
            className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`
            }
        >
            {icon}
            {children}
        </NavLink>
    );
}
```

**Navigation with grouping:**

```tsx
<nav className="flex-1 p-2 space-y-1">
    {/* Core */}
    <SidebarLink to="/" icon={<ImageIcon className="w-4 h-4" />}>Library</SidebarLink>
    <SidebarLink to="/people" icon={<PersonIcon className="w-4 h-4" />}>People</SidebarLink>
    <SidebarLink to="/locations" icon={<GlobeIcon className="w-4 h-4" />}>Locations</SidebarLink>

    {/* Tools */}
    <div className="pt-3 mt-3 border-t border-gray-700/50">
        <SidebarLink to="/create" icon={<PlusCircledIcon className="w-4 h-4" />}>Create</SidebarLink>
        <SidebarLink to="/queues" icon={<ListBulletIcon className="w-4 h-4" />}>Queues</SidebarLink>
    </div>

    {/* System */}
    <div className="pt-3 mt-3 border-t border-gray-700/50">
        <SidebarLink to="/settings" icon={<GearIcon className="w-4 h-4" />}>Settings</SidebarLink>
    </div>
</nav>
```

**Future-proofing:** When Home Page Dashboard (#2) ships, add it above Library. When Search View (#1) ships, add it in the Tools group. When Tools page ships (Corrupt Recovery), add it in the Tools group.

### 1.2 [MODIFY] [Layout.tsx](file:///j:/Projects/smart-photo-organizer/src/components/Layout.tsx)

**Make version clickable:**

Replace line 76:
```tsx
// Before
<div className="text-xs text-gray-500">v0.6.0</div>

// After
<button
    onClick={() => { /* Open changelog or About dialog */ }}
    className="text-xs text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
    title="View changelog"
>
    v0.6.0
</button>
```

### Files Modified
| File | Change |
|------|--------|
| `src/components/Layout.tsx` | Extract `SidebarLink`, add icons, group nav items, clickable version |

### Testing
- Visual regression: Verify active/hover/inactive states render correctly
- Keyboard: Tab through all nav links, verify focus rings
- Screen reader: Verify link text is announced with icon hidden via `aria-hidden`

---

## Phase 2: Form Control Theming (Medium Effort, High Impact)

### Rationale
Native `<input type="checkbox">` and `<select>` elements render with OS-native styling, breaking the dark theme aesthetic. Radix UI Switch and Select are already in the project's dependencies.

---

### 2.1 [MODIFY] [SettingsModal.tsx](file:///j:/Projects/smart-photo-organizer/src/components/SettingsModal.tsx)

**Replace all `<input type="checkbox">` with Radix Switch:**

There are 3 checkbox instances (Hide Unnamed Faces, Deep Composition Scan, Rotation Augmentation). Replace each with:

```tsx
import * as Switch from '@radix-ui/react-switch';

// Before (line ~255)
<input
    type="checkbox"
    checked={settings.hideUnnamedFacesByDefault}
    onChange={(e) => setSettings(prev => ({ ...prev, hideUnnamedFacesByDefault: e.target.checked }))}
    className="w-5 h-5 rounded border-gray-600 bg-gray-700 text-blue-600"
/>

// After
<Switch.Root
    checked={settings.hideUnnamedFacesByDefault}
    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, hideUnnamedFacesByDefault: checked }))}
    className="w-10 h-5 bg-gray-600 rounded-full relative data-[state=checked]:bg-indigo-600 transition-colors"
>
    <Switch.Thumb className="block w-4 h-4 bg-white rounded-full transition-transform translate-x-0.5 data-[state=checked]:translate-x-[22px]" />
</Switch.Root>
```

Apply the same pattern to all 3 checkbox instances.

### 2.2 [MODIFY] [Library.tsx](file:///j:/Projects/smart-photo-organizer/src/views/Library.tsx)

**Replace native `<select>` with styled dropdown:**

The filter mode selector and secondary selectors (tag, person, folder) use native `<select>` which renders with OS chrome. Replace with a custom `FilterDropdown` component using Radix Select or the existing `ActionDropdown` pattern.

```tsx
// New component: FilterPill — shows active filter state as a removable chip
interface FilterPillProps {
    label: string;
    value: string;
    onRemove: () => void;
}

function FilterPill({ label, value, onRemove }: FilterPillProps) {
    return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-600/20 text-indigo-300 rounded-full text-xs font-medium border border-indigo-500/30">
            <span className="text-gray-400">{label}:</span>
            <span>{value}</span>
            <button
                onClick={onRemove}
                className="ml-0.5 text-indigo-400 hover:text-white transition-colors"
                aria-label={`Remove ${label} filter`}
            >
                <Cross2Icon className="w-3 h-3" />
            </button>
        </span>
    );
}
```

**Active filter state visibility:** Show current filters as removable pills below the toolbar instead of hiding them inside dropdown state.

### 2.3 [MODIFY] [Library.tsx](file:///j:/Projects/smart-photo-organizer/src/views/Library.tsx)

**Fix folder disambiguation (lines 259-273):**

Replace the leaf-only folder name display with a multi-segment path:

```tsx
// Before
{t.folder.split(/[\\/]/).pop()}

// After — show last 2-3 segments for disambiguation
{(() => {
    const parts = t.folder.split(/[\\/]/).filter(Boolean);
    const display = parts.length > 2
        ? `${parts[parts.length - 2]} / ${parts[parts.length - 1]}`
        : parts[parts.length - 1];
    return display;
})()}
```

This turns ambiguous entries like:
- `Birthday` + `Birthday` into
- `2024 / Birthday` + `Work / Birthday`

### Files Modified
| File | Change |
|------|--------|
| `src/components/SettingsModal.tsx` | Replace 3 checkboxes with Radix Switch |
| `src/views/Library.tsx` | Styled filter dropdowns, filter pills, folder disambiguation |

### Testing
- Verify Switch toggles save/load correctly via IPC
- Verify folder selector disambiguates same-name folders
- Verify filter pills appear/remove correctly
- Keyboard: Tab through all form controls

---

## Phase 3: Typography & Font Loading (Low Effort, Medium Impact)

### Rationale
The `--font-sans: "Inter"` declaration in `index.css` references a font that may not be installed on the user's system. Without an explicit font load, the UI silently falls back to Segoe UI (Windows) or system-ui, creating an inconsistent experience between development and production.

---

### 3.1 Install Inter font package

```bash
npm install @fontsource-variable/inter
```

### 3.2 [MODIFY] [main.tsx](file:///j:/Projects/smart-photo-organizer/src/main.tsx)

**Add font import at top of entry file:**

```tsx
import '@fontsource-variable/inter';
```

### 3.3 [MODIFY] [index.css](file:///j:/Projects/smart-photo-organizer/src/index.css)

**Update theme to use variable font:**

```css
@import "tailwindcss";

@theme {
  --font-sans: "Inter Variable", "Inter", "system-ui", "sans-serif";
}
```

### Files Modified
| File | Change |
|------|--------|
| `package.json` | Add `@fontsource-variable/inter` dependency |
| `src/main.tsx` | Import Inter font |
| `src/index.css` | Update `--font-sans` to include variable font |

### Testing
- Verify Inter renders in production build (not just dev)
- Check font-weight variations (400, 500, 600, 700) render correctly
- Verify bundle size increase is acceptable (~100KB for variable font)

---

## Phase 4: Empty States & First-Run Experience (Medium Effort, High Impact)

### Rationale
New users see empty grids with no guidance. Users with active libraries see blank screens when filters return no results. Empty states are a critical onboarding and trust-building mechanism.

---

### 4.1 [CREATE] `src/components/ui/EmptyState.tsx`

**Reusable empty state component:**

```tsx
interface EmptyStateProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    action?: {
        label: string;
        onClick: () => void;
    };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center px-8">
            <div className="text-gray-600 mb-4">{icon}</div>
            <h3 className="text-lg font-semibold text-gray-300 mb-2">{title}</h3>
            <p className="text-sm text-gray-500 max-w-md mb-6">{description}</p>
            {action && (
                <button
                    onClick={action.onClick}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-sm font-medium transition-colors"
                >
                    {action.label}
                </button>
            )}
        </div>
    );
}
```

### 4.2 [MODIFY] [Library.tsx](file:///j:/Projects/smart-photo-organizer/src/views/Library.tsx)

**Add empty states for:**

| Scenario | Title | Description | Action |
|----------|-------|-------------|--------|
| No photos scanned | "Your library is empty" | "Scan a folder to start organizing your photos with AI-powered face detection and smart tags." | "Scan Folder" |
| Filter returns no results | "No photos match this filter" | "Try adjusting your filter criteria or clearing filters to see all photos." | "Clear Filters" |
| Search returns no results | "No results for '{query}'" | "Try different search terms. Smart Tags searches across AI-generated descriptions." | None |

### 4.3 [MODIFY] [People.tsx](file:///j:/Projects/smart-photo-organizer/src/views/People.tsx)

**Add empty states for:**

| Scenario | Title | Description | Action |
|----------|-------|-------------|--------|
| No people identified | "No people found yet" | "Scan your photo library to detect faces. Once scanned, group and name the people in your photos." | "Go to Library" |
| Discoveries tab empty | "All caught up" | "No new face groups to review. New discoveries will appear here as more photos are scanned." | None |

### Files Modified
| File | Change |
|------|--------|
| `src/components/ui/EmptyState.tsx` | **NEW** — Reusable empty state component |
| `src/views/Library.tsx` | Add empty states for no photos, no filter results |
| `src/views/People.tsx` | Add empty states for no people, empty tabs |

### Testing
- Verify empty state renders when `photos.length === 0` and not scanning
- Verify filter empty state shows after filter applied with no results
- Verify action buttons work (scan trigger, filter clear, navigation)

---

## Phase 5: Accessibility Audit (Medium Effort, Medium Impact)

### Rationale
The app uses Radix primitives (which handle a11y well) for modals and sliders, but custom interactive elements (PersonCard, face thumbnails, grid items) lack proper ARIA attributes and keyboard support.

---

### 5.1 [MODIFY] [PersonCard.tsx](file:///j:/Projects/smart-photo-organizer/src/components/PersonCard.tsx)

**Add semantic button role and keyboard activation:**

```tsx
// Before
<div onClick={onClick} className="... cursor-pointer ...">

// After
<div
    onClick={onClick}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    role="button"
    tabIndex={0}
    aria-label={`View ${person.name}, ${person.face_count} photos${hasAlerts ? `, ${person.alert_count} alerts` : ''}${hasUnconfirmed ? `, ${person.unconfirmed_count} unconfirmed` : ''}`}
    className="... cursor-pointer ... focus:outline-none focus:ring-2 focus:ring-indigo-500"
>
```

### 5.2 [MODIFY] [FaceThumbnail.tsx](file:///j:/Projects/smart-photo-organizer/src/components/FaceThumbnail.tsx)

**Add meaningful alt text to face images:**

```tsx
// Before
<img src={...} alt="" />

// After
<img src={...} alt={alt || "Face thumbnail"} />
```

Add `alt?: string` to the component props interface.

### 5.3 [MODIFY] [StatusBar.tsx](file:///j:/Projects/smart-photo-organizer/src/components/StatusBar.tsx)

**Add ARIA labels to pause/resume button and status region:**

```tsx
// Wrap status bar in a live region
<div role="status" aria-live="polite" className="...">

// Pause button
<button
    onClick={() => setIsPaused(!isPaused)}
    aria-label={isPaused ? 'Resume AI processing' : 'Pause AI processing'}
    className="..."
>
```

### 5.4 [MODIFY] [index.css](file:///j:/Projects/smart-photo-organizer/src/index.css)

**Add global focus-visible styles:**

```css
@layer base {
    *:focus-visible {
        outline: 2px solid theme('colors.indigo.500');
        outline-offset: 2px;
    }
}
```

### Files Modified
| File | Change |
|------|--------|
| `src/components/PersonCard.tsx` | Add `role="button"`, `tabIndex`, `aria-label`, keyboard handler |
| `src/components/FaceThumbnail.tsx` | Add meaningful `alt` text prop |
| `src/components/StatusBar.tsx` | Add `role="status"`, `aria-live`, button labels |
| `src/index.css` | Add global `focus-visible` outline |

### Testing
- Tab through People view — verify all cards are focusable and activatable via Enter/Space
- Run with screen reader (Windows Narrator) — verify status bar changes are announced
- Verify focus rings appear on keyboard navigation but not on mouse click

---

## Phase 6: Z-Index Scale & PhotoDetail Decomposition (High Effort, Medium Impact)

### Rationale
The z-index values are ad-hoc (z-10, z-50, z-[100], z-[200], z-[201]) and will cause stacking bugs as more overlays and modals are added. PhotoDetail at 1000+ lines violates the project's 600-line hard limit and makes changes risky.

---

### 6.1 [MODIFY] [index.css](file:///j:/Projects/smart-photo-organizer/src/index.css)

**Define z-index scale in Tailwind theme:**

```css
@theme {
    --font-sans: "Inter Variable", "Inter", "system-ui", "sans-serif";

    /* Z-index scale */
    --z-navigation: 10;
    --z-sticky: 20;
    --z-overlay: 30;
    --z-modal: 40;
    --z-toast: 50;
    --z-tooltip: 60;
}
```

### 6.2 Migrate existing z-index values

| Component | Current | Target |
|-----------|---------|--------|
| StatusBar | `z-50` | `z-sticky` (20) |
| FloatingActionBar | `z-50` | `z-sticky` (20) |
| Dialog Overlay | `z-50` / `z-[200]` | `z-overlay` (30) |
| Dialog Content | `z-50` / `z-[200]` | `z-modal` (40) |
| Toast stack | `z-[100]` | `z-toast` (50) |
| Tooltip | `z-50` / `z-[60]` | `z-tooltip` (60) |
| PhotoDetail | `z-[100]` | `z-modal` (40) |
| Nested modals (e.g., AllFacesModal over PhotoDetail) | `z-[200]` / `z-[201]` | `z-toast` (50) — above primary modal |

### 6.3 PhotoDetail Decomposition

> **Note:** This follows the project's [Refactoring Protocol](file:///C:/Users/arozz/.claude/CLAUDE.md) — plan first, move one chunk at a time, verify after each move.

**Proposed split:**

| New Component | Lines (est.) | Responsibility |
|---|---|---|
| `PhotoViewer.tsx` | ~200 | Image display, rotation, zoom, loading states, navigation arrows |
| `FaceOverlay.tsx` | ~250 | Face bounding boxes, inline naming, person links, face box toggle |
| `PhotoMetadata.tsx` | ~150 | EXIF panel, tags, description, add/remove tag |
| `PhotoActions.tsx` | ~100 | Rescan, enhance, delete, before/after comparison trigger |
| `PhotoDetail.tsx` | ~200 | Orchestrator — portal, keyboard nav (arrows/escape), state coordination |

**Migration order:**
1. Extract `PhotoMetadata` (lowest coupling — just reads data)
2. Extract `PhotoActions` (self-contained action buttons)
3. Extract `PhotoViewer` (image display + rotation state)
4. Extract `FaceOverlay` (most coupled — needs image rect, face data, naming state)
5. Slim down `PhotoDetail` to orchestrator

### Files Modified
| File | Change |
|------|--------|
| `src/index.css` | Add z-index scale to theme |
| All modal/overlay components | Migrate to named z-index values |
| `src/components/PhotoDetail.tsx` | Decompose into 4 sub-components |
| `src/components/PhotoViewer.tsx` | **NEW** |
| `src/components/FaceOverlay.tsx` | **NEW** |
| `src/components/PhotoMetadata.tsx` | **NEW** |
| `src/components/PhotoActions.tsx` | **NEW** |

### Testing
- Verify modal stacking order: StatusBar < PhotoDetail < nested modal < Toast < Tooltip
- Verify no visual regressions in PhotoDetail after decomposition
- Verify all existing keyboard shortcuts still work (arrows, escape, tag add)

---

## Phase Summary & Priority

| Phase | Name | Effort | User Impact | Dependencies |
|-------|------|--------|-------------|--------------|
| **1** | Navigation & Sidebar | Low | High | None |
| **2** | Form Control Theming | Medium | High | None |
| **3** | Typography & Font Loading | Low | Medium | None |
| **4** | Empty States & First-Run | Medium | High | None |
| **5** | Accessibility Audit | Medium | Medium | None |
| **6** | Z-Index & PhotoDetail Decomposition | High | Medium | None |

**Recommended execution order:** Phases 1-3 can ship together as a single release (small, low-risk). Phase 4 should precede or coincide with Home Page Dashboard (#2). Phase 5 can be done incrementally. Phase 6 should be done before any major PhotoDetail feature additions.

---

## Relationship to Roadmap Features

| Roadmap Feature | UX Modernization Phase | Synergy |
|-----------------|------------------------|---------|
| **#1 Advanced Library Filtering** | Phase 2 (Filter UX) | Filter pills and styled dropdowns prepare the Library header for compound filters |
| **#2 Home Page Dashboard** | Phase 1 (Nav), Phase 4 (Empty States) | Nav grouping accommodates Home; empty states inform first-run dashboard |
| **#5 Ctrl+Scroll Grid Size** | Phase 2 (Library grid) | Grid improvements pair naturally with dynamic sizing |
| **Settings Page Growth** (#6, #7, #9) | Phase 2 (Form Controls) | Radix Switch pattern scales to new settings panels |
| **PhotoDetail features** (enhance, comparison) | Phase 6 (Decomposition) | Decomposed PhotoDetail makes new features safer to add |

---

## Appendix: Design Tokens Reference

### Color Palette (Current — Preserve)
| Token | Value | Usage |
|-------|-------|-------|
| Background Primary | `gray-900` | Page backgrounds |
| Background Secondary | `gray-800` | Cards, sidebar, inputs |
| Background Tertiary | `gray-700` | Hover states, borders |
| Action Primary | `indigo-600` | Buttons, active nav, focus rings |
| Action Hover | `indigo-500` | Button hover |
| Status Success | `green-400` | Processing active, confirmations |
| Status Warning | `amber-500` / `yellow-400` | Paused, caution |
| Status Danger | `red-600` / `red-400` | Errors, destructive actions |
| Status Info | `blue-400` | Scanning, informational |
| Status Processing | `purple-400` | Re-checking, verification |
| Text Primary | `white` | Headings, active labels |
| Text Secondary | `gray-300` | Body text, descriptions |
| Text Muted | `gray-500` | Captions, placeholders |

### Z-Index Scale (New)
| Name | Value | Usage |
|------|-------|-------|
| `z-navigation` | 10 | Sidebar overlays, dropdowns |
| `z-sticky` | 20 | StatusBar, FloatingActionBar |
| `z-overlay` | 30 | Modal backdrop, dimming layer |
| `z-modal` | 40 | Modal content, PhotoDetail |
| `z-toast` | 50 | Toast notifications, nested modals |
| `z-tooltip` | 60 | Radix Tooltips (always on top) |
