import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useAI } from './AIContext'

interface ScanContextType {
    scanning: boolean
    scanCount: number
    startScan: (path: string) => Promise<void>
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
}

const ScanContext = createContext<ScanContextType | undefined>(undefined)

export function ScanProvider({ children }: { children: ReactNode }) {
    const [scanning, setScanning] = useState(false)
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


    // Reload photos when filter changes
    useEffect(() => {
        if (filter.initial) {
            setPhotos([])
            setHasMore(false)
            setLoadingPhotos(false)
            return
        }

        setPhotos([])
        setOffset(0)
        setHasMore(true)
        loadTags()
        loadFolders()
        loadPeople()

        const initialLoad = async () => {
            try {
                setLoadingPhotos(true)
                // @ts-ignore
                const newPhotos = await window.ipcRenderer.invoke('db:getPhotos', { limit: 50, offset: 0, filter })
                setPhotos(newPhotos)
                setOffset(50)
                setHasMore(newPhotos.length >= 50)
                if (newPhotos.length > 0) {
                    // addToQueue(newPhotos); // FIX: Do not auto-queue on load
                }
            } catch (e) {
                console.error("Filter load failed", e)
            } finally {
                setLoadingPhotos(false)
            }
        }
        initialLoad()
    }, [filter])

    const setFilter = (newFilter: any) => {
        setFilterState(newFilter)
    }

    const loadMorePhotos = async () => {
        if (scanning || loadingPhotos || filter.initial) {
            console.log(`[ScanContext] loadMorePhotos skipped: scanning=${scanning}, loading=${loadingPhotos}, initial=${filter.initial}`);
            return
        }

        try {
            console.log(`[ScanContext] Loading photos... Offset: ${offset}, Filter:`, filter);
            setLoadingPhotos(true)
            // @ts-ignore
            const newPhotos = await window.ipcRenderer.invoke('db:getPhotos', { limit: 50, offset, filter })
            console.log(`[ScanContext] Loaded ${newPhotos.length} photos.`);

            if (newPhotos.length < 50) {
                setHasMore(false)
            }

            setPhotos(prev => [...prev, ...newPhotos])
            setOffset(prev => prev + 50)

            if (newPhotos.length > 0) {
                // addToQueue(newPhotos); // FIX: Do not auto-queue on scroll
            }
        } catch (err) {
            console.error('Load photos error:', err)
        } finally {
            setLoadingPhotos(false)
        }
    }

    const startScan = async (path: string) => {
        setScanning(true)
        setScanCount(0)
        setScanPath(path)
        try {
            console.log(`[ScanContext] Starting scan of ${path}`);
            await window.ipcRenderer.invoke('scan-directory', path)
            console.log(`[ScanContext] Scan complete.`);

            // Queue Fix: Fetch ALL photos in this folder and add to AI Queue
            // @ts-ignore
            const scanPhotos = await window.ipcRenderer.invoke('db:getPhotosForRescan', { filter: { folder: path } })
            if (scanPhotos.length > 0) {
                console.log(`[ScanContext] check: Queueing ${scanPhotos.length} photos for AI.`);
                addToQueue(scanPhotos)
            }

            // Also refresh errors if any occurred during scan (synchronous part, though AI is async)
            loadScanErrors()

        } catch (err) {
            console.error('Scan error:', err)
            throw err
        } finally {
            setScanning(false)
            // Switch to folder view for the scanned path
            setFilterState({ folder: path })
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
            scanErrors, loadScanErrors, retryErrors, clearErrors, loadingPhotos
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
