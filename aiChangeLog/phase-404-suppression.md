# Phase: Suppress Local Resource 404 Errors

## Objectives
Suppress noisy `GET 404` errors in the console for missing face previews and resolve Chromium storage contention errors.

## Completed Tasks
- [x] Initialized phase change log.
- [x] Defined `TRANSPARENT_1X1_PNG` as a constant in `electron/main.ts`.
- [x] Refactored `local-resource` protocol handler to support `silent_404=true`.
- [x] Added `Cache-Control: no-cache` header to prevent placeholder caching.
- [x] Added `logger.info` for silent fallback events.
- [x] Verified `FaceThumbnail.tsx` uses the silent flag and detects the 1x1 placeholder.
- [x] Resolved "Critical error found -8" by terminating zombie application processes.
- [x] Documented "External Agent API" in `future_features.md`.

## Diff Narrative
### Files Created/Modified
- [electron/main.ts](file:///j:/Projects/smart-photo-organizer/electron/main.ts): Added `TRANSPARENT_1X1_PNG` buffer and `Cache-Control` headers. Improved error handling scope.
- [src/components/FaceThumbnail.tsx](file:///j:/Projects/smart-photo-organizer/src/components/FaceThumbnail.tsx): Confirmed silent flag usage and 1x1 detection.
- [docs/future_features.md](file:///j:/Projects/smart-photo-organizer/docs/future_features.md): Added Section 18 (External Agent API) and 19 (Containerized Backend).

### Behavior Changes
- Missing face previews no longer trigger red 404 errors in the console.
- Browser correctly falls back to original files without caching the 1x1 placeholder.
- Multi-instance contention errors are resolved via process cleanup.

### Tests Added
- Manual verification of silent vs. noisy 404s.

## Commit Message
```text
feat(protocol): suppress noisy 404 errors and fix storage contention

- Implemented "Silent 404" with 1x1 PNG and Cache-Control: no-cache.
- Cleaned up zombie Electron processes causing 'Critical error found -8'.
- Added documentation for External Agent API and Dockerized Backend.
```
