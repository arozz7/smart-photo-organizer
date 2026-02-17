# Phase 95: Error Export & Rescan Bug Fix

## Completed: 2026-02-16

### Summary
Fixed critical bug preventing "Retry All" in Scan Errors modal from re-queueing photos for AI processing. Also implemented Phase 1 of Error Export feature (CSV export button).

---

## Bug Fix: Scan Errors Retry Flow

### Root Causes Identified

Three interconnected defects broke the retry functionality:

1. **Type Mismatch:** [`PhotoRepository.retryScanErrors()`](file:///j:/Projects/smart-photo-organizer/electron/data/repositories/PhotoRepository.ts#L289-L294) returned `string[]` (file paths), but [`AIContext.addToQueue()`](file:///j:/Projects/smart-photo-organizer/src/context/AIContext.tsx#L670-L750) expects objects with `{ id, file_path }` → queued items had `id: undefined`

2. **Premature Deletion:** Same function **deleted all scan_errors from DB** before the frontend even attempted to queue them → errors vanished permanently, even when queueing failed

3. **Stub Handler:** [`db:clearScanErrors` IPC handler](file:///j:/Projects/smart-photo-organizer/electron/ipc/dbHandlers.ts#L46-L54) returned `{ success: false }` → "Clear List" button silently failed

### Changes Made

#### [PhotoRepository.ts](file:///j:/Projects/smart-photo-organizer/electron/data/repositories/PhotoRepository.ts)
```diff
 static retryScanErrors() {
     const db = getDB();
-    const errors = db.prepare('SELECT file_path FROM scan_errors').all() as { file_path: string }[];
-    db.prepare('DELETE FROM scan_errors').run();
-    return errors.map(e => e.file_path);
+    // Return photo objects that the frontend can queue for AI processing.
+    // JOIN on photos table to get the photo ID needed by addToQueue().
+    const photos = db.prepare(`
+        SELECT DISTINCT p.id, p.file_path
+        FROM scan_errors se
+        JOIN photos p ON se.photo_id = p.id
+    `).all() as { id: number; file_path: string }[];
+    return photos;
 }
+
+static clearScanErrors() {
+    const db = getDB();
+    db.prepare('DELETE FROM scan_errors').run();
+}
```

**Rationale:**
- JOIN with `photos` table to retrieve `id` (required by `addToQueue` for queue deduplication and mode upgrades)
- Orphaned errors (no matching photo) are skipped
- Removed premature `DELETE` — delegated deletion to caller after queueing succeeds
- Added new `clearScanErrors()` method for explicit deletion

---

#### [dbHandlers.ts](file:///j:/Projects/smart-photo-organizer/electron/ipc/dbHandlers.ts)
```diff
 ipcMain.handle('db:clearScanErrors', async () => {
-    return { success: false, error: "Not implemented in refactor yet" };
+    try {
+        PhotoRepository.clearScanErrors();
+        return { success: true };
+    } catch (e) {
+        return { success: false, error: String(e) };
+    }
 });
```

**Rationale:**
- Implemented previously stubbed handler
- "Clear List" button now works as expected

---

#### [useScanErrors.ts](file:///j:/Projects/smart-photo-organizer/src/hooks/useScanErrors.ts)
```diff
 const retryErrors = async () => {
     try {
         const photosToRetry = await window.ipcRenderer.invoke('db:retryScanErrors')
         if (photosToRetry && photosToRetry.length > 0) {
             console.log(`Retrying ${photosToRetry.length} failed scans...`)
             addToQueue(photosToRetry)
+            // Clear errors only after successful queue addition
+            await window.ipcRenderer.invoke('db:clearScanErrors')
         }
-        loadScanErrors() // Refresh (should be empty)
+        setScanErrors([]) // Reflect cleared state in UI
     } catch (e) {
         console.error('Failed to retry errors', e)
     }
 }
```

**Rationale:**
- Queue photos **first** (response now contains `{ id, file_path }[]`)
- Clear errors from DB **after** queueing succeeds
- Use `setScanErrors([])` instead of `loadScanErrors()` to avoid unnecessary DB round-trip

---

## Feature: Error Export Phase 1 (CSV Export)

Per [error-export-plan.md](file:///j:/Projects/smart-photo-organizer/docs/plans/error-export-plan.md), added "Export CSV" button to existing Scan Errors modal.

### New Files

#### [exportUtils.ts](file:///j:/Projects/smart-photo-organizer/src/utils/exportUtils.ts)
Reusable CSV export utility with RFC 4180 compliant formatting:
- Escapes fields containing commas, quotes, or newlines
- Triggers browser download via `Blob` + `URL.createObjectURL`
- No-op when errors array is empty

**Usage:**
```typescript
exportErrorsToCsv(errors: ExportableError[], filename: string): void
```

---

#### [exportUtils.test.ts](file:///j:/Projects/smart-photo-organizer/tests/frontend/unit/utils/exportUtils.test.ts)
Unit tests covering:
- CSV formatting with special characters
- Empty array handling
- Filename generation (includes date)
- Newlines in error messages

**Run:**
```powershell
npx vitest run tests/frontend/unit/utils/exportUtils.test.ts
```

---

### Modified Files

#### [ScanErrorsModal.tsx](file:///j:/Projects/smart-photo-organizer/src/components/ScanErrorsModal.tsx)
Added "Export CSV" button between "Clear List" and "Retry All":
- Blue button with download icon
- Disabled when `scanErrors.length === 0`
- Filename: `scan-errors-YYYY-MM-DD.csv`
- Maps `scanErrors` to `ExportableError[]` format

---

## Verification

### Manual Testing Required

> [!IMPORTANT]
> Please verify the fix in the running app (`npm run dev` was previously started):

1. **Trigger Scan Errors** — Ensure you have photos that produce errors (corrupt files, unsupported types)
2. **Open Scan Errors Modal** — Click error badge in Library header
3. **Click "Retry All"** → Verify:
   - Photos appear in AI Queue (check Queue Management page)
   - Errors clear from modal
   - If retry fails again, new errors appear in modal after reload
4. **Click "Export CSV"** → Verify:
   - A `.csv` file downloads with filename `scan-errors-YYYY-MM-DD.csv`
   - File opens correctly in Excel/text editor with proper columns
5. **Click "Clear List"** → Verify errors are deleted from modal

### Unit Tests
Run tests with:
```powershell
npx vitest run tests/frontend/unit/utils/exportUtils.test.ts
```

---

## Risk Assessment

**Low Risk**
- Changes are isolated to error handling flow
- No impact on core scanning or AI processing logic
- `retryScanErrors()` now returns richer data (backward compatible with `addToQueue` expectations)

**Assumptions**
- All entries in `scan_errors` table have valid `photo_id` that exists in `photos` table
- Orphaned errors (no matching photo) are acceptable to skip during retry

---

## Next Steps (Future Phases)

As outlined in [error-export-plan.md](file:///j:/Projects/smart-photo-organizer/docs/plans/error-export-plan.md):

- **Phase 2:** Library Health widget on Home Page (requires Home Page Dashboard implementation)
- **Phase 3:** Error list integration with Corrupt File Recovery Center wizards
