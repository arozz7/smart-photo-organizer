---
trigger: model_decision
description: When user asks to split/refactor files or file size > 600 lines
---

## 🛑 STOP: The Golden Rule of Refactoring
**NEVER** attempt to split a large file in a single pass.
**NEVER** modify the original file until the new destination file is created and verified.

## Phase 1: The Architect (Planning)
Before writing code, analyze the target file.
1. **Identify Boundaries:** specific classes, helpers, types, or sub-components.
2. **Map Dependencies:** List what imports each component needs.
3. **Check Risks:** Explicitly check for **Circular Dependencies** (e.g., File A needs B, B needs A).
   - *Strategy:* If circular dependency risk exists, plan a `types.ts` or `shared.ts` first.
4. **Output:** A bulleted plan proposing the new file structure. **Wait for approval.**

## Phase 2: The Mover (Iterative Execution)
Execute the plan **one chunk at a time**.
For each extraction:
1. **Create Backup:** Create a backup of the original file(s)
2. **Create Destination:** Write the new file with all necessary imports.
3. **Export:** Ensure the function/class is exported.
4. **Verify:** Confirm the new file compiles/looks correct.
5. **Update Original:** ONLY change the original file to import the new module.
   - *Constraint:* Do not change logic, only location.

## Phase 3: The Cleanup & Test
Once all chunks are moved:
1. **Prune:** Remove the now-dead code from the original file.
2. **Optimize:** Remove unused imports.
3. **Test:** Update any test files that referenced the moved components.
4. **Cleanup:** Once testing is confirmed remove the backup file(s) created.

## Triggering the Process
If a file exceeds **400 lines** (soft limit) or **600 lines** (hard limit), automatically propose this protocol during the "Implementation Plan" phase of the Core Workflow.