# Future Features & Roadmap

## 🚀 Priority Roadmap

### 1. UX Modernization (UI Polish) ✅ Complete — v0.8.0
- **Goal:** Elevate the UI from functional to polished product quality through systematic improvements to navigation, controls, typography, accessibility, and first-run experience.
- **Core Features:**
    - **Sidebar Navigation:** Add Radix icons to all nav links, group items by category (Core/Tools/System) with subtle dividers, extract reusable `SidebarLink` component.
    - **Form Control Theming:** Replace native `<input type="checkbox">` with Radix Switch in SettingsModal (3 instances). Replace native `<select>` dropdowns in Library with styled alternatives.
    - **Library Filter UX:** Show active filters as removable pill/chip badges instead of hiding state inside dropdowns. Fix folder disambiguation — show 2-3 path segments instead of leaf-only names to resolve duplicate "Birthday" folders.
    - **Typography:** Bundle Inter font via `@fontsource-variable/inter` — currently declared but not loaded, causing silent fallback to Segoe UI.
    - **Empty States:** Add `EmptyState` component for first-run (no photos), no filter results, no people found, and empty tab states with contextual action buttons.
    - **Accessibility:** Add `role="button"` + `tabIndex` + keyboard handlers to clickable `<div>` elements (PersonCard, grid items). Add `aria-label` to icon-only buttons. Add `role="status"` + `aria-live` to StatusBar. Global `focus-visible` outline.
    - **Z-Index Scale:** Define semantic z-index tokens (`z-navigation: 10`, `z-sticky: 20`, `z-overlay: 30`, `z-modal: 40`, `z-toast: 50`, `z-tooltip: 60`) to replace ad-hoc values (`z-50`, `z-[100]`, `z-[200]`, `z-[201]`).
    - **PhotoDetail Decomposition:** Split 1000+ line component into `PhotoViewer`, `FaceOverlay`, `PhotoMetadata`, `PhotoActions` + orchestrator (~200 lines each) following refactoring protocol.
- **Implementation Phases:**
    1. Navigation & Sidebar (Low effort, high impact)
    2. Form Control Theming (Medium effort, high impact)
    3. Typography & Font Loading (Low effort, medium impact)
    4. Empty States & First-Run (Medium effort, high impact)
    5. Accessibility Audit (Medium effort, medium impact)
    6. Z-Index Scale & PhotoDetail Decomposition (High effort, medium impact)
