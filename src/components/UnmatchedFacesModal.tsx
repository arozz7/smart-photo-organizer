import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import FaceThumbnail from './FaceThumbnail'
import { usePeople } from '../context/PeopleContext'

interface UnmatchedFacesModalProps {
    isOpen: boolean
    onClose: () => void
    faceIds: number[]
    onName: (ids: number[]) => void
    onAutoName: (ids: number[], name: string) => Promise<void>
    onIgnore: (ids: number[]) => void
}

export default function UnmatchedFacesModal({ isOpen, onClose, faceIds, onName, onAutoName, onIgnore }: UnmatchedFacesModalProps) {
    const { fetchFacesByIds, matchBatch } = usePeople()
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
        if (isOpen && faceIds.length > 0) {
            loadInitialBatch()
            setSelectedIds(new Set())
        } else {
            setFaces([])
        }
    }, [isOpen, faceIds])

    const loadInitialBatch = async () => {
        setLoading(true)
        try {
            const batchIds = faceIds.slice(0, BATCH_SIZE)
            const result = await fetchFacesByIds(batchIds)
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
        const sample = selectedFaces.slice(0, 5).map(f => f.descriptor).filter(Boolean);

        if (sample.length > 0) {
            matchBatch(sample, { threshold }).then(results => {
                const counts: any = {};
                results.forEach(r => {
                    if (r && r.personId) {
                        if (!counts[r.personId]) counts[r.personId] = { person: r, count: 0, maxSim: 0 };
                        counts[r.personId].count++;
                        counts[r.personId].maxSim = Math.max(counts[r.personId].maxSim, r.similarity);
                    }
                });
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
            if (action === 'autoName' && suggestion) await onAutoName(ids, suggestion.personName)
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
                <Dialog.Content className="fixed inset-4 md:inset-10 bg-gray-900 rounded-xl border border-gray-800 shadow-2xl z-50 flex flex-col overflow-hidden animate-scale-in">

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
                        {selectedIds.size > 0 && (
                            <div className="flex items-center gap-2 animate-fade-in">
                                <button
                                    onClick={() => handleAction('name')}
                                    disabled={actionLoading}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-indigo-900/20 disabled:opacity-50"
                                >
                                    Name Selected
                                </button>
                                {suggestion && (
                                    <button
                                        onClick={() => handleAction('autoName')}
                                        disabled={actionLoading}
                                        className="bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-green-900/20 flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {actionLoading && <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />}
                                        <span>Use Suggestion: <strong>{suggestion.personName}</strong></span>
                                        <span className="text-[10px] bg-black/20 px-1.5 py-0.5 rounded">{Math.round(suggestion.similarity * 100)}%</span>
                                    </button>
                                )}
                                <button
                                    onClick={() => handleAction('ignore')}
                                    disabled={actionLoading}
                                    className="bg-red-600 hover:bg-red-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-red-900/20 disabled:opacity-50"
                                >
                                    Ignore Selected
                                </button>
                            </div>
                        )}
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
                                            className={`aspect-square relative cursor-pointer rounded-lg overflow-hidden transition-all group ${selectedIds.has(face.id) ? 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-gray-900' : 'hover:ring-2 hover:ring-gray-600'}`}
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
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
