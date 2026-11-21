/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { loadFaces, loadPeople, refreshUnassignedCount, addToast } = vi.hoisted(() => ({ loadFaces: vi.fn(), loadPeople: vi.fn(), refreshUnassignedCount: vi.fn(), addToast: vi.fn() }));
vi.mock('../../../../src/context/PeopleContext', () => ({ usePeople: () => ({ loadFaces, loadPeople, refreshUnassignedCount }) }));
vi.mock('../../../../src/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));

import { useEdgeCaseSuggestions, pendingEdgeCaseTab } from '../../../../src/hooks/useEdgeCaseSuggestions';
import { requestProfileViews, clearEdgeCaseIntent, pendingEdgeCaseIntent } from '../../../../src/utils/edgeCaseIntent';

const invoke = vi.fn();
const channels = () => invoke.mock.calls.map(([name]) => name as string);
const overview = { state: 'ready', checked: 0, candidates: 0, examples: 5, peopleWithExamples: 1, total: 0, twoNames: 0, byPerson: [], assignedFromList: 0, stale: false, settings: { distance: 1, defaultDistance: 1, minDistance: 0.8, maxDistance: 1.1, distanceChoices: [1], minYaw: 40, defaultMinYaw: 40, minYawAllowed: 40, maxYawAllowed: 70 } };

beforeEach(() => {
    clearEdgeCaseIntent();
    invoke.mockReset();
    invoke.mockImplementation(async (channel: string) => {
        if (channel === 'profile:getOverview') return { success: true, overview };
        if (channel === 'profile:list') return { success: true, rows: [] };
        if (channel === 'nonface:getOverview') return { success: true, overview: { mode: 'detector', current: { total: 9, turned: 2 }, detector: null, model: null, ignoredFromList: 0, hideFromReview: true, hideable: 7, hiddenFromReview: 7 } };
        if (channel === 'nonface:setHide') return { success: true, overview: { mode: 'detector', current: { total: 9, turned: 2 }, detector: null, model: null, ignoredFromList: 0, hideFromReview: false, hideable: 7, hiddenFromReview: 0 } };
        if (channel === 'nonface:list') return { success: true, faces: [] };
        throw new Error(`unexpected ${channel}`);
    });
    (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
});

const mount = async (reloadReview?: () => void) => {
    const hook = renderHook(() => useEdgeCaseSuggestions(reloadReview));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    return hook;
};

describe('useEdgeCaseSuggestions', () => {
    it('opens on Review Needed and loads no turned faces until that tab is chosen', async () => {
        const { result } = await mount();

        expect(result.current.activeFilter).toBe('unnamed');
        expect(channels().filter(name => name.startsWith('profile:'))).toEqual([]);
    });

    it('loads the turned faces when the tab is chosen', async () => {
        const { result } = await mount();

        await act(async () => { result.current.setActiveFilter('profile'); await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        expect(channels()).toContain('profile:getOverview');
    });

    it('opens on Turned faces for one person when the person page asked for it, once', async () => {
        requestProfileViews(7);
        expect(pendingEdgeCaseTab()).toBe('unnamed');

        const first = await mount();

        expect(first.result.current.activeFilter).toBe('profile');
        expect(first.result.current.focusPersonId).toBe(7);
        expect(invoke).toHaveBeenCalledWith('profile:list', { offset: 0, limit: 100, personId: 7 });
        expect(pendingEdgeCaseIntent()).toBeNull();

        const second = await mount();
        expect(second.result.current.activeFilter).toBe('unnamed');
        expect(second.result.current.focusPersonId).toBeNull();
    });

    it('goes back to everyone', async () => {
        requestProfileViews(7);
        const { result } = await mount();

        await act(async () => { result.current.showEveryone(); await Promise.resolve(); });

        expect(result.current.focusPersonId).toBeNull();
    });

    describe('Review Needed after changes made in the other lists', () => {
        it('counts the faces hidden from Review Needed, for the notice under the tabs', async () => {
            const { result } = await mount();

            expect(result.current.counts).toEqual({ nonface: 9, profile: 0, hidden: 7 });
        });

        it('reloads Review Needed when the user goes back to it after changing what is hidden, and not when nothing changed', async () => {
            const reloadReview = vi.fn();
            const { result } = await mount(reloadReview);

            await act(async () => { result.current.setActiveFilter('nonface'); await Promise.resolve(); });
            await act(async () => { result.current.setActiveFilter('unnamed'); await Promise.resolve(); });
            expect(reloadReview).not.toHaveBeenCalled();

            await act(async () => { result.current.setActiveFilter('nonface'); await Promise.resolve(); });
            await act(async () => { await result.current.nonFace.setHideFromReview(false); });
            await act(async () => { result.current.setActiveFilter('unnamed'); await Promise.resolve(); });
            expect(reloadReview).toHaveBeenCalledTimes(1);

            await act(async () => { result.current.setActiveFilter('nonface'); await Promise.resolve(); });
            await act(async () => { result.current.setActiveFilter('unnamed'); await Promise.resolve(); });
            expect(reloadReview).toHaveBeenCalledTimes(1);
        });
    });
});
