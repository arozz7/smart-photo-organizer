/**
 * @vitest-environment happy-dom
 */
import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useCtrlScroll } from '../../../../src/hooks/useCtrlScroll';

// A minimal test component that attaches the hook to a real div via callback ref
function HookHarness({
    onZoomIn,
    onZoomOut,
}: {
    onZoomIn: () => void;
    onZoomOut: () => void;
}) {
    const [el, setEl] = useState<HTMLDivElement | null>(null);
    useCtrlScroll(el, onZoomIn, onZoomOut);
    return <div ref={setEl} data-testid="container" />;
}

describe('useCtrlScroll', () => {
    let onZoomIn: ReturnType<typeof vi.fn>;
    let onZoomOut: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        onZoomIn = vi.fn();
        onZoomOut = vi.fn();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    function setup() {
        render(<HookHarness onZoomIn={onZoomIn} onZoomOut={onZoomOut} />);
        return screen.getByTestId('container');
    }

    function wheel(el: Element, deltaY: number, ctrlKey: boolean) {
        const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
        Object.defineProperty(event, 'ctrlKey', { value: ctrlKey, configurable: true });
        el.dispatchEvent(event);
    }

    it('calls onZoomIn when Ctrl+scroll up (deltaY < 0)', () => {
        const el = setup();
        wheel(el, -100, true);
        expect(onZoomIn).toHaveBeenCalledTimes(1);
        expect(onZoomOut).not.toHaveBeenCalled();
    });

    it('calls onZoomOut when Ctrl+scroll down (deltaY > 0)', () => {
        const el = setup();
        wheel(el, 100, true);
        expect(onZoomOut).toHaveBeenCalledTimes(1);
        expect(onZoomIn).not.toHaveBeenCalled();
    });

    it('does not fire when ctrlKey is false', () => {
        const el = setup();
        wheel(el, -100, false);
        wheel(el, 100, false);
        expect(onZoomIn).not.toHaveBeenCalled();
        expect(onZoomOut).not.toHaveBeenCalled();
    });

    it('debounces — ignores second event within cooldown window', () => {
        vi.useFakeTimers();
        const el = setup();

        wheel(el, -100, true);
        wheel(el, -100, true); // still within 80ms

        expect(onZoomIn).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    it('allows firing again after debounce cooldown elapses', () => {
        vi.useFakeTimers();
        const el = setup();

        wheel(el, -100, true);
        vi.advanceTimersByTime(100); // past the 80ms cooldown
        wheel(el, -100, true);

        expect(onZoomIn).toHaveBeenCalledTimes(2);

        vi.useRealTimers();
    });

    it('ignores deltaY === 0', () => {
        const el = setup();
        wheel(el, 0, true);
        expect(onZoomIn).not.toHaveBeenCalled();
        expect(onZoomOut).not.toHaveBeenCalled();
    });
});
