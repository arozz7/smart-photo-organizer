# Frontend Streamlining Plan

> **Goal:** Simplify the People management workflow by automating high-confidence assignments, consolidating overlapping features, reducing modal fatigue, and clearly separating primary workflows from edge-case tools.

---

## 📋 Executive Summary

The current face management UI has evolved organically, resulting in:
- **4 tabs** (Identified People, Unnamed Faces, Suggestions, Discoveries)
- **7+ modals** for various face management tasks
- **Overlapping functionality** between "Auto-Identify All" and background bucketing
- **Unclear user mental model** of where to perform specific actions

This plan proposes:
1. **Auto-Assign Suggestions** — Eliminate the Suggestions review step entirely; high-accuracy bucketing assigns directly
2. **Merge Discoveries** — Apply the same grouping logic to Discoveries (by suggested name)
3. **Protect Centroids** — Exclude auto-assigned faces from centroid calculation until confirmed
4. **Rename/Consolidate** — "Unnamed Faces" → "Edge Cases", modals → inline filters
5. **Add navigation aids** — Notification badges, keyboard shortcuts

### Revised Page Structure (3 Tabs)

| Page | Purpose | Key Actions |
|------|---------|-------------|
| **Identified People** | View all named persons, review auto-assignments | View All, Unassign (via "Unconfirmed" filter) |
| **Discoveries** | Name new clusters (merged by suggested name) | Accept, Name, Ignore, individual face actions |
| **Edge Cases** | Handle outliers, low-quality, ungroupable | Reprocess, Manual assign |

**Suggestions tab is removed** — its work is now automated.

### ⚠️ Common UI Patterns (Must Remain Consistent)

> [!IMPORTANT]
> The following UI patterns MUST remain consistent across all group-related pages (Discoveries, Edge Cases):

| Pattern | Description |
|---------|-------------|
| **Keyboard Navigation** | Arrow keys to navigate groups, `A`/`N`/`I` for actions |
| **Actions Toolbar** | Sticky toolbar with bulk actions (Name, Ignore, Move) |
| **Select All Visible** | Checkbox to select/deselect all currently displayed groups |
| **Cluster Toolbar** | Per-group header with quick actions |
| **Progressive Loading** | "Load More" for large datasets |
| **Size Filters** | Filter by group size (All, 2+, 5+, 10+) |

These patterns are already implemented in `ClusterToolbar.tsx` and `ClusterList.tsx` — they must be preserved and extended, not replaced.

---

## 📊 Current vs Proposed Workflow

### Current Flow
```
Background Bucketing → Suggestions Page → User Confirms → Identified People (Review)
                    → Discoveries Page → User Names
```

### Proposed Flow
```
Background Bucketing → Auto-Assign to Person → Identified People ("Unconfirmed" filter)
                    → Discoveries (merged groups) → User Names
```

**Key Change:** Suggestions are auto-assigned; user reviews via existing "Unconfirmed Faces" filter on each person's detail page.

---

## 🎯 Implementation Phases

### Phase 0: Auto-Assign Suggestions (Backend Enhancement) ⭐ NEW

**Goal:** Eliminate the Suggestions review step by auto-assigning high-confidence matches.

#### 0.1 Backend Auto-Assignment

Modify `BackgroundBucketingService` to auto-assign suggestion buckets:

```typescript
// In BackgroundBucketingService.processQueue()
if (bucket.type === 'suggestion') {
    // Auto-assign faces to person
    await faceRepository.assignFacesToPerson(bucket.face_ids, bucket.suggested_person_id, {
        assignment_source: 'auto_suggestion',
        is_confirmed: false  // For centroid protection
    });
    bucket.status = 'auto_assigned';
}
```

#### 0.2 Database Schema Changes

```sql
-- Track how faces were assigned for centroid protection
ALTER TABLE faces ADD COLUMN assignment_source TEXT DEFAULT 'manual';
-- Values: 'manual', 'auto_suggestion', 'auto_identify'

-- Already exists: is_confirmed for centroid exclusion
-- If not: ALTER TABLE faces ADD COLUMN is_confirmed INTEGER DEFAULT 0;
```

#### 0.3 User Notification

After auto-assignment completes, show toast:
```
"✅ 47 faces auto-assigned to known people. Review in Identified People."
```

#### 0.4 Configuration (Optional, Future)

Settings page option for users who want manual confirmation:
```
Face Assignment:
  ⦿ Auto-assign high-confidence matches (recommended)
  ○ Require manual confirmation for all matches
```

**Files to Modify:**
- `src/main/services/BackgroundBucketingService.ts` — Auto-assign logic
- `src/main/repositories/FaceRepository.ts` — `assignFacesToPerson` with source tracking
- `src/views/People.tsx` — Remove Suggestions tab
- `src/hooks/useBuckets.ts` — Remove suggestion bucket handling

---

### Phase 0.5: Centroid Protection ⭐ NEW

**Goal:** Prevent auto-assigned faces from corrupting person centroids until reviewed.

#### 0.5.1 Centroid Calculation Exclusion

Modify centroid recalculation to exclude unconfirmed faces:

```typescript
// In PersonService.calculateCentroid()
const confirmedFaces = await faceRepository.getConfirmedFacesForPerson(personId);
// Only use confirmed faces for centroid
```

#### 0.5.2 Confirmation Triggers

A face becomes "confirmed" when:
1. User explicitly confirms via "Unconfirmed Faces" filter action
2. User visits person page and doesn't unassign (implicit confirmation after N days)
3. User manually assigns a face to a person

#### 0.5.3 Applies to All Auto-Assignments

This protection applies to:
- Auto-assigned suggestions (Phase 0)
- AI queue post-scan auto-identification
- Any future auto-assignment mechanisms

**Files to Modify:**
- `src/main/services/PersonService.ts` — Centroid calculation filter
- `src/main/repositories/FaceRepository.ts` — `getConfirmedFacesForPerson` query
- `src/main/services/FaceMatchingService.ts` — Mark assignments as unconfirmed

---

### Phase 1: Discoveries Merge Enhancement ⭐ NEW

**Goal:** Apply the same merge logic to Discoveries that currently exists for Suggestions.

#### 1.1 Merge by Suggested Name

The Discoveries page already shows "suggested name" for each cluster (AI-generated or inferred). Group clusters by this name:

```typescript
// Extend useMergedBuckets or create useDiscoveryMerge
const mergedDiscoveries = useMemo(() => {
    const grouped = new Map<string, FaceBucket[]>();
    
    for (const bucket of discoveryBuckets) {
        const key = bucket.suggested_name || bucket.ai_suggestion || 'Unknown';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(bucket);
    }
    
    // Merge buckets with same suggested name up to maxSize
    return mergeBucketGroups(grouped, { maxMergedSize: 50 });
}, [discoveryBuckets]);
```

#### 1.2 Face-Level Actions Within Merged Groups

Ensure toolbar functionality for individual faces:
- **Accept**: Accept the suggested name for the entire group (or remaining selected faces)
- **Name**: Open naming modal to provide a different name
- **Ignore**: Ignore individual face (removes from group, updates backend)
- **Move**: Assign individual face to existing person

```
┌────────────────────────────────────────────────────────────────┐
│  Discoveries                           [Combine by Name ✓]     │
├────────────────────────────────────────────────────────────────┤
│  ☐ Select All (47 groups)    Size: [All ▼]    [Ignore Selected]│
├────────────────────────────────────────────────────────────────┤
│  Suggested: "John Smith" (23 faces from 3 clusters)    [A] ✓   │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ...                  │
│  │  ✓  │ │     │ │  ✓  │ │     │ │     │                       │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘                       │
│  [Accept "John Smith"] [Name...] [Ignore Selected] [Move ▼]    │
└────────────────────────────────────────────────────────────────┘
```

**Keyboard Shortcuts (consistent with current patterns):**
- `A` — Accept suggested name for focused group
- `N` — Open naming modal for focused group
- `I` — Ignore focused group
- `↑`/`↓` — Navigate between groups
- `Space` — Toggle face selection within group

#### 1.3 Source Bucket Tracking

Like Suggestions merge, actions route through source buckets:
```typescript
interface MergedDiscoveryBucket {
    suggested_name: string;
    face_ids: number[];
    source_buckets: FaceBucket[];
    is_merged: boolean;
}
```

**Files to Modify:**
- `src/hooks/useMergedBuckets.ts` — Extend for Discoveries OR create `useDiscoveryMerge.ts`
- `src/views/People.tsx` — Discoveries tab rendering
- `src/components/ClusterList.tsx` — Face-level action support

---

### Phase 2: Tab Rename + Remove Suggestions Tab

**Goal:** Establish clearer mental model with 3 tabs.

#### 2.1 Remove Suggestions Tab

```diff
- <button onClick={() => setActiveTab('suggestions')}>
-     Suggestions ({totalSuggestionCount})
- </button>
```

#### 2.2 Rename "Unnamed Faces" → "Edge Cases"

```diff
- Unnamed Faces
+ Edge Cases
```

#### 2.3 Rename "Auto-Identify All" → "Reprocess Edge Cases"

```diff
- Auto-Identify All
+ Reprocess Edge Cases
```

**Files to Modify:**
- `src/views/People.tsx` — Tab structure, button labels
- `src/hooks/usePeopleCluster.ts` — Confirmation dialog text

---

### Phase 3: Modal → Inline Filters (Medium Effort)

**Goal:** Replace modal-heavy interactions with persistent inline controls.

#### 3.1 New Edge Cases Page Layout

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

#### 3.2 Modals to Convert to Inline Filters

| Current Modal | New Filter Pill | Data Source |
|---------------|-----------------|-------------|
| `IgnoredFacesModal` | `[Ignored]` toggle | `faces WHERE is_ignored = 1` |
| `UnmatchedFacesModal` | `[Ungroupable]` toggle | `ungroupableFaces` from hook |
| `BlurryFacesModal` | `[Low Quality]` toggle | `faces WHERE blur_score < threshold` |
| `BackgroundFaceFilterModal` | `[Background]` toggle | `faces WHERE is_background_candidate = 1` |

**New Component:** `EdgeCaseFilters.tsx`

**Files to Create:**
- `src/components/EdgeCaseFilters.tsx`

**Files to Modify:**
- `src/views/People.tsx` (Edge Cases tab section)
- `src/hooks/usePeopleCluster.ts` (expose filter state)

---

### Phase 4: Notification Badge System (UX Enhancement)

**Goal:** Guide power users to where attention is needed.

#### 4.1 Badge Display (Updated for 3 Tabs)

```
┌──────────────────────────────────────────────────────┐
│  👥 People (47 new)  │  🔍 Discoveries (5)          │
│                      │  ⚠️ Edge Cases (3 new)       │
└──────────────────────────────────────────────────────┘
```

#### 4.2 Badge Triggers

| Tab | Badge Shows When |
|-----|------------------|
| **Identified People** | New auto-assignments OR FAISS rebuild needed |
| **Discoveries** | New discovery buckets since last visit |
| **Edge Cases** | New ungroupable faces OR recheck completed |

**Files to Modify:**
- `src/context/PeopleContext.tsx` (badge state)
- `src/views/People.tsx` (badge rendering)

---

### Phase 5: Keyboard Navigation Enhancement (Power User)

**Goal:** Enable rapid keyboard-driven review workflow.

#### 5.1 Global Keyboard Scheme (Updated for 3 Tabs)

| Context | Key | Action |
|---------|-----|--------|
| **Discoveries** | `A` | Accept/Name with suggested name |
| | `N` | Open quick-name input |
| | `I` | Ignore cluster |
| | `→` / `←` | Navigate clusters |
| **Edge Cases** | `Space` | Toggle face selection |
| | `Shift+A` | Assign selected to person |
| | `Shift+I` | Ignore selected |
| **Global** | `1-3` | Switch tabs (Identified/Discoveries/Edge Cases) |
| | `?` | Show keyboard shortcuts overlay |

**Files to Modify:**
- `src/views/People.tsx` (global keyboard handler)
- New: `src/components/KeyboardShortcutsOverlay.tsx`

---

### Phase 6: Configuration Options (Future Enhancement)

**Goal:** Allow power users to tune auto-assignment behavior.

#### 6.1 Settings UI

```
Face Matching Settings:
┌─────────────────────────────────────────────────────────────┐
│ Auto-Assignment                                              │
│   ⦿ Auto-assign high-confidence matches (recommended)       │
│   ○ Require manual confirmation for suggestions              │
│                                                              │
│ Confidence Thresholds                                        │
│   Auto-assign threshold: [0.75 ▼] (current default)         │
│   ⚠️ Lower values may increase false positives               │
│                                                              │
│ Centroid Protection                                          │
│   ☑️ Exclude unconfirmed faces from centroid calculation     │
│   Auto-confirm after: [7 days ▼] without unassignment        │
└─────────────────────────────────────────────────────────────┘
```

**Files to Modify:**
- `src/components/SettingsModal.tsx`
- `src/main/services/SettingsService.ts`

---

## 🔍 Existing Feature Integration

### Re-check Ignored Faces Service

The existing "Re-check Ignored Faces" button (`handleStartRecheck` in `useBuckets.ts`) remains unchanged. Now:
1. Scans all ignored faces against current named persons
2. **Auto-assigns** matches (instead of creating suggestion buckets)
3. Displays recovered faces in `RecoveredFacesModal`

### Unconfirmed Faces Filter (Person Page)

The existing filter on the person detail page becomes the primary review mechanism:
- Shows faces that were auto-assigned
- User can confirm (implicit by not acting) or unassign
- This replaces the Suggestions tab workflow

---

## ✅ Testing Strategy

### Pre-Implementation Baseline Tests

**Goal:** Ensure existing functionality works before refactoring.

1. **Suggestions Tab Tests** (Capture behavior before removal)
   - [ ] Buckets load from background service
   - [ ] "Combine by Person" toggle works
   - [ ] Confirm/Reject actions update UI optimistically
   - [ ] Bulk actions work correctly

2. **Discoveries Tab Tests**
   - [ ] Discovery buckets display correctly
   - [ ] Naming creates new person OR assigns to existing
   - [ ] Ignore action removes bucket from list

3. **Person Detail Page Tests**
   - [ ] "Unconfirmed Faces" filter works
   - [ ] Unassign action removes face from person
   - [ ] Move action reassigns face

4. **Centroid Tests**
   - [ ] Current centroid calculation includes all assigned faces
   - [ ] After Phase 0.5: centroid excludes unconfirmed faces

### Post-Implementation Validation Tests

1. **Auto-Assignment Tests** (Phase 0)
   - [ ] Background bucketing auto-assigns suggestion buckets
   - [ ] Faces marked with `assignment_source = 'auto_suggestion'`
   - [ ] Faces marked with `is_confirmed = 0`
   - [ ] Toast notification shows count of auto-assigned faces
   - [ ] Suggestions tab removed from UI

2. **Centroid Protection Tests** (Phase 0.5)
   - [ ] Centroid calculation query filters `is_confirmed = 0`
   - [ ] Manual assignments set `is_confirmed = 1`
   - [ ] AI queue assignments set `is_confirmed = 0`

3. **Discoveries Merge Tests** (Phase 1)
   - [ ] Buckets grouped by suggested_name
   - [ ] Merged groups respect maxMergedSize (50)
   - [ ] "Combine by Name" toggle works
   - [ ] Individual face actions (ignore, move) work within merged group
   - [ ] Source bucket tracking correct for backend calls

