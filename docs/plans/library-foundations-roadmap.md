# Library Foundations Roadmap — Phases 128–151

> **Status:** Approved. Decisions recorded 2026-09-26
> **Created:** 2026-09-26
> **Baseline:** v0.8.0 (`feature/phases-117-118-119`, 29 commits ahead of `main`)

## Goal

Strengthen the non-AI foundations of Smart Photo Organizer — scan speed, file identity, metadata portability, search, culling, browsing and format coverage — so that the AI features (faces, eras, tagging, creative tools) sit on a library that is fast, durable and never loses the user's work.

Work is ordered in six steps. Each step is independently shippable.

> **Release gate before Phase 128:** Merge `feature/phases-117-118-119` to `main` through a PR, then cut a release of the current state (tag + GitHub release) **before** any version bump for this roadmap.
>
> **FLUX.2 Background Generation** (previously "Phase 120") is now **Phase 135**, grouped with the other Python/AI-runtime work in Step 3.

| Step | Theme | Phases |
|---|---|---|
| 0 | Migration framework & safety net (prerequisite) | 128 |
| 1 | Quick fixes & scanner efficiency | 129, 130 |
| 2 | Data safety: file identity, re-linking, XMP write-back | 131, 132 |
| 3 | Semantic search (CLIP embeddings) + FLUX.2 background generation | 133, 134, 135 |
| 4 | Library essentials & UX polish | 136–143 |
| 5 | Places: offline geocoding & Map view | 144, 145 |
| 6 | Format & platform expansion | 146–151 |

---

## Cross-Cutting Policies

These apply to **every** phase below. A phase is not done until each is satisfied.

### A. Backward Compatibility Policy (existing v0.8.0 libraries)

1. **Additive-only schema.** New tables, and new *nullable* or *defaulted* columns only. Never drop, rename or change the type of an existing column. An older build must still open and use a newer database (unknown columns are ignored).
2. **Versioned migrations.** From Phase 128 on, every schema change is a numbered migration tracked by `PRAGMA user_version`. The existing try/catch `ALTER TABLE` block becomes the frozen "v1 baseline".
3. **Automatic pre-migration backup.** Before any migration runs, the DB is copied with `better-sqlite3`'s online `backup()` to `<library>/backups/library.v<from>-to-v<to>.<timestamp>.db`. Keep the last 3.
4. **Each migration runs in a transaction.** On failure: roll back, keep the backup, surface a blocking error dialog with the backup path. Never leave a half-migrated DB.
5. **Lazy backfills, never blocking startup.** Expensive population of new columns (stat info, embeddings, geocodes, ratings from EXIF) runs in background services that follow the `BackgroundDuplicateCheckerService` pattern: small batches, yield between batches, pause during active scans, progress visible in the Queues view, failures recorded in `scan_errors` with a stage name.
6. **NULL means "unknown", not "false".** Code paths must treat un-backfilled rows correctly (e.g. `file_mtime IS NULL` → "must check", not "unchanged").
7. **Never auto-delete user data.** Missing files are *marked*, not removed. Merges, cleanups and removals always require explicit user confirmation.
8. **Settings are defaulted.** Every new config key has a default and is read through the Zod-validated settings schema, so older `config.json` files never crash the app (lesson from Phase 124).
9. **Saved filters are versioned.** `smart_albums.filter_json` gains new *optional* fields only. Parsing is done with a Zod schema with defaults, and an older Smart Album must round-trip unchanged.
10. **Existing vector indexes untouched.** The face FAISS index (`vectors.index`, `id_map.pkl`) is not modified by any phase here. New indexes use new files.
11. **New behaviour behind flags when risky.** Relinking, XMP write-back, folder-skip scanning, map tiles and pairing each have a setting. Defaults are chosen per phase and are documented.

### B. Testing Strategy

| Layer | Tool | Scope |
|---|---|---|
| Pure logic | Vitest | Matchers, rankers, coordinate conversions, filter parsing |
| Repositories & migrations | Vitest + real in-memory `better-sqlite3` (integration suite) | SQL correctness, migrations, backfills |
| Services | Vitest, externals mocked at adapter boundaries (FS, exiftool, Python IPC) | Batching, pause/resume, error recording |
| Python | pytest (`tests/python`) | Embedding, index, geocode, image decoding |
| UI | React Testing Library | Hooks and component behaviour (logic lives in hooks) |
| Performance | `scripts/bench/*.ts` on a synthetic tree (10k / 100k files) | Scanner, search latency. Record before/after numbers in the phase changelog |
| Upgrade | **Legacy library fixture** (see Phase 128) | Every phase touching schema must upgrade the v0.8.0 fixture and assert that all existing people, faces, tags, smart albums and duplicates survive |
| Manual QA | `visual-qa-check` skill + per-phase checklist | Run against a **copy** of the real library, never the original |

Rules (from CLAUDE.md): TDD (failing test first), AAA structure, no `sleep()`, unit tests < 50 ms, integration < 1 s, > 80 % branch coverage on new code.

Every phase starts with a full test run to confirm the baseline (`node scripts/run-tests.cjs`) and ends with another full run.

### C. Code Hygiene

