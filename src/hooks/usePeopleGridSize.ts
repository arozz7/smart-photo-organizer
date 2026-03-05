import { useDynamicGrid, type DynamicGridResult } from './useDynamicGrid';

/**
 * Convenience hook for People.tsx — wraps useDynamicGrid for all grid sub-views.
 * Each sub-view gets its own independent column count and localStorage key.
 *
 * Usage in People.tsx:
 *   const { identified, singles, ignored, background, ungroupable } = usePeopleGridSize();
 *   <div ref={identified.containerRef} style={identified.gridStyle}>...</div>
 */
export interface PeopleGridSizeResult {
  identified: DynamicGridResult;
  singles: DynamicGridResult;
  ignored: DynamicGridResult;
  background: DynamicGridResult;
  ungroupable: DynamicGridResult;
}

export function usePeopleGridSize(): PeopleGridSizeResult {
  const identified = useDynamicGrid({ storageKey: 'people:identified', default: 6 });
  const singles = useDynamicGrid({ storageKey: 'people:singles', default: 8 });
  const ignored = useDynamicGrid({ storageKey: 'people:ignored', default: 6 });
  const background = useDynamicGrid({ storageKey: 'people:background', default: 6 });
  const ungroupable = useDynamicGrid({ storageKey: 'people:ungroupable', default: 8 });

  return { identified, singles, ignored, background, ungroupable };
}
