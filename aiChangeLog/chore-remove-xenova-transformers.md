# Chore: remove `@xenova/transformers` (vulnerability plan, PR B of 3)

**Branch:** `chore/remove-xenova-transformers` (stacked on `chore/build-tools-upgrade`)
**Result:** `npm audit` 8 -> 3 findings. Removes `@xenova/transformers`, `onnxruntime-web`, `onnx-proto`, `protobufjs` and the nested old `sharp` 0.32 from the dependency tree.

## Why it is safe
- `@xenova/transformers` was imported in exactly one place: `src/workers/scanner.worker.ts`.
- Nothing starts that worker: no `new Worker(...)` or reference to the file exists in `src/`, `electron/`, `tests/` or `scripts/` (only docs and older change logs mention it). It is dead code in the shipped app.
- npm's own suggested fix (a downgrade to 1.4.2) was not usable, and migrating to `@huggingface/transformers` makes no sense for code that never runs.

## File mappings
- Moved `src/workers/scanner.worker.ts` -> `src/deprecated/workers/scanner.worker.ts` (kept, not deleted; it still documents the Phase 109 CLIP zero-shot tagging approach).
- `tsconfig.json`: added `"exclude": ["src/deprecated"]` so the parked file (which imports the removed package) is not type-checked. ESLint still lints it; the warning count is unchanged.
- `package.json` / `package-lock.json`: removed `@xenova/transformers` (-384 lockfile lines).

## Notes and follow-ups
- `docs/plans/library-foundations-roadmap.md` (around line 317) says CLIP is "used for zero-shot label classification in `src/workers/scanner.worker.ts`". That file never ran in the app, so any future CLIP work (the roadmap's embeddings item) starts from scratch, with Python or `@huggingface/transformers`. The roadmap text was left as written; correct it when that phase is planned.
- `@tensorflow/tfjs` is now unused (only the parked worker imported it). `@vladmandic/human` is still used by `scripts/download-models.js`. Neither is flagged by `npm audit`; left alone, candidates for a later tidy-up.

## Verification
`scripts/dev/verify.ps1`: type check, lint (0 errors, 61 warnings), file sizes, vite build, 767 TypeScript tests, 190 Python tests all pass. No manual check needed beyond the PR A one: no running code path changed.
