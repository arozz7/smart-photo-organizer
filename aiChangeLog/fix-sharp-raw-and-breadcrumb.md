# Fix: camera RAW no longer goes through sharp; the crash breadcrumb is written before a job runs (0.8.21)

**Branch:** `feature/pictures-suggestions` (with the 0.8.21 Settings change).

## Why
The app ended again overnight (23 Nov, 10:55 PM, a folder import of `R:\Pictures\2013`): Windows event 1000, faulting module `sharp-win32-x64-0.35.5.node`, exception 0xc0000409, fault offset 0x39034, the same as 19 and 20 Nov (`fix-sharp-crash-diagnostics.md`).
The crash dump (the 0.8.14 crash reporter) holds one photo path from that scan: `R:\Pictures\2013\April 2013\Orlando Trip\Disney April 08\DSC07059.ARW`, a Sony RAW with a JPEG partner.
`image-jobs.json` was empty: the breadcrumb is written 200 ms after a job starts and the crash came inside that gap, so the file in flight was lost.

**What was tested (outside the app, read-only on the photos, output in memory or the scratchpad):** the same sharp 0.35.5 on that file and its neighbour gives an ordinary JavaScript error ("unsupported image format"); all 5,354 images of `R:\Pictures\2013\April 2013\Orlando Trip` through sharp 4 at a time (the app's limit) finished with no crash, 2,386 of them (the RAW files) failing with the same ordinary error. So the crash was **not reproduced** and its cause is **still not proven**.

## What changed
- **Camera RAW never reaches sharp.** `isCameraRawExtension` (`.arw .cr2 .nef .orf .rw2`) in `electron/utils/imageFormats.ts`. `SharpImageProcessor.process` and `convertRaw` refuse those files with an ordinary error before sharp is called, and `PhotoService.extractPreview` skips its sharp step for them. Every caller then takes the path it already took when sharp failed on a RAW (stored preview, then the Python engine), so the result is unchanged; sharp's native code simply no longer touches these files. DNG and TIFF are not in the list (libvips can read many of them).
- **Breadcrumb at job start.** `ImageJobTracker.run` writes the in-flight list immediately when a job starts (the finish is still written after the 200 ms delay), so a crash inside a job leaves its file in `image-jobs.json` and the next start reports it.

## Behavior notes
- For `.cr2 .nef .orf .rw2`, sharp may previously have decoded a small embedded image for some files; those now go to the Python engine (full quality, as Phase 53 intended). `.arw`, the format seen in the dump, always failed in sharp, so nothing changes for it except that the failed attempt is gone.
- The first sharp attempt on a RAW was wasted work: previews of RAW files were not failing, they came from Python.

## Tests (written first)
`ImageProcessor.cameraRaw.test.ts` (RAW refused without calling sharp, JPEG still reaches it), `imageFormats.test.ts` (camera RAW list), `ImageJobTracker.test.ts` (file on disk before the job runs; finish written after the delay).

## Risks
- The crash may have another trigger (a JPEG, a thumbnail burst while the scan runs). If it happens again, `image-jobs.json` and the dump should now name the file; a real fix waits for that.
- One small synchronous write per image job start.