- **Synergies:** Phase 2 prepares Library header for Advanced Filtering (✅ Complete). Phase 1+4 prepare navigation for Home Page Dashboard (✅ Complete). Phase 6 makes PhotoDetail safer for future feature additions.
- **Implementation Plan:** See [UX Modernization Plan](file:///j:/Projects/smart-photo-organizer/docs/plans/ux-modernization-plan.md)

### 6. Duplicate Photo Detection ✅ Complete — Phase 107
- **Goal:** Find and safely remove redundant photos — exact copies and visually similar near-duplicates.
- **Delivered:**
    - **SHA-256 exact matching:** Computed at scan time (streaming Node.js); groups byte-for-byte identical files.
    - **pHash near-duplicate detection:** Computed during AI analysis (Python `imagehash`); Hamming distance ≤ 10 bits out of 64 bits.
    - **BackgroundDuplicateCheckerService:** Idle-only service with automatic backfill for pre-existing photos (SHA-256: 100/batch, pHash: 20/batch); runs exact + near passes when signalled.
    - **DuplicateGroupRepository:** Full CRUD for `duplicate_groups` table; `findExistingGroup` guard prevents re-creating groups on re-runs.
    - **DB schema:** `sha256_hash`, `phash`, `duplicate_group_id` columns on `photos`; `duplicate_groups` table with `type` (exact/near), `status` (pending/resolved/dismissed), `winner_photo_id`.
    - **Python:** `compute_phash_batch`, `group_near_duplicates` (Union-Find O(n²)) registered as AI commands.
    - **Duplicates view:** Stats pills, HashingBanner (polls every 5 s), 3-tab layout (Pending/Resolved/Dismissed), paginated group cards (20/page).
    - **DuplicateGroupCard:** N-photo filmstrip, auto-selects best photo (best resolution → earliest date); multi-select keep — click any photo to toggle keep/trash independently; at least one must remain selected; button label shows count ("Keep 2 selected & trash others"); `keepPhotoIds[]` passed to IPC.
    - **Sidebar badge:** Yellow pending count (polls every 60 s).
- **Change Log:** [phase-107-duplicate-detection.md](../../aiChangeLog/phase-107-duplicate-detection.md)

### 5. Upstream False Positive Reduction ✅ Complete — Phase 106
- **Goal:** Prevent cartoon characters, objects, and non-human detections from polluting the face database.
- **Problem:** High-confidence false positives (det_score ≥ 0.70) bypassed VLM verification and became permanent accepted detections.
- **Delivered:**
    - **Lever 1 — VLM Band Calibration:** `score_threshold_accept` raised from 0.70 → 0.75 in Strict Mode (`STRICT_SCORE_THRESHOLD_ACCEPT`). Synced to `ai-config.json` on toggle so Python reads the correct threshold.
    - **Lever 2 — Pose-Weighted DBSCAN:** `anchor_only_frontal` flag passed to Python clustering. High-yaw faces (pose_yaw > 55°) cannot start clusters but can still join them; `pose_yaw` added to `getFacesNeedingBucketing` fetch.
    - **Lever 3 — Background VLM Re-Verification:** `BackgroundVerificationService.processOrphanedFaces()` batches orphaned accepted faces (needs_bucketing=0, bucket_id=NULL, person_id=NULL) through VLM during idle time; rejections set `is_ignored=1, ignore_source='background_verification'`.
    - **DB Migration:** `ignore_source` column added to `faces` table; `FaceRepository.ignoreFaces()` accepts optional `source` param.
    - **Settings Toggle:** "Strict False Positive Mode" in Advanced AI Settings (off by default).
- **Change Log:** [phase-106-false-positive-reduction.md](../../aiChangeLog/phase-106-false-positive-reduction.md)

### 4. Hard Pose Handling & Context Propagation ✅ Complete — Phase 105
- **Goal:** Improve recognition accuracy for side profiles, top-down views, and other challenging face angles.
- **Problem:** Standard embeddings from extreme angles (yaw > 45°) produce lower-quality matches, leading to missed identifications or false positives.
- **Delivered:**
    - Pose distribution widget on Library Health dashboard (frontal/profile/severe counts).
    - Pose filter toggle in People → Unnamed Faces (All / Frontal ≤30° / Profile >45°).
    - Per-person frontal + profile centroids computed after every mean recalculation; checked in `matchAgainstCentroids`.
    - `ContextualMatchingService` — temporal (±5 min / same session) + spatial (GPS ≤100 m) consensus voting assigns hard-pose / blurry faces (≥70% anchor agreement required).
    - `BackgroundPropagationService` — idle-only hourly propagation pass.
    - Assignment source badges ('T' / 'G') on face thumbnails.
    - One-click library-wide propagation in Settings → Smart Assignment.
- **Change Log:** [phase-105-pose-context-propagation.md](../../aiChangeLog/phase-105-pose-context-propagation.md)
---


## 🔮 Feature Backlog

### AI & Computer Vision
- **Enhanced CLIP Tagging:** ✅ Complete — Phase 109. Dropped Coco-SSD; replaced flat label list with structured `LABEL_TAXONOMY` (10 categories, ~90 labels); two-pass classification (broad scene → domain-specific). See [Changelog](../../aiChangeLog/phase-109-clip-tagging.md)
- **SAM 3 Creative Tools Service:** ✅ Complete — Phase 110. Model-agnostic `SegmentationProvider` ABC + `Sam3Provider` (text/box/point prompts via HuggingFace Transformers). 7 FastAPI endpoints (`/capabilities`, `/set-image`, `/predict`, `/apply/background-remove`, `/apply/isolate`, `/apply/blur`, `/apply/enhance`). See [Changelog](../../aiChangeLog/phase-110-sam3-creative-tools.md)
    - **Frontend Creative Tools UI:** ✅ Complete — Phase 111. Interactive canvas UI with text/box/point prompt modes, mask overlay, operations bar (Remove BG, Isolate, Blur, Sharpen), result preview with checkerboard transparency, and download. See [Changelog](../../aiChangeLog/phase-111-creative-tools-ui.md)
- **SAM 3 Text Prompts & PCS Mode — Phase 112:**
    - **Goal:** Activate SAM 3's headline feature — open-vocabulary text segmentation. The paper confirms `Sam3Model` natively supports text prompts (e.g., "person on the left", "red umbrella"). Our current `predict_from_text` deliberately returns empty based on a Phase 111 assumption that was never validated against the actual HuggingFace API. This is a bug fix for a core advertised capability.
    - **Background:** SAM 3 distinguishes two task types. PVS (Promptable Visual Segmentation) uses points/boxes to target a specific instance. PCS (Promptable Concept Segmentation) uses text or image exemplars to return **all matching instances at once** (e.g., "person" → masks for every person in the photo). Text prompts are PCS. The model architecture includes a 32-token causal text encoder and a Fusion Encoder that cross-attends text and vision features before detection queries run.
    - **Core Features:**
        - **Fix `predict_from_text`:** Replace stub with real call — `Sam3Processor(images=image, text="noun phrase")` → `Sam3Model` → `post_process_instance_segmentation`. Short noun phrases only (2–5 words; the paper notes the 32-token limit).
        - **Multi-Instance Result Display:** Text prompts return N masks (one per found instance). Add a filmstrip-style "Found instances" panel below the canvas when N > 1. Each thumbnail is clickable to select which mask to operate on, plus a "Select All" mode that unions all masks.
        - **Text + Negative Box Refinement:** Combine text prompt with one or more negative bounding boxes (`input_boxes_labels=[[0]]`) to exclude regions. UX: after entering text, user can optionally switch to "exclusion box" draw mode to crop out false matches. Backed by combined `processor(images=image, text=..., input_boxes=[[neg_box]], input_boxes_labels=[[0]])` call.
        - **UI Label Fix:** Change "not available with SAM 3" tooltip to reflect actual capability. Add placeholder hint text in the text input (e.g., "person on the left · red umbrella · dog").
        - **Confidence Threshold Slider:** Expose `threshold` and `mask_threshold` (both default 0.5) in the ops bar so the user can tune how strict the match is.
    - **Implementation Phases:**
        1. Python: Implement real `predict_from_text` in `Sam3Provider` using `Sam3Model` + `Sam3Processor` with text kwarg. Add `predict_from_text_with_exclusions(text, neg_boxes)` variant.
        2. IPC/Hook: Extend `segment_predict` payload and `useSegmentation` hook to carry `text_threshold` and `exclusion_boxes` fields.
        3. UI: Fix mode button label + tooltip; add text input placeholder; wire confidence sliders.
        4. UI: Multi-instance filmstrip component — renders when `masks.length > 1`; select/deselect individual masks; "union all" checkbox.
        5. Tests: Python unit tests for `predict_from_text` with a known image + text pair; test exclusion box path.
    - **Change Log:** `aiChangeLog/phase-112-sam3-text-prompts.md`

- **SAM 3 New Operations — Phase 113:**
    - **Goal:** Add three high-value creative operations to `segmentation_ops.py` and the `CreativeOperationsBar` that the SAM 3 blog and paper both highlight as flagship effects. All are pure Python PIL operations — no model changes, no new model downloads.
    - **Core Features:**
        - **Pixelate Background:** The SAM 3 Playground explicitly names "pixelation" as a template effect. Apply to non-subject pixels: resize masked region down to `max(W,H) / pixel_size` then scale back up with NEAREST interpolation. `pixel_size` slider (4–40 px) in the ops bar.
        - **Spotlight Effect:** Darken the background while leaving the subject at full brightness (Instagram "spotlight" effect). `ImageEnhance.Brightness` applied only to the background alpha region. Brightness slider (0.0 = black BG, 1.0 = no change). Default 0.35.
        - **Invert Selection Toggle:** A single toggle in the ops bar that flips which side of the mask receives each operation. When on, all operations — blur, pixelate, spotlight, sharpen, desaturate, fill, remove — apply to the **subject** instead of the background. Internally: swap the `alpha` mask before passing to each `apply_*` function.
        - **Color Tint:** Apply a semi-transparent color wash over the background (or subject if inverted). Blends using alpha compositing at adjustable opacity (0–100%). A colour swatch + opacity slider inline with the button, matching the existing Fill BG pattern.
    - **Implementation Phases:**
        1. Python: Add `apply_pixelate_background`, `apply_spotlight`, `apply_color_tint` to `segmentation_ops.py`. Update `apply_operation` dispatch in `commands/segmentation.py`. Add new operation strings to the `operation` literal type in `aiHandlers.ts`.
        2. Hook: Add `'pixelate-bg' | 'spotlight' | 'color-tint'` to `Operation` type in `useSegmentation.ts`; add `pixelSize`, `brightness`, `tintColor`, `tintOpacity` to `applyOperation` params.
        3. UI: Add three buttons + associated controls to `CreativeOperationsBar`. Add the Invert Selection toggle (checkbox/switch) above the operations row — affects all operations.
    - **Change Log:** `aiChangeLog/phase-113-sam3-new-ops.md`

- **SAM 3 Image Exemplar Prompts — Phase 114:**
    - **Goal:** Add "Exemplar" as a fourth prompt mode. The user draws a reference box around any object; SAM 3 returns **all instances of the same concept** found in the photo. This is PCS (Promptable Concept Segmentation) via image exemplar — distinct from the current box mode (which targets the specific instance inside the box). Per the paper, the exemplar encoder extracts ROI-pooled visual features + positional embedding + positive/negative label embedding, processes them through a small transformer, and produces exemplar tokens the detector uses to find matching instances.
    - **Technical distinction from current box mode:** The current "Box" mode calls `Sam3TrackerModel` for PVS (one specific instance). Exemplar mode calls `Sam3Model` with `input_boxes` + `input_boxes_labels=[[1]]` for PCS (all similar instances). The processor routes them differently. Negative exemplar boxes (`label=0`) exclude concepts.
    - **Core Features:**
        - **New `exemplar` PromptMode:** Fourth mode button ("⬚ Exemplar") in the canvas mode bar. Same draw UX as box, but semantics differ — user is saying "find me more of this" not "segment exactly this".
        - **Python `predict_from_exemplar`:** Calls `Sam3Model` (not TrackerModel) with `input_boxes=[[ref_box]], input_boxes_labels=[[1]]`. Returns all found instances. Optional: allow multiple reference boxes (positive + negative) to refine what "concept" means.
        - **Multi-Instance Result Panel:** Reuse the filmstrip component from Phase 112 to show all found instances. Particularly useful when asking "find all people" or "find all cars."
        - **Negative Exemplar Exclusion:** After drawing the reference box, the user can draw additional boxes with a "−" toggle to mark exclusion regions (`label=0`). The processor accepts mixed positive/negative exemplar boxes in one call.
        - **"Find Similar in Library" Stretch Goal:** Surface found concept masks as a Library search trigger — "show me all photos containing this type of object."
    - **Implementation Phases:**
        1. Python: Add `predict_from_exemplar(session_id, ref_box, neg_boxes)` to `Sam3Provider`. Verify processor call with `Sam3Model` correctly routes as PCS exemplar, not PVS box.
        2. IPC: Add `exemplar_boxes` + `exemplar_neg_boxes` fields to `segment_predict` payload schema. Route in `commands/segmentation.py` to new method.
        3. Hook: Add `'exemplar'` to `PromptMode`. Add `exemplarBox` + `exemplarNegBoxes` state fields to `SegmentState`.
        4. UI: Add Exemplar mode button and canvas interaction (draw ref box first; secondary "−" toggle for exclusion boxes; visual distinction between ref box and neg boxes — green vs red outlines).
        5. UI: Wire multi-instance filmstrip from Phase 112.
        6. Tests: Python unit test for exemplar path with a photo containing multiple instances of the same object.
    - **Change Log:** `aiChangeLog/phase-114-sam3-exemplar-prompts.md`

- **SAM 3 Result Management — Phase 115:**
    - **Goal:** Close the workflow loop. Currently the only exit from Creative Tools is a browser-style download. Add Save to Library (write result as a sidecar alongside the original), Copy to Clipboard, and "Open in Library" navigation.
    - **Core Features:**
        - **Save to Library:** Write the result PNG alongside the source file as `<original-stem>_edited.<ext>` (or into a configurable `_edits/` subfolder). Register the new file in the `photos` table via `PhotoRepository.insertPhoto` so it appears in the Library. IPC handler `creative:saveResult` accepts `{ sourcePath, resultB64, suffix }`.
        - **Copy to Clipboard:** `navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])` directly from the renderer. Works without IPC for images under ~15MB.
        - **Open in Library:** After saving, navigate to the Library view with the new file highlighted (pass its `photoId` as a deep-link state).
        - **Recent Edits Panel (stretch):** Small "Recent" section at the bottom of the Creative Tools panel showing thumbnails of the last 5 saved results with quick-reload buttons.
    - **Implementation Phases:**
        1. IPC: Add `creative:saveResult` handler in `aiHandlers.ts` (or new `creativeHandlers.ts`). Writes file to disk, calls `PhotoRepository.insertPhoto`, returns new `photoId`.
        2. Expose `creative:saveResult` in `preload.ts` via contextBridge.
        3. Hook: Add `saveResult(suffix?)` and `copyToClipboard()` actions to `useSegmentation`.
        4. UI: Replace the current "↓ Save" download button with a split-button dropdown — "Download", "Save to Library", "Copy to Clipboard". Show "Open in Library →" toast after successful save.
    - **Change Log:** `aiChangeLog/phase-115-sam3-result-management.md`

- **Hardware Compatibility:** Force Mode Selection (GPU/CPU), Multi-GPU support, OpenVINO/ONNX runtime.
- **Face Restoration Config:** Expose GFPGAN blending weight, Restoration Strength slider.
- **Custom AI Models:** Load user-provided `.pth` models from a `models/` directory.
- **Batch Enhancement:** Background queue for upscaling multiple photos.
- **YOLO-World Object Detection:**
    - **Goal:** Add open-vocabulary object detection for semantic tagging ("3 dogs", "beach scene").
    - **Model:** YOLO-World (~4GB VRAM) with text prompts.
    - **Features:** Custom tag detection without re-training.

- **Upstream False Positive Reduction (Cartoon/Object Detections):** ✅ Complete — Phase 106. Three-lever Strict Mode (VLM band calibration, pose-weighted DBSCAN, background orphan re-verification). See Priority Roadmap §5.

### Organization & Metadata
- **Blurry Photo List Export:** ✅ Complete — Phase 108. Tools view with threshold slider, folder/location/none grouping, paginated table, CSV export.
    - **Goal:** Generate and export lists of photos with blur scores below a threshold.
    - **Features:** Group by location/folder, filter by file type, usage for manual review/deletion.
- **Person Portfolio Export:**
    - **Goal:** Export catalog of named persons with high-res reference thumbnails and library statistics.
    - **Details:** Metrics per person (photo count), heatmaps for tags/years, and exportable format (PDF/HTML).
- **Batch Renaming & Cleanup:** Template-based renaming (`{Date}_{Location}`), Deduplication via perceptual hash.
- **Duplicate Photo Detection:** SHA-256 (exact) and pHash (visual) detection with "Safe Deduplication" UI.
- **Batch Tagging:** Multi-select context menu actions (Add/Remove Tags).
- **Exif Metadata Injection:** Write application tags back to file headers (IPTC/XMP).
- **Location Heatmap:** World map visualization with "Trip" clustering.
- **Library Analytics:** Extended graphs (Photos per Year, Top Cameras/Lenses).

### System Utilities & Repair
- **Corrupt File Recovery Center:**
    - **Goal:** Smart recovery studio to attempt repairs on problematic files found during scans.
    - **Integrated Tools:**
        - **Preview Extraction:** Use `LibRaw`/`ExifTool` to salvage embedded JPEGs from corrupted RAW files.
        - **Header Surgery:** Automated header reconstruction for ARW/NEF files using "healthy" reference files from the same camera (inspired by RAW-Repair-Tool).
        - **Deep Carving:** Integration with `PhotoRec` for signature-based recovery of files from damaged sectors.
    - **UI:** New "Tools" view with guided wizards for each recovery strategy.

### Creative Tools
- **SAM 3 Text Prompts & PCS Mode:** Planned — Phase 112. See AI & Computer Vision section above.
- **SAM 3 New Operations (Pixelate, Spotlight, Invert, Tint):** Planned — Phase 113. See AI & Computer Vision section above.
- **SAM 3 Image Exemplar Prompts:** Planned — Phase 114. See AI & Computer Vision section above.
- **SAM 3 Result Management (Save to Library, Clipboard):** Planned — Phase 115. See AI & Computer Vision section above.
- **Collage Creator:** Masonry/Grid layouts, Face-Aware cropping.
- **Static Gallery Generator:** Export album as a static HTML site.
- **Face Dataset Export:** Generate cleaned, high-res face crops for LORA training.

### Platform & Connectivity
- **Cross-Platform:** Mac & Linux support (Docker/Python venv).
- **External Agent API:**
    - **Goal:** Enable external agents to programmatically trigger scans and manage the library.
    - **Core Architecture:**
        - **Standalone Backend:** The Python backend (with REST API) can run independently from the Electron frontend.
        - **Auto-Start:** If the frontend launches and no backend is detected, it starts the backend automatically.
        - **Shared State:** Both frontend and external agents communicate with the same backend instance.
    - **Scheduled Scanning:**
        - Agents monitor folders for changes but do NOT trigger immediate scans.
        - Changes are queued as "pending scan" markers.
        - A **configurable schedule** (e.g., "Only scan between 2 AM - 6 AM") processes the queue.
        - **Manual Override:** "Process Now" button in UI for immediate processing.
    - **API Endpoints:**
        - `POST /api/v1/queue-scan`: Add a file/folder to the pending scan queue.
        - `POST /api/v1/tag`: Apply tags to a photo by ID.
        - `GET /api/v1/status`: Check backend status (idle/scanning/queue depth).
        - `POST /api/v1/trigger-schedule`: Force immediate processing of the scan queue.
    - **Configuration UI (Settings Tab):**
        - **Backend Status:** Show if running standalone or Electron-managed.
        - **API Port:** Configure the listening port (default: 3001).
        - **API Key:** Generate/regenerate an optional API key for authentication.
        - **Schedule Editor:** Define scan windows (e.g., "Mon-Fri 2:00 AM - 6:00 AM").
        - **Pending Queue:** View queued items, manually trigger or clear the queue.
- **Containerized Backend:** Run Python backend in Docker for remote access.

---

## ⏸️ Future / On Hold

### Burst Photo Face Tracking
- **Goal:** Optimize face processing for burst/sports photography by tracking faces across consecutive frames.
- **Approach:** Integrate a face tracker (ByteTrack or DCF-based) between detection and recognition stages.
- **Benefit:** Only run embedding extraction for newly detected face IDs, not every frame.
- **Considerations:**
    - Implementation complexity: High (requires frame-by-frame tracking logic).
    - Performance cost: Tracker adds overhead per-frame, but saves on redundant embeddings.
    - Use case: Primarily benefits burst sports photography, high-FPS captures.
- **Status:** Deferred pending performance analysis of typical library composition.
- **Implementation Plan:** See [Burst Photo Face Tracking Plan](file:///j:/Projects/smart-photo-organizer/docs/burst-photo-face-tracking-plan.md)

---

## Testing Strategy
- Unit tests: Follow existing patterns in `tests/backend/unit/`
- Mock database: Update `mockDatabase.ts` schema
- Integration tests: Database migration tests

---

## Current Phase
- [x] Planning and documentation
- [x] Phase P2: Session Grouping
- [x] Phase P3: Pet Classification (schema + matching)
- [x] Phase B1: Schema and State Flags
- [x] Phase B2: Scan-Time Handoff
- [x] Phase B3: BackgroundBucketingService (Core Logic)
- [x] Phase B4: Graceful Shutdown Protocol
- [x] Phase B5: Ignored Face Re-check Service

---

# ✅ Implemented Features

## v0.8.0 (Current)

### Upstream False Positive Reduction — Phase 106
- **Strict False Positive Mode** toggle in Advanced AI Settings (off by default).
- Lever 1: `score_threshold_accept` 0.70 → 0.75 when strict mode on; synced to `ai-config.json` so Python respects the setting.
- Lever 2: `anchor_only_frontal` passed to DBSCAN clustering; high-yaw faces cannot start clusters.
- Lever 3: `BackgroundVerificationService.processOrphanedFaces()` — idle-time VLM re-verification of orphaned accepted faces; soft-ignored with `ignore_source='background_verification'`.
- DB: `ignore_source` column added to `faces` table.
- [See Changelog](../../aiChangeLog/phase-106-false-positive-reduction.md)

### UX Modernization
- Navigation & Sidebar icons, grouped links, `SidebarLink` component
- Form Control Theming (Radix Switch, styled selects)
- Library Filter UX: active filter chips, folder disambiguation
- Typography: Inter font via `@fontsource-variable/inter`
- Empty States: `EmptyState` component for first-run and no-results
- Accessibility: keyboard nav, aria labels, `role="status"` on StatusBar
- Z-Index Scale: semantic tokens replacing ad-hoc values
- PhotoDetail Decomposition: split into `PhotoViewer`, `FaceOverlay`, `PhotoMetadata`, `PhotoActions`

## v0.7.0

### Ctrl+Scroll Grid Size Control
*Details: See [Ctrl+Scroll Grid Size Plan](file:///j:/Projects/smart-photo-organizer/docs/plans/ctrl-scroll-grid-size-plan.md)*

- **Goal:** Allow users to dynamically adjust face/photo thumbnail grid density using Ctrl+scroll wheel.
- **Core Features:**
    - **Ctrl+Scroll Zoom:** Increase/decrease grid columns (4–12 range) or item size (80–300px for photo grids).
    - **Per-View Persistence:** Each modal/page remembers its own setting via localStorage (`spo:grid:<key>`).
    - **Visual Feedback:** 1-second `info` toast showing "Grid: N columns" on every change.
    - **VirtuosoGrid-Safe:** Uses `capture:true` + `preventDefault()` to intercept before VirtuosoGrid's scroll handler.
- **Affected Components:** AllFacesModal, OutlierReviewModal, BlurryFacesModal, People.tsx (4 sub-views), ClusterRow, PersonDetail, GroupNamingModal, FaceGrid, Library, Search.
- **New Hooks:** `useCtrlScroll`, `useDynamicGrid`, `useFlexZoom`, `usePeopleGridSize`; new context: `GridSizeContext`.
- [See Changelog](aiChangeLog/phase-97-ctrl-scroll-grid-size.md)

## v0.6.5 (Current Release)

### Home Page Dashboard
*Details: See [Dashboard Phase 4 Plan](file:///j:/Projects/smart-photo-organizer/docs/specs/dashboard-phase-4-plan.md)*

- **Goal:** Replace Library as default startup page with an engaging, widget-based home experience.
- **Core Features:**
    - **Widget Grid System:** 12-column snap-to-grid layout with drag-and-drop reorder and resize.
    - **On This Day Memories:** Surface photos from same date in previous years (±3 day tolerance).
    - **Auto-Generated Collages:** Daily collage with "Save as PNG/JPG" export and "Regenerate" button (Grid 2x2/3x3, Feature, Mosaic layouts).
    - **People Spotlight:** Carousel of named people with photo counts.
    - **Library Stats:** Pie chart of processed/pending/corrupt files.
    - **Photo Timeline:** Bar chart with year/month drill-down, click-to-Search navigation.
    - **Library Health:** SVG ring gauge, error breakdown by stage, CSV export.
    - **Location Heatmap:** SVG world map showing GPS photo clusters with density visualization.
    - **Notification Badge:** Purple dot on Home nav when new memories are available.
    - **Scan-Time Entertainment:** Live discovery feed, random flashback, live stats, fun facts.
    - **Widget Customization:** Toggle widgets ON/OFF, drag-and-drop reorder, snap-to-grid resize, layout presets (Minimal, Balanced, Power User).
- **Changelogs:** [Phase 90](aiChangeLog/phase-90-home-dashboard.md), [Phase 91](aiChangeLog/phase-91-dashboard-timeline-health.md), [Phase 92](aiChangeLog/phase-92-collage-widget.md), [Phase 93](aiChangeLog/phase-93-dashboard-final.md)

### Advanced Library Filtering
*Details: See [Advanced Filtering Plan](file:///j:/Projects/smart-photo-organizer/docs/advanced_library_filtering_plan.md)*

- **Goal:** Comprehensive filtering system with AND/OR/NOT logic, dedicated Search View, and Smart Albums.
- **Core Features:**
    - **Search View:** Dedicated tab with advanced filter sidebar.
    - **New Filters:** Blur Score, Dual Dates (File/EXIF), Camera Model, File Type.
    - **Compound Logic:** AND/OR/NOT combinations with a visual filter builder.
    - **Smart Albums:** Save and reuse filter presets (Smart Searches).
- **Files Created/Modified:** See [Changelog](aiChangeLog/phase-89-advanced-filtering.md)

## v0.5.5

### Frontend Streamlining (UX Consolidation)
*Details: See [Frontend Streamlining Plan](file:///j:/Projects/smart-photo-organizer/docs/frontend-streamlining-plan.md)*

- **Goal:** Simplify the People management workflow by automating high-confidence assignments, reducing tabs from 4 to 3, and consolidating modal-heavy interactions.
- **Core Features:**
    - **Live Face Counts:** Polling mechanism for real-time unassigned face counts.
    - **Performance Limits:** Enforced 150-face limit for Ignore/Group views to prevent UI lag.
    - **UX Polish:** Removed AI suggestions from Move modal; improved Edge Case navigation.
    - **Tab Consolidation:** 3 tabs (Identified People, Discoveries, Edge Cases) instead of 4.
    - **Inline Filters:** Replace modals with filter pill toggles.

### Age-Based ERA Categorization
*Details: See [Changelog](aiChangeLog/phase-42-age-based-eras.md)*

- **Goal:** Replace visual clustering with actual age estimation for ERA generation, enabling life-stage tracking (Newborn → Child → Teen → Adult).
- **Core Features:**
    - **Age Extraction:** InsightFace `genderage` module extracts `face.age` during all scans.
    - **Age Buckets:** Newborn (0-1), Infant (1-2), Toddler (2-4), Child (5-12), Teen (13-19), Young Adult (20-35), Adult (36-55), Senior (56-69), Elderly (70+).
    - **Background Backfill:** Resumable service to rescan existing photos for age data.
    - **Auto-Generation:** Automatically generate ERAs for all named persons after backfill completes.
    - **Progress UI:** Status updates during backfill with estimated time remaining.

### AdaFace Integration
*Details: See [Changelog](aiChangeLog/phase-59-adaface-integration.md)*

- **Goal:** Improve recognition accuracy on low-quality (blurry) faces.
- **Core Features:**
    - Hybrid embedding selection based on face quality (blur_score < 50 uses AdaFace).
    - `HybridEmbedder` class with automatic model switching.
    - Config options: `ADAFACE_ENABLED`, `ADAFACE_BLUR_THRESHOLD`.
    - Graceful fallback to ArcFace if AdaFace model unavailable.
- **Performance:** AdaFace adds ~5-10ms overhead per low-quality face (one-time cost).

### Vector Database Scaling (FAISS IVF)
*Details: See [Changelog](aiChangeLog/phase-60-faiss-ivf.md)*

- **Goal:** Prepare FAISS for 500K+ face libraries spanning decades of photos.
- **Core Features:**
    - Hybrid index strategy: `IndexFlatL2` for <2K faces, `IndexIVFFlat` for ≥2K.
    - Automatic migration from FlatL2 to IVF on first use.
    - Training step during index rebuild.
    - ~10x faster search at 500K+ scale.
    - Dynamic cluster calculation: `4 * sqrt(N)`, clamped 32-4096.

### VLM Multi-Face Fix
*Details: See [Changelog](aiChangeLog/phase-58-vlm-multiface-fix.md)*

- **Goal:** Fix SmolVLM's inability to count faces in cropped regions.
- **Core Features:**
    - Replaced VLM face counting with detector-based verification.
    - `detect_faces_in_region` command to re-run detection on cropped regions.
    - VLM limited to semantic verification only ("Is this a face or a knee?").
    - Automatic multi-face box splitting during background verification.
    - Split faces tagged with `assignment_source='split_multiface'`.

### Scan Performance Optimization
*Details: See [Changelog](aiChangeLog/phase-61-scan-perf.md)*

- **Goal:** Reduce scan time in MACRO/TTA modes by eliminating redundant AI model initializations.
- **Core Features:**
    - Implemented LRU-style model cache (`APP_CACHE`) storing up to 4 `FaceAnalysis` instances.
    - Eliminated 500ms-1s model reload overhead that occurred 4-5 times per photo in Macro mode.
    - Instant switching between standard (1280x1280), safe (640x640), and TTA instances.
    - 40-60% reduction in scan time per photo in Macro/TTA modes.
- **Trade-off:** Increased VRAM usage by holding 3-4 model instances instead of 1.

### Background Auto Face Bucketing
*Details: See [Background Bucketing Plan](file:///j:/Projects/smart-photo-organizer/docs/background-bucketing-plan.md)*

- **Core Service (Phase 1-4):** Background process that organizing unassigned faces into Suggestions and Discoveries during idle time. [See Changelog](aiChangeLog/phase-34-b3-background-service.md)
- **UI Updates (Phase 37):**
    - **Suggestion Buckets:** Confirm/Reject groups of faces matching known people.
    - **Discovery Buckets:** Name/Ignore new unknown clusters found by DBSCAN.
    - **Re-check Ignored:** Recover faces from the "Ignored" pool.
    - [See Changelog](aiChangeLog/phase-37-b6-ui-updates.md)
- **Bucket Merge by Person (Phase 39):**
    - Reduced user workload by combining multiple suggestion buckets for the same person.
    - Added "Combine by Person" toggle in Suggestions tab.
- **Concurrency & Polish (Phase 39):**
    - **Smart Scheduling:** Service now creates zero overhead during active AI scans by pausing immediately.
    - [See Changelog](aiChangeLog/phase-39-concurrency-fix.md)

### Smart Face Management
*Details: See [Smart Ignore Implementation Plan](file:///j:/Projects/smart-photo-organizer/docs/smart-ignore-implementation-plan.md) for full technical specs.*

- **Background Face Filter (Phase 1):** Auto-identify and bulk-ignore "noise" faces (background strangers, one-time appearances). [See Changelog](aiChangeLog/phase-20-background-filter.md)
- **Scan-Time Confidence Tiering (Phase 2):** Auto-classify new faces at scan time into high-confidence, review, or unknown tiers. [See Changelog](aiChangeLog/phase-21-confidence-tiering.md)
- **Smart Ignore UI Panel (Phase 3):** Unified dashboard for managing thresholds and bulk actions. [See Changelog](aiChangeLog/phase-22-smart-ignore-panel.md)
- **Misassigned Face Detection (Phase 4):** Identify faces incorrectly assigned to a person using distance-to-centroid analysis. [See Changelog](aiChangeLog/phase-19-outlier-detection.md)
- **Challenging Face Recognition (Phase 5):** Improve matches for side profiles, partial faces, and occlusions using pose-aware matching and multi-sample voting. [See Changelog](aiChangeLog/phase-23-challenging-recognition.md)
- **Unified Person Name Input (Phase 6):** Standardize AI-powered name suggestions and autocomplete across all assignment interfaces. [See Changelog](aiChangeLog/phase-24-unified-input.md)

### Era & Stability Features (v0.5.0)
- **Era Generation (Phase E):** Visual clustering of faces into time-based eras for improved multi-age recognition. [See Changelog](aiChangeLog/phase-25-eras-and-settings.md)
- **Configurable Settings (Phase F):** UI controls for Era generation parameters (K-Means, Merge thresholds).
- **Test Backfill (Phase G):** Comprehensive unit tests added for FaceService, PersonService, and Repositories.
- **Fixes & QoL (Phase 26):** Fixed RAW Previews, Era Generation bugs, Clustering Thresholds, and improved UX feedback (Toasts). [See Changelog](aiChangeLog/phase-26-fix-raw-and-eras.md)
- **Clustering & Performance (Phase 27):** Fixed clustering logic (Metric Mismatch), optimized background detection speed (20x), added Face Debug tools, and optimized FAISS Index (sync tracking & alerts). [See Changelog](aiChangeLog/phase-27-clustering-optimization.md)
- **High-Density Review UX (Phase 28):** Implemented progressive loading, keyboard navigation (`A`/`X`/`N`), cluster size filters, and "Ungroupable" search to handle 10k+ face libraries. [See Walkthrough](file:///C:/Users/arozz/.gemini/antigravity/brain/34a6fc69-1e09-40eb-974f-d34f6ae8103b/walkthrough.md)
- **Centroid Stability & Face Confirmation:**
    - **Face Confirmation:** Mark potentially misassigned faces as "correct" to exclude from future outlier detection.
    - **Era-Aware Clustering:** Support multiple centroids per person based on photo date ranges.
    - **Drift Detection:** Alert users when a person's face signature shifts significantly.
- **Photo Session Grouping:**
    - Group unnamed faces by folder or time-window for better context.
    - Added `session_folder` and `session_date` metadata.
- **Pet vs Human Classification:**
    - **Entity Type:** Distinguish People from Pets using `entity_type` field.
    - **Separate Matching:** Humans only match Humans, Pets match Pets.

### Code Maintenance (v0.5.5)
- **FaceAnalysisService Refactoring (Phase 29):** Split `FaceAnalysisService.ts` (564→196 lines) into `FaceOutlierService.ts` (~230 lines) and `FaceNoiseService.ts` (~175 lines) for improved maintainability. [See Changelog](aiChangeLog/phase-29-refactoring.md)

### Robust Library Management (Phase 41)
- **Safe Move Library:** "Soft Restart" mechanism to prevent crashes when moving large libraries.
- **Enhanced UX:** Blocking "Moving Library..." modal with spinner to prevent user interference.
- **Service Architecture:** Centralized `ServiceManager` for cleaner startups and shutdowns.
- [See Changelog](aiChangeLog/phase-41-move-library-fix.md)

### UI Polish & Audit Mode (Phase 41)
- **Review All & Modals:** Persisted scroll position, optimized virtualization for large lists.
- **Audit Confirmed Faces:** Re-evaluate confirmed faces against the person's model to clear bad data.
- **UX Improvements:** Loading overlays, prioritized image loading.
- [See Changelog](aiChangeLog/phase-41-ui-polish.md)

### Other Features
- **Person Thumbnail Management:**
    - **Custom Covers:** Manually "Pin" any face as the person's cover photo.
    - **Shuffle:** Instantly pick a random high-quality face as the cover.
    - **Smart Fallback:** Auto-reverts to the sharpest available face if unpinned.

## v0.6.5 (Current)
- **Error Export & Library Health (Phase 95):**
    - **Export CSV:** Added "Export CSV" button to Scan Errors modal with RFC 4180 compliant formatting.
    - **Retry All Fix:** Fixed bug where "Retry All" failed to queue photos (returned file paths instead of photo objects with IDs).
    - **Clear List Fix:** Implemented `db:clearScanErrors` IPC handler (was previously stubbed).
    - **CSV Format:** File Path, Error Type, Error Message, Scan Type, Timestamp.
    - [See Changelog](aiChangeLog/phase-95-error-export.md)

## v0.4.0 (Stability Release)
- **Architecture Refactor:** Modularized Main Process for better stability.
- **Data Safety:** Fixed Face Assignment data loss during re-scans.
- **Reduced Verbosity:** Cleaner logs for easier debugging.

## v0.3.6 (Upcoming/Main)
- **Auto-Identify Optimization:**
    - Improved "Scan for All Named People" and "Auto-Identify" logic to capture faces missed in initial scans.
- **Automatic Face Matching:**
    - Newly scanned faces are now automatically matched against known people immediately after scan persist.
- **Review All Faces:**
    - Implemented a dedicated modal to review, move, and remove all faces for a person, bypassing the 1000 face display limit.

## v0.3.5 (Current Release)
- **Unnamed Faces Performance & UX:**
    - **Virtualization:** Implemented `react-virtuoso` to handle 10,000+ faces smoothly.
    - **Optimistic Updates:** Instant UI feedback for "Name", "Ignore", and "Group" actions (no loading spinners).
    - **View Original Photo:** Added context button to view source image for any face thumbnail.
    - **Inline Actions:** "Ignore Group" button added directly to cluster headers.
- **Corrupt Photo Tracking:**
    - **Backend Safety:** Robust error handling for truncated/corrupt images (preventing silent crashes).
    - **Scan Warnings Report:** New "Settings" tab to list and manage (delete/dismiss) corrupt files.
- **Retrieve Ignored Faces:**
    - View, Manage, and Restore faces previously marked as ignored.
    - "Group Similar" AI clustering for ignored faces.
    - Bulk Restore & Assign functionality with Pagination.
- **Interactive Feedback System:**
    - **Toasts & Notifications:** Unified feedback system.
    - **Scan Progress:** Real-time counters in the status bar.
    - **Smart Throttling:** Prevents UI stutter during heavy scanning.
- **Scan vs Rescan Logic:**
    - **Incremental Scan:** Only processes new files.
    - **Force Rescan:** Option to force re-extraction of metadata and previews for all files.
    - **Unified Rescan:** "Rescan Selected" now performs a full refresh + AI scan.
- **Smart Tags Optimization:**
    - **Normalization:** Enforced single-word, lowercase tags.
    - **Cleanup Utility:** Settings tool to optimize existing tag database.
    - **Type-ahead Filter:** Improved tag filtering in Create view.

## v0.3.0: Core Intelligence
- **Smart Face Storage:** Vectors stored as BLOBs, on-demand crops (no disk thumbnails), vector pruning for known faces.
- **High-Performance Clustering:** Backend DBSCAN logic replacing frontend clustering.
- **Processing Metrics:** `scan_history` table and "Recent Activity" dashboard.
- **AI Runtime Polish:** Better validation, robust protocol handling, restart prompts.
- **User Experience:**
    - "View Original Photo" context.
    - Targeted Scanning (Person/All).
    - "Go to Folder" navigation.
    - Multi-select Face Assignment.
    - Hide "Unnamed" tags toggle.

## Previous Versions (v0.2.x)
- **UI Polish:** Responsive layouts, Window state persistence.
- **Organization:** Manual Image Rotation (Left/Right), Metadata updates.
- **Basics:** Scanning history tracking, Performance dashboard.
