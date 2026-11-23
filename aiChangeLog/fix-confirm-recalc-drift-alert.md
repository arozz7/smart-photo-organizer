# Confirming faces recalculates the model; a clean check clears drift alerts (0.8.20)

## Behavior
- Confirming (or unconfirming) faces on a person's page now recalculates that person's model at once. The model is built from confirmed faces only, so before this the user had to press "Recalculate Model" for confirmations to count. No drift alert is raised by this recalculation: the model moved because the user said so.
- "Find Misassigned" and "Find Misassigned (Audit Confirmed)" clear the person's drift alerts when they find nothing (a face that changed over the years, child to teenager, is not a misassignment). The page reloads its alerts after each check.

## Files
- `electron/core/services/PersonService.ts`: `setFacesConfirmed`, `resolveDriftAlerts`, `recalculatePersonMean(personId, { raiseDriftAlert })`.
- `electron/data/repositories/FaceRepository.ts`: `getPersonIdsForFaces`. `PersonRepository.ts`: `dismissAlertsOfType`.
- `electron/ipc/dbHandlers.ts`: `db:confirmFaces`, `db:unconfirmFaces`, `person:findOutliers` (returns `alertsCleared`).
- `src/views/PersonDetail.tsx`: `loadAlerts` reused after each check.

## Tests
- `tests/backend/unit/services/PersonService.confirm.test.ts`.

## Risks
- Confirming a very large selection recalculates once per affected person (usually one); the work is the same as the manual button.
- Drift alerts that stay when the check finds faces to review are unchanged.
