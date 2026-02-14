# Phase 63.5: VLM Generic Hallucination Fix

## 🎯 Goal
Fix the regression where valid faces (e.g., "Woman in Pink Dress") were rejected because the VLM didn't mention specific face parts. Simultaneously, filter out "Hand" boxes where the VLM hallucinates a generic "human face".

## 🛠️ The Fix
### 1. Reverted Strict Clothing Rule
- **Previous Rule:** "If clothing is mentioned, also must see face parts."
- **Problem:** Rejected valid faces where VLM focused on clothing (e.g. "Woman in pink dress").
- **Fix:** Removed this rule. "Pink dress" is now accepted evidence.

### 2. Implemented "Generic Description Filter"
- **New Rule:** If the VLM description is extremely generic (HALLUCINATION MARKER), reject it unless it has Specific Details.
- **Generic Phrases (BANNED):**
    - "human face"
    - "face is visible"
    - "the object is a face"
    - "person's face"
- **Details (ALLOWED):**
    - Colors: "Pink", "Red", "Blue", etc.
    - Clothing/Hair: "Dress", "Shirt", "Hair"
    - Facial Parts: "Eyes", "Look", "Smile"

### Examples
| Description | Action | Why? |
| :--- | :--- | :--- |
| "A woman with long **hair** and **pink** dress" | **KEEP** ✅ | Has Details ("Hair", "Pink"). |
| "The woman's **face is visible**" | **REJECT** ❌ | Generic Hallucination (No details). |
| "A **human face**" | **REJECT** ❌ | Generic Hallucination. |