- Files already over the 600-line hard limit (`electron/db.ts` 933, `electron/ipc/dbHandlers.ts` 1216, `electron/data/repositories/PhotoRepository.ts` 806, `electron/ipc/aiHandlers.ts` 876) **must not grow**. New logic goes into new modules. Splits follow the Refactoring Protocol.
- New IPC handlers validate payloads with Zod and live in a domain-specific handler file.
- Services receive repositories and adapters through constructor injection.
- Model IDs, thresholds, tile URLs and batch sizes live in config, not code.

### D. Documentation & Process

- One branch per phase: `feature/phase-XXX-short-desc`, created from `main` after the current `feature/phases-117-118-119` work is merged.
- Each phase updates `aiChangeLog/phase-XXX-*.md` (files changed, behaviour changes, tests, assumptions and risks, migration version) plus `README.md` and `docs/specs/future_features.md`.
- Documentation describes features on their own merits. No third-party product comparisons or references.

---

## Step 0 — Foundation

### Phase 128 — Versioned Migrations, Backups & Legacy Fixture

**Why first:** Almost every later phase changes the schema. `db.ts` is already 933 lines of ad-hoc migrations, with no backup or version tracking.

**Tasks**
1. **Baseline:** Run the full suite and record the pass/fail baseline in the changelog. As of the pre-roadmap release, TypeScript is 419/419 green and Python is 172 passing with **6 failures that already existed at v0.8.0**:
   - `test_segment_api.py` ×3 (HTTP debug API apply endpoints: mask/image shape mismatch, log-format `TypeError`)
   - `test_image_ops.py::test_smart_crop_fallback_to_expand` (off-by-one bbox)
   - `test_vlm_tta.py::test_tta_180_degrees`
   - `test_main_commands.py::test_analyze_image_mocked`

   Fix these (code or test, whichever is wrong) so every later phase starts from an all-green Python baseline.
2. **Legacy fixture (created *before* any code moves):** Add `tests/fixtures/legacy-v0.8.0.db`, generated by a script (`scripts/fixtures/build-legacy-db.ts`) that runs the *current* `initDB` and seeds it with named people, eras, faces (confirmed, ignored, bucketed), tags, smart albums, duplicate groups and scan errors. Commit the script *and* the output DB so the fixture stays stable.
   - **Real-world drift check:** The ad-hoc migrations include repeated `ALTER`s and a `people_new` table rebuild, so long-lived databases may not match a fresh `initDB`. Dump `sqlite_master` from a **copy** of the production library and from a DB created by the last released build. Record any differences and add them to the fixture as extra variants (e.g. `legacy-v0.8.0-prod-shape.db`, schema only plus synthetic rows, with no personal data).
3. **Refactor, following the Refactoring Protocol:** Move the existing migration block from `electron/db.ts` into `electron/data/migrations/000_legacy_baseline.ts`, with no logic changes. `db.ts` imports and calls it.
4. **Migration runner:** Add `electron/data/migrations/MigrationRunner.ts`, which reads `user_version`, runs pending numbered migrations (`001_*.ts`, …) each in its own transaction, and bumps `user_version`.
5. **Backup:** Add `electron/data/migrations/DatabaseBackup.ts` (online backup, retention of 3), called only when migrations are pending.
6. **Downgrade guard:** If `user_version` is greater than the app's highest known migration, log a warning and continue (safe because schema changes are additive). Show a non-blocking notice.

**Tests first**
- Fresh DB → all migrations applied, `user_version` = latest.
- Legacy fixture → upgrade succeeds, and row counts and key values in every table are unchanged.
- Re-running the runner is a no-op (idempotent).
- A failing migration rolls back, `user_version` is unchanged and a backup exists.
- Backup retention keeps exactly 3 files.

**Backward compat:** No schema change in this phase. Existing libraries get `user_version` = 1 on first launch.

---

## Step 1 — Quick Fixes & Scanner Efficiency

### Phase 129 — WEBP Support & Scanner Hot-Path Optimization

**Tasks**
1. Add `.webp` to `SUPPORTED_EXTS` (`electron/scanner.ts:31`) and confirm that the preview and face pipeline decode it (sharp and Python). The README already advertises WEBP.
2. Add a benchmark script `scripts/bench/scan-bench.ts` (synthetic tree of 10k small JPEGs) and record the baseline. **Before changing the scanner**, capture a golden snapshot of the `photos` rows that the *current* scanner produces for the fixture tree (`tests/fixtures/scan-golden.json`). The equivalence test compares against this snapshot, because the old code won't exist afterward.
3. Prepare statements **once per scan** instead of per file (`processFile` currently calls `db.prepare` on every file). Inject a `ScanStatements` object.
4. Per folder, load known paths for that folder into a `Map` with a single query instead of one `SELECT` per file.
5. Batch inserts in one transaction per folder.
6. Use a bounded concurrency pool (config `scanner.concurrency`, default 4) for per-file work (EXIF, preview extraction). DB writes stay on one path.
7. Rerun the benchmark and record the numbers.

**Tests first**
- `.webp` files are discovered and inserted, and unsupported extensions are still counted as skipped.
- `db.prepare` call count is independent of the number of files.
- The concurrency limit is never exceeded (deterministic counter, no timers).
- **Equivalence test:** Scanning the same fixture tree with the old and new code gives identical `photos` rows.

**Backward compat:** No schema change. Existing libraries pick up their WEBP files on the next scan.

### Phase 130 — File Identity Columns & Incremental Folder Scanning

