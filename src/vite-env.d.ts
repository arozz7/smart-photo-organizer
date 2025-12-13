/// <reference types="vite/client" />

interface IpcRenderer {
    on(channel: string, listener: (...args: any[]) => void): () => void
    off(channel: string, ...args: any[]): void
    send(channel: string, ...args: any[]): void
    invoke(channel: string, ...args: any[]): Promise<any>
}

declare global {
    interface Window {
        ipcRenderer: IpcRenderer
    }
}
