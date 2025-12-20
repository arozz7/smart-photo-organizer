---
trigger: glob
---

# JavaScript (Node.js/General) Rules
(Activation: Glob `**/*.js`, `**/*.mjs`)

## Code Style
- **ES Next:** Use modern ES6+ syntax (Arrow functions, Destructuring, Spread operator).
- **Variables:** strict usage of `const` for immutables, `let` for mutables. **NO `var`**.
- **Async:** Prefer `async/await` over raw Promises/callbacks. Always use `try/catch` blocks for error handling.

## Architecture
- **Modules:** Use ES Modules (`import`/`export`) over CommonJS (`require`) unless strictly legacy.
- **Functional:** Prefer pure functions. Avoid side effects in utility functions.

## Security
- Prototype Pollution: Validate deep merges and JSON parsing carefully.
- Dependencies: Audit `npm` packages regularly.

## 🛑 What Not To Do
- Do not use `==` (loose equality). Always use `===`.
- Do not ignore linter warnings (ESLint).
- Do not use synchronous file I/O (`fs.readFileSync`) in hot paths or server handlers.