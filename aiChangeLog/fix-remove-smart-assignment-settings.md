# Smart Assignment removed from Settings (0.8.21)

## Behavior
- The "Smart Assignment / Contextual Label Propagation" section is no longer shown in Settings. It only explained that silent assignment is switched off and offered a button that assigned nothing.
- Nothing else changes: the background pass still skips itself while silent assignment is off.

## Removed (dead code, nothing else used it)
- `src/components/settings/SmartAssignmentSection.tsx` and `tests/frontend/unit/components/SmartAssignmentSection.test.tsx`.
- IPC handlers `db:batchPropagateLabels` and `db:propagateLabelsInSession` in `electron/ipc/dbHandlers.ts` (no caller in the renderer) and the import they needed.

## Kept on purpose
- `ContextualMatchingService` and `BackgroundPropagationService` stay for the redesign in `docs/plans/contextual-suggestions-plan.md` (a reviewed list of suggestions). The redesign adds its own handlers when it needs them.

## Files
- `src/views/Settings.tsx`; test `tests/frontend/unit/views/Settings.test.tsx`.
