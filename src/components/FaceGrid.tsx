import { useState, useEffect } from 'react'
import { usePeople } from '../context/PeopleContext'
import FaceGridItem from './FaceGridItem'
import FaceThumbnail from './FaceThumbnail'

export default function FaceGrid({ faces }: { faces: any[] }) {
    const { assignPerson, autoNameFaces } = usePeople()
    const [selectedFace, setSelectedFace] = useState<number | null>(null)

    // Smart Naming State
    const [smartNaming, setSmartNaming] = useState<{ count: number, matchIds: number[], name: string } | null>(null)
    const [selectedMatchIds, setSelectedMatchIds] = useState<Set<number>>(new Set())

    // Filter faces to find the ones that match the IDs
    // Note: This relies on the matched faces being in the passed 'faces' prop.
    // If pagination is used, this might miss some, but for now it's a good start.
    const matchedFaces = smartNaming ? faces.filter(f => smartNaming.matchIds.includes(f.id)) : []

    useEffect(() => {
        if (smartNaming) {
            setSelectedMatchIds(new Set(smartNaming.matchIds))
        }
    }, [smartNaming])

    const handleNameSubmit = async (faceId: number, name: string) => {
        const result = await assignPerson(faceId, name)
        setSelectedFace(null)

        if (result && result.similarFound) {
            setSmartNaming({
                count: result.count,
                matchIds: result.matchIds,
                name: result.name
            })
        }
    }

    const confirmSmartNaming = async () => {
        if (smartNaming) {
            const idsToAssign = Array.from(selectedMatchIds)
            if (idsToAssign.length > 0) {
                await autoNameFaces(idsToAssign, smartNaming.name)
            }
            setSmartNaming(null)
        }
    }

    const toggleMatchSelection = (id: number) => {
        const next = new Set(selectedMatchIds)
        if (next.has(id)) {
            next.delete(id)
        } else {
            next.add(id)
        }
        setSelectedMatchIds(next)
    }

    return (
        <>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4 p-4">
                {faces.map(face => (
                    <FaceGridItem
                        key={face.id}
                        face={face}
                        isSelected={selectedFace === face.id}
                        onSelect={setSelectedFace}
                        onNameSubmit={handleNameSubmit}
                    />
                ))}
            </div>

            {/* Smart Naming Modal */}
            {smartNaming && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                    <div className="bg-gray-800 rounded-xl shadow-2xl max-w-4xl w-full flex flex-col max-h-[90vh] border border-gray-700">
                        <div className="p-6 border-b border-gray-700">
                            <h3 className="text-xl font-bold text-white mb-2">Similar Faces Found</h3>
                            <p className="text-gray-300">
                                We found <strong className="text-indigo-400">{smartNaming.count}</strong> other faces that look like <strong className="text-white">{smartNaming.name}</strong>.
                                <br />
                                Select the ones you want to confirm:
                            </p>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
                                {matchedFaces.map(face => (
                                    <div
                                        key={face.id}
                                        className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${selectedMatchIds.has(face.id) ? 'border-indigo-500 ring-2 ring-indigo-500/50' : 'border-gray-700 opacity-60'}`}
                                        onClick={() => toggleMatchSelection(face.id)}
                                    >
                                        <FaceThumbnail
                                            src={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path)}`}
                                            box={face.box}
                                            className="w-full h-full pointer-events-none"
                                        />
                                        <div className={`absolute top-2 right-2 w-5 h-5 rounded-full border border-white flex items-center justify-center transition-colors ${selectedMatchIds.has(face.id) ? 'bg-indigo-500' : 'bg-black/50'}`}>
                                            {selectedMatchIds.has(face.id) && (
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                </svg>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {matchedFaces.length < smartNaming.count && (
                                    <div className="col-span-full text-center text-gray-500 italic py-4">
                                        + {smartNaming.count - matchedFaces.length} more faces not currently visible in this list.
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="p-6 border-t border-gray-700 flex justify-end gap-3 bg-gray-900/50 rounded-b-xl">
                            <button
                                onClick={() => setSmartNaming(null)}
                                className="px-4 py-2 rounded bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmSmartNaming}
                                className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-500 font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={selectedMatchIds.size === 0}
                            >
                                Confirm {selectedMatchIds.size} Faces
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
// Import at top need to check

