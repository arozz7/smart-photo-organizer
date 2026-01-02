import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react'
import { useAI } from './AIContext'
import { useScanErrors } from '../hooks/useScanErrors'
import { usePhotoNavigation } from '../hooks/usePhotoNavigation'
import { useLibraryMetadata } from '../hooks/useLibraryMetadata'

interface ScanContextType {
    scanning: boolean
    scanCount: number
    startScan: (path: string, options?: { forceRescan?: boolean }) => Promise<void>
    scanPath: string
    photos: any[]
    loadMorePhotos: () => Promise<void>
    hasMore: boolean
    filter: any
    setFilter: (filter: any) => void
    loadingPhotos: boolean
    rescanFiles: (ids: number[]) => Promise<void>
    // From useLibraryMetadata
    availableTags: any[]
    loadTags: () => Promise<void>
    availableFolders: any[]
    loadFolders: () => Promise<void>
    availablePeople: any[]
    loadPeople: () => Promise<void>
    // From useScanErrors
    scanErrors: any[]
    loadScanErrors: () => Promise<void>
    retryErrors: () => Promise<void>
    clearErrors: () => Promise<void>
    // From usePhotoNavigation
    refreshPhoto: (photoId: number) => Promise<void>
    viewingPhoto: any | null
    viewPhoto: (photoId: number) => Promise<void>
    setViewingPhoto: (photo: any | null) => void
    navigateToPhoto: (direction: number) => void
}

const ScanContext = createContext<ScanContextType | undefined>(undefined)

