import { useState, useEffect, useCallback, useMemo } from 'react'
import { usePeople } from '../context/PeopleContext'
import { useToast } from '../context/ToastContext'

interface UseBackgroundFacesOptions {
    enabled: boolean
}

export interface NoiseCandidate {
    faceId: number;
    photoCount: number;
    clusterSize: number;
    nearestPersonDistance: number;
    nearestPersonName: string | null;
    box: { x: number; y: number; width: number; height: number };
    photo_id: number;
    file_path: string;
    preview_cache_path: string | null;
    photo_width: number;
    photo_height: number;
}

export function useBackgroundFaces({ enabled }: UseBackgroundFacesOptions) {
    const { loadFaces, loadPeople } = usePeople()
    const { addToast } = useToast()

    const [allCandidates, setAllCandidates] = useState<NoiseCandidate[]>([])
    const [displayedCount, setDisplayedCount] = useState(0)
    const [loading, setLoading] = useState(false)
    const [stats, setStats] = useState({ totalUnnamed: 0, singlePhotoCount: 0, twoPhotoCount: 0, noiseCount: 0 })
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    const [isProcessing, setIsProcessing] = useState(false) // shared for ignore/name ops

    const BATCH_SIZE = 150

    const loadBackgroundFaces = useCallback(async () => {
        if (!enabled) return;
        setLoading(true)
        setSelectedIds(new Set())
        setDisplayedCount(0)
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:detectBackgroundFaces', {})
            if (result.success) {
                const candidates = result.candidates || []
                setAllCandidates(candidates)
                setStats(result.stats || { totalUnnamed: 0, singlePhotoCount: 0, twoPhotoCount: 0, noiseCount: 0 })
                setDisplayedCount(Math.min(BATCH_SIZE, candidates.length))
            }
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }, [enabled])

    useEffect(() => {
        if (enabled) {
            loadBackgroundFaces()
        }
    }, [enabled])

    const loadMore = useCallback(() => {
        if (displayedCount >= allCandidates.length) return
        setTimeout(() => {
            setDisplayedCount(prev => Math.min(prev + BATCH_SIZE, allCandidates.length))
        }, 50)
    }, [displayedCount, allCandidates.length])

    const toggleSelection = (faceId: number) => {
        const next = new Set(selectedIds)
        if (next.has(faceId)) next.delete(faceId)
        else next.add(faceId)
        setSelectedIds(next)
    }

    const selectAllLoaded = () => setSelectedIds(new Set(allCandidates.slice(0, displayedCount).map(c => c.faceId)))
    const selectNone = () => setSelectedIds(new Set())

    const handleIgnoreSelected = async () => {
        if (selectedIds.size === 0) return
        setIsProcessing(true)
        try {
            const ids = Array.from(selectedIds)
            // @ts-ignore
            await window.ipcRenderer.invoke('db:ignoreFaces', ids)

            // Optimistic update
            setAllCandidates(prev => prev.filter(c => !selectedIds.has(c.faceId)))
            setSelectedIds(new Set())

            loadFaces({ unnamed: true })
            loadPeople()
            addToast({ type: 'success', description: `Ignored ${ids.length} faces` })
        } catch (e) {
            console.error(e)
        } finally {
            setIsProcessing(false)
        }
    }

    // Reuse existing reassignFaces logic
    const handleNameSelected = async (name: string) => {
        if (selectedIds.size === 0 || !name.trim()) return
        setIsProcessing(true)
        try {
            const ids = Array.from(selectedIds)
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:reassignFaces', {
                faceIds: ids,
                personName: name.trim()
            })

            if (result.success) {
                setAllCandidates(prev => prev.filter(c => !selectedIds.has(c.faceId)))
                setSelectedIds(new Set())
                loadFaces({ unnamed: true })
                loadPeople()
                addToast({ type: 'success', description: `Named ${ids.length} faces` })
            }
        } catch (e) {
            console.error(e)
        } finally {
            setIsProcessing(false)
        }
    }

    return {
        candidates: allCandidates.slice(0, displayedCount),
        totalCandidates: allCandidates.length,
        hasMore: displayedCount < allCandidates.length,
        loading,
        stats,
        selectedIds,
        isProcessing,

        loadMore,
        toggleSelection,
        selectAllLoaded,
        selectNone,
        handleIgnoreSelected,
        handleNameSelected,
        reload: loadBackgroundFaces
    }
}
