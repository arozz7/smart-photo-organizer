import { memo, useCallback, useMemo } from 'react'
import { Virtuoso } from 'react-virtuoso'
import ClusterRow from './ClusterRow'
import { Face } from '../types'

interface ClusterListProps {
    clusters: { faces: number[], suggestion?: any }[]
    selectedFaceIds: Set<number>
    toggleFace: (id: number) => void
    toggleGroup: (ids: number[]) => void
    fetchFacesByIds: (ids: number[]) => Promise<Face[]>
    handleNameGroup: (ids: number[], name: string, confirm?: boolean) => Promise<void>
    handleIgnoreGroup: (ids: number[]) => void
    handleUngroup: (index: number) => void
    handleOpenNaming: (ids: number[]) => Promise<void>
    // Progressive Loading
    hasMoreGroups?: boolean
    remainingGroupCount?: number
    onLoadMore?: () => void
    totalGroupCount?: number
    // Keyboard Navigation
    focusedIndex?: number
    onFocus?: (index: number) => void
    // Suggestion sync
    onSuggestionFound?: (index: number, suggestion: any) => void
}

const ClusterList = memo(({
    clusters, selectedFaceIds, toggleFace, toggleGroup, fetchFacesByIds, handleNameGroup, handleIgnoreGroup, handleUngroup, handleOpenNaming,
    hasMoreGroups, remainingGroupCount, onLoadMore, totalGroupCount,
    focusedIndex, onFocus, onSuggestionFound
}: ClusterListProps) => {

    const renderClusterRow = useCallback((index: number) => {
        const cluster = clusters[index];
        if (!cluster || !cluster.faces || cluster.faces.length === 0) return null;

        return (
            <ClusterRow
                faceIds={cluster.faces}
                initialSuggestion={cluster.suggestion}
                index={index}
                selectedFaceIds={selectedFaceIds}
                toggleFace={toggleFace}
                toggleGroup={toggleGroup}
                fetchFacesByIds={fetchFacesByIds}
                onNameGroup={handleNameGroup}
                onIgnoreGroup={handleIgnoreGroup}
                onUngroup={handleUngroup}
                onOpenNaming={handleOpenNaming}
                isFocused={focusedIndex === index}
                onFocus={onFocus}
                onSuggestionFound={onSuggestionFound}
            />
        );
    }, [clusters, selectedFaceIds, toggleFace, toggleGroup, fetchFacesByIds, handleNameGroup, handleIgnoreGroup, handleUngroup, handleOpenNaming, focusedIndex, onFocus, onSuggestionFound]);

    // Use memo for style to prevent re-renders on every parent render
    const style = useMemo(() => ({ height: '100%', width: '100%' }), []);

    const Footer = useCallback(() => (
        <div className="py-4 flex flex-col items-center gap-2">
            {hasMoreGroups && onLoadMore && (
                <button
                    onClick={onLoadMore}
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    Show {Math.min(100, remainingGroupCount || 0)} More Groups
                </button>
            )}
            {totalGroupCount !== undefined && (
                <span className="text-sm text-gray-500">
                    Showing {clusters.length} of {totalGroupCount} groups
                </span>
            )}
            <div className="h-10" /> {/* Extra space at bottom */}
        </div>
    ), [hasMoreGroups, onLoadMore, remainingGroupCount, totalGroupCount, clusters.length]);

    return (
        <div className="h-[65vh] w-full relative">
            <Virtuoso
                style={style}
                totalCount={clusters.length}
                itemContent={renderClusterRow}
                components={{ Footer }}
            />
        </div>
    )
})

export default ClusterList

