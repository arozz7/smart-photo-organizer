/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { loadFaces, loadPeople, addToast } = vi.hoisted(() => ({ loadFaces: vi.fn(), loadPeople: vi.fn(), addToast: vi.fn() }));
vi.mock('../../../../src/context/PeopleContext', () => ({ usePeople: () => ({ loadFaces, loadPeople }) }));
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
        if (channel === 'nonface:getOverview') return { success: true, overview: { mode: 'detector', current: { total: 0, turned: 0 }, detector: null, model: null, ignoredFromList: 0 } };
        if (channel === 'nonface:list') return { success: true, faces: [] };
        throw new Error(`unexpected ${channel}`);
    });
    (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
});

const mount = async () => {
    const hook = renderHook(() => useEdgeCaseSuggestions());
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
});
