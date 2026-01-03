---
trigger: model_decision
description: When writing code, tests, or refactoring
---

# Master Testing Standards (TDD + Robustness)
(Activation: Model Decision - "When writing code, tests, or refactoring")

## 1. The Process (TDD)
- **Red -> Green -> Refactor:** You must write the test case *before* the implementation.
- **Cycle:**
  1. Write a failing test (Red).
  2. Write minimal code to pass (Green).
  3. Refactor code while keeping tests green (Refactor).

## 2. The Golden Rule of Quality (Robustness)
**Test Behavior, Not Implementation.**
- **✅ Do:** Assert that `calculateTotal(cart)` returns `100`.
- **❌ Do Not:** Assert that `calculateTotal` called `helperAdd()`.
- **Why?** We must be able to completely rewrite the internal logic of a function without changing a single line of its test.

## 3. Structure (AAA)
- **Arrange:** Setup data and strictly typed mocks.
- **Act:** Trigger the public method.
- **Assert:** Verify the output or state change.

## 4. Mocking & Isolation
- **External Systems:** ALWAYS mock Database, Network, and File System.
- **Internal Logic:** NEVER mock internal class methods. Use real instances.
- **Dependency Injection:** Code must be designed to accept mocks (e.g., pass `StoreInterface` to constructor).

## 5. Refactoring Safety Protocol
When asked to refactor:
1. Run existing tests.
2. If tests pass, proceed with code changes.
3. If tests fail after changes, **revert**. You have broken the behavior.