# Phase 64: Safety Net - Soft Delete for VLM

## 🎯 Goal
Prevent permanent data loss when the VLM incorrectly rejects a face (False Negative).

## 🛠️ The Fix
### "Soft Delete" vs "Hard Delete"
- **Before:** If VLM said "Not a Face", the record was permanently deleted from the database.
- **After:** If VLM says "Not a Face", the record is marked as **Ignored** (`is_ignored = 1`).

### What this means for you
1.  **Cleaner Gallery:** False positives (like the Hand) will still disappear from your main view.
2.  **Recovery:** If a valid face (like the Pink Dress) is accidentally rejected, you can go to **Settings > Ignored Faces** and restore it. It is no longer lost forever.
