# Smart Photo Organizer

## Core Philosophy
> Readability and Order > Speed and Complex Interconnections

Prioritize maintainability and clarity over clever, hyper-optimized code. Follow SOLID, DRY, and KISS principles.

## 🛑 The Golden Rule
**DO NOT WRITE CODE** until an Implementation Plan is explicitly approved (for multi-file or architectural changes).
**NO DELETIONS** are allowed without explicit confirmation.

## Stack
- **Frontend:** React + TypeScript (Vite)
- **Backend:** Electron (main process, TypeScript)
- **AI/ML:** Python (face detection, VLM processing)
- **Database:** SQLite (via better-sqlite3)
- **IPC:** Electron contextBridge + ipcMain.handle/ipcRenderer.invoke

## Project Structure
- `electron/` — Main process: services, IPC handlers, scanner
- `src/components/` — React UI components
- `src/python/` — Python AI pipeline (face detection, VLM, NMS)
- `tests/backend/` — TypeScript/Electron tests
- `tests/python/` — Python tests
- `aiChangeLog/` — Phase-based change logs
- `.agent/` — Project planning artifacts (roadmap, specs, state)

## Git Workflow
- Branch naming: `feature/phase-XX-short-desc` or `fix/issue-desc`
- Protected main branch — never force push
- Conventional commits: `feat(scope):`, `fix(scope):`, `docs(scope):`, `refactor(scope):`
- Stage specific files (`git add <file>`) — avoid `git add .`
- Write change logs to `aiChangeLog/phase-XX.md` for significant changes

## TypeScript Standards
- Strict typing — no `any`, use generics and interfaces
- `const` for immutables, `let` for mutables, never `var`
- ES Modules over CommonJS
- Async/await with try/catch, no raw Promise chains
- Zod for boundary validation (API inputs, IPC payloads)
- No logic in UI components — extract to hooks or service layer
- Strict equality (`===`) only

## Security
- Zero Trust: validate at all process boundaries (API inputs, file reads, IPC messages)
- Never commit secrets — use `.env` files, check `.gitignore`
- Input sanitization with Zod (TypeScript) or Pydantic (Python)
- Parameterized SQL queries only — no string interpolation
- No `eval()`, no `shell=True` in subprocess, no `dangerouslySetInnerHTML` without sanitization
- Fail closed on invalid input
- No logging of PII, tokens, or passwords

## Testing
- **TDD cycle:** Write failing test first, implement minimum to pass, then refactor
- **AAA structure:** Arrange, Act, Assert
- **Mock externals only:** Database, network, file system. Never mock internal class methods.
- **Coverage target:** >80% branch coverage
- **Speed:** Unit tests <50ms, integration tests <1s
- **Forbidden:** `sleep()` or time-based waits (use deterministic polling), commented-out failing tests, testing constants, overspecified mocks
- Use dependency injection for mockability
- Test behavior and results, not implementation details

## Debugging
- Use hypothesis-driven debugging: document symptom, gather evidence, rank hypotheses, test highest-likelihood first
- 3-strike rule: if 3 attempts fail on the same approach, stop and try a fundamentally different approach
- Persist debug state in `.agent/debug.md` for complex issues

## Change Logging
After completing a significant phase of work, update `aiChangeLog/phase-XX.md` with:
- Files created/modified (include refactor mappings if applicable: `Moved 'X' from 'A.ts' -> 'B.ts'`)
- Behavior changes
- Tests added
- Assumptions and risks

## Refactoring Safety
When refactoring:
1. **Run Tests FIRST:** Ensure all current tests pass
2. **Refactor:** Apply the changes
3. **Run Tests AGAIN:** If any test fails, revert and analyze
4. **DO NOT delete files** — Refactor or deprecate instead

## Planning & Execution
For multi-file or architectural changes:
1. Propose an Implementation Plan with phases, tasks, TDD requirements
2. Wait for explicit approval
3. Execute one task at a time
4. Update documentation (README.md, docs/) as you go

For simple single-file changes, proceed directly.
