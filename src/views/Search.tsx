import React, { useState, useMemo } from 'react'
import { VirtuosoGrid } from 'react-virtuoso'
import { useSearch } from '../hooks/useSearch'
import FilterPanel from '../components/FilterPanel'
import FilterBuilder from '../components/FilterBuilder'
import PhotoDetail from '../components/PhotoDetail'
import type { PhotoFilter, SearchSort } from '../types/filterTypes'

export default function Search() {
    const {
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
        loadMore,
        clearFilters,
        createSmartAlbum,
        deleteSmartAlbum,
        applySmartAlbum,
    } = useSearch()

    const [showCompound, setShowCompound] = useState(false)
    const [viewingPhoto, setViewingPhoto] = useState<any>(null)

    const navigatePhoto = (dir: number) => {
        if (!viewingPhoto) return
        const idx = photos.findIndex((p: any) => p.id === viewingPhoto.id)
        const next = photos[idx + dir]
        if (next) setViewingPhoto(next)
    }

    // Active filter chips
    const activeChips = useMemo(() => {
        const chips: { key: string; label: string }[] = []
        if (compoundFilter) {
            chips.push({ key: 'compound', label: `Compound (${compoundFilter.groups.length} groups)` })
            return chips
        }
        if (filter.search) chips.push({ key: 'search', label: `"${filter.search}"` })
        if (filter.folder) chips.push({ key: 'folder', label: `Folder: ${filter.folder.split('\\').pop() || filter.folder}` })
        if (filter.tag) chips.push({ key: 'tag', label: `Tag: ${filter.tag}` })
        if (filter.people?.length) chips.push({ key: 'people', label: `Person` })
        if (filter.year) chips.push({ key: 'year', label: `Year: ${filter.year}` })
        if (filter.month) chips.push({ key: 'month', label: `Month: ${filter.month}` })
        if (filter.camera) chips.push({ key: 'camera', label: `Camera: ${filter.camera}` })
        if (filter.fileType) chips.push({ key: 'fileType', label: `Type: ${filter.fileType.toUpperCase()}` })
        if (filter.blurScoreMin !== undefined) chips.push({ key: 'blurMin', label: `Blur >= ${filter.blurScoreMin}` })
        if (filter.blurScoreMax !== undefined) chips.push({ key: 'blurMax', label: `Blur <= ${filter.blurScoreMax}` })
        if (filter.hasFaces !== undefined) chips.push({ key: 'faces', label: filter.hasFaces ? 'Has faces' : 'No faces' })
        if (filter.frontalFacesOnly) chips.push({ key: 'frontal', label: 'Frontal faces' })
        if (filter.unnamedFacesOnly) chips.push({ key: 'unnamed', label: 'Unnamed faces' })
        if (filter.confidenceTier) chips.push({ key: 'confidence', label: `Confidence: ${filter.confidenceTier}` })
        if (filter.dateFrom) chips.push({ key: 'dateFrom', label: `From: ${filter.dateFrom}` })
        if (filter.dateTo) chips.push({ key: 'dateTo', label: `To: ${filter.dateTo}` })
        return chips
    }, [filter, compoundFilter])

    const removeChip = (key: string) => {
        if (key === 'compound') {
            setCompoundFilter(null)
            return
        }
        const updated: PhotoFilter = { ...filter }
        const fieldMap: Record<string, keyof PhotoFilter> = {
            search: 'search', folder: 'folder', tag: 'tag', people: 'people',
            year: 'year', month: 'month', camera: 'camera', fileType: 'fileType',
            blurMin: 'blurScoreMin', blurMax: 'blurScoreMax', faces: 'hasFaces',
            frontal: 'frontalFacesOnly', unnamed: 'unnamedFacesOnly',
            confidence: 'confidenceTier', dateFrom: 'dateFrom', dateTo: 'dateTo',
        }
        const field = fieldMap[key]
        if (field) delete updated[field]
        setFilter(updated)
    }

    const GridList = useMemo(() => React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
        ({ style, children, ...props }, ref) => (
            <div ref={ref} {...props} style={{ ...style, display: 'flex', flexWrap: 'wrap', gap: '12px', paddingLeft: '12px', paddingRight: '12px', paddingTop: '12px' }}>
                {children}
            </div>
        )
    ), [])

    const GridItem = useMemo(() => React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
        ({ children, ...props }, ref) => (
            <div ref={ref} {...props} style={{ width: '150px', height: '150px', flex: '0 0 auto' }}>
                {children}
            </div>
        )
    ), [])

    return (
        <div className="flex h-full bg-gray-900">
            {/* Filter sidebar */}
            <FilterPanel
                filter={filter}
                metadata={metadata}
                smartAlbums={smartAlbums}
                onFilterChange={setFilter}
                onClear={clearFilters}
                onSaveAlbum={createSmartAlbum}
                onLoadAlbum={applySmartAlbum}
                onDeleteAlbum={deleteSmartAlbum}
                onOpenCompound={() => setShowCompound(true)}
            />

            {/* Main area */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Top bar */}
                <header className="h-12 border-b border-gray-700 flex items-center px-4 bg-gray-800/50 backdrop-blur shrink-0 gap-3">
                    <span className="text-sm text-gray-300">
                        {total > 0 ? `${total.toLocaleString()} results` : 'No results'}
                    </span>

                    {/* Active chips */}
                    <div className="flex-1 flex items-center gap-1.5 overflow-x-auto">
                        {activeChips.map(chip => (
                            <span
                                key={chip.key}
                                className="inline-flex items-center gap-1 bg-indigo-600/30 text-indigo-200 text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
                            >
                                {chip.label}
                                <button
                                    onClick={() => removeChip(chip.key)}
                                    className="hover:text-white ml-0.5"
                                >
                                    x
                                </button>
                            </span>
                        ))}
                        {activeChips.length > 0 && (
                            <button
                                onClick={clearFilters}
                                className="text-xs text-gray-400 hover:text-white whitespace-nowrap"
                            >
                                Clear all
                            </button>
                        )}
                    </div>

                    {/* Sort */}
                    <select
                        value={sort}
                        onChange={e => setSort(e.target.value as SearchSort)}
                        className="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:border-indigo-500 focus:outline-none"
                    >
                        <option value="date_desc">Newest</option>
                        <option value="date_asc">Oldest</option>
                        <option value="name_asc">Name A-Z</option>
                        <option value="name_desc">Name Z-A</option>
                    </select>
                </header>

                {/* Photo grid */}
                <div className="flex-1 overflow-hidden">
                    {!hasActiveFilter && photos.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            <div className="text-center max-w-sm">
                                <p className="text-lg mb-2">Search &amp; Filter</p>
                                <p className="text-sm mb-4">Use the filters on the left to find photos. Try a blur preset, pick a year, or search by file name.</p>
                                {smartAlbums.length > 0 && (
                                    <p className="text-xs text-gray-600">Or load a saved Smart Album from the sidebar.</p>
                                )}
                            </div>
                        </div>
                    ) : photos.length === 0 && !loading ? (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            <div className="text-center">
                                <p className="text-lg mb-2">No photos found</p>
                                <p className="text-sm">Adjust your filters or try a different search</p>
                            </div>
                        </div>
                    ) : (
                        <VirtuosoGrid
                            totalCount={photos.length}
                            components={{
                                List: GridList,
                                Item: GridItem,
                            }}
                            endReached={() => {
                                if (hasMore && !loading) loadMore()
                            }}
                            itemContent={(index: number) => {
                                const photo = photos[index]
                                if (!photo) return null
                                const src = photo.preview_cache_path
                                    ? `local-resource://${encodeURIComponent(photo.preview_cache_path)}`
                                    : `local-resource://${encodeURIComponent(photo.file_path)}`
                                return (
                                    <div
                                        className="relative w-full h-full rounded-lg overflow-hidden cursor-pointer group bg-gray-800"
                                        onClick={() => setViewingPhoto(photo)}
                                    >
                                        <img
                                            src={src}
                                            alt=""
                                            loading="lazy"
                                            className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                        />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                                    </div>
                                )
                            }}
                        />
                    )}
                    {loading && (
                        <div className="flex justify-center py-4">
                            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}
                </div>
            </div>

            {/* Compound filter builder modal */}
            {showCompound && (
                <FilterBuilder
                    initial={compoundFilter}
                    metadata={metadata}
                    onApply={(cf) => {
                        setCompoundFilter(cf)
                        setShowCompound(false)
                    }}
                    onClose={() => setShowCompound(false)}
                />
            )}

            {/* Photo detail overlay */}
            {viewingPhoto && (
                <PhotoDetail
                    photo={viewingPhoto}
                    onClose={() => setViewingPhoto(null)}
                    onNext={() => navigatePhoto(1)}
                    onPrev={() => navigatePhoto(-1)}
                />
            )}
        </div>
    )
}
