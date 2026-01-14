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
    isFocused?: boolean
    onFocus?: (index: number) => void
    onSuggestionFound?: (index: number, suggestion: any) => void
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
    onOpenNaming,
    isFocused,
    onFocus,
    onSuggestionFound
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
            onSuggestionFound?.(index, initialSuggestion);
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

                const suggestionData = {
                    personId: person.id,
                    personName: person.name,
                    similarity: 1 / (1 + bestDist)
                };
                setSuggestion(suggestionData);
                onSuggestionFound?.(index, suggestionData);
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
                    onSuggestionFound?.(index, winner.person);
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

    // Focus handling
    const handleFocus = () => {
        if (onFocus) onFocus(index);
    };

    return (
        <div
            className={`
                bg-gray-900/40 rounded-xl overflow-hidden border transition-all duration-200
                ${isFocused
                    ? 'border-indigo-500 ring-1 ring-indigo-500/50 shadow-lg shadow-indigo-500/10 scale-[1.002]'
                    : 'border-gray-800 hover:border-gray-700'
                }
            `}
            style={{ minHeight: '140px' }}
            onClick={handleFocus}
        >
            {/* Header */}
            <div className="flex items-start justify-between p-3 border-b border-gray-800/50 bg-gray-900/20">
                <div className="flex items-center gap-3">
                    {/* Select Checkbox */}
                    <div className="flex items-center h-5">
                        <input
                            type="checkbox"
                            checked={faceIds.every(id => selectedFaceIds.has(id))}
                            onChange={() => toggleGroup(faceIds)}
                            className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-gray-900 cursor-pointer"
                            onClick={(e) => e.stopPropagation()} // Prevent focus jump when just selecting
                        />
                    </div>

                    <div className="flex flex-col">
                        <span className="text-xs text-gray-500 font-medium">
                            {faceIds.length} faces
                        </span>
                        {/* Suggestion Badge */}
                        {suggestion && (
                            <div className="flex items-center gap-2 mt-1 animate-fade-in">
                                <span className="text-xs text-gray-400">Suggested:</span>
                                <span className="text-sm font-medium text-white">
                                    {suggestion.personName || suggestion.name || (suggestion.person && suggestion.person.name)}
                                </span>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const nameToUse = suggestion.personName || suggestion.name || (suggestion.person && suggestion.person.name);
                                        if (nameToUse) {
                                            onNameGroup(faceIds, nameToUse, true);
                                        }
                                    }}
                                    className="ml-2 px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider rounded transition-colors shadow-sm"
                                >
                                    Accept
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                    {suggestion ? (
                        <>
                            <ActionTooltip label="Accept (A)">
                                <button
                                    onClick={() => onNameGroup(faceIds, suggestion.personName || suggestion.person.name, true)}
                                    className="p-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10 rounded-lg transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                </button>
                            </ActionTooltip>

                            <ActionTooltip label="Ungroup / Reject">
                                <button
                                    onClick={() => onUngroup(index)}
                                    className="p-1.5 text-gray-400 hover:text-amber-400 hover:bg-amber-400/10 rounded-lg transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </ActionTooltip>
                        </>
                    ) : (
                        <ActionTooltip label="Name">
                            <button
                                onClick={() => onOpenNaming(faceIds)}
                                className="p-1.5 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-400/10 rounded-lg transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                            </button>
                        </ActionTooltip>
                    )}

                    <ActionTooltip label="Ignore">
                        <button
                            onClick={() => onIgnoreGroup(faceIds)}
                            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                        </button>
                    </ActionTooltip>
                </div>
            </div>

            {/* Faces Grid */}
            <div className="p-3 grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2">
                {loaded ? (
                    clusterFaces.map((face) => (
                        <div
                            key={face.id}
                            className={`aspect-square rounded-lg overflow-hidden border cursor-pointer relative group ${selectedFaceIds.has(face.id)
                                ? 'border-indigo-500 ring-2 ring-indigo-500/50'
                                : 'border-gray-800 hover:border-gray-600'
                                }`}
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleFace(face.id);
                            }}
                        >
                            <FaceThumbnail
                                src={`local-resource://${encodeURIComponent(face.file_path || '')}`}
                                fallbackSrc={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path || '')}`}
                                box={face.box}
                                originalImageWidth={face.width}
                                useServerCrop={true}
                                className="w-full h-full object-cover"
                            />

                            {selectedFaceIds.has(face.id) && (
                                <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center">
                                    <div className="bg-indigo-500 rounded-full p-0.5">
                                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                </div>
                            )}

                            {/* View Full Photo Button */}
                            <button
                                className="absolute bottom-1 right-1 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-indigo-600 z-20 shadow-lg"
                                title="View Original Photo"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    viewPhoto(face.photo_id);
                                }}
                            >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                            </button>
                        </div>
                    ))
                ) : (
                    // Skeletons
                    Array.from({ length: Math.min(faceIds.length, 12) }).map((_, i) => (
                        <div key={i} className="aspect-square rounded-lg bg-gray-800 animate-pulse" />
                    ))
                )}

                {faceIds.length > 20 && loaded && (
                    <div className="aspect-square rounded-lg bg-gray-800/50 flex items-center justify-center text-xs text-gray-500">
                        +{faceIds.length - clusterFaces.length}
                    </div>
                )}
            </div>
        </div>
    )
})

const ActionTooltip = ({ label, children }: { label: string, children: React.ReactNode }) => (
    <div className="group relative">
        {children}
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-gray-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 shadow-lg">
            {label}
        </div>
    </div>
)

export default ClusterRow
