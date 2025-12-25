import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePeople } from '../context/PeopleContext'
import PersonCard from '../components/PersonCard'
import FaceGrid from '../components/FaceGrid'
import BlurryFacesModal from '../components/BlurryFacesModal'
import GroupNamingModal from '../components/GroupNamingModal'
import TargetedScanModal from '../components/TargetedScanModal'
import IgnoredFacesModal from '../components/IgnoredFacesModal'
import { useAI } from '../context/AIContext'
import { Face } from '../types'
import { useAlert } from '../context/AlertContext'

export default function People() {
    const navigate = useNavigate()
    const { people, faces, loadPeople, loadFaces, loading, autoNameFaces, ignoreFaces } = usePeople()
    const { onPhotoProcessed, addToQueue } = useAI()
    const { showAlert, showConfirm } = useAlert()
    const [activeTab, setActiveTab] = useState<'identified' | 'unnamed'>('identified')
    const [showBlurryModal, setShowBlurryModal] = useState(false)
    const [showIgnoredModal, setShowIgnoredModal] = useState(false)
    const [hasNewFaces, setHasNewFaces] = useState(false)
    const [isScanning, setIsScanning] = useState(false)
    const [isScanModalOpen, setIsScanModalOpen] = useState(false)

    // Clustering State
    const [clusters, setClusters] = useState<{ id: number; faces: any[] }[]>([])
    const [singles, setSingles] = useState<any[]>([])
    const [blurryFaces, setBlurryFaces] = useState<any[]>([])
    const [isClustering, setIsClustering] = useState(false)

    // Group Naming Modal
    const [namingGroup, setNamingGroup] = useState<{ faces: Face[], name: string } | null>(null)
    const [selectedSingles, setSelectedSingles] = useState<Set<number>>(new Set())
    const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set())

    // Toggle selection
    const toggleGroupSelection = (groupId: number) => {
        const next = new Set(selectedGroups)
        if (next.has(groupId)) next.delete(groupId)
        else next.add(groupId)
        setSelectedGroups(next)
    }

    const handleSelectAllGroups = () => {
        if (selectedGroups.size === clusters.length) {
            setSelectedGroups(new Set())
        } else {
            setSelectedGroups(new Set(clusters.map(c => c.id)))
        }
    }


    // Track previous faces to detect if we can just filter locally instead of re-clustering
    const prevFacesRef = useRef(faces);

    // Run clustering when faces are loaded
    useEffect(() => {
        if (activeTab === 'unnamed' && faces.length > 0) {

            // OPTIMIZATION: If faces are a SUBSET of previous faces (just removals), 
            // we can update local state without re-running heavy clustering.
            const prevFaces = prevFacesRef.current;
            const currentIds = new Set(faces.map(f => f.id));

            // Debug Logic
            const removedCount = prevFaces.length - faces.length;
            const allExistInPrev = faces.every(f => prevFaces.find((p: any) => p.id === f.id));
            const isSubset = faces.length < prevFaces.length && allExistInPrev;

            console.log(`[People] Face update check: Count=${faces.length}, Prev=${prevFaces.length}, Removed=${removedCount}, AllExistInPrev=${allExistInPrev}, IsSubset=${isSubset}`);

            if (isSubset) {
                console.log("[People] Faces removed. Updating clusters locally without re-running AI.");

                // 1. Filter Singles
                setSingles(prev => prev.filter(f => currentIds.has(f.id)));

                // 2. Filter Clusters
                setClusters(prev => {
                    const next = prev.map(c => ({
                        ...c,
                        faces: c.faces.filter(f => currentIds.has(f.id))
                    })).filter(c => c.faces.length > 0);
                    // console.log(`[People] Clusters updated locally. PrevGroups=${prev.length}, NextGroups=${next.length}`);
                    return next;
                });

                prevFacesRef.current = faces;
                return;
            }

            prevFacesRef.current = faces;

            // Debounce clustering to avoid CPU thrashing during heavy scans
            const timeout = setTimeout(() => {
                runClustering()
                setHasNewFaces(false)
            }, 500)
            return () => clearTimeout(timeout)
        } else {
            setClusters([])
            setSingles([])
            setSelectedGroups(new Set())
        }
    }, [faces, activeTab])


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
    // Auto-reload faces when new ones are detected (debounced)
    // DISABLED: User requested manual refresh only (2025-12-19)
    /*
    useEffect(() => {
        if (hasNewFaces && activeTab === 'unnamed') {
            const timeout = setTimeout(() => {
                loadFaces({ unnamed: true })
            }, 3000)
            return () => clearTimeout(timeout)
        }
    }, [hasNewFaces, activeTab])
    */

    // Server-side clustering
    const runClustering = async () => {
        if (isClustering) return
        setIsClustering(true)
        console.log("Fetching clustered faces from server...")

        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('ai:getClusteredFaces');

            if (res.error) {
                console.error("Clustering error:", res.error);
                return;
            }

            // res structure: { clusters: [{ faces: [] }], singles: [face, ...], blurry: [face, ...] }
            // Note: Update main.ts to return 'blurry' as well.



            if (res.clusters) {
                // Map ID-based groups to match state structure
                const formattedClusters = res.clusters.map((c: any, idx: number) => ({
                    id: idx,
                    faces: c.faces
                }));
                setClusters(formattedClusters);
            } else {
                setClusters([]);
            }

            setSingles(res.singles || []);
            setBlurryFaces(res.blurry || []);

        } catch (e) {
            console.error("Clustering failed", e)
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
        // If we were selecting groups, clear selection
        setSelectedGroups(new Set())
        setSelectedSingles(new Set())
    }

    useEffect(() => {
        loadPeople()
    }, [])

    useEffect(() => {
        if (activeTab === 'unnamed') {
            loadFaces({ unnamed: true })
        }
    }, [activeTab])

    const scrollContainerRef = useRef<HTMLDivElement>(null)

    // Robust restoration with multiple retries
    useLayoutEffect(() => {
        if (activeTab === 'identified' && people.length > 0) {
            const savedPosition = localStorage.getItem('peopleScrollPosition_v2') // Changed key to force fresh start

            if (savedPosition && scrollContainerRef.current) {
                const target = parseInt(savedPosition);

                const restore = () => {
                    if (scrollContainerRef.current) {
                        // Only restore if we are not already there (approx)
                        if (Math.abs(scrollContainerRef.current.scrollTop - target) > 5) {
                            scrollContainerRef.current.scrollTop = target;
                        }
                    }
                };

                // Immediate
                restore();

                // Frame 1
                requestAnimationFrame(() => {
                    restore();
                    // Frame 2
                    requestAnimationFrame(restore);
                });

                // Fail-safe timeouts for slow rendering
                setTimeout(restore, 50);
                setTimeout(restore, 150);
                setTimeout(restore, 300);
            }
        }
    }, [people.length, activeTab])

    const handlePersonClick = (personId: number) => {
        // Explicitly save scroll position before navigation
        if (scrollContainerRef.current) {
            const scrollPos = scrollContainerRef.current.scrollTop;
            localStorage.setItem('peopleScrollPosition_v2', scrollPos.toString())
        }
        navigate(`/people/${personId}`)
    }

    const [isAutoAssigning, setIsAutoAssigning] = useState(false);

    const handleAutoAssign = async () => {
        if (faces.length === 0) return;

        showConfirm({
            title: 'Auto-Identify All Faces',
            description: `This will cross-check ALL unassigned faces in your library against your identified people. This may take a while depending on the number of faces.`,
            confirmLabel: 'Run Auto-Identify All',
            onConfirm: async () => {
                console.log("[People] User confirmed Auto-Identify All. Starting...");
                setIsAutoAssigning(true);
                try {
                    // Pass empty array to trigger "Scan All" backend mode
                    console.log(`[People] Invoking db:autoAssignFaces for ALL unassigned faces...`);
                    // @ts-ignore
                    const res = await window.ipcRenderer.invoke('db:autoAssignFaces', { faceIds: [] });
                    console.log("[People] db:autoAssignFaces result:", res);

                    if (res.success) {
                        if (res.count > 0) {
                            setTimeout(() => {
                                showAlert({
                                    title: 'Auto-ID Complete',
                                    description: `Successfully assigned ${res.count} faces.`,
                                    variant: 'primary'
                                });
                            }, 100);
                            loadFaces({ unnamed: true });
                            loadPeople();
                        } else {
                            setTimeout(() => {
                                showAlert({
                                    title: 'No Matches',
                                    description: 'No confident matches found among visible faces.',
                                    variant: 'primary'
                                });
                            }, 100);
                        }
                    }
                } catch (e) {
                    console.error(e);
                    setTimeout(() => {
                        showAlert({ title: 'Error', description: 'Auto-Assign failed', variant: 'danger' });
                    }, 100);
                } finally {
                    setIsAutoAssigning(false);
                }
            }
        });
    }

    return (
        <div className="flex flex-col h-full bg-gray-950 text-white overflow-hidden">
            {/* Header / Tabs */}
            <div className="flex-none p-6 border-b border-gray-800 bg-gray-900/50 backdrop-blur-xl z-10">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                        People
                    </h1>

                    <div className="flex gap-2">
                        {activeTab === 'unnamed' && (
                            <>
                                <button
                                    onClick={handleAutoAssign}
                                    disabled={isAutoAssigning || faces.length === 0}
                                    className="bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
                                >
                                    {isAutoAssigning ? (
                                        <div className="animate-spin h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full" />
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                                        </svg>
                                    )}
                                    Auto-Identify
                                </button>
                                <button
                                    onClick={() => setShowBlurryModal(true)}
                                    className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-4 py-2 rounded-lg text-sm border border-gray-700 transition-colors flex items-center gap-2"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                    Cleanup Blurry
                                </button>
                                <button
                                    onClick={() => setShowIgnoredModal(true)}
                                    className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-4 py-2 rounded-lg text-sm border border-gray-700 transition-colors flex items-center gap-2"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                    View Ignored
                                </button>
                            </>
                        )}
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

                <div className="flex items-center justify-between gap-4">
                    <div className="flex space-x-1 bg-gray-800/50 p-1 rounded-lg w-fit overflow-x-auto no-scrollbar">
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
                                            loadFaces({ unnamed: true });
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

                    {activeTab === 'unnamed' && faces.length > 0 && (
                        <div className="flex gap-2 flex-wrap justify-end">
                            <button
                                onClick={handleSelectAllGroups}
                                className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                            >
                                {selectedGroups.size === clusters.length && clusters.length > 0 ? 'Deselect Groups' : 'Select All Groups'}
                            </button>
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
                                className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                            >
                                Ignore All Visible
                            </button>
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
                                className="bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 hover:text-white px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                            >
                                Clear All
                            </button>
                        </div>
                    )}
                </div>

            </div>

            {/* Bulk Actions for SINGLES */}
            {selectedSingles.size > 0 && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-gray-900 border border-gray-700 shadow-2xl rounded-full px-6 py-3 animate-in slide-in-from-bottom-5 fade-in duration-200">
                    <span className="text-sm font-medium text-white mr-2">{selectedSingles.size} faces selected</span>

                    <div className="h-4 w-px bg-gray-700 mx-2" />

                    <button
                        onClick={() => {
                            // Find the faces
                            // We need to search in 'singles' which is where these IDs come from
                            const selectedFaceObjects = singles.filter(f => selectedSingles.has(f.id));
                            // @ts-ignore
                            setNamingGroup({ faces: selectedFaceObjects, name: '' });
                        }}
                        className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                        Name Selected
                    </button>

                    <div className="h-4 w-px bg-gray-700 mx-2" />

                    <button
                        onClick={() => {
                            showConfirm({
                                title: 'Ignore Selected Faces',
                                description: `Are you sure you want to ignore ${selectedSingles.size} faces?`,
                                confirmLabel: 'Ignore All',
                                variant: 'danger',
                                onConfirm: async () => {
                                    await ignoreFaces(Array.from(selectedSingles));
                                    setSelectedSingles(new Set());
                                }
                            });
                        }}
                        className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
                    >
                        Ignore Selected
                    </button>

                    <div className="h-4 w-px bg-gray-700 mx-2" />

                    <button
                        onClick={() => setSelectedSingles(new Set())}
                        className="p-1 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
            )}

            {/* Bulk Actions Bar */}
            {selectedGroups.size > 0 && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-gray-900 border border-gray-700 shadow-2xl rounded-full px-6 py-3 animate-in slide-in-from-bottom-5 fade-in duration-200">
                    <span className="text-sm font-medium text-white mr-2">{selectedGroups.size} groups selected</span>

                    <div className="h-4 w-px bg-gray-700 mx-2" />

                    <button
                        onClick={() => {
                            const allFaces = clusters
                                .filter(c => selectedGroups.has(c.id))
                                .flatMap(c => c.faces);
                            setNamingGroup({ faces: allFaces, name: '' });
                        }}
                        className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                        Name All
                    </button>

                    <div className="h-4 w-px bg-gray-700 mx-2" />

                    <button
                        onClick={() => {
                            showConfirm({
                                title: 'Ignore Selected Groups',
                                description: `Are you sure you want to ignore ${selectedGroups.size} groups?`,
                                confirmLabel: 'Ignore All',
                                variant: 'danger',
                                onConfirm: async () => {
                                    const allFaceIds = clusters
                                        .filter(c => selectedGroups.has(c.id))
                                        .flatMap(c => c.faces.map(f => f.id));

                                    await ignoreFaces(allFaceIds);

                                    // Optimistic Update
                                    setClusters(prev => prev.filter(c => !selectedGroups.has(c.id)));
                                    setSelectedGroups(new Set());
                                }
                            });
                        }}
                        className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
                    >
                        Ignore All
                    </button>

                    <div className="h-4 w-px bg-gray-700 mx-2" />

                    <button
                        onClick={() => setSelectedGroups(new Set())}
                        className="p-1 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
            )}

            {/* Content */}
            <div
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto min-h-0"
            >
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
                                        onClick={() => handlePersonClick(person.id)}
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
                                {!hasNewFaces && !loading && faces.length === 0 && (
                                    <div className="flex flex-col items-center justify-center p-20 text-gray-500 border border-dashed border-gray-800 rounded-2xl">
                                        <span className="text-6xl mb-4">✨</span>
                                        <h3 className="text-xl font-medium mb-2">All faces organized!</h3>
                                        <p className="max-w-md text-center">
                                            Great job! There are no unnamed faces requiring attention right now.
                                        </p>
                                    </div>
                                )}
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
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex items-center">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedGroups.has(group.id)}
                                                                onChange={() => toggleGroupSelection(group.id)}
                                                                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-gray-900 cursor-pointer"
                                                            />
                                                        </div>
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

                                                                        // Manual Local Update (Optimistic)
                                                                        // Because these faces might not be in the global 'faces' context (limit 2000),
                                                                        // we must remove them from the view state manually.
                                                                        setClusters(prev => prev.filter(c => c.id !== group.id));
                                                                        // Also remove from selection if present
                                                                        if (selectedGroups.has(group.id)) {
                                                                            toggleGroupSelection(group.id);
                                                                        }
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
                                        <FaceGrid
                                            faces={singles.slice(0, 200)}
                                            selectedIds={selectedSingles}
                                            onToggleSelection={(id) => {
                                                setSelectedSingles(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(id)) next.delete(id);
                                                    else next.add(id);
                                                    return next;
                                                });
                                            }}
                                        />
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
                )
                }
            </div >

            <BlurryFacesModal
                open={showBlurryModal}
                onOpenChange={setShowBlurryModal}
                personId={null}
                onDeleteComplete={() => loadFaces({ unnamed: true })}
            />

            <IgnoredFacesModal isOpen={showIgnoredModal} onClose={() => {
                setShowIgnoredModal(false)
                if (activeTab === 'unnamed') loadFaces({ unnamed: true })
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

        </div >
    )
}
