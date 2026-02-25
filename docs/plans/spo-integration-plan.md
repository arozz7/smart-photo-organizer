# SPO ↔ Photo Repair Shop Integration Plan
## Handoff Document for Smart Photo Organizer

---

## Overview

This document describes all changes required in **Smart Photo Organizer (SPO)** to support
integration with Photo Repair Shop (PRS). It is written for the SPO development context and
follows SPO's CLAUDE.md standards (phased plan, TDD, no code before plan approval).

### Integration Model: SPO Polls PRS

```
SPO                                         PRS (localhost:3847)
 │                                               │
 │── GET /api/health ─────────────────────────►  │  Is PRS running?
 │◄─ { status: 'ok' } ────────────────────────  │
 │                                               │
 │── POST /api/analyze ───────────────────────►  │  Send corrupt file
 │◄─ { jobId } ───────────────────────────────  │
 │                                               │
 │── [every 2s] GET /api/status/:jobId ───────►  │  Poll for result
 │◄─ { status: 'analyzing', percent: 40 } ────  │
 │◄─ { status: 'done', result: {...} } ────────  │  Done!
 │                                               │
 │── POST /api/repair (with candidates) ──────►  │  Execute repair
 │◄─ { jobId } ───────────────────────────────  │
 │                                               │
 │── [poll until done] ───────────────────────►  │
 │◄─ { status: 'done', result: { repairedFilePath } }
 │                                               │
 │── db:clearScanError(errorId) ──────────────   │  Internal SPO cleanup
 │── scan-files([repairedFilePath]) ──────────   │  Re-ingest repaired file
```

### What SPO Gets
- "Send to Repair Shop" action on corrupt files in Settings → Scan Warnings
- Real-time progress display during repair
- Automatic re-ingest of repaired file into library
- Reference file auto-discovery from SPO's own library

---

## Security

### Token Reading
PRS writes a UUID token to `~/.photo-repair-shop/api-token` on every startup.
SPO must read this file and include the token in every API call.

```typescript
// New utility: electron/lib/prs/PrsTokenReader.ts
import os from 'os';
import path from 'path';
import fs from 'fs';

export function readPrsToken(): string | null {
  const tokenPath = path.join(os.homedir(), '.photo-repair-shop', 'api-token');
  try {
    return fs.readFileSync(tokenPath, 'utf-8').trim();
  } catch {
    return null;  // PRS not running or never started
  }
}
```

> **Security note:** The token file is written with `0o600` permissions by PRS (owner read-only).
> SPO should gracefully handle `null` (PRS not available) rather than throwing.
> Never log the token value.

---

## Phase A: Infrastructure — PRS API Client

### Goal
Create a typed HTTP client for calling PRS, with token auth, health checks, and error handling.

---

#### [NEW] `electron/lib/prs/PrsTokenReader.ts`
- `readPrsToken(): string | null` — reads `~/.photo-repair-shop/api-token`

#### [NEW] `electron/lib/prs/PrsClient.ts`
```typescript
// Typed HTTP client for PRS API
// Uses Node.js built-in fetch (Electron 33+ supports it natively)

const PRS_BASE_URL = 'http://127.0.0.1:3847/api';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS  = 300000;  // 5 minutes max

interface PrsAnalyzeRequest {
  filePath: string;
  metadata?: { cameraModel?: string; resolution?: string; fileFormat?: string };
  sourcePhotoId?: number;
}

interface PrsRepairRequest {
  filePath: string;
  strategy: 'header-grafting' | 'preview-extraction' | 'marker-sanitization';
  outputPath: string;
  referenceFilePath?: string;
  candidateReferences?: string[];  // SPO-discovered references, PRS picks best
  autoEnhance?: boolean;
  sourcePhotoId?: number;
}

interface PrsJobStatus {
  jobId: string;
  status: 'queued' | 'analyzing' | 'repairing' | 'verifying' | 'done' | 'failed';
  stage?: string;
  percent?: number;
  sourcePhotoId?: number;
  result?: {
    repairedFilePath: string;
    strategy: string;
    verificationTier: string;
    isVerified: boolean;
    warnings: string[];
  };
  error?: string;
}

export class PrsClient {
  constructor(private token: string) {}

  async checkHealth(): Promise<boolean>;
  async analyze(req: PrsAnalyzeRequest): Promise<{ jobId: string }>;
  async repair(req: PrsRepairRequest): Promise<{ jobId: string }>;
  async getStatus(jobId: string): Promise<PrsJobStatus>;

  // Poll until status is 'done' or 'failed', calling onProgress each interval
  async pollUntilDone(
    jobId: string,
    onProgress: (status: PrsJobStatus) => void,
    timeoutMs?: number
  ): Promise<PrsJobStatus>;

  private async request<T>(method: string, path: string, body?: unknown): Promise<T>;
}
```

