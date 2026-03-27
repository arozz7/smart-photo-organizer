import { useState, useEffect, useCallback, useRef } from 'react'

interface LibraryPhoto {
    id: number
    file_path: string
    preview_cache_path: string | null
    date_taken: string | null
    width: number | null
    height: number | null
}

interface Props {
    open: boolean
    onSelect: (filePath: string) => void
    onClose: () => void
}

const PAGE_SIZE = 60

function thumbSrc(photo: LibraryPhoto): string {
    const path = photo.preview_cache_path || photo.file_path
    return `local-resource://${encodeURIComponent(path)}`
}

function fileName(filePath: string): string {
    return filePath.split(/[\\/]/).pop() ?? filePath
}

export default function LibraryPhotoPickerModal({ open, onSelect, onClose }: Props) {
    const [photos, setPhotos] = useState<LibraryPhoto[]>([])
    const [total, setTotal] = useState(0)
    const [offset, setOffset] = useState(0)
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(false)
    const [hoveredId, setHoveredId] = useState<number | null>(null)
    const searchRef = useRef<HTMLInputElement>(null)

    const fetchPhotos = useCallback(async (newOffset: number, append: boolean, query: string) => {
        setLoading(true)
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:getPhotos', {
                limit: PAGE_SIZE,
                offset: newOffset,
                filter: query.trim() || undefined,
                sort: 'date_taken_desc',
            })
            if (res?.photos) {
                setTotal(res.total ?? 0)
                setPhotos(prev => append ? [...prev, ...res.photos] : res.photos)
                setOffset(newOffset)
            }
        } catch (e) {
            console.error('[LibraryPicker] fetch failed:', e)
        } finally {
            setLoading(false)
        }
    }, [])

    // Load on open / search change
    useEffect(() => {
        if (!open) return
        fetchPhotos(0, false, search)
    }, [open, search, fetchPhotos])

    // Focus search on open
    useEffect(() => {
        if (open) {
            setTimeout(() => searchRef.current?.focus(), 50)
        } else {
            setPhotos([])
            setOffset(0)
            setSearch('')
        }
    }, [open])

    // Close on Escape
    useEffect(() => {
        if (!open) return
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [open, onClose])

    if (!open) return null

    const hasMore = photos.length < total

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) onClose() }}
        >
            <div className="flex flex-col bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[860px] max-w-[95vw] h-[620px] max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 flex-shrink-0">
                    <h2 className="text-base font-semibold text-white">Choose from Library</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white text-lg leading-none transition-colors"
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>

                {/* Search */}
                <div className="px-4 py-2.5 border-b border-gray-800 flex-shrink-0">
                    <input
                        ref={searchRef}
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Filter by filename or folder…"
                        className="w-full px-3 py-1.5 rounded-md text-sm bg-gray-800 border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                    />
                </div>

                {/* Grid */}
                <div className="flex-1 overflow-y-auto p-3">
                    {loading && photos.length === 0 && (
                        <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                            Loading…
                        </div>
                    )}
                    {!loading && photos.length === 0 && (
                        <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                            No photos found.
                        </div>
                    )}

                    <div
                        className="grid gap-1.5"
                        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}
                    >
                        {photos.map(photo => (
                            <button
                                key={photo.id}
                                onClick={() => { onSelect(photo.file_path); onClose() }}
                                onMouseEnter={() => setHoveredId(photo.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                className="relative group rounded overflow-hidden bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                style={{ aspectRatio: '1' }}
                                title={fileName(photo.file_path)}
                            >
                                <img
                                    src={thumbSrc(photo)}
                                    alt=""
                                    loading="lazy"
                                    className="w-full h-full object-cover"
                                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                                />
                                {/* Hover overlay */}
                                {hoveredId === photo.id && (
                                    <div className="absolute inset-0 bg-indigo-600/40 flex items-end">
                                        <span className="w-full text-[10px] text-white bg-black/60 px-1 py-0.5 truncate">
                                            {fileName(photo.file_path)}
                                        </span>
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Load more */}
                    {hasMore && (
                        <div className="flex justify-center pt-3">
                            <button
                                onClick={() => fetchPhotos(offset + PAGE_SIZE, true, search)}
                                disabled={loading}
                                className="px-4 py-1.5 text-sm rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white disabled:opacity-40 transition-colors"
                            >
                                {loading ? 'Loading…' : `Load more (${total - photos.length} remaining)`}
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-2.5 border-t border-gray-700 flex-shrink-0 flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                        {total.toLocaleString()} photo{total !== 1 ? 's' : ''} in library
                        {search && ` · filtered`}
                    </span>
                    <button
                        onClick={onClose}
                        className="px-3 py-1.5 text-sm rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    )
}
