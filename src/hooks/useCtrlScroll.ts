import { useEffect, useRef } from 'react';

const DEBOUNCE_MS = 80;

/**
 * Attaches a Ctrl+scroll wheel listener to a container element.
 * Calls onZoomIn (scroll up) or onZoomOut (scroll down) only when Ctrl is held.
 * Uses capture phase to intercept before VirtuosoGrid's own scroll handler.
 * Debounced to DEBOUNCE_MS to prevent skipping multiple columns per scroll tick.
 *
 * Accepts the raw element (not a ref object) so the effect re-runs when the
 * element actually mounts — works correctly with callback refs and conditional rendering.
 */
export function useCtrlScroll(
  el: HTMLDivElement | null,
  onZoomIn: () => void,
  onZoomOut: () => void,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep callbacks in refs so the listener never goes stale without re-attaching
  const onZoomInRef = useRef(onZoomIn);
  const onZoomOutRef = useRef(onZoomOut);
  onZoomInRef.current = onZoomIn;
  onZoomOutRef.current = onZoomOut;

  useEffect(() => {
    if (!el) return;

    const handler = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();

      // Debounce: ignore subsequent ticks within cooldown window
      if (timerRef.current !== null) return;

      if (event.deltaY < 0) {
        onZoomInRef.current();
      } else if (event.deltaY > 0) {
        onZoomOutRef.current();
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
      }, DEBOUNCE_MS);
    };

    // capture:true — fires before VirtuosoGrid's own scroll handler
    // passive:false — required to call preventDefault()
    el.addEventListener('wheel', handler, { capture: true, passive: false });

    return () => {
      el.removeEventListener('wheel', handler, { capture: true });
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [el]);
}