#### [NEW] `electron/lib/prs/PrsClient.test.ts`
- Mock `fetch` using `vi.stubGlobal('fetch', ...)`
- Test: health check returns true on 200, false on network error
- Test: analyze returns jobId
- Test: pollUntilDone resolves on `done`, rejects on `failed`, rejects on timeout
- Test: auth header is included on every request (except health)
- Test: non-2xx responses throw typed errors

---

#### [NEW] `electron/lib/prs/PrsLauncher.ts`
```typescript
// Attempt to launch PRS if not already running
// Uses Electron's shell.openPath() to open the PRS executable

export async function ensurePrsRunning(): Promise<boolean> {
  // 1. checkHealth() — if ok, return true
  // 2. If not, attempt shell.openPath(PRS_EXECUTABLE_PATH)
  // 3. Wait up to 5s polling checkHealth()
  // 4. Return true if responsive, false if timeout
}

// Path discovery: check common install locations
// Windows: %LOCALAPPDATA%\Programs\photo-repair-shop\photo-repair-shop.exe
// Fallback: prompt user to open PRS manually
```

#### [NEW] `electron/lib/prs/PrsLauncher.test.ts`
- Test: returns true immediately if PRS already running
- Test: attempts launch if not running
- Test: returns false on timeout

---

## Phase B: IPC Handlers

### Goal
Expose PRS operations to the SPO renderer via new IPC channels.

---

#### [NEW] `electron/ipc/prsHandlers.ts`

Register all `prs:*` IPC handlers. Validates inputs with Zod before calling PrsClient.

```typescript
// Channels:
ipcMain.handle('prs:checkAvailability', async () => {
  // 1. Read token (null = unavailable)
  // 2. checkHealth()
  // Returns: { available: boolean; version?: string }
});

ipcMain.handle('prs:analyzeFile', async (_, payload: { photoId: number }) => {
  // 1. Validate with Zod
  // 2. Look up photo in PhotoRepository (get filePath, metadata_json)
  // 3. Extract cameraModel from metadata_json
  // 4. Call PrsClient.analyze()
  // Returns: { jobId: string }
});

ipcMain.handle('prs:pollStatus', async (_, payload: { jobId: string }) => {
  // Single status poll (renderer manages polling interval)
  // Returns: PrsJobStatus
});

ipcMain.handle('prs:submitRepair', async (_, payload: {
  photoId: number;
  jobId: string;             // From analyze step
  strategy: string;
  outputDir: string;
}) => {
  // 1. Look up photo metadata
  // 2. Find candidate references (call prs:findReferences internally)
  // 3. Determine outputPath (outputDir + original filename + '_repaired')
  // 4. Call PrsClient.repair()
  // Returns: { jobId: string }
});

ipcMain.handle('prs:findReferences', async (_, payload: {
  cameraModel?: string;
  resolution?: string;
}) => {
  // Query PhotoRepository for healthy photos matching camera/resolution
  // Returns top 5 matches as candidate reference paths for PRS
  // Returns: { candidates: string[] }
});

ipcMain.handle('prs:completeRepair', async (_, payload: {
  scanErrorId: number;
  originalPhotoId: number;
  repairedFilePath: string;
}) => {
  // 1. Delete scan_errors entry (existing db:deleteScanError handler logic)
  // 2. Trigger re-scan of repairedFilePath (existing scan-files handler)
  // Returns: { success: boolean; newPhotoId?: number }
});
```

#### [NEW] `electron/ipc/prsHandlers.test.ts`
- Mock PrsClient, PhotoRepository, scanQueue
- Test: `prs:analyzeFile` looks up photo correctly and calls PrsClient
- Test: `prs:findReferences` queries by cameraModel, returns paths
- Test: `prs:completeRepair` clears scan_error and triggers re-scan
- Test: all handlers reject Zod-invalid payloads