export function ScanProvider({ children }: { children: ReactNode }) {
    const [activeScanRequests, setActiveScanRequests] = useState(0)
    const scanning = activeScanRequests > 0
    const [scanCount, setScanCount] = useState(0)
    const [scanPath, setScanPath] = useState('')
    const [photos, setPhotos] = useState<any[]>([])
    const [hasMore, setHasMore] = useState(false)
    const [offset, setOffset] = useState(0)
    const [loadingPhotos, setLoadingPhotos] = useState(false)
    const loadingRef = useRef(false); // Lock for race conditions
    const [filter, setFilterState] = useState<any>({ initial: true })

    const { addToQueue } = useAI()

    // Hooks
    const metadata = useLibraryMetadata()
    const errors = useScanErrors()
    const navigation = usePhotoNavigation(photos, setPhotos)

    useEffect(() => {
        // Global listener for progress
        const listener = (_event: any, count: number) => {
            setScanCount(count)
        }
        // @ts-ignore
        const removeListener = (window as any).ipcRenderer.on('scan-progress', listener)
        return () => {
            if (typeof removeListener === 'function') {
                removeListener()
            }
        }
    }, [])

    const isFilterComplete = (f: any) => {
        if (f.initial) return false
        if (!f || Object.keys(f).length === 0) return true // "All Photos" mode
        if (f.untagged) return true

        // Completion check for explicit filter modes
        const hasTag = 'tag' in f && !!f.tag
        const hasTags = 'tags' in f && Array.isArray(f.tags) && f.tags.length > 0
        const hasFolder = 'folder' in f && !!f.folder
        const hasPeople = 'people' in f && Array.isArray(f.people) && f.people.length > 0
        const hasSearch = 'search' in f && !!f.search

        // If any criteria is set, the filter is "complete" and ready to fetch
        return hasTag || hasTags || hasFolder || hasPeople || hasSearch
    }

    // Reload photos when filter changes
    useEffect(() => {
        let didCancel = false;

        if (!isFilterComplete(filter)) {
            setPhotos([])
            setHasMore(false)
            setLoadingPhotos(false)
            loadingRef.current = false;
            // Still load metadata for selection dropdowns
            metadata.loadTags()
            metadata.loadFolders()
            metadata.loadPeople()
            return
        }

        setPhotos([])
        setOffset(0)
        setHasMore(true)
        loadingRef.current = false;

        const initialLoad = async () => {
            if (loadingRef.current) return;
            try {
                setLoadingPhotos(true)
                loadingRef.current = true;
                // @ts-ignore
                const result = await window.ipcRenderer.invoke('db:getPhotos', { limit: 50, offset: 0, filter })
                const newPhotos = result.photos || []

                if (!didCancel) {
                    setPhotos(newPhotos)
                    setOffset(50)
                    setHasMore(newPhotos.length >= 50)
                }
            } catch (e) {
                if (!didCancel) console.error("Filter load failed", e)
            } finally {
                if (!didCancel) {
                    setLoadingPhotos(false)
                    loadingRef.current = false;
                }
            }
        }
        initialLoad()

        return () => { didCancel = true; loadingRef.current = false; }
    }, [filter])

    const setFilter = (newFilter: any) => {
        setFilterState(newFilter)
    }

    const loadMorePhotos = async () => {
        if (scanning || loadingPhotos || loadingRef.current || !isFilterComplete(filter) || !hasMore) {
            // console.log(`[ScanContext] loadMorePhotos skipped`);
            return
        }

        try {
            console.log(`[ScanContext] Loading more photos... Offset: ${offset}`);
            setLoadingPhotos(true)
            loadingRef.current = true;
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:getPhotos', { limit: 50, offset, filter })
            const newPhotos = result.photos || []
            console.log(`[ScanContext] Loaded ${newPhotos.length} photos.`);

            if (newPhotos.length < 50) {
                setHasMore(false)
            }

            setPhotos(prev => [...prev, ...newPhotos])
            setOffset(prev => prev + 50)
        } catch (err) {
            console.error('Load photos error:', err)
        } finally {
            setLoadingPhotos(false)
            loadingRef.current = false;
        }
    }

    const startScan = async (path: string, options: { forceRescan?: boolean } = {}) => {
        setActiveScanRequests(prev => prev + 1)
        setScanCount(0)
        setScanPath(path)
        try {
            console.log(`[ScanContext] Starting scan of ${path} (forceRescan=${options.forceRescan})`);
            // @ts-ignore
            const scanResults: any[] = await window.ipcRenderer.invoke('scan-directory', path, options)
            console.log(`[ScanContext] Scan complete. Found ${scanResults.length} photos.`);

            // Queue Logic:
            // If forceRescan: Queue ALL returned photos
            // Else: Queue ONLY photos marked as isNew
            const photosToQueue = options.forceRescan
                ? scanResults
                : scanResults.filter(p => p.isNew);

            if (photosToQueue.length > 0) {
                console.log(`[ScanContext] Queueing ${photosToQueue.length} photos for AI (Total Scanned: ${scanResults.length})`);
                addToQueue(photosToQueue, true)
            } else {
                console.log(`[ScanContext] No new photos to queue for AI.`);
            }

            // Also refresh errors if any occurred during scan
            errors.loadScanErrors()

        } catch (err) {
            console.error('Scan error:', err)
            throw err
        } finally {
            setActiveScanRequests(prev => Math.max(0, prev - 1))
            // Switch to folder view for the scanned path
            setFilterState({ folder: path })
            // Refresh current view if needed
            if (isFilterComplete(filter)) {
                // Trigger reload by setting filter again
                setFilter({ ...filter }); // Hack trigger
            }
        }
    }

    const rescanFiles = async (ids: number[]) => {
        if (ids.length === 0) return;
        setActiveScanRequests(prev => prev + 1)
        try {
            // @ts-ignore
            const filesData = await window.ipcRenderer.invoke('db:getFilePaths', ids);
            const pathsToScan = filesData.map((f: any) => f.file_path);

            if (pathsToScan.length > 0) {
                console.log(`[ScanContext] Rescanning ${pathsToScan.length} specific files...`);
                // @ts-ignore
                const scannedPhotos = await window.ipcRenderer.invoke('scan-files', pathsToScan, { forceRescan: true });

                // Queue Logic: Queue ALL returned photos as they are forced
                if (scannedPhotos.length > 0) {
                    addToQueue(scannedPhotos, true);
                }

                // Refresh view hack
                setPhotos(prev => prev.map(p => {
                    const updated = scannedPhotos.find((sp: any) => sp.id === p.id);
                    if (updated) return { ...updated, _cacheBust: Date.now() };
                    return p;
                }));
            }
        } catch (e) {
            console.error('Rescan files failed', e);
        } finally {
            setActiveScanRequests(prev => Math.max(0, prev - 1))
        }
    }

    return (
        <ScanContext.Provider value={{
            scanning,
            scanCount,
            startScan,
            scanPath,
            photos,
            loadMorePhotos,
            hasMore,
            filter,
            setFilter,
            loadingPhotos,
            rescanFiles,
            ...metadata,
            ...errors,
            ...navigation
        }}>
            {children}
        </ScanContext.Provider>
    )
}

export function useScan() {
    const context = useContext(ScanContext)
    if (context === undefined) {
        throw new Error('useScan must be used within a ScanProvider')
    }
    return context
}
