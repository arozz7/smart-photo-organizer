# Frontend Streamlining Plan

> **Goal:** Simplify the People management workflow by consolidating overlapping features, reducing modal fatigue, and clearly separating primary workflows from edge-case tools.

---

## 📋 Executive Summary

The current face management UI has evolved organically, resulting in:
- **4 tabs** (Identified People, Unnamed Faces, Suggestions, Discoveries)
- **7+ modals** for various face management tasks
- **Overlapping functionality** between "Auto-Identify All" and background bucketing
- **Unclear user mental model** of where to perform specific actions

This plan proposes:
1. **Renaming** "Unnamed Faces" to "Edge Cases" to clarify its niche role
2. **Repurposing** "Auto-Identify All" to "Reprocess Edge Cases"
3. **Collapsing modals** into inline filter toggles where possible
4. **Adding notification badges** to guide users to where attention is needed
5. **Maintaining** Suggestions and Discoveries pages as the primary workflow

---

## 📊 Current State Analysis

### User Workflow Priority (Based on Usage Patterns)

```
┌────────────────────────────────────────────────────────────────┐
│  PRIMARY WORKFLOW (80%+ of user time)                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ Suggestions  │ → │ Discoveries  │ → │ Identified People │  │
│  │ (Accept/Rej) │    │ (Name New)   │    │ (Verify Assigns) │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│  EDGE CASE WORKFLOW (Occasional)                               │
│  ┌──────────────────────────────────────┐                      │
│  │ Unnamed Faces (Edge Cases + Cleanup) │                      │
│  └──────────────────────────────────────┘                      │
└────────────────────────────────────────────────────────────────┘
```

### Current Tab Structure

| Tab | Purpose | Current Modals/Features |
|-----|---------|------------------------|
| **Identified People** | View named persons | FAISS rebuild alert, person cards |
| **Unnamed Faces** | On-demand clustering | 6+ modals (Background Filter, Blurry, Ignored, Ungroupable, Grouping Settings, Debug) |
| **Suggestions** | Accept/reject AI matches | Bucket merge toggle, bulk actions |
| **Discoveries** | Name new clusters | Bulk ignore |

### Current Modals Inventory

| Modal | Location | Purpose | Proposed Change |
|-------|----------|---------|-----------------|
| `BackgroundFaceFilterModal` | Unnamed | Identify background/noise faces | Auto-process during scan |
| `BlurryFacesModal` | Unnamed | Review low blur score faces | Inline filter + auto-flag threshold |
| `IgnoredFacesModal` | Unnamed | Review/restore ignored faces | Inline filter toggle |
| `UnmatchedFacesModal` | Unnamed | View ungroupable faces | Inline filter toggle |
| `ClusteringSettingsModal` | Unnamed | Adjust clustering parameters | Keep (power user tool) |
| `FaceDebugModal` | Unnamed | Debug face embeddings | Keep (developer tool) |
| `GroupNamingModal` | All tabs | Name a group of faces | Keep (core action) |
| `RecoveredFacesModal` | Header | View recovered faces from recheck | Keep (feedback for recheck action) |

---

## 🎯 Proposed Changes

### Phase 1: Rename + Reposition (Low Effort, High Clarity)

**Goal:** Establish clearer mental model without breaking existing functionality.

#### 1.1 Rename "Unnamed Faces" Tab

```diff
- Unnamed Faces
+ Edge Cases
```

**Rationale:**
- Background bucketing now handles 90%+ of face organization
- "Unnamed Faces" implies a primary workflow; "Edge Cases" signals exception handling
- Users understand this is for outliers, not the main review process

#### 1.2 Rename "Auto-Identify All" Button

```diff
- Auto-Identify All
+ Reprocess Edge Cases
```

**New Behavior:**
- Only visible on Edge Cases tab
- Tooltip: *"Re-analyze these faces using updated people and thresholds"*
- Use case: Retry failed matches after adding new named people or adjusting era settings

**Files to Modify:**
- `src/views/People.tsx` (line ~806)
- `src/hooks/usePeopleCluster.ts` (line ~117)

---

### Phase 2: Modal → Inline Filters (Medium Effort)

**Goal:** Replace modal-heavy interactions with persistent inline controls.

