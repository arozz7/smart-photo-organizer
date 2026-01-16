# Phase 41: Scroll Persistence

## Diff Narrative
### Modified
- `src/context/PeopleContext.tsx`: Added `peopleScrollPosition` state and setter.
- `src/views/People.tsx`: Implemented scroll position saving on navigation and restoration on mount for 'Identified People' tab.

## Behavior Changes
- Navigation from "Identified People" to a person's detail page and back now preserves the user's vertical scroll position, improving usability for large lists.

## Tests Added
- None (UI behavior verification performed manually).
