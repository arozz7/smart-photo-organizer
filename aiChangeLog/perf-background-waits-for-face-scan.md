# Perf: background tasks wait for the face scan, with a setting to run them alongside (0.8.25), and the stall fix (0.8.26)

**Branch:** `feature/pictures-suggestions`.

## Why (measured on the real library with 0.8.24)
- The 0.8.24 quiet rule did not hold. Over 2 h 40 min the face scan did 546 photos, while the engine also ran 1,251 captions, 688 face checks and about 790 other background requests. There was not one minute of scanning with the engine to itself. Median scan speed in those minutes was **10 photos a minute**, against about **27 a minute** in the first seconds after start-up, before any background task ran.
- Cause: the "face queue is working" flag drops to off between two photos (sampled for 20 s: off in 57% of the samples). Each background service looked at the flag only when it woke up, so the "10 s of quiet" in 0.8.24 was passed by chance, and only face verification and captions used that rule at all. Face visibility, picture check, grouping and others checked the bare flag. In one 8-second window a caption, a face check, a picture score, a face-visibility score and a grouping batch all reached the engine while photos were being scanned. The engine answers one request at a time.

## What changed
- **`AppStateRepository.isAIProcessingActive()`** stays "busy" until 15 s after the face queue last worked (it remembers when the flag last changed). All the background services already ask this one function, so they all wait now, with no change in each of them. `setAIProcessingActive` records the time; both take an optional `now` for tests.
- **New setting `backgroundDuringScan`** (default off) in Settings, AI Performance: "Background tasks while scanning". On means a waiting time of 0 (the old behavior: tasks run in the gaps between photos, the scan gets slower). It is applied at once when saved and at start-up, no reload.
- **`core/services/backgroundPolicy.ts`** (new): `BACKGROUND_WAIT_AFTER_SCAN_MS` (15 s) and `backgroundIdleGraceMs(settings)`.
- The 0.8.24 `QuietGate` in the verification and caption services stays as a second guard (it does no harm; with the waiting time it is redundant).

## Behavior notes
- Descriptions, tags, face checks and grouping now start 15 s after the face queue stops. With 20,000 photos still waiting for faces, that is hours from now; captions will not appear until the face scan is through (or the setting is on).
- Actions the user starts (re-match, face-visibility run) say "busy" for up to 15 s after the queue stops.

## Tests (written first)
`AppStateRepositoryActivity.test.ts` (gap between photos stays busy, quiet after the waiting time, resets on new work, zero follows the flag), `backgroundPolicy.test.ts`, `AiPerformanceSection.test.tsx` (checkbox: default, shows the saved value, reports a change, offered without Smart Tags), `Settings.test.tsx` (saves merged, no reload).

## Findings not yet fixed (next)
1. **Photos are scanned twice.** In the same window 162 of 540 photos (30%) were fully scanned by the engine twice (the same "Analyze Request" is sent again after the first scan finished), and 222 more duplicate requests were skipped. This is wasted engine time on a third of the photos. The renderer queue (`AIContext.tsx`, at 901 lines, cannot grow) needs a fix; extract the queue first.
2. **A 54-minute stall** (12:23:57 to 13:17:53 UTC) with 20,000 photos waiting and no pause by the user. Most likely cause (not proven): the queue's 60 s "cooldown" after every 500 photos is counted with a 1-second timer in the window, and Chromium slows timers in a hidden or minimized window to about one tick a minute (60 ticks is about an hour). Fixed in 0.8.26, see below.

## 0.8.26: the pause between batches no longer depends on timer ticks
- `AIContext.tsx`: the cooldown ends at a fixed time (`Date.now() + cooldownSeconds`) and each tick only reads the clock, so one late tick ends it. No net lines added (the file is at its size limit).
- `windowManager.ts`: the main window sets `backgroundThrottling: false`, so the queue's timers keep running when the window is hidden, minimized or covered.
- Test (written first, failed before the fix): `AIContext.test.tsx`, "ends the pause between batches by the clock": a minute passes but the timer runs once, and the next photo starts.
- Risk: a hidden window now uses a little more CPU. The cause of the stall is likely, not proven; the next long unattended run will show it (look for gaps in `[Timing]` lines).