**Tasks**
1. **Migration 001:** Add to `photos`: `file_size INTEGER`, `file_mtime INTEGER`, `file_id TEXT` (from `fs.stat(..., {bigint:true}).ino`, which is the NTFS file index on Windows), `missing_since DATETIME`. Add the new table `scan_folders(path TEXT PRIMARY KEY, mtime INTEGER, last_scanned_at DATETIME)`. Put the new repository code in `PhotoIdentityRepository.ts`, not in `PhotoRepository.ts`.
2. **Backfill service** `BackgroundFileIdentityService`: stat files in batches of 500 and fill in the three columns. Unreachable files are left NULL. The service is cheap and pauses during scans.
3. **Folder skip:** When scanning a folder whose stored `mtime` equals its current mtime, skip processing its *direct files* but **still recurse into subfolders**. A directory's mtime only changes when its direct entries are added, removed or renamed. **Editing a file's contents does not change it.**
4. **Modified-file detection:** If a *visited* known file's `size` or `mtime` differs from the stored values, mark it for reprocessing: re-hash, regenerate the preview and re-run the face scan. Reuse the rotation re-scan path from Phase 125 (`PhotoService.analyzeImage` with `cleanRescan`). It deletes the old faces and then recovers named assignments **on a best-effort basis** by matching embeddings (distance < 0.35). Faces that don't match fall back to unassigned, so this phase adds a test that measures how many are recovered and reports any lost names in the scan summary. Because content edits don't change the folder mtime, edits inside **skipped** folders are only caught by:
   - a **Full rescan**, or
   - an **explicit dirty mark** from in-app writes (rotation, Creative Tools saves, and later XMP embedded writes), which clears the folder's stored mtime, or
   - an optional **periodic stat pass** by `BackgroundFileIdentityService` (idle-time, configurable interval, default weekly) that compares stored size and mtime without reading file contents.
5. **Deep scan option:** "Full rescan" in the UI ignores folder mtimes.
6. **Scan result contract for Phase 131:** The scanner returns the set of folders it actually *walked* (direct files processed), separate from the set it *skipped*. Missing-file detection must only use walked folders.
7. Handle the network-drive and exFAT edge cases, where `ino` may be 0 or unstable. Treat `0` as NULL.

**Tests first**
- A folder with an unchanged mtime is skipped but its subfolders are visited.
- An added file changes the folder's mtime, so the folder is scanned.
- In a *walked* folder, an edited file with the same path and a different size or mtime is flagged for reprocessing.
- In a *skipped* folder, an edited file is **not** detected by a normal scan, **is** detected by a Full rescan, and **is** detected by the periodic stat pass.
- An in-app rotation clears the folder's stored mtime.
- The scan result reports walked and skipped folders correctly.
- Rows with NULL identity columns are always checked.
- A zero `ino` is stored as NULL.
- Benchmark: a second scan of an unchanged 100k tree is at least 5× faster than the Phase 129 number (target, recorded not enforced).

**Backward compat:** The first scan after upgrade is a full walk (no `scan_folders` rows yet), exactly like today, and it establishes the baseline. Older builds ignore the new columns.

---

## Step 2 — Data Safety

### Phase 131 — Path Re-linking & Missing Files Reconciliation

**Problem:** `photos.file_path` is the only identity. If a user renames or moves a file or folder outside the app, the next scan inserts a *new* row with no face assignments, and the *old* row (holding the person names) points at a missing file. The same faces are then detected again as unknowns.

**Tasks**
1. **Missing detection:** Only **walked** folders are considered (Phase 130 scan-result contract). A known row is marked `missing_since` when its folder was walked and the file wasn't found. Rows in skipped folders are **never** marked missing.
   - **Vanished folders:** When a walked parent no longer contains a subfolder that is in `scan_folders`, the rows under that subfolder are marked missing and its `scan_folders` entries are removed.
   - **Guard:** If the scan root itself is unreachable (offline, removable or network drive), mark nothing.
2. **Relink matcher** (pure function, `electron/core/services/relink/RelinkMatcher.ts`): for each *new* path, try in order:
   1. `file_id` + `file_size` match a missing row → confident relink.
   2. `file_size` matches a missing row → compute SHA-256 of the new file only, and relink when it equals `sha256_hash`.
   3. Several candidates → **ambiguous**. Do not link. Queue it for user review.
   - If both the old and new paths exist (a copy, not a move), do not relink. The new row is treated as a duplicate and the existing duplicate detection handles it.
