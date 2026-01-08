import React, { useState, useEffect, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import FaceThumbnail from './FaceThumbnail'
import RenameModal from './modals/RenameModal'
import { usePeople } from '../context/PeopleContext'
import { useScan } from '../context/ScanContext'
import { useToast } from '../context/ToastContext'

interface NoiseCandidate {
    faceId: number;
    photoCount: number;
    clusterSize: number;
    nearestPersonDistance: number;
    nearestPersonName: string | null;
    box: { x: number; y: number; width: number; height: number };
    photo_id: number;
    file_path: string;
    preview_cache_path: string | null;
    photo_width: number;
    photo_height: number;
}

interface BackgroundFaceFilterModalProps {
    isOpen: boolean
    onClose: () => void
}

const BATCH_SIZE = 150 // Load manageable chunks

interface FilterState {
    singlePhotoOnly: boolean;
    maxClusterSize: number | null;  // null = no filter
    minDistance: number | null;     // null = no filter
}

const DEFAULT_FILTERS: FilterState = {
    singlePhotoOnly: false,
    maxClusterSize: null,
    minDistance: null
};

export default function BackgroundFaceFilterModal({ isOpen, onClose }: BackgroundFaceFilterModalProps) {
    const { loadFaces, loadPeople } = usePeople()
    const { viewPhoto, viewingPhoto } = useScan()
    const { addToast } = useToast()

    // All candidates from backend
    const [allCandidates, setAllCandidates] = useState<NoiseCandidate[]>([])
    // Displayed candidates (batched)
    const [displayedCount, setDisplayedCount] = useState(0)

    const [stats, setStats] = useState({ totalUnnamed: 0, singlePhotoCount: 0, twoPhotoCount: 0, noiseCount: 0 })
    const [loading, setLoading] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    const [isIgnoring, setIsIgnoring] = useState(false)
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false)
    const [isNaming, setIsNaming] = useState(false)

    // Filter state
    const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
    const [showFilters, setShowFilters] = useState(false)

    // Apply filters client-side for performance
    const filteredCandidates = React.useMemo(() => {
        return allCandidates.filter(c => {
            if (filters.singlePhotoOnly && c.photoCount !== 1) return false;
            if (filters.maxClusterSize !== null && c.clusterSize > filters.maxClusterSize) return false;
            if (filters.minDistance !== null && c.nearestPersonDistance < filters.minDistance) return false;
            return true;
        });
    }, [allCandidates, filters]);

    // Displayed candidates slice (from filtered, not raw)
    const displayedCandidates = filteredCandidates.slice(0, displayedCount)

    // Load candidates when modal opens
    useEffect(() => {
        if (isOpen) {
            detectBackgroundFaces()
        } else {
            // Reset state on close
            setAllCandidates([])
            setDisplayedCount(0)
            setSelectedIds(new Set())
            setFilters(DEFAULT_FILTERS)
            setShowFilters(false)
        }
    }, [isOpen])

    const detectBackgroundFaces = useCallback(async () => {
        setLoading(true)
        setSelectedIds(new Set())
        setDisplayedCount(0)
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:detectBackgroundFaces', {})
            if (result.success) {
                const candidates = result.candidates || []
                setAllCandidates(candidates)
                setStats(result.stats || { totalUnnamed: 0, singlePhotoCount: 0, twoPhotoCount: 0, noiseCount: 0 })

                // Load initial batch
                const initialBatch = Math.min(BATCH_SIZE, candidates.length)
                setDisplayedCount(initialBatch)

                // Auto-select initial batch
                setSelectedIds(new Set(candidates.slice(0, initialBatch).map((c: NoiseCandidate) => c.faceId)))
            } else {
                console.error('detectBackgroundFaces failed:', result.error)
            }
        } catch (e) {
            console.error('detectBackgroundFaces error:', e)
        } finally {
            setLoading(false)
        }
    }, [])

    const loadMore = useCallback(() => {
        if (displayedCount >= filteredCandidates.length) return
        setLoadingMore(true)

        // Simulate async to not block UI
        setTimeout(() => {
            const nextBatch = Math.min(displayedCount + BATCH_SIZE, filteredCandidates.length)

            // Auto-select the new batch as well
            const newIds = filteredCandidates.slice(displayedCount, nextBatch).map(c => c.faceId)
            setSelectedIds(prev => {
                const next = new Set(prev)
                newIds.forEach(id => next.add(id))
                return next
            })

            setDisplayedCount(nextBatch)
            setLoadingMore(false)
        }, 50)
    }, [displayedCount, filteredCandidates])

    const toggleSelection = (faceId: number) => {
        const next = new Set(selectedIds)
        if (next.has(faceId)) next.delete(faceId)
        else next.add(faceId)
        setSelectedIds(next)
    }

    const selectAllLoaded = () => setSelectedIds(new Set(displayedCandidates.map(c => c.faceId)))
    const selectNone = () => setSelectedIds(new Set())

    const handleIgnoreSelected = async () => {
        if (selectedIds.size === 0) return
        setIsIgnoring(true)
        const count = selectedIds.size
        try {
            const ids = Array.from(selectedIds)
            // @ts-ignore
            await window.ipcRenderer.invoke('db:ignoreFaces', ids)

            // Remove from local state
            setAllCandidates(prev => {
                const remaining = prev.filter(c => !selectedIds.has(c.faceId))
                // Replenish the view
                const nextBatchSize = Math.min(remaining.length, Math.max(displayedCount, BATCH_SIZE))
                setDisplayedCount(nextBatchSize)

                // Auto-select the next batch if there are any
                if (nextBatchSize > 0) {
                    setSelectedIds(new Set(remaining.slice(0, nextBatchSize).map(c => c.faceId)))
                } else {
                    setSelectedIds(new Set())
                }

                return remaining
            })
            // Don't modify displayedCount directly here, done inside setAllCandidates logic
            // setSelectedIds handled inside setAllCandidates to ensure sync

            // Refresh parent views
            loadFaces({ unnamed: true })
            loadPeople()

            addToast({
                title: 'Faces Ignored',
                description: `Ignored ${count} background face${count !== 1 ? 's' : ''}.`,
                type: 'success',
                duration: 3000
            })
        } catch (e) {
            console.error('ignoreFaces failed:', e)
        } finally {
            setIsIgnoring(false)
        }
    }

    const handleNameSelected = async (name: string) => {
        if (selectedIds.size === 0 || !name.trim()) return
        setIsNaming(true)
        const count = selectedIds.size
        try {
            const ids = Array.from(selectedIds)
            // @ts-ignore - Use existing reassignFaces handler
            const result = await window.ipcRenderer.invoke('db:reassignFaces', {
                faceIds: ids,
                personName: name.trim()
            })

            if (result.success) {
                // Remove from local state
                setAllCandidates(prev => {
                    const remaining = prev.filter(c => !selectedIds.has(c.faceId))
                    // Replenish the view
                    const nextBatchSize = Math.min(remaining.length, Math.max(displayedCount, BATCH_SIZE))
                    setDisplayedCount(nextBatchSize)

                    // Auto-select next batch
                    if (nextBatchSize > 0) {
                        setSelectedIds(new Set(remaining.slice(0, nextBatchSize).map(c => c.faceId)))
                    } else {
                        setSelectedIds(new Set())
                    }

                    return remaining
                })
                setIsRenameModalOpen(false)

                // Refresh parent views
                loadFaces({ unnamed: true })
                loadPeople()

                addToast({
                    title: 'Faces Named',
                    description: `Assigned ${count} face${count !== 1 ? 's' : ''} to "${name}".`,
                    type: 'success',
                    duration: 3000
                })
            } else {
                console.error('nameFaces failed:', result.error)
            }
        } catch (e) {
            console.error('nameFaces error:', e)
        } finally {
            setIsNaming(false)
        }
    }

    return (
        <>
            <Dialog.Root open={isOpen} onOpenChange={open => !open && onClose()}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 animate-fade-in" />
                    <Dialog.Content
                        onEscapeKeyDown={(e) => {
                            if (viewingPhoto) e.preventDefault();
                        }}
                        onPointerDownOutside={(e) => {
                            if (viewingPhoto) e.preventDefault();
                        }}
                        onInteractOutside={(e) => {
                            if (viewingPhoto) e.preventDefault();
                        }}
                        className="fixed inset-4 md:inset-10 bg-gray-900 rounded-xl border border-gray-800 shadow-2xl z-50 flex flex-col overflow-hidden animate-scale-in"
                    >

                        {/* Header */}
                        <Dialog.Description className="sr-only">
                            Filter background faces for bulk ignore. These are faces that appear infrequently and don't match any named person.
                        </Dialog.Description>
                        <div className="flex-none p-4 border-b border-gray-800 flex items-center justify-between text-white bg-gray-900/50 backdrop-blur">
                            <Dialog.Title className="text-xl font-semibold flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
                                </svg>
                                Background Face Filter
                                <span className="text-sm font-normal text-gray-400 ml-2">
                                    ({allCandidates.length} total)
                                </span>
                            </Dialog.Title>
                            <button
                                onClick={onClose}
                                className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg text-sm transition-colors"
                            >
                                Close
                            </button>
                        </div>

                        {/* Stats Bar */}
                        <div className="flex-none p-3 bg-gray-800/30 border-b border-gray-800">
                            <div className="flex items-center gap-6 text-sm">
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-400">Total Unnamed:</span>
                                    <span className="font-mono text-white">{stats.totalUnnamed}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-400">Single Photo:</span>
                                    <span className="font-mono text-amber-400">{stats.singlePhotoCount}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-400">Noise Candidates:</span>
                                    <span className="font-mono text-red-400 font-bold">{stats.noiseCount}</span>
                                </div>
                                <div className="flex-1" />

                                {/* Filter Toggle */}
                                <button
                                    onClick={() => setShowFilters(!showFilters)}
                                    className={`text-xs px-2 py-1 rounded transition-colors flex items-center gap-1 ${showFilters || filters.singlePhotoOnly || filters.maxClusterSize !== null || filters.minDistance !== null
                                        ? 'bg-amber-600/30 text-amber-300 border border-amber-500/50'
                                        : 'bg-gray-700 text-gray-400 hover:text-white'
                                        }`}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                    Filters
                                </button>

                                <span className="text-gray-500 text-xs">
                                    {filteredCandidates.length !== allCandidates.length ? (
                                        <>Showing {displayedCount} of {filteredCandidates.length} filtered ({allCandidates.length} total)</>
                                    ) : (
                                        <>Showing {displayedCount} of {allCandidates.length}</>
                                    )}
                                </span>
                            </div>
                        </div>

                        {/* Filter Panel */}
                        {showFilters && (
                            <div className="flex-none p-3 bg-amber-900/10 border-b border-amber-500/30 flex items-center gap-6 text-sm animate-fade-in">
                                {/* Single Photo Only */}
                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <input
                                        type="checkbox"
                                        checked={filters.singlePhotoOnly}
                                        onChange={(e) => {
                                            setFilters(prev => ({ ...prev, singlePhotoOnly: e.target.checked }))
                                            setDisplayedCount(BATCH_SIZE)
                                            setSelectedIds(new Set())
                                        }}
                                        className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-amber-500 focus:ring-amber-500/50"
                                    />
                                    <span className="text-gray-300 group-hover:text-white transition-colors">Single Photo Only</span>
                                </label>

                                {/* Max Cluster Size */}
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-400">Max Cluster:</span>
                                    <select
                                        value={filters.maxClusterSize ?? ''}
                                        onChange={(e) => {
                                            const val = e.target.value ? parseInt(e.target.value) : null
                                            setFilters(prev => ({ ...prev, maxClusterSize: val }))
                                            setDisplayedCount(BATCH_SIZE)
                                            setSelectedIds(new Set())
                                        }}
                                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                                    >
                                        <option value="">Any</option>
                                        <option value="1">1 (Singletons)</option>
                                        <option value="2">≤ 2</option>
                                        <option value="3">≤ 3</option>
                                        <option value="5">≤ 5</option>
                                    </select>
                                </div>

                                {/* Min Distance */}
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-400">Min Distance:</span>
                                    <select
                                        value={filters.minDistance ?? ''}
                                        onChange={(e) => {
                                            const val = e.target.value ? parseFloat(e.target.value) : null
                                            setFilters(prev => ({ ...prev, minDistance: val }))
                                            setDisplayedCount(BATCH_SIZE)
                                            setSelectedIds(new Set())
                                        }}
                                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                                    >
                                        <option value="">Any</option>
                                        <option value="0.8">≥ 0.8</option>
                                        <option value="1.0">≥ 1.0</option>
                                        <option value="1.2">≥ 1.2</option>
                                        <option value="1.4">≥ 1.4</option>
                                    </select>
                                </div>

                                <div className="flex-1" />

                                {/* Clear Filters */}
                                {(filters.singlePhotoOnly || filters.maxClusterSize !== null || filters.minDistance !== null) && (
                                    <button
                                        onClick={() => {
                                            setFilters(DEFAULT_FILTERS)
                                            setDisplayedCount(BATCH_SIZE)
                                            setSelectedIds(new Set())
                                        }}
                                        className="text-xs text-gray-500 hover:text-amber-300 transition-colors"
                                    >
                                        Clear Filters
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Toolbar */}
                        <div className="flex-none p-3 bg-gray-800/20 border-b border-gray-800 flex items-center gap-4">
                            <div className="text-sm text-gray-400">
                                {selectedIds.size} selected
                            </div>
                            {displayedCandidates.length > 0 && (
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={selectAllLoaded}
                                        className="text-xs text-gray-500 hover:text-white"
                                    >
                                        Select All Loaded
                                    </button>
                                    <span className="text-gray-600">|</span>
                                    <button
                                        onClick={selectNone}
                                        className="text-xs text-gray-500 hover:text-white"
                                    >
                                        Select None
                                    </button>
                                </div>
                            )}
                            <div className="flex-1" />
                            {selectedIds.size > 0 && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setIsRenameModalOpen(true)}
                                        disabled={isNaming}
                                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-indigo-900/20 disabled:opacity-50 flex items-center gap-2"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                        </svg>
                                        Name ({selectedIds.size})
                                    </button>
                                    <button
                                        onClick={handleIgnoreSelected}
                                        disabled={isIgnoring}
                                        className="bg-red-700 hover:bg-red-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-all shadow-lg shadow-red-900/40 flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {isIgnoring ? (
                                            <>
                                                <div className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" />
                                                Ignoring...
                                            </>
                                        ) : (
                                            <>
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                                </svg>
                                                Ignore ({selectedIds.size})
                                            </>
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                            {loading ? (
                                <div className="flex flex-col items-center justify-center h-full gap-3">
                                    <div className="animate-spin h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full" />
                                    <span className="text-gray-400 text-sm">Analyzing faces...</span>
                                </div>
                            ) : allCandidates.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-2 opacity-50 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <p className="text-green-400 font-medium">No background faces detected!</p>
                                    <p className="text-sm mt-1">All your unnamed faces appear significant.</p>
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
                                        {displayedCandidates.map(candidate => (
                                            <NoiseCandidateItem
                                                key={candidate.faceId}
                                                candidate={candidate}
                                                selected={selectedIds.has(candidate.faceId)}
                                                onToggle={() => toggleSelection(candidate.faceId)}
                                                onViewPhoto={() => viewPhoto(candidate.photo_id)}
                                            />
                                        ))}
                                    </div>

                                    {/* Load More Button */}
                                    {displayedCount < filteredCandidates.length && (
                                        <div className="py-8 flex justify-center">
                                            <button
                                                onClick={loadMore}
                                                disabled={loadingMore}
                                                className="bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 px-6 py-2 rounded-full font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                            >
                                                {loadingMore ? (
                                                    <>
                                                        <div className="animate-spin h-4 w-4 border-2 border-amber-400 border-t-transparent rounded-full" />
                                                        Loading...
                                                    </>
                                                ) : (
                                                    `Load More (${filteredCandidates.length - displayedCount} remaining)`
                                                )}
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Footer Help */}
                        <div className="flex-none p-3 border-t border-gray-800 bg-gray-800/30 text-xs text-gray-500">
                            💡 Click a face to select/deselect. Hover and click photo icon to preview original image.
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            {/* Rename Modal */}
            <RenameModal
                isOpen={isRenameModalOpen}
                onClose={() => setIsRenameModalOpen(false)}
                onConfirm={handleNameSelected}
                initialValue=""
                count={selectedIds.size}
            />
        </>
    )
}

const NoiseCandidateItem = React.memo(function NoiseCandidateItem({ candidate, selected, onToggle, onViewPhoto }: {
    candidate: NoiseCandidate,
    selected: boolean,
    onToggle: () => void,
    onViewPhoto: () => void
}) {
    return (
        <div
            className={`aspect-square relative cursor-pointer rounded-lg overflow-hidden transition-all group ${selected
                ? 'ring-2 ring-red-500 ring-offset-1 ring-offset-gray-900'
                : 'hover:ring-2 hover:ring-gray-600'
                }`}
            onClick={onToggle}
            title={`Distance: ${candidate.nearestPersonDistance.toFixed(2)}${candidate.nearestPersonName ? ` (nearest: ${candidate.nearestPersonName})` : ''}`}
        >
            <FaceThumbnail
                src={`local-resource://${encodeURIComponent(candidate.file_path)}`}
                fallbackSrc={candidate.preview_cache_path ? `local-resource://${encodeURIComponent(candidate.preview_cache_path)}` : undefined}
                box={candidate.box}
                originalImageWidth={candidate.photo_width}
                useServerCrop={true}
                className={`w-full h-full object-cover transition-opacity ${selected ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}`}
            />

            {/* Distance Badge */}
            <div className="absolute top-0.5 right-0.5 bg-black/70 px-1 py-0.5 rounded text-[9px] font-mono z-10">
                <span className="text-amber-300">{candidate.nearestPersonDistance.toFixed(2)}</span>
            </div>

            {/* Preview Button (Hover) */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onViewPhoto();
                }}
                className="absolute bottom-1 right-1 bg-black/50 hover:bg-indigo-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all z-20 shadow-lg"
                title="View Original Photo"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                </svg>
            </button>

            {/* Selection Indicator */}
            {selected && (
                <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-400 drop-shadow-md" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                </div>
            )}

            {/* Nearest Person Label */}
            {candidate.nearestPersonName && (
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-1">
                    <div className="text-[8px] text-gray-300 truncate">
                        ≠ {candidate.nearestPersonName}
                    </div>
                </div>
            )}
        </div>
    )
});
