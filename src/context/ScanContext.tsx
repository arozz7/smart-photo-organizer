import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useAI } from './AIContext'

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
    availableTags: any[]
    loadTags: () => Promise<void>
    availableFolders: any[]
    loadFolders: () => Promise<void>
    availablePeople: any[]
    loadPeople: () => Promise<void>
    // Error Tracking
    scanErrors: any[]
    loadScanErrors: () => Promise<void>
    retryErrors: () => Promise<void>
    clearErrors: () => Promise<void>
    loadingPhotos: boolean
    refreshPhoto: (photoId: number) => Promise<void>
    viewingPhoto: any | null
    viewPhoto: (photoId: number) => Promise<void>
    setViewingPhoto: (photo: any | null) => void
    navigateToPhoto: (direction: number) => void
    rescanFiles: (ids: number[]) => Promise<void>
}

const ScanContext = createContext<ScanContextType | undefined>(undefined)

export function ScanProvider({ children }: { children: ReactNode }) {
    // ... lines 31-240 ...
    // Note: I cannot replace the middle lines easily without re-stating them if I use huge block.
    // I will target the Return statement to add refreshPhoto to value.
    // But first I must update interface at the top.

    // Actually, I can do this in two chunks with multi_replace if needed, or just carefully target.
    // I will replace the Interface definition first.

    const [activeScanRequests, setActiveScanRequests] = useState(0)
    const scanning = activeScanRequests > 0
    const [scanCount, setScanCount] = useState(0)
    const [scanPath, setScanPath] = useState('')
    const [photos, setPhotos] = useState<any[]>([])
    const [hasMore, setHasMore] = useState(false)
    const [offset, setOffset] = useState(0)
    const [loadingPhotos, setLoadingPhotos] = useState(false)
    const [filter, setFilterState] = useState<any>({ initial: true })
    const [availableTags, setAvailableTags] = useState<any[]>([])
    const [availableFolders, setAvailableFolders] = useState<any[]>([])
    const [availablePeople, setAvailablePeople] = useState<any[]>([])
    const [scanErrors, setScanErrors] = useState<any[]>([])
    const [viewingPhoto, setViewingPhoto] = useState<any | null>(null)
    const { addToQueue } = useAI()

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

    const loadTags = async () => {
        try {
            // @ts-ignore
            const tags = await window.ipcRenderer.invoke('db:getAllTags')
            setAvailableTags(tags)
        } catch (e) {
            console.error('Failed to load tags', e)
        }
    }

    const loadFolders = async () => {
        try {
            // @ts-ignore
            const folders = await window.ipcRenderer.invoke('db:getFolders')
            setAvailableFolders(folders)
        } catch (e) {
            console.error('Failed to load folders', e)
        }
    }

    const loadScanErrors = async () => {
        try {
            // @ts-ignore
            const errors = await window.ipcRenderer.invoke('db:getScanErrors')
            setScanErrors(errors)
        } catch (e) {
            console.error('Failed to load scan errors', e)
        }
    }

    const retryErrors = async () => {
        try {
            // @ts-ignore
            const photosToRetry = await window.ipcRenderer.invoke('db:retryScanErrors')
            if (photosToRetry && photosToRetry.length > 0) {
                console.log(`Retrying ${photosToRetry.length} failed scans...`)
                addToQueue(photosToRetry)
            }
            loadScanErrors() // Refresh (should be empty)
        } catch (e) {
            console.error('Failed to retry errors', e)
        }
    }

    const clearErrors = async () => {
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:clearScanErrors')
            setScanErrors([])
        } catch (e) {
            console.error('Failed to clear errors', e)
        }
    }


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
            // Still load metadata for selection dropdowns
            loadTags()
            loadFolders()
            loadPeople()
            return
        }

        setPhotos([])
        setOffset(0)
        setHasMore(true)

        const initialLoad = async () => {
            try {
                setLoadingPhotos(true)
                // @ts-ignore
                const result = await window.ipcRenderer.invoke('db:getPhotos', { limit: 50, offset: 0, filter })
                const newPhotos = result.photos || []

                if (!didCancel) {
                    setPhotos(newPhotos)
                    setOffset(50)
                    setHasMore(newPhotos.length >= 50)
                    if (newPhotos.length > 0) {
                        // addToQueue(newPhotos); // FIX: Do not auto-queue on load
                    }
                }
            } catch (e) {
                if (!didCancel) console.error("Filter load failed", e)
            } finally {
                if (!didCancel) setLoadingPhotos(false)
            }
        }
        initialLoad()

        return () => { didCancel = true; }
    }, [filter])

    const setFilter = (newFilter: any) => {
        setFilterState(newFilter)
    }

    const loadMorePhotos = async () => {
        if (scanning || loadingPhotos || !isFilterComplete(filter) || !hasMore) {
            console.log(`[ScanContext] loadMorePhotos skipped: scanning=${scanning}, loading=${loadingPhotos}, filterComplete=${isFilterComplete(filter)}, hasMore=${hasMore}`);
            return
        }

        try {
            console.log(`[ScanContext] Loading more photos... Offset: ${offset}`);
            setLoadingPhotos(true)
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
        }
    }

    const refreshPhoto = async (photoId: number) => {
        try {
            console.log(`[ScanContext] Refreshing photo ${photoId}`);
            // @ts-ignore
            const newPhoto = await window.ipcRenderer.invoke('db:getPhoto', photoId);
            if (newPhoto) {
                const timestamp = new Date().getTime();
                newPhoto.preview_cache_path = newPhoto.preview_cache_path ? `${newPhoto.preview_cache_path}?t=${timestamp}` : null;

                setPhotos(prev => prev.map(p => {
                    if (p.id === photoId) {
                        return { ...newPhoto, _cacheBust: timestamp };
                    }
                    return p;
                }));

                // Also update viewing photo if it's the same one
                if (viewingPhoto && viewingPhoto.id === photoId) {
                    setViewingPhoto({ ...newPhoto, _cacheBust: timestamp });
                }
            }
        } catch (e) {
            console.error('Failed to refresh photo', e);
        }
    }

    const viewPhoto = async (photoId: number) => {
        try {
            // @ts-ignore
            const p = await window.ipcRenderer.invoke('db:getPhoto', photoId)
            if (p) {
                setViewingPhoto(p)
            }
        } catch (e) {
            console.error('Failed to view photo', e)
        }
    }

    const navigateToPhoto = (direction: number) => {
        if (!viewingPhoto || photos.length === 0) return;

        const index = photos.findIndex(p => p.id === viewingPhoto.id);
        if (index !== -1) {
            const nextIndex = index + direction;
            if (nextIndex >= 0 && nextIndex < photos.length) {
                setViewingPhoto(photos[nextIndex]);
            }
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
                addToQueue(photosToQueue)
            } else {
                console.log(`[ScanContext] No new photos to queue for AI.`);
            }

            // Also refresh errors if any occurred during scan
            loadScanErrors()

        } catch (err) {
            console.error('Scan error:', err)
            throw err
        } finally {
            setActiveScanRequests(prev => Math.max(0, prev - 1))
            // Switch to folder view for the scanned path
            setFilterState({ folder: path })
            // Refresh current view if needed
            if (isFilterComplete(filter)) {
                // Trigger reload by setting filter again or separate reload
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
                    addToQueue(scannedPhotos);
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

    const loadPeople = async () => {
        try {
            // @ts-ignore
            const people = await window.ipcRenderer.invoke('db:getPeople')
            setAvailablePeople(people)
        } catch (e) {
            console.error('Failed to load people', e)
        }
    }

    return (
        <ScanContext.Provider value={{
            scanning, scanCount, startScan, scanPath, photos, loadMorePhotos, hasMore, filter, setFilter,
            availableTags, loadTags, availableFolders, loadFolders, availablePeople, loadPeople,
            scanErrors, loadScanErrors, retryErrors, clearErrors, loadingPhotos, refreshPhoto,
            viewingPhoto, viewPhoto, setViewingPhoto, navigateToPhoto, rescanFiles
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
