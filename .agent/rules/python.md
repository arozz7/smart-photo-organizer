---
trigger: glob
---

# Python Standards
(Activation: Glob `**/*.py`)

## Code Style
- **PEP 8:** Adhere strictly to PEP 8 formatting.
- **Type Hinting:** MANDATORY. All function signatures and class attributes must have type hints (`typing` module or modern syntax).
- **Docstrings:** Use Google-style docstrings for all public modules, classes, and functions.

## Architecture
- **Data Models:** Use `Pydantic` for data validation and settings management.
- **Paths:** Use `pathlib.Path` instead of `os.path` strings.
- **Exceptions:** Define custom exception classes for domain errors. Do not catch generic `Exception` without re-raising or strict logging.

## Security
- **SQL Injection:** Never format strings into SQL queries. Use parameterized queries (SQLAlchemy/ORMs).
- **Subprocesses:** Avoid `shell=True` in `subprocess` calls.

## 🛑 What Not To Do
- Do not use mutable default arguments (e.g., `def func(list=[])`).
- Do not use `from module import *` (wildcard imports).
- Do not print to stdout in production code. Use the `logging` module.


## Code Organization & Size Limits
- **Soft Limit:** 300 lines.
- **Hard Limit:** 600 lines.
- **Action:** If a file exceeds the hard limit during editing, you MUST stop and suggest a refactor using `@RefactoringProtocol`.
- **Single Responsibility:** Each file should export one main component/class or a cohesive set of utilities.