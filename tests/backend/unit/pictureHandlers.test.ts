import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHandle, suggestions, check } = vi.hoisted(() => ({
    mockHandle: vi.fn(),
    suggestions: {
        getOverview: vi.fn(),
        setList: vi.fn(),
        setMinLikelihood: vi.fn(),
        setHideFromReview: vi.fn(),
        list: vi.fn(),
        ignore: vi.fn(),
        keep: vi.fn(),
        undo: vi.fn(),
    },
    check: { getStatus: vi.fn(), runNow: vi.fn(), setMode: vi.fn(), setAwayMinutes: vi.fn() },
}));

vi.mock('electron', () => ({ ipcMain: { handle: mockHandle } }));
vi.mock('../../../electron/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../electron/core/services/PictureDeps', () => ({ getPictureSuggestionService: () => suggestions }));
vi.mock('../../../electron/core/services/PictureCheckDeps', () => ({ getPictureCheckService: () => check }));
vi.mock('../../../electron/core/services/FaceVisibilityDeps', () => ({ getFaceVisibilityService: () => check }));

import { registerPictureHandlers } from '../../../electron/ipc/pictureHandlers';
import { registerPictureCheckHandlers } from '../../../electron/ipc/pictureCheckHandlers';
import { MAX_IDS_PER_ACTION, MAX_PAGE_SIZE } from '../../../electron/core/services/PictureSuggestionService';

type Handler = (event: unknown, payload?: unknown) => Promise<{ success: boolean; error?: string } & Record<string, unknown>>;

function handler(channel: string): Handler {
    const entry = mockHandle.mock.calls.find(([name]: [string]) => name === channel);
    if (!entry) throw new Error(`Handler not registered for channel: ${channel}`);
    return entry[1] as Handler;
}

