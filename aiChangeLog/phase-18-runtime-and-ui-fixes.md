# Phase 18: AI Runtime & UI Fixes

## 📝 Summary
This phase focused on ensuring the AI Runtime can be reliably downloaded in environments with file size limits (GitHub Releases) by supporting multi-part zip files. It also polished the "Unmatched Faces" UI by adding a full-resolution image preview and fixing interaction issues caused by modal/z-index conflicts.

## 🏗️ Changes

### AI Runtime (Multi-Part Download)
- **Dynamic Discovery:** The Python backend now automatically scans for and downloads split archives (`.zip.001`, `.zip.002`...) if the single file is missing.
- **Auto-Concatenation:** Parts are seamlessly merged and extracted, making the split invisible to the user.
- **Versioning:** The download URL now dynamically targets the correct version tag (e.g., `v0.4.0`) to match the installation.
- **Override Support:** Users can still provide a custom URL via Settings for single-file overrides.

### Unmatched Faces UI
- **Original Photo Preview:** Added a button to view the full-size original photo of any face.
- **Z-Index Fixes:** Resolved an issue where the Photo Preview appeared behind the modal by moving the Preview to a **Portal** (`document.body`) with `z-index: 100`.
- **Interaction Fixes:** Fixed an issue where the Photo Preview "Close (X)" button was unclickable due to Radix UI's modal interaction lock. Added `pointer-events-auto` to the preview container.
- **Smart Escape:** The Unmatched Faces modal now ignores the `Escape` key if a photo is being previewed, preventing accidental closure of the parent modal.

### Refactoring
- **Layout Version:** Updated the sidebar version display to `v0.4.0`.

## 🧪 Verification
- Verified automatic download and assembly of 4-part runtime zip.
- Verified custom overrides still work.
- Verified Photo Preview opens above the modal and closes correctly without dismissing the modal.
- Verified all buttons in the preview are clickable.
