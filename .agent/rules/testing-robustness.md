---
trigger: always_on
---

## 🛡️ Core Philosophy: Test Behavior, Not Implementation
**Golden Rule:** Tests must ensure the *result* is correct, not *how* the code achieved it.
- **✅ Good:** `expect(calculator.add(2, 2)).toBe(4)`
- **❌ Bad:** `expect(calculator.internal_adder).toHaveBeenCalled()`

*Why?* If we refactor `internal_adder` to `optimized_adder`, the Bad test fails (False Positive), but the Good test passes.

## 1. Unit Testing Rules (The Foundation)
*Focus: Isolated Logic. Speed: <50ms per test.*

- **Public API Only:** ONLY test `public` methods and exported functions. Never inspect `private` state or methods.
- **Mock Externalities:** Mock ALL I/O (Database, API, File System) using Dependency Injection interfaces.
- **Boundary Analysis:** You must include test cases for:
    - Happy Path (Standard inputs)
    - Edge Cases (Null, Empty, Negative numbers, Max limits)
    - Error States (Exceptions thrown)

## 2. Integration Testing Rules (The Wiring)
*Focus: Interactions between modules. Speed: <1s per test.*

- **Real Dependencies:** Use real instances for internal modules (e.g., Don't mock the 'Service' when testing the 'Controller').
- **Databases:** Use an in-memory database (SQLite) or a containerized instance (Docker) for tests. **Do not mock the database driver** if possible (it hides SQL syntax errors).
- **Network:** Mock only the *third-party* HTTP layer (e.g., Stripe/Auth0 responses), not your internal network calls.

## 3. The "Refactoring Confidence" Checklist
Before writing tests, the agent must ensure:
1. **Decoupling:** Tests must not import "implementation details" (helper functions not exposed in the `index.ts` / `__init__.py`).
2. **Resilience:** Avoid "Snapshot Testing" for logic. Use it only for UI/HTML output. Snapshots break on every minor change.
3. **Setup/Teardown:** Each test must be atomic. Use `beforeEach` to reset state. Never rely on the state left by a previous test.

## 🛑 Anti-Patterns (Strictly Forbidden)
- **Testing Constants:** Do not write tests that just check if a constant equals itself.
- **Overspecified Mocks:** Do not mock functions that aren't being called.
- **Sleeps:** Never use `Thread.sleep` or `time.sleep`. Use strict `await`