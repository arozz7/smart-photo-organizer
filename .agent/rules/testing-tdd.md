---
trigger: model_decision
---

# TDD & Testing Standards
(Activation: Model Decision - "When writing code or plans")

## The Enterprise TDD Rule
- **Red -> Green -> Refactor:** You must write the test case *before* the implementation code when "Enterprise Mode" is active.
- **Test Locations:**
  - Unit tests live alongside source files (e.g., `feature.test.ts`) or in a dedicated `tests/` mirror structure depending on the language convention.

## Test Structure (AAA)
1. **Arrange:** Set up the state and mocks.
2. **Act:** Execute the specific function/method.
3. **Assert:** Verify the result strictly.

## Coverage Requirements
- **Unit Tests:** Focus on business logic and edge cases. Goal: >80% branch coverage.
- **Integration Tests:** Focus on happy paths and critical error flows between modules.

## 🛑 What Not To Do
- Do not comment out failing tests. Fix the code or the test.
- Do not use `sleep()` or time-based waits in tests. Use deterministic polling/awaiting.
- Do not mock what you don't own (mostly). Prefer integration tests for external