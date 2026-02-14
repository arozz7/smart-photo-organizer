# React Component Standards

## Components
- 100% functional components + hooks — no class components
- PascalCase for components, camelCase for hooks and functions
- Destructure props in function signature
- Max 2 levels of prop drilling — beyond that, use Context or state management
- No direct DOM manipulation — use refs when needed
- No `dangerouslySetInnerHTML` without sanitization

## State Management
- `useState` / `useReducer` for local state
- Context API or Zustand for global/shared state
- Extract reusable logic into custom hooks

## Performance
- `useMemo` and `useCallback` where measurably needed, not preemptively
- API calls abstracted to service layer — not directly in `useEffect`

## Patterns
- Keep components focused on rendering — extract logic to hooks or utilities
- Validate and sanitize URLs before rendering links or images
