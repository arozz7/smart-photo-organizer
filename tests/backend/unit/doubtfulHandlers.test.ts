import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHandle, service } = vi.hoisted(() => ({
    mockHandle: vi.fn(),
    service: {
        getOverview: vi.fn(), setMinScore: vi.fn(), list: vi.fn(), ignore: vi.fn(), unassign: vi.fn(), keep: vi.fn(), undo: vi.fn(),
    },
}));

vi.mock('electron', () => ({ ipcMain: { handle: mockHandle } }));
vi.mock('../../../electron/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../electron/core/services/DoubtfulFaceDeps', () => ({ getDoubtfulFaceService: () => service }));

import { registerDoubtfulHandlers } from '../../../electron/ipc/doubtfulHandlers';

type Handler = (event: unknown, payload?: unknown) => Promise<{ success: boolean; error?: string } & Record<string, unknown>>;

function handler(channel: string): Handler {
    const entry = mockHandle.mock.calls.find(([name]: [string]) => name === channel);
    if (!entry) throw new Error(`Handler not registered for channel: ${channel}`);
    return entry[1] as Handler;
}

describe('doubtfulHandlers', () => {
    beforeEach(() => {
        mockHandle.mockClear();
        Object.values(service).forEach(fn => fn.mockReset());
        service.getOverview.mockReturnValue({ minScore: 3 });
        registerDoubtfulHandlers();
    });

    it('registers one channel per action', () => {
        expect(mockHandle.mock.calls.map(([name]: [string]) => name).sort()).toEqual([
            'doubtful:getOverview', 'doubtful:ignore', 'doubtful:keep', 'doubtful:list', 'doubtful:setMinScore', 'doubtful:unassign', 'doubtful:undo',
        ]);
    });

    it('returns the overview, and turns a thrown error into a failure instead of throwing', async () => {
        expect(await handler('doubtful:getOverview')({})).toEqual({ success: true, overview: { minScore: 3 } });

        service.getOverview.mockImplementation(() => { throw new Error('db locked'); });
        const failed = await handler('doubtful:getOverview')({});
        expect(failed.success).toBe(false);
        expect(failed.error).toContain('db locked');
    });

    describe('setMinScore', () => {
        it('saves a valid cut-off and returns the new overview', async () => {
            service.setMinScore.mockReturnValue(true);

            expect(await handler('doubtful:setMinScore')({}, { score: 4 })).toEqual({ success: true, overview: { minScore: 3 } });
            expect(service.setMinScore).toHaveBeenCalledWith(4);
        });

        it('refuses anything that is not a whole number in range, without calling the service', async () => {
            for (const payload of [{ score: 9 }, { score: 2.5 }, { score: '3' }, { score: 3, extra: 1 }, null]) {
                expect((await handler('doubtful:setMinScore')({}, payload)).success).toBe(false);
            }
            expect(service.setMinScore).not.toHaveBeenCalled();
        });
    });

    describe('list', () => {
        it('passes the page and the person (all people when none is given)', async () => {
            service.list.mockReturnValue([{ faceId: 1 }]);

            expect(await handler('doubtful:list')({}, { offset: 0, limit: 50, personId: 7 })).toEqual({ success: true, faces: [{ faceId: 1 }] });
            await handler('doubtful:list')({}, { offset: 50, limit: 50 });

            expect(service.list).toHaveBeenNthCalledWith(1, 0, 50, 7);
            expect(service.list).toHaveBeenNthCalledWith(2, 50, 50, null);
        });

        it('refuses a negative offset or a page that is too large', async () => {
            expect((await handler('doubtful:list')({}, { offset: -1, limit: 50 })).success).toBe(false);
            expect((await handler('doubtful:list')({}, { offset: 0, limit: 5000 })).success).toBe(false);
        });
    });

    describe('the actions on faces', () => {
        it.each([
            ['doubtful:ignore', 'ignore', { changedIds: [1, 2] }],
            ['doubtful:unassign', 'unassign', { changedIds: [1, 2] }],
            ['doubtful:keep', 'keep', { kept: 2 }],
            ['doubtful:undo', 'undo', { restoredIds: [1, 2] }],
        ] as const)('%s passes the ids to the service and returns its answer', async (channel, method, answer) => {
            service[method].mockResolvedValue(answer);

            expect(await handler(channel)({}, { faceIds: [1, 2] })).toEqual({ success: true, ...answer });
            expect(service[method]).toHaveBeenCalledWith([1, 2]);
        });

        it.each(['doubtful:ignore', 'doubtful:unassign', 'doubtful:keep', 'doubtful:undo'])('%s refuses ids that are not positive whole numbers', async channel => {
            expect((await handler(channel)({}, { faceIds: [1, -2] })).success).toBe(false);
            expect((await handler(channel)({}, { faceIds: 'all' })).success).toBe(false);
            expect((await handler(channel)({}, undefined)).success).toBe(false);
        });
    });
});
