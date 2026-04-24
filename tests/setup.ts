/**
 * Global test setup file
 * Runs before all tests
 */

import { vi, beforeEach, afterEach } from 'vitest';

// Extend expect with jest-dom matchers (for frontend tests)
import '@testing-library/jest-dom';

// Mock the 'electron' module so service static initializers (e.g. ConfigService.configPath)
// that call app.getPath() don't crash in the vitest (non-Electron) environment.
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => '/tmp/test-user-data'),
        getVersion: vi.fn(() => '0.0.0-test'),
        isReady: vi.fn(() => true),
        on: vi.fn(),
        whenReady: vi.fn(() => Promise.resolve()),
    },
    BrowserWindow: vi.fn().mockImplementation(() => ({
        loadURL: vi.fn(),
        loadFile: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        webContents: { send: vi.fn(), on: vi.fn() },
        show: vi.fn(),
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
    })),
    ipcMain: {
        handle: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        removeHandler: vi.fn(),
        removeAllListeners: vi.fn(),
    },
    ipcRenderer: {
        invoke: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        removeAllListeners: vi.fn(),
        send: vi.fn(),
    },
    dialog: {
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
        showMessageBox: vi.fn(),
    },
    shell: {
        openPath: vi.fn(),
        showItemInFolder: vi.fn(),
    },
    nativeImage: {
        createEmpty: vi.fn(() => ({})),
        createFromPath: vi.fn(() => ({})),
    },
}));

// Mock problematic ESM dependencies for jsdom
vi.mock('html-encoding-sniffer', () => ({
    default: vi.fn(),
    sniffer: vi.fn()
}));

// Reset any mocks between tests
beforeEach(() => {
    vi.clearAllMocks();
});

// Cleanup after each test
afterEach(() => {
    vi.restoreAllMocks();
});
