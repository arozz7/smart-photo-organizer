import { useState, useCallback, useEffect, useRef } from 'react'
import type { PhotoFilter, CompoundFilter, SearchSort, FilterMetadata, SmartAlbum } from '../types/filterTypes'

const PAGE_SIZE = 50

export interface SearchHook {
    photos: any[]
    total: number
    loading: boolean
    hasMore: boolean
    hasActiveFilter: boolean
    filter: PhotoFilter
    compoundFilter: CompoundFilter | null
    sort: SearchSort
    metadata: FilterMetadata
    smartAlbums: SmartAlbum[]
    setFilter: (filter: PhotoFilter) => void
    setCompoundFilter: (filter: CompoundFilter | null) => void
    setSort: (sort: SearchSort) => void
    search: () => Promise<void>
    loadMore: () => Promise<void>
    clearFilters: () => void
    loadMetadata: () => Promise<void>
    loadSmartAlbums: () => Promise<void>
    createSmartAlbum: (name: string) => Promise<void>
    updateSmartAlbum: (id: number, name: string) => Promise<void>
    deleteSmartAlbum: (id: number) => Promise<void>
    applySmartAlbum: (album: SmartAlbum) => void
}

const emptyFilter: PhotoFilter = {}
const emptyMetadata: FilterMetadata = {
    cameraModels: [],
    years: [],
    fileTypes: [],
    tags: [],
    folders: [],
    people: [],
}

