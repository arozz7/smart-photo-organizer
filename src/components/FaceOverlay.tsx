import { useState } from 'react'
import { usePeople } from '../context/PeopleContext'
import { useAlert } from '../context/AlertContext'
import { useScan } from '../context/ScanContext'
import { PersonNameInput } from './PersonNameInput'

interface FaceOverlayProps {
    photo: any
    faces: any[]
    showFaceBoxes: boolean
    setShowFaceBoxes: (b: boolean) => void
    showUnnamedFaces: boolean
    setShowUnnamedFaces: (b: boolean) => void
    namingFaceId: number | null
    setNamingFaceId: (id: number | null) => void
    nameFilter: string
    setNameFilter: (n: string) => void
    isScanning: boolean
    setIsScanning: (b: boolean) => void
    onFacesChanged: () => void
    onPersonClick: (personId: number) => void
}

export function FaceOverlay({
    photo, faces, showFaceBoxes, setShowFaceBoxes, showUnnamedFaces, setShowUnnamedFaces,
    namingFaceId, setNamingFaceId, nameFilter, setNameFilter,
    isScanning, setIsScanning, onFacesChanged, onPersonClick
}: FaceOverlayProps) {
    const { assignPerson } = usePeople()
    const { showConfirm } = useAlert()
    const { refreshPhoto } = useScan()

    const [reassigningGroup, setReassigningGroup] = useState<{ id: number; name: string; faceIds: number[] } | null>(null)
    const [reassignName, setReassignName] = useState('')

    const handleUnassign = (faceIds: number[]) => {
        showConfirm({
            title: 'Unassign Faces',
            description: `Remove the name association for ${faceIds.length} face(s)? They will become unnamed.`,
            confirmLabel: 'Unassign',
            onConfirm: async () => {
                try {
                    // @ts-ignore
                    await window.ipcRenderer.invoke('db:unassignFaces', faceIds)
                    onFacesChanged()
                } catch (e) { console.error(e) }
            }
        })
    }

    const handleIgnore = (faceIds: number[]) => {
        showConfirm({
            title: 'Ignore Faces',
            description: `Ignore ${faceIds.length} face(s)? They will no longer appear in scan results.`,
            confirmLabel: 'Ignore',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    // @ts-ignore
                    await window.ipcRenderer.invoke('db:ignoreFaces', faceIds)
                    onFacesChanged()
                } catch (e) { console.error(e) }
            }
        })
    }

    const handleReassign = async () => {
        if (!reassigningGroup || !reassignName.trim()) return
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:reassignFaces', {
                faceIds: reassigningGroup.faceIds,
                personName: reassignName.trim()
            })
            setReassigningGroup(null)
            setReassignName('')
            onFacesChanged()
        } catch (e) { console.error(e) }
    }

    // Build person groups from faces
    const groups: Record<number, { id: number; name: string; faceIds: number[] }> = {}
    faces.forEach(f => {
        if (f.person_id) {
            if (!groups[f.person_id]) groups[f.person_id] = { id: f.person_id, name: f.person_name, faceIds: [] }
            groups[f.person_id].faceIds.push(f.id)
        }
    })
    const faceGroups = Object.values(groups)

    return (
        <div className="space-y-2">
            {/* Header + toggles */}
            <div className="flex items-center justify-between">
                <h4 className="text-gray-500 text-xs font-bold uppercase tracking-wider">People</h4>
                <div className="flex gap-1">
                    <button
                        onClick={() => setShowFaceBoxes(!showFaceBoxes)}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${showFaceBoxes ? 'bg-indigo-900/30 text-indigo-300 border-indigo-500/30' : 'bg-gray-800 text-gray-400 border-gray-700'}`}
                        title={showFaceBoxes ? 'Hide all face boxes' : 'Show face boxes'}
                    >
                        {showFaceBoxes ? 'Boxes' : 'No Boxes'}
                    </button>
                    {showFaceBoxes && (
                        <button
                            onClick={() => setShowUnnamedFaces(!showUnnamedFaces)}
                            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${showUnnamedFaces ? 'bg-indigo-900/30 text-indigo-300 border-indigo-500/30' : 'bg-gray-800 text-gray-400 border-gray-700'}`}
                            title={showUnnamedFaces ? 'Hide unnamed face boxes' : 'Show all face boxes'}
                        >
                            {showUnnamedFaces ? 'Show All' : 'Named Only'}
                        </button>
                    )}
                </div>
            </div>

            {/* Face group list or empty */}
            {faces.length === 0 ? (
                <div className="flex items-center gap-2">
                    <p className="text-gray-500 text-sm italic">No people detected</p>
                    <button
                        onClick={async () => {
                            try {
                                setIsScanning(true)
                                // @ts-ignore
                                await window.ipcRenderer.invoke('ai:forceRescan', { photoId: photo.id, filePath: photo.file_path })
                                await refreshPhoto(photo.id)
                            } catch (e) { console.error(e) } finally { setIsScanning(false) }
                        }}
                        disabled={isScanning}
                        className={`px-2 py-1 ${isScanning ? 'bg-indigo-900/50 cursor-wait' : 'bg-indigo-900/30 hover:bg-indigo-900/50'} text-indigo-300 text-xs rounded border border-indigo-500/30 transition-colors flex items-center gap-2`}
                        title="Force deep scan for faces (Macro Mode)"
                    >
                        {isScanning ? (
                            <>
                                <svg className="animate-spin h-3 w-3 text-indigo-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Scanning...
                            </>
                        ) : 'Force Face Scan'}
                    </button>
                </div>
            ) : (
                <div className="flex flex-wrap gap-2">
                    <div className="flex flex-wrap gap-2 items-center">
                        {faceGroups.map((group) => {
                            const isEditing = reassigningGroup?.id === group.id
                            return (
                                <div key={group.id} className="relative group inline-flex items-center justify-center">
                                    {isEditing ? (
                                        <div className="flex items-center gap-1 bg-gray-800 p-1 rounded-full border border-indigo-500/50 relative z-navigation">
                                            <PersonNameInput
                                                autoFocus
                                                value={reassignName}
                                                onChange={setReassignName}
                                                onCommit={handleReassign}
                                                onSelect={(_id, name) => setReassignName(name)}
                                                className="min-w-[12rem]"
                                                placeholder="New name..."
                                                showSuggestions={false}
                                            />
                                            <button onClick={handleReassign} className="text-green-400 hover:text-green-300 p-1" title="Save">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            </button>
                                            <button onClick={() => setReassigningGroup(null)} className="text-red-400 hover:text-red-300 p-1" title="Cancel">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => onPersonClick(group.id)}
                                                className="px-2 py-1 bg-purple-900/50 text-purple-200 text-xs rounded-full border border-purple-700/50 hover:bg-purple-800/50 transition-colors flex items-center gap-1"
                                            >
                                                <span className="text-xs">👤</span> {group.name} {group.faceIds.length > 1 && <span className="opacity-50 text-[10px]">x{group.faceIds.length}</span>}
                                            </button>
                                            <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 pb-1 z-overlay">
                                                <div className="flex items-center gap-1 bg-gray-900 border border-gray-700 p-1.5 rounded-lg shadow-xl whitespace-nowrap relative">
                                                    <div className="absolute bottom-[-5px] left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 border-r border-b border-gray-700 rotate-45" />
                                                    <button onClick={() => { setReassigningGroup(group); setReassignName(group.name) }} className="p-1 text-gray-400 hover:text-indigo-400 transition-colors" title="Correct Name">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                        </svg>
                                                    </button>
                                                    <button onClick={() => handleUnassign(group.faceIds)} className="p-1 text-gray-400 hover:text-yellow-400 transition-colors" title="Unassign (Make Unnamed)">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                                        </svg>
                                                    </button>
                                                    <button onClick={() => handleIgnore(group.faceIds)} className="p-1 text-gray-400 hover:text-red-400 transition-colors" title="Ignore Face">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.046m4.596-1.596A9.964 9.964 0 0112 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )
                        })}

                        {/* Force scan for missed faces */}
                        <button
                            onClick={async () => {
                                try {
                                    setIsScanning(true)
                                    // @ts-ignore
                                    await window.ipcRenderer.invoke('ai:forceRescan', { photoId: photo.id, filePath: photo.file_path })
                                    await refreshPhoto(photo.id)
                                } catch (e) { console.error(e) } finally { setIsScanning(false) }
                            }}
                            disabled={isScanning}
                            className={`px-2 py-1 ${isScanning ? 'bg-gray-800 cursor-wait' : 'bg-gray-800 hover:bg-gray-700'} text-gray-400 text-xs rounded-full border border-gray-700 hover:text-gray-200 transition-colors flex items-center gap-1`}
                            title="Force deep scan for missed faces"
                        >
                            {isScanning ? (
                                <svg className="animate-spin h-3 w-3 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                            ) : <span className="text-xs">🔍</span>}
                        </button>
                    </div>
                </div>
            )}

            {/* Naming modal */}
            {namingFaceId && (
                <div className="fixed inset-0 bg-black/80 z-toast flex items-center justify-center" onClick={() => setNamingFaceId(null)}>
                    <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-96 border border-gray-700" onClick={e => e.stopPropagation()}>
                        <h3 className="text-white font-bold mb-4">Name this person</h3>
                        <div className="space-y-4">
                            <PersonNameInput
                                autoFocus
                                value={nameFilter}
                                onChange={setNameFilter}
                                onSelect={(_id, name) => {
                                    assignPerson(namingFaceId, name)
                                    setNamingFaceId(null)
                                    setTimeout(onFacesChanged, 500)
                                }}
                                onCommit={() => {
                                    if (nameFilter.trim()) {
                                        assignPerson(namingFaceId, nameFilter.trim())
                                        setNamingFaceId(null)
                                        setTimeout(onFacesChanged, 500)
                                    }
                                }}
                                descriptors={
                                    faces.find(f => f.id === namingFaceId)?.descriptor
                                        ? [faces.find(f => f.id === namingFaceId).descriptor]
                                        : undefined
                                }
                                placeholder="Search or enter name..."
                                className="w-full"
                            />
                            <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-700">
                                <button onClick={() => setNamingFaceId(null)} className="px-3 py-1 text-gray-400 hover:text-white">
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        if (nameFilter.trim()) {
                                            assignPerson(namingFaceId, nameFilter.trim())
                                            setNamingFaceId(null)
                                            setTimeout(onFacesChanged, 500)
                                        }
                                    }}
                                    disabled={!nameFilter.trim()}
                                    className="px-4 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
