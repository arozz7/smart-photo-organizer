import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PersonIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons'
import { EmptyState } from '../components/ui/EmptyState'
import { usePeopleGridSize } from '../hooks/usePeopleGridSize'
import { usePeople } from '../context/PeopleContext'
import { useAI } from '../context/AIContext'
import { useScan } from '../context/ScanContext'
import { usePeopleCluster } from '../hooks/usePeopleCluster'
import { useBuckets } from '../hooks/useBuckets'
// import { useMergedBuckets } from '../hooks/useMergedBuckets' // Removed Suggestions Tab
import { useDiscoveryMerge } from '../hooks/useDiscoveryMerge'
import { useIgnoredFaces } from '../hooks/useIgnoredFaces'
import { useBackgroundFaces } from '../hooks/useBackgroundFaces'
import { useFetchedFaces } from '../hooks/useFetchedFaces'
import EdgeCaseFilters, { EdgeCaseFilterType } from '../components/EdgeCaseFilters'
import PersonCard from '../components/PersonCard'
import ClusterList from '../components/ClusterList'
import { useAlert } from '../context/AlertContext'
import { useToast } from '../context/ToastContext'
// types removed
import GroupNamingModal from '../components/GroupNamingModal'
import { ClusterToolbar, ClusterToolbarButton } from '../components/ClusterToolbar'
import { useClusterController } from '../hooks/useClusterController'
import ClusteringSettingsModal from '../components/ClusteringSettingsModal'
import FaceDebugModal from '../components/FaceDebugModal'
import FaceThumbnail from '../components/FaceThumbnail'
import { Face, FaceBucket } from '../types'
import { FloatingActionBar, FloatingActionButton } from '../components/FloatingActionBar'