3. **Relink operation** (single transaction): `UPDATE photos SET file_path = ?, missing_since = NULL`. The photo `id` is kept, so faces, people, tags, eras and duplicate groups carry over automatically. Rename the preview cache file to the md5 of the new path (`PhotoService.extractPreview` names previews by path hash) and update `preview_cache_path`.
4. **Bulk re-root:** "This folder moved" → prefix replacement (`D:\Photos\` → `E:\Photos\`), verified per file by size and ID before commit. A dry-run preview shows the counts.
5. **Missing Files view** (Settings → Library health, or a Library header badge): list missing rows grouped by folder, with actions Locate folder (re-root), Keep (e.g. an offline drive), and Remove from library (confirmed; deletes DB rows only, never files).
6. **One-time Library Repair wizard (for existing libraries):** Past renames have already produced *ghost pairs*: a missing row that holds the names, and a live row for the same image whose faces were detected again. The wizard:
   - **finds candidate pairs in two tiers:**
     1. **Exact:** equal `sha256_hash`. These are high-confidence and can be pre-selected in the review list.
     2. **Visual fallback:** many ghost rows have a **NULL** `sha256_hash` because the file moved before the hash backfill could read it. For these, match on `phash` (computed from previews, and the ghost's preview usually still exists) together with equal `width`/`height` and `date_taken`. These are **review-only** and never pre-selected or auto-linked.
   - shows before and after (names that will be restored)
   - on confirmation, reassigns each ghost face's person onto the live row's matching face (bbox IoU ≥ 0.5 after orientation normalization) **through the existing person assignment and merge service path**, never a raw `UPDATE`. That way person centroids, era models, buckets, cover faces and the FAISS index are recomputed exactly as they are for manual assignments.
   - re-points tags
   - removes the ghost row only after explicit confirmation
   - leaves unmatched ghost faces in place and reports them
7. **Protect ghost rows from the Duplicates workflow:** Ghost and live pairs with equal hashes are probably already listed as *exact duplicate* groups. Resolving such a group in the Duplicates view would delete the ghost row and cascade away its names. From this phase on:
   - Duplicates excludes rows with `missing_since` set from winner and deletion candidates, and shows a "Missing file: restore names with Library Repair" link instead.
   - After upgrade, the Library Repair wizard is suggested (banner) **before** the user opens Duplicates.

**Tests first**
- A renamed file keeps its id and faces.
- A moved folder (same volume) is relinked by `file_id`.
- A cross-drive move (new `file_id`) is relinked by hash.
- A copy (both paths exist) is not relinked.
- An offline root marks nothing missing.
- Two identical candidate files are flagged as ambiguous and not linked.
- A re-root dry run reports correct counts, and the commit is atomic.
- The preview file is renamed and the path updated.
- **An unchanged (skipped) folder's rows are NOT marked missing.**
- A vanished subfolder under a walked parent marks its rows missing.
- Repair wizard on the legacy fixture seeded with ghost pairs: names are restored and nothing is deleted without confirmation.
- Repair wizard finds a NULL-hash ghost through the pHash + dimensions + date fallback, and lists it as review-only (not pre-selected).
- Wizard reassignment updates person centroids and era data the same way a manual assignment does (asserted through the service, not raw rows).
- Duplicates view never offers a `missing_since` row for deletion.
- The IoU face matcher handles rotated images (Phase 125 orientation rules).

**Backward compat:** Uses the Phase 130 columns. For rows still NULL (backfill pending), the hash fallback applies. Relinking is enabled by default because it only preserves data. Removal is always manual.

### Phase 132 — XMP Metadata Write-Back (Sidecar-First, Coexisting with Existing Sidecars)

**Why now:** The DB-only storage of names and tags is the other half of data safety. Sidecars survive DB loss and are readable by other photo tools.

**Decision:** When enabled, write **separate sidecar files**. Embedded writing is a later, explicit opt-in (JPEG/PNG only).

**The central constraint:** Many library folders already contain `.xmp` sidecars written by RAW developers and DAMs (develop settings, crops, keywords, ratings, colour labels, face regions). Those files hold **working information for other applications** and must never be damaged, duplicated or silently overridden.

#### Sidecar rules

| Situation | Behaviour |
|---|---|
| **Sidecar already exists**, in either naming convention (`IMG_001.xmp` or `IMG_001.CR2.xmp`) | Write **into that existing file**. Never create a second sidecar next to it. If *both* exist, use the one whose convention matches the Settings choice and leave the other untouched (report it) |
| **No sidecar exists** | Create one using the configured convention. Default is `basename.xmp` for RAW (the most widely read convention) and `file.ext.xmp` for non-RAW files. The `file.ext.xmp` form avoids a clash when `IMG_001.JPG` and `IMG_001.CR2` share a basename (RAW+JPEG pair, where the basename sidecar belongs to the RAW) |
| **Sidecar is read-only, locked by another application, or unparseable** | Skip it, report it and retry later. Never recreate or replace it |
| **Sidecar changed on disk since our last write** (mtime/size differs from what was recorded) | **Read and import first**, then write. This prevents overwriting a change another app made in the meantime |

#### Field ownership (what we may change)

- We only touch a **managed set of fields**. Everything else is preserved byte-for-byte: develop settings (`crs:*`), history, other apps' namespaces and unknown tags. exiftool updates tags in place.
- **Ownership ledger** (migration 002): `metadata_ledger(photo_id, field, value, written_at)` records exactly which values *we* wrote.
  - **Keywords (`dc:subject`, `lr:hierarchicalSubject`):** union merge. Add ours. Remove a keyword only if **we** wrote it and the user removed it in SPO. Keywords from other apps are never removed.
  - **People (`Iptc4xmpExt:PersonInImage` + MWG-RS face regions):** merge by person name. Add or update regions we own. Regions and names written by other apps are left intact. A region is only removed if we wrote it.
  - **Rating and label (added in Phase 136):** if the sidecar has a value we didn't write, import it into SPO rather than overwrite it. SPO writes it only after the user changes it in SPO.
  - **Description:** written only if the user opts in to caption export **and** the field is empty or was written by us.
- **Dry-run report before the first bulk write:** "N sidecars will be created, M existing sidecars updated (fields: …), K skipped (read-only, locked, conflicting)". The user confirms before anything is written.
- **Safety backup:** Before the first modification of any *pre-existing* sidecar, copy it to `<library>/backups/xmp/<date>/…` (preserving relative paths). Sidecars are small, and this makes the whole operation reversible. A "Restore sidecars from backup" action is provided.

#### Import from existing sidecars (turns the constraint into a benefit)

- **On scan:** read existing sidecars. Import keywords as tags (`source = 'xmp'`) and ratings and labels (from Phase 136), filling only empty DB fields.
- **Face-name bootstrap:** existing MWG-RS / Microsoft face regions written by other tools are matched to SPO's detected faces (IoU ≥ 0.5, orientation-normalized) and offered as **naming suggestions** in People. They are never auto-confirmed. This can seed recognition for libraries that already have tagged faces.
- **Restore after DB loss:** our own previously written fields are re-imported.

**Tasks**
1. **Settings:** `metadata.writeBack` = `off` (default) or `sidecar`. `metadata.sidecarNaming` = `auto` (default: rules above), `basename` or `extension`. Toggles for description export and face-region export.
2. **Interfaces:** a `MetadataWriter` / `MetadataReader` interface pair with an `ExifToolMetadataAdapter` built on `exiftool-vendored`. Business logic never imports exiftool directly.
3. **`SidecarLocator`** (pure function): given a photo path and a directory listing, return `{ existing: [...], target, conflict? }` per the table above.
4. **`MetadataMergePlanner`** (pure function): given the current sidecar fields, the ledger and the SPO state, return the minimal set of tag writes and deletes plus any values to import.
5. **Migration 002:** `photos.metadata_dirty INTEGER DEFAULT 0`, `photos.sidecar_mtime INTEGER`, `photos.sidecar_size INTEGER`, and the table `metadata_ledger`.
6. **Write queue** `BackgroundMetadataWriteService`: debounced (name, merge and tag edits enqueue affected photo IDs), batched, pauses during scans, and retries locked files with backoff.
7. **Bulk "Write metadata for entire library"**, with the dry-run report, progress, cancel and the sidecar backup.
8. **Import path** in the scan pipeline, plus the People "suggestions from existing face tags" source.

**Tests first**
- `SidecarLocator`: no sidecar; basename only; extension only; both present; RAW+JPEG pair with a shared basename; case differences (`.XMP`).
- `MetadataMergePlanner`: foreign keywords are never removed; our removed keyword is deleted; a foreign rating is imported, not overwritten; a foreign face region is preserved; a person rename updates only our region.
- Region coordinate conversion for all 8 EXIF orientations.
- **Integration against real sidecar fixtures** (samples containing develop settings, hierarchical keywords and face regions from other tools): after a write, every non-managed tag is byte-identical (exiftool `-X` dump comparison).
- An externally modified sidecar is imported before it is written.
- Locked or read-only sidecars are skipped and retried.
- The backup is created exactly once per pre-existing sidecar, and restore round-trips.
- The dry-run report counts match the actual writes.
- With the setting `off`, zero writes happen (reads and imports still work).

**Backward compat:** Off by default, so existing users see no file changes until they opt in. Reading and importing from existing sidecars is additive and only fills empty fields. The bulk action with dry run covers existing libraries.

---

## Step 3 — Semantic Search

### Phase 133 — CLIP Image Embedding Pipeline

**Today:** CLIP is only used for zero-shot label classification in `src/workers/scanner.worker.ts`. No embeddings are stored. Content search depends on SmolVLM captions, which require a GPU.

**Tasks**
1. **Decision (approved):** compute embeddings in the **Python backend**, with GPU when available and CPU fallback, next to the existing FAISS code. Add a `ClipProvider` class that follows the `Sam3Provider` lazy-load and `get_capabilities()` pattern, to avoid cold-import delays.
2. **Model config:** `ai.clip.modelId` (default ViT-B/32, 512-d) in the external model config. The stored `model_id` lets a model change trigger re-embedding.
3. **Migration 003:** `photo_embeddings(photo_id INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE, model_id TEXT NOT NULL, dim INTEGER NOT NULL, vector BLOB NOT NULL, created_at DATETIME)`. This is a separate table so `photos` stays lean.
4. **Refactor `src/python/facelib/vector_store.py`** (Refactoring Protocol) into a reusable `VectorIndex` class parameterized by name, dimension and metric. The face index keeps its files and behaviour. The new `clip_vectors.index` and `clip_id_map.pkl` use L2-normalized vectors with inner product (cosine), switching to IVF above the existing size threshold.
5. **Python commands:** `clip_embed_batch`, `clip_encode_text`, `clip_search`, `clip_search_by_photo`, `clip_rebuild_index`.
6. **`BackgroundEmbeddingService`:** batches of 16–32 with yields between them (**the Python IPC is single-threaded**, and long blocking calls make queued commands time out), pauses during active scans, shows coverage % in Queues, and records failures in `scan_errors` with stage `clip`.
7. New photos are embedded in the scan pipeline after face detection.

**Tests first**
- Python: vectors are unit-normalized. Index add, search and persist round-trip. The rebuild switches to IVF at the threshold. The face index is unchanged after the refactor (existing Python tests plus a new regression test).
- TS: the service pauses and resumes around scans, batch sizes are respected, errors are recorded, and a model ID change re-queues the photos.
- Benchmark: embedding throughput on CPU and GPU recorded in the changelog.

**Backward compat:** Existing libraries backfill gradually. Until coverage reaches 100 %, search blends in the existing tag and caption search (Phase 134). Older builds ignore the new table and index files.

### Phase 134 — Semantic Search, "More Like This" & Similar Photos

**Tasks**
1. **Hybrid search ranker** (pure function): combine CLIP text→image similarity with tag and caption matches, and apply a similarity cutoff (setting). Show a coverage notice while the backfill is incomplete.
2. **Search view:** a free-text box queries the hybrid ranker, with results paged through the virtualized grid.
3. **FilterBuilder criterion** "Content matches …" so Smart Albums and the Set Builder can use it. It is stored as an optional `contentQuery` in `filter_json` and evaluated live.
4. **"More like this"** in the photo context menu and in PhotoDetail.
5. **Duplicates view, third tab "Similar":** groups by embedding cosine threshold, excludes exact duplicates, and uses the existing keep/resolve workflow.
6. **Home dashboard hook:** optional "Themes" widget (deferred unless there's time left).

**Tests first**
- Ranker ordering, ties and cutoff.
- An old `filter_json` without `contentQuery` parses and round-trips unchanged.
- IPC payload validation rejects oversized or empty queries.
- Similar-group builder excludes exact-hash duplicates.

**Backward compat:** Existing Smart Albums are unaffected. On CPU-only machines, content search now works where it previously required a GPU.

### Phase 135 — FLUX.2 Background Generation (Creative Tools)

**Why here:** It is Python and AI-runtime work, like Phases 133–134, so the runtime bundle changes (new `diffusers` dependency) are batched into one AI Runtime release. It is independent of the library phases that follow.

**Scope:** As specified in `docs/specs/future_features.md` (formerly "Phase 120"): a `FluxProvider` (lazy load with CPU offload fallback), an `apply_generate_background` composite using the SAM 3 mask with feathering, `ai:flux:capabilities` and `ai:flux:generate` IPC, a `useFlux` hook, a Generate Background control with prompt, seed, steps and guidance, a model download card with a VRAM and **non-commercial licence** acknowledgement, and capability gating.

**Additions to the original spec**
- **Single-threaded Python IPC:** Generation with CPU offload can take minutes and would block all queued commands. Run generation as a **cancellable long operation**: background services pause while it runs, other requests get a "busy" response instead of timing out, and progress is streamed per step.
- **Memory hand-off:** Unload SAM 3 and CLIP (or move them to CPU) before loading FLUX on GPUs with less than 32 GB, and restore them afterwards.
- **Runtime size:** Document the optional ~18 GB model download separately from the AI Runtime. The model is never bundled.

**Tests first:** capabilities with diffusers mocked (present, absent, low VRAM); composite logic; cancellation leaves the IPC queue healthy; background services pause and resume around generation.

**Backward compat:** No schema change. Hidden unless the model is installed and the capability check passes.

---

## Step 4 — Library Essentials & UX Polish

> Collections (Phase 139) come before batch operations (Phase 140) so that "Add to collection" can be one of the batch actions.

### Phase 136 — Ratings, Favorites & Pick/Reject Culling
- **Migration 004:** `photos.rating INTEGER NOT NULL DEFAULT 0` (0–5), `is_favorite INTEGER NOT NULL DEFAULT 0`, `cull_flag INTEGER NOT NULL DEFAULT 0` (0 = unreviewed, 1 = pick, 2 = reject), plus indexes.
- **Backfill:** import `Rating` from existing `metadata_json` (EXIF/XMP) for existing libraries.
- **Keyboard:** `0`–`5` rate, `F` favorite, `P` pick, `X` reject, `U` unflag in PhotoViewer, PhotoDetail and grid selection. Put the logic in a `useCullingShortcuts` hook.
- Filter criteria and Smart Album support. Grid badges.
- **"Suggested rejects"** built-in Smart Album from `blur_score` and face quality (non-destructive).
- Extend the XMP writer with `xmp:Rating` and `xmp:Label`.
- **Tests:** backfill parsing (including malformed values), shortcut hook, filter SQL, old filters round-trip.

### Phase 137 — Compare View (2–4 panes)
- Open from a multi-selection, from duplicate and similar groups, or with a shortcut.
- Synchronized zoom and pan (toggle), per-pane EXIF and face overlay, and pick/reject/rating keys acting on the focused pane.
- **Tests:** pane layout function, sync transform math (reuse `computeCanvasTransform` patterns), keyboard focus routing.

### Phase 138 — Timeline Scrubber & Calendar Heatmap
- A date rail beside the Library grid with year and month markers. Dragging jumps the virtualized list (`react-virtuoso` index). Markers come from a single grouped-count query.
- Home dashboard **Calendar heatmap** widget with adaptive intensity levels and year/month/day drill-down into Search.
- **Tests:** marker computation for sparse and dense libraries, and the index↔date mapping.

### Phase 139 — Manual Collections
- **Migration 005:** `collections(id, name, sort_order, cover_photo_id, created_at)` and `collection_photos(collection_id, photo_id, added_at, PRIMARY KEY(collection_id, photo_id))`, both with cascade.
- Sidebar section, drag-to-collection, reorder, remove-from-collection (never deletes files), and Set Builder "Save as collection".
- Collection membership is available as a filter criterion.
- **Tests:** repository CRUD, cascade on photo removal, duplicate adds are idempotent.

### Phase 140 — Batch Operations on Selection
- A floating selection bar (extends `FloatingActionBar`) with add/remove tags, rate, favorite, pick/reject, add to collection and write metadata.
- All batch writes happen in one transaction per action. Undo covers the last batch action.
- **Tests:** batch repository functions, undo snapshot and restore.

### Phase 141 — Browse Facets & Thumbnail Badges
- **Migration 006:** promote `camera_make`, `camera_model`, `lens_model` and `iso` from `metadata_json` into indexed columns, with a backfill from existing JSON (lens-maker inference when missing).
- Library sidebar tabs for Camera, Lens and Date, with counts.
- Optional grid badges for format, ISO, shutter, aperture and focal length (setting).
- **Tests:** EXIF normalization, backfill from legacy JSON, facet count query.

### Phase 142 — Staged Scan Progress & Shortcuts Reference
- Scan progress reports stages (discovery → previews → faces → embeddings) with indexed, skipped, failed and relinked counts in the StatusBar and Queues.
- Settings → **Keyboard Shortcuts** tab generated from one shortcut registry (single source of truth for all views).
- **Tests:** progress reducer, registry has no duplicate bindings.

### Phase 143 — Date-Organized Import
- Import from a folder or card into `YYYY/YYYY-MM-DD`, `YYYY/YYYY-MM` or `YYYY` layouts under a chosen library root, using the capture date with mtime as fallback.
- Skip duplicates by SHA-256 (existing hashes). Keep RAW+JPEG and sidecars together. Progress, cancel, and imported/skipped/failed counts. Guard against nested or identical source and destination.
- Imported files are inserted directly, with no separate full scan needed.
- **Tests:** path template function, duplicate skip, nested-folder guard, sidecar grouping. The file-system adapter is mocked.

---

## Step 5 — Places

### Phase 144 — Offline Reverse Geocoding
- Bundle a GeoNames cities dataset (CC-BY 4.0, with attribution in About and docs) and query it through a KD-tree (`kdbush` / `geokdbush`) in the main process. No network access.
- **Migration 007:** `photos.geo_city`, `geo_admin1`, `geo_country_code`, indexed. Backfill from the existing GPS columns.
- Place names become searchable and usable as filter criteria. Extend the XMP writer with `photoshop:City`, `State` and `Country`.
- **Tests:** nearest-city lookup (known coordinates, antimeridian, poles, ocean → none), backfill.

### Phase 145 — Map View
- A full Map view using Leaflet with marker clustering computed in a Web Worker. It follows the active filters. Clicking a cluster opens a photo panel, and the map keeps its position and zoom when you return.
- **Privacy:** online tiles are **opt-in** (setting and first-use notice), because tile requests reveal the areas being viewed. With tiles off, the map falls back to the existing offline SVG world map with the same clustering.
- Update the Electron CSP only for the configured tile host.
- Replace or extend the dashboard `LocationWidget` to link into the Map view.
- **Tests:** clustering worker (pure), filter→bounds query, tiles-disabled mode never issues a request.

---

## Step 6 — Format & Platform Expansion

### Phase 146 — HEIC/HEIF Support (spike first)
- **Spike (time-boxed):** confirm whether the `sharp` Windows prebuilt decodes HEIC. Fallbacks, in order: the embedded preview through `exiftool-vendored`, then Python `pillow-heif` for face detection input.
- Add `.heic`, `.heif`, `.hif` to supported formats, with correct orientation handling.
- **Tests:** decode path selection, orientation, fallback on decode failure → `scan_errors`.

### Phase 147 — RAW+JPEG Pairing
- **Migration 008:** `photos.pair_group_id INTEGER`, `photos.is_pair_primary INTEGER DEFAULT 1`.
- Same folder + same basename + RAW/JPEG extensions → pair. The primary is configurable (JPEG by default). Only the primary is face-scanned from now on, and the grid shows one item with a RAW badge.
- **Existing libraries:** both files were already face-scanned, so faces are duplicated. Secondaries are **hidden from grids and People counts through queries, not deleted**. An optional confirmed cleanup moves any unique named faces to the primary.
- **Tests:** pairing rules (case, multiple extensions), people-count queries exclude secondaries, existing named faces preserved.

### Phase 148 — Video Support (strategic, sub-phased)
- **148a:** index video files (FFmpeg/ffprobe sidecar binary: duration, dimensions, capture date, GPS), poster thumbnails, grid badge. **Migration 009:** `media_type`, `duration_ms`.
- **148b:** in-app playback (HTML5 `<video>`; transcode proxy only if needed).
- **148c:** Apple Live Photos (HEIC+MOV via content identifier) and Android Motion Photos (embedded MP4 offset), played in the viewer.
- **148d (optional):** face detection on sampled keyframes.
- **Tests:** ffprobe output parsing, motion-photo offset parsing, live-pair matching.

> **Scope: Option C** (148a–c + keyframe CLIP search; 148d deferred). See "Video: challenges and scope options" below.

#### Video: challenges and scope options

| # | Challenge | Why it's hard here | Affects |
|---|---|---|---|
| V1 | **FFmpeg / ffprobe bundling** | Needed for metadata, poster frames and keyframes. Adds ~80–120 MB to the slim installer (or goes into the optional AI Runtime). Must be an LGPL or GPL-compatible build (we're GPL-3.0, so fine) | 148a |
| V2 | **Playback codecs** | Electron's Chromium plays H.264, VP9 and AV1 natively. **HEVC/H.265 (the iPhone default)** only plays with hardware decode support on the user's GPU and OS, so it's unreliable. The fallback is transcoding a proxy (CPU time plus disk cache, possibly GBs) | 148b |
| V3 | **Pipeline audit** | Every stage assumes still images: previews, blur score, pHash, SHA-256 duplicates, faces, CLIP, VLM tags, Creative Tools, Enhance Lab, collage, On This Day. Each must skip, adapt or explicitly support video. **This audit is most of the effort and most of the regression risk**, not the player | 148a |
| V4 | **Metadata quirks** | QuickTime dates are UTC while EXIF is local time, so they need timezone correction. GPS and camera model live in vendor atoms. `exiftool-vendored` (already bundled) reads them, but the date-normalization tests need care | 148a |
| V5 | **Live / Motion Photos** | Pairing HEIC+MOV via the Apple content identifier needs HEIC support (Phase 146) first. Motion Photos need parsing of the embedded MP4 offset. Both must be hidden from the grid as separate items and kept together in file operations | 148c |
| V6 | **Faces in video** | Keyframe sampling (e.g. one frame every 2 s or on scene change) multiplies face count: a 5-minute clip gives about 150 frames. It needs cross-frame tracking or deduplication (overlaps the on-hold burst-tracking plan), a new "appears at 0:42" UX, face crops taken from frames, and large GPU time. On the single-threaded Python IPC it must run as a long background job | 148d |
| V7 | **Semantic search in video** | Cheap once keyframes exist: CLIP-embed 3–5 keyframes per video into the Phase 133 index | Optional add-on |

| Option | Includes | Effort | Notes |
|---|---|---|---|
| **A. Catalog only** | 148a + open in the system player | S–M | Videos show up, are searchable by date, place and camera, and open externally. Lowest risk |
| **B. Catalog + playback + Live/Motion** | 148a–c | M–L | Full browsing experience. HEVC may need proxies |
| **C. B + keyframe CLIP search** | 148a–c + V7 | L | "Find the video of the beach" works. Small increment over B |
| **D. Everything** | 148a–d + V7 | XL | Faces in video. Best done after the burst-tracking decision |

### Phase 149 — In-App File Operations
- Move, rename, copy and trash from the app (trash via `shell.trashItem`). DB rows, preview cache, sidecars and RAW+JPEG pairs move together. Uses the Phase 131 relink machinery.
- Every destructive action is confirmed and has an undo where the OS allows it.
- **Tests:** operation planner (pure), rollback when the DB update fails after a file move, pair and sidecar grouping.

### Phase 150 — Internationalization Foundation
- `react-i18next`. Extract strings view by view (English first). Locale-aware date and number formatting.
- **Tests:** missing-key detection script, and a pseudo-locale snapshot check to catch hard-coded strings.

### Phase 151 — Auto-Updater
- `electron-updater` with GitHub Releases. Opt-in automatic checks. Coordinate with the separate AI Runtime bundle versioning (the runtime is not updated through this channel).
- Document the Windows SmartScreen implications of unsigned builds, and evaluate code signing.
- **Tests:** update-state reducer, and the runtime-version compatibility check.

---

## Migration Version Map

| Migration | Phase | Change |
|---|---|---|
| 000 | 128 | Legacy baseline (existing ad-hoc migrations, frozen) |
| 001 | 130 | `photos` identity columns, `scan_folders` |
| 002 | 132 | `photos.metadata_dirty` |
| 003 | 133 | `photo_embeddings` |
| 004 | 136 | rating / favorite / cull_flag |
| 005 | 139 | collections |
| 006 | 141 | camera/lens facet columns |
| 007 | 144 | geocode columns |
| 008 | 147 | RAW+JPEG pairing |
| 009 | 148a | video columns |

All migrations are additive (Policy A.1).

## Risks

| Risk | Mitigation |
|---|---|
| Folder skip combined with missing detection marks unchanged folders as missing | Missing detection uses walked folders only (Phase 130 contract), with an explicit test |
| Duplicates cleanup deletes ghost rows that hold names | `missing_since` rows are excluded from Duplicates deletion. The Repair wizard is suggested first |
| Wrong relink attaches names to the wrong photo | Only link when confident (ID+size or exact hash). Ambiguous cases go to the user. Repair wizard shows a preview and needs confirmation |
| Folder-mtime skip misses changes on some filesystems | Recurse always, "Full rescan" option, and treat NULL/0 identity values as unknown |
| CLIP backfill starves the single-threaded Python IPC | Small batches with yields between them, pause during scans, queue priority below interactive commands |
| XMP write corrupts or clobbers third-party metadata | Off by default, sidecar mode by default when enabled, merge-only writes, integration tests on real files |
| Schema changes break older builds | Additive-only policy, and the downgrade guard |
| Large files grow further | Hygiene rule C: new modules, no growth in files over the limit |

## Decisions

| # | Topic | Decision (2026-09-26) |
|---|---|---|
| 1 | CLIP compute (Phase 133) | **Python backend** |
| 2 | Metadata write-back (Phase 132) | **Separate sidecar files**, coexisting with existing sidecars per the rules in Phase 132 |
| 3 | Map tiles (Phase 145) | **Online tiles with an on/off toggle**, with an offline fallback |
| 4 | Video scope (Phase 148) | **Option C:** 148a–c + keyframe CLIP search. Faces in video (148d) deferred |
| 5 | Branching | Merge `feature/phases-117-118-119` via PR and **cut a release before** the roadmap version bump |
| 6 | FLUX.2 | Fitted in as **Phase 135** (Step 3) |
