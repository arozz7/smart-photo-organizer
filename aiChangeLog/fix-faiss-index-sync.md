# Fix: the face search index (FAISS) was empty and never kept up to date; quieter clustering logs

**Branch:** `fix/faiss-index-sync` (from `main` at 0.8.4). Version 0.8.5.

## Finding (see the face-logic review)
The index must hold only faces that belong to named people (`ai:rebuildIndex` indexes `getNamedFaceDescriptors`). On the real library it held
**0 vectors** (saved empty on Sep 25; every launch loaded "0 vectors"; no rebuild in any log) while 33 people with 3,386 named faces existed. The
fallback search in `FaceService.matchBatch` returned "0 unique face matches" about 1,400 times. Two causes:
1. After every scanned photo `AIContext.tsx` sent `{vectors, ids}` to `ai:addFacesToVectorIndex`, but the AI backend's `add_faces_to_vector_index`
   reads `{faces: [...]}`: it added nothing and still answered success (reproduced). It also would have added unnamed faces, which breaks the named-only rule.
2. Assigning faces to people never added them to the index, and never marked it out of date (the stale counter only counted ignore/delete/unassign),
   so only a manual "Rebuild Face Index" filled it.

## Changes
- **`BackgroundFaissSyncService`** (new, `electron/core/services/`): every minute, when no scan or AI work is running, compares the set of named faces
  (a fingerprint: count and two sums of face ids, 16 ms on the real library) with the index (`get_index_status` vector count) and rebuilds when they differ, after one quiet check
  so it never rebuilds mid-naming. Faces are assigned in six places including raw SQL, so this works on the result instead of hooking each one; it also picks up removals.
  A failed rebuild is retried no sooner than 10 minutes later. First run on an existing library only records the state when the sizes already agree.
  Decision rules are a pure function in `faissSync.ts`.
- `FaissIndexService.ts`: the rebuild logic moved out of the `ai:rebuildIndex` handler (the handler now calls it; behaviour unchanged) plus the real dependencies for the service.
- `NamedFaceFingerprintRepository.get()` (a new small file: `FaceRepository.ts` is already over the size limit and may not grow). It starts from the people and uses the
  `person_id` index: 16 ms on the real library, against about 220 ms for the same question asked by scanning the faces table.
- Removed the per-scan no-op call in `AIContext.tsx`; `ai:addFacesToVectorIndex` now sends the shape the backend reads (`toIndexFaces`).
- **Search depth** (`vector_store.py`): an IVF index visits only `nprobe` lists per search, FAISS defaults to 1 and does not save it in the file. Measured on the real rebuilt index
  (3,407 faces, 233 lists): the true nearest other face was found 86% of the time at 1, 99% at 4, 100% at 10. Now set to 16 after building and after loading.
- **Quieter logs** (`commands/clustering.py`): per-group lines (3,500 per People open, also forwarded into main.log, which rotated within an hour) are DEBUG; INFO keeps one summary line.

## Tests
`faissSync.test.ts` (14), `BackgroundFaissSyncService.test.ts` (10), `test_vector_store_search_depth.py` (4), `test_clustering_logging.py` (4).

## Not done
- Binary transfer of descriptors and caching of the clustering result (People page speed) are separate, bigger changes.
- Exact duplicates: 77 of 400 sampled named faces have another named face with an identical descriptor (duplicate photos); not investigated.