export default function People() {
    const navigate = useNavigate()
    const {
        people,
        loading,
        fetchFacesByIds,
        loadPeople,
        rebuildFaissIndex,
        isRebuildingIndex,
        faissStaleCount,
        unassignedCount,
        peopleScrollPosition,
        setPeopleScrollPosition
    } = usePeople()

    const { onPhotoProcessed } = useAI()
    const { showConfirm } = useAlert()
    const { addToast } = useToast()
    const { viewPhoto } = useScan()
    const gridSizes = usePeopleGridSize()

    // Existing hook for "Unnamed Faces" tab (Legacy + Controller internal)
    const {
        clusters,
        totalGroupCount,
        singles,
        totalUnassigned,
        isClustering,
        isAutoAssigning,
        loadClusteredFaces,
        // @ts-ignore
        ungroupableFaces,

        // Controller/Action Exports
        selectedFaceIds,
        namingGroup,
        setNamingGroup,
        toggleFace,
        toggleGroup,
        handleAutoAssign,
        handleNameGroup,
        handleIgnoreGroup,
        handleUngroup,
        handleConfirmName,
        handleOpenNaming,
        handleSuggestionFound,
        displayedGroupCount,
        hasMoreGroups,
        loadMoreGroups,
        resetDisplayedCount,
        remainingGroupCount,
        selectAll: selectAllGroups, // Aliased for legacy support
        clearSelection,
        // @ts-ignore - sizeFilter comes from controller spread
        sizeFilter,
        // @ts-ignore - setSizeFilter comes from controller spread
        setSizeFilter: onSizeFilterChange,
        // duplicate ungroupableFaces removed
        // @ts-ignore
        handleKeyDown,
        // @ts-ignore
        focusedClusterIndex,
        // @ts-ignore
        setFocusedClusterIndex
    } = usePeopleCluster()

    // @ts-ignore
    const [activeTab, setActiveTab] = useState<'identified' | 'unnamed' | 'discoveries'>('identified')

    // Buckets Hook (Suggestions & Discoveries)
    const {
        discoveryBuckets,
        // totalSuggestionCount, // Removed
        totalDiscoveryCount,
        loadingBuckets: areBucketsLoading,
        loadBuckets: refreshBuckets,
        // handleConfirmSuggestion, // Removed
        handleRejectSuggestion, // Restored
        handleNameBucket: namedBucketAction,
        handleIgnoreBucket,
        handleStartRecheck,
        recheckStatus
    } = useBuckets()


    // Discovery Merge State
    const [combineDiscoveries, setCombineDiscoveries] = useState(true);
    // @ts-ignore
    const { mergedBuckets: mergedDiscoveryBuckets, isMerging: isMergingDiscoveries } = useDiscoveryMerge(discoveryBuckets, {
        enabled: combineDiscoveries,
        maxMergedSize: 50
    });

    // --- Edge Case Filters ---
    const [activeEdgeFilter, setActiveEdgeFilter] = useState<EdgeCaseFilterType>('unnamed');
    const { faces: ignoredFaces, ...ignoredCtrl } = useIgnoredFaces({ enabled: activeEdgeFilter === 'ignored' });
    const { candidates: backgroundFaces, ...bgCtrl } = useBackgroundFaces({ enabled: activeEdgeFilter === 'background' });
    const { faces: ungroupableFetched, loadMore: loadMoreUngroupable } = useFetchedFaces({
        ids: ungroupableFaces,
        enabled: activeEdgeFilter === 'ungroupable'
    });
    // Note: usePeopleCluster returns ungroupableFaces (ids). We use useFetchedFaces for rendering them.
    // However, to supply them to useFetchedFaces, we need them from usePeopleCluster result.
    // But hooks order matters. usePeopleCluster is called below.
    // We'll move usePeopleCluster call UP or wrap the rest in a subsequent block.
    // Actually, usePeopleCluster is a hook, called unconditionally.
    // We can't access its result before it's called.
    // So we must move usePeopleCluster call up.
    // But usePeopleCluster depends on nothing local (except context).
    // So we can move usePeopleCluster call up.




    // --- Controllers for Buckets Tabs ---

    // Reset when toggling discovery merge mode
    useEffect(() => {
        discoveriesController.resetPagination();
        discoveriesController.clearSelection();
    }, [combineDiscoveries]);

    // 2. Discoveries Controller
    const discoveryClustersData = useMemo(() => {
        return mergedDiscoveryBuckets.map(b => {
            let suggestion = undefined;
            if (b.suggested_person_id) {
                const person = people.find(p => p.id === b.suggested_person_id);
                if (person) {
                    suggestion = { personId: person.id, name: person.name, confirmLabel: 'Confirm', confidence: 0.8 };
                }
            }
            return {
                faces: b.face_ids,
                data: b,
                suggestion // Pass suggestion to ClusterRow
            };
        });
    }, [mergedDiscoveryBuckets, people]);

    const discoveriesController = useClusterController({
        clusters: discoveryClustersData,
        pageSize: 50
    });

    // --- Tab Switching Cleanup ---
    // Reset pagination/selection when switching tabs
    useEffect(() => {
        if (activeTab === 'unnamed') resetDisplayedCount();

        if (activeTab === 'discoveries') {
            discoveriesController.resetPagination();
            discoveriesController.clearSelection();
        }
    }, [activeTab, resetDisplayedCount]);

    // --- Keyboard Handlers ---
    useEffect(() => {

        if (activeTab === 'discoveries') {
            const handleKey = (e: KeyboardEvent) => {
                discoveriesController.handleKeyDown(e, {
                    onAccept: (_index) => {
                        // Discoveries don't have a direct "Accept" action mapped to 'A' yet
                    },
                    onIgnore: (index) => {
                        const cluster = discoveriesController.displayedClusters[index];
                        if (cluster && cluster.data) {
                            handleIgnoreBucket(cluster.data);
                        }
                    },
                    onName: (index) => {
                        const cluster = discoveriesController.displayedClusters[index];
                        if (cluster) handleOpenNaming(cluster.faces);
                    }
                });
            };
            window.addEventListener('keydown', handleKey);
            return () => window.removeEventListener('keydown', handleKey);
        }
        // Unnamed tab keydown is handled by usePeopleCluster internally?
        // Wait, usePeopleCluster exposes controller but does NOT attach listeners.

    }, [activeTab, discoveriesController, discoveryClustersData])

    // --- Tab Switching Cleanup ---
    // Reset pagination/selection when switching tabs
    useEffect(() => {
        if (activeTab === 'unnamed') resetDisplayedCount();
        if (activeTab === 'discoveries') {
            discoveriesController.resetPagination();
            discoveriesController.clearSelection();
        }
    }, [activeTab]);

    // --- Keyboard Handling (Suggestions) ---
    useEffect(() => {
        if (activeTab === 'discoveries') {
            const handleKey = (e: KeyboardEvent) => {
                discoveriesController.handleKeyDown(e, {
                    onAccept: (index) => {
                        const cluster = discoveriesController.displayedClusters[index];
                        // Check if cluster has a suggestion (attached in useMemo above)
                        if (cluster && (cluster as any).suggestion) {
                            const suggestionName = (cluster as any).suggestion.name;
                            if (cluster.data && suggestionName) {
                                handleNameBucket(cluster.data, suggestionName);
                            }
                        }
                    },
                    onIgnore: (index) => {
                        const cluster = discoveriesController.displayedClusters[index];
                        if (cluster && cluster.data) {
                            handleIgnoreBucket(cluster.data);
                        }
                    },
                    onName: (index) => {
                        const cluster = discoveriesController.displayedClusters[index];
                        if (cluster && cluster.data) {
                            // Important: Set pending bucket so specific bucket logic is used (e.g. marking as discovery)
                            setPendingBucketNaming({ buckets: [cluster.data], type: 'discovery' });
                            handleOpenNaming(cluster.faces);
                        }
                    }
                });
            };
            window.addEventListener('keydown', handleKey);
            return () => window.removeEventListener('keydown', handleKey);
        }
    }, [activeTab, discoveriesController]);

    // Effect for Unnamed Tab Keydown
    useEffect(() => {
        if (activeTab !== 'unnamed') return;

        // @ts-ignore
        const handler = (e: KeyboardEvent) => handleKeyDown(e, {
            onAccept: (index) => {
                const cluster = clusters[index];
                if (cluster && (cluster as any).suggestion) {
                    const suggestion = (cluster as any).suggestion;
                    const name = suggestion.personName || suggestion.name || (suggestion.person && suggestion.person.name);
                    if (name) handleConfirmName(cluster.faces, name);
                } else if (cluster) {
                    handleOpenNaming(cluster.faces);
                }
            },
            onName: (index) => {
                const cluster = clusters[index];
                if (cluster) handleOpenNaming(cluster.faces);
            },
            onIgnore: (index) => {
                const cluster = clusters[index];
                if (cluster) handleIgnoreGroup(cluster.faces);
            }
        });

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [activeTab, clusters, handleOpenNaming, handleIgnoreGroup, handleConfirmName]);

    // --- Bulk Action Handlers (Discoveries) ---
    const handleBulkIgnoreDiscoveries = async () => {
        const selectedIds = discoveriesController.selectedFaceIds;
        if (selectedIds.size === 0) return;

        const affectedBuckets = discoveryBuckets.filter(b =>
            b.face_ids.some(id => selectedIds.has(id))
        );

        showConfirm({
            title: 'Ignore Selected Groups',
            description: `Ignore ${affectedBuckets.length} groups?`,
            confirmLabel: 'Ignore',
            variant: 'danger',
            onConfirm: async () => {
                for (const bucket of affectedBuckets) {
                    await handleIgnoreBucket(bucket, { skipConfirmation: true, suppressToast: true });
                }
                discoveriesController.clearSelection();
                addToast({ type: 'success', description: `Ignored ${affectedBuckets.length} groups` });
            }
        });
    };

    const handleNameBucket = async (bucket: FaceBucket, name: string) => {
        await namedBucketAction(bucket, name);
    };

    const handleBulkNameDiscoveries = () => {
        const selectedIds = discoveriesController.selectedFaceIds;
        if (selectedIds.size === 0) return;

        // Find all buckets that contain at least one selected face
        const affectedBuckets = discoveryBuckets.filter(b =>
            b.face_ids.some(id => selectedIds.has(id))
        );

        // If buckets are affected, set pendingBucketNaming so modal knows which buckets to update
        if (affectedBuckets.length > 0) {
            setPendingBucketNaming({ buckets: affectedBuckets, type: 'discovery' });
            handleOpenNaming(Array.from(selectedIds));
        }
    };


    // --- Other Hooks & State ---
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    const [hasNewFaces, setHasNewFaces] = useState(false)

    // Ignored Recheck Status
    const [showGroupingModal, setShowGroupingModal] = useState(false)


    // Pending bucket naming state (supports multiple buckets for bulk actions)
    const [pendingBucketNaming, setPendingBucketNaming] = useState<{ buckets: any[], type: 'suggestion' | 'discovery' } | null>(null);
    const [pendingBackgroundNaming, setPendingBackgroundNaming] = useState<boolean>(false);
    const [pendingUngroupableNaming, setPendingUngroupableNaming] = useState<boolean>(false);
    const [selectedUngroupableIds, setSelectedUngroupableIds] = useState<Set<number>>(new Set());
    const [selectedFaceForDebug, setSelectedFaceForDebug] = useState<number | null>(null)

    // Single faces batch loading
    const [visibleSingleFaces, setVisibleSingleFaces] = useState<Face[]>([])

    useEffect(() => {
        if (activeTab === 'unnamed' && singles.length > 0) {
            const idsToLoad = singles.slice(0, 100)
            // Avoid reloading if we already have the right faces? 
            // Naive check: if first ID matches. Better: assume fetch is cheap enough or check length.
            // Actually singles array reference changes on update.
            fetchFacesByIds(idsToLoad).then(faces => setVisibleSingleFaces(faces))
        } else {
            setVisibleSingleFaces([])
        }
    }, [activeTab, singles, fetchFacesByIds])
    useEffect(() => {
        refreshBuckets()
    }, [refreshBuckets])

    // Reload full bucket data when switching to bucket tabs
    // Reload full bucket data when switching to bucket tabs
    useEffect(() => {
        if (activeTab === 'discoveries') {
            refreshBuckets()
        }
    }, [activeTab, refreshBuckets])

    useEffect(() => {
        if (activeTab === 'identified') {
            loadPeople()
        }
    }, [activeTab, loadPeople])

    useEffect(() => {
        const unsubscribe = onPhotoProcessed(() => {
            if (activeTab === 'unnamed' && !isClustering) {
                setHasNewFaces(true)
            }
        })
        return unsubscribe
    }, [onPhotoProcessed, activeTab, isClustering])

    // Load Clusters on Unnamed Tab mount
    useEffect(() => {
        if (activeTab === 'unnamed') {
            loadClusteredFaces()
        }
    }, [activeTab, loadClusteredFaces])

    const handlePersonClick = (personId: string) => {
        if (scrollContainerRef.current) {
            setPeopleScrollPosition(scrollContainerRef.current.scrollTop)
        }
        navigate(`/person/${personId}`)
    }




    // Restore Scroll Position
    useLayoutEffect(() => {
        if (activeTab === 'identified' && people.length > 0 && scrollContainerRef.current) {
            if (peopleScrollPosition > 0) {
                scrollContainerRef.current.scrollTop = peopleScrollPosition
            }
        }
    }, [activeTab, people.length, peopleScrollPosition])

    const handleRebuildIndex = async () => {
        const res = await rebuildFaissIndex();
        if (res && res.success) {
            addToast({ type: 'success', description: 'Face index rebuilt successfully' });
        } else {
            addToast({ type: 'error', description: 'Failed to rebuild index' });
        }
    }

    const handleOpenBackgroundNaming = () => {
        if (bgCtrl.selectedIds.size === 0) return;

        // Convert candidates to minimal Face objects for the modal preview
        const selectedCandidates = backgroundFaces.filter(c => bgCtrl.selectedIds.has(c.faceId));
        const facesForModal: Face[] = selectedCandidates.map(c => ({
            id: c.faceId,
            box: c.box,
            file_path: c.file_path,
            photo_id: c.photo_id,
            preview_cache_path: c.preview_cache_path || undefined,
            width: c.photo_width,
            height: c.photo_height,
            person_id: null
        }));

        setPendingBackgroundNaming(true);
        setNamingGroup({ faces: facesForModal, name: '' });
    }

    // --- Ungroupable Actions ---
    const toggleUngroupableSelection = (id: number) => {
        const next = new Set(selectedUngroupableIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedUngroupableIds(next);
    }

    const selectAllLoadedUngroupable = () => {
        const next = new Set(ungroupableFetched.map(f => f.id));
        setSelectedUngroupableIds(next);
    }

    const clearUngroupableSelection = () => {
        setSelectedUngroupableIds(new Set());
    }

    const handleOpenUngroupableNaming = () => {
        if (selectedUngroupableIds.size === 0) return;
        const faces = ungroupableFetched.filter(f => selectedUngroupableIds.has(f.id));
        setPendingUngroupableNaming(true);
        setNamingGroup({ faces, name: '' });
    }

    const handleIgnoreUngroupable = async () => {
        if (selectedUngroupableIds.size === 0) return;
        await handleIgnoreGroup(Array.from(selectedUngroupableIds));
        clearUngroupableSelection();
    }

    return (
        <div className="flex flex-col h-full bg-gray-950 text-white overflow-hidden">
            {/* Header / Tabs */}
            <div className="flex-none px-4 py-3 border-b border-gray-800 bg-gray-900/50 backdrop-blur-xl z-10">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                            People
                        </h1>

                        <div className="flex space-x-1 bg-gray-800/50 p-1 rounded-lg">
                            <button
                                onClick={() => setActiveTab('identified')}
                                className={`px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap flex items-center ${activeTab === 'identified'
                                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                Identified People
                                <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeTab === 'identified' ? 'bg-indigo-500/20 text-indigo-200' : 'bg-gray-700 text-gray-300'
                                    }`}>
                                    {people.length}
                                </span>
                            </button>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setActiveTab('unnamed')}
                                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap flex items-center ${activeTab === 'unnamed'
                                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                                        }`}
                                >
                                    Edge Cases
                                    <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeTab === 'unnamed' ? 'bg-indigo-500/20 text-indigo-200' : 'bg-gray-700 text-gray-300'
                                        }`}>
                                        {unassignedCount}
                                    </span>
                                </button>
                                <button
                                    onClick={() => setActiveTab('discoveries')}
                                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap flex items-center ${activeTab === 'discoveries'
                                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                                        }`}
                                >
                                    Discoveries
                                    <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeTab === 'discoveries' ? 'bg-indigo-500/20 text-indigo-200' : 'bg-gray-700 text-gray-300'
                                        }`}>
                                        {totalDiscoveryCount}
                                    </span>
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
                            onClick={handleStartRecheck}
                            disabled={recheckStatus.active}
                            className={`px-3 py-2 rounded-lg transition-colors flex items-center gap-2 border ${recheckStatus.active
                                ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/30'
                                : 'bg-gray-800/50 hover:bg-gray-700 text-gray-400 border-gray-700'
                                }`}
                            title={recheckStatus.active ? "Re-check in progress..." : "Re-check Ignored Faces"}
                        >
                            {recheckStatus.active ? (
                                <>
                                    <div className="animate-spin h-4 w-4 border-b-2 border-indigo-400 rounded-full" />
                                    <span className="text-xs">
                                        {recheckStatus.total > 0
                                            ? `${recheckStatus.offset}/${recheckStatus.total}`
                                            : 'Checking...'}
                                    </span>
                                </>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            )}
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
                        {/* FAISS Rebuild Alert Banner */}
                        {faissStaleCount > 0 && (
                            <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <div>
                                        <p className="text-amber-300 font-medium text-sm">Face Index Needs Update</p>
                                        <p className="text-amber-400/70 text-xs">{faissStaleCount} faces have been removed or reassigned since the last rebuild.</p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleRebuildIndex}
                                    disabled={isRebuildingIndex}
                                    className="px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                                >
                                    {isRebuildingIndex ? (
                                        <div className="animate-spin h-4 w-4 border-2 border-amber-400 border-t-transparent rounded-full" />
                                    ) : (
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                    )}
                                    {isRebuildingIndex ? 'Rebuilding...' : 'Rebuild Index'}
                                </button>
                            </div>
                        )}

                        <div ref={gridSizes.identified.containerRef}>
                            {loading && people.length === 0 ? (
                                <div className="flex items-center justify-center h-full p-20">
                                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
                                </div>
                            ) : people.length === 0 ? (
                                <EmptyState
                                    icon={<PersonIcon className="w-12 h-12" />}
                                    title="No people found yet"
                                    description="Scan your photo library to detect faces. Once scanned, group and name the people in your photos."
                                    action={{ label: 'Go to Library', onClick: () => navigate('/library') }}
                                />
                            ) : (
                                <div style={{ ...gridSizes.identified.gridStyle, gap: '1.5rem' }}>
                                    {people.map(person => (
                                        <PersonCard
                                            key={person.id}
                                            person={person}
                                            onClick={() => handlePersonClick(String(person.id))}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}



                {activeTab === 'discoveries' && (
                    <div className="p-6">
                        {/* New Standard Toolbar */}
                        {discoveryBuckets.length > 0 && (
                            <div className="mb-6 sticky top-0 z-10 bg-gray-950/80 backdrop-blur-md py-2">
                                <ClusterToolbar
                                    selectedCount={discoveriesController.selectedFaceIds.size}
                                    totalCount={discoveriesController.allClusters.length}
                                    filteredCount={discoveriesController.filteredClusters.length}
                                    onSelectAll={discoveriesController.selectAll}
                                    onClearSelection={discoveriesController.clearSelection}
                                    sizeFilter={discoveriesController.sizeFilter}
                                    onSizeFilterChange={discoveriesController.setSizeFilter}
                                >
                                    <ClusterToolbarButton
                                        label="Ignore Selected"
                                        onClick={handleBulkIgnoreDiscoveries}
                                        disabled={discoveriesController.selectedFaceIds.size === 0}
                                        variant="danger"
                                    />
                                    <ClusterToolbarButton
                                        label="Name Selected"
                                        onClick={handleBulkNameDiscoveries}
                                        disabled={discoveriesController.selectedFaceIds.size === 0}
                                        variant="primary"
                                        icon={
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                            </svg>
                                        }
                                    />
                                </ClusterToolbar>

                                <div className="h-6 w-px bg-gray-800 mx-2" />

                                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-400 hover:text-white transition-colors select-none">
                                    <input
                                        type="checkbox"
                                        checked={combineDiscoveries}
                                        onChange={(e) => setCombineDiscoveries(e.target.checked)}
                                        className="rounded border-gray-700 bg-gray-800 text-indigo-500 focus:ring-indigo-500/50"
                                    />
                                    <span>Combine by Name</span>
                                </label>
                            </div>
                        )}

                        {areBucketsLoading || isMergingDiscoveries ? (
                            <div className="flex items-center justify-center h-full p-20">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
                            </div>
                        ) : totalDiscoveryCount === 0 ? (
                            <EmptyState
                                icon={<MagnifyingGlassIcon className="w-12 h-12" />}
                                title="All caught up"
                                description="No new face groups to review. New discoveries will appear here as more photos are scanned."
                            />
                        ) : (
                            <ClusterList
                                clusters={discoveriesController.displayedClusters}
                                selectedFaceIds={discoveriesController.selectedFaceIds}
                                handleIgnoreGroup={(ids) => {
                                    const bucket = discoveryBuckets.find(b => b.face_ids[0] === ids[0]);
                                    if (bucket) handleIgnoreBucket(bucket);
                                }}
                                toggleFace={discoveriesController.toggleFace}
                                toggleGroup={discoveriesController.toggleGroup}
                                fetchFacesByIds={fetchFacesByIds}
                                handleNameGroup={async (ids, name, confirm) => {
                                    console.log('[People] handleNameGroup called:', { firstId: ids[0], name, confirm, len: discoveryBuckets.length });
                                    const bucket = discoveryBuckets.find(b => b.face_ids[0] === ids[0]);

                                    if (bucket) {
                                        if (confirm && name) {
                                            // Direct confirm (Accept)
                                            await handleNameBucket(bucket, name);
                                        } else {
                                            // Open modal (should be handled by handleOpenNaming usually, but just in case)
                                            setPendingBucketNaming({ buckets: [bucket], type: 'discovery' });
                                            handleOpenNaming(ids);
                                        }
                                    }
                                }}
                                handleUngroup={(index) => {
                                    const cluster = discoveriesController.displayedClusters[index];
                                    const bucket = (cluster as any).data;
                                    if (bucket) handleRejectSuggestion(bucket);
                                }}

                                handleOpenNaming={async (ids) => {
                                    // Find bucket and track it for bucket-aware naming
                                    const bucket = discoveryBuckets.find(b => b.face_ids[0] === ids[0]);
                                    if (bucket) {
                                        setPendingBucketNaming({ buckets: [bucket], type: 'discovery' });
                                    }
                                    handleOpenNaming(ids);
                                }}
                                // Progressive Loading
                                hasMoreGroups={discoveriesController.hasMore}
                                remainingGroupCount={discoveriesController.remainingCount}
                                onLoadMore={discoveriesController.loadMore}
                                totalGroupCount={discoveriesController.filteredClusters.length}
                                // Keyboard
                                focusedIndex={discoveriesController.focusedClusterIndex}
                                onFocus={discoveriesController.setFocusedClusterIndex}
                            />
                        )}

                        {/* Floating Action Bar for Discoveries */}
                        {discoveriesController.selectedFaceIds.size > 0 && (
                            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in-up">
                                <FloatingActionBar
                                    selectedCount={discoveriesController.selectedFaceIds.size}
                                    onClearSelection={discoveriesController.clearSelection}
                                >
                                    <FloatingActionButton
                                        label="Name"
                                        icon={
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                            </svg>
                                        }
                                        onClick={handleBulkNameDiscoveries}
                                    />
                                    <div className="h-4 w-px bg-gray-700 mx-2" />
                                    <FloatingActionButton
                                        label="Ignore"
                                        icon={
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                            </svg>
                                        }
                                        onClick={handleBulkIgnoreDiscoveries}
                                        variant="danger"
                                    />
                                </FloatingActionBar>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'unnamed' && (
                    <div className="animate-fade-in space-y-4 p-4">
                        <div className="flex items-center justify-between gap-4 mb-4">
                            <EdgeCaseFilters
                                activeFilter={activeEdgeFilter}
                                onFilterChange={(f) => {
                                    setActiveEdgeFilter(f);
                                    if (f === 'ignored') ignoredCtrl.controller.clearSelection();
                                    if (f === 'background') bgCtrl.selectNone();
                                }}
                                counts={{
                                    unnamed: totalUnassigned,
                                    ignored: ignoredCtrl.totalCount,
                                    ungroupable: ungroupableFaces.length,
                                    background: bgCtrl.totalCandidates
                                }}
                            />
                        </div>

                        {activeEdgeFilter === 'unnamed' && (
                            <>

                                {/* Standardized Toolbar for Unnamed Faces (using usePeopleCluster's exposed controller props) */}
                                {clusters.length > 0 && (
                                    <div className="sticky top-0 z-10 bg-gray-950/80 backdrop-blur-md py-2">
                                        <ClusterToolbar
                                            selectedCount={selectedFaceIds.size}
                                            totalCount={totalGroupCount}
                                            onSizeFilterChange={onSizeFilterChange}
                                            filteredCount={displayedGroupCount} // Or filtered count from hook if exposed
                                            onSelectAll={() => selectAllGroups(selectedFaceIds.size === 0)}
                                            // Hack: Unnamed tab might mostly work differently or we haven't fully refactored usePeopleCluster to expose filters yet
                                            // Just passing defaults for now until usePeopleCluster exposes controller.filteredClusters
                                            onClearSelection={clearSelection}
                                            sizeFilter={'all'}
                                        >
                                            <button
                                                onClick={() => setShowGroupingModal(true)}
                                                className="px-3 py-1.5 text-sm bg-gray-800/50 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded-lg transition-colors"
                                            >
                                                Regroup
                                            </button>
                                            <button
                                                onClick={() => handleAutoAssign()}
                                                disabled={isAutoAssigning}
                                                className="px-3 py-1.5 text-sm bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg transition-colors flex items-center gap-2"
                                            >
                                                Auto-Identify All
                                            </button>

                                            {selectedFaceIds.size > 0 && (
                                                <ClusterToolbarButton
                                                    label="Ignore Selected"
                                                    onClick={() => handleIgnoreGroup(Array.from(selectedFaceIds))}
                                                    variant="danger"
                                                />
                                            )}
                                        </ClusterToolbar>
                                    </div>
                                )}

                                {isClustering ? (
                                    <div className="flex items-center justify-center h-64">
                                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
                                    </div>
                                ) : (
                                    <>
                                        <ClusterList
                                            clusters={clusters}
                                            selectedFaceIds={selectedFaceIds}
                                            toggleFace={toggleFace}
                                            toggleGroup={toggleGroup}
                                            fetchFacesByIds={fetchFacesByIds}
                                            handleNameGroup={handleNameGroup}
                                            handleUngroup={handleUngroup}
                                            handleIgnoreGroup={handleIgnoreGroup}
                                            handleOpenNaming={handleOpenNaming}
                                            onSuggestionFound={handleSuggestionFound}
                                            // Progressive Loading
                                            hasMoreGroups={hasMoreGroups}
                                            remainingGroupCount={remainingGroupCount}
                                            onLoadMore={loadMoreGroups}
                                            totalGroupCount={totalGroupCount}
                                            // Keyboard
                                            focusedIndex={focusedClusterIndex}
                                            onFocus={setFocusedClusterIndex}
                                        />

                                        {/* Singles Section */}
                                        {singles.length > 0 && (
                                            <div className="mt-8">
                                                <div className="flex items-center justify-between mb-4">
                                                    <h3 className="text-lg font-medium text-gray-400">
                                                        Single Faces ({singles.length})
                                                    </h3>
                                                    {singles.length > 50 && (
                                                        <button
                                                            onClick={() => handleAutoAssign(singles)}
                                                            className="text-xs text-indigo-400 hover:text-indigo-300"
                                                        >
                                                            Check all singles
                                                        </button>
                                                    )}
                                                </div>
                                                <div ref={gridSizes.singles.containerRef} style={gridSizes.singles.gridStyle}>
                                                    {visibleSingleFaces.map(face => (
                                                        <div
                                                            key={face.id}
                                                            className={`aspect-square rounded-lg overflow-hidden border cursor-pointer relative group ${selectedFaceIds.has(face.id)
                                                                ? 'border-indigo-500 ring-2 ring-indigo-500/50'
                                                                : 'border-gray-800 hover:border-gray-600'
                                                                }`}
                                                            onClick={() => toggleFace(face.id)}
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
                                                                    <div className="bg-indigo-500 rounded-full p-1">
                                                                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                        </svg>
                                                                    </div>
                                                                </div>
                                                            )}
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
                                                    ))}
                                                    {singles.length > 100 && (
                                                        <div className="flex items-center justify-center bg-gray-800/50 rounded-lg text-xs text-gray-500 aspect-square">
                                                            +{singles.length - 100} more
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* Ungroupable Link */}
                                {ungroupableFaces.length > 0 && (
                                    <div className="mt-8 pt-8 border-t border-gray-800/50 text-center">
                                        <button
                                            onClick={() => setActiveEdgeFilter('ungroupable')}
                                            className="text-sm text-gray-500 hover:text-gray-300 transition-colors flex items-center justify-center gap-2 mx-auto"
                                        >
                                            <span className="w-2 h-2 rounded-full bg-gray-700"></span>
                                            View {ungroupableFaces.length} ungroupable faces
                                        </button>
                                    </div>
                                )}

                                {/* Empty State */}
                                {clusters.length === 0 && singles.length === 0 && !isClustering && (
                                    <div className="text-center py-20 text-gray-500">
                                        <span className="text-4xl mb-4 block">🎉</span>
                                        <h3 className="text-xl font-medium mb-2">All faces sorted!</h3>
                                        <p className="max-w-md mx-auto">
                                            Great job. You've organized all current faces.
                                            <br />
                                            <button
                                                onClick={() => setActiveEdgeFilter('ignored')}
                                                className="text-indigo-400 hover:text-indigo-300 mt-2 underline"
                                            >
                                                Review ignored faces
                                            </button>
                                        </p>
                                    </div>
                                )}

                                <FloatingActionBar
                                    selectedCount={selectedFaceIds.size}
                                    onClearSelection={clearSelection}
                                >
                                    <FloatingActionButton
                                        label="Name"
                                        icon={
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                            </svg>
                                        }
                                        onClick={() => handleOpenNaming(Array.from(selectedFaceIds))}
                                    />
                                    <div className="h-4 w-px bg-gray-700 mx-2" />
                                    <FloatingActionButton
                                        label="Ignore"
                                        icon={
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                            </svg>
                                        }
                                        onClick={() => handleIgnoreGroup(Array.from(selectedFaceIds))}
                                        variant="danger"
                                    />
                                    <div className="h-4 w-px bg-gray-700 mx-2" />
                                    <FloatingActionButton
                                        label="Debug"
                                        icon={
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                                            </svg>
                                        }
                                        onClick={() => {
                                            const firstId = Array.from(selectedFaceIds)[0];
                                            if (firstId) setSelectedFaceForDebug(firstId);
                                        }}
                                    />
                                </FloatingActionBar>
                            </>
                        )}

                        {activeEdgeFilter === 'ignored' && (
                            <div className="space-y-4">
                                <div className="bg-gray-800/30 p-4 rounded-xl border border-gray-700/50">
                                    <ClusterToolbar
                                        selectedCount={ignoredCtrl.controller.selectedFaceIds.size}
                                        totalCount={ignoredCtrl.totalCount}
                                        onSelectAll={ignoredCtrl.controller.selectAll}
                                        onClearSelection={ignoredCtrl.controller.clearSelection}
                                        sizeFilter="all"
                                        onSizeFilterChange={() => { }}
                                        filteredCount={ignoredFaces.length}
                                    >
                                        <div className="flex gap-2">
                                            {ignoredCtrl.controller.selectedFaceIds.size > 0 && (
                                                <ClusterToolbarButton
                                                    label="Restore Selected"
                                                    onClick={() => ignoredCtrl.handleRestore(Array.from(ignoredCtrl.controller.selectedFaceIds))}
                                                    variant="primary"
                                                />
                                            )}
                                            <button
                                                onClick={ignoredCtrl.handleClusterToggle}
                                                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors flex items-center gap-2 ${ignoredCtrl.isGrouping
                                                    ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50'
                                                    : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                                                    }`}
                                            >
                                                {ignoredCtrl.isGrouping ? 'Disable Groups' : 'Group Similar'}
                                            </button>
                                        </div>
                                    </ClusterToolbar>
                                </div>

                                {ignoredCtrl.loading && ignoredFaces.length === 0 ? (
                                    <div className="flex justify-center p-20"><div className="animate-spin h-8 w-8 border-4 border-indigo-500 rounded-full border-t-transparent" /></div>
                                ) : (
                                    <>
                                        {ignoredCtrl.isGrouping ? (
                                            <ClusterList
                                                clusters={ignoredCtrl.controller.displayedClusters}
                                                selectedFaceIds={ignoredCtrl.controller.selectedFaceIds}
                                                toggleFace={ignoredCtrl.controller.toggleFace}
                                                toggleGroup={ignoredCtrl.controller.toggleGroup}
                                                fetchFacesByIds={fetchFacesByIds}
                                                handleNameGroup={async (_ids) => { }}
                                                handleUngroup={(_index) => { }}
                                                handleIgnoreGroup={(_ids) => { }}
                                                handleOpenNaming={async (_ids) => { }}
                                                hasMoreGroups={ignoredCtrl.controller.hasMore}
                                                remainingGroupCount={ignoredCtrl.controller.remainingCount}
                                                onLoadMore={ignoredCtrl.controller.loadMore}
                                                totalGroupCount={ignoredCtrl.controller.filteredClusters.length}
                                                focusedIndex={ignoredCtrl.controller.focusedClusterIndex}
                                            />
                                        ) : (
                                            <div ref={gridSizes.ignored.containerRef} style={gridSizes.ignored.gridStyle}>
                                                {ignoredFaces.map(face => (
                                                    <div key={face.id} className={`aspect-square rounded-lg overflow-hidden border-2 cursor-pointer relative group ${ignoredCtrl.controller.selectedFaceIds.has(face.id) ? 'border-green-500' : 'border-transparent hover:border-gray-700'}`} onClick={() => ignoredCtrl.controller.toggleFace(face.id)}>
                                                        <FaceThumbnail
                                                            src={`local-resource://${encodeURIComponent(face.file_path || '')}`}
                                                            fallbackSrc={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path || '')}`}
                                                            box={face.box}
                                                            originalImageWidth={face.width}
                                                            useServerCrop={true}
                                                            className="w-full h-full object-cover"
                                                        />
                                                        {ignoredCtrl.controller.selectedFaceIds.has(face.id) && <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center">✓</div>}
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
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                                {!ignoredCtrl.isGrouping && ignoredFaces.length < ignoredCtrl.totalCount && (
                                    <div className="flex justify-center mt-8">
                                        <button onClick={ignoredCtrl.handleLoadMore} className="px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-full text-sm font-medium transition-colors">Load More ({ignoredCtrl.totalCount - ignoredFaces.length} remaining)</button>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeEdgeFilter === 'background' && (
                            <div className="space-y-4">
                                <div className="flex justify-between items-center bg-gray-800/30 p-4 rounded-xl border border-gray-700/50">
                                    <div className="text-sm text-gray-400">{bgCtrl.selectedIds.size} selected</div>
                                    <div className="flex gap-2">
                                        <button onClick={bgCtrl.selectAllLoaded} className="text-xs text-indigo-400 hover:text-indigo-300">Select All Loaded</button>
                                        <button onClick={bgCtrl.selectNone} className="text-xs text-gray-500 hover:text-gray-400">Deselect</button>
                                    </div>
                                    {/* Ignore button removed from here, moved to FAB */}
                                </div>
                                <div ref={gridSizes.background.containerRef} style={gridSizes.background.gridStyle}>
                                    {backgroundFaces.map(c => (
                                        <div key={c.faceId} className={`aspect-square rounded-lg overflow-hidden border-2 cursor-pointer relative group ${bgCtrl.selectedIds.has(c.faceId) ? 'border-red-500' : 'border-transparent hover:border-gray-700'}`} onClick={() => bgCtrl.toggleSelection(c.faceId)}>
                                            <FaceThumbnail
                                                src={`local-resource://${encodeURIComponent(c.file_path || '')}`}
                                                fallbackSrc={`local-resource://${encodeURIComponent(c.preview_cache_path || c.file_path || '')}`}
                                                box={c.box}
                                                originalImageWidth={c.photo_width}
                                                useServerCrop={true}
                                                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                                            />
                                            <div className="absolute top-1 right-1 bg-black/60 backdrop-blur rounded px-1.5 py-0.5 text-[10px] text-gray-300 font-mono">{c.nearestPersonDistance.toFixed(2)}</div>
                                            {bgCtrl.selectedIds.has(c.faceId) && <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">✓</div>}
                                            <button
                                                className="absolute bottom-1 right-1 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-indigo-600 z-20 shadow-lg"
                                                title="View Original Photo"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    viewPhoto(c.photo_id);
                                                }}
                                            >
                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                </svg>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                {bgCtrl.hasMore && (
                                    <div className="flex justify-center mt-8">
                                        <button onClick={bgCtrl.loadMore} className="px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-full text-sm font-medium transition-colors">Load More</button>
                                    </div>
                                )}

                                {/* Floating Action Bar for Background Faces */}
                                {bgCtrl.selectedIds.size > 0 && (
                                    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in-up">
                                        <FloatingActionBar
                                            selectedCount={bgCtrl.selectedIds.size}
                                            onClearSelection={bgCtrl.selectNone}
                                        >
                                            <FloatingActionButton
                                                label="Name"
                                                icon={
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                                    </svg>
                                                }
                                                onClick={handleOpenBackgroundNaming}
                                            />
                                            <div className="h-4 w-px bg-gray-700 mx-2" />
                                            <FloatingActionButton
                                                label="Ignore"
                                                icon={
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                                    </svg>
                                                }
                                                onClick={() => bgCtrl.handleIgnoreSelected()}
                                                variant="danger"
                                            />
                                        </FloatingActionBar>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeEdgeFilter === 'ungroupable' && (
                            <div className="space-y-4">
                                <div className="bg-gray-800/30 p-4 rounded-xl border border-gray-700/50 flex justify-between items-center">
                                    <div className="flex gap-4 items-center">
                                        <span className="text-sm text-gray-400">Faces that could not be clustered ({ungroupableFaces.length})</span>
                                        <div className="text-sm text-gray-500">{selectedUngroupableIds.size} selected</div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={selectAllLoadedUngroupable} className="text-xs text-indigo-400 hover:text-indigo-300">Select All Loaded</button>
                                        <button onClick={clearUngroupableSelection} className="text-xs text-gray-500 hover:text-gray-400">Deselect</button>
                                    </div>
                                </div>
                                <div ref={gridSizes.ungroupable.containerRef} style={gridSizes.ungroupable.gridStyle}>
                                    {ungroupableFetched.map(face => (
                                        <div
                                            key={face.id}
                                            className={`aspect-square rounded-lg overflow-hidden border cursor-pointer relative group transition-colors ${selectedUngroupableIds.has(face.id) ? 'border-indigo-500' : 'border-gray-800 hover:border-gray-600'
                                                }`}
                                            onClick={() => toggleUngroupableSelection(face.id)}
                                        >
                                            <FaceThumbnail
                                                src={`local-resource://${encodeURIComponent(face.file_path || '')}`}
                                                fallbackSrc={`local-resource://${encodeURIComponent(face.preview_cache_path || face.file_path || '')}`}
                                                box={face.box}
                                                originalImageWidth={face.width}
                                                useServerCrop={true}
                                                className={`w-full h-full object-cover ${selectedUngroupableIds.has(face.id) ? 'opacity-80' : ''}`}
                                            />
                                            {selectedUngroupableIds.has(face.id) && <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center">✓</div>}
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
                                    ))}
                                </div>
                                {loadMoreUngroupable && (
                                    <div className="flex justify-center mt-8">
                                        <button
                                            onClick={loadMoreUngroupable}
                                            className="px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-full text-sm font-medium transition-colors"
                                        >
                                            Load More
                                        </button>
                                    </div>
                                )}

                                {selectedUngroupableIds.size > 0 && (
                                    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in-up">
                                        <FloatingActionBar
                                            selectedCount={selectedUngroupableIds.size}
                                            onClearSelection={clearUngroupableSelection}
                                        >
                                            <FloatingActionButton
                                                label="Name"
                                                icon={
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                                    </svg>
                                                }
                                                onClick={handleOpenUngroupableNaming}
                                            />
                                            <div className="h-4 w-px bg-gray-700 mx-2" />
                                            <FloatingActionButton
                                                label="Ignore"
                                                icon={
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                                    </svg>
                                                }
                                                onClick={handleIgnoreUngroupable}
                                                variant="danger"
                                            />
                                        </FloatingActionBar>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Modals */}


                <GroupNamingModal
                    open={!!namingGroup}
                    onOpenChange={(open) => {
                        if (!open) {
                            setNamingGroup(null);
                            setPendingBackgroundNaming(false);
                            setPendingUngroupableNaming(false);
                        }
                    }}
                    faces={namingGroup?.faces || []}
                    onConfirm={async (ids, name) => {
                        // Check if this is a bucket naming
                        if (pendingBucketNaming) {
                            if (pendingBucketNaming.type === 'discovery') {
                                // Discoveries loop
                                for (const bucket of pendingBucketNaming.buckets) {
                                    await handleNameBucket(bucket as FaceBucket, name);
                                }
                                // Clear selection for discoveries
                                discoveriesController.clearSelection();
                            }
                            setPendingBucketNaming(null);
                        } else if (pendingBackgroundNaming) {
                            await bgCtrl.handleNameSelected(name);
                            setPendingBackgroundNaming(false);
                        } else if (pendingUngroupableNaming) {
                            await handleConfirmName(ids, name); // Existing handler works for IDs
                            setPendingUngroupableNaming(false);
                            clearUngroupableSelection();
                        } else {
                            await handleConfirmName(ids, name);
                        }
                    }}
                />

                {/* TargetedScanModal removed */}



                <ClusteringSettingsModal
                    open={showGroupingModal}
                    onOpenChange={setShowGroupingModal}
                    onRecluster={(settings) => {
                        loadClusteredFaces({
                            threshold: settings.threshold,
                            min_samples: settings.min_samples,
                            excludeBackground: settings.excludeBackground,
                            groupBySuggestion: settings.groupBySuggestion,
                            max_spread: settings.max_spread
                        })
                    }}
                />

                <FaceDebugModal
                    isOpen={!!selectedFaceForDebug}
                    onClose={() => setSelectedFaceForDebug(null)}
                    faceIds={selectedFaceForDebug ? [selectedFaceForDebug] : []}
                />

            </div>
        </div >
    )
}
