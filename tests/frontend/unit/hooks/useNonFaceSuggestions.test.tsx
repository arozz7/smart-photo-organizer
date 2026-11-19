/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { loadFaces, loadPeople, addToast } = vi.hoisted(() => ({ loadFaces: vi.fn(), loadPeople: vi.fn(), addToast: vi.fn() }));
vi.mock('../../../../src/context/PeopleContext', () => ({ usePeople: () => ({ loadFaces, loadPeople }) }));
vi.mock('../../../../src/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));

import { useNonFaceSuggestions, PAGE_SIZE } from '../../../../src/hooks/useNonFaceSuggestions';

const invoke = vi.fn();

const tile = (faceId: number, extra: Record<string, unknown> = {}) => ({
    faceId, score: 0.3, quality: 0.6, blur: 100, yaw: 10, pitch: 0, box: { x: 1, y: 2, width: 3, height: 4 },
    photoId: faceId * 10, filePath: `p${faceId}.jpg`, previewPath: null, photoWidth: 100, photoHeight: 100, ...extra,
});

const overviewWith = (total: number, extra: Record<string, unknown> = {}) => ({
    cutoff: 0.55, defaultCutoff: 0.55, minCutoff: 0.3, maxCutoff: 0.75,
    current: { cutoff: 0.55, total, turned: 1 },
    choices: [{ cutoff: 0.5, total: Math.max(0, total - 1), turned: 0 }, { cutoff: 0.55, total, turned: 1 }],
    ignoredFromList: 0, ...extra,
});

/** A fake main process: one list of suggested faces that the ignore/keep/undo channels change. */
function mainProcess(initial: number[]) {
    let suggested = [...initial];
    const ignored: number[] = [];
    invoke.mockImplementation(async (channel: string, payload?: { faceIds?: number[]; offset?: number; limit?: number; cutoff?: number }) => {
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
                return { success: true, overview: overviewWith(suggested.length, { cutoff: payload!.cutoff }) };
            default:
                throw new Error(`unexpected channel ${channel}`);
        }
    });
}

beforeEach(() => {
    invoke.mockReset();
    loadFaces.mockReset();
    loadPeople.mockReset();
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

    describe('cut-off', () => {
        it('saves the new cut-off, reloads the list from the start and clears the selection', async () => {
            mainProcess([1, 2]);
            const { result } = renderHook(() => useNonFaceSuggestions({ enabled: true }));
            await waitFor(() => expect(result.current.tiles).toHaveLength(2));
            act(() => result.current.toggle(1));

            await act(async () => { await result.current.setCutoff(0.6); });

            expect(calls('nonface:setCutoff')[0][1]).toEqual({ cutoff: 0.6 });
            expect(result.current.overview?.cutoff).toBe(0.6);
            expect(result.current.selectedIds.size).toBe(0);
            expect(calls('nonface:list').at(-1)![1]).toEqual({ offset: 0, limit: PAGE_SIZE });
        });
    });
});
