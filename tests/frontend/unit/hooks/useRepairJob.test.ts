/**
 * @vitest-environment happy-dom
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useRepairJob } from '../../../../src/hooks/useRepairJob';
import { mockIpcRenderer } from '../../setup';

describe('useRepairJob', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not poll when jobId is null', async () => {
        const onDone = vi.fn();
        const onError = vi.fn();

        renderHook(() => useRepairJob(null, onDone, onError));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5_000);
        });

        expect(mockIpcRenderer.invoke).not.toHaveBeenCalled();
    });

    it('polls prs:pollStatus immediately when jobId is set', async () => {
        mockIpcRenderer.invoke.mockResolvedValue({
            jobId: 'j1',
            status: 'running',
            percent: 30,
            stage: 'scanning',
        });

        renderHook(() => useRepairJob('j1', vi.fn(), vi.fn()));

        // Flush the immediate poll (it fires synchronously before setInterval)
        await act(async () => {
            await Promise.resolve(); // resolve the invoke mock
        });

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('prs:pollStatus', { jobId: 'j1' });
    });

    it('polls again after 2s interval', async () => {
        mockIpcRenderer.invoke.mockResolvedValue({ jobId: 'j1', status: 'running', percent: 10 });

        renderHook(() => useRepairJob('j1', vi.fn(), vi.fn()));

        // First poll
        await act(async () => { await Promise.resolve(); });

        const countAfterFirst = mockIpcRenderer.invoke.mock.calls.length;

        // Second poll
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2_100);
            await Promise.resolve();
        });

        expect(mockIpcRenderer.invoke.mock.calls.length).toBeGreaterThan(countAfterFirst);
    });

    it('calls onDone when poll returns done status', async () => {
        const doneStatus = { jobId: 'j1', status: 'done', percent: 100, result: { outputPath: '/out.jpg' } };
        mockIpcRenderer.invoke.mockResolvedValue(doneStatus);

        const onDone = vi.fn();
        const onError = vi.fn();

        renderHook(() => useRepairJob('j1', onDone, onError));

        await act(async () => {
            await Promise.resolve(); // let poll() run and resolve
            await Promise.resolve(); // let state updates process
        });

        expect(onDone).toHaveBeenCalledWith(doneStatus);
        expect(onError).not.toHaveBeenCalled();
    });

    it('calls onError when poll returns failed status', async () => {
        mockIpcRenderer.invoke.mockResolvedValue({
            jobId: 'j1',
            status: 'failed',
            error: 'unrecoverable error',
        });

        const onDone = vi.fn();
        const onError = vi.fn();

        renderHook(() => useRepairJob('j1', onDone, onError));

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(onError).toHaveBeenCalledWith('unrecoverable error');
        expect(onDone).not.toHaveBeenCalled();
    });

    it('reflects percent and stage from poll response', async () => {
        mockIpcRenderer.invoke.mockResolvedValue({
            jobId: 'j1',
            status: 'running',
            percent: 55,
            stage: 'decoding',
        });

        const { result } = renderHook(() => useRepairJob('j1', vi.fn(), vi.fn()));

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(result.current.percent).toBe(55);
        expect(result.current.stage).toBe('decoding');
    });

    it('stops polling when jobId changes to null', async () => {
        mockIpcRenderer.invoke.mockResolvedValue({ jobId: 'j1', status: 'running', percent: 10 });

        const { rerender } = renderHook(
            ({ jobId }: { jobId: string | null }) => useRepairJob(jobId, vi.fn(), vi.fn()),
            { initialProps: { jobId: 'j1' as string | null } },
        );

        await act(async () => { await Promise.resolve(); });
        const callsBefore = mockIpcRenderer.invoke.mock.calls.length;

        rerender({ jobId: null });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5_000);
            await Promise.resolve();
        });

        expect(mockIpcRenderer.invoke.mock.calls.length).toBe(callsBefore);
    });
});
