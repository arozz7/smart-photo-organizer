import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { useCtrlScroll } from './useCtrlScroll';
import { useToast } from '../context/ToastContext';

const GRID_MIN = 4;
const GRID_MAX = 12;
const STORAGE_PREFIX = 'spo:grid:';

function readStorage(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (raw === null) return fallback;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(GRID_MAX, Math.max(GRID_MIN, parsed));
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

export interface DynamicGridOptions {
  /** localStorage sub-key (prefixed with 'spo:grid:' automatically) */
  storageKey: string;
  /** Column count to use on first load when no persisted value exists */
  default: number;
  /** Minimum columns (default: 4) */
  min?: number;
  /** Maximum columns (default: 12) */
  max?: number;
}

export interface DynamicGridResult {
  /** Current column count */
  cols: number;
  /**
   * Callback ref — attach to the element that should capture Ctrl+scroll events.
   * Using a callback ref (instead of useRef) ensures the wheel listener is attached
   * even when the element is conditionally rendered or behind an async data load.
   */
  containerRef: (node: HTMLDivElement | null) => void;
  /**
   * Apply directly to the grid element.
   * Sets display:grid + gridTemplateColumns + gap.
   * Replaces static Tailwind grid-cols-* classes.
   */
  gridStyle: CSSProperties;
}

/**
 * Per-view dynamic grid size hook.
 *
 * Usage:
 *   const { cols, containerRef, gridStyle } = useDynamicGrid({ storageKey: 'allFaces', default: 8 });
 *
 *   <div ref={containerRef}>          // captures Ctrl+scroll
 *     <div style={gridStyle}>         // replaces className="grid grid-cols-8 gap-2"
 *       {items}
 *     </div>
 *   </div>
 */
export function useDynamicGrid(options: DynamicGridOptions): DynamicGridResult {
  const { storageKey, default: defaultCols, min = GRID_MIN, max = GRID_MAX } = options;
  const { addToast } = useToast();

  const [cols, setCols] = useState<number>(() => {
    const stored = readStorage(storageKey, defaultCols);
    // Apply custom min/max on top of the global-constant clamp in readStorage
    return Math.min(max, Math.max(min, stored));
  });

  // Callback ref: when React attaches/detaches the DOM node it calls this function,
  // which updates containerEl state. That state change re-runs the useCtrlScroll
  // effect with the real element — fixing the "ref was null on first render" problem
  // that occurs with early returns (loading states) and conditional rendering.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
  }, []);

  const zoomIn = useCallback(() => {
    setCols(prev => {
      if (prev >= max) return prev;
      const next = prev + 1;
      writeStorage(storageKey, next);
      addToast({ type: 'info', description: `Grid: ${next} columns`, duration: 1000 });
      return next;
    });
  }, [storageKey, max, addToast]);

  const zoomOut = useCallback(() => {
    setCols(prev => {
      if (prev <= min) return prev;
      const next = prev - 1;
      writeStorage(storageKey, next);
      addToast({ type: 'info', description: `Grid: ${next} columns`, duration: 1000 });
      return next;
    });
  }, [storageKey, min, addToast]);

  useCtrlScroll(containerEl, zoomIn, zoomOut);

  const gridStyle = useMemo<CSSProperties>(
    () => ({
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gap: '0.5rem',
    }),
    [cols],
  );

  return { cols, containerRef, gridStyle };
}
