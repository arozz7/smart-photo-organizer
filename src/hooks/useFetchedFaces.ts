import { useState, useEffect } from 'react'
import { usePeople } from '../context/PeopleContext'

interface UseFetchedFacesOptions {
    ids: number[]
    enabled: boolean
    batchSize?: number
}

export function useFetchedFaces({ ids, enabled, batchSize = 100 }: UseFetchedFacesOptions) {
    const { fetchFacesByIds } = usePeople()
    const [faces, setFaces] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [displayedCount, setDisplayedCount] = useState(0)

    useEffect(() => {
        if (enabled) {
            if (ids.length > 0) {
                // Reset and load first batch
                setFaces([])
                setDisplayedCount(0)
                loadBatch(0)
            } else {
                setFaces([])
                setDisplayedCount(0)
            }
        } else {
            // Optional: clear state when disabled to save memory?
            // setFaces([])
        }
    }, [enabled, ids]) // ids change triggers reload

    const loadBatch = async (offset: number) => {
        setLoading(true)
        try {
            const currentLimit = Math.max(batchSize, offset + batchSize)
            const batchIds = ids.slice(offset, currentLimit)

            if (batchIds.length === 0) return

            const result = await fetchFacesByIds(batchIds)

            setFaces(prev => {
                // Merge to avoid duplicates if strict mode fires
                const existing = new Set(prev.map(f => f.id))
                const newFaces = result.filter((f: any) => !existing.has(f.id))
                return [...prev, ...newFaces]
            })
            setDisplayedCount(prev => prev + result.length)
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    const loadMore = () => {
        if (displayedCount >= ids.length) return
        loadBatch(displayedCount)
    }

    return {
        faces,
        loading,
        hasMore: displayedCount < ids.length,
        displayedCount,
        totalCount: ids.length,
        loadMore
    }
}
