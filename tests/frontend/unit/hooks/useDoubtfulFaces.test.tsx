/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { loadFaces, loadPeople, refreshUnassignedCount, addToast } = vi.hoisted(() => ({ loadFaces: vi.fn(), loadPeople: vi.fn(), refreshUnassignedCount: vi.fn(), addToast: vi.fn() }));
vi.mock('../../../../src/context/PeopleContext', () => ({ usePeople: () => ({ loadFaces, loadPeople, refreshUnassignedCount }) }));
vi.mock('../../../../src/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));

import { useDoubtfulFaces } from '../../../../src/hooks/useDoubtfulFaces';

const invoke = vi.fn();

const tile = (faceId: number, extra: Record<string, unknown> = {}) => ({
    faceId, score: 3.5, quality: 0.6, blur: 100, yaw: 5, box: { x: 1, y: 2, width: 3, height: 4 }, photoId: faceId * 10,
    filePath: `p${faceId}.jpg`, previewPath: null, photoWidth: 100, photoHeight: 100, personId: 7, personName: 'Person 7', source: 'ai_scan', confirmed: true, ...extra,
});

const overviewWith = (total: number, extra: Record<string, unknown> = {}) => ({
    minScore: 3, defaultMinScore: 3, minAllowed: 0, maxAllowed: 6,
    choices: [{ score: 1, total: total + 5 }, { score: 3, total }],
    current: { total }, people: [{ personId: 7, name: 'Person 7', count: total }], checked: 40, candidates: 100, changed: 0, ...extra,
});

/** A fake main process: one list of doubtful faces that the actions change. */
function mainProcess(initial: number[]) {
    let doubtful = [...initial];
    const changed: number[] = [];
    invoke.mockImplementation(async (channel: string, payload?: { faceIds?: number[]; offset?: number; limit?: number; personId?: number | null; score?: number }) => {
        switch (channel) {
            case 'doubtful:getOverview': return { success: true, overview: overviewWith(doubtful.length) };
            case 'doubtful:list': return { success: true, faces: doubtful.slice(payload!.offset, payload!.offset! + payload!.limit!).map(id => tile(id)) };
            case 'doubtful:ignore':
            case 'doubtful:unassign': {
                const done = payload!.faceIds!.filter(id => doubtful.includes(id));
                doubtful = doubtful.filter(id => !done.includes(id));
                changed.push(...done);
                return { success: true, changedIds: done };
            }
            case 'doubtful:keep': {
                const done = payload!.faceIds!.filter(id => doubtful.includes(id));
                doubtful = doubtful.filter(id => !done.includes(id));
                return { success: true, kept: done.length };
            }
            case 'doubtful:undo': {
                const done = payload!.faceIds!.filter(id => changed.includes(id));
                doubtful = [...doubtful, ...done].sort((a, b) => a - b);
                return { success: true, restoredIds: done };
            }
            case 'doubtful:setMinScore': return { success: true, overview: overviewWith(doubtful.length, { minScore: payload!.score }) };
            default: throw new Error(`unexpected channel ${channel}`);
        }
    });
}

beforeEach(() => {
    invoke.mockReset();
    [loadFaces, loadPeople, refreshUnassignedCount, addToast].forEach(fn => fn.mockReset());
    (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
});

const calls = (channel: string) => invoke.mock.calls.filter(([name]) => name === channel);

async function open(initial: number[]) {
    mainProcess(initial);
    const onReviewChanged = vi.fn();
    const hook = renderHook(() => useDoubtfulFaces({ enabled: true, onReviewChanged }));
    await waitFor(() => expect(hook.result.current.tiles).toHaveLength(initial.length));
    return { ...hook, onReviewChanged };
}

describe('useDoubtfulFaces', () => {
    it('loads only the overview (for the count on the tab) while the list is not open', async () => {
        mainProcess([1, 2, 3]);

        const { result } = renderHook(() => useDoubtfulFaces({ enabled: false }));

        await waitFor(() => expect(result.current.overview?.current.total).toBe(3));
        expect(calls('doubtful:list')).toHaveLength(0);
        expect(result.current.total).toBe(3);
    });

    it('loads the faces of all people when the list is opened', async () => {
        const { result } = await open([1, 2, 3]);

        expect(calls('doubtful:list')[0][1]).toEqual({ offset: 0, limit: 100, personId: null });
        expect(result.current.hasMore).toBe(false);
    });

    describe('the actions on the selected faces', () => {
        it('"not a face" ignores them, removes them from the list, offers Undo and refreshes the queues', async () => {
            const { result, onReviewChanged } = await open([1, 2, 3]);
            act(() => { result.current.toggle(1); result.current.toggle(2); });

            await act(async () => { await result.current.ignoreSelected(); });

            expect(calls('doubtful:ignore')[0][1]).toEqual({ faceIds: expect.arrayContaining([1, 2]) });
            expect(result.current.tiles.map(t => t.faceId)).toEqual([3]);
            expect(result.current.undoBatch).toEqual({ kind: 'ignore', faceIds: expect.arrayContaining([1, 2]) });
            expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
            expect(loadPeople).toHaveBeenCalled();
            expect(onReviewChanged).toHaveBeenCalled();
        });

        it('"back to suggestions" uses its own channel and offers Undo', async () => {
            const { result } = await open([1, 2]);
            act(() => { result.current.toggle(1); });

            await act(async () => { await result.current.unassignSelected(); });

            expect(calls('doubtful:unassign')).toHaveLength(1);
            expect(calls('doubtful:ignore')).toHaveLength(0);
            expect(result.current.undoBatch).toEqual({ kind: 'unassign', faceIds: [1] });
            expect(result.current.tiles.map(t => t.faceId)).toEqual([2]);
        });

        it('"keep" removes them from the list without offering Undo and without touching the people', async () => {
            const { result } = await open([1, 2]);
            act(() => { result.current.toggle(2); });

            await act(async () => { await result.current.keepSelected(); });

            expect(result.current.tiles.map(t => t.faceId)).toEqual([1]);
            expect(result.current.undoBatch).toBeNull();
            expect(loadPeople).not.toHaveBeenCalled();
        });

        it('does nothing with an empty selection', async () => {
            const { result } = await open([1]);

            await act(async () => { await result.current.ignoreSelected(); await result.current.unassignSelected(); await result.current.keepSelected(); });

            expect(invoke.mock.calls.some(([name]) => ['doubtful:ignore', 'doubtful:unassign', 'doubtful:keep'].includes(name))).toBe(false);
        });

        it('says so and leaves the list alone when an action fails', async () => {
            const { result } = await open([1, 2]);
            invoke.mockImplementationOnce(async () => ({ success: false, error: 'db locked' }));
            act(() => { result.current.toggle(1); });

            await act(async () => { await result.current.ignoreSelected(); });

            expect(result.current.tiles).toHaveLength(2);
            expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', description: expect.stringContaining('db locked') }));
        });
    });

    it('Undo gives exactly the changed faces back and reloads the list', async () => {
        const { result } = await open([1, 2, 3]);
        act(() => { result.current.toggle(1); });
        await act(async () => { await result.current.unassignSelected(); });

        await act(async () => { await result.current.undoLast(); });

        expect(calls('doubtful:undo')[0][1]).toEqual({ faceIds: [1] });
        expect(result.current.undoBatch).toBeNull();
        await waitFor(() => expect(result.current.tiles.map(t => t.faceId)).toEqual([1, 2, 3]));
    });

    it('limits the list to one person, and back to everyone', async () => {
        const { result } = await open([1, 2]);

        await act(async () => { await result.current.setPerson(7); });
        expect(calls('doubtful:list').at(-1)?.[1]).toEqual({ offset: 0, limit: 100, personId: 7 });
        expect(result.current.personId).toBe(7);

        await act(async () => { await result.current.setPerson(null); });
        expect(calls('doubtful:list').at(-1)?.[1]).toMatchObject({ personId: null });
    });

    it('changes the cut-off, then shows the list from the start under it', async () => {
        const { result } = await open([1, 2]);

        await act(async () => { await result.current.setMinScore(4); });

        expect(calls('doubtful:setMinScore')[0][1]).toEqual({ score: 4 });
        expect(result.current.overview?.minScore).toBe(4);
        expect(calls('doubtful:list').length).toBeGreaterThan(1);
    });
});
