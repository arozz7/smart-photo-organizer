import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHandle, service } = vi.hoisted(() => ({
    mockHandle: vi.fn(),
    service: { getStatus: vi.fn(), runNow: vi.fn(), setMode: vi.fn(), setAwayMinutes: vi.fn() },
}));

vi.mock('electron', () => ({ ipcMain: { handle: mockHandle } }));
vi.mock('../../../electron/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../electron/core/services/FaceVisibilityDeps', () => ({ getFaceVisibilityService: () => service }));

import { registerFaceVisibilityHandlers } from '../../../electron/ipc/faceVisibilityHandlers';

type Handler = (event: unknown, payload?: unknown) => Promise<{ success: boolean; error?: string } & Record<string, unknown>>;

function handler(channel: string): Handler {
    const entry = mockHandle.mock.calls.find(([name]: [string]) => name === channel);
    if (!entry) throw new Error(`Handler not registered for channel: ${channel}`);
    return entry[1] as Handler;
}

describe('faceVisibilityHandlers', () => {
    beforeEach(() => {
        mockHandle.mockClear();
        Object.values(service).forEach(fn => fn.mockReset());
        service.getStatus.mockReturnValue({ state: 'ready' });
        registerFaceVisibilityHandlers();
    });

    it('registers one channel per action', () => {
        expect(mockHandle.mock.calls.map(([name]: [string]) => name).sort()).toEqual([
            'visibility:getStatus', 'visibility:runNow', 'visibility:setAwayMinutes', 'visibility:setMode',
        ]);
    });

    it('returns the status', async () => {
        expect(await handler('visibility:getStatus')({})).toEqual({ success: true, status: { state: 'ready' } });
    });

    it('turns a thrown error into a failure instead of throwing', async () => {
        service.getStatus.mockImplementation(() => { throw new Error('db locked'); });

        const result = await handler('visibility:getStatus')({});

        expect(result.success).toBe(false);
        expect(result.error).toContain('db locked');
    });

    describe('runNow', () => {
        it('reports that a run started', async () => {
            service.runNow.mockReturnValue({ started: true });

            expect(await handler('visibility:runNow')({})).toMatchObject({ success: true, started: true, status: { state: 'ready' } });
        });

        it('reports why it did not start', async () => {
            service.runNow.mockReturnValue({ started: false, reason: 'busy' });

            expect(await handler('visibility:runNow')({})).toMatchObject({ success: false, started: false, reason: 'busy' });
        });
    });

    describe('setMode', () => {
        it.each(['off', 'away', 'always'])('accepts %s', async mode => {
            expect((await handler('visibility:setMode')({}, { mode })).success).toBe(true);
            expect(service.setMode).toHaveBeenCalledWith(mode);
        });

        it.each([[{ mode: 'sometimes' }], [{}], [{ mode: 1 }], [{ mode: 'away', extra: true }], [null]])('rejects %j without calling the service', async payload => {
            expect((await handler('visibility:setMode')({}, payload)).success).toBe(false);
            expect(service.setMode).not.toHaveBeenCalled();
        });
    });

    describe('setAwayMinutes', () => {
        it.each([1, 5, 60])('accepts %s minutes', async minutes => {
            expect((await handler('visibility:setAwayMinutes')({}, { minutes })).success).toBe(true);
            expect(service.setAwayMinutes).toHaveBeenCalledWith(minutes);
        });

        it.each([[{ minutes: 0 }], [{ minutes: 61 }], [{ minutes: 2.5 }], [{ minutes: '5' }], [{}], [{ minutes: 5, extra: 1 }]])('rejects %j without calling the service', async payload => {
            expect((await handler('visibility:setAwayMinutes')({}, payload)).success).toBe(false);
            expect(service.setAwayMinutes).not.toHaveBeenCalled();
        });
    });
});
