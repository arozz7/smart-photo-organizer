import { useState, useEffect, useCallback, useMemo } from 'react'
import { usePeople } from '../context/PeopleContext'
import { useClusterController } from './useClusterController'

interface UseIgnoredFacesOptions {
    enabled: boolean
}

export function useIgnoredFaces({ enabled }: UseIgnoredFacesOptions) {
    const { loadFaces } = usePeople()
    const [faces, setFaces] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [totalCount, setTotalCount] = useState(0)
    const [page, setPage] = useState(0)
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
    const LIMIT = 150

    // Grouping State
    const [isGrouping, setIsGrouping] = useState(false)
    const [clusters, setClusters] = useState<{ id: string, faces: any[] }[]>([])
    const [singles, setSingles] = useState<any[]>([])
    const [clustering, setClustering] = useState(false)

    // Controller Integration
    const controllerData = useMemo(() => {
        if (isGrouping) {
            // Only show actual DBSCAN clusters — singles are faces DBSCAN correctly
            // identified as not belonging to any group. Lumping them into a single
            // mega-row is misleading (they're unrelated). Use flat view to see them.
            return clusters.map(c => ({
                faces: c.faces.map(f => Number(f.id)),
                data: c
            }));
        } else {
            if (faces.length === 0) return [];
            return [{
                faces: faces.map(f => Number(f.id)),
                data: { id: 'flat', faces: faces }
            }];
        }
    }, [isGrouping, clusters, singles, faces]);

    const controller = useClusterController({
        clusters: controllerData,
        pageSize: 50
    });

    const loadIgnoredFaces = useCallback(async (pageNum: number = 0, order: 'asc' | 'desc' = sortOrder) => {
        if (!enabled) return;

        const isLoadMore = pageNum > 0
        setLoading(true)

        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:getIgnoredFaces', { page: pageNum, limit: LIMIT, order })

            const newFaces = res.faces || []
            setTotalCount(res.total || 0)

            if (isLoadMore) {
                setFaces(prev => {
                    const existingIds = new Set(prev.map(f => f.id));
                    const uniqueNewFaces = newFaces.filter((f: any) => !existingIds.has(f.id));
                    return [...prev, ...uniqueNewFaces];
                });
                if (isGrouping) setIsGrouping(false)
            } else {
                setFaces(newFaces || [])
            }
            setPage(pageNum)
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }, [enabled, sortOrder])

    useEffect(() => {
        if (enabled) {
            loadIgnoredFaces(0)
            controller.clearSelection()
        }
    }, [enabled]) // Don't depend on loadIgnoredFaces to avoid loops if not memoized perfectly

    const handleLoadMore = () => {
        loadIgnoredFaces(page + 1)
    }

    const handleSortChange = () => {
        const newOrder = sortOrder === 'desc' ? 'asc' : 'desc'
        setSortOrder(newOrder)
        loadIgnoredFaces(0, newOrder)
    }

    const removeFacesFromState = (idsToRemove: number[]) => {
        const idSet = new Set(idsToRemove);
        const remaining = faces.filter(f => !idSet.has(f.id));
        setFaces(remaining);
        setTotalCount(prev => Math.max(0, prev - idsToRemove.length));
        controller.clearSelection();

        if (isGrouping) {
            setClusters(prev => prev.map(c => ({
                ...c,
                faces: c.faces.filter(f => !idSet.has(f.id))
            })).filter(c => c.faces.length > 0));
            setSingles(prev => prev.filter(f => !idSet.has(f.id)));
        }
    };

    const handleRestore = async (ids: number[], targetPersonId?: number) => {
        if (ids.length === 0) return
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:restoreFaces', {
                faceIds: ids,
                personId: targetPersonId
            })
            removeFacesFromState(ids);
            loadFaces({ unnamed: true }) // Refresh global counts
        } catch (e) {
            console.error("Restore failed", e)
        }
    }

    const handleClusterToggle = async () => {
        if (!isGrouping) {
            setIsGrouping(true)
            controller.clearSelection()
            if (faces.length === 0) return

            setClustering(true)
            try {
                const faceIds = faces.map(f => f.id)
                // @ts-ignore
                const res = await window.ipcRenderer.invoke('ai:clusterFaces', {
                    faceIds,
                    eps: 0.35,
                    min_samples: 2,
                    min_cohesion: 0.65,
                    max_spread: 0.7
                })

                if (res.clusters) {
                    const idMap = new Map(faces.map(f => [f.id, f]))
                    const newClusters = res.clusters.map((clusterIds: number[], idx: number) => ({
                        id: `group-${idx}`,
                        faces: clusterIds.map(id => idMap.get(id)).filter(Boolean)
                    }))
                    const clusteredIds = new Set(res.clusters.flat())
                    const newSingles = faces.filter(f => !clusteredIds.has(f.id))

                    setClusters(newClusters)
                    setSingles(newSingles)
                }
            } catch (e) {
                console.error("Clustering failed", e)
                setIsGrouping(false)
            } finally {
                setClustering(false)
            }
        } else {
            setIsGrouping(false)
            controller.clearSelection()
        }
    }

    return {
        faces,
        loading,
        totalCount,
        sortOrder,
        isGrouping,
        clustering,
        clusters,
        singles,
        controller,

        handleLoadMore,
        handleSortChange,
        handleRestore,
        handleClusterToggle,
        reload: () => loadIgnoredFaces(0)
    }
}