---

## Phase C: Reference File Discovery

### Goal
Allow SPO to find healthy photos in its own library that match the corrupt file's camera/settings.
These are sent to PRS as `candidateReferences` so PRS can graft a valid header.

---

#### [NEW] `electron/data/repositories/ReferenceRepository.ts`
```typescript
// Query the photos table for healthy (non-errored) files matching metadata criteria

interface ReferenceQuery {
  cameraModel?: string;     // Extracted from metadata_json->>'$.Model'
  resolution?: string;      // e.g. "6000x4000" from width+height
  format?: string;          // File extension
  limit?: number;           // Default 5
}

export class ReferenceRepository {
  static findCandidates(query: ReferenceQuery): ReferenceCandidate[];
  // SQL: SELECT file_path FROM photos
  //      LEFT JOIN scan_errors ON photos.file_path = scan_errors.file_path
  //      WHERE scan_errors.id IS NULL  -- only healthy files
  //      AND json_extract(metadata_json, '$.Model') = ?
  //      AND width = ? AND height = ?
  //      LIMIT 5
}

interface ReferenceCandidate {
  filePath: string;
  cameraModel: string;
  width: number;
  height: number;
}
```

#### [NEW] `electron/data/repositories/ReferenceRepository.test.ts`
- Test: returns only non-errored photos
- Test: filters by cameraModel correctly
- Test: returns empty array when no matches

---

## Phase D: UI Changes

### Goal
Surface the "Send to Repair Shop" action in existing SPO UI, with progress tracking and result display.

---

### D1: Preload Bridge Update

#### [MODIFY] `electron/preload.ts`
Add new `prs:*` channels to the `ipcRenderer.invoke` allowlist in `contextBridge.exposeInMainWorld`.

```typescript
// Add to existing invoke allowlist:
'prs:checkAvailability',
'prs:analyzeFile',
'prs:pollStatus',
'prs:submitRepair',
'prs:findReferences',
'prs:completeRepair',
```

---

### D2: Scan Warnings Modal Update

#### [MODIFY] `src/views/Settings.tsx` (or `ScanWarnings` subcomponent)

Add "Send to Repair Shop" button per corrupt file entry in the scan errors list.

**UI State Machine per file:**
```
idle → checking_prs → prs_unavailable
                    → analyzing → repair_ready
                                → repairing (with % progress)
                                           → done (success)
                                           → failed (with error)
```

**New UI elements:**
- "Send to Repair Shop" button (disabled if `prs:checkAvailability` returns `{ available: false }`)
- Tooltip: "Photo Repair Shop is not running" when unavailable
- Progress indicator (stage label + percent bar) during analysis/repair
- "Open PRS" link to launch PRS manually if not running
- Success state: "Repaired ✓ — re-added to library" with new photo thumbnail
- Failure state: error message with "Try different strategy" option

**Polling logic (in component or hook):**
```typescript
// useRepairJob.ts
export function useRepairJob(jobId: string | null) {
  // Poll every 2s while jobId is set and status not terminal
  // Stop polling on 'done' | 'failed' | component unmount
  // Returns: { status, percent, stage, result, error }
}
```

#### [NEW] `src/hooks/useRepairJob.ts`
```typescript
// Manages polling lifecycle for a single repair job
// Uses setInterval + cleanup on unmount
// Calls window.ipcRenderer.invoke('prs:pollStatus', { jobId })
```

#### [NEW] `src/hooks/useRepairJob.test.ts`
- Mock IPC; test polling starts on mount, stops on terminal status
- Test: calls onComplete callback with result when done
- Test: calls onError callback when failed

---

### D3: New Type Definitions

#### [NEW] `src/types/prs.ts`
```typescript
export type PrsAvailability = { available: boolean; version?: string };
export type RepairStatus = 'idle' | 'checking_prs' | 'prs_unavailable' | 'analyzing'
                         | 'repair_ready' | 'repairing' | 'done' | 'failed';
export interface RepairState {
  status: RepairStatus;
  jobId?: string;
  percent?: number;
  stage?: string;
  error?: string;
  repairedFilePath?: string;
}
```

---

## Phase E: Re-Ingest Flow

### Goal
After a successful repair, automatically clear the scan error and re-import the repaired file
into SPO's library without user intervention.

---

### Flow

```
prs:completeRepair({ scanErrorId, originalPhotoId, repairedFilePath })
  │
  ├─ db:deleteScanError(scanErrorId)          — Remove error log entry
  ├─ db:deletePhoto(originalPhotoId)          — Remove corrupt photo record
  │   (only if original file is unrecoverable — keep if original still accessible)
  └─ scan-files([repairedFilePath])           — Run full ingest pipeline on repaired file
       │
       ├─ extractPreview()
       ├─ Read EXIF metadata
       ├─ INSERT INTO photos
       └─ analyzeImage() → AI pipeline (faces, tags)
```

### Implementation Notes

- The existing `scan-files` IPC handler already handles the ingest pipeline.
  `prs:completeRepair` just calls it with the repaired file path.
- The original corrupt photo record should be **deleted** (not updated), since the repaired
  file is a new file at a new path. The library should not show duplicates.
- If the user wants to keep the original file, SPO should still show the repaired version
  as the primary library entry. This is consistent with SPO's non-destructive philosophy
  (PRS never modifies originals; the repaired file is new output).
- Emit a UI event after re-ingest so Library grid refreshes automatically.

---

## Verification Plan

### Unit Tests (per Phase)

| Phase | Test File | Coverage Target |
|-------|-----------|----------------|
| A | `PrsClient.test.ts` | Fetch mocking, polling, auth header |
| A | `PrsLauncher.test.ts` | Launch attempts, timeout |
| B | `prsHandlers.test.ts` | IPC dispatch, Zod validation |
| C | `ReferenceRepository.test.ts` | SQL query correctness |
| D | `useRepairJob.test.ts` | Polling lifecycle |
| E | `prsHandlers.test.ts` (completeRepair) | Delete + re-scan flow |

### Integration Tests

1. **Health check integration:** Start mock HTTP server at 3847, verify `prs:checkAvailability` returns true
2. **Full repair flow:** Mock all PRS responses, verify SPO state transitions (idle → done)
3. **Re-ingest:** Mock `scan-files` handler, verify it's called with repaired path after completion

### Manual Verification Checklist

- [ ] Settings → Scan Warnings: "Send to Repair Shop" button visible when PRS running
- [ ] Button disabled with tooltip when PRS not running
- [ ] Progress bar updates during repair (2s poll interval visible)
- [ ] On success: error entry removed from Scan Warnings list
- [ ] On success: repaired photo appears in Library grid
- [ ] On failure: error message shown with actionable text
- [ ] Token not logged in SPO log files

---

## Files Changed Summary

| File | Action | Phase |
|------|--------|-------|
| `electron/preload.ts` | Modify — add prs:* to allowlist | D |
| `electron/ipc/prsHandlers.ts` | New | B |
| `electron/lib/prs/PrsClient.ts` | New | A |
| `electron/lib/prs/PrsTokenReader.ts` | New | A |
| `electron/lib/prs/PrsLauncher.ts` | New | A |
| `electron/data/repositories/ReferenceRepository.ts` | New | C |
| `src/hooks/useRepairJob.ts` | New | D |
| `src/types/prs.ts` | New | D |
| `src/views/Settings.tsx` | Modify — add repair UI to ScanWarnings | D |
| Tests for all of the above | New | All |

---

## Open Questions for SPO Team

1. **Output directory:** Where should PRS write repaired files?
   - Option A: Same directory as original (with `_repaired` suffix)
   - Option B: SPO's library path subfolder (e.g. `library/repaired/`)
   - Option C: User-configurable in SPO Settings

2. **Original file handling after repair:** Delete corrupt original from DB? Keep it?
   - Recommendation: Delete from DB (but never from disk — that's SPO's existing behaviour)

3. **PRS executable path:** How does SPO know where PRS is installed?
   - Recommendation: SPO Settings page — "Photo Repair Shop location" field (browse button)
   - Persisted to SPO's `config.json` via `ConfigService`

4. **UI placement:** ScanWarnings modal is the right entry point for v1, but should repair also
   be accessible from the photo Lightbox? (e.g. right-click → "Repair with PRS")
