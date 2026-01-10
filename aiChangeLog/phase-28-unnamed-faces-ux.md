# AI Change Log - Phase 28: High-Density Unnamed Faces UX

## Summary
Improved the performance and usability of the Unnamed Faces review workflow to support libraries with 10k+ clusters. Implemented specialized filtering and high-speed interaction tools.

## Changes

### 🌟 New Features
- **Progressive Loading**: Optimized the `People` tab to load 100 clusters at a time (virtualization already present, but data loading was previously bottlenecked).
- **Keyboard Navigation**: Implemented rapid-action keys (`A` Accept, `X` Ignore, `N` Name, `Arrows` Nav).
- **Cluster Size Filters**: Added buttons to toggle Large/Medium/Small/Single groups in the toolbar.
- **Ungroupable Faces Search**: Added a dedicated search path for faces that don't match any known person (L2 distance > 1.0).

### 🛠️ Technical Fixes
- **Timeout Reliability**: Increased AI IPC timeouts significantly (up to 15min for clustering) to handle massive library updates.
- **JSON Safety**: Added null-checks to `descriptor_mean_json` parsing in `aiHandlers.ts`.
- **Match Consistency**: Fixed the sensitivity slider to correctly scale similarity to L2 distance for predictable matching.
- **Modal Pagination Stability**: Updated `UnmatchedFacesModal` to maintain its loaded count after actions (replenishing the view) instead of resetting to the initial batch size.
- **Auto-Confirm naming**: Added `confirm` flag support to the "Assign to X" feature in `UnmatchedFacesModal`, ensuring user-accepted suggestions are marked as `is_confirmed = 1`.
- **Empty State Lifecycle**: Fixed a bug where actioned faces would linger in modals after the final batch was processed; added explicit state clearing for empty `faceIds`.

### 📄 Documentation
- Updated `future_features.md` (moved roadmap items to implemented).
- Updated `user_manual.md` with keyboard mappings and filter explanations.
- Created `walkthrough.md` summarizing the new UX.

## Impact
- **Scale**: Users can now manage 10k-50k unnamed faces without UI lag.
- **Speed**: Accept/Ignore actions are now 5-10x faster via keyboard shortcuts.
- **Accuracy**: Separating "Ungroupable" (strangers) from "Suggestible" (friends) reduces cognitive load during review.
