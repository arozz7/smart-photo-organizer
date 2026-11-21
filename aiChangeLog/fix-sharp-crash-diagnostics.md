# Fix: native sharp crashes (diagnostics and limits) and a stale Python engine guard. Version 0.8.14

**Branch:** `fix/sharp-crash-diagnostics` (stacked on `feature/profile-suggestions` 0.8.13).

## Why
0.8.11 (10:34 PM, 19 Nov) and 0.8.13 (1:23 PM, 20 Nov) each ended with Windows event 1000: faulting module `sharp-win32-x64-0.35.5.node`, exception 0xc0000409, **the same fault offset 0x39034**.
That address is the C runtime inside the sharp module reporting an invalid parameter and calling `__fastfail` (no JavaScript error, so no `try/catch` can catch it). Both happened during heavy image work (a scan of `R:\Pictures\2012` with RAW+JPEG pairs; the second also while the UI loaded face thumbnails after an assignment).
Not memory (128 GB, no resource-exhaustion events); not reproducible with the same files and 150 RAW files at 16 parallel jobs in a separate process; no crash dump and no record of the file in flight existed, so the cause is **not yet known**.

## What changed
- **Crash dumps** (`electron/lib/crashDumps.ts`, started in `main.ts`): Electron's crash reporter writes a minidump (with the call stack) to `userData\Crashpad` on this computer only; **nothing is uploaded**. The log says where they go and how many earlier dumps wait.
- **Breadcrumb and limit** (`electron/services/image/ImageJobTracker.ts`): every sharp job of the thumbnail protocol (`ImageProcessor.process`, `convertRaw`) and of preview generation (`PhotoService.extractPreview`) now runs through one tracker that
  (a) allows 4 sharp jobs at once (the rest wait), and (b) keeps `userData\logs\image-jobs.json` with the files in flight (written 200 ms after a change). If the previous session ended in the middle of jobs, the next start logs `[Main] The last session ended while these image jobs were running: ...`; a normal quit clears it.
- **Fewer native threads:** `sharp.concurrency(2)` (libvips threads per job; the default is the number of CPU cores).
- **Stale engine guard** (`scripts/release/engineFreshness.cjs`, `beforePack.cjs`, `electron-builder.json5`): packaging stops with "Run: npm run build:python" when the frozen Python engine (`python-dist`) is missing or older than the newest `.py` under `src/python`. 0.8.11 to 0.8.13 shipped an engine built on 19 Nov 11:26, without `score_face_visibility`, so Settings > Check Uncertain Faces paused with `Unknown command: score_face_visibility`.
  A rebuilt engine is required for the model check to work. (The check compares file times, so a branch switch that rewrites Python files can ask for a rebuild that was not strictly needed.)

## Tests (written first)
`ImageJobTracker.test.ts` (limit, slot freed on failure, breadcrumb written after a delay, previous session reported, clean shutdown, unwritable file), `crashDumps.test.ts` (nothing uploaded, path logged, earlier dumps warned, start failure tolerated), `engineFreshness.test.ts` (fresh, stale names the file, ignored folders, missing engine). Gate: `scripts/dev/verify.ps1`.

## Assumptions and risks
- **The limit and the thread cap are not a proven fix.** They reduce native parallelism; the dumps and the breadcrumb are what will identify the cause if it crashes again.
- A wait for a free slot delays thumbnails slightly under heavy load; 4 parallel jobs is a constant (`MAX_PARALLEL_IMAGE_JOBS`), not yet a setting.
- Dumps are written to the user's profile folder and can be large; they stay local.
- `image-jobs.json` holds file paths of photos being processed at that moment.
