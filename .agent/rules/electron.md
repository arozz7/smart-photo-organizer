---
trigger: glob
---

# Electron Framework Standards
(Activation: Glob `**/electron/**/*`, `**/*.main.ts`)

## Security (CRITICAL)
- **Context Isolation:** MUST be `true`.
- **Node Integration:** MUST be `false` in Renderers.
- **Sandboxing:** Enable `sandbox: true` for all windows.
- **IPC:** Use `ipcMain.handle` and `ipcRenderer.invoke` for communication. Validate all IPC payloads.

## Architecture
- **Process Separation:**
  - **Main Process:** Handles OS interactions, file system, and window management.
  - **Renderer Process:** Handles UI only. Logic should be minimal.
- **Preload Scripts:** Use `contextBridge` to expose specific, limited APIs to the renderer. Never expose the full `ipcRenderer` object.

## Development Loop
- Ensure graceful handling of window closures and app-quit events.
- Handle "crashes" and "unresponsive" events in the Main process.

## 🛑 What Not To Do
- Do not use `remote` module (it is deprecated and insecure).
- Do not execute arbitrary code sent from the Renderer in the Main process.
- Do not load remote content (websites) with `nodeIntegration` enabled.

## Code Organization & Size Limits
- **Soft Limit:** 300 lines.
- **Hard Limit:** 600 lines.
- **Action:** If a file exceeds the hard limit during editing, you MUST stop and suggest a refactor using `@RefactoringProtocol`.
- **Single Responsibility:** Each file should export one main component/class or a cohesive set of utilities.