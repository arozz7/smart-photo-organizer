import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePeople } from '../context/PeopleContext'
import PersonCard from '../components/PersonCard'
import FaceGrid from '../components/FaceGrid'
import BlurryFacesModal from '../components/BlurryFacesModal'
import GroupNamingModal from '../components/GroupNamingModal'
import { useAI } from '../context/AIContext'
import { useAlert } from '../context/AlertContext'

export default function People() {
    const navigate = useNavigate()
    const { people, faces, loadPeople, loadFaces, loading, autoNameFaces, ignoreFaces } = usePeople()
    const { clusterFaces } = useAI()
    const { showAlert, showConfirm } = useAlert()
    const [activeTab, setActiveTab] = useState<'identified' | 'unnamed'>('identified')
    const [showBlurryModal, setShowBlurryModal] = useState(false)
    const [hasNewFaces, setHasNewFaces] = useState(false)

    // Clustering State
    const [clusters, setClusters] = useState<{ id: number; faces: any[] }[]>([])
    const [singles, setSingles] = useState<any[]>([])
    const [blurryFaces, setBlurryFaces] = useState<any[]>([])
    const [isClustering, setIsClustering] = useState(false)

    // Group Naming Modal
    const [namingGroup, setNamingGroup] = useState<{ faces: any[], name: string } | null>(null)


    // Run clustering when faces are loaded
    useEffect(() => {
        if (activeTab === 'unnamed' && faces.length > 0) {
            // Debounce clustering to avoid CPU thrashing during heavy scans
            const timeout = setTimeout(() => {
                runClustering()
                setHasNewFaces(false)
            }, 500)
            return () => clearTimeout(timeout)
        } else {
            setClusters([])
            setSingles([])
        }
    }, [faces, activeTab])

    const { onPhotoProcessed } = useAI()

    useEffect(() => {
        // Refresh faces when AI finishing processing, if we are on unnamed tab
        const cleanup = onPhotoProcessed((_photoId) => {
            if (activeTab === 'unnamed') {
                setHasNewFaces(true)
                // We could auto-load, but let's be subtle or debounced
                // Triggering a reload after a short delay if multiple photos finish
            }
        })
        return cleanup
    }, [activeTab, onPhotoProcessed])

    // Auto-reload faces when new ones are detected (debounced)
    useEffect(() => {
        if (hasNewFaces && activeTab === 'unnamed') {
            const timeout = setTimeout(() => {
                loadFaces({ unnamed: true })
            }, 3000)
            return () => clearTimeout(timeout)
        }
    }, [hasNewFaces, activeTab])

    const runClustering = async () => {
        if (isClustering) return
        setIsClustering(true)
        console.log("Running clustering on", faces.length, "faces")

        try {
            // Filter out faces that shouldn't be clustered? No, backend handles descriptors.
            // We need to pass IDs, but better to pass nothing and let backend query the vectors 
            // OR pass specific IDs if we only want to cluster visible ones.
            // 1. Separate Blurry Faces First
            // Threshold: use user setting or default 25? Let's assume 25 for now to match modal default.
            // Ideally we get this from settings.
            const BLUR_THRESHOLD = 25;

            const cleanFaces = []
            const blurry = []

            for (const f of faces) {
                // @ts-ignore
                if ((f.blur_score || 0) < BLUR_THRESHOLD) {
                    blurry.push(f)
                } else {
                    cleanFaces.push(f)
                }
            }

            setBlurryFaces(blurry)

            if (cleanFaces.length === 0) {
                setClusters([])
                setSingles([])
                return
            }

            // Cluster only clean faces
            const faceIds = cleanFaces.map(f => f.id)
            const res = await clusterFaces(faceIds)

            if (res.success && res.clusters) {
                const clusterGroups: { id: number; faces: any[] }[] = []
                const clusteredIds = new Set<number>()

                res.clusters.forEach((clusterIds, idx) => {
                    // Filter faces that are in this cluster
                    const clusterFaces = faces.filter(f => clusterIds.includes(f.id))
                    if (clusterFaces.length > 0) {
                        clusterGroups.push({ id: idx, faces: clusterFaces })
                        clusterIds.forEach(id => clusteredIds.add(id))
                    }
                })

                // Identify singles
                const singleFaces = faces.filter(f => !clusteredIds.has(f.id))

                setClusters(clusterGroups)
                setSingles(singleFaces)
            } else {
                setSingles(cleanFaces)
            }
        } catch (e) {
            console.error("Clustering failed", e)
            setSingles(faces) // Fallback to all if fail
        } finally {
            setIsClustering(false)
        }
    }

    const handleNameGroupClick = (groupFaces: any[]) => {
        setNamingGroup({ faces: groupFaces, name: '' })
    }

    const handleConfirmName = async (selectedIds: number[], name: string) => {
        if (!name || selectedIds.length === 0) return
        await autoNameFaces(selectedIds, name)
        setNamingGroup(null)
        loadFaces({ unnamed: true })
    }

    useEffect(() => {
        loadPeople()
    }, [])

    useEffect(() => {
        if (activeTab === 'unnamed') {
            loadFaces({ unnamed: true })
        }
    }, [activeTab])

    return (
        <div className="flex flex-col h-full bg-gray-950 text-white overflow-hidden">
            {/* Header / Tabs */}
            <div className="flex-none p-6 border-b border-gray-800 bg-gray-900/50 backdrop-blur-xl z-10">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                        People
                    </h1>
                </div>

                <div className="flex space-x-1 bg-gray-800/50 p-1 rounded-lg w-fit">
                    <button
                        onClick={() => setActiveTab('identified')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'identified'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        Identified People <span className="ml-2 opacity-50 text-xs">({people.length})</span>
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setActiveTab('unnamed')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'unnamed'
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                : 'text-gray-400 hover:text-white hover:bg-white/5'
                                }`}
                        >
                            Unnamed Faces
                        </button>
                        {activeTab === 'unnamed' && (
                            <div className="flex items-center">
                                <button
                                    onClick={() => loadFaces({ unnamed: true })}
                                    className={`p-2 rounded-md transition-colors ${hasNewFaces ? 'text-indigo-400 animate-pulse' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
                                    title={hasNewFaces ? "New faces detected! Refreshing..." : "Refresh"}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v3.292a1 1 0 01-2 0V13.099a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                                    </svg>
                                </button>
                                {hasNewFaces && <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider ml-1">New</span>}
                            </div>
                        )}
                    </div>
                    {activeTab === 'unnamed' && faces.length > 0 && (
                        <button
                            onClick={() => {
                                showConfirm({
                                    title: 'Ignore All Faces',
                                    description: `Are you sure you want to ignore all ${faces.length} visible faces?`,
                                    confirmLabel: 'Ignore All',
                                    variant: 'danger',
                                    onConfirm: async () => {
                                        try {
                                            const faceIds = faces.map(f => f.id);
                                            await window.ipcRenderer.invoke('db:ignoreFaces', faceIds);
                                            loadFaces({ unnamed: true }); // Refresh
                                        } catch (e) {
                                            console.error(e);
                                            showAlert({
                                                title: 'Error',
                                                description: 'Failed to ignore faces',
                                                variant: 'danger'
                                            });
                                        }
                                    }
                                });
                            }}
                            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 text-sm rounded-md ml-4 transition-colors"
                        >
                            Ignore All Visible
                        </button>
                    )}
                    {activeTab === 'unnamed' && faces.length > 0 && (
                        <button
                            onClick={() => {
                                showConfirm({
                                    title: 'PERMANENT DELETE',
                                    description: `Are you sure you want to PERMANENTLY DELETE all ${faces.length} visible faces? They will reappear if you rescan.`,
                                    confirmLabel: 'Delete All',
                                    variant: 'danger',
                                    onConfirm: async () => {
                                        try {
                                            const faceIds = faces.map(f => f.id);
                                            // @ts-ignore
                                            await window.ipcRenderer.invoke('db:deleteFaces', faceIds);
                                            loadFaces({ unnamed: true }); // Refresh
                                        } catch (e) {
                                            console.error(e);
                                            showAlert({
                                                title: 'Error',
                                                description: 'Failed to delete faces',
                                                variant: 'danger'
                                            });
                                        }
                                    }
                                });
                            }}
                            className="bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 hover:text-white px-3 py-1 text-sm rounded-md ml-2 transition-colors"
                        >
                            Clear All
                        </button>
                    )}
                </div>

                {activeTab === 'unnamed' && (
                    <div className="absolute top-6 right-6 flex gap-2">
                        <button
                            onClick={() => setShowBlurryModal(true)}
                            className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg text-sm border border-gray-700 transition-colors"
                        >
                            Cleanup Blurry
                        </button>
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto min-h-0">
                {activeTab === 'identified' ? (
                    <div className="p-6">
                        {loading && people.length === 0 ? (
                            <div className="flex items-center justify-center h-full p-20">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
                            </div>
                        ) : people.length === 0 ? (
                            <div className="flex flex-col items-center justify-center p-20 text-gray-500 border border-dashed border-gray-800 rounded-2xl">
                                <span className="text-6xl mb-4">👥</span>
                                <h3 className="text-xl font-medium mb-2">No people identified yet</h3>
                                <p className="max-w-md text-center">
                                    Start by naming faces in the "Unnamed Faces" tab.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                                {people.map(person => (
                                    <PersonCard
                                        key={person.id}
                                        person={person}
                                        onClick={() => navigate(`/people/${person.id}`)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="h-full">
                        {loading && faces.length === 0 ? (
                            <div className="flex items-center justify-center h-full">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
                            </div>
                        ) : (

                            <div className="flex flex-col gap-8 pb-20">
                                {isClustering && (
                                    <div className="px-6 py-2 text-sm text-indigo-300 animate-pulse">
                                        Organizing faces...
                                    </div>
                                )}

                                {clusters.length > 0 && (
                                    <div className="space-y-8">
                                        {clusters.map(group => (
                                            <div key={group.id} className="relative bg-gray-900/30 border-y border-gray-800/50">
                                                <div className="sticky top-0 z-20 flex justify-between items-center px-6 py-3 bg-gray-900/90 backdrop-blur-md border-b border-gray-800">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium text-indigo-200">Group {group.id + 1}</span>
                                                        <span className="bg-gray-800 text-gray-400 text-xs px-2 py-0.5 rounded-full">{group.faces.length} faces</span>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={async () => {
                                                                showConfirm({
                                                                    title: 'Ignore Group',
                                                                    description: `Ignore all ${group.faces.length} faces in this group?`,
                                                                    confirmLabel: 'Ignore',
                                                                    variant: 'danger',
                                                                    onConfirm: async () => {
                                                                        const ids = group.faces.map(f => f.id);
                                                                        await ignoreFaces(ids);
                                                                    }
                                                                });
                                                            }}
                                                            className="text-xs bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white px-3 py-1.5 rounded transition-colors border border-gray-600 hover:border-red-500"
                                                        >
                                                            Ignore Group
                                                        </button>
                                                        <button
                                                            onClick={() => handleNameGroupClick(group.faces)}
                                                            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded transition-colors shadow-lg shadow-indigo-900/20"
                                                        >
                                                            Name Group
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="p-2">
                                                    <FaceGrid faces={group.faces} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {singles.length > 0 && (
                                    <div>
                                        <div className="sticky top-0 z-20 px-6 py-3 bg-gray-950/90 backdrop-blur-md border-y border-gray-800 text-sm font-medium text-gray-400 flex justify-between items-center">
                                            <span>
                                                {clusters.length > 0 ? 'Unsorted Faces' : 'Identified Faces'} ({singles.length > 200 ? 'Showing 200 of ' : ''}{singles.length})
                                                {singles.length > 200 && <span className="ml-2 text-xs text-indigo-400 font-normal opacity-80">(Complete groups above first)</span>}
                                            </span>
                                            <button
                                                onClick={async () => {
                                                    const toIgnore = singles.slice(0, 200);
                                                    showConfirm({
                                                        title: 'Ignore Visible',
                                                        description: `Ignore all ${toIgnore.length} currently visible unsorted faces?`,
                                                        confirmLabel: 'Ignore',
                                                        variant: 'danger',
                                                        onConfirm: async () => {
                                                            const ids = toIgnore.map(f => f.id);
                                                            await ignoreFaces(ids);
                                                        }
                                                    });
                                                }}
                                                className="text-xs bg-gray-800 hover:bg-red-900/50 text-gray-400 hover:text-red-200 px-3 py-1.5 rounded transition-colors border border-gray-700 hover:border-red-800"
                                            >
                                                Ignore Visible
                                            </button>
                                        </div>
                                        <FaceGrid faces={singles.slice(0, 200)} />
                                        {singles.length > 200 && (
                                            <div className="px-6 py-10 text-center text-gray-500 bg-gray-900/10 border-b border-gray-900">
                                                <p>+ {singles.length - 200} more unsorted faces hidden.</p>
                                                <p className="text-xs mt-2 italic text-gray-600">Group or name the faces above to see more unsorted ones.</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {blurryFaces.length > 0 && (
                                    <div className="opacity-70 grayscale-[0.3]">
                                        <div className="sticky top-0 z-20 px-6 py-3 bg-gray-950/90 backdrop-blur-md border-y border-gray-800 text-sm font-medium text-orange-400 flex justify-between items-center">
                                            <span>Low Quality / Blurry ({blurryFaces.length})</span>
                                            <button
                                                onClick={() => setShowBlurryModal(true)}
                                                className="text-xs underline hover:text-orange-300"
                                            >
                                                Manage
                                            </button>
                                        </div>
                                        <FaceGrid faces={blurryFaces} />
                                    </div>
                                )}

                            </div>
                        )}
                    </div>
                )}
            </div>

            <BlurryFacesModal
                open={showBlurryModal}
                onOpenChange={setShowBlurryModal}
                personId={null}
                onDeleteComplete={() => loadFaces({ unnamed: true })}
            />

            {
                namingGroup && (
                    <GroupNamingModal
                        open={!!namingGroup}
                        onOpenChange={(open) => {
                            if (!open) {
                                setNamingGroup(null);
                            }
                        }}
                        faces={namingGroup.faces}
                        onConfirm={handleConfirmName}
                        people={people}
                    />
                )
            }

        </div >
    )
}
