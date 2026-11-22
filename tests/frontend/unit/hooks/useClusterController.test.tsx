/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useClusterController } from '../../../../src/hooks/useClusterController';

const clusters = [{ faces: [1, 2] }, { faces: [3] }];
const key = (init: Partial<KeyboardEvent> & { key: string }) => new KeyboardEvent('keydown', { cancelable: true, ...init });

describe('useClusterController handleKeyDown', () => {
    it('A accepts, X ignores and N names the focused cluster', () => {
        const { result } = renderHook(() => useClusterController({ clusters }));
        const handlers = { onAccept: vi.fn(), onIgnore: vi.fn(), onName: vi.fn() };

        result.current.handleKeyDown(key({ key: 'a' }), handlers);
        result.current.handleKeyDown(key({ key: 'x' }), handlers);
        result.current.handleKeyDown(key({ key: 'n' }), handlers);

        expect(handlers.onAccept).toHaveBeenCalledWith(0);
        expect(handlers.onIgnore).toHaveBeenCalledWith(0);
        expect(handlers.onName).toHaveBeenCalledWith(0);
    });

    it('does nothing for a key pressed with Ctrl, Cmd or Alt, so Ctrl+A (select all) never accepts a cluster', () => {
        const { result } = renderHook(() => useClusterController({ clusters }));
        const handlers = { onAccept: vi.fn(), onIgnore: vi.fn(), onName: vi.fn() };

        const selectAll = key({ key: 'a', ctrlKey: true });
        result.current.handleKeyDown(selectAll, handlers);
        result.current.handleKeyDown(key({ key: 'a', metaKey: true }), handlers);
        result.current.handleKeyDown(key({ key: 'x', altKey: true }), handlers);

        expect(handlers.onAccept).not.toHaveBeenCalled();
        expect(handlers.onIgnore).not.toHaveBeenCalled();
        expect(selectAll.defaultPrevented).toBe(false);
    });
});
