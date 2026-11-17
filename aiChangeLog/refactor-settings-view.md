# Refactor: split `src/views/Settings.tsx`

**Branch:** `refactor/settings-view-split` (from `main` after PR #72 and #73 merged)
**Goal:** `Settings.tsx` had grown to 899 lines with 12 pieces of state and every section inline. It is now a 63-line composition file. Behaviour is unchanged.

## Safety net
- Added `tests/frontend/unit/views/Settings.test.tsx` (22 tests) **before** moving anything and committed it alone. It passed against the unmodified file and passes unchanged after every step.
- It covers: all section headings, values loaded over IPC, AI profile / Smart Tags / era settings saved merged with stored settings, the reload prompts, batch propagation, Clear Tags, Cleanup Tags, Deduplicate Faces, Factory Reset gating (exact `RESET`), Move Library flow with the blocking modal, Photo Repair Shop path, preview cache cleanup, blur scores, and the two dialogs.

## File mappings (location changes, no logic changes)
| Moved | From | To |
| --- | --- | --- |
| `SettingsToggle` | `views/Settings.tsx` | `components/settings/SettingsToggle.tsx` |
| `PreviewManager` | `views/Settings.tsx` | `components/settings/PreviewManager.tsx` |
| Library Storage section + Move Library modal | `views/Settings.tsx` | `components/settings/LibraryStorageSection.tsx` |
| AI Performance Profile section + models dialog state | `views/Settings.tsx` | `components/settings/AiPerformanceSection.tsx` |
| Person Identification section | `views/Settings.tsx` | `components/settings/PersonIdentificationSection.tsx` |
| Era Generation section | `views/Settings.tsx` | `components/settings/EraGenerationSection.tsx` |
| Smart Assignment section + `handleBatchPropagate` | `views/Settings.tsx` | `components/settings/SmartAssignmentSection.tsx` |
| Database Management section | `views/Settings.tsx` | `components/settings/DatabaseManagementSection.tsx` |
| Factory Reset dialog + `handleFactoryReset` | `views/Settings.tsx` | `components/settings/FactoryResetModal.tsx` |
| Integrations section (Photo Repair Shop path, Send to card) | `views/Settings.tsx` | `components/settings/IntegrationsSection.tsx` |
| Health & Logs section + scan warnings dialog state | `views/Settings.tsx` | `components/settings/HealthLogsSection.tsx` |
| AI profile / Smart Tags / era state and saves | `views/Settings.tsx` | `hooks/useAiSettings.ts` |
| Clear Tags / Cleanup Tags / Deduplicate Faces handlers | `views/Settings.tsx` | `hooks/useDatabaseMaintenance.ts` |

New shared piece: `components/settings/SettingsSection.tsx` (the titled `<section>` block that was repeated nine times; same classes, so the page looks identical).

## Behaviour notes
- AI settings are still read once on mount (shared `useAiSettings`), not once per section.
- Each AI change is still saved merged with the stored settings (`ai:getSettings`, then `ai:saveSettings`).
- The Factory Reset dialog is mounted only while open, so its input starts empty each time, as before.
- **Existing quirk kept on purpose:** starting a library move sets the same "busy" flag as Clear Tags, and nothing resets it. After a failed move the Clear Tags button stays on "Clearing...". A test documents this. It is a separate bug to fix in its own change, not part of a move.

## Assumptions and risks
- No manual check in the running app yet: the test environment is happy-dom, so real layout is unverified. Checklist: open Settings, confirm both columns and the full-width Integrations / Health blocks look as before, open the models dialog, scan warnings dialog and Factory Reset dialog.
- Files are not deleted; nothing outside `Settings.tsx` imports the moved code (`Settings` is imported only by `src/App.tsx`).
