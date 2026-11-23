# Smart Assignment removed from Settings (0.8.21)

## Behavior
- The "Smart Assignment / Contextual Label Propagation" section is no longer shown in Settings. It only explained that silent assignment is switched off and offered a button that assigned nothing.
- Nothing else changes: the background pass still skips itself while silent assignment is off.

## Kept on purpose
- `src/components/settings/SmartAssignmentSection.tsx` (no longer rendered), `ContextualMatchingService`, `BackgroundPropagationService` and the `db:*PropagateLabels*` handlers stay for the redesign in `docs/plans/contextual-suggestions-plan.md` (a reviewed list of suggestions). Removing them needs a separate go-ahead.

## Files
- `src/views/Settings.tsx`; test `tests/frontend/unit/views/Settings.test.tsx`.
