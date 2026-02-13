# Python Standards

## Style
- PEP 8 compliance
- Type hints on all function signatures and class attributes
- Google-style docstrings for public modules, classes, and functions
- `pathlib.Path` instead of `os.path` string manipulation
- `logging` module, not `print()` for diagnostics
- No mutable default arguments, no wildcard imports

## Data Validation
- Pydantic for data validation and settings management
- Custom exception classes over generic `Exception`

## Security
- Parameterized queries for all SQL — no string interpolation
- Never use `shell=True` in subprocess calls
- Validate and sanitize all external inputs

## Project-Specific
- Face detection pipeline: `facelib/` (NMS, utils, VLM processing)
- Config management: `config.py`
- Entry point: `main.py` (Flask-based command server for Electron IPC)
- Virtual environment: `.venv/` (Python 3.12)
