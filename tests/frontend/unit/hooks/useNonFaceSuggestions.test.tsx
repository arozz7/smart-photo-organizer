/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { loadFaces, loadPeople, refreshUnassignedCount, addToast } = vi.hoisted(() => ({ loadFaces: vi.fn(), loadPeople: vi.fn(), refreshUnassignedCount: vi.fn(), addToast: vi.fn() }));
vi.mock('../../../../src/context/PeopleContext', () => ({ usePeople: () => ({ loadFaces, loadPeople, refreshUnassignedCount }) }));
vi.mock('../../../../src/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));

import { useNonFaceSuggestions, PAGE_SIZE } from '../../../../src/hooks/useNonFaceSuggestions';

const invoke = vi.fn();

const tile = (faceId: number, extra: Record<string, unknown> = {}) => ({
    faceId, score: 0.3, quality: 0.6, blur: 100, yaw: 10, pitch: 0, box: { x: 1, y: 2, width: 3, height: 4 },
    photoId: faceId * 10, filePath: `p${faceId}.jpg`, previewPath: null, photoWidth: 100, photoHeight: 100, ...extra,
});

const overviewWith = (total: number, extra: Record<string, unknown> = {}) => ({
    mode: 'detector',
    current: { total, turned: 1 },
    detector: {
        cutoff: 0.55, defaultCutoff: 0.55, minCutoff: 0.3, maxCutoff: 0.75,
        choices: [{ cutoff: 0.5, total: Math.max(0, total - 1), turned: 0 }, { cutoff: 0.55, total, turned: 1 }],
    },
    model: null,
    ignoredFromList: 0, hideFromReview: true, hideable: Math.max(0, total - 1), hiddenFromReview: Math.max(0, total - 1), ...extra,
});

/** A fake main process: one list of suggested faces that the ignore/keep/undo channels change. */
function mainProcess(initial: number[]) {
    let suggested = [...initial];
    const ignored: number[] = [];
    invoke.mockImplementation(async (channel: string, payload?: { faceIds?: number[]; offset?: number; limit?: number; cutoff?: number; mode?: string; percent?: number }) => {
        switch (channel) {
            case 'nonface:getOverview':
                return { success: true, overview: overviewWith(suggested.length) };
            case 'nonface:list':
                return { success: true, faces: suggested.slice(payload!.offset, payload!.offset! + payload!.limit!).map(id => tile(id)) };
            case 'nonface:ignore': {
                const done = payload!.faceIds!.filter(id => suggested.includes(id));
                suggested = suggested.filter(id => !done.includes(id));
                ignored.push(...done);
                return { success: true, ignoredIds: done };
            }
            case 'nonface:keep': {
                const done = payload!.faceIds!.filter(id => suggested.includes(id));
                suggested = suggested.filter(id => !done.includes(id));
                return { success: true, kept: done.length };
            }
            case 'nonface:undo': {
                const done = payload!.faceIds!.filter(id => ignored.includes(id));
                suggested = [...suggested, ...done].sort((a, b) => a - b);
                return { success: true, restoredIds: done };
            }
            case 'nonface:setCutoff':
                return { success: true, overview: overviewWith(suggested.length, { detector: { ...overviewWith(0).detector, cutoff: payload!.cutoff } }) };
            case 'nonface:setHide':
                return { success: true, overview: overviewWith(suggested.length, { hideFromReview: payload!.hide, hiddenFromReview: payload!.hide ? suggested.length - 1 : 0 }) };
            case 'nonface:setMode':
                return { success: true, overview: overviewWith(suggested.length, { mode: payload!.mode }) };
            case 'nonface:setLikelihood':
                return { success: true, overview: overviewWith(suggested.length, { mode: 'model', detector: null, model: { minLikelihood: payload!.percent } }) };
            default:
                throw new Error(`unexpected channel ${channel}`);
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

describe('useNonFaceSuggestions', () => {
    it('loads only the overview (for the count on the tab) while the list is not open', async () => {
        mainProcess([1, 2, 3]);

        const { result } = renderHook(() => useNonFaceSuggestions({ enabled: false }));

        await waitFor(() => expect(result.current.overview?.current.total).toBe(3));
        expect(calls('nonface:list')).toEqual([]);
        expect(result.current.tiles).toEqual([]);
    });

    it('loads the first page when the list is opened', async () => {
        mainProcess([1, 2, 3]);

        const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));

        await waitFor(() => expect(result.current.tiles.map(t => t.faceId)).toEqual([1, 2, 3]));
        expect(calls('nonface:list')[0][1]).toEqual({ offset: 0, limit: PAGE_SIZE });
        expect(result.current.hasMore).toBe(false);
    });

    it('loads the next page after the faces already shown', async () => {
        mainProcess(Array.from({ length: PAGE_SIZE + 20 }, (_, i) => i + 1));
        const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
        await waitFor(() => expect(result.current.tiles).toHaveLength(PAGE_SIZE));
        expect(result.current.hasMore).toBe(true);

        await act(async () => { await result.current.loadMore(); });

        expect(calls('nonface:list')[1][1]).toEqual({ offset: PAGE_SIZE, limit: PAGE_SIZE });
        expect(result.current.tiles).toHaveLength(PAGE_SIZE + 20);
    });

    it('selects one face, all loaded faces, or none', async () => {
        mainProcess([1, 2, 3]);
        const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
        await waitFor(() => expect(result.current.tiles).toHaveLength(3));

        act(() => result.current.toggle(2));
        expect([...result.current.selectedIds]).toEqual([2]);
        act(() => result.current.toggle(2));
        expect(result.current.selectedIds.size).toBe(0);
        act(() => result.current.selectAllLoaded());
        expect([...result.current.selectedIds]).toEqual([1, 2, 3]);
        act(() => result.current.selectNone());
        expect(result.current.selectedIds.size).toBe(0);
    });

    describe('ignoring', () => {
        it('ignores the selected faces, removes exactly those the main process ignored, offers undo and refreshes the people page', async () => {
            mainProcess([1, 2, 3]);
            const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(3));
            act(() => { result.current.toggle(1); result.current.toggle(3); });

            await act(async () => { await result.current.ignoreSelected(); });

            expect(calls('nonface:ignore')[0][1]).toEqual({ faceIds: [1, 3] });
            expect(result.current.tiles.map(t => t.faceId)).toEqual([2]);
            expect(result.current.selectedIds.size).toBe(0);
            expect(result.current.undoBatch).toEqual([1, 3]);
            expect(loadFaces).toHaveBeenCalledWith({ unnamed: true });
            expect(loadPeople).toHaveBeenCalled();
            await waitFor(() => expect(result.current.overview?.current.total).toBe(1));
        });

        it('keeps on screen a face the main process did not ignore (it was no longer a suggestion)', async () => {
            mainProcess([1, 2]);
            const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(2));
            invoke.mockImplementationOnce(async () => ({ success: true, ignoredIds: [1] }));
            act(() => { result.current.toggle(1); result.current.toggle(2); });

            await act(async () => { await result.current.ignoreSelected(); });

            expect(result.current.undoBatch).toEqual([1]);
            expect(result.current.tiles.map(t => t.faceId)).toEqual([2]);
        });

        it('undoes exactly the last batch and shows the faces again', async () => {
            mainProcess([1, 2, 3]);
            const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(3));
            act(() => { result.current.toggle(1); result.current.toggle(2); });
            await act(async () => { await result.current.ignoreSelected(); });

            await act(async () => { await result.current.undoLast(); });

            expect(calls('nonface:undo')[0][1]).toEqual({ faceIds: [1, 2] });
            expect(result.current.undoBatch).toBeNull();
            await waitFor(() => expect(result.current.tiles.map(t => t.faceId)).toEqual([1, 2, 3]));
            expect(loadFaces).toHaveBeenCalledTimes(2);
        });

        it('does nothing when nothing is selected', async () => {
            mainProcess([1]);
            const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(1));

            await act(async () => { await result.current.ignoreSelected(); });

            expect(calls('nonface:ignore')).toEqual([]);
        });

        it('shows the error and leaves the list alone when the main process fails', async () => {
            mainProcess([1, 2]);
            const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(2));
            invoke.mockImplementationOnce(async () => ({ success: false, error: 'database is locked' }));
            act(() => result.current.toggle(1));

            await act(async () => { await result.current.ignoreSelected(); });

            expect(result.current.tiles).toHaveLength(2);
            expect(result.current.undoBatch).toBeNull();
            expect(result.current.selectedIds.has(1)).toBe(true);
            expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', description: expect.stringContaining('database is locked') }));
        });
    });

    describe('keeping', () => {
        it('records the selected faces as real faces and removes them from the list', async () => {
            mainProcess([1, 2, 3]);
            const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(3));
            act(() => result.current.toggle(2));

            await act(async () => { await result.current.keepSelected(); });

            expect(calls('nonface:keep')[0][1]).toEqual({ faceIds: [2] });
            expect(result.current.tiles.map(t => t.faceId)).toEqual([1, 3]);
            expect(result.current.undoBatch).toBeNull();
            await waitFor(() => expect(result.current.overview?.current.total).toBe(2));
        });
    });

    describe('list mode and likelihood', () => {
        it('switches between the detector list and the model list and reloads the list from the start', async () => {
            mainProcess([1, 2]);
            const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(2));
            act(() => result.current.toggle(1));

            await act(async () => { await result.current.setMode('model'); });

            expect(calls('nonface:setMode')[0][1]).toEqual({ mode: 'model' });
            expect(result.current.overview?.mode).toBe('model');
            expect(result.current.selectedIds.size).toBe(0);
            expect(calls('nonface:list').at(-1)![1]).toEqual({ offset: 0, limit: PAGE_SIZE });
        });

        it('saves the likelihood the model list cuts at', async () => {
            mainProcess([1]);
            const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(1));

            await act(async () => { await result.current.setLikelihood(80); });

            expect(calls('nonface:setLikelihood')[0][1]).toEqual({ percent: 80 });
            expect(result.current.overview?.model?.minLikelihood).toBe(80);
        });

        it('drops the undo offer when the list changes', async () => {
            mainProcess([1, 2]);
            const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(2));
            act(() => result.current.toggle(1));
            await act(async () => { await result.current.ignoreSelected(); });
            expect(result.current.undoBatch).toEqual([1]);

            await act(async () => { await result.current.setMode('model'); });

            expect(result.current.undoBatch).toBeNull();
        });

        it('shows the error and keeps the list when the change is refused', async () => {
            mainProcess([1]);
            const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(1));
            invoke.mockImplementationOnce(async () => ({ success: false, error: 'Invalid request' }));

            await act(async () => { await result.current.setMode('model'); });

            expect(result.current.overview?.mode).toBe('detector');
            expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', description: expect.stringContaining('Invalid request') }));
        });
    });

    describe('cut-off', () => {
        it('saves the new cut-off, reloads the list from the start and clears the selection', async () => {
            mainProcess([1, 2]);
            const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(2));
            act(() => result.current.toggle(1));

            await act(async () => { await result.current.setCutoff(0.6); });

            expect(calls('nonface:setCutoff')[0][1]).toEqual({ cutoff: 0.6 });
            expect(result.current.overview?.detector?.cutoff).toBe(0.6);
            expect(result.current.selectedIds.size).toBe(0);
            expect(calls('nonface:list').at(-1)![1]).toEqual({ offset: 0, limit: PAGE_SIZE });
        });
    });

    describe('hiding the list from Review Needed', () => {
        it('saves the choice, shows the new overview and tells Review Needed to reload', async () => {
            mainProcess([1, 2, 3]);
            const onReviewChanged = vi.fn();
            const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true, onReviewChanged }));
            await waitFor(() => expect(result.current.overview?.hideFromReview).toBe(true));

            await act(async () => { await result.current.setHideFromReview(false); });

            expect(calls('nonface:setHide')[0][1]).toEqual({ hide: false });
            expect(result.current.overview?.hideFromReview).toBe(false);
            expect(result.current.overview?.hiddenFromReview).toBe(0);
            expect(onReviewChanged).toHaveBeenCalledTimes(1);
            expect(refreshUnassignedCount).toHaveBeenCalled();
        });

        it('shows the error and does not reload Review Needed when the change is refused', async () => {
            mainProcess([1, 2, 3]);
            const onReviewChanged = vi.fn();
            const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true, onReviewChanged }));
            await waitFor(() => expect(result.current.overview).not.toBeNull());
            invoke.mockImplementation(async (channel: string) => (channel === 'nonface:setHide' ? { success: false, error: 'locked' } : { success: true }));

            await act(async () => { await result.current.setHideFromReview(false); });

            expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', description: expect.stringContaining('locked') }));
            expect(onReviewChanged).not.toHaveBeenCalled();
        });

        it('tells Review Needed to reload after faces are ignored or kept (the hidden set changes), and after undo', async () => {
            mainProcess([1, 2, 3]);
            const onReviewChanged = vi.fn();
            const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true, onReviewChanged }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(3));

            act(() => result.current.toggle(1));
            await act(async () => { await result.current.ignoreSelected(); });
            expect(onReviewChanged).toHaveBeenCalledTimes(1);

            await act(async () => { await result.current.undoLast(); });
            expect(onReviewChanged).toHaveBeenCalledTimes(2);

            act(() => result.current.toggle(2));
            await act(async () => { await result.current.keepSelected(); });
            expect(onReviewChanged).toHaveBeenCalledTimes(3);
        });
    });

    it('loads the next page and selects only the faces it added, keeping what was selected', async () => {
        mainProcess(Array.from({ length: PAGE_SIZE + 5 }, (_, i) => i + 1));
        const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
        await waitFor(() => expect(result.current.tiles).toHaveLength(PAGE_SIZE));
        act(() => result.current.toggle(1));

        await act(async () => { await result.current.loadMoreAndSelect(); });

        expect(result.current.tiles).toHaveLength(PAGE_SIZE + 5);
        expect([...result.current.selectedIds].sort((a, b) => a - b)).toEqual([1, PAGE_SIZE + 1, PAGE_SIZE + 2, PAGE_SIZE + 3, PAGE_SIZE + 4, PAGE_SIZE + 5]);
    });

    it('selects the range between two faces on shift-click, in the order shown', async () => {
        mainProcess([1, 2, 3, 4, 5]);
        const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
        await waitFor(() => expect(result.current.tiles).toHaveLength(5));
        act(() => result.current.toggle(2));

        act(() => result.current.toggle(4, true));

        expect([...result.current.selectedIds].sort((a, b) => a - b)).toEqual([2, 3, 4]);
    });
});
