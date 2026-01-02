import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import FaceThumbnail from './FaceThumbnail'
import { usePeople } from '../context/PeopleContext'

interface IgnoredFacesModalProps {
    isOpen: boolean
    onClose: () => void
}

export default function IgnoredFacesModal({ isOpen, onClose }: IgnoredFacesModalProps) {
    const { loadFaces, matchBatch } = usePeople()
    const [faces, setFaces] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    const [suggestion, setSuggestion] = useState<any>(null)

    // Pagination
    const [threshold, setThreshold] = useState(0.4)
    const [page, setPage] = useState(0)
    const [totalCount, setTotalCount] = useState(0)
    const [loadingMore, setLoadingMore] = useState(false)
    const LIMIT = 2000

    // Grouping
    const [isGrouping, setIsGrouping] = useState(false)
    const [clusters, setClusters] = useState<{ id: string, faces: any[] }[]>([])
    const [singles, setSingles] = useState<any[]>([])
    const [clustering, setClustering] = useState(false)

    useEffect(() => {
        if (isOpen) {
            loadIgnoredFaces(0)
            setSelectedIds(new Set())
            setIsGrouping(false)
        }
    }, [isOpen])

    const loadIgnoredFaces = async (pageNum: number = 0) => {
        const isLoadMore = pageNum > 0
        if (isLoadMore) setLoadingMore(true)
        else setLoading(true)

        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:getIgnoredFaces', { page: pageNum, limit: LIMIT })

            // Backend returns { faces: [...], total: number }
            const newFaces = res.faces || []
            setTotalCount(res.total || 0)

            if (isLoadMore) {
                setFaces(prev => [...prev, ...newFaces])

                // If grouping was active, we should re-cluster everything
                // Ideally we'd do this automatically, but for now let's just turn it off to avoid confusion
                // or user can press Group Similar again
                if (isGrouping) {
                    setIsGrouping(false) // Reset grouping on new data for simplicity
                }
            } else {
                setFaces(newFaces || [])
            }

            setPage(pageNum)

        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
            setLoadingMore(false)
        }
    }

    const handleLoadMore = () => {
        loadIgnoredFaces(page + 1)
    }

    const handleClusterToggle = async () => {
        // ... (rest of logic same) ...
        if (!isGrouping) {
            // Turn ON grouping
            setIsGrouping(true)
            if (faces.length === 0) return

            setClustering(true)
            try {
                const faceIds = faces.map(f => f.id)
                // Use looser threshold for "Deleted/Ignored" faces as they might be bad angles
                // @ts-ignore
                const res = await window.ipcRenderer.invoke('ai:clusterFaces', {
                    faceIds,
                    eps: 0.75,
                    min_samples: 2
                })

                // Backend might not return 'success: true' for this specific command, just 'clusters'
                if (res.clusters) {
                    const idMap = new Map(faces.map(f => [f.id, f]))

                    const newClusters = res.clusters.map((clusterIds: number[], idx: number) => ({
                        id: `group-${idx}`,
                        faces: clusterIds.map(id => idMap.get(id)).filter(Boolean)
                    }))

                    // Identify singles (faces not in any cluster)
                    const clusteredIds = new Set(res.clusters.flat())
                    const newSingles = faces.filter(f => !clusteredIds.has(f.id))

                    setClusters(newClusters)
                    setSingles(newSingles)
                } else {
                    // No clusters found or unexpected response
                    console.warn("Clustering returned no clusters or invalid format:", res)
                    setClusters([])
                    setSingles(faces) // Show all as singles
                }
            } catch (e) {
                console.error("Clustering failed", e)
                setIsGrouping(false)
            } finally {
                setClustering(false)
            }
        } else {
            // Turn OFF
            setIsGrouping(false)
        }
    }

    const toggleSelection = (id: number) => {
        const next = new Set(selectedIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelectedIds(next)
    }

    // Toggle Suggestion on selection change
    useEffect(() => {
        if (selectedIds.size === 0) {
            setSuggestion(null);
            return;
        }

        const selectedFaces = faces.filter(f => selectedIds.has(f.id));
        const sample = selectedFaces.map(f => f.descriptor).filter(Boolean).slice(0, 10);

        console.log(`[IgnoredFaces] Selection changed. Selected: ${selectedIds.size}, Descriptors: ${sample.length}`);

        if (sample.length > 0) {
            matchBatch(sample, { threshold }).then(results => {
                console.log("[IgnoredFaces] matchBatch results:", results);
                const counts: any = {};
                results.forEach(r => {
                    if (r && r.personId) {
                        if (!counts[r.personId]) counts[r.personId] = { person: r, count: 0, maxSim: 0 };
                        counts[r.personId].count++;
                        counts[r.personId].maxSim = Math.max(counts[r.personId].maxSim, r.similarity);
                    }
                });

                const sorted = Object.values(counts).sort((a: any, b: any) => b.count - a.count || b.maxSim - a.maxSim) as any[];
                const winner = sorted[0];

                if (winner) {
                    console.log(`[IgnoredFaces] Best match: ${winner.person.personName} (Sim: ${winner.maxSim.toFixed(3)}, Count: ${winner.count})`);
                } else {
                    console.log("[IgnoredFaces] No matches found in library.");
                }

                if (winner && winner.maxSim >= threshold) {
                    setSuggestion(winner.person);
                } else {
                    setSuggestion(null);
                }
            }).catch(err => {
                console.error("[IgnoredFaces] matchBatch failed:", err);
            });
        }
    }, [selectedIds, faces, matchBatch, threshold]);

    const toggleGroupSelection = (facesInGroup: any[]) => {
        const ids = facesInGroup.map(f => f.id)
        const allSelected = ids.every(id => selectedIds.has(id))
        const next = new Set(selectedIds)

        if (allSelected) {
            ids.forEach(id => next.delete(id))
        } else {
            ids.forEach(id => next.add(id))
        }
        setSelectedIds(next)
    }

    const removeFacesFromState = (idsToRemove: number[]) => {
        const idSet = new Set(idsToRemove);

        // 1. Update flat list
        const remaining = faces.filter(f => !idSet.has(f.id));
        setFaces(remaining);
        setTotalCount(prev => Math.max(0, prev - idsToRemove.length));

        // 2. Clear selection
        setSelectedIds(prev => {
            const next = new Set(prev);
            idsToRemove.forEach(id => next.delete(id));
            return next;
        });

        // 3. Update grouped view if active
        if (isGrouping) {
            setClusters(prev => prev.map(c => ({
                ...c,
                faces: c.faces.filter(f => !idSet.has(f.id))
            })).filter(c => c.faces.length > 0));
            setSingles(prev => prev.filter(f => !idSet.has(f.id)));
        }
    };

    const handleRestore = async (targetPersonId?: number) => {
        const ids = Array.from(selectedIds)
        if (ids.length === 0) return

        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:restoreFaces', {
                faceIds: ids,
                personId: targetPersonId
            })

            removeFacesFromState(ids);

            // Trigger main app refresh to show restored faces in Library/Unnamed
            loadFaces({ unnamed: true })
        } catch (e) {
            console.error("Restore failed", e)
        }
    }

    return (
        <Dialog.Root open={isOpen} onOpenChange={open => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 animate-fade-in" />
                <Dialog.Content className="fixed inset-4 md:inset-10 bg-gray-900 rounded-xl border border-gray-800 shadow-2xl z-50 flex flex-col overflow-hidden animate-scale-in">

                    {/* Header */}
                    <Dialog.Description className="sr-only">
                        Modal for viewing and restoring ignored faces. You can group similar faces to restore them in bulk.
                    </Dialog.Description>
                    <div className="flex-none p-4 border-b border-gray-800 flex items-center justify-between text-white bg-gray-900/50 backdrop-blur">
                        <Dialog.Title className="text-xl font-semibold flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Ignored Faces
                            <span className="text-sm font-normal text-gray-400 ml-2">
                                ({faces.length} / {totalCount})
                            </span>
                        </Dialog.Title>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleClusterToggle}
                                disabled={clustering || faces.length === 0}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors flex items-center gap-2 ${isGrouping
                                    ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50'
                                    : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                                    } ${clustering ? 'opacity-70 cursor-wait' : ''}`}
                            >
                                {clustering ? (
                                    <>
                                        <div className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" />
                                        <span>Analyzing {faces.length} faces...</span>
                                    </>
                                ) : (
                                    <>
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                        </svg>
                                        <span>Group Similar</span>
                                    </>
                                )}
                            </button>

                            <button
                                onClick={() => onClose()}
                                className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg text-sm transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>

                    {/* Toolbar */}
                    <div className="flex-none p-3 bg-gray-800/30 border-b border-gray-800 flex items-center gap-4">
                        <div className="text-sm text-gray-400">
                            {selectedIds.size} selected
                        </div>
                        {selectedIds.size > 0 && (
                            <div className="flex flex-col gap-0.5 animate-fade-in">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleRestore()}
                                        className="bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-lg shadow-green-900/40"
                                    >
                                        Restore Selected
                                    </button>
                                    {suggestion && (
                                        <button
                                            onClick={async () => {
                                                const ids = Array.from(selectedIds);
                                                try {
                                                    // Use the updated backend handler that restores and assigns in one go
                                                    // @ts-ignore
                                                    await window.ipcRenderer.invoke('db:restoreFaces', {
                                                        faceIds: ids,
                                                        personId: suggestion.personId
                                                    });

                                                    removeFacesFromState(ids);
                                                    loadFaces({ unnamed: true });
                                                } catch (err) {
                                                    console.error("Smart restore failed:", err);
                                                }
                                            }}
                                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-lg shadow-indigo-900/40 flex items-center gap-2 group"
                                        >
                                            <span>Restore as <strong>{suggestion.personName}</strong></span>
                                            <span className="text-[10px] bg-black/30 px-1.5 py-0.5 rounded text-indigo-200">{Math.round(suggestion.similarity * 100)}%</span>
                                        </button>
                                    )}
                                </div>
                                {!suggestion && (
                                    <div className="text-[10px] text-gray-500 italic ml-1 mt-1">
                                        {faces.filter(f => selectedIds.has(f.id) && f.descriptor).length === 0
                                            ? "No face data found (needs scan)"
                                            : `No matches found at ${Math.round(threshold * 100)}% sensitivity.`}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex-1" />

                        <div className="flex items-center gap-3 px-3 py-1 bg-gray-900/50 rounded-lg border border-gray-700 mx-2">
                            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Sensitivity</span>
                            <input
                                type="range"
                                min="0.1"
                                max="0.95"
                                step="0.05"
                                value={threshold}
                                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                                className="w-20 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                            />
                            <span className="text-xs font-mono text-indigo-400 w-8">{threshold.toFixed(2)}</span>
                        </div>

                        <button
                            onClick={() => setSelectedIds(new Set(faces.map(f => f.id)))}
                            className="text-xs text-gray-500 hover:text-white"
                        >
                            Select All (Loaded)
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        {loading ? (
                            <div className="flex items-center justify-center h-full">
                                <div className="animate-spin h-8 w-8 border-4 border-indigo-500 border-t-transparent rounded-full" />
                            </div>
                        ) : faces.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-500">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                <p>No ignored faces found.</p>
                            </div>
                        ) : (
                            <>
                                {isGrouping ? (
                                    <div className="space-y-6">
                                        {clusters.map(cluster => (
                                            <div key={cluster.id} className="bg-gray-800/20 rounded-xl border border-gray-800 overflow-hidden">
                                                <div className="flex items-center justify-between px-4 py-3 bg-gray-900/40 border-b border-gray-800">
                                                    <div className="flex items-center gap-3">
                                                        <input
                                                            type="checkbox"
                                                            checked={cluster.faces.every(f => selectedIds.has(f.id))}
                                                            onChange={() => toggleGroupSelection(cluster.faces)}
                                                            className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-gray-900 cursor-pointer"
                                                        />
                                                        <span className="text-sm font-medium text-indigo-300">Group {cluster.id.replace('group-', '')}</span>
                                                        <span className="bg-gray-800 text-gray-400 text-xs px-2 py-0.5 rounded-full">{cluster.faces.length} faces</span>
                                                    </div>
                                                </div>
                                                <div className="p-4 grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
                                                    {cluster.faces.map(face => (
                                                        <IgnoredFaceItem
                                                            key={face.id}
                                                            face={face}
                                                            selected={selectedIds.has(face.id)}
                                                            onToggle={() => toggleSelection(face.id)}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        ))}

                                        {singles.length > 0 && (
                                            <div className="mt-8">
                                                <div className="px-4 py-3 bg-gray-800/30 rounded-t-xl border border-gray-800 border-b-0 flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-sm font-medium text-gray-400">Ungrouped Faces</span>
                                                        <span className="bg-gray-800 text-gray-500 text-xs px-2 py-0.5 rounded-full">{singles.length} faces</span>
                                                    </div>
                                                </div>
                                                <div className="border border-gray-800 rounded-b-xl bg-gray-900/20 p-4">
                                                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
                                                        {singles.map(face => (
                                                            <IgnoredFaceItem
                                                                key={face.id}
                                                                face={face}
                                                                selected={selectedIds.has(face.id)}
                                                                onToggle={() => toggleSelection(face.id)}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
                                        {faces.map(face => (
                                            <IgnoredFaceItem
                                                key={face.id}
                                                face={face}
                                                selected={selectedIds.has(face.id)}
                                                onToggle={() => toggleSelection(face.id)}
                                            />
                                        ))}
                                    </div>
                                )}

                                {/* Load More Button */}
                                {faces.length < totalCount && (
                                    <div className="py-8 flex justify-center">
                                        <button
                                            onClick={handleLoadMore}
                                            disabled={loadingMore}
                                            className="bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 px-6 py-2 rounded-full font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            {loadingMore ? (
                                                <>
                                                    <div className="animate-spin h-4 w-4 border-2 border-indigo-400 border-t-transparent rounded-full" />
                                                    Loading...
                                                </>
                                            ) : (
                                                `Load More (${totalCount - faces.length} remaining)`
                                            )}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}

function IgnoredFaceItem({ face, selected, onToggle }: { face: any, selected: boolean, onToggle: () => void }) {
    return (
        <div
            className={`aspect-square relative cursor-pointer rounded-lg overflow-hidden transition-all group ${selected ? 'ring-2 ring-green-500 ring-offset-1 ring-offset-gray-900' : 'hover:ring-2 hover:ring-gray-600'}`}
            onClick={onToggle}
        >
            <FaceThumbnail
                src={`local-resource://${encodeURIComponent(face.file_path)}`}
                fallbackSrc={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path)}`}
                box={face.box}
                originalImageWidth={face.width}
                useServerCrop={true}
                className={`w-full h-full object-cover transition-opacity ${selected ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}`}
            />
            {face.descriptor && (
                <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-green-500 rounded-full border border-gray-900 shadow-sm z-10" title="AI Data Ready" />
            )}
            {selected && (
                <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-400 drop-shadow-md" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                </div>
            )}
        </div>
    )
}