export function useSearch(): SearchHook {
    const [photos, setPhotos] = useState<any[]>([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(false)
    const [hasMore, setHasMore] = useState(false)
    const [filter, setFilter] = useState<PhotoFilter>(emptyFilter)
    const [compoundFilter, setCompoundFilter] = useState<CompoundFilter | null>(null)
    const [sort, setSort] = useState<SearchSort>('date_desc')
    const [metadata, setMetadata] = useState<FilterMetadata>(emptyMetadata)
    const [smartAlbums, setSmartAlbums] = useState<SmartAlbum[]>([])
    const loadingRef = useRef(false)

    const search = useCallback(async () => {
        if (loadingRef.current) return
        loadingRef.current = true
        setLoading(true)
        try {
            let result: any

            if (compoundFilter) {
                // Compound filters use dedicated search channel
                // @ts-ignore
                result = await window.ipcRenderer.invoke('db:searchPhotos', {
                    compound: true, filter: compoundFilter, page: 1, limit: PAGE_SIZE, sort, offset: 0,
                })
            } else {
                // Simple filters use existing db:getPhotos channel (always available)
                // @ts-ignore
                result = await window.ipcRenderer.invoke('db:getPhotos', {
                    page: 1, limit: PAGE_SIZE, sort, filter, offset: 0,
                })
            }

            const fetched = result?.photos || []
            setPhotos(fetched)
            setTotal(result?.total || 0)
            setHasMore(fetched.length < (result?.total || 0))
        } catch (e) {
            console.error('[useSearch] Search failed:', e)
            setPhotos([])
            setTotal(0)
            setHasMore(false)
        } finally {
            setLoading(false)
            loadingRef.current = false
        }
    }, [filter, compoundFilter, sort])

    const loadMore = useCallback(async () => {
        if (loadingRef.current || !hasMore) return
        loadingRef.current = true
        setLoading(true)
        try {
            const offset = photos.length
            let result: any

            if (compoundFilter) {
                // @ts-ignore
                result = await window.ipcRenderer.invoke('db:searchPhotos', {
                    compound: true, filter: compoundFilter, page: 1, limit: PAGE_SIZE, sort, offset,
                })
            } else {
                // @ts-ignore
                result = await window.ipcRenderer.invoke('db:getPhotos', {
                    page: 1, limit: PAGE_SIZE, sort, filter, offset,
                })
            }

            const fetched = result?.photos || []
            setPhotos(prev => [...prev, ...fetched])
            setHasMore(photos.length + fetched.length < (result?.total || 0))
        } catch (e) {
            console.error('[useSearch] Load more failed:', e)
        } finally {
            setLoading(false)
            loadingRef.current = false
        }
    }, [filter, compoundFilter, sort, photos.length, hasMore])

    const clearFilters = useCallback(() => {
        setFilter(emptyFilter)
        setCompoundFilter(null)
    }, [])

    const loadMetadata = useCallback(async () => {
        try {
            const [camRes, yearRes, ftRes, tags, folders, people] = await Promise.all([
                // @ts-ignore
                window.ipcRenderer.invoke('db:getCameraModels'),
                // @ts-ignore
                window.ipcRenderer.invoke('db:getYears'),
                // @ts-ignore
                window.ipcRenderer.invoke('db:getFileTypes'),
                // @ts-ignore
                window.ipcRenderer.invoke('db:getAllTags'),
                // @ts-ignore
                window.ipcRenderer.invoke('db:getFolders'),
                // @ts-ignore
                window.ipcRenderer.invoke('db:getPeople'),
            ])
            setMetadata({
                cameraModels: camRes.models || [],
                years: yearRes.years || [],
                fileTypes: ftRes.fileTypes || [],
                tags: tags || [],
                folders: folders || [],
                people: people || [],
            })
        } catch (e) {
            console.error('Failed to load filter metadata', e)
        }
    }, [])

    const loadSmartAlbums = useCallback(async () => {
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:getSmartAlbums')
            if (res.success) setSmartAlbums(res.albums)
        } catch (e) {
            console.error('Failed to load smart albums', e)
        }
    }, [])

    const createSmartAlbum = useCallback(async (name: string) => {
        const filterJson = compoundFilter
            ? JSON.stringify({ compound: true, filter: compoundFilter })
            : JSON.stringify({ compound: false, filter })
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:createSmartAlbum', { name, filterJson })
            if (res.success) await loadSmartAlbums()
        } catch (e) {
            console.error('Failed to create smart album', e)
        }
    }, [filter, compoundFilter, loadSmartAlbums])

    const updateSmartAlbum = useCallback(async (id: number, name: string) => {
        const filterJson = compoundFilter
            ? JSON.stringify({ compound: true, filter: compoundFilter })
            : JSON.stringify({ compound: false, filter })
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:updateSmartAlbum', { id, name, filterJson })
            await loadSmartAlbums()
        } catch (e) {
            console.error('Failed to update smart album', e)
        }
    }, [filter, compoundFilter, loadSmartAlbums])

    const deleteSmartAlbum = useCallback(async (id: number) => {
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:deleteSmartAlbum', id)
            await loadSmartAlbums()
        } catch (e) {
            console.error('Failed to delete smart album', e)
        }
    }, [loadSmartAlbums])

    const applySmartAlbum = useCallback((album: SmartAlbum) => {
        try {
            const parsed = JSON.parse(album.filter_json)
            if (parsed.compound) {
                setCompoundFilter(parsed.filter)
                setFilter(emptyFilter)
            } else {
                setFilter(parsed.filter)
                setCompoundFilter(null)
            }
        } catch (e) {
            console.error('Failed to parse smart album filter', e)
        }
    }, [])

    // Search when filter or sort changes (only if filters are active)
    useEffect(() => {
        const hasAnyFilter = compoundFilter !== null || Object.keys(filter).length > 0
        if (hasAnyFilter) {
            search()
        } else {
            // No filters — reset to empty (landing state)
            setPhotos([])
            setTotal(0)
            setHasMore(false)
        }
    }, [filter, compoundFilter, sort, search])

    // Load metadata and smart albums on mount
    useEffect(() => {
        loadMetadata()
        loadSmartAlbums()
    }, [loadMetadata, loadSmartAlbums])

    const hasActiveFilter = compoundFilter !== null || Object.keys(filter).length > 0

    return {
        photos,
        total,
        loading,
        hasMore,
        hasActiveFilter,
        filter,
        compoundFilter,
        sort,
        metadata,
        smartAlbums,
        setFilter,
        setCompoundFilter,
        setSort,
        search,
        loadMore,
        clearFilters,
        loadMetadata,
        loadSmartAlbums,
        createSmartAlbum,
        updateSmartAlbum,
        deleteSmartAlbum,
        applySmartAlbum,
    }
}
