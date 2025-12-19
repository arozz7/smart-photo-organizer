---
trigger: model_decision
---

# TypeScript & React Standards
(Activation: Glob `**/*.{ts,tsx}`)

## Code Style Expectations
- **Strict Typing:** No `any`. Use generic constraints or specific interfaces.
- **Functional Components:** React components must be functional.
- **Immutability:** Use `const` over `let`.

## Architecture Preferences
- **Validation:** Use Zod or Pydantic for boundary validation (API responses, form inputs).
- **State:** Use React Context for UI state only; use Redux/Zustand for global data.

## Security Defaults
- **Sanitization:** All inputs must be sanitized.
- **Secrets:** Never hardcode secrets. Use `.env` and validate presence at runtime.

## "What Not To Do"
- Do not put logic in UI components; extract to hooks or utility functions.
- Do not modify global `d.ts` files without a specific reason.