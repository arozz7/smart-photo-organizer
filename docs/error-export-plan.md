# Error Export & Library Health Implementation Plan

## Overview

This plan extends the existing Scan Errors functionality with export capabilities and integrates error tracking into the planned Home Page Dashboard as a "Library Health" widget.

## Wireframes

### Phase 1: Enhanced Scan Errors Modal

![Enhanced Scan Errors Modal with Export Button](file:///C:/Users/arozz/.gemini/antigravity/brain/c68c0c3f-c952-4a19-b875-1169d28076d1/error_modal_wireframe_1768536521506.png)

**Key Changes:**
- New **"Export CSV"** button between "Clear List" and "Retry All"
- Export includes all visible errors with full metadata

---

### Phase 2: Home Page Library Health Widget

![Library Health Dashboard Widget](file:///C:/Users/arozz/.gemini/antigravity/brain/c68c0c3f-c952-4a19-b875-1169d28076d1/health_widget_wireframe_1768536538208.png)

**Key Features:**
- 2x1 widget for the Home Page grid
- Quick access to View (opens modal) and Export (direct download)
- Extensible for Blurry Photos when that feature is implemented

---

## Proposed Changes

### Phase 1: Modal Export Enhancement

#### [MODIFY] [ScanErrorsModal.tsx](file:///j:/Projects/smart-photo-organizer/src/components/ScanErrorsModal.tsx)

1. Add "Export CSV" button to modal footer
2. Implement `handleExportCsv()` function:
   - Collect all scan errors from context/state
   - Format as CSV with columns: `File Path`, `Error Type`, `Error Message`, `Scan Type`, `Timestamp`
   - Trigger browser download with filename `scan-errors-{YYYY-MM-DD}.csv`

#### [NEW] [exportUtils.ts](file:///j:/Projects/smart-photo-organizer/src/utils/exportUtils.ts)

Reusable CSV export utility:
```typescript
interface ExportableError {
  filePath: string;
  errorType: string;
  errorMessage: string;
  scanType: string;
  timestamp: string;
}

export function exportToCsv(data: ExportableError[], filename: string): void;
```

---

### Phase 2: Home Page Integration (Deferred)

> [!NOTE]
> Phase 2 depends on the **Home Page Dashboard** (Roadmap #2) being implemented first.

#### [NEW] [LibraryHealthWidget.tsx](file:///j:/Projects/smart-photo-organizer/src/components/widgets/LibraryHealthWidget.tsx)

- Displays count of Scan Errors and Blurry Photos
- "View" button opens respective modal
- "Export" button triggers CSV download directly

#### [MODIFY] [HomePage.tsx](file:///j:/Projects/smart-photo-organizer/src/views/HomePage.tsx)

- Register `LibraryHealthWidget` in the widget grid system
- Default position in "Balanced" layout preset

---

### Phase 3: Tools Page Integration (Future)

> [!NOTE]
> Phase 3 depends on the **Corrupt File Recovery Center** being implemented.

- Error list becomes input data for recovery wizards
- "Export for Review" vs. "Attempt Auto-Repair" action split

---

## Export CSV Format

| Column | Description | Example |
|--------|-------------|---------|
| `file_path` | Full path to the file | `R:\Pictures\2011\photo.jpg` |
| `error_type` | Category of error | `Initial Scan`, `Rescan`, `AI Processing` |
| `error_message` | Detailed error description | `Unsupported file format or not RAW file` |
| `scan_type` | Origin of the error | `Initial Scan`, `Force Rescan` |
| `timestamp` | When the error occurred | `2026-01-16T03:47:44` |

---

## Verification Plan

### Manual Testing (Phase 1)

1. **Trigger Scan Errors:** Force errors by adding unsupported file types to a monitored folder
2. **Open Modal:** Click the error badge in the header to open the Scan Errors modal
3. **Export CSV:** Click "Export CSV" and verify:
   - File downloads with correct naming (`scan-errors-2026-01-16.csv`)
   - CSV opens in Excel/text editor with correct columns
   - All displayed errors are present in the export
4. **Edge Cases:**
   - Export with 0 errors (button should be disabled or show toast)
   - Export with 100+ errors (verify performance)

### Unit Tests (Phase 1)

#### [NEW] [exportUtils.test.ts](file:///j:/Projects/smart-photo-organizer/tests/unit/exportUtils.test.ts)

- Test CSV formatting with various data shapes
- Test filename generation with date
- Test empty array handling

---

## Dependencies

| Phase | Depends On | Status |
|-------|------------|--------|
| Phase 1 | None | Ready to implement |
| Phase 2 | Home Page Dashboard (Roadmap #2) | Pending |
| Phase 3 | Corrupt File Recovery Center | Backlog |

---

## Alignment with Roadmap

This feature bridges several planned capabilities:

- **Home Page Dashboard:** Library Health widget provides persistent visibility
- **Blurry Photo List Export:** Same export pattern and utility functions
- **Corrupt File Recovery Center:** Error list serves as input for repair wizards
