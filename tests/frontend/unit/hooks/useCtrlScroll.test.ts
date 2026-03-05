/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useCtrlScroll } from '../../../../src/hooks/useCtrlScroll';

describe('useCtrlScroll', () => {
    let container: HTMLDivElement;
    let onZoomIn: ReturnType<typeof vi.fn>;
    let onZoomOut: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        onZoomIn = vi.fn();
        onZoomOut = vi.fn();
    });

    afterEach(() => {
        if (container.parentNode) document.body.removeChild(container);
        vi.clearAllMocks();
    });

    function renderAndAttach() {
        const { result } = renderHook(() => {
            useCtrlScroll(container, onZoomIn, onZoomOut);
        });
        return result;
    }

    function wheel(deltaY: number, ctrlKey: boolean) {
        const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
        Object.defineProperty(event, 'ctrlKey', { value: ctrlKey, configurable: true });
        container.dispatchEvent(event);
    }

    it('calls onZoomIn when Ctrl+scroll up (deltaY < 0)', () => {
        renderAndAttach();
        wheel(-100, true);
        expect(onZoomIn).toHaveBeenCalledTimes(1);
        expect(onZoomOut).not.toHaveBeenCalled();
    });

    it('calls onZoomOut when Ctrl+scroll down (deltaY > 0)', () => {
        renderAndAttach();
        wheel(100, true);
        expect(onZoomOut).toHaveBeenCalledTimes(1);
        expect(onZoomIn).not.toHaveBeenCalled();
    });

    it('does not fire when ctrlKey is false', () => {
        renderAndAttach();
        wheel(-100, false);
        wheel(100, false);
        expect(onZoomIn).not.toHaveBeenCalled();
        expect(onZoomOut).not.toHaveBeenCalled();
    });

    it('debounces — ignores second event within cooldown window', () => {
        vi.useFakeTimers();
        renderAndAttach();

        wheel(-100, true);
        wheel(-100, true); // within 80ms debounce

        expect(onZoomIn).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    it('allows firing again after debounce cooldown elapses', () => {
        vi.useFakeTimers();
        renderAndAttach();

        wheel(-100, true);
        vi.advanceTimersByTime(100);
        wheel(-100, true);

        expect(onZoomIn).toHaveBeenCalledTimes(2);

        vi.useRealTimers();
    });

    it('ignores deltaY === 0', () => {
        renderAndAttach();
        wheel(0, true);
        expect(onZoomIn).not.toHaveBeenCalled();
        expect(onZoomOut).not.toHaveBeenCalled();
    });
});
