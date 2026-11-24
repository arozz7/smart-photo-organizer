/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { loadFaces, loadPeople, addToast } = vi.hoisted(() => ({ loadFaces: vi.fn(), loadPeople: vi.fn(), addToast: vi.fn() }));
vi.mock('../../../../src/context/PeopleContext', () => ({ usePeople: () => ({ loadFaces, loadPeople }) }));
vi.mock('../../../../src/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));

import { useProfileSuggestions, PAGE_SIZE, POLL_MS } from '../../../../src/hooks/useProfileSuggestions';

const invoke = vi.fn();

const faceTile = (faceId: number) => ({
    faceId, photoId: faceId * 10, box: { x: 1, y: 2, width: 3, height: 4 }, yaw: 60, quality: 0.5, blur: 100,
    filePath: `p${faceId}.jpg`, previewPath: null, photoWidth: 100, photoHeight: 100,
});
const row = (faceId: number, personId: number, extra: Record<string, unknown> = {}) => ({
    faceId, photoId: faceId * 10, tile: faceTile(faceId),
    person: { personId, name: `Person ${personId}`, distance: 0.8 }, also: null, examples: [faceTile(900 + personId)], frontal: faceTile(950 + personId), ...extra,
});
const overviewOf = (state: string, total: number, extra: Record<string, unknown> = {}) => ({
    state, checked: 10, candidates: 100, examples: 400, peopleWithExamples: 24, total, twoNames: 0,
    byPerson: [{ personId: 10, name: 'Person 10', count: total }], assignedFromList: 0, stale: false,
    settings: { distance: 1.0, defaultDistance: 1.0, minDistance: 0.8, maxDistance: 1.1, distanceChoices: [0.8, 0.9, 1.0, 1.1], minYaw: 40, defaultMinYaw: 40, minYawAllowed: 40, maxYawAllowed: 70 },
    ...extra,
});

/** A fake main process: a list of suggestions, and a search that needs `computeCalls` overview requests before it is ready. */
function mainProcess(initial: ReturnType<typeof row>[], computeCalls = 0) {
    let rows = [...initial];
    let overviewCalls = 0;
    const assigned: number[] = [];
    invoke.mockImplementation(async (channel: string, payload?: Record<string, unknown>) => {
        switch (channel) {
            case 'profile:getOverview':
                overviewCalls++;
                return { success: true, overview: overviewOf(overviewCalls <= computeCalls ? 'computing' : 'ready', rows.length) };
            case 'profile:list': {
                const personId = payload!.personId as number | undefined;
                const all = personId ? rows.filter(r => r.person.personId === personId) : rows;
                return { success: true, rows: all.slice(payload!.offset as number, (payload!.offset as number) + (payload!.limit as number)) };
            }
            case 'profile:assign': {
                const pairs = payload!.pairs as { faceId: number; personId: number }[];
                const done = pairs.filter(p => rows.some(r => r.faceId === p.faceId));
                rows = rows.filter(r => !done.some(p => p.faceId === r.faceId));
                assigned.push(...done.map(p => p.faceId));
                return { success: true, assigned: done, skipped: pairs.length - done.length };
            }
            case 'profile:dismiss': {
                const pairs = payload!.pairs as { faceId: number; personId: number }[];
                rows = rows.filter(r => !pairs.some(p => p.faceId === r.faceId));
                return { success: true, dismissed: pairs.length, skipped: 0 };
            }
            case 'profile:undo': {
                const ids = payload!.faceIds as number[];
                return { success: true, restored: ids.map(faceId => ({ faceId, personId: 10 })) };
            }
            case 'profile:setDistance':
                return { success: true, overview: overviewOf('ready', rows.length, { settings: { ...overviewOf('ready', 0).settings, distance: payload!.distance } }) };
            case 'profile:setMinYaw':
                return { success: true, overview: overviewOf('ready', rows.length) };
            case 'profile:refresh':
                return { success: true, overview: overviewOf('computing', rows.length) };
            default:
                throw new Error(`unexpected channel ${channel}`);
        }
    });
    return { assigned };
}

const calls = (channel: string) => invoke.mock.calls.filter(([name]) => name === channel).map(([, payload]) => payload);

beforeEach(() => {
    invoke.mockReset();
    loadFaces.mockReset();
    loadPeople.mockReset();
    addToast.mockReset();
    (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
});
afterEach(() => vi.useRealTimers());

async function mounted(enabled = true, personId?: number) {
    const hook = renderHook(({ on, person }: { on: boolean; person?: number }) => useProfileSuggestions({ enabled: on, personId: person }), { initialProps: { on: enabled, person: personId } });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    return hook;
}

describe('useProfileSuggestions', () => {
    it('does nothing until the tab is open', async () => {
        mainProcess([row(1, 10)]);

        await mounted(false);

        expect(invoke).not.toHaveBeenCalled();
    });

    it('loads the overview and the first page when the tab opens', async () => {
        mainProcess([row(1, 10), row(2, 10)]);

        const { result } = await mounted();

        expect(result.current.overview?.state).toBe('ready');
        expect(result.current.rows.map(r => r.faceId)).toEqual([1, 2]);
        expect(calls('profile:list')[0]).toEqual({ offset: 0, limit: PAGE_SIZE });
    });

    it('asks again while the search is running, then shows the list', async () => {
        vi.useFakeTimers();
        mainProcess([row(1, 10)], 2);

        const { result } = await mounted();
        expect(result.current.overview?.state).toBe('computing');
        expect(result.current.rows).toEqual([]);

        await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
        expect(result.current.overview?.state).toBe('computing');
        await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });

        expect(result.current.overview?.state).toBe('ready');
        expect(result.current.rows.map(r => r.faceId)).toEqual([1]);
    });

    it('limits the list to one person when asked (the button on the person page)', async () => {
        mainProcess([row(1, 10), row(2, 11)]);

        const { result } = await mounted(true, 11);

        expect(calls('profile:list')[0]).toEqual({ offset: 0, limit: PAGE_SIZE, personId: 11 });
        expect(result.current.rows.map(r => r.faceId)).toEqual([2]);
    });

    describe('choosing', () => {
        it('select all leaves out the faces with two names; those are chosen one by one', async () => {
            mainProcess([row(1, 10), row(2, 10, { also: { personId: 11, name: 'Person 11', distance: 0.95 } })]);
            const { result } = await mounted();

            act(() => result.current.selectAllLoaded());
            expect([...result.current.selectedIds]).toEqual([1]);

            act(() => result.current.toggle(2));
            expect([...result.current.selectedIds].sort()).toEqual([1, 2]);
        });

        it('assigns the selected faces to their suggested people, takes them off the list and offers Undo', async () => {
            mainProcess([row(1, 10), row(2, 11), row(3, 10)]);
            const { result } = await mounted();
            act(() => { result.current.toggle(1); result.current.toggle(2); });

            await act(async () => { await result.current.assignSelected(); });

            expect(calls('profile:assign')).toEqual([{ pairs: [{ faceId: 1, personId: 10 }, { faceId: 2, personId: 11 }] }]);
            expect(result.current.rows.map(r => r.faceId)).toEqual([3]);
            expect(result.current.undoBatch).toEqual([1, 2]);
            expect(result.current.selectedIds.size).toBe(0);
            expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', description: expect.stringContaining('2 faces') }));
            expect(loadFaces).toHaveBeenCalled();
            expect(loadPeople).toHaveBeenCalled();
        });

        it('assigns one face to the other name of a two-name face', async () => {
            mainProcess([row(1, 10, { also: { personId: 11, name: 'Person 11', distance: 0.95 } })]);
            const { result } = await mounted();

            await act(async () => { await result.current.assignTo(1, 11); });

            expect(calls('profile:assign')).toEqual([{ pairs: [{ faceId: 1, personId: 11 }] }]);
            expect(result.current.rows).toEqual([]);
        });

        it('says so and keeps the list when the assignment fails', async () => {
            mainProcess([row(1, 10)]);
            const { result } = await mounted();
            invoke.mockImplementation(async (channel: string) => (channel === 'profile:assign' ? { success: false, error: 'locked' } : { success: true, rows: [row(1, 10)], overview: overviewOf('ready', 1) }));
            act(() => result.current.toggle(1));

            await act(async () => { await result.current.assignSelected(); });

            expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', description: expect.stringContaining('locked') }));
            expect(result.current.rows.map(r => r.faceId)).toEqual([1]);
            expect(result.current.undoBatch).toBeNull();
        });

        it('"not this person" sends the pairs and reloads the list', async () => {
            mainProcess([row(1, 10), row(2, 10)]);
            const { result } = await mounted();
            act(() => result.current.toggle(1));

            await act(async () => { await result.current.dismissSelected(); });

            expect(calls('profile:dismiss')).toEqual([{ pairs: [{ faceId: 1, personId: 10 }] }]);
            expect(result.current.rows.map(r => r.faceId)).toEqual([2]);
        });

        it('undo returns the last assigned faces and reloads', async () => {
            mainProcess([row(1, 10)]);
            const { result } = await mounted();
            act(() => result.current.toggle(1));
            await act(async () => { await result.current.assignSelected(); });

            await act(async () => { await result.current.undoLast(); });

            expect(calls('profile:undo')).toEqual([{ faceIds: [1] }]);
            expect(result.current.undoBatch).toBeNull();
            expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', description: expect.stringContaining('Returned 1 face') }));
        });
    });

    describe('settings', () => {
        it('saves the distance and shows the list under it', async () => {
            mainProcess([row(1, 10)]);
            const { result } = await mounted();
            invoke.mockClear();

            await act(async () => { await result.current.setDistance(0.9); });

            expect(calls('profile:setDistance')).toEqual([{ distance: 0.9 }]);
            expect(calls('profile:list')).toHaveLength(1);
            expect(result.current.overview?.settings.distance).toBe(0.9);
        });

        it('refresh asks for a new search and polls until it is ready', async () => {
            mainProcess([row(1, 10)]);
            const { result } = await mounted();

            await act(async () => { await result.current.refresh(); });

            expect(calls('profile:refresh')).toHaveLength(1);
            expect(result.current.overview?.state).toBe('computing');
        });
    });

    describe('selecting many faces', () => {
        it('selects a range on shift-click but leaves out faces with two names, which are chosen one by one', async () => {
            const two = { personId: 11, name: 'Person 11', distance: 0.95 };
            mainProcess([row(1, 10), row(2, 10, { also: two }), row(3, 10), row(4, 10)]);
            const { result } = await mounted();
            expect(result.current.rows).toHaveLength(4);
            act(() => result.current.toggle(1));

            act(() => result.current.toggle(4, true));

            expect([...result.current.selectedIds].sort((a, b) => a - b)).toEqual([1, 3, 4]);
        });

        it('loads the next page and selects the faces it added, except those with two names', async () => {
            const two = { personId: 11, name: 'Person 11', distance: 0.95 };
            const faces = Array.from({ length: PAGE_SIZE + 3 }, (_, i) => row(i + 1, 10, i === PAGE_SIZE + 1 ? { also: two } : {}));
            mainProcess(faces);
            const { result } = await mounted();
            expect(result.current.rows).toHaveLength(PAGE_SIZE);

            await act(async () => { await result.current.loadMoreAndSelect(); });

            expect(result.current.rows).toHaveLength(PAGE_SIZE + 3);
            expect([...result.current.selectedIds].sort((a, b) => a - b)).toEqual([PAGE_SIZE + 1, PAGE_SIZE + 3]);
        });
    });
});
