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
    handleNameGroup: (ids: number[], name: string) => Promise<void>
    handleIgnoreGroup: (ids: number[]) => void
    handleUngroup: (index: number) => void
    handleOpenNaming: (ids: number[]) => Promise<void>
}

const ClusterList = memo(({
    clusters, selectedFaceIds, toggleFace, toggleGroup, fetchFacesByIds, handleNameGroup, handleIgnoreGroup, handleUngroup, handleOpenNaming
}: ClusterListProps) => {

    const renderClusterRow = useCallback((index: number) => {
        const cluster = clusters[index];
        if (!cluster || !cluster.faces) return null;

        return (
            <div className="border-b border-gray-800 pb-4 pr-2">
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
                />
            </div>
        );
    }, [clusters, selectedFaceIds, toggleFace, toggleGroup, fetchFacesByIds, handleNameGroup, handleIgnoreGroup, handleUngroup, handleOpenNaming]);

    // Use memo for style to prevent re-renders on every parent render
    const style = useMemo(() => ({ height: '100%', width: '100%' }), []);

    return (
        <div className="h-[65vh] w-full relative">
            <Virtuoso
                style={style}
                totalCount={clusters.length}
                itemContent={renderClusterRow}
                components={{
                    Footer: () => <div className="h-20" /> // Extra space at bottom
                }}
            />
        </div>
    )
})

export default ClusterList
