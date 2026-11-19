/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useRematch } from '../../../../src/hooks/useRematch';

const invoke = vi.fn();

const idle = {
    running: false,
    autoEnabled: true,
    threshold: 0.65,
    followsAutoAssign: true,
    autoAssignDistance: 0.65,
    checked: 0,
    total: 0,
    matched: 0,
    undoable: 0,
    lastRun: null,
};
const running = { ...idle, running: true, checked: 300, total: 1000, matched: 12 };

beforeEach(() => {
    invoke.mockReset();
    (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useRematch', () => {
    it('loads the status when it opens', async () => {
        invoke.mockResolvedValue({ success: true, status: { ...idle, undoable: 5 } });

        const { result } = renderHook(() => useRematch());

        await waitFor(() => expect(result.current.status?.undoable).toBe(5));
        expect(invoke).toHaveBeenCalledWith('rematch:getStatus');
    });

    it('starts a run and shows the new status', async () => {
        invoke.mockImplementation(async (channel: string) => {
            if (channel === 'rematch:run') return { success: true, started: true, status: running };
            return { success: true, status: idle };
        });
        const { result } = renderHook(() => useRematch());
        await waitFor(() => expect(result.current.status).not.toBeNull());

        await act(async () => { await result.current.run(); });

        expect(result.current.status?.running).toBe(true);
        expect(result.current.message).toBeNull();
    });

    it.each([
        ['busy', 'A scan or AI work is running'],
        ['nobody-named', 'Name at least one person first'],
        ['already-running', 'already running'],
    ])('explains why a run did not start (%s)', async (reason, text) => {
        invoke.mockImplementation(async (channel: string) => {
            if (channel === 'rematch:run') return { success: false, started: false, reason, status: idle };
            return { success: true, status: idle };
        });
        const { result } = renderHook(() => useRematch());
        await waitFor(() => expect(result.current.status).not.toBeNull());

        await act(async () => { await result.current.run(); });

        expect(result.current.message).toContain(text);
    });

    it('turns the automatic switch on and off', async () => {
        invoke.mockImplementation(async (channel: string, payload?: { enabled: boolean }) => {
            if (channel === 'rematch:setAuto') return { success: true, status: { ...idle, autoEnabled: payload!.enabled } };
            return { success: true, status: idle };
        });
        const { result } = renderHook(() => useRematch());
        await waitFor(() => expect(result.current.status).not.toBeNull());

        await act(async () => { await result.current.setAuto(false); });

        expect(invoke).toHaveBeenCalledWith('rematch:setAuto', { enabled: false });
        expect(result.current.status?.autoEnabled).toBe(false);
    });

    it('changes the distance and shows the status that comes back', async () => {
        invoke.mockImplementation(async (channel: string, payload?: { distance: number }) => {
            if (channel === 'rematch:setDistance') return { success: true, status: { ...idle, threshold: payload!.distance } };
            return { success: true, status: idle };
        });
        const { result } = renderHook(() => useRematch());
        await waitFor(() => expect(result.current.status).not.toBeNull());

        await act(async () => { await result.current.setDistance(0.7); });

        expect(invoke).toHaveBeenCalledWith('rematch:setDistance', { distance: 0.7 });
        expect(result.current.status?.threshold).toBe(0.7);
    });

    it('goes back to following Auto-Assign when told to clear the pinned distance', async () => {
        invoke.mockImplementation(async (channel: string) => ({ success: true, status: { ...idle, followsAutoAssign: channel === 'rematch:setDistance' } }));
        const { result } = renderHook(() => useRematch());
        await waitFor(() => expect(result.current.status).not.toBeNull());

        await act(async () => { await result.current.setDistance(null); });

        expect(invoke).toHaveBeenCalledWith('rematch:setDistance', { distance: null });
        expect(result.current.status?.followsAutoAssign).toBe(true);
    });

    it('shows why a distance was refused and keeps the old status', async () => {
        invoke.mockImplementation(async (channel: string) => {
            if (channel === 'rematch:setDistance') return { success: false, error: 'The distance must be between 0.4 and 0.8' };
            return { success: true, status: idle };
        });
        const { result } = renderHook(() => useRematch());
        await waitFor(() => expect(result.current.status).not.toBeNull());

        await act(async () => { await result.current.setDistance(0.95); });

        expect(result.current.message).toContain('between 0.4 and 0.8');
        expect(result.current.status?.threshold).toBe(0.65);
    });

    it('reports how many faces an undo returned', async () => {
        invoke.mockImplementation(async (channel: string) => {
            if (channel === 'rematch:undo') return { success: true, undone: 42, status: idle };
            return { success: true, status: { ...idle, undoable: 42 } };
        });
        const { result } = renderHook(() => useRematch());
        await waitFor(() => expect(result.current.status?.undoable).toBe(42));

        await act(async () => { await result.current.undo(); });

        expect(result.current.message).toContain('42');
        expect(result.current.status?.undoable).toBe(0);
    });

    it('keeps refreshing while a run is under way and stops when it ends', async () => {
        vi.useFakeTimers();
        let current = running;
        invoke.mockImplementation(async () => ({ success: true, status: current }));

        const { result } = renderHook(() => useRematch());
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(result.current.status?.running).toBe(true);

        current = { ...idle, lastRun: { completedAt: '2026-11-18T10:00:00Z', fingerprint: 'x', threshold: 0.65, matched: 12, checked: 1000 } };
        await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
        expect(result.current.status?.running).toBe(false);

        const callsWhenStopped = invoke.mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
        expect(invoke.mock.calls.length).toBe(callsWhenStopped);
    });

    it('shows a failure to read the status', async () => {
        invoke.mockRejectedValue(new Error('no handler'));

        const { result } = renderHook(() => useRematch());

        await waitFor(() => expect(result.current.message).toContain('no handler'));
    });
});
