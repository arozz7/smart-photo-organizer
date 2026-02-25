import React, { createContext, useContext, type CSSProperties, type ReactNode } from 'react';

/**
 * Lightweight context for sharing a parent view's grid size with deeply nested children.
 * The parent calls useDynamicGrid and wraps children in GridSizeProvider.
 * Children call useGridSize() to consume cols/gridStyle without prop drilling.
 */

export interface GridSizeValue {
  cols: number;
  gridStyle: CSSProperties;
}

const GridSizeContext = createContext<GridSizeValue | null>(null);

export const GridSizeProvider: React.FC<{ value: GridSizeValue; children: ReactNode }> = ({
  value,
  children,
}) => <GridSizeContext.Provider value={value}>{children}</GridSizeContext.Provider>;

export function useGridSize(): GridSizeValue {
  const ctx = useContext(GridSizeContext);
  if (!ctx) throw new Error('useGridSize must be used within a GridSizeProvider');
  return ctx;
}