describe('pictureHandlers', () => {
    beforeEach(() => {
        mockHandle.mockClear();
        Object.values(suggestions).forEach(fn => fn.mockReset());
        Object.values(check).forEach(fn => fn.mockReset());
        registerPictureHandlers();
        registerPictureCheckHandlers();
    });

    it('registers one channel per action, for the lists and for the check card', () => {
        expect(mockHandle.mock.calls.map(([name]: [string]) => name).sort()).toEqual([
            'picture:getOverview', 'picture:ignore', 'picture:keep', 'picture:list', 'picture:setHide', 'picture:setLikelihood', 'picture:setList', 'picture:undo',
            'picturecheck:getStatus', 'picturecheck:runNow', 'picturecheck:setAwayMinutes', 'picturecheck:setMode',
        ]);
    });

    it('returns the overview, and a failure instead of a throw', async () => {
        suggestions.getOverview.mockReturnValueOnce({ list: 'unassigned' });
        expect(await handler('picture:getOverview')({})).toEqual({ success: true, overview: { list: 'unassigned' } });

        suggestions.getOverview.mockImplementation(() => { throw new Error('db locked'); });
        const failed = await handler('picture:getOverview')({});
        expect(failed.success).toBe(false);
        expect(failed.error).toContain('db locked');
    });

    describe('settings', () => {
        it('saves the list and returns the new overview, and explains a refused list', async () => {
            suggestions.setList.mockReturnValueOnce(true).mockReturnValueOnce(false);
            suggestions.getOverview.mockReturnValue({ list: 'assigned' });

            expect(await handler('picture:setList')({}, { list: 'assigned' })).toEqual({ success: true, overview: { list: 'assigned' } });
            expect((await handler('picture:setList')({}, { list: 'other' })).success).toBe(false);
        });

        it('saves a likelihood, and refuses one outside 50 to 95 percent before it reaches the service', async () => {
            suggestions.setMinLikelihood.mockReturnValue(true);
            suggestions.getOverview.mockReturnValue({});

            expect((await handler('picture:setLikelihood')({}, { percent: 80 })).success).toBe(true);
            expect((await handler('picture:setLikelihood')({}, { percent: 99 })).success).toBe(false);
            expect((await handler('picture:setLikelihood')({}, { percent: 49 })).success).toBe(false);
            expect(suggestions.setMinLikelihood).toHaveBeenCalledTimes(1);
        });

        it('saves the hiding choice', async () => {
            suggestions.getOverview.mockReturnValue({ hideFromReview: false });

            expect(await handler('picture:setHide')({}, { hide: false })).toEqual({ success: true, overview: { hideFromReview: false } });
            expect(suggestions.setHideFromReview).toHaveBeenCalledWith(false);
        });

        it.each([
            ['picture:setList', { list: 1 }], ['picture:setList', { list: 'unassigned', extra: 1 }], ['picture:setLikelihood', { percent: '80' }],
            ['picture:setLikelihood', { percent: 80.5 }], ['picture:setHide', { hide: 'yes' }], ['picture:setHide', undefined],
        ])('rejects %s with %j without calling the service', async (channel, payload) => {
            expect((await handler(channel)({}, payload)).success).toBe(false);
            expect(suggestions.setList).not.toHaveBeenCalled();
            expect(suggestions.setMinLikelihood).not.toHaveBeenCalled();
            expect(suggestions.setHideFromReview).not.toHaveBeenCalled();
        });
    });

    describe('list', () => {
        it('passes the page', async () => {
            suggestions.list.mockReturnValue([{ faceId: 1 }]);

            expect(await handler('picture:list')({}, { offset: 0, limit: 50 })).toEqual({ success: true, faces: [{ faceId: 1 }] });
            expect(suggestions.list).toHaveBeenCalledWith(0, 50);
        });

        it('rejects a negative offset and a page that is too big', async () => {
            expect((await handler('picture:list')({}, { offset: -1, limit: 10 })).success).toBe(false);
            expect((await handler('picture:list')({}, { offset: 0, limit: MAX_PAGE_SIZE + 1 })).success).toBe(false);
            expect(suggestions.list).not.toHaveBeenCalled();
        });
    });

    describe('ignore, keep and undo', () => {
        it('return what the service did', async () => {
            suggestions.ignore.mockResolvedValue({ ignoredIds: [1, 2] });
            suggestions.keep.mockResolvedValue({ kept: 3 });
            suggestions.undo.mockResolvedValue({ restoredIds: [1] });

            expect(await handler('picture:ignore')({}, { faceIds: [1, 2] })).toEqual({ success: true, ignoredIds: [1, 2] });
            expect(await handler('picture:keep')({}, { faceIds: [3] })).toEqual({ success: true, kept: 3 });
            expect(await handler('picture:undo')({}, { faceIds: [1] })).toEqual({ success: true, restoredIds: [1] });
        });

        it('reject bad ids, too many ids and unknown fields', async () => {
            const tooMany = Array.from({ length: MAX_IDS_PER_ACTION + 1 }, (_, i) => i + 1);

            for (const channel of ['picture:ignore', 'picture:keep', 'picture:undo']) {
                expect((await handler(channel)({}, { faceIds: [0] })).success).toBe(false);
                expect((await handler(channel)({}, { faceIds: tooMany })).success).toBe(false);
                expect((await handler(channel)({}, { faceIds: [1], person: 3 })).success).toBe(false);
            }
            expect(suggestions.ignore).not.toHaveBeenCalled();
        });

        it('turn a thrown error into a failure', async () => {
            suggestions.ignore.mockRejectedValue(new Error('locked'));

            const result = await handler('picture:ignore')({}, { faceIds: [1] });

            expect(result.success).toBe(false);
            expect(result.error).toContain('locked');
        });
    });

    describe('the check card (picturecheck:*)', () => {
        it('returns the status, runs now and saves the mode and away time', async () => {
            check.getStatus.mockReturnValue({ state: 'ready' });
            check.runNow.mockReturnValue({ started: true });

            expect(await handler('picturecheck:getStatus')({})).toEqual({ success: true, status: { state: 'ready' } });
            expect(await handler('picturecheck:runNow')({})).toMatchObject({ success: true, started: true });
            expect((await handler('picturecheck:setMode')({}, { mode: 'always' })).success).toBe(true);
            expect(check.setMode).toHaveBeenCalledWith('always');
            expect((await handler('picturecheck:setAwayMinutes')({}, { minutes: 10 })).success).toBe(true);
            expect(check.setAwayMinutes).toHaveBeenCalledWith(10);
        });

        it('rejects a mode or a time that does not exist', async () => {
            expect((await handler('picturecheck:setMode')({}, { mode: 'sometimes' })).success).toBe(false);
            expect((await handler('picturecheck:setAwayMinutes')({}, { minutes: 0 })).success).toBe(false);
        });
    });
});
