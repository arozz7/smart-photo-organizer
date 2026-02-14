# Phase 63: VLM Hallucination Fix (Clothing/Hair)

## 🎯 Goal
Prevent the VLM from hallucinating a "Woman" when it only sees a "Dress" or "Long Hair", while ensuring valid "Hand on Face" poses are still accepted.

## 🛠️ The Logic
### "Clothing Requires Face Proof" rule in `vlm.py`
If the VLM description mentions:
- **Clothing:** `dress`, `shirt`, `jacket`, `hat`, `clothing`, `fabric`
- **Hair:** `hair`

Then it **MUST** also mention at least one **Face Part**:
- **Parts:** `eye`, `nose`, `mouth`, `lip`, `chin`, `cheek`, `forehead`, `face`
- **Actions:** `smile`, `look`, `gaze`

### Examples
| Description | Action | Why? |
| :--- | :--- | :--- |
| "A woman in a pink dress" | **REJECT** ❌ | Mentions "dress" but NO face parts. |
| "A woman with long hair" | **REJECT** ❌ | Mentions "hair" but NO face parts. |
| "A woman with hand on **chin**" | **KEEP** ✅ | Mentions "chin" (Face Part). |
| "A woman **looking** at camera" | **KEEP** ✅ | Mentions "looking" (Action implying eyes). |

## ⚠️ Notes
- This fix preserves faces that are partially obscured by hands, as long as the VLM can still describe the face action or parts.
