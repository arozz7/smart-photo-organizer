import { useEffect, useRef, type RefObject } from 'react';

const DEBOUNCE_MS = 80;

/**
 * Attaches a Ctrl+scroll wheel listener to a container element.
 * Calls onZoomIn (scroll up) or onZoomOut (scroll down) only when Ctrl is held.
 * Uses capture phase to intercept before VirtuosoGrid's own scroll handler.
 * Debounced to DEBOUNCE_MS to prevent skipping multiple columns per scroll tick.
 */
export function useCtrlScroll(
  containerRef: RefObject<HTMLDivElement>,
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
    const el = containerRef.current;
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

    // capture:true — fires before VirtuosoGrid's wheel handler
    // passive:false — required to call preventDefault()
    el.addEventListener('wheel', handler, { capture: true, passive: false });

    return () => {
      el.removeEventListener('wheel', handler, { capture: true });
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [containerRef]);
}
