# Fix: Home cards flickering while the "Grouping Faces" bar shows. Version 0.8.15

**Branch:** `fix/home-flicker` (stacked on `fix/sharp-crash-diagnostics` 0.8.14).

## What was found
- **Status polling re-rendered everything every second.** While grouping (or re-checking) runs, `AIContext` polls `db:getBucketingStatus` every second and stored each answer as a new object, so every component that reads the AI state re-rendered every second even when nothing had changed.
  A test showed it: 5 polls with identical values caused 5 extra renders of a consumer.
- **The Python engine was pinged every second** (`get_system_status` and `ping`) for the same reason. The engine is single-threaded and busy while grouping.
- **The scan widget changed height.** The first full-width Home card (`ScanEntertainmentWidget`) added and removed rows (metrics, "Scan finished") as the scan went on, and each change pushed every card below it.
- **The status bar blurred what is behind it** (`backdrop-blur`) while its spinner and counter changed every second; on some GPUs that makes the content under it flicker.
- **Not reproduced.** In a test copy with the Grouping bar active (no scan running), the Home cards had no DOM change, no layout shift and no pixel change over 60 frames; so these are the plausible causes, not a confirmed one. The reporter checks 0.8.15.

## What changed
- `src/utils/keepIfSame.ts`: a status poll that returns the same values changes nothing (used for the grouping, re-check and system status in `AIContext`).
- `AIContext`: the engine status is asked every 5th second while grouping is active (the counter still every second). The file did not grow (901 lines).
- `ScanEntertainmentWidget`: the stat rows are always shown (a dash until the number is known) and the "Scan finished" line keeps its space while scanning (hidden, not removed), so the widget's height is constant while it is visible.
- `StatusBar`: solid background instead of the blur.

## Tests (written first)
`keepIfSame.test.ts`; in `AIContext.test.tsx`: consumers do not re-render on an unchanged poll (failed with 10 renders instead of 5 before the fix) and the engine is pinged far less often than the counter; `ScanEntertainmentWidget.test.tsx` (same rows before metrics, with metrics and after the scan; dash for unknown numbers; finished line hidden while scanning).
The status bar change is a style change and has no test.

## Assumptions and risks
- The widget still appears when a scan starts and disappears 30 s after it ends; that one-time move of the cards below it is unchanged.
- The engine status in Settings can be up to 5 s old while grouping runs.
