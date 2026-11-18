import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
    ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn) },
    shell: {},
    app: { getVersion: () => '9.8.7' },
}));
vi.mock('../../../electron/logger', () => ({ default: { getLogPath: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { registerAppHandlers } from '../../../electron/ipc/appHandlers';

beforeEach(() => {
    handlers.clear();
    registerAppHandlers(() => null);
});

describe('app:getVersion', () => {
    it('returns the version of the running app', () => {
        expect(handlers.get('app:getVersion')!()).toBe('9.8.7');
    });
});
