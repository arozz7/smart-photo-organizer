import { useState, useCallback, useMemo } from 'react';

export interface ClusterType<T = any> {
    faces: number[];
    data?: T; // suggestions, etc.
}

interface UseClusterControllerProps<T> {
    clusters: ClusterType<T>[];
    onSelectionChange?: (selectedIds: Set<number>) => void;
    pageSize?: number;
}

export function useClusterController<T>({
    clusters,
    onSelectionChange,
    pageSize = 100
}: UseClusterControllerProps<T>) {

    // Selection State
    const [selectedFaceIds, setSelectedFaceIds] = useState<Set<number>>(new Set());

    // Navigation State
    const [focusedClusterIndex, setFocusedClusterIndex] = useState(0);

    // Filter/Pagination State
    const [displayedCount, setDisplayedCount] = useState(pageSize);
    const [sizeFilter, setSizeFilter] = useState<'all' | 'large' | 'medium' | 'small'>('all');

    // Derived: Filtered Clusters
    const filteredClusters = useMemo(() => {
        if (sizeFilter === 'all') return clusters;
        return clusters.filter(c => {
            const len = c.faces.length;
            if (sizeFilter === 'large') return len >= 10;
            if (sizeFilter === 'medium') return len >= 5 && len <= 9;
            if (sizeFilter === 'small') return len >= 2 && len <= 4;
            return true;
        });
    }, [clusters, sizeFilter]);

    // Derived: Displayed Clusters (Pagination)
    const displayedClusters = useMemo(() => {
        return filteredClusters.slice(0, displayedCount);
    }, [filteredClusters, displayedCount]);

    const hasMore = filteredClusters.length > displayedCount;
    const remainingCount = filteredClusters.length - displayedCount;

    // Handlers
    const loadMore = useCallback(() => {
        setDisplayedCount(prev => prev + pageSize);
    }, [pageSize]);

    const resetPagination = useCallback(() => {
        setDisplayedCount(pageSize);
        setFocusedClusterIndex(0);
    }, [pageSize]);

    const handleToggleFace = useCallback((id: number) => {
        setSelectedFaceIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            onSelectionChange?.(next);
            return next;
        });
    }, [onSelectionChange]);

    const handleToggleGroup = useCallback((ids: number[]) => {
        setSelectedFaceIds(prev => {
            const next = new Set(prev);
            const allSelected = ids.every(id => next.has(id));

            if (allSelected) {
                ids.forEach(id => next.delete(id));
            } else {
                ids.forEach(id => next.add(id));
            }
            onSelectionChange?.(next);
            return next;
        });
    }, [onSelectionChange]);

    const handleSelectAll = useCallback((select: boolean = true) => {
        if (!select) {
            setSelectedFaceIds(new Set());
            onSelectionChange?.(new Set());
            return;
        }

        const allIds = new Set<number>();
        // Select only from FILTERED clusters (what the user sees)
        filteredClusters.forEach(c => {
            c.faces.forEach(id => allIds.add(id));
        });
        setSelectedFaceIds(allIds);
        onSelectionChange?.(allIds);
    }, [filteredClusters, onSelectionChange]);

    const clearSelection = useCallback(() => {
        setSelectedFaceIds(new Set());
        onSelectionChange?.(new Set());
    }, [onSelectionChange]);

    // Optimistic Logic Helpers
    const removeFacesFromSelection = useCallback((idsToRemove: number[]) => {
        setSelectedFaceIds(prev => {
            const next = new Set(prev);
            let changed = false;
            idsToRemove.forEach(id => {
                if (next.has(id)) {
                    next.delete(id);
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, []);

    // Keyboard Navigation Handlers
    const handleKeyDown = useCallback((e: KeyboardEvent, handlers?: {
        onAccept?: (index: number) => void;
        onIgnore?: (index: number) => void;
        onName?: (index: number) => void;
    }) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

        switch (e.key) {
            case 'ArrowDown':
            case 'j':
                e.preventDefault();
                setFocusedClusterIndex(prev =>
                    Math.min(prev + 1, displayedClusters.length - 1)
                );
                // Scroll into view logic would go here or in the component via effect
                break;
            case 'ArrowUp':
            case 'k':
                e.preventDefault();
                setFocusedClusterIndex(prev => Math.max(prev - 1, 0));
                break;
            case 'a':
            case 'A':
                e.preventDefault();
                handlers?.onAccept?.(focusedClusterIndex);
                break;
            case 'x':
            case 'X':
                e.preventDefault();
                handlers?.onIgnore?.(focusedClusterIndex);
                break;
            case 'n':
            case 'N':
                e.preventDefault();
                handlers?.onName?.(focusedClusterIndex);
                break;
        }
    }, [displayedClusters.length, focusedClusterIndex]);

    return {
        // State
        selectedFaceIds,
        focusedClusterIndex,
        setFocusedClusterIndex,
        sizeFilter,
        setSizeFilter,

        // Data
        allClusters: clusters,
        filteredClusters,
        displayedClusters,
        hasMore,
        remainingCount,

        // Actions
        loadMore,
        resetPagination,
        toggleFace: handleToggleFace,
        toggleGroup: handleToggleGroup,
        selectAll: handleSelectAll,
        clearSelection,
        removeFacesFromSelection,
        setSelectedFaceIds, // Escape hatch if needed

        // Keyboard
        handleKeyDown,
    };
}
