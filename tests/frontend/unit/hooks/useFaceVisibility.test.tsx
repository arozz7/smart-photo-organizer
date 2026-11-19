/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useFaceVisibility, REFRESH_MS, type VisibilityStatus } from '../../../../src/hooks/useFaceVisibility';

const invoke = vi.fn();

const status = (extra: Partial<VisibilityStatus> = {}): VisibilityStatus => ({
    mode: 'away', awayMinutes: 5, state: 'waiting-away', candidates: 1000, scored: 100, failed: 2, remaining: 898, lastError: null, ...extra,
});

beforeEach(() => {
    invoke.mockReset();
    (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useFaceVisibility', () => {
    it('loads the status when it opens', async () => {
        invoke.mockResolvedValue({ success: true, status: status() });

        const { result } = renderHook(() => useFaceVisibility());

        await waitFor(() => expect(result.current.status?.scored).toBe(100));
        expect(invoke).toHaveBeenCalledWith('visibility:getStatus');
    });

    it('shows an error when the status cannot be read', async () => {
        invoke.mockResolvedValue({ success: false, error: 'database is locked' });

        const { result } = renderHook(() => useFaceVisibility());

        await waitFor(() => expect(result.current.message).toBe('database is locked'));
        expect(result.current.status).toBeNull();
    });

    it('starts a run and shows the new status', async () => {
        invoke.mockImplementation(async (channel: string) =>
            channel === 'visibility:runNow' ? { success: true, started: true, status: status({ state: 'scoring' }) } : { success: true, status: status() });
        const { result } = renderHook(() => useFaceVisibility());
        await waitFor(() => expect(result.current.status).not.toBeNull());

        await act(async () => { await result.current.runNow(); });

        expect(result.current.status?.state).toBe('scoring');
        expect(result.current.message).toBeNull();
    });

    it.each([
        ['busy', 'A scan or AI work is running'],
        ['nothing-to-do', 'Nothing left to check'],
    ])('explains why a run did not start (%s)', async (reason, text) => {
        invoke.mockImplementation(async (channel: string) =>
            channel === 'visibility:runNow' ? { success: false, started: false, reason, status: status() } : { success: true, status: status() });
        const { result } = renderHook(() => useFaceVisibility());
        await waitFor(() => expect(result.current.status).not.toBeNull());

        await act(async () => { await result.current.runNow(); });

        expect(result.current.message).toContain(text);
    });

    it('saves the run mode and the away time', async () => {
        invoke.mockResolvedValue({ success: true, status: status() });
        const { result } = renderHook(() => useFaceVisibility());
        await waitFor(() => expect(result.current.status).not.toBeNull());

        await act(async () => { await result.current.setMode('always'); });
        await act(async () => { await result.current.setAwayMinutes(10); });

        expect(invoke).toHaveBeenCalledWith('visibility:setMode', { mode: 'always' });
        expect(invoke).toHaveBeenCalledWith('visibility:setAwayMinutes', { minutes: 10 });
    });

    it('refreshes by itself while the check is working or about to, but not when it is off or done', async () => {
        vi.useFakeTimers();
        invoke.mockResolvedValue({ success: true, status: status({ state: 'scoring' }) });
        const { result } = renderHook(() => useFaceVisibility());
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(result.current.status?.state).toBe('scoring');
        const first = invoke.mock.calls.length;

        await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_MS); });
        expect(invoke.mock.calls.length).toBeGreaterThan(first);

        invoke.mockResolvedValue({ success: true, status: status({ state: 'done' }) });
        await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_MS); });
        const settled = invoke.mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_MS * 3); });

        expect(invoke.mock.calls.length).toBe(settled);
    });
});
