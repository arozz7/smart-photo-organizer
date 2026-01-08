import { useState, useEffect, memo } from 'react'
import { Face } from '../types'
import FaceThumbnail from './FaceThumbnail'
import { useScan } from '../context/ScanContext'
import { usePeople } from '../context/PeopleContext'

interface ClusterRowProps {
    faceIds: number[]
    initialSuggestion?: { personId: number, personName: string, similarity: number }
    index: number
    selectedFaceIds: Set<number>
    toggleFace: (id: number) => void
    toggleGroup: (ids: number[]) => void
    fetchFacesByIds: (ids: number[]) => Promise<Face[]>
    onNameGroup: (ids: number[], name: string, confirm?: boolean) => Promise<void>
    onIgnoreGroup: (ids: number[]) => void
    onUngroup: (index: number) => void
    onOpenNaming: (ids: number[]) => void
}

const ClusterRow = memo(({
    faceIds,
    initialSuggestion,
    index,
    selectedFaceIds,
    toggleFace,
    toggleGroup,
    fetchFacesByIds,
    onNameGroup,
    onIgnoreGroup,
    onUngroup,
    onOpenNaming
}: ClusterRowProps) => {
    const [clusterFaces, setClusterFaces] = useState<Face[]>([])
    const [loaded, setLoaded] = useState(false)
    const [suggestion, setSuggestion] = useState<any>(null)
    const { viewPhoto } = useScan()
    const { matchBatch } = usePeople()

    useEffect(() => {
        let mounted = true;

        // Reset state when faceIds changes
        setLoaded(false)
        setClusterFaces([])
        setSuggestion(null)

        fetchFacesByIds(faceIds).then(res => {
            if (mounted) {
                setClusterFaces(res)
                setLoaded(true)
            }
        })
        return () => { mounted = false }
    }, [faceIds, fetchFacesByIds])

    // Get Suggestions
    const { people } = usePeople();

    useEffect(() => {
        if (!loaded || clusterFaces.length === 0) return;

        // 0. Use Backend Suggestion if available (Fastest)
        if (initialSuggestion) {
            setSuggestion(initialSuggestion);
            return;
        }

        // 1. Check for stored suggestions (Scan-Time Tiering)
        // We look for a consensus or majority suggestion in the cluster
        const suggestionCounts = new Map<number, number>();
        let maxCount = 0;
        let bestStoredId: number | null = null;

        for (const f of clusterFaces) {
            if (f.suggested_person_id) {
                const count = (suggestionCounts.get(f.suggested_person_id) || 0) + 1;
                suggestionCounts.set(f.suggested_person_id, count);
                if (count > maxCount) {
                    maxCount = count;
                    bestStoredId = f.suggested_person_id;
                }
            }
        }

        if (bestStoredId) {
            const person = people.find(p => p.id === bestStoredId);
            if (person) {
                // Determine similarity from match_distance of the faces
                // Use the best (lowest) distance found for this person
                const bestDist = Math.min(...clusterFaces
                    .filter(f => f.suggested_person_id === bestStoredId && f.match_distance !== undefined)
                    .map(f => f.match_distance || 1));

                setSuggestion({
                    personId: person.id,
                    personName: person.name,
                    similarity: 1 / (1 + bestDist)
                });
                return; // Skip expensive matchBatch if we have a stored suggestion
            }
        }

        // 2. Fallback to Real-time Matching (for old scans or unassigned)
        const sampleDescriptors = clusterFaces
            .slice(0, 5)
            .map(f => f.descriptor)
            .filter(d => d && d.length > 0);

        if (sampleDescriptors.length > 0) {
            matchBatch(sampleDescriptors).then(results => {
                const counts: any = {};
                results.forEach(r => {
                    if (r && r.personId) {
                        if (!counts[r.personId]) counts[r.personId] = { person: r, count: 0, maxSim: 0 };
                        counts[r.personId].count++;
                        counts[r.personId].maxSim = Math.max(counts[r.personId].maxSim, r.similarity);
                    }
                });
                const winners = Object.values(counts).sort((a: any, b: any) => b.count - a.count || b.maxSim - a.maxSim);
                const winner = winners[0] as any;
                if (winner && winner.maxSim > 0.6) {
                    setSuggestion(winner.person);
                }
            });
        }
    }, [loaded, clusterFaces, matchBatch, people]);

    // Memoize selection calculation to avoid recalc on every render if not needed
    // But since selectedFaceIds changes, this will run. The key is that React.memo on the COMPONENT 
    // prevents re-renders if props haven't changed.
    // However, selectedFaceIds IS changing every time we select something (it's a new Set).
    // So React.memo won't help unless we are careful.
    // Actually, passing the SET itself creates a new reference.
    // We should pass "isSelected" or similar if we want true isolation, but for a whole row that needs to check membership...
    // The trick is: If I select a face in Group A, Group B receives a new 'selectedFaceIds' Set.
    // So Group B re-renders.
    // To fix the "Reloading" issue (unmount/mount), just moving it out of the parent component is enough.
    // To fix the "Performance" issue (re-render), we might need more optimization, but extraction is step 1.

    // We will keep simple logic for now. Component extraction solves the "Reloading" (flicker/reset) issue.

    if (!loaded) return <div className="h-40 bg-gray-900/50 animate-pulse rounded-xl my-4"></div>
    if (clusterFaces.length === 0) return null;

    const isAllSelected = faceIds.every(id => selectedFaceIds.has(id))
    const isSomeSelected = faceIds.some(id => selectedFaceIds.has(id))
    const selectionCount = faceIds.filter(id => selectedFaceIds.has(id)).length

    return (
        <div className={`rounded-xl p-4 mb-4 border transition-colors ${selectionCount > 0 ? 'bg-indigo-900/20 border-indigo-500/30' : 'bg-gray-800/30 border-gray-700/30'
            }`}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                    <div className="flex items-center h-5">
                        <input
                            type="checkbox"
                            checked={isAllSelected}
                            ref={input => {
                                if (input) input.indeterminate = isSomeSelected && !isAllSelected
                            }}
                            onChange={() => toggleGroup(faceIds)}
                            className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                    </div>
                    <div className="bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full text-xs font-bold">
                        Group {index + 1}
                    </div>
                    {suggestion && (
                        <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 text-green-300 px-2 py-1 rounded text-xs animate-fade-in shadow-sm">
                            <span className="opacity-70">Suggested:</span>
                            <span className="font-bold underline cursor-help" title={`Match confidence: ${Math.round(suggestion.similarity * 100)}%`}>
                                {suggestion.personName}
                            </span>
                            <button
                                onClick={() => onNameGroup(faceIds, suggestion.personName, true)}
                                className="ml-1 bg-green-600 hover:bg-green-500 text-white rounded px-1.5 py-0.5 text-[10px] uppercase font-bold transition-colors"
                            >
                                Accept
                            </button>
                        </div>
                    )}
                    <span className="text-gray-400 text-sm">{clusterFaces.length} faces</span>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => onUngroup(index)}
                        className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700 px-3 py-1.5 rounded-md transition-colors"
                        title="Ungroup these faces (move back to singles)"
                    >
                        Ungroup
                    </button>
                    <button
                        onClick={() => onIgnoreGroup(faceIds)}
                        className="text-xs bg-red-900/30 hover:bg-red-900/50 text-red-300 border border-red-900/50 px-3 py-1.5 rounded-md transition-colors"
                    >
                        Ignore Group
                    </button>
                    <button
                        onClick={() => {
                            // Select group if not already, then open namer
                            if (!isAllSelected) toggleGroup(faceIds)
                            onOpenNaming(faceIds)
                        }}
                        className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1.5 rounded-md transition-colors"
                    >
                        Name Group
                    </button>
                </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-700">
                {clusterFaces.slice(0, 50).map(face => {
                    const isSelected = selectedFaceIds.has(face.id)
                    return (
                        <div
                            key={face.id}
                            onClick={() => toggleFace(face.id)}
                            className={`w-24 h-24 flex-none relative group cursor-pointer rounded-md overflow-hidden transition-all ${isSelected
                                ? 'ring-4 ring-indigo-500 ring-offset-2 ring-offset-gray-900 z-10'
                                : face.confidence_tier === 'high'
                                    ? 'ring-2 ring-green-500/80 hover:ring-green-500 z-0'
                                    : (face.confidence_tier === 'review' || suggestion)
                                        ? 'ring-2 ring-amber-500/80 hover:ring-amber-500 z-0'
                                        : 'hover:opacity-90'
                                }`}
                        >
                            <FaceThumbnail
                                src={`local-resource://${encodeURIComponent(face.file_path || '')}`}
                                fallbackSrc={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path || '')}`}
                                box={face.box}
                                originalImageWidth={face.width}
                                useServerCrop={true}
                                className="w-full h-full object-cover"
                            />
                            {isSelected && (
                                <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center">
                                    <div className="bg-indigo-500 rounded-full p-1">
                                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                </div>
                            )}

                            {/* View Original Button */}
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
                    )
                })}
                {clusterFaces.length > 50 && (
                    <div className="w-24 h-24 flex-none bg-gray-800 rounded-md flex items-center justify-center text-gray-500 text-xs">
                        +{clusterFaces.length - 50} more
                    </div>
                )}
            </div>
        </div>
    )
})

export default ClusterRow
