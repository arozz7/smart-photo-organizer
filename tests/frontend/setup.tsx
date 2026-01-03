/**
 * Frontend-specific test setup
 * Configures React Testing Library and mocks Electron IPC
 */

import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';

// Mock problematic ESM dependencies for jsdom
vi.mock('html-encoding-sniffer', () => ({
    default: vi.fn(),
    sniffer: vi.fn()
}));

// Define the Mock type for ipcRenderer
const listeners = new Map<string, Set<Function>>();

const mockIpcRenderer = {
    invoke: vi.fn(),
    on: vi.fn((channel, listener) => {
        if (!listeners.has(channel)) listeners.set(channel, new Set());
        listeners.get(channel)!.add(listener);
        return () => mockIpcRenderer.off(channel, listener);
    }),
    off: vi.fn((channel, listener) => {
        if (listeners.has(channel)) {
            listeners.get(channel)!.delete(listener);
        }
    }),
    send: vi.fn(),
    // Helper for tests to simulate events from Electron
    emit: (channel: string, ...args: any[]) => {
        if (listeners.has(channel)) {
            listeners.get(channel)!.forEach(l => l(...args));
        }
    }
};

// Expose the mock on window (as defined in vite-env.d.ts)
Object.defineProperty(window, 'ipcRenderer', {
    value: mockIpcRenderer,
    writable: true,
});

// Also keep electronAPI if some parts of the code use it
Object.defineProperty(window, 'electronAPI', {
    value: mockIpcRenderer,
    writable: true,
});

// Export for use in tests
export { mockIpcRenderer };

// Reset mocks before each test
beforeEach(() => {
    vi.clearAllMocks();
    mockIpcRenderer.invoke.mockReset();
    mockIpcRenderer.on.mockReset();
    mockIpcRenderer.off.mockReset();
    mockIpcRenderer.send.mockReset();
});
