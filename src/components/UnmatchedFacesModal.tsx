import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import FaceThumbnail from './FaceThumbnail'
import { usePeople } from '../context/PeopleContext'
import { useScan } from '../context/ScanContext'

interface UnmatchedFacesModalProps {
    isOpen: boolean
    onClose: () => void
    faceIds: number[]
    onName: (ids: number[]) => void
    onAutoName: (ids: number[], name: string, confirm?: boolean) => Promise<void>
    onIgnore: (ids: number[]) => void
}

export default function UnmatchedFacesModal({ isOpen, onClose, faceIds, onName, onAutoName, onIgnore }: UnmatchedFacesModalProps) {
    const { fetchFacesByIds, matchBatch } = usePeople()
    const { viewPhoto, viewingPhoto } = useScan()
    const [faces, setFaces] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    const [threshold, setThreshold] = useState(0.65)
    const [suggestion, setSuggestion] = useState<any>(null)
    const [actionLoading, setActionLoading] = useState(false)

    // Pagination
    const [displayedCount, setDisplayedCount] = useState(0)
    const BATCH_SIZE = 100 // Load manageable chunks

    useEffect(() => {
        if (isOpen) {
            if (faceIds.length > 0) {
                loadInitialBatch()
                setSelectedIds(new Set())
            } else {
                setFaces([])
                setDisplayedCount(0)
            }
        } else {
            setFaces([])
            setDisplayedCount(0)
            setSelectedIds(new Set())
        }
    }, [isOpen, faceIds])

    const loadInitialBatch = async () => {
        setLoading(true)
        try {
            const currentLimit = Math.max(BATCH_SIZE, displayedCount)
            const batchIds = faceIds.slice(0, currentLimit)
            const result = await fetchFacesByIds(batchIds)
            if (result.length > 0) {
                // console.log('[DEBUG] First unmatched face:', JSON.stringify(result[0], null, 2));
            }
            setFaces(result)
            setDisplayedCount(result.length)
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    const loadMore = async () => {
        if (displayedCount >= faceIds.length) return
        setLoading(true)
        try {
            const nextBatchIds = faceIds.slice(displayedCount, displayedCount + BATCH_SIZE)
            const result = await fetchFacesByIds(nextBatchIds)
            setFaces(prev => [...prev, ...result])
            setDisplayedCount(prev => prev + result.length)
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    const toggleSelection = (id: number) => {
        const next = new Set(selectedIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelectedIds(next)
    }

    // Update Suggestion on selection change
    useEffect(() => {
        if (selectedIds.size === 0) {
            setSuggestion(null);
            return;
        }

        const selectedFaces = faces.filter(f => selectedIds.has(f.id));

        // 1. Check for stored suggestions (Consensus)
        const storedCounts = new Map<number, number>();
        let maxStored = 0;
        let bestStoredId: number | null = null;

        for (const f of selectedFaces) {
            if (f.suggested_person_id) {
                const c = (storedCounts.get(f.suggested_person_id) || 0) + 1;
                storedCounts.set(f.suggested_person_id, c);
                if (c > maxStored) { maxStored = c; bestStoredId = f.suggested_person_id; }
            }
        }

        if (bestStoredId) {
            // We need to fetch person name. We don't have full people list here.
            // We can use matchBatch to valid/fetch or use a new fetchPerson helper.
            // OR, fallback to matchBatch if we really need the name.
            // But usually UnmatchedFacesModal has access to people via context?
            // It calls usePeople(). matchBatch returns name.
            // Let's rely on matchBatch for name resolution if needed, 
            // but strictly prioritize the ID that matches.
            // Actually, matchBatch is fast enough for 5 faces.
            // But to respect "Scan-Time Tiering", we should prefer the stored ID.
        }

        // For now, proceed with Real-time Match but log if it differs?
        // Actually, the user wants to SEE the stored result.
        // If I can't easily get the name of 'bestStoredId' without fetching, I'll stick to matchBatch
        // BUT matchBatch should return the same person if the vector is valid.

        const sample = selectedFaces.slice(0, 5).map(f => f.descriptor).filter(Boolean);

        if (sample.length > 0) {
            // Convert similarity (slider value) to L2 distance for backend
            // similarity = 1/(1+distance), so distance = 1/similarity - 1
            const distanceThreshold = (1 / threshold) - 1;
            matchBatch(sample, { threshold: distanceThreshold }).then(results => {
                const counts: any = {};
                results.forEach(r => {
                    if (r && r.personId) {
                        if (!counts[r.personId]) counts[r.personId] = { person: r, count: 0, maxSim: 0 };
                        counts[r.personId].count++;
                        counts[r.personId].maxSim = Math.max(counts[r.personId].maxSim, r.similarity);
                    }
                });

                // If we had a generic stored suggestion that isn't in results (odd), we might miss it.
                // But usually FAISS finds it.

                const winner = Object.values(counts).sort((a: any, b: any) => b.count - a.count || b.maxSim - a.maxSim)[0] as any;
                if (winner) setSuggestion(winner.person);
                else setSuggestion(null);
            });
        }
    }, [selectedIds, faces, matchBatch, threshold]);

    const handleAction = async (action: 'name' | 'ignore' | 'autoName') => {
        const ids = Array.from(selectedIds)
        if (ids.length === 0) return

        setActionLoading(true)
        try {
            if (action === 'name') onName(ids)
            if (action === 'autoName' && suggestion) await onAutoName(ids, suggestion.personName, true)
            if (action === 'ignore') await onIgnore(ids)

            // Clear selection on success for these actions
            if (action !== 'name') {
                setSelectedIds(new Set())
            }
        } catch (e) {
            console.error(e)
        } finally {
            setActionLoading(false)
        }
    }

    return (
        <Dialog.Root open={isOpen} onOpenChange={open => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 animate-fade-in" />
                <Dialog.Content
                    onEscapeKeyDown={(e) => {
                        if (viewingPhoto) {
                            e.preventDefault();
                        }
                    }}
                    onPointerDownOutside={(e) => {
                        if (viewingPhoto) {
                            e.preventDefault();
                        }
                    }}
                    onInteractOutside={(e) => {
                        if (viewingPhoto) {
                            e.preventDefault();
                        }
                    }}
                    className="fixed inset-4 md:inset-10 bg-gray-900 rounded-xl border border-gray-800 shadow-2xl z-50 flex flex-col overflow-hidden animate-scale-in"
                >

                    {/* Header */}
                    <div className="flex-none p-4 border-b border-gray-800 flex items-center justify-between text-white bg-gray-900/50 backdrop-blur">
                        <Dialog.Title className="text-xl font-semibold flex items-center gap-2">
                            <span className="text-2xl">👤</span>
                            Unmatched Faces
                            <span className="text-sm font-normal text-gray-400 ml-2">
                                ({faceIds.length} total)
                            </span>
                        </Dialog.Title>

                        <button
                            onClick={() => onClose()}
                            className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg text-sm transition-colors"
                        >
                            Close
                        </button>
                    </div>

                    {/* Toolbar */}
                    <div className="flex-none p-3 bg-gray-800/30 border-b border-gray-800 flex items-center gap-4">
                        <div className="text-sm text-gray-400">
                            {selectedIds.size} selected
                        </div>
                        <div className="flex-1" />

                        {/* Local Threshold Setting */}
                        <div className="flex items-center gap-3 px-3 py-1 bg-gray-900/50 rounded-lg border border-gray-700">
                            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Sensitivity</span>
                            <input
                                type="range"
                                min="0.4"
                                max="0.95"
                                step="0.05"
                                value={threshold}
                                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                                className="w-24 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                            />
                            <span className="text-xs font-mono text-indigo-400 w-8">{threshold.toFixed(2)}</span>
                        </div>

                        <button
                            onClick={() => {
                                // Select all LOADED faces
                                const allLoaded = new Set(faces.map(f => f.id));
                                if (selectedIds.size === allLoaded.size) setSelectedIds(new Set());
                                else setSelectedIds(allLoaded);
                            }}
                            className="px-3 py-1.5 text-sm font-medium text-indigo-300 bg-indigo-900/20 hover:bg-indigo-900/40 border border-indigo-500/30 rounded-lg transition-colors"
                        >
                            {selectedIds.size === faces.length ? 'Deselect All' : 'Select All Loaded'}
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        {loading && faces.length === 0 ? (
                            <div className="flex items-center justify-center h-full">
                                <div className="animate-spin h-8 w-8 border-4 border-indigo-500 border-t-transparent rounded-full" />
                            </div>
                        ) : faces.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-500">
                                <p>No unmatched faces to display.</p>
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
                                    {faces.map(face => (
                                        <div
                                            key={face.id}
                                            className={`aspect-square relative cursor-pointer rounded-lg overflow-hidden transition-all group 
                                                ${selectedIds.has(face.id)
                                                    ? 'ring-4 ring-indigo-500 ring-offset-2 ring-offset-gray-900'
                                                    : face.confidence_tier === 'review'
                                                        ? 'ring-2 ring-amber-500/80 hover:ring-amber-400'
                                                        : face.confidence_tier === 'high'
                                                            ? 'ring-2 ring-green-500/50 hover:ring-green-400'
                                                            : 'hover:ring-2 hover:ring-gray-600'
                                                }`}
                                            onClick={() => toggleSelection(face.id)}
                                        >
                                            <FaceThumbnail
                                                src={`local-resource://${encodeURIComponent(face.file_path || '')}`}
                                                fallbackSrc={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path || '')}`}
                                                box={face.box}
                                                originalImageWidth={face.width}
                                                useServerCrop={true}
                                                className={`w-full h-full object-cover transition-opacity ${selectedIds.has(face.id) ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}`}
                                            />
                                            {selectedIds.has(face.id) && (
                                                <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-indigo-300 drop-shadow-md" viewBox="0 0 20 20" fill="currentColor">
                                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                    </svg>
                                                </div>
                                            )}

                                            {/* Preview Button */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    viewPhoto(face.photo_id);
                                                }}
                                                className="absolute bottom-1 right-1 bg-black/50 hover:bg-indigo-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all z-20 shadow-lg"
                                                title="View Original Photo"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                                                </svg>
                                            </button>

                                        </div>
                                    ))}
                                </div>

                                {/* Load More Button */}
                                {displayedCount < faceIds.length && (
                                    <div className="py-8 flex justify-center">
                                        <button
                                            onClick={loadMore}
                                            disabled={loading}
                                            className="bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 px-6 py-2 rounded-full font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            {loading ? (
                                                <>
                                                    <div className="animate-spin h-4 w-4 border-2 border-indigo-400 border-t-transparent rounded-full" />
                                                    Loading...
                                                </>
                                            ) : (
                                                `Load More (${faceIds.length - displayedCount} remaining)`
                                            )}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Floating Selection Action Bar */}
                    {selectedIds.size > 0 && (
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-700 shadow-2xl rounded-full px-6 py-3 flex items-center gap-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
                            <div className="text-sm font-medium text-white border-r border-gray-700 pr-4">
                                {selectedIds.size} selected
                            </div>
                            <button
                                onClick={() => handleAction('name')}
                                disabled={actionLoading}
                                className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-2 disabled:opacity-50"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                                Name
                            </button>
                            {suggestion && (
                                <button
                                    onClick={() => handleAction('autoName')}
                                    disabled={actionLoading}
                                    className="text-sm font-medium text-green-400 hover:text-green-300 transition-colors flex items-center gap-2 disabled:opacity-50"
                                >
                                    {actionLoading ? (
                                        <div className="animate-spin h-4 w-4 border-2 border-green-400 border-t-transparent rounded-full" />
                                    ) : (
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                    Assign to {suggestion.personName}
                                    <span className="text-[10px] bg-green-900/50 px-1.5 py-0.5 rounded">{Math.round(suggestion.similarity * 100)}%</span>
                                </button>
                            )}
                            <button
                                onClick={() => handleAction('ignore')}
                                disabled={actionLoading}
                                className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors flex items-center gap-2 disabled:opacity-50"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                </svg>
                                Ignore
                            </button>
                            <div className="border-l border-gray-700 pl-4">
                                <button
                                    onClick={() => setSelectedIds(new Set())}
                                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