4. **Tab Structure Tests** (Phase 2)
   - [ ] Only 3 tabs visible (Identified, Discoveries, Edge Cases)
   - [ ] "Edge Cases" label displays correctly
   - [ ] "Reprocess Edge Cases" button label correct

5. **Regression Tests**
   - [ ] All existing keyboard shortcuts still work
   - [ ] No breaking changes to IPC handlers
   - [ ] Database queries return expected results
   - [ ] Person page "Unconfirmed" filter still works

---

## 📁 Files Affected Summary

### Phase 0 (Auto-Assign)
- `src/main/services/BackgroundBucketingService.ts` — Auto-assign logic
- `src/main/repositories/FaceRepository.ts` — Assignment source tracking
- `src/views/People.tsx` — Remove Suggestions tab
- `src/hooks/useBuckets.ts` — Remove suggestion bucket handling
- Database migration — `assignment_source` column

### Phase 0.5 (Centroid Protection)
- `src/main/services/PersonService.ts` — Centroid calculation filter
- `src/main/repositories/FaceRepository.ts` — `getConfirmedFacesForPerson`
- `src/main/services/FaceMatchingService.ts` — Mark auto-assignments unconfirmed

### Phase 1 (Discoveries Merge)
- `src/hooks/useMergedBuckets.ts` OR `src/hooks/useDiscoveryMerge.ts` — **NEW/EXTEND**
- `src/views/People.tsx` — Discoveries tab with merge toggle
- `src/components/ClusterList.tsx` — Face-level actions

### Phase 2 (Tab Rename)
- `src/views/People.tsx` — Tab labels
- `src/hooks/usePeopleCluster.ts` — Confirmation dialog text

### Phase 3 (Inline Filters)
- `src/components/EdgeCaseFilters.tsx` — **NEW**
- `src/views/People.tsx` — Edge Cases tab restructure

### Phase 4 (Badges)
- `src/context/PeopleContext.tsx` — Badge state
- `src/views/People.tsx` — Badge rendering

### Phase 5 (Keyboard)
- `src/views/People.tsx` — Global keyboard handler
- `src/components/KeyboardShortcutsOverlay.tsx` — **NEW**

### Phase 6 (Configuration)
- `src/components/SettingsModal.tsx` — Settings UI
- `src/main/services/SettingsService.ts` — Persist settings

---

## ⚠️ Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Auto-assign accuracy regression | High | Keep current thresholds, extensive testing before rollout |
| Users miss auto-assigned faces | Medium | Toast notification + "Unconfirmed" badge on person cards |
| Centroid protection complexity | Medium | Clear documentation, unit tests for edge cases |
| Discoveries merge by wrong key | Low | Use existing `suggested_name` field, fallback to "Unknown" |
| Users want manual confirmation back | Low | Phase 6 adds settings toggle |

---

## 📅 Implementation Order

1. **Phase 0 + 0.5: Auto-Assign + Centroid Protection** (6-8 hours)
   - Critical foundation for workflow simplification
   - Backend changes, database migration
   
2. **Phase 1: Discoveries Merge** (4-6 hours)
   - Applies proven merge logic to Discoveries
   - Ensures face-level actions work
   
3. **Phase 2: Tab Rename + Remove Suggestions** (1-2 hours)
   - Quick win after Phase 0/1 complete
   
4. **Phase 4: Badges** (3-4 hours)
   - Guides users to new workflow
   
5. **Phase 3: Inline Filters** (6-8 hours)
   - Larger UI refactor for Edge Cases
   
6. **Phase 5: Keyboard** (2-3 hours)
   - Power user refinement
   
7. **Phase 6: Configuration** (2-3 hours)
   - User customization options

---

## 🔗 Related Documents

- [Background Bucketing Plan](file:///j:/Projects/smart-photo-organizer/docs/background-bucketing-plan.md)
- [Smart Ignore Implementation Plan](file:///j:/Projects/smart-photo-organizer/docs/smart-ignore-implementation-plan.md)
- [Advanced Library Filtering Plan](file:///j:/Projects/smart-photo-organizer/docs/advanced_library_filtering_plan.md)