#### 2.1 New Edge Cases Page Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Edge Cases                                  [Reprocess All]     │
├──────────────────────────────────────────────────────────────────┤
│  Filter: [Ungroupable ✓] [Low Quality] [Ignored] [Background]   │
│          Showing 23 of 87 faces                                  │
├──────────────────────────────────────────────────────────────────┤
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                                │
│  │     │ │     │ │     │ │     │  ← Face grid with hover actions │
│  └─────┘ └─────┘ └─────┘ └─────┘                                │
│  [Name Selected] [Ignore Selected] [Move to Person ▼]           │
└──────────────────────────────────────────────────────────────────┘
```

#### 2.2 Modals to Convert to Inline Filters

| Current Modal | New Filter Pill | Data Source |
|---------------|-----------------|-------------|
| `IgnoredFacesModal` | `[Ignored]` toggle | `faces WHERE is_ignored = 1` |
| `UnmatchedFacesModal` | `[Ungroupable]` toggle | `ungroupableFaces` from hook |
| `BlurryFacesModal` | `[Low Quality]` toggle | `faces WHERE blur_score < threshold` |
| `BackgroundFaceFilterModal` | `[Background]` toggle | `faces WHERE is_background_candidate = 1` |

**New Component:** `EdgeCaseFilters.tsx`

```typescript
interface EdgeCaseFiltersProps {
  activeFilters: Set<'ungroupable' | 'low_quality' | 'ignored' | 'background'>;
  onToggleFilter: (filter: string) => void;
  counts: { ungroupable: number; low_quality: number; ignored: number; background: number };
}
```

**Files to Create:**
- `src/components/EdgeCaseFilters.tsx`

**Files to Modify:**
- `src/views/People.tsx` (Unnamed tab section)
- `src/hooks/usePeopleCluster.ts` (expose filter state)

---

### Phase 3: Background Auto-Flagging (Backend Enhancement)

**Goal:** Move classification from on-demand modals to scan-time auto-processing.

#### 3.1 Scan-Time Auto-Flagging

During photo scan, automatically classify faces into categories:

| Classification | Current Trigger | Proposed Trigger | Flag |
|---------------|-----------------|------------------|------|
| Background/Noise | `BackgroundFaceFilterModal` | Scan-time detection | `is_background_candidate = 1` |
| Low Quality | `BlurryFacesModal` | Blur score threshold | `is_low_quality = 1` |

**Configuration (Settings Page):**
```
Auto-Ignore Thresholds:
  ☐ Auto-ignore blur score below: [___] (default: 0.3)
  ☐ Auto-flag background faces during scan
