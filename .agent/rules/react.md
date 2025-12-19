---
trigger: glob
---

# ReactJS Standards
(Activation: Glob `**/*.tsx`, `**/*.jsx`)

## Code Style
- **Functional Components:** 100% Functional Components + Hooks. No Class components.
- **Naming:** PascalCase for components, camelCase for hooks/functions.
- **Props:** De-structure props immediately in the function signature.

## Architecture
- **State Management:**
  - Local: `useState` / `useReducer`.
  - Global: Context API (for small apps) or Redux Toolkit/Zustand (for enterprise).
- **Custom Hooks:** Extract logic into custom hooks (`useAuth`, `useFetch`) to keep UI components "dumb".
- **Performance:** Memoize expensive calculations (`useMemo`) and callbacks (`useCallback`) strictly where needed.

## Security
- **XSS:** Do not use `dangerouslySetInnerHTML` unless sanitized by a library (e.g., DOMPurify).
- **URLs:** Validate and sanitize all `href` and `src` attributes.

## 🛑 What Not To Do
- Do not manipulate the DOM directly (no `document.getElementById`). Use Refs.
- Do not put API calls directly inside `useEffect`. Abstract them to a service layer.
- Do not prop-drill more than 2 layers. Use composition or Context.