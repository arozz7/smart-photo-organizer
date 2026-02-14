# Electron Standards

## Security Model
- `contextIsolation: true` — always, no exceptions
- `nodeIntegration: false` — in all renderer processes
- `sandbox: true` — enforce sandboxing
- Never use `remote` module
- Never load remote/untrusted content in BrowserWindow
- Never execute arbitrary code from renderer

## IPC Communication
- Use `ipcMain.handle` + `ipcRenderer.invoke` (request/response pattern)
- All IPC goes through `preload.ts` with `contextBridge.exposeInMainWorld`
- Validate all IPC payloads in the main process before processing
- Keep preload scripts minimal — only expose necessary APIs

## Process Separation
- **Main process:** File system access, database, native APIs, Python bridge
- **Renderer process:** UI only, no direct Node.js access
- Business logic lives in `electron/core/services/`, not in IPC handlers
- IPC handlers in `electron/ipc/` are thin — validate input, delegate to services, return result
