import React, { useState, useMemo, useEffect } from 'react'
import { useScan } from '../context/ScanContext'
import { useAI } from '../context/AIContext'
import { VirtuosoGrid } from 'react-virtuoso'
import PhotoDetail from '../components/PhotoDetail'
import AIStatus from '../components/AIStatus'

export default function Library() {
    const { scanning, startScan, scanPath, photos, loadMorePhotos, hasMore, filter, setFilter, availableTags, availableFolders } = useScan()
    const { addToQueue } = useAI()
    const [localPath, setLocalPath] = useState(scanPath || 'D:\\Photos')
    const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null)
    const [isSelectionMode, setIsSelectionMode] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

    useEffect(() => {
        if (photos.length === 0 && hasMore && !scanning) {
            loadMorePhotos()
        }
    }, [scanning])

    const handleScan = async () => {
        try {
            await startScan(localPath)
        } catch (err) {
            console.error('Scan failed', err)
        }
    }

    const handleBrowse = async () => {
        // @ts-ignore
        const dir = await window.ipcRenderer.invoke('dialog:openDirectory')
        if (dir) {
            setLocalPath(dir)
        }
    }

    const toggleSelection = (id: number) => {
        const newSelected = new Set(selectedIds)
        if (newSelected.has(id)) {
            newSelected.delete(id)
        } else {
            newSelected.add(id)
        }
        setSelectedIds(newSelected)
    }

    const handleRescanSelected = () => {
        if (selectedIds.size === 0) return
        if (!confirm(`Rescan ${selectedIds.size} selected photos with AI?`)) return

        // Find photo objects for selected Ids (only loaded ones)
        // If we want to support selected but not loaded, we need a different approach,
        // but for now, selection is only possible on loaded items.
        const photosToRescan = photos.filter(p => selectedIds.has(p.id))
        addToQueue(photosToRescan)
        setIsSelectionMode(false)
        setSelectedIds(new Set())
    }

    const handleRescanFiltered = async () => {
        if (!confirm("Rescan ALL photos matching the current filter? This might take a while.")) return

        try {
            // @ts-ignore
            const photosToRescan = await window.ipcRenderer.invoke('db:getPhotosForRescan', { filter })
            if (photosToRescan.length > 0) {
                if (confirm(`Found ${photosToRescan.length} photos. Proceed with AI processing?`)) {
                    addToQueue(photosToRescan)
                }
            } else {
                alert("No photo found matching current filter.")
            }
        } catch (e) {
            console.error(e)
            alert("Failed to fetch photos for rescan.")
        }
    }

    // Custom components for VirtuosoGrid must support refs
    const GridList = useMemo(() => React.forwardRef<HTMLDivElement, any>(({ style, children, ...props }, ref) => (
        <div
            ref={ref}
            {...props}
            style={{ ...style, display: 'flex', flexWrap: 'wrap', gap: '16px' }}
        >
            {children}
        </div>
    )), [])

    const GridItem = useMemo(() => React.forwardRef<HTMLDivElement, any>(({ children, ...props }, ref) => (
        <div
            ref={ref}
            {...props}
            style={{
                width: '150px',
                height: '150px',
                flex: '0 0 auto'
            }}
        >
            {children}
        </div>
    )), [])

    return (
        <div className="flex flex-col h-full bg-gray-900">
            {/* Top Bar */}
            <header className="h-14 border-b border-gray-700 flex items-center px-4 bg-gray-800/50 backdrop-blur shrink-0 gap-4">
                <h2 className="text-lg font-semibold text-white">Library</h2>

                {/* Filter Dropdown */}
                <div className="flex bg-gray-700 rounded overflow-hidden">
                    <select
                        className="bg-transparent text-white text-sm px-2 py-1 border-none outline-none focus:ring-0 cursor-pointer"
                        value={filter.initial ? 'initial' : (filter.untagged ? 'untagged' : (filter.tag ? 'tag' : (filter.folder ? 'folder' : 'all')))}
                        onChange={(e) => {
                            if (e.target.value === 'untagged') setFilter({ untagged: true })
                            else if (e.target.value === 'all') setFilter({}) // Clear all filters (including initial)
                            else if (e.target.value === 'tag') {
                                setFilter({ tag: '' })
                            }
                            else if (e.target.value === 'folder') {
                                setFilter({ folder: '' })
                            }
                        }}
                    >
                        {filter.initial && <option className="bg-gray-800 text-white" value="initial" disabled>Select Filter...</option>}
                        <option className="bg-gray-800 text-white" value="all">All Photos</option>
                        <option className="bg-gray-800 text-white" value="untagged">Untagged (For Review)</option>
                        <option className="bg-gray-800 text-white" value="tag">By Tag</option>
                        <option className="bg-gray-800 text-white" value="folder">By Folder</option>
                    </select>

                    {/* Tag Selector (only if 'tag' mode) */}
                    {'tag' in filter && (
                        <select
                            className="bg-gray-600 text-white text-sm px-2 py-1 border-l border-gray-500 outline-none focus:ring-0 cursor-pointer"
                            value={filter.tag || ''}
                            onChange={(e) => setFilter({ ...filter, tag: e.target.value })}
                        >
                            <option className="bg-gray-800 text-white" value="">Select Tag...</option>
                            {availableTags.map((t: any) => (
                                <option className="bg-gray-800 text-white" key={t.name} value={t.name}>{t.name} ({t.count})</option>
                            ))}
                        </select>
                    )}

                    {/* Folder Selector (only if 'folder' mode) */}
                    {'folder' in filter && (
                        <select
                            className="bg-gray-600 text-white text-sm px-2 py-1 border-l border-gray-500 outline-none focus:ring-0 cursor-pointer max-w-[200px]"
                            value={filter.folder || ''}
                            onChange={(e) => setFilter({ ...filter, folder: e.target.value })}
                        >
                            <option className="bg-gray-800 text-white" value="">Select Folder...</option>
                            {availableFolders.map((t: any) => (
                                <option className="bg-gray-800 text-white" key={t.folder} value={t.folder} title={t.folder}>
                                    {t.folder.split(/[\\/]/).pop()}
                                </option>
                            ))}
                        </select>
                    )}
                </div>

                {/* Bulk Actions */}
                <div className="flex items-center gap-2 border-l border-gray-700 pl-4">
                    <button
                        onClick={() => {
                            setIsSelectionMode(!isSelectionMode)
                            setSelectedIds(new Set())
                        }}
                        className={`text-sm px-3 py-1 rounded transition-colors ${isSelectionMode ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                    >
                        {isSelectionMode ? 'Done' : 'Select'}
                    </button>

                    {isSelectionMode && (
                        <button
                            onClick={() => {
                                if (selectedIds.size === photos.length) {
                                    setSelectedIds(new Set())
                                } else {
                                    setSelectedIds(new Set(photos.map(p => p.id)))
                                }
                            }}
                            className="text-sm px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
                        >
                            {selectedIds.size === photos.length && photos.length > 0 ? 'Deselect All' : 'Select All'}
                        </button>
                    )}

                    {isSelectionMode && selectedIds.size > 0 && (
                        <button
                            onClick={handleRescanSelected}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded text-sm transition-colors"
                        >
                            Rescan ({selectedIds.size})
                        </button>
                    )}

                    {!isSelectionMode && (
                        <button
                            onClick={handleRescanFiltered}
                            title="Rescan all photos matching current filter"
                            className="text-gray-400 hover:text-white transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v3.25a1 1 0 11-2 0V13.011a7.002 7.002 0 01-11.266-1.688 1 1 0 01.273-1.266z" clipRule="evenodd" />
                            </svg>
                        </button>
                    )}
                </div>

                {/* AI Status Indicator */}
                <div className="flex items-center gap-2">
                    <AIStatus />
                </div>

                <div className="ml-auto flex items-center gap-2">
                    {/* Search and Scan buttons... */}
                    <input
                        type="text"
                        value={localPath}
                        onChange={e => setLocalPath(e.target.value)}
                        className="bg-gray-950 border border-gray-700 rounded px-3 py-1 text-sm w-48 text-gray-200 focus:outline-none focus:border-indigo-500 transition-colors"
                        placeholder="Folder Path..."
                    />
                    <button
                        onClick={handleBrowse}
                        className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors"
                    >
                        Browse
                    </button>
                    <button
                        onClick={handleScan}
                        disabled={scanning}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        {scanning ? `Scanning...` : 'Scan'}
                    </button>
                </div>
            </header>

            {/* Grid Content */}
            <div className="flex-1 p-4 content-start h-full">
                {photos.length === 0 && !hasMore ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-4">
                        <p>No photos loaded.</p>
                        <div className="flex gap-4">
                            <button
                                onClick={() => setFilter({})}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded font-medium transition-colors"
                            >
                                Load All Photos
                            </button>
                            <button
                                onClick={handleBrowse}
                                className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-2 rounded font-medium transition-colors"
                            >
                                Scan Folder
                            </button>
                        </div>
                    </div>
                ) : (
                    <VirtuosoGrid
                        style={{ height: '100%' }}
                        totalCount={photos.length}
                        overscan={200}
                        endReached={loadMorePhotos}
                        components={{
                            List: GridList,
                            Item: GridItem,
                            Footer: () => hasMore ? <div className="py-4 text-center text-gray-500">Loading more...</div> : null
                        }}
                        itemContent={(index) => {
                            const photo = photos[index]
                            const pathToLoad = photo.preview_cache_path || photo.file_path
                            const webPath = `local-resource://${encodeURIComponent(pathToLoad)}`
                            const isSelected = selectedIds.has(photo.id)

                            return (
                                <div
                                    className={`w-full h-full bg-gray-800 rounded overflow-hidden relative group cursor-pointer ${isSelected ? 'ring-2 ring-indigo-500' : ''}`}
                                    onClick={() => {
                                        if (isSelectionMode) {
                                            toggleSelection(photo.id)
                                        } else {
                                            setSelectedPhotoIndex(index)
                                        }
                                    }}
                                >
                                    <img
                                        src={webPath}
                                        alt=""
                                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                        loading="lazy"
                                    />
                                    <div className={`absolute inset-0 bg-black/0 transition-colors ${isSelectionMode ? 'group-hover:bg-black/10' : 'group-hover:bg-black/20'}`} />

                                    {/* Selection Overlay */}
                                    {isSelectionMode && (
                                        <div className="absolute top-2 right-2">
                                            <div className={`w-5 h-5 rounded-full border border-white flex items-center justify-center ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'bg-black/30'}`}>
                                                {isSelected && (
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                    </svg>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        }}
                    />
                )}
            </div>

            {/* Detail View Overlay */}
            {selectedPhotoIndex !== null && photos[selectedPhotoIndex] && (
                <PhotoDetail
                    photo={photos[selectedPhotoIndex]}
                    onClose={() => setSelectedPhotoIndex(null)}
                    onNext={() => setSelectedPhotoIndex(prev => (prev === null || prev === photos.length - 1) ? prev : prev + 1)}
                    onPrev={() => setSelectedPhotoIndex(prev => (prev === null || prev === 0) ? prev : prev - 1)}
                />
            )}
        </div>
    )
}