```

**Database Schema Changes:**
```sql
ALTER TABLE faces ADD COLUMN is_background_candidate INTEGER DEFAULT 0;
ALTER TABLE faces ADD COLUMN is_low_quality INTEGER DEFAULT 0;
```

**Files to Modify:**
- `src/main/services/FaceService.ts` (scan-time classification)
- `src/main/repositories/FaceRepository.ts` (new queries)
- `src/components/SettingsModal.tsx` (threshold configuration)

---

### Phase 4: Notification Badge System (UX Enhancement)

**Goal:** Guide power users to where attention is needed.

#### 4.1 Badge Display

```
┌──────────────────────────────────────────────────┐
│  📬 Suggestions (12)  │  🔍 Discoveries (5)      │
│  👥 People (2 alerts) │  ⚠️ Edge Cases (3 new)   │
└──────────────────────────────────────────────────┘
```

#### 4.2 Badge Triggers

| Tab | Badge Shows When |
|-----|------------------|
| **Suggestions** | New suggestion buckets since last visit |
| **Discoveries** | New discovery buckets since last visit |
| **Identified People** | FAISS rebuild needed OR faces pending verification |
| **Edge Cases** | New ungroupable faces OR recheck completed |

**New State Management:**
```typescript
interface NotificationState {
  suggestionsSeen: number;
  discoveriesSeen: number;
  lastEdgeCaseVisit: Date;
  pendingVerifications: number;
}
```

**Files to Modify:**
- `src/context/PeopleContext.tsx` (badge state)
- `src/views/People.tsx` (badge rendering)

---

### Phase 5: Keyboard Navigation Enhancement (Power User)

**Goal:** Enable rapid keyboard-driven review workflow.

#### 5.1 Global Keyboard Scheme

| Context | Key | Action |
|---------|-----|--------|
| **Suggestions** | `A` | Accept current suggestion |
| | `R` | Reject current suggestion |
| | `→` / `←` | Navigate buckets |
| **Discoveries** | `N` | Open quick-name input |
| | `I` | Ignore cluster |
| | `M` | Merge with previous |
| **Edge Cases** | `Space` | Toggle face selection |
| | `Shift+A` | Assign selected to person |
| | `Shift+I` | Ignore selected |
| **Global** | `1-4` | Switch tabs (Identified/Edge/Suggestions/Discoveries) |
| | `?` | Show keyboard shortcuts overlay |

**Files to Modify:**
- `src/views/People.tsx` (global keyboard handler)
- New: `src/components/KeyboardShortcutsOverlay.tsx`

---

## 🔍 Existing Feature Integration

### Re-check Ignored Faces Service

The existing "Re-check Ignored Faces" button (`handleStartRecheck` in `useBuckets.ts`) remains unchanged. This is a valuable feature that:
1. Scans all ignored faces against current named persons
2. Creates new suggestion buckets for potential matches
3. Displays recovered faces in `RecoveredFacesModal`

**No changes required** — this feature integrates well with the streamlined workflow.

### Background Bucketing Service

The background bucketing service continues to populate Suggestions and Discoveries tabs. The streamlined frontend:
1. Keeps these as the **primary** review pages
2. Moves edge case handling to a separate, clearly labeled tab
3. Reduces confusion about when to use each page

---

## ✅ Testing Strategy

### Pre-Implementation Baseline Tests

**Goal:** Ensure existing functionality works before refactoring.

1. **Unnamed Faces Tab Tests**
   - [ ] Clusters load correctly on tab activation
   - [ ] "Auto-Identify All" triggers identification process
   - [ ] All modals open/close correctly
   - [ ] Keyboard navigation works (`A`/`X`/`N` keys)
   - [ ] Floating action bar appears with selection

2. **Suggestions Tab Tests**
   - [ ] Buckets load from background service
   - [ ] "Combine by Person" toggle works
   - [ ] Confirm/Reject actions update UI optimistically
   - [ ] Bulk actions work correctly

3. **Discoveries Tab Tests**
   - [ ] Discovery buckets display correctly
   - [ ] Naming creates new person OR assigns to existing
   - [ ] Ignore action removes bucket from list

4. **Identified People Tab Tests**
   - [ ] FAISS rebuild alert shows when `faissStaleCount > 0`
   - [ ] Rebuild button triggers index rebuild
   - [ ] Person cards navigate to person detail page

5. **Cross-Tab Tests**
   - [ ] Tab switching clears selection state
   - [ ] Bucket counts update after actions
   - [ ] Re-check ignored populates recovered modal

### Post-Implementation Validation Tests

1. **Rename Changes**
   - [ ] "Edge Cases" tab label displays correctly
   - [ ] "Reprocess Edge Cases" button label correct
   - [ ] Tooltips updated appropriately

2. **Inline Filter Tests** (Phase 2)
   - [ ] Filter pills render with correct counts
   - [ ] Toggling filters updates displayed faces
   - [ ] Multiple filters combine correctly (AND logic)
   - [ ] Filter state persists during session

3. **Auto-Flagging Tests** (Phase 3)
   - [ ] New scans flag low-quality faces
   - [ ] Background candidates marked during scan
   - [ ] Settings thresholds respected

4. **Badge System Tests** (Phase 4)
   - [ ] Badges appear for new content
   - [ ] Visiting tab clears badge
   - [ ] Badge counts accurate

5. **Regression Tests**
   - [ ] All existing keyboard shortcuts still work
   - [ ] No breaking changes to IPC handlers
   - [ ] Database queries return expected results

---

## 📁 Files Affected Summary

### Phase 1 (Rename)
- `src/views/People.tsx` — Tab label, button label
- `src/hooks/usePeopleCluster.ts` — Confirmation dialog text

### Phase 2 (Inline Filters)
- `src/components/EdgeCaseFilters.tsx` — **NEW**
- `src/views/People.tsx` — Unnamed tab restructure
- `src/hooks/usePeopleCluster.ts` — Expose filter state

### Phase 3 (Auto-Flagging)
- `src/main/services/FaceService.ts` — Scan-time classification
- `src/main/repositories/FaceRepository.ts` — New flag queries
- `src/components/SettingsModal.tsx` — Threshold settings
- Database migration for new columns

### Phase 4 (Badges)
- `src/context/PeopleContext.tsx` — Badge state
- `src/views/People.tsx` — Badge rendering

### Phase 5 (Keyboard)
- `src/views/People.tsx` — Global keyboard handler
- `src/components/KeyboardShortcutsOverlay.tsx` — **NEW**

---

## ⚠️ Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Users confused by tab rename | Medium | Add tooltip explaining "Edge Cases" purpose |
| Inline filters slower than modals | Low | Optimize queries, add loading states |
| Auto-flagging false positives | Medium | Make thresholds configurable, default conservative |
| Keyboard shortcuts conflict with browser | Low | Use non-conflicting keys, document in overlay |

---

## 📅 Implementation Order

1. **Phase 1: Rename** (1-2 hours)
   - Low risk, immediate clarity improvement
   
2. **Phase 5: Keyboard** (2-3 hours)
   - Power user value, minimal UI changes
   
3. **Phase 4: Badges** (3-4 hours)
   - Improves discoverability, guides workflow
   
4. **Phase 2: Inline Filters** (6-8 hours)
   - Largest UI change, requires new component
   
5. **Phase 3: Auto-Flagging** (4-6 hours)
   - Backend changes, database migration

---

## 🔗 Related Documents

- [Background Bucketing Plan](file:///j:/Projects/smart-photo-organizer/docs/background-bucketing-plan.md)
- [Smart Ignore Implementation Plan](file:///j:/Projects/smart-photo-organizer/docs/smart-ignore-implementation-plan.md)
- [Advanced Library Filtering Plan](file:///j:/Projects/smart-photo-organizer/docs/advanced_library_filtering_plan.md)
