import { useCallback, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useCtrlScroll } from './useCtrlScroll';
import { useToast } from '../context/ToastContext';

const ITEM_MIN = 80;
const ITEM_MAX = 300;
const ITEM_STEP = 20;
const STORAGE_PREFIX = 'spo:flex:';

function readStorage(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (raw === null) return fallback;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(ITEM_MAX, Math.max(ITEM_MIN, parsed));
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: number): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, String(value));
  } catch {
    // ignore quota / private browsing errors
  }
}

export interface FlexZoomOptions {
  /** localStorage sub-key (prefixed with 'spo:flex:' automatically) */
  storageKey: string;
  /** Item size (px) to use on first load when no persisted value exists */
  default: number;
  /** Minimum item size in px (default: 80) */
  min?: number;
  /** Maximum item size in px (default: 300) */
  max?: number;
  /** Step size in px per scroll tick (default: 20) */
  step?: number;
}

export interface FlexZoomResult {
  /** Current item size in pixels */
  itemSize: number;
  /** Attach to the outermost scrollable wrapper — captures Ctrl+scroll events */
  containerRef: RefObject<HTMLDivElement>;
  /**
   * Apply to each thumbnail item.
   * Sets width + height to itemSize.
   * Replaces hardcoded width/height style values.
   */
  itemStyle: CSSProperties;
}

/**
 * Per-view photo thumbnail size hook for flex-wrap grids (Library, Search).
 * Ctrl+scroll adjusts item pixel size rather than column count.
 *
 * Usage:
 *   const { itemSize, containerRef, itemStyle } = useFlexZoom({ storageKey: 'library', default: 150 });
 *
 *   <div ref={containerRef}>               // captures Ctrl+scroll
 *     <VirtuosoGrid
 *       itemContent={() => (
 *         <div style={itemStyle}>          // replaces hardcoded width/height
 *           <img ... />
 *         </div>
 *       )}
 *     />
 *   </div>
 */
export function useFlexZoom(options: FlexZoomOptions): FlexZoomResult {
  const {
    storageKey,
    default: defaultSize,
    min = ITEM_MIN,
    max = ITEM_MAX,
    step = ITEM_STEP,
  } = options;
  const { addToast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);

  const [itemSize, setItemSize] = useState<number>(() => readStorage(storageKey, defaultSize));

  const zoomIn = useCallback(() => {
    setItemSize(prev => {
      if (prev >= max) return prev;
      const next = Math.min(max, prev + step);
      writeStorage(storageKey, next);
      addToast({ type: 'info', description: `Photo size: ${next}px`, duration: 1000 });
      return next;
    });
  }, [storageKey, max, step, addToast]);

  const zoomOut = useCallback(() => {
    setItemSize(prev => {
      if (prev <= min) return prev;
      const next = Math.max(min, prev - step);
      writeStorage(storageKey, next);
      addToast({ type: 'info', description: `Photo size: ${next}px`, duration: 1000 });
      return next;
    });
  }, [storageKey, min, step, addToast]);

  useCtrlScroll(containerRef, zoomIn, zoomOut);

  const itemStyle = useMemo<CSSProperties>(
    () => ({ width: `${itemSize}px`, height: `${itemSize}px` }),
    [itemSize],
  );

  return { itemSize, containerRef, itemStyle };
}
