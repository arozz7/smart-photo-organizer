import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePeople } from '../context/PeopleContext'
import PersonCard from '../components/PersonCard'
import ClusterList from '../components/ClusterList'
import BlurryFacesModal from '../components/BlurryFacesModal'
import GroupNamingModal from '../components/GroupNamingModal'
import TargetedScanModal from '../components/TargetedScanModal'
import IgnoredFacesModal from '../components/IgnoredFacesModal'
import UnmatchedFacesModal from '../components/UnmatchedFacesModal'
import ClusteringSettingsModal from '../components/ClusteringSettingsModal'
import { useAI } from '../context/AIContext'
import { useAlert } from '../context/AlertContext'
import { usePeopleCluster } from '../hooks/usePeopleCluster'

export default function People() {
    const navigate = useNavigate()
    const { people, loadPeople, fetchFacesByIds, loading } = usePeople()
    const { onPhotoProcessed, addToQueue, setThrottled } = useAI()
    const { showAlert } = useAlert()

    // Extracted Hook
    const {
        clusters, singles, totalFaces, isClustering, isAutoAssigning,
        selectedFaceIds, namingGroup, setNamingGroup,
        loadClusteredFaces, toggleFace, toggleGroup, clearSelection,
        handleAutoAssign, handleNameGroup, handleConfirmName, handleOpenNaming, handleIgnoreGroup,
        handleUngroup, handleIgnoreAllGroups
    } = usePeopleCluster()

    const [activeTab, setActiveTab] = useState<'identified' | 'unnamed'>('identified')
    const [showBlurryModal, setShowBlurryModal] = useState(false)
    const [showIgnoredModal, setShowIgnoredModal] = useState(false)
    const [showUnmatchedModal, setShowUnmatchedModal] = useState(false)
    const [hasNewFaces, setHasNewFaces] = useState(false)
    const [isScanning, setIsScanning] = useState(false)
    const [isScanModalOpen, setIsScanModalOpen] = useState(false)
    const [showGroupingModal, setShowGroupingModal] = useState(false)

    // Load initial batch when tab changes
    useEffect(() => {
        if (activeTab === 'unnamed') {
            loadClusteredFaces()
        }
    }, [activeTab, loadClusteredFaces])

    // Enable throttling while this complex view is active
    useEffect(() => {
        setThrottled(true);
        return () => setThrottled(false);
    }, [setThrottled]);

    useEffect(() => {
        const cleanup = onPhotoProcessed((_photoId) => {
            if (activeTab === 'unnamed') {
                setHasNewFaces(true)
            }
        })
        return cleanup
    }, [activeTab, onPhotoProcessed])

    useEffect(() => {
        loadPeople()
    }, [loadPeople])

    // Scroll Restoration
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        if (activeTab === 'identified' && people.length > 0) {
            const savedPosition = localStorage.getItem('peopleScrollPosition_v2')
            if (savedPosition && scrollContainerRef.current) {
                const target = parseInt(savedPosition);
                const restore = () => {
                    if (scrollContainerRef.current) {
                        if (Math.abs(scrollContainerRef.current.scrollTop - target) > 5) {
                            scrollContainerRef.current.scrollTop = target;
                        }
                    }
                };
                restore();
                requestAnimationFrame(() => {
                    restore();
                    requestAnimationFrame(restore);
                });
                setTimeout(restore, 50);
            }
        }
    }, [people.length, activeTab])

    const handlePersonClick = (personId: number) => {
        if (scrollContainerRef.current) {
            const scrollPos = scrollContainerRef.current.scrollTop;
            localStorage.setItem('peopleScrollPosition_v2', scrollPos.toString())
        }
        navigate(`/people/${personId}`)
    }

    return (
        <div className="flex flex-col h-full bg-gray-950 text-white overflow-hidden">
            {/* Header / Tabs */}
            <div className="flex-none p-6 border-b border-gray-800 bg-gray-900/50 backdrop-blur-xl z-10">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-8">
                        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                            People
                        </h1>

                        <div className="flex space-x-1 bg-gray-800/50 p-1 rounded-lg">
                            <button
                                onClick={() => setActiveTab('identified')}
                                className={`px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap ${activeTab === 'identified'
                                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                Identified People <span className="ml-2 opacity-50 text-xs">({people.length})</span>
                            </button>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setActiveTab('unnamed')}
                                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap ${activeTab === 'unnamed'
                                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                                        }`}
                                >
                                    Unnamed Faces
                                </button>
                                {activeTab === 'unnamed' && (
                                    <div className="flex items-center">
                                        <button
                                            onClick={() => {
                                                loadClusteredFaces();
                                                setHasNewFaces(false);
                                            }}
                                            className={`p-2 rounded-md transition-colors ${hasNewFaces ? 'text-indigo-400 animate-pulse' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
                                            title={hasNewFaces ? "New faces available (Click to refresh)" : "Refresh"}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v3.292a1 1 0 01-2 0V13.099a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                                            </svg>
                                        </button>
                                        {hasNewFaces && <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider ml-1">New</span>}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => setIsScanModalOpen(true)}
                            disabled={isScanning}
                            className="bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 font-medium"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            {isScanning ? 'Preparing...' : 'Scan for All Named People'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto min-h-0"
            >
                {activeTab === 'identified' && (
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
                                        onClick={() => handlePersonClick(person.id)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {activeTab === 'unnamed' && (
                    <div className="animate-fade-in space-y-8 p-6">
                        {/* Actions Toolbar */}
                        <div className="flex items-center justify-between bg-gray-800/30 p-4 rounded-xl border border-gray-800 backdrop-blur-sm">
                            <div className="flex items-center gap-4">
                                <div className="text-sm text-gray-400">
                                    Found <span className="text-white font-medium">{clusters.length}</span> suggested groups and <span className="text-white font-medium">{singles.length}</span> single faces.
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setShowGroupingModal(true)}
                                    className="px-3 py-1.5 text-sm bg-gray-800/50 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded-lg transition-colors flex items-center gap-2"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                                    </svg>
                                    Regroup
                                </button>
                                <button
                                    onClick={handleAutoAssign}
                                    disabled={isAutoAssigning || totalFaces === 0}
                                    className="px-3 py-1.5 text-sm bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg transition-colors flex items-center gap-2"
                                >
                                    {isAutoAssigning ? (
                                        <div className="animate-spin h-3 w-3 border-2 border-indigo-400 border-t-transparent rounded-full" />
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                                        </svg>
                                    )}
                                    Auto-Identify All
                                </button>
                                <button
                                    onClick={() => setShowBlurryModal(true)}
                                    className="px-3 py-1.5 text-sm bg-gray-800/50 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded-lg transition-colors flex items-center gap-2"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                    </svg>
                                    Cleanup Blurry
                                </button>
                                <button
                                    onClick={handleIgnoreAllGroups}
                                    className="px-3 py-1.5 text-sm bg-red-900/10 hover:bg-red-900/30 text-red-400 border border-red-900/30 rounded-lg transition-colors flex items-center gap-2"
                                    title="Ignore all currently suggested groups"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                    </svg>
                                    Ignore All Groups
                                </button>
                                <button
                                    onClick={() => setShowIgnoredModal(true)}
                                    className="px-3 py-1.5 text-sm bg-gray-800/50 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded-lg transition-colors flex items-center gap-2"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                    Ignored
                                </button>
                            </div>
                        </div>

                        {isClustering ? (
                            <div className="flex flex-col items-center justify-center p-20 text-gray-500">
                                <div className="animate-spin h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full mb-4"></div>
                                <p>Grouping faces...</p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* Clusters */}
                                {clusters.length > 0 && (
                                    <ClusterList
                                        clusters={clusters}
                                        selectedFaceIds={selectedFaceIds}
                                        toggleFace={toggleFace}
                                        toggleGroup={toggleGroup}
                                        fetchFacesByIds={fetchFacesByIds}
                                        handleNameGroup={handleNameGroup}
                                        handleIgnoreGroup={handleIgnoreGroup}
                                        handleUngroup={handleUngroup}
                                        handleOpenNaming={handleOpenNaming}
                                    />
                                )}

                                {singles.length > 0 && (
                                    <div className="mt-8 pt-8 border-t border-gray-800">
                                        <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                                            <span>Unmatched Faces</span>
                                            <span className="text-sm font-normal text-gray-500">({singles.length})</span>
                                        </h3>
                                        <div className="bg-gray-800/20 rounded-xl p-8 border border-gray-800 border-dashed text-center text-gray-500">
                                            <p className="mb-4">These faces don't strongly associate with any known clusters.</p>
                                            <button
                                                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-md text-sm text-gray-300 transition-colors"
                                                onClick={() => {
                                                    setShowUnmatchedModal(true)
                                                }}
                                            >
                                                View Unmatched Faces
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {clusters.length === 0 && singles.length === 0 && (
                                    <div className="text-center py-20 text-gray-500">
                                        <p className="text-lg">No unnamed faces found.</p>
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
                onDeleteComplete={() => loadClusteredFaces()}
            />

            <IgnoredFacesModal isOpen={showIgnoredModal} onClose={() => {
                setShowIgnoredModal(false)
                if (activeTab === 'unnamed') loadClusteredFaces()
            }} />

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

            <TargetedScanModal
                isOpen={isScanModalOpen}
                onClose={() => setIsScanModalOpen(false)}
                onStart={async (options) => {
                    setIsScanModalOpen(false);
                    setIsScanning(true);
                    try {
                        // @ts-ignore
                        const candidates = await window.ipcRenderer.invoke('db:getPhotosForTargetedScan', options);
                        if (candidates && candidates.length > 0) {
                            const photosToScan = candidates.map((p: any) => ({ ...p, scanMode: 'MACRO' }));
                            addToQueue(photosToScan);
                            showAlert({
                                title: 'Scan Started',
                                description: `${candidates.length} photos added to the AI queue.`
                            });
                        } else {
                            showAlert({
                                title: 'No Photos Found',
                                description: 'No photos match the selected criteria for a targeted scan.'
                            });
                        }
                    } catch (err) {
                        console.error(err);
                    } finally {
                        setIsScanning(false);
                    }
                }}
                onSuccess={loadPeople}
            />

            <UnmatchedFacesModal
                isOpen={showUnmatchedModal}
                onClose={() => setShowUnmatchedModal(false)}
                faceIds={singles}
                onName={handleOpenNaming}
                onAutoName={handleNameGroup}
                onIgnore={handleIgnoreGroup}
            />

            <ClusteringSettingsModal
                open={showGroupingModal}
                onOpenChange={setShowGroupingModal}
                onRecluster={loadClusteredFaces}
            />

            {/* Selection Floating Action Bar */}
            {selectedFaceIds.size > 0 && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-700 shadow-2xl rounded-full px-6 py-3 flex items-center gap-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
                    <div className="text-sm font-medium text-white border-r border-gray-700 pr-4">
                        {selectedFaceIds.size} selected
                    </div>
                    <button
                        onClick={() => handleOpenNaming(Array.from(selectedFaceIds))}
                        className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        Name
                    </button>
                    <button
                        onClick={() => handleIgnoreGroup(Array.from(selectedFaceIds))}
                        className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors flex items-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                        Ignore
                    </button>
                    <div className="border-l border-gray-700 pl-4">
                        <button
                            onClick={clearSelection}
                            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
