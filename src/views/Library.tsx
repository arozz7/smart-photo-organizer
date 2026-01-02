import React, { useState, useMemo, useEffect } from 'react'
import { useScan } from '../context/ScanContext'
import { useAI } from '../context/AIContext'
import { useAlert } from '../context/AlertContext'
import { VirtuosoGrid } from 'react-virtuoso'

// import AIStatus from '../components/AIStatus'
import ScanErrorsModal from '../components/ScanErrorsModal'
import SettingsModal from '../components/SettingsModal'
import { GearIcon, ChevronDownIcon } from '@radix-ui/react-icons'

export default function Library() {
    const { scanning, startScan, scanPath, photos, loadMorePhotos, hasMore, filter, setFilter, availableTags, availableFolders, availablePeople, scanErrors, loadScanErrors, setViewingPhoto, rescanFiles } = useScan()
    const { setThrottled } = useAI()
    const { showAlert, showConfirm } = useAlert()
    const [localPath, setLocalPath] = useState(scanPath || 'D:\\Photos')
    const [isSelectionMode, setIsSelectionMode] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    const [showErrors, setShowErrors] = useState(false)
    const [showSettings, setShowSettings] = useState(false)
    const [showScanMenu, setShowScanMenu] = useState(false)

    useEffect(() => {
        loadScanErrors()
        // Enable Throttling to keep scrolling smooth
        setThrottled(true)
        return () => setThrottled(false)
    }, [])

    useEffect(() => {
        if (photos.length === 0 && hasMore && !scanning) {
            loadMorePhotos()
        }
    }, [scanning])

    const handleScan = async (forceRescan = false) => {
        try {
            setShowScanMenu(false)
            await startScan(localPath, { forceRescan })
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

        showConfirm({
            title: 'Rescan Selected',
            description: `Force rescan (refresh metadata + AI) for ${selectedIds.size} selected photos?`,
            confirmLabel: 'Rescan Now',
            onConfirm: async () => {
                await rescanFiles(Array.from(selectedIds))
                setIsSelectionMode(false)
                setSelectedIds(new Set())
            }
        });
    }

    const handleRescanFiltered = async () => {
        showConfirm({
            title: 'Bulk Rescan',
            description: 'Rescan ALL photos matching the current filter? This will refresh metadata and run AI logic.',
            confirmLabel: 'Prepare Rescan',
            onConfirm: async () => {
                try {
                    // @ts-ignore
                    const photosToRescan = await window.ipcRenderer.invoke('db:getPhotosForRescan', { filter })
                    if (photosToRescan.length > 0) {
                        // Workaround: Wait for current modal to close before opening next one
                        setTimeout(() => {
                            showConfirm({
                                title: 'Proceed with Rescan',
                                description: `Found ${photosToRescan.length} photos. Proceed with Force Rescan?`,
                                confirmLabel: 'Start Processing',
                                onConfirm: async () => {
                                    const ids = photosToRescan.map((p: any) => p.id);
                                    await rescanFiles(ids);
                                }
                            });
                        }, 200);
                    } else {
                        setTimeout(() => {
                            showAlert({
                                title: 'No Photos Found',
                                description: 'No photo found matching current filter.'
                            });
                        }, 200);
                    }
                } catch (e) {
                    console.error(e)
                    showAlert({
                        title: 'Error',
                        description: 'Failed to fetch photos for rescan.',
                        variant: 'danger'
                    });
                }
            }
        });
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

    // Local state for search to allow debouncing
    const [searchQuery, setSearchQuery] = useState('')

    // Sync local search query with filter when filter changes externally (or initializing)
    useEffect(() => {
        if ('search' in filter && filter.search !== searchQuery) {
            setSearchQuery(filter.search || '')
        }
    }, [filter.search])

    // Debounce search updates
    useEffect(() => {
        if (!('search' in filter)) return

        const timeout = setTimeout(() => {
            if (searchQuery !== filter.search) {
                setFilter({ ...filter, search: searchQuery })
            }
        }, 500)

        return () => clearTimeout(timeout)
    }, [searchQuery])

    return (
        <div className="flex flex-col h-full bg-gray-900">
            {/* Top Bar */}
            <header className="h-14 border-b border-gray-700 flex items-center px-4 bg-gray-800/50 backdrop-blur shrink-0 gap-4">
                <h2 className="text-lg font-semibold text-white">Library</h2>

                {/* Filter Dropdown */}
                <div className="flex bg-gray-700 rounded overflow-hidden">
                    <select
                        className="bg-transparent text-white text-sm px-2 py-1 border-none outline-none focus:ring-0 cursor-pointer"
                        value={
                            filter.initial ? 'initial' :
                                ('untagged' in filter ? 'untagged' :
                                    ('tag' in filter ? 'tag' :
                                        ('people' in filter ? 'people' :
                                            ('search' in filter ? 'search' :
                                                ('folder' in filter ? 'folder' : 'all')))))
                        }
                        onChange={(e) => {
                            const mode = e.target.value
                            if (mode === 'untagged') setFilter({ untagged: true })
                            else if (mode === 'all') setFilter({})
                            else if (mode === 'tag') setFilter({ tag: '' })
                            else if (mode === 'search') {
                                setFilter({ search: '' })
                                setSearchQuery('')
                            }
                            else if (mode === 'folder') setFilter({ folder: '' })
                            else if (mode === 'people') setFilter({ people: [] })
                        }}
                    >
                        {filter.initial && <option className="bg-gray-800 text-white" value="initial" disabled>Select Filter...</option>}
                        <option className="bg-gray-800 text-white" value="all">All Photos</option>
                        <option className="bg-gray-800 text-white" value="untagged">Untagged (Review)</option>
                        <option className="bg-gray-800 text-white" value="tag">By Tag</option>
                        <option className="bg-gray-800 text-white" value="people">By Person</option>
                        <option className="bg-gray-800 text-white" value="search">Search (AI)</option>
                        <option className="bg-gray-800 text-white" value="folder">By Folder</option>
                    </select>

                    {/* Tag Selector */}
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

                    {/* Person Selector */}
                    {'people' in filter && (
                        <select
                            className="bg-gray-600 text-white text-sm px-2 py-1 border-l border-gray-500 outline-none focus:ring-0 cursor-pointer max-w-[200px]"
                            value={(filter.people && filter.people.length > 0) ? filter.people[0] : ''}
                            onChange={(e) => {
                                const val = e.target.value
                                setFilter({ ...filter, people: val ? [parseInt(val)] : [] })
                            }}
                        >
                            <option className="bg-gray-800 text-white" value="">Select Person...</option>
                            {availablePeople.map((p: any) => (
                                <option className="bg-gray-800 text-white" key={p.id} value={p.id}>{p.name} ({p.face_count})</option>
                            ))}
                        </select>
                    )}

                    {/* Search Input */}
                    {'search' in filter && (
                        <input
                            type="text"
                            className="bg-gray-600 text-white text-sm px-2 py-1 border-l border-gray-500 outline-none focus:ring-0 w-32 placeholder-gray-400"
                            placeholder="e.g. 'dog'"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    )}

                    {/* Folder Selector */}
                    {'folder' in filter && (
                        <select
                            className="bg-gray-600 text-white text-sm px-2 py-1 border-l border-gray-500 outline-none focus:ring-0 cursor-pointer max-w-[200px]"
                            value={filter.folder || ''}
                            onChange={(e) => setFilter({ ...filter, folder: e.target.value })}
                        >
                            <option className="bg-gray-800 text-white" value="">Select Folder...</option>
                            {availableFolders.map((t: any) => (
                                t && t.folder ? (
                                    <option className="bg-gray-800 text-white" key={t.folder} value={t.folder} title={t.folder}>
                                        {t.folder.split(/[\\/]/).pop()}
                                    </option>
                                ) : null
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
                    {/* AIStatus moved to StatusBar */}

                    {scanErrors.length > 0 && (
                        <button
                            onClick={() => setShowErrors(true)}
                            className="flex items-center gap-1.5 px-2 py-1 bg-red-900/50 hover:bg-red-900/80 border border-red-700/50 rounded transition-colors text-red-200"
                            title={`${scanErrors.length} scanning errors`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            <span className="text-xs font-medium">{scanErrors.length}</span>
                        </button>
                    )}
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
                    <div className="relative flex items-center">
                        <button
                            onClick={() => handleScan(false)}
                            disabled={scanning}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-l text-sm font-medium transition-colors disabled:opacity-50 border-r border-indigo-700"
                        >
                            {scanning ? `Scanning...` : 'Scan'}
                        </button>
                        <button
                            disabled={scanning}
                            onClick={() => setShowScanMenu(!showScanMenu)}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-1.5 py-1.5 rounded-r text-sm transition-colors disabled:opacity-50"
                        >
                            <ChevronDownIcon />
                        </button>

                        {showScanMenu && (
                            <div className="absolute top-full right-0 mt-1 w-48 bg-gray-800 border border-gray-700 rounded shadow-xl z-50 overflow-hidden">
                                <button
                                    onClick={() => handleScan(true)}
                                    className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors"
                                >
                                    Force Rescan (Check All)
                                </button>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={() => setShowSettings(true)}
                        className="bg-gray-700 hover:bg-gray-600 text-gray-300 p-1.5 rounded transition-colors"
                        title="AI Settings"
                    >
                        <GearIcon className="w-5 h-5" />
                    </button>
                </div>
            </header>

            <SettingsModal
                open={showSettings}
                onOpenChange={setShowSettings}
            />

            {/* Grid Content */}
            <div className="flex-1 p-4 content-start h-full">
                {photos.length === 0 && !hasMore ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-4">
                        {('tag' in filter && !filter.tag) ? (
                            <p className="text-lg">Select a tag from the dropdown above to view photos.</p>
                        ) : ('folder' in filter && !filter.folder) ? (
                            <p className="text-lg">Select a folder from the dropdown above to view photos.</p>
                        ) : ('people' in filter && (!filter.people || filter.people.length === 0)) ? (
                            <p className="text-lg">Select a person from the dropdown above to view photos.</p>
                        ) : ('search' in filter && !filter.search) ? (
                            <p className="text-lg">Start typing to search for photos via AI.</p>
                        ) : (
                            <>
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
                            </>
                        )}
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
                                            setViewingPhoto(photo)
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


            {/* Error Modal */}
            {showErrors && (
                <ScanErrorsModal onClose={() => setShowErrors(false)} />
            )}
        </div>
    )
}
