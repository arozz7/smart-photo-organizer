import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';

const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
const showOpenDialog = vi.fn();
let savedConfig: Record<string, unknown> = {};
const updateSettings = vi.fn((partial: Record<string, unknown>) => { savedConfig = { ...savedConfig, ...partial }; });

vi.mock('electron', () => ({
    ipcMain: { handle: (channel: string, fn: (...args: any[]) => Promise<unknown>) => handlers.set(channel, fn) },
    dialog: { showOpenDialog: (...args: unknown[]) => showOpenDialog(...args) },
}));
vi.mock('../../../electron/scanQueue', () => ({ scanQueue: {} }));
vi.mock('../../../electron/logger', () => ({ default: { error: vi.fn(), info: vi.fn() } }));
vi.mock('../../../electron/core/services/ConfigService', () => ({
    ConfigService: {
        getSettings: () => savedConfig,
        updateSettings: (partial: Record<string, unknown>) => updateSettings(partial),
    },
}));

import { registerFileHandlers } from '../../../electron/ipc/fileHandlers';

// A folder that really exists on every machine, so the existence check passes without mocking fs.
const REAL_FOLDER = os.tmpdir();
const MISSING_FOLDER = path.join(os.tmpdir(), 'spo-folder-that-does-not-exist-9f3a');

beforeEach(() => {
    handlers.clear();
    showOpenDialog.mockReset();
    updateSettings.mockClear();
    savedConfig = {};
    registerFileHandlers();
});

describe('dialog:openDirectory remembers the last folder', () => {
    it('opens without a start folder the first time, then remembers the chosen folder', async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [REAL_FOLDER] });

        const picked = await handlers.get('dialog:openDirectory')!({});

        expect(picked).toBe(REAL_FOLDER);
        expect(showOpenDialog.mock.calls[0][0].defaultPath).toBeUndefined();
        expect(updateSettings).toHaveBeenCalledWith({ lastPickerFolders: { directory: REAL_FOLDER } });
    });

    it('opens in the remembered folder next time', async () => {
        savedConfig = { lastPickerFolders: { directory: REAL_FOLDER } };
        showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

        await handlers.get('dialog:openDirectory')!({});

        expect(showOpenDialog.mock.calls[0][0].defaultPath).toBe(REAL_FOLDER);
    });

    it('does not open in a remembered folder that no longer exists', async () => {
        savedConfig = { lastPickerFolders: { directory: MISSING_FOLDER } };
        showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

        await handlers.get('dialog:openDirectory')!({});

        expect(showOpenDialog.mock.calls[0][0].defaultPath).toBeUndefined();
    });

    it('returns null and remembers nothing when the user cancels', async () => {
        showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

        const picked = await handlers.get('dialog:openDirectory')!({});

        expect(picked).toBeNull();
        expect(updateSettings).not.toHaveBeenCalled();
    });

    it('keeps the other remembered folders when saving a new one', async () => {
        savedConfig = { lastPickerFolders: { file: 'C:\\Tools' } };
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [REAL_FOLDER] });

        await handlers.get('dialog:openDirectory')!({});

        expect(updateSettings).toHaveBeenCalledWith({ lastPickerFolders: { file: 'C:\\Tools', directory: REAL_FOLDER } });
    });
});

describe('dialog:openFile remembers the last folder', () => {
    it('remembers the folder that contains the chosen file', async () => {
        const file = path.join(REAL_FOLDER, 'cf-app.exe');
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [file] });

        const picked = await handlers.get('dialog:openFile')!({}, { filters: [{ name: 'Programs', extensions: ['exe'] }] });

        expect(picked).toBe(file);
        expect(updateSettings).toHaveBeenCalledWith({ lastPickerFolders: { file: REAL_FOLDER } });
        expect(showOpenDialog.mock.calls[0][0].filters).toEqual([{ name: 'Programs', extensions: ['exe'] }]);
    });

    it('opens in the remembered folder when the caller gives no start folder', async () => {
        savedConfig = { lastPickerFolders: { file: REAL_FOLDER } };
        showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

        await handlers.get('dialog:openFile')!({}, {});

        expect(showOpenDialog.mock.calls[0][0].defaultPath).toBe(REAL_FOLDER);
    });

    it('lets the caller choose the start folder', async () => {
        savedConfig = { lastPickerFolders: { file: REAL_FOLDER } };
        showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

        await handlers.get('dialog:openFile')!({}, { defaultPath: 'C:\\Explicit' });

        expect(showOpenDialog.mock.calls[0][0].defaultPath).toBe('C:\\Explicit');
    });
});
