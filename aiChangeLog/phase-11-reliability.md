# Phase 11: Reliability & Quality Improvements

## Features
- **Smart Scan Queue**: Implemented `ScanQueue` to serialize directory and file scan requests, preventing "scan override" issues where parallel scans would confuse the UI or thrash the disk.
- **Thumbnail Quality**: Increased preview generation resolution from 1200px to **2560px**. This dramatically improves the clarity of face crops, especially for small faces in high-res RAW photos.
- **Corruption Handling**: 
  - Updated `scanner.ts` to catch fatal image processing errors (e.g., "Premature end of JPEG").
  - Failures are now logged to the `scan_errors` table instead of crashing or being ignored.
  - This data is preserved for the upcoming "Photo Recovery" feature.

## Technical Changes
- **Backend Refactor**: Introduced `electron/scanQueue.ts` and updated `ipc/fileHandlers.ts` to use it.
- **Frontend State**: Updated `ScanContext` to use a reference-counting mechanism (`activeScanRequests`) ensuring the "Scanning..." indicator remains active until *all* queued tasks complete.
- **Database**: Leveraged `scan_errors` table for persistent error tracking.

## Tests & Verification
- Verified that selecting multiple folders results in sequential processing (Scan A finishes -> Scan B starts).
- Verified that hitting a corrupt file logs an error to DB and proceeds to the next file.
- Confirmed thumbnail generation uses new 2560px limits.
