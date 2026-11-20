# Fix: contextual label propagation no longer writes (Phase G0 of the contextual suggestions plan). Version 0.8.12

**Plan:** `docs/plans/contextual-suggestions-plan.md` (approved 2026-11-19, Phase G0). **Branch:** `fix/context-propagation-safe` (from the 0.8.11 model-pass branch).

## Why
"Run for Entire Library" (Settings > Smart Assignment) finished with "Done - 0 faces assigned" on the real library, and the hourly background pass returned `propagated: 0` every hour.
Two defects stop it from ever assigning (no named face has `confidence_tier = 'high'`; the +-5 minute window compares `T` dates against `datetime()` text). Repairing them would have started unseen assignments, and most photos hold several people, so the pass would have named the wrong person. See the plan, section 2.

## What changed
- `ContextualMatchingService`: the three passes (`propagateTemporalLabels`, `propagateSpatialLabels`, `batchPropagateForLibrary`) return a `disabled` result with a message and write nothing (`ASSIGNMENT_ENABLED = false`, with the reason beside it). The code is kept, not deleted; Phase G2 replaces it with reviewed suggestions.
- `BackgroundPropagationService`: stays registered, logs that the pass is skipped, does nothing else.
- Settings > Smart Assignment: the text says assignment is off and why; the button shows the service's message instead of "Done - 0 faces assigned".
- Version 0.8.12.

## Tests (written first)
- New `tests/backend/unit/services/ContextualMatchingService.test.ts` on the real legacy schema, with data the old code assigned (a high-tier sharp frontal anchor one minute away): it failed with `propagated: 1` before the change and passes after.
- `Settings.test.tsx`: the disabled result shows the message and not "Done".

## Assumptions and risks
- Nothing was ever assigned by this feature (no face has `assignment_source` `context_temporal` or `context_spatial`), so there is nothing to undo.
- Anyone who turns `ASSIGNMENT_ENABLED` on gets the old behaviour; the comment says not to.
