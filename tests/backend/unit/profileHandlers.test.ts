import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHandle, service } = vi.hoisted(() => ({
    mockHandle: vi.fn(),
    service: {
        getOverview: vi.fn(),
        refresh: vi.fn(),
        setDistance: vi.fn(),
        setMinYaw: vi.fn(),
        list: vi.fn(),
        assign: vi.fn(),
        dismiss: vi.fn(),
        undo: vi.fn(),
    },
}));

vi.mock('electron', () => ({ ipcMain: { handle: mockHandle } }));
vi.mock('../../../electron/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../electron/core/services/ProfileMatchDeps', () => ({ getProfileMatchService: () => service }));

import { registerProfileHandlers } from '../../../electron/ipc/profileHandlers';
import { MAX_PAGE_SIZE, MAX_PAIRS_PER_ACTION } from '../../../electron/core/services/ProfileMatchService';

type Handler = (event: unknown, payload?: unknown) => Promise<{ success: boolean; error?: string } & Record<string, unknown>>;

function handler(channel: string): Handler {
    const entry = mockHandle.mock.calls.find(([name]: [string]) => name === channel);
    if (!entry) throw new Error(`Handler not registered for channel: ${channel}`);
    return entry[1] as Handler;
}

describe('profileHandlers', () => {
    beforeEach(() => {
        mockHandle.mockClear();
        Object.values(service).forEach(fn => fn.mockReset());
        registerProfileHandlers();
    });

    it('registers one channel per action', () => {
        expect(mockHandle.mock.calls.map(([name]: [string]) => name).sort()).toEqual([
            'profile:assign', 'profile:dismiss', 'profile:getOverview', 'profile:list', 'profile:refresh', 'profile:setDistance', 'profile:setMinYaw', 'profile:undo',
        ]);
    });

    it('returns the overview, and a failure instead of a throw', async () => {
        service.getOverview.mockReturnValueOnce({ state: 'ready' });
        expect(await handler('profile:getOverview')({})).toEqual({ success: true, overview: { state: 'ready' } });

        service.getOverview.mockImplementation(() => { throw new Error('db locked'); });
        const failed = await handler('profile:getOverview')({});
        expect(failed.success).toBe(false);
        expect(failed.error).toContain('db locked');
    });

    it('refresh searches again and returns the overview', async () => {
        service.getOverview.mockReturnValue({ state: 'computing' });

        expect(await handler('profile:refresh')({})).toEqual({ success: true, overview: { state: 'computing' } });
        expect(service.refresh).toHaveBeenCalledTimes(1);
    });

    describe('settings', () => {
        it('saves the distance and returns the new overview', async () => {
            service.setDistance.mockReturnValue(true);
            service.getOverview.mockReturnValue({ settings: { distance: 0.9 } });

            expect(await handler('profile:setDistance')({}, { distance: 0.9 })).toEqual({ success: true, overview: { settings: { distance: 0.9 } } });
            expect(service.setDistance).toHaveBeenCalledWith(0.9);
        });

        it('explains a distance the service refuses', async () => {
            service.setDistance.mockReturnValue(false);

            const result = await handler('profile:setDistance')({}, { distance: 5 });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/between 0\.8 and 1\.1/);
        });

        it('saves the turned-from angle, and explains one the service refuses', async () => {
            service.setMinYaw.mockReturnValueOnce(true).mockReturnValueOnce(false);
            service.getOverview.mockReturnValue({});

            expect((await handler('profile:setMinYaw')({}, { degrees: 50 })).success).toBe(true);
            const refused = await handler('profile:setMinYaw')({}, { degrees: 10 });
            expect(refused.success).toBe(false);
            expect(refused.error).toMatch(/between 40 and 70/);
        });

        it('rejects a payload that is not what the channel expects', async () => {
            expect((await handler('profile:setDistance')({}, { distance: '0.9' })).success).toBe(false);
            expect((await handler('profile:setDistance')({}, { distance: 0.9, extra: 1 })).success).toBe(false);
            expect((await handler('profile:setMinYaw')({}, undefined)).success).toBe(false);
            expect(service.setDistance).not.toHaveBeenCalled();
        });
    });

    describe('list', () => {
        it('passes the page, and the person when the page is for one', async () => {
            service.list.mockReturnValue([{ faceId: 1 }]);

            expect(await handler('profile:list')({}, { offset: 0, limit: 50 })).toEqual({ success: true, rows: [{ faceId: 1 }] });
            await handler('profile:list')({}, { offset: 10, limit: 50, personId: 7 });

            expect(service.list).toHaveBeenNthCalledWith(1, 0, 50, undefined);
            expect(service.list).toHaveBeenNthCalledWith(2, 10, 50, 7);
        });

        it('rejects a negative offset, a page that is too big, and a bad person', async () => {
            expect((await handler('profile:list')({}, { offset: -1, limit: 10 })).success).toBe(false);
            expect((await handler('profile:list')({}, { offset: 0, limit: MAX_PAGE_SIZE + 1 })).success).toBe(false);
            expect((await handler('profile:list')({}, { offset: 0, limit: 10, personId: 0 })).success).toBe(false);
            expect(service.list).not.toHaveBeenCalled();
        });
    });

    describe('assign and dismiss', () => {
        it('assign passes face and person pairs and returns what was assigned', async () => {
            service.assign.mockResolvedValue({ assigned: [{ faceId: 1, personId: 10 }], skipped: 0 });

            const result = await handler('profile:assign')({}, { pairs: [{ faceId: 1, personId: 10 }] });

            expect(result).toEqual({ success: true, assigned: [{ faceId: 1, personId: 10 }], skipped: 0 });
            expect(service.assign).toHaveBeenCalledWith([{ faceId: 1, personId: 10 }]);
        });

        it('dismiss passes the pairs', async () => {
            service.dismiss.mockResolvedValue({ dismissed: 1, skipped: 0 });

            expect(await handler('profile:dismiss')({}, { pairs: [{ faceId: 1, personId: 10 }] })).toEqual({ success: true, dismissed: 1, skipped: 0 });
        });

        it('rejects too many pairs, bad ids and unknown fields', async () => {
            const tooMany = Array.from({ length: MAX_PAIRS_PER_ACTION + 1 }, (_, i) => ({ faceId: i + 1, personId: 1 }));

            expect((await handler('profile:assign')({}, { pairs: tooMany })).success).toBe(false);
            expect((await handler('profile:assign')({}, { pairs: [{ faceId: 0, personId: 1 }] })).success).toBe(false);
            expect((await handler('profile:assign')({}, { pairs: [{ faceId: 1, personId: 1, distance: 0 }] })).success).toBe(false);
            expect((await handler('profile:dismiss')({}, { pairs: [{ faceId: 1 }] })).success).toBe(false);
            expect(service.assign).not.toHaveBeenCalled();
            expect(service.dismiss).not.toHaveBeenCalled();
        });

        it('turns a thrown error into a failure', async () => {
            service.assign.mockRejectedValue(new Error('locked'));

            const result = await handler('profile:assign')({}, { pairs: [{ faceId: 1, personId: 10 }] });

            expect(result.success).toBe(false);
            expect(result.error).toContain('locked');
        });
    });

    describe('undo', () => {
        it('returns what was restored', async () => {
            service.undo.mockResolvedValue({ restored: [{ faceId: 1, personId: 10 }] });

            expect(await handler('profile:undo')({}, { faceIds: [1] })).toEqual({ success: true, restored: [{ faceId: 1, personId: 10 }] });
        });

        it('rejects bad ids', async () => {
            expect((await handler('profile:undo')({}, { faceIds: [0] })).success).toBe(false);
            expect(service.undo).not.toHaveBeenCalled();
        });
    });
});
