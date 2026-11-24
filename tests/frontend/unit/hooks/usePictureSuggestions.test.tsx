/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { loadFaces, loadPeople, refreshUnassignedCount, addToast } = vi.hoisted(() => ({ loadFaces: vi.fn(), loadPeople: vi.fn(), refreshUnassignedCount: vi.fn(), addToast: vi.fn() }));
vi.mock('../../../../src/context/PeopleContext', () => ({ usePeople: () => ({ loadFaces, loadPeople, refreshUnassignedCount }) }));
vi.mock('../../../../src/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));

import { usePictureSuggestions, PAGE_SIZE, OVERVIEW_REFRESH_MS } from '../../../../src/hooks/usePictureSuggestions';

const invoke = vi.fn();

const tile = (faceId: number, extra: Record<string, unknown> = {}) => ({
    faceId, score: -1.5, likelihood: 85, quality: 0.6, blur: 100, yaw: 5, box: { x: 1, y: 2, width: 3, height: 4 }, photoId: faceId * 10,
    filePath: `p${faceId}.jpg`, previewPath: null, photoWidth: 100, photoHeight: 100, personId: null, personName: null, source: null, confirmed: null, ...extra,
});

const overviewWith = (total: number, extra: Record<string, unknown> = {}) => ({
    list: 'unassigned', minLikelihood: 70, defaultLikelihood: 70, minAllowed: 50, maxAllowed: 95,
    choices: [{ likelihood: 50, unassigned: total + 2, assigned: 1 }, { likelihood: 70, unassigned: total, assigned: 1 }],
    current: { total }, suggestedTotal: total + 1, checked: 40, candidates: 100, assignedChecked: 12, assignedCandidates: 12,
    ignoredFromList: 0, hideFromReview: true, hideable: total, hiddenFromReview: total, ...extra,
});

/** A fake main process: one list of suggested faces that the ignore, keep and undo channels change. */
function mainProcess(initial: number[]) {
    let suggested = [...initial];
    const ignored: number[] = [];
    invoke.mockImplementation(async (channel: string, payload?: { faceIds?: number[]; offset?: number; limit?: number; list?: string; percent?: number; hide?: boolean }) => {
        switch (channel) {
            case 'picture:getOverview': return { success: true, overview: overviewWith(suggested.length) };
            case 'picture:list': return { success: true, faces: suggested.slice(payload!.offset, payload!.offset! + payload!.limit!).map(id => tile(id)) };
            case 'picture:ignore': {
                const done = payload!.faceIds!.filter(id => suggested.includes(id));
                suggested = suggested.filter(id => !done.includes(id));
                ignored.push(...done);
                return { success: true, ignoredIds: done };
            }
            case 'picture:keep': {
                const done = payload!.faceIds!.filter(id => suggested.includes(id));
                suggested = suggested.filter(id => !done.includes(id));
                return { success: true, kept: done.length };
            }
            case 'picture:undo': {
                const done = payload!.faceIds!.filter(id => ignored.includes(id));
                suggested = [...suggested, ...done].sort((a, b) => a - b);
                return { success: true, restoredIds: done };
            }
            case 'picture:setList': return { success: true, overview: overviewWith(suggested.length, { list: payload!.list }) };
            case 'picture:setLikelihood': return { success: true, overview: overviewWith(suggested.length, { minLikelihood: payload!.percent }) };
            case 'picture:setHide': return { success: true, overview: overviewWith(suggested.length, { hideFromReview: payload!.hide, hiddenFromReview: payload!.hide ? suggested.length : 0 }) };
            default: throw new Error(`unexpected channel ${channel}`);
        }
    });
}

beforeEach(() => {
    invoke.mockReset();
    loadFaces.mockReset();
    loadPeople.mockReset();
    refreshUnassignedCount.mockReset();
    addToast.mockReset();
    (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
});

const calls = (channel: string) => invoke.mock.calls.filter(([name]) => name === channel);

describe('usePictureSuggestions', () => {
    describe('keeping the overview current while the background check runs', () => {
        afterEach(() => { vi.useRealTimers(); });

        it('reloads the overview on a timer while the list is open, so the counts follow the check', async () => {
            vi.useFakeTimers();
            mainProcess([1, 2]);
            renderHook(() => usePictureSuggestions({ enabled: true }));
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            const before = calls('picture:getOverview').length;

            await act(async () => { await vi.advanceTimersByTimeAsync(OVERVIEW_REFRESH_MS * 2); });

            expect(calls('picture:getOverview').length).toBe(before + 2);
        });

        it('does not poll while the list is closed (the tab count loads once)', async () => {
            vi.useFakeTimers();
            mainProcess([1, 2]);
            renderHook(() => usePictureSuggestions({ enabled: false }));
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            const before = calls('picture:getOverview').length;

            await act(async () => { await vi.advanceTimersByTimeAsync(OVERVIEW_REFRESH_MS * 3); });

            expect(calls('picture:getOverview').length).toBe(before);
        });

        it('reloads the overview when the list is opened, since the tab may have been closed for hours', async () => {
            mainProcess([1]);
            const { rerender } = renderHook(({ enabled }) => usePictureSuggestions({ enabled }), { initialProps: { enabled: false } });
            await waitFor(() => expect(calls('picture:getOverview').length).toBe(1));

            rerender({ enabled: true });

            await waitFor(() => expect(calls('picture:getOverview').length).toBe(2));
        });
    });

    it('loads only the overview (for the count on the tab) while the list is not open', async () => {
        mainProcess([1, 2, 3]);

        const { result } = renderHook(() => usePictureSuggestions({ enabled: false }));

        await waitFor(() => expect(result.current.overview?.current.total).toBe(3));
        expect(calls('picture:list')).toEqual([]);
        expect(result.current.total).toBe(4);
    });

    it('loads the first page when the list is opened, and the next page after the faces shown', async () => {
        mainProcess(Array.from({ length: PAGE_SIZE + 20 }, (_, i) => i + 1));
        const { result } = renderHook(() => usePictureSuggestions({ enabled: true }));
        await waitFor(() => expect(result.current.tiles).toHaveLength(PAGE_SIZE));
        expect(calls('picture:list')[0][1]).toEqual({ offset: 0, limit: PAGE_SIZE });
        expect(result.current.hasMore).toBe(true);

        await act(async () => { await result.current.loadMore(); });

        expect(calls('picture:list')[1][1]).toEqual({ offset: PAGE_SIZE, limit: PAGE_SIZE });
        expect(result.current.tiles).toHaveLength(PAGE_SIZE + 20);
    });

    it('selects one face, all loaded faces, or none', async () => {
        mainProcess([1, 2, 3]);
        const { result } = renderHook(() => usePictureSuggestions({ enabled: true }));
        await waitFor(() => expect(result.current.tiles).toHaveLength(3));

        act(() => result.current.toggle(2));
        expect([...result.current.selectedIds]).toEqual([2]);
        act(() => result.current.selectAllLoaded());
        expect(result.current.selectedIds.size).toBe(3);
        act(() => result.current.selectNone());
        expect(result.current.selectedIds.size).toBe(0);
    });

    describe('ignore, keep and undo', () => {
        it('ignores the selected faces, removes exactly those the main process ignored, offers undo and refreshes Review Needed and the people', async () => {
            mainProcess([1, 2, 3]);
            const onReviewChanged = vi.fn();
            const { result } = renderHook(() => usePictureSuggestions({ enabled: true, onReviewChanged }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(3));
            act(() => { result.current.toggle(1); result.current.toggle(3); });

            await act(async () => { await result.current.ignoreSelected(); });

            expect(calls('picture:ignore')[0][1]).toEqual({ faceIds: [1, 3] });
            expect(result.current.tiles.map(t => t.faceId)).toEqual([2]);
            expect(result.current.undoBatch).toEqual([1, 3]);
            expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', description: expect.stringContaining('2 faces') }));
            expect(loadPeople).toHaveBeenCalled();
            expect(refreshUnassignedCount).toHaveBeenCalled();
            expect(onReviewChanged).toHaveBeenCalledTimes(1);
        });

        it('keeps the selected faces as real faces and removes them from the list', async () => {
            mainProcess([1, 2]);
            const onReviewChanged = vi.fn();
            const { result } = renderHook(() => usePictureSuggestions({ enabled: true, onReviewChanged }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(2));
            act(() => result.current.toggle(2));

            await act(async () => { await result.current.keepSelected(); });

            expect(calls('picture:keep')[0][1]).toEqual({ faceIds: [2] });
            expect(result.current.tiles.map(t => t.faceId)).toEqual([1]);
            expect(onReviewChanged).toHaveBeenCalledTimes(1);
        });

        it('undoes exactly the last batch and shows the faces again', async () => {
            mainProcess([1, 2, 3]);
            const { result } = renderHook(() => usePictureSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(3));
            act(() => result.current.toggle(2));
            await act(async () => { await result.current.ignoreSelected(); });

            await act(async () => { await result.current.undoLast(); });

            expect(calls('picture:undo')[0][1]).toEqual({ faceIds: [2] });
            await waitFor(() => expect(result.current.tiles.map(t => t.faceId)).toEqual([1, 2, 3]));
            expect(result.current.undoBatch).toBeNull();
        });

        it('does nothing when nothing is selected, and shows the error when the main process fails', async () => {
            mainProcess([1]);
            const { result } = renderHook(() => usePictureSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(1));
            await act(async () => { await result.current.ignoreSelected(); });
            expect(calls('picture:ignore')).toEqual([]);

            invoke.mockImplementation(async (channel: string) => (channel === 'picture:ignore' ? { success: false, error: 'locked' } : { success: true, faces: [tile(1)], overview: overviewWith(1) }));
            act(() => result.current.toggle(1));
            await act(async () => { await result.current.ignoreSelected(); });

            expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', description: expect.stringContaining('locked') }));
            expect(result.current.tiles.map(t => t.faceId)).toEqual([1]);
        });
    });

    describe('settings', () => {
        it('switches between the unassigned and the assigned list and reloads from the start', async () => {
            mainProcess([1, 2]);
            const { result } = renderHook(() => usePictureSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(2));

            await act(async () => { await result.current.setList('assigned'); });

            expect(calls('picture:setList')[0][1]).toEqual({ list: 'assigned' });
            expect(result.current.overview?.list).toBe('assigned');
            expect(calls('picture:list').length).toBeGreaterThanOrEqual(2);
        });

        it('saves the likelihood and reloads', async () => {
            mainProcess([1]);
            const { result } = renderHook(() => usePictureSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(1));

            await act(async () => { await result.current.setLikelihood(80); });

            expect(calls('picture:setLikelihood')[0][1]).toEqual({ percent: 80 });
            expect(result.current.overview?.minLikelihood).toBe(80);
        });

        it('saves the hiding choice, and tells Review Needed to reload', async () => {
            mainProcess([1, 2]);
            const onReviewChanged = vi.fn();
            const { result } = renderHook(() => usePictureSuggestions({ enabled: true, onReviewChanged }));
            await waitFor(() => expect(result.current.overview?.hideFromReview).toBe(true));

            await act(async () => { await result.current.setHideFromReview(false); });

            expect(calls('picture:setHide')[0][1]).toEqual({ hide: false });
            expect(result.current.overview?.hiddenFromReview).toBe(0);
            expect(onReviewChanged).toHaveBeenCalledTimes(1);
            expect(refreshUnassignedCount).toHaveBeenCalled();
        });

        it('a change of likelihood also tells Review Needed, since it changes which faces are hidden', async () => {
            mainProcess([1]);
            const onReviewChanged = vi.fn();
            const { result } = renderHook(() => usePictureSuggestions({ enabled: true, onReviewChanged }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(1));

            await act(async () => { await result.current.setLikelihood(90); });

            expect(onReviewChanged).toHaveBeenCalled();
        });
    });

    it('loads the next page and selects only the faces it added, keeping what was selected', async () => {
        mainProcess(Array.from({ length: PAGE_SIZE + 5 }, (_, i) => i + 1));
        const { result } = renderHook(() => usePictureSuggestions({ enabled: true }));
        await waitFor(() => expect(result.current.tiles).toHaveLength(PAGE_SIZE));
        act(() => result.current.toggle(1));

        await act(async () => { await result.current.loadMoreAndSelect(); });

        expect(result.current.tiles).toHaveLength(PAGE_SIZE + 5);
        expect([...result.current.selectedIds].sort((a, b) => a - b)).toEqual([1, PAGE_SIZE + 1, PAGE_SIZE + 2, PAGE_SIZE + 3, PAGE_SIZE + 4, PAGE_SIZE + 5]);
    });

    it('selects the range between two faces on shift-click, in the order shown', async () => {
        mainProcess([1, 2, 3, 4, 5]);
        const { result } = renderHook(() => usePictureSuggestions({ enabled: true }));
        await waitFor(() => expect(result.current.tiles).toHaveLength(5));
        act(() => result.current.toggle(2));

        act(() => result.current.toggle(4, true));

        expect([...result.current.selectedIds].sort((a, b) => a - b)).toEqual([2, 3, 4]);
    });
});
