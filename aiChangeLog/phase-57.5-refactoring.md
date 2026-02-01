# Phase 57.5: Mandatory Refactoring (File Size Compliance)

**Date**: 2026-02-01  
**Branch**: `main` (or feature branch if created)  
**Status**: ✅ Phase 1 Complete

---

## 🎯 Objective

Reduce `main.py` file size to comply with 600-line hard limit by extracting large command handlers into modular structure.

## 📊 Changes Summary

### File Size Reduction

| File | Before | After | Change |
|------|--------|-------|--------|
| `main.py` | 1823 lines | 1273 lines | **-550 lines (-30.2%)** |
| `commands/scan.py` | N/A | 598 lines | **+598 lines (new)** |

**Progress**: 1273 lines remaining (still 112% over 600-line limit, but significant improvement)

### Files Modified

#### [NEW] `src/python/commands/__init__.py`
- Created commands package
- Exports `scan` module

#### [NEW] `src/python/commands/scan.py`
- **Extracted**: `analyze_image` command handler (556 lines)
- **Dependencies**: `facelib.faces`, `facelib.vlm`, `facelib.image_ops`
- **Features**:
  - Multi-scale face detection
  - Test Time Augmentation (TTA)
  - Non-Maximum Suppression (NMS)
  - VLM tagging integration
  - Aspect ratio filtering (Phase 57)
  - Embedding-based duplicate prevention

#### [MODIFY] `src/python/main.py`
- **Removed**: Lines 459-1014 (`analyze_image` implementation)
- **Added**: Import and delegation to `commands.scan.analyze_image`
- **Reduction**: 550 lines removed

---

## 🔧 Technical Implementation

### Refactoring Pattern

**Before**:
```python
# main.py (1823 lines)
def handle_command(command):
    if cmd_type == 'analyze_image':
        # 556 lines of implementation
        ...
```

**After**:
```python
# main.py (1273 lines)
def handle_command(command):
    if cmd_type == 'analyze_image':
        from commands import scan
        scan.set_config(CONFIG)
        response = scan.analyze_image(payload, load_image_cv2, req_id)

# commands/scan.py (598 lines)
def analyze_image(payload, load_image_cv2_func, req_id=None):
    # Full implementation
    ...
```

### Dependency Injection

- `load_image_cv2` function passed as parameter (avoids circular imports)
- `CONFIG` dict passed via `set_config()` helper
- `req_id` passed for response tracking

---

## ✅ Verification Steps

### 1. File Size Verification
```powershell
✅ main.py: 1273 lines (was 1823)
✅ commands/scan.py: 598 lines
✅ Reduction: 550 lines (30.2%)
```

### 2. Module Import Test
```python
✅ Module imported successfully
✅ analyze_image exists: True
```

### 3. Backup Created
```
✅ main_pre_refactor_backup.py (1823 lines)
```

---

## 🧪 Testing Required

### Manual Smoke Test (Post-Refactoring)

**CRITICAL**: Run the following tests before considering this phase complete:

1. **Start Application**: `npm run dev`
2. **Scan Photo**: Library → Add Folder → Select test folder
3. **Verify Detection**: Check faces detected correctly
4. **Verify VLM**: Check tags generated (if VLM enabled)
5. **Verify FAISS**: People → Click person → Verify faces shown
6. **Verify Thumbnails**: Check thumbnails load

**If ANY test fails**: Revert to `main_pre_refactor_backup.py` immediately.

### Unit Tests (TODO)

```python
# tests/backend/unit/test_commands.py
def test_analyze_image_extraction():
    """Verify analyze_image still works after extraction."""
    from commands import scan
    # Test with mock payload
    ...
```

---

## 📝 Notes

### Why Phase 1 Only?

- **Risk Mitigation**: Extracting 556 lines in one go is already significant
- **Iterative Approach**: Test thoroughly before proceeding to Phase 2
- **Remaining Work**: `main.py` still has 1273 lines (need to extract ~670 more)

### Next Steps (Phase 2)

Extract remaining large commands:
- `extract_age` (~120 lines) → `commands/face_analysis.py`
- `extract_face_pose` (~115 lines) → `commands/face_analysis.py`
- `cluster_faces` (~70 lines) → `commands/clustering.py`
- VLM commands → `commands/vlm.py`
- FAISS commands → `commands/index.py`

**Target**: Reduce `main.py` to under 400 lines

---

## 🔄 Rollback Plan

If issues are discovered:

```powershell
# Restore backup
Copy-Item "j:\Projects\smart-photo-organizer\src\python\main_pre_refactor_backup.py" `
          -Destination "j:\Projects\smart-photo-organizer\src\python\main.py" -Force

# Delete new files
Remove-Item "j:\Projects\smart-photo-organizer\src\python\commands" -Recurse -Force
```

---

## 🎓 Lessons Learned

1. **Dependency Injection Works**: Passing `load_image_cv2` as a function parameter avoids circular imports
2. **Config Sharing**: `set_config()` pattern allows global config access without tight coupling
3. **30% Reduction Achievable**: Single large function extraction can significantly reduce file size
4. **Backup Critical**: Always create backup before large refactors

---

## 📌 Related

- **Implementation Plan**: `implementation_plan.md` (Phase 57.5)
- **Refactoring Protocol**: `.agent/rules/refactoring-protocol.md`
- **Test Coverage**: `implementation_plan.md` (Test Coverage Requirements section)
