/**
 * @vitest-environment happy-dom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppVersion } from '../../../../src/hooks/useAppVersion';

const invoke = vi.fn();

beforeEach(() => {
    invoke.mockReset();
    (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
});

describe('useAppVersion', () => {
    it('returns an empty label until the app version arrives', () => {
        invoke.mockReturnValue(new Promise(() => { /* never resolves */ }));

        const { result } = renderHook(() => useAppVersion());

        expect(result.current).toBe('');
    });

    it('returns the running app version with a leading v', async () => {
        invoke.mockResolvedValue('0.8.2');

        const { result } = renderHook(() => useAppVersion());

        await waitFor(() => expect(result.current).toBe('v0.8.2'));
        expect(invoke).toHaveBeenCalledWith('app:getVersion');
    });

    it('shows no label (instead of a wrong one) when the version cannot be read', async () => {
        invoke.mockRejectedValue(new Error('no handler'));

        const { result } = renderHook(() => useAppVersion());

        await waitFor(() => expect(invoke).toHaveBeenCalled());
        expect(result.current).toBe('');
    });
});
