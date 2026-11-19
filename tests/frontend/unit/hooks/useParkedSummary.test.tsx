/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useParkedSummary } from '../../../../src/hooks/useParkedSummary';

const invoke = vi.fn();

const summary = {
    unassigned: 100,
    lowQuality: 20,
    singleton: 50,
    nearNamed: 3,
    parked: 70,
    worthReviewing: 30,
    sameShotOnly: 4,
    nearNamedByDistance: [{ distance: 0.5, count: 1 }, { distance: 0.8, count: 3 }],
    singletonAtAlternativeDistance: 45,
    settings: { minFaceArea: 8000, minBlurScore: 60, twinDistance: 0.5, alternativeTwinDistance: 0.58, suggestionDistance: 0.8, duplicateDistance: 0.001 },
};

beforeEach(() => {
    invoke.mockReset();
    (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
});

describe('useParkedSummary', () => {
    it('on opening only asks for the saved result, so nothing heavy starts', async () => {
        invoke.mockResolvedValue({ success: true, status: 'stale', summary: null });

        renderHook(() => useParkedSummary());

        await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
        expect(invoke).toHaveBeenCalledWith('db:getParkedSummary', { cachedOnly: true });
    });

    it('shows a saved result that is still current', async () => {
        invoke.mockResolvedValue({ success: true, status: 'ready', summary, computedAt: '2026-11-18T12:00:00.000Z', fromCache: true });

        const { result } = renderHook(() => useParkedSummary());

        await waitFor(() => expect(result.current.summary).toEqual(summary));
        expect(result.current.isCurrent).toBe(true);
        expect(result.current.computedAt).toBe('2026-11-18T12:00:00.000Z');
    });

    it('shows an out-of-date saved result as out of date', async () => {
        invoke.mockResolvedValue({ success: true, status: 'stale', summary, computedAt: '2026-11-17T12:00:00.000Z' });

        const { result } = renderHook(() => useParkedSummary());

        await waitFor(() => expect(result.current.summary).toEqual(summary));
        expect(result.current.isCurrent).toBe(false);
    });

    it('measures on request, shows that it is working, then shows the new result', async () => {
        invoke.mockResolvedValueOnce({ success: true, status: 'stale', summary: null });
        let finish: (value: unknown) => void = () => undefined;
        invoke.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const { result } = renderHook(() => useParkedSummary());
        await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

        act(() => { void result.current.measure(); });
        await waitFor(() => expect(result.current.isMeasuring).toBe(true));
        expect(invoke).toHaveBeenLastCalledWith('db:getParkedSummary', { refresh: true });

        await act(async () => {
            finish({ success: true, status: 'ready', summary, computedAt: '2026-11-18T12:05:00.000Z', fromCache: false });
        });

        expect(result.current.isMeasuring).toBe(false);
        expect(result.current.summary).toEqual(summary);
        expect(result.current.isCurrent).toBe(true);
    });

    it('explains that it is waiting when a scan or AI work is running, and keeps what it had', async () => {
        invoke.mockResolvedValueOnce({ success: true, status: 'ready', summary, computedAt: 'x', fromCache: true });
        invoke.mockResolvedValueOnce({ success: true, status: 'busy', summary });
        const { result } = renderHook(() => useParkedSummary());
        await waitFor(() => expect(result.current.summary).toEqual(summary));

        await act(async () => { await result.current.measure(); });

        expect(result.current.isBusy).toBe(true);
        expect(result.current.summary).toEqual(summary);
        expect(result.current.error).toBeNull();
    });

    it('reports an error when measuring fails, and keeps what it had', async () => {
        invoke.mockResolvedValueOnce({ success: true, status: 'ready', summary, computedAt: 'x', fromCache: true });
        invoke.mockResolvedValueOnce({ success: false, status: 'failed', error: 'AI backend not running' });
        const { result } = renderHook(() => useParkedSummary());
        await waitFor(() => expect(result.current.summary).toEqual(summary));

        await act(async () => { await result.current.measure(); });

        expect(result.current.error).toBe('AI backend not running');
        expect(result.current.isMeasuring).toBe(false);
        expect(result.current.summary).toEqual(summary);
    });

    it('reports an error when the request itself throws', async () => {
        invoke.mockResolvedValueOnce({ success: true, status: 'stale', summary: null });
        invoke.mockRejectedValueOnce(new Error('no handler'));
        const { result } = renderHook(() => useParkedSummary());
        await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

        await act(async () => { await result.current.measure(); });

        expect(result.current.error).toBe('no handler');
        expect(result.current.isMeasuring).toBe(false);
    });

    it('shows nothing, without an error, when the saved result cannot be read on opening', async () => {
        invoke.mockRejectedValue(new Error('no handler'));

        const { result } = renderHook(() => useParkedSummary());

        await waitFor(() => expect(invoke).toHaveBeenCalled());
        expect(result.current.summary).toBeNull();
        expect(result.current.error).toBeNull();
    });
});
