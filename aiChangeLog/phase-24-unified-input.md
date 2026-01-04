# Phase 24: Unified Person Name Input (Phase 6 of Smart Ignore)

**Goal:** Standardize the person naming experience across the application with a reusable, AI-powered component that supports keyboard navigation and smart suggestions.

## Changes
- **Core Component:** Created `PersonNameInput` component with:
    - AI Suggestions (using direct `matchBatch` against input descriptors).
    - Autocomplete for existing people (sorted by frequency).
    - Keyboard navigation (Arrow keys, Enter).
    - Loading states (Spinner).
- **Integration:** Replaced ad-hoc inputs in:
    - `PhotoDetail` (Face assignment).
    - `AllFacesModal` (Review/Reassign).
    - `PersonDetail` (Reassign flow).
- **Bug Fixes:** 
    - Fixed infinite loop in AI suggestion logic.
    - Fixed TTA (rotational) face quality calculation in Python backend.
    - Fixed `face_quality` persisting as `null` for rotated faces.

## Technical Details
- **Architecture:** Leveraged `usePeople()` context for centralized matching logic.
- **Python Backend:** Updated `main.py` to calculate `face_quality` within the TTA loop, ensuring rotated faces get quality scores.

## Migration
- No database changes required for this phase.
