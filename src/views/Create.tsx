import React, { useState, useMemo, useEffect } from 'react'
import { useScan } from '../context/ScanContext'
import { VirtuosoGrid } from 'react-virtuoso'
import { Cross2Icon, PlusIcon, FilePlusIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons'

export default function Create() {
    const { photos, loadMorePhotos, hasMore, setFilter, availableTags, availablePeople, loadTags, loadPeople, loadingPhotos, filter } = useScan()

    // Local Search State
    const [localTags, setLocalTags] = useState<string[]>([])
    const [tagsMatchAll, setTagsMatchAll] = useState(false)
    const [localPeople, setLocalPeople] = useState<number[]>([])
    const [peopleMatchAll, setPeopleMatchAll] = useState(false)
    const [semanticSearch, setSemanticSearch] = useState('')

    // Staging State
    const [currentSet, setCurrentSet] = useState<any[]>([])
    const [showExportModal, setShowExportModal] = useState(false)
    const [exportPath, setExportPath] = useState('')

    // Initialize filter on mount
    useEffect(() => {
        // Start empty
        setFilter({ initial: true })
        // Ensure data is loaded
        loadTags()
        loadPeople()
    }, [])

    const handleSearch = () => {
        setFilter({
            tags: localTags,
            tagsMatchAll,
            people: localPeople,
            peopleMatchAll,
            search: semanticSearch
        })
    }

    const addToSet = (photo: any) => {
        if (!currentSet.find(p => p.id === photo.id)) {
            setCurrentSet([...currentSet, photo])
        }
    }

    const removeFromSet = (id: number) => {
        setCurrentSet(currentSet.filter(p => p.id !== id))
    }

    const addAllResults = () => {
        // Adds all currently loaded results
        const newPhotos = photos.filter(p => !currentSet.find(existing => existing.id === p.id))
        setCurrentSet([...currentSet, ...newPhotos])
    }

    const handleExport = async () => {
        if (currentSet.length === 0) return;

        // @ts-ignore
        const dir = await window.ipcRenderer.invoke('dialog:openDirectory')
        if (dir) {
            const result = await (window as any).ipcRenderer.invoke('os:createAlbum', {
                photoIds: currentSet.map(p => p.id),
                targetDir: dir
            })

            if (result.success) {
                alert(`Successfully exported ${result.successCount} photos to ${dir}`)
                setCurrentSet([]) // Clear set on success?
            } else {
                alert(`Export failed: ${result.error}`)
            }
        }
    }

    // Grid Components
    const GridList = useMemo(() => React.forwardRef<HTMLDivElement, any>(({ style, children, ...props }, ref) => (
        <div ref={ref} {...props} style={style} className="flex flex-wrap gap-2 p-4">
            {children}
        </div>
    )), [])

    const GridItem = useMemo(() => React.forwardRef<HTMLDivElement, any>(({ children, ...props }, ref) => (
        <div ref={ref} {...props} style={{ width: '120px', height: '120px' }}>
            {children}
        </div>
    )), [])

    return (
        <div className="flex h-full bg-gray-900 text-gray-200">
            {/* Left Panel: Search & Filters */}
            <div className="w-80 border-r border-gray-700 flex flex-col bg-gray-800/50">
                <div className="p-4 border-b border-gray-700">
                    <h2 className="text-lg font-semibold text-white mb-4">Search</h2>

                    {/* People Filter */}
                    <div className="mb-6">
                        <label className="text-sm font-medium text-gray-400 mb-2 block">People</label>
                        <select
                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm mb-2"
                            onChange={(e) => {
                                const val = parseInt(e.target.value)
                                if (val && !localPeople.includes(val)) setLocalPeople([...localPeople, val])
                            }}
                            value=""
                        >
                            <option value="">Add Person...</option>
                            {availablePeople.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>

                        <div className="flex flex-wrap gap-2 mb-2">
                            {localPeople.map(id => {
                                const p = availablePeople.find(ap => ap.id === id)
                                return (
                                    <div key={id} className="bg-indigo-900 text-xs px-2 py-1 rounded flex items-center gap-1">
                                        {p ? p.name : id}
                                        <button onClick={() => setLocalPeople(localPeople.filter(pid => pid !== id))}><Cross2Icon /></button>
                                    </div>
                                )
                            })}
                        </div>

                        <label className="flex items-center gap-2 text-xs text-gray-400">
                            <input type="checkbox" checked={peopleMatchAll} onChange={e => setPeopleMatchAll(e.target.checked)} />
                            Match ALL Selected People
                        </label>
                    </div>

                    {/* Tags Filter */}
                    <div className="mb-6">
                        <label className="text-sm font-medium text-gray-400 mb-2 block">Tags</label>
                        <select
                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm mb-2"
                            onChange={(e) => {
                                const val = e.target.value
                                if (val && !localTags.includes(val)) setLocalTags([...localTags, val])
                            }}
                            value=""
                        >
                            <option value="">Add Tag...</option>
                            {availableTags.map(t => (
                                <option key={t.name} value={t.name}>{t.name}</option>
                            ))}
                        </select>
                        <div className="flex flex-wrap gap-2 mb-2">
                            {localTags.map(tag => (
                                <div key={tag} className="bg-emerald-900 text-xs px-2 py-1 rounded flex items-center gap-1">
                                    {tag}
                                    <button onClick={() => setLocalTags(localTags.filter(t => t !== tag))}><Cross2Icon /></button>
                                </div>
                            ))}
                        </div>
                        <label className="flex items-center gap-2 text-xs text-gray-400">
                            <input type="checkbox" checked={tagsMatchAll} onChange={e => setTagsMatchAll(e.target.checked)} />
                            Match ALL Selected Tags
                        </label>
                    </div>

                    {/* Text Search */}
                    <div className="mb-6">
                        <label className="text-sm font-medium text-gray-400 mb-2 block">Text Search</label>
                        <input
                            type="text"
                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm"
                            placeholder="Search description..."
                            value={semanticSearch}
                            onChange={(e) => setSemanticSearch(e.target.value)}
                        />
                    </div>

                    <button
                        onClick={handleSearch}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded font-medium transition-colors flex items-center justify-center gap-2"
                    >
                        <MagnifyingGlassIcon /> Search
                    </button>
                </div>
            </div>

            {/* Middle Panel: Results */}
            <div className="flex-1 flex flex-col min-w-0">
                <div className="h-12 border-b border-gray-700 flex items-center justify-between px-4 bg-gray-800/30">
                    <span className="text-sm text-gray-400">{photos.length} Results Found</span>
                    <button
                        onClick={addAllResults}
                        disabled={photos.length === 0}
                        className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
                    >
                        Add All to Set
                    </button>
                </div>

                <div className="flex-1 overflow-hidden relative">
                    {loadingPhotos && photos.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
                            <div className="flex flex-col items-center gap-2">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                                <span className="text-gray-400">Searching...</span>
                            </div>
                        </div>
                    )}

                    {!loadingPhotos && photos.length === 0 && !filter.initial && (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                            No photos found matching your criteria.
                        </div>
                    )}

                    {!loadingPhotos && photos.length === 0 && filter.initial && (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                            Use search to find photos.
                        </div>
                    )}

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
                            const webPath = `local-resource://${encodeURIComponent(photo.preview_cache_path || photo.file_path)}`
                            const inSet = currentSet.some(p => p.id === photo.id)

                            return (
                                <div
                                    className={`w-full h-full bg-gray-800 rounded overflow-hidden relative group cursor-pointer border-2 ${inSet ? 'border-green-500 opacity-50' : 'border-transparent'}`}
                                    onClick={() => !inSet && addToSet(photo)}
                                >
                                    <img src={webPath} alt="" className="w-full h-full object-cover" loading="lazy" />
                                    {!inSet && (
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                            <PlusIcon className="w-8 h-8 text-white" />
                                        </div>
                                    )}
                                </div>
                            )
                        }}
                    />
                </div>
            </div>

            {/* Right Panel: Current Set */}
            <div className="w-72 border-l border-gray-700 flex flex-col bg-gray-800/50">
                <div className="h-12 border-b border-gray-700 flex items-center justify-between px-4">
                    <h2 className="font-semibold text-white">Current Set</h2>
                    <span className="text-xs bg-gray-700 px-2 py-1 rounded text-gray-200">{currentSet.length}</span>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {currentSet.length === 0 ? (
                        <div className="text-center text-gray-500 text-sm mt-10">
                            No photos in set.<br />Add photos from search results.
                        </div>
                    ) : (
                        currentSet.map(photo => (
                            <div key={photo.id} className="flex gap-3 items-center bg-gray-900 p-2 rounded group">
                                <img
                                    src={`local-resource://${encodeURIComponent(photo.preview_cache_path || photo.file_path)}`}
                                    className="w-12 h-12 object-cover rounded"
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs text-gray-400 truncate" title={photo.file_path}>
                                        {photo.file_path.split(/[\\/]/).pop()}
                                    </div>
                                </div>
                                <button
                                    onClick={() => removeFromSet(photo.id)}
                                    className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <Cross2Icon />
                                </button>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-4 border-t border-gray-700 bg-gray-800">
                    <button
                        onClick={handleExport}
                        disabled={currentSet.length === 0}
                        className="w-full bg-green-600 hover:bg-green-500 text-white py-2 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        <FilePlusIcon /> Export Album
                    </button>
                    {currentSet.length > 0 && (
                        <button
                            onClick={() => setCurrentSet([])}
                            className="w-full mt-2 text-xs text-gray-500 hover:text-gray-300"
                        >
                            Clear Set
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
