import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHandle, service } = vi.hoisted(() => ({
    mockHandle: vi.fn(),
    service: { getStatus: vi.fn(), runNow: vi.fn(), setMode: vi.fn(), setAwayMinutes: vi.fn() },
}));

vi.mock('electron', () => ({ ipcMain: { handle: mockHandle } }));
vi.mock('../../../electron/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../electron/core/services/AssignedVisibilityDeps', () => ({ getAssignedVisibilityService: () => service }));
vi.mock('../../../electron/core/services/FaceVisibilityDeps', () => ({ getFaceVisibilityService: () => service }));

import { registerAssignedCheckHandlers } from '../../../electron/ipc/assignedCheckHandlers';

type Handler = (event: unknown, payload?: unknown) => Promise<{ success: boolean } & Record<string, unknown>>;

function handler(channel: string): Handler {
    const entry = mockHandle.mock.calls.find(([name]: [string]) => name === channel);
    if (!entry) throw new Error(`Handler not registered for channel: ${channel}`);
    return entry[1] as Handler;
}

describe('assignedCheckHandlers', () => {
    beforeEach(() => {
        mockHandle.mockClear();
        Object.values(service).forEach(fn => fn.mockReset());
        service.getStatus.mockReturnValue({ state: 'ready' });
        registerAssignedCheckHandlers();
    });

    it('registers the card channels under the assignedcheck prefix', () => {
        expect(mockHandle.mock.calls.map(([name]: [string]) => name).sort()).toEqual([
            'assignedcheck:getStatus', 'assignedcheck:runNow', 'assignedcheck:setAwayMinutes', 'assignedcheck:setMode',
        ]);
    });

    it('answers with the status of the assigned-face check, and starts it on "run now"', async () => {
        service.runNow.mockReturnValue({ started: true });

        expect(await handler('assignedcheck:getStatus')({})).toEqual({ success: true, status: { state: 'ready' } });
        expect(await handler('assignedcheck:runNow')({})).toMatchObject({ success: true, started: true });
    });

    it('refuses a run mode that does not exist', async () => {
        expect((await handler('assignedcheck:setMode')({}, { mode: 'sometimes' })).success).toBe(false);
        expect(service.setMode).not.toHaveBeenCalled();
    });
});
