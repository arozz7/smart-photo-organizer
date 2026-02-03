# Phase 56.9: VLM Hallucination Fixes (The "Knee" Saga)

## 🎯 Goal
Eliminate persistent false positive detections (e.g., knees, skin patches) that were being aggressively validated by the VLM even with high confidence settings.

## 🐛 The Issues
1. **Prompt Echoing:** The VLM often just repeated the prompt's instructions ("look for eyes") as its reasoning.
2. **Template-Parroting:** The VLM literal-copied placeholder text from the JSON template.
3. **Confidence Collapse:** The model learned to output `0.99999` confidence to bypass our safety checks.
4. **Substring Hallucination:** A description of "perfectly **clear**" was matching the anatomical keyword "**ear**".

## 🛠️ The Fixes
- **Adversarial Prompting:** Switched to a "Quality Control" persona that looks for false positives.
- **Strict Parsing:** `vlm.py` now specifically ignores JSON keys/coordinates for proof, requiring Natural Language descriptions only.
- **Regex Word Boundaries:** Implemented `\bword\b` matching to stop "clear" -> "ear" mismatches.
- **Vocabulary Expansion:** Added generic subject terms (girl, boy, person, man, woman) to allow valid high-level descriptions to pass.
- **Removed Confidence Bypass:** Removed the logic that allowed >99.8% confidence to skip anatomical checks.

## 📊 Result
- **False Positives:** The persistent "knee" box in Photo 49 is correctly rejected.
- **True Positives:** Valid faces (even difficult ones like "sleeping girl") are correctly preserved.
