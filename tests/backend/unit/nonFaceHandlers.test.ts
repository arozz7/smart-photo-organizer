import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHandle, service } = vi.hoisted(() => ({
    mockHandle: vi.fn(),
    service: {
        getOverview: vi.fn(),
        setCutoff: vi.fn(),
        setMode: vi.fn(),
        setMinLikelihood: vi.fn(),
        list: vi.fn(),
        ignore: vi.fn(),
        keep: vi.fn(),
        undo: vi.fn(),
    },
}));

vi.mock('electron', () => ({ ipcMain: { handle: mockHandle } }));
vi.mock('../../../electron/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../electron/core/services/NonFaceDeps', () => ({ getNonFaceService: () => service }));

import { registerNonFaceHandlers } from '../../../electron/ipc/nonFaceHandlers';
import { MAX_IDS_PER_ACTION } from '../../../electron/core/services/NonFaceSuggestionService';

type Handler = (event: unknown, payload?: unknown) => Promise<{ success: boolean; error?: string } & Record<string, unknown>>;

function handler(channel: string): Handler {
    const entry = mockHandle.mock.calls.find(([name]: [string]) => name === channel);
    if (!entry) throw new Error(`Handler not registered for channel: ${channel}`);
    return entry[1] as Handler;
}

describe('nonFaceHandlers', () => {
    beforeEach(() => {
        mockHandle.mockClear();
        Object.values(service).forEach(fn => fn.mockReset());
        registerNonFaceHandlers();
    });

    it('registers one channel per action', () => {
        expect(mockHandle.mock.calls.map(([name]: [string]) => name).sort()).toEqual([
            'nonface:getOverview', 'nonface:ignore', 'nonface:keep', 'nonface:list', 'nonface:setCutoff', 'nonface:setLikelihood', 'nonface:setMode', 'nonface:undo',
        ]);
    });

    it('returns the overview', async () => {
        service.getOverview.mockReturnValue({ cutoff: 0.55 });

        expect(await handler('nonface:getOverview')({})).toEqual({ success: true, overview: { cutoff: 0.55 } });
    });

    it('turns a thrown error into a failure instead of throwing', async () => {
        service.getOverview.mockImplementation(() => { throw new Error('db locked'); });

        const result = await handler('nonface:getOverview')({});

        expect(result.success).toBe(false);
        expect(result.error).toContain('db locked');
    });

    describe('setCutoff', () => {
        it('saves a valid cut-off and returns the new overview', async () => {
            service.setCutoff.mockReturnValue(true);
            service.getOverview.mockReturnValue({ cutoff: 0.6 });

            expect(await handler('nonface:setCutoff')({}, { cutoff: 0.6 })).toEqual({ success: true, overview: { cutoff: 0.6 } });
            expect(service.setCutoff).toHaveBeenCalledWith(0.6);
        });

        it('reports the allowed range when the service refuses the value', async () => {
            service.setCutoff.mockReturnValue(false);

            const result = await handler('nonface:setCutoff')({}, { cutoff: 5 });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/between/);
        });

        it.each([[{}], [{ cutoff: '0.5' }], [{ cutoff: null }], [{ cutoff: 0.5, extra: 1 }], [undefined]])('rejects %j without calling the service', async payload => {
            expect((await handler('nonface:setCutoff')({}, payload)).success).toBe(false);
            expect(service.setCutoff).not.toHaveBeenCalled();
        });
    });

    describe('setMode', () => {
        it.each(['detector', 'model'])('saves %s and returns the new overview', async mode => {
            service.getOverview.mockReturnValue({ mode });

            expect(await handler('nonface:setMode')({}, { mode })).toEqual({ success: true, overview: { mode } });
            expect(service.setMode).toHaveBeenCalledWith(mode);
        });

        it.each([[{ mode: 'ranked' }], [{}], [{ mode: 1 }], [{ mode: 'model', extra: 1 }], [null]])('rejects %j without calling the service', async payload => {
            expect((await handler('nonface:setMode')({}, payload)).success).toBe(false);
            expect(service.setMode).not.toHaveBeenCalled();
        });
    });

    describe('setLikelihood', () => {
        it.each([50, 70, 95])('saves %s percent and returns the new overview', async percent => {
            service.getOverview.mockReturnValue({ ok: true });

            expect(await handler('nonface:setLikelihood')({}, { percent })).toEqual({ success: true, overview: { ok: true } });
            expect(service.setMinLikelihood).toHaveBeenCalledWith(percent);
        });

        it.each([[{ percent: 49 }], [{ percent: 96 }], [{ percent: 70.5 }], [{ percent: '70' }], [{}], [{ percent: 70, extra: 1 }]])('rejects %j without calling the service', async payload => {
            expect((await handler('nonface:setLikelihood')({}, payload)).success).toBe(false);
            expect(service.setMinLikelihood).not.toHaveBeenCalled();
        });
    });

    describe('list', () => {
        it('passes a valid page request on', async () => {
            service.list.mockReturnValue([{ faceId: 1 }]);

            expect(await handler('nonface:list')({}, { offset: 0, limit: 150 })).toEqual({ success: true, faces: [{ faceId: 1 }] });
            expect(service.list).toHaveBeenCalledWith(0, 150);
        });

        it.each([[{ offset: -1, limit: 10 }], [{ offset: 0, limit: 0 }], [{ offset: 0, limit: 5000 }], [{ offset: 0.5, limit: 10 }], [{ limit: 10 }]])('rejects %j', async payload => {
            expect((await handler('nonface:list')({}, payload)).success).toBe(false);
            expect(service.list).not.toHaveBeenCalled();
        });
    });

    describe.each([
        ['nonface:ignore', 'ignore', { ignoredIds: [1] }],
        ['nonface:keep', 'keep', { kept: 1 }],
        ['nonface:undo', 'undo', { restoredIds: [1] }],
    ] as const)('%s', (channel, method, result) => {
        it('passes the face ids on and returns what the service did', async () => {
            service[method].mockReturnValue(result);

            expect(await handler(channel)({}, { faceIds: [1, 2] })).toEqual({ success: true, ...result });
            expect(service[method]).toHaveBeenCalledWith([1, 2]);
        });

        it.each([
            [{ faceIds: [0] }], [{ faceIds: [-3] }], [{ faceIds: [1.5] }], [{ faceIds: ['1'] }], [{ faceIds: 'all' }], [{}], [null],
            [{ faceIds: Array.from({ length: MAX_IDS_PER_ACTION + 1 }, (_, i) => i + 1) }],
            [{ faceIds: [1], all: true }],
        ])('rejects %j without calling the service', async payload => {
            expect((await handler(channel)({}, payload)).success).toBe(false);
            expect(service[method]).not.toHaveBeenCalled();
        });
    });
});
