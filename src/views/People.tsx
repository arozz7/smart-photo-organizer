import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePeople } from '../context/PeopleContext'
import { useAI } from '../context/AIContext'
import { usePeopleCluster } from '../hooks/usePeopleCluster'
import { useBuckets } from '../hooks/useBuckets'
import PersonCard from '../components/PersonCard'
import ClusterList from '../components/ClusterList'
import SmartIgnorePanel from '../components/SmartIgnorePanel'
import { useAlert } from '../context/AlertContext'
import { useToast } from '../context/ToastContext'
// types removed
import GroupNamingModal from '../components/GroupNamingModal'
import BackgroundFaceFilterModal from '../components/BackgroundFaceFilterModal'
import RecoveredFacesModal from '../components/RecoveredFacesModal'
import { ClusterToolbar, ClusterToolbarButton } from '../components/ClusterToolbar'
import { useClusterController } from '../hooks/useClusterController'
import BlurryFacesModal from '../components/BlurryFacesModal'
import IgnoredFacesModal from '../components/IgnoredFacesModal'
import UnmatchedFacesModal from '../components/UnmatchedFacesModal'
import ClusteringSettingsModal from '../components/ClusteringSettingsModal'
import FaceDebugModal from '../components/FaceDebugModal'
import FaceThumbnail from '../components/FaceThumbnail'
import { Face } from '../types'
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
        faissStaleCount
    } = usePeople()

    const { onPhotoProcessed } = useAI()
    const { showConfirm } = useAlert()
    const { addToast } = useToast()

    // Existing hook for "Unnamed Faces" tab (Legacy + Controller internal)
    const {
        clusters,
        totalGroupCount,
        singles,
        totalUnassigned,
        isClustering,
        isAutoAssigning,
        selectedFaceIds,
        namingGroup,
        setNamingGroup,
        loadClusteredFaces,
        toggleFace,
        toggleGroup,
        handleAutoAssign,
        handleNameGroup,
        handleIgnoreGroup,
        handleUngroup,
        handleIgnoreAllGroups,
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
        ungroupableFaces,
        // @ts-ignore
        handleKeyDown,
        // @ts-ignore
        focusedClusterIndex
    } = usePeopleCluster()

    // Capture the whole object to access focusedClusterIndex easily if destructured var isn't enough context (it is)
    const usePeopleClusterRet = { focusedClusterIndex };

    const [activeTab, setActiveTab] = useState<'identified' | 'unnamed' | 'suggestions' | 'discoveries'>('identified')

    // Buckets Hook (Suggestions & Discoveries)
    const {
        suggestionBuckets,
        discoveryBuckets,
        totalSuggestionCount,
        totalDiscoveryCount,
        loadingBuckets: areBucketsLoading,
        loadBuckets: refreshBuckets,
        handleConfirmSuggestion,
        handleRejectSuggestion,
        handleNameBucket,
        handleIgnoreBucket,
        handleStartRecheck,
        recheckStatus
    } = useBuckets()

    // --- Controllers for Buckets Tabs ---

    // 1. Suggestions Controller
    // Map buckets to ClusterType
    const suggestionClustersData = useMemo(() => {
        return suggestionBuckets.map(b => ({
            faces: b.face_ids,
            data: b // store full bucket object
        }));
    }, [suggestionBuckets]);

    const suggestionsController = useClusterController({
        clusters: suggestionClustersData,
        pageSize: 50
    });

    // 2. Discoveries Controller
    const discoveryClustersData = useMemo(() => {
        return discoveryBuckets.map(b => ({
            faces: b.face_ids,
            data: b
        }));
    }, [discoveryBuckets]);

    const discoveriesController = useClusterController({
        clusters: discoveryClustersData,
        pageSize: 50
    });

    // --- Tab Switching Cleanup ---
    // Reset pagination/selection when switching tabs
    useEffect(() => {
        if (activeTab === 'unnamed') resetDisplayedCount();
        if (activeTab === 'suggestions') {
            suggestionsController.resetPagination();
            suggestionsController.clearSelection();
        }
        if (activeTab === 'discoveries') {
            discoveriesController.resetPagination();
            discoveriesController.clearSelection();
        }
    }, [activeTab, resetDisplayedCount]);

    // --- Keyboard Handlers ---
    useEffect(() => {
        if (activeTab === 'suggestions') {
            const handleKey = (e: KeyboardEvent) => {
                suggestionsController.handleKeyDown(e, {
                    onAccept: (index) => {
                        const cluster = suggestionsController.displayedClusters[index];
                        if (cluster && cluster.data) {
                            handleConfirmSuggestion(cluster.data, cluster.faces);
                        }
                    },
                    onIgnore: (index) => {
                        const cluster = suggestionsController.displayedClusters[index];
                        if (cluster && cluster.data) {
                            handleIgnoreBucket(cluster.data);
                        }
                    },
                    onName: (index) => {
                        // Open naming for focused cluster
                        const cluster = suggestionsController.displayedClusters[index];
                        if (cluster) handleOpenNaming(cluster.faces);
                    }
                });
            };
            window.addEventListener('keydown', handleKey);
            return () => window.removeEventListener('keydown', handleKey);
        }
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

    }, [activeTab, suggestionsController, discoveriesController, suggestionClustersData, discoveryClustersData])

    // Effect for Unnamed Tab Keydown (easier to separate)
    useEffect(() => {
        if (activeTab !== 'unnamed') return;

        // @ts-ignore
        const handler = (e: KeyboardEvent) => handleKeyDown(e, {
            onAccept: (index) => {
                const cluster = clusters[index];
                if (cluster && cluster.suggestion) {
                    handleConfirmName(cluster.faces, cluster.suggestion.person.name);
                } else if (cluster) {
                    // Fallback: Open naming if no suggestion
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
    }, [activeTab, handleKeyDown /* from usePeopleCluster */, clusters, handleOpenNaming, handleIgnoreGroup, handleConfirmName]);

    // --- Bulk Action Handlers (Suggestions) ---
    const handleBulkConfirmSuggestions = async () => {
        const selectedIds = suggestionsController.selectedFaceIds;
        if (selectedIds.size === 0) return;

        // Find buckets involved
        const affectedBuckets = suggestionBuckets.filter(b =>
            b.face_ids.some(id => selectedIds.has(id))
        );

        if (affectedBuckets.length === 0) return;

        showConfirm({
            title: 'Confirm Selected Suggestions',
            description: `Confirm suggestions for ${affectedBuckets.length} groups?`,
            confirmLabel: 'Confirm All',
            onConfirm: async () => {
                // Optimistic UI updates handled by useBuckets or we manually trigger refresh
                for (const bucket of affectedBuckets) {
                    await handleConfirmSuggestion(bucket, bucket.face_ids);
                }
                suggestionsController.clearSelection();
                addToast({ type: 'success', description: `Confirmed ${affectedBuckets.length} groups` });
            }
        });
    };

    const handleBulkIgnoreSuggestions = async () => {
        const selectedIds = suggestionsController.selectedFaceIds;
        if (selectedIds.size === 0) return;

        // Map to buckets
        const affectedBuckets = suggestionBuckets.filter(b =>
            b.face_ids.some(id => selectedIds.has(id))
        );

        showConfirm({
            title: 'Ignore Selected Groups',
            description: `Ignore ${affectedBuckets.length} groups?`,
            confirmLabel: 'Ignore',
            variant: 'danger',
            onConfirm: async () => {
                for (const bucket of affectedBuckets) {
                    await handleIgnoreBucket(bucket);
                }
                suggestionsController.clearSelection();
                addToast({ type: 'success', description: `Ignored ${affectedBuckets.length} groups` });
            }
        });
    }

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
                    await handleIgnoreBucket(bucket);
                }
                discoveriesController.clearSelection();
                addToast({ type: 'success', description: `Ignored ${affectedBuckets.length} groups` });
            }
        });
    };


    // --- Other Hooks & State ---
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    const [showBackgroundFilterModal, setShowBackgroundFilterModal] = useState(false)
    const [hasNewFaces, setHasNewFaces] = useState(false)

    // Ignored Recheck Status
    const [showRecoveredModal, setShowRecoveredModal] = useState(false);
    const [showGroupingModal, setShowGroupingModal] = useState(false)
    const [showBlurryModal, setShowBlurryModal] = useState(false)
    const [showIgnoredModal, setShowIgnoredModal] = useState(false)
    const [showUnmatchedModal, setShowUnmatchedModal] = useState(false)

    // Pending bucket naming state
    const [pendingBucketNaming, setPendingBucketNaming] = useState<{ bucket: any, type: 'suggestion' | 'discovery' } | null>(null);
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
    useEffect(() => {
        if (activeTab === 'suggestions' || activeTab === 'discoveries') {
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
        navigate(`/person/${personId}`)
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
                                <button
                                    onClick={() => setActiveTab('suggestions')}
                                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap ${activeTab === 'suggestions'
                                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                                        }`}
                                >
                                    Suggestions <span className="ml-2 opacity-50 text-xs">({totalSuggestionCount})</span>
                                </button>
                                <button
                                    onClick={() => setActiveTab('discoveries')}
                                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap ${activeTab === 'discoveries'
                                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                                        }`}
                                >
                                    Discoveries <span className="ml-2 opacity-50 text-xs">({totalDiscoveryCount})</span>
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
                        <button
                            onClick={() => setShowRecoveredModal(true)}
                            className="bg-gray-800/50 hover:bg-gray-700 text-gray-400 border border-gray-700 px-3 py-2 rounded-lg transition-colors flex items-center gap-2"
                            title="View Recovered Faces"
                        >
                            <span className="text-sm">⚡</span>
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
                                    onClick={rebuildFaissIndex}
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
                                        onClick={() => handlePersonClick(String(person.id))}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'suggestions' && (
                    <div className="p-6">
                        {/* New Standard Toolbar */}
                        {suggestionBuckets.length > 0 && (
                            <div className="mb-6 sticky top-0 z-10 bg-gray-950/80 backdrop-blur-md py-2">
                                <ClusterToolbar
                                    selectedCount={suggestionsController.selectedFaceIds.size}
                                    totalCount={suggestionsController.allClusters.length}
                                    filteredCount={suggestionsController.filteredClusters.length}
                                    onSelectAll={suggestionsController.selectAll}
                                    onClearSelection={suggestionsController.clearSelection}
                                    sizeFilter={suggestionsController.sizeFilter}
                                    onSizeFilterChange={suggestionsController.setSizeFilter}
                                >
                                    {/* Suggestion-specific Actions */}
                                    <ClusterToolbarButton
                                        label="Confirm Selected"
                                        onClick={handleBulkConfirmSuggestions}
                                        disabled={suggestionsController.selectedFaceIds.size === 0}
                                        variant="primary"
                                        icon={
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                        }
                                    />
                                    <ClusterToolbarButton
                                        label="Ignore Selected"
                                        onClick={handleBulkIgnoreSuggestions}
                                        disabled={suggestionsController.selectedFaceIds.size === 0}
                                        variant="danger"
                                    />
                                </ClusterToolbar>
                            </div>
                        )}

                        {areBucketsLoading ? (
                            <div className="flex items-center justify-center h-full p-20">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
                            </div>
                        ) : totalSuggestionCount === 0 ? (
                            <div className="text-center py-20 text-gray-500">
                                <span className="text-4xl mb-4 block">✨</span>
                                <p>No naming suggestions found yet.</p>
                            </div>
                        ) : (
                            <ClusterList
                                clusters={suggestionsController.displayedClusters}
                                selectedFaceIds={suggestionsController.selectedFaceIds}
                                toggleFace={suggestionsController.toggleFace}
                                toggleGroup={suggestionsController.toggleGroup}
                                fetchFacesByIds={fetchFacesByIds}
                                handleNameGroup={async (ids, _name, _confirm) => {
                                    const bucket = suggestionBuckets.find(b => b.face_ids.includes(ids[0]));
                                    if (bucket) await handleConfirmSuggestion(bucket, ids);
                                }}
                                handleUngroup={(index) => {
                                    const cluster = suggestionsController.displayedClusters[index];
                                    const bucket = (cluster as any).data;
                                    if (bucket) handleRejectSuggestion(bucket);
                                }}
                                handleIgnoreGroup={(ids) => {
                                    const bucket = suggestionBuckets.find(b => b.face_ids[0] === ids[0]);
                                    if (bucket) handleIgnoreBucket(bucket);
                                }}
                                handleOpenNaming={async (ids) => {
                                    const bucket = suggestionBuckets.find(b => b.face_ids[0] === ids[0]);
                                    if (bucket) {
                                        setPendingBucketNaming({ bucket, type: 'suggestion' });
                                    }
                                    handleOpenNaming(ids);
                                }}
                                // Progressive Loading
                                hasMoreGroups={suggestionsController.hasMore}
                                remainingGroupCount={suggestionsController.remainingCount}
                                onLoadMore={suggestionsController.loadMore}
                                totalGroupCount={suggestionsController.filteredClusters.length}
                                // Keyboard
                                focusedIndex={suggestionsController.focusedClusterIndex}
                            />
                        )}
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
                                </ClusterToolbar>
                            </div>
                        )}

                        {areBucketsLoading ? (
                            <div className="flex items-center justify-center h-full p-20">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
                            </div>
                        ) : totalDiscoveryCount === 0 ? (
                            <div className="text-center py-20 text-gray-500">
                                <span className="text-4xl mb-4 block">🔍</span>
                                <p>No new discoveries yet.</p>
                            </div>
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
                                handleNameGroup={async (ids, name, _confirm) => {
                                    console.log('[People] handleNameGroup called:', { firstId: ids[0], name, len: discoveryBuckets.length });
                                    const bucket = discoveryBuckets.find(b => b.face_ids[0] === ids[0]);
                                    if (bucket) await handleNameBucket(bucket, name);
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
                                        setPendingBucketNaming({ bucket, type: 'discovery' });
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
                            />
                        )}
                    </div>
                )}

                {activeTab === 'unnamed' && (
                    <div className="animate-fade-in space-y-4 p-4">
                        <SmartIgnorePanel
                            onFilterBackground={() => setShowBackgroundFilterModal(true)}
                            onIgnoreAllGroups={handleIgnoreAllGroups}
                            stats={{
                                autoIgnored: 0,
                                backgroundIdentified: 0,
                                pendingReview: totalUnassigned
                            }}
                        />

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
                                        onClick={handleAutoAssign}
                                        disabled={isAutoAssigning}
                                        className="px-3 py-1.5 text-sm bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg transition-colors flex items-center gap-2"
                                    >
                                        Auto-Identify All
                                    </button>
                                    <ClusterToolbarButton
                                        label="Cleanup Blurry"
                                        onClick={() => setShowBlurryModal(true)}
                                    />
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
                                    focusedIndex={usePeopleClusterRet.focusedClusterIndex}
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
                                        <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-2">
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
                                    onClick={() => setShowUnmatchedModal(true)}
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
                                        onClick={() => setShowIgnoredModal(true)}
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
                    </div>
                )}
            </div>

            {/* Modals */}


            <GroupNamingModal
                open={!!namingGroup}
                onOpenChange={(open) => !open && setNamingGroup(null)}
                faces={namingGroup?.faces || []}
                onConfirm={async (ids, name) => {
                    // Check if this is a bucket naming
                    if (pendingBucketNaming) {
                        if (pendingBucketNaming.type === 'suggestion') {
                            await handleConfirmName(ids, name);
                        } else {
                            await handleNameBucket(pendingBucketNaming.bucket, name);
                        }
                        setPendingBucketNaming(null);
                    } else {
                        await handleConfirmName(ids, name);
                    }
                }}
            />

            {/* TargetedScanModal removed */}

            <BackgroundFaceFilterModal
                isOpen={showBackgroundFilterModal}
                onClose={() => setShowBackgroundFilterModal(false)}
            />

            <RecoveredFacesModal
                isOpen={showRecoveredModal}
                onClose={() => setShowRecoveredModal(false)}
            />

            <BlurryFacesModal
                open={showBlurryModal}
                onOpenChange={setShowBlurryModal}
                onDeleteComplete={() => loadClusteredFaces()}
            />

            <IgnoredFacesModal
                isOpen={showIgnoredModal}
                onClose={() => setShowIgnoredModal(false)}
            />

            <UnmatchedFacesModal
                isOpen={showUnmatchedModal}
                onClose={() => setShowUnmatchedModal(false)}
                faceIds={[]}
                onName={() => { }}
                onAutoName={async () => { }}
                onIgnore={() => { }}
            />

            <ClusteringSettingsModal
                open={showGroupingModal}
                onOpenChange={setShowGroupingModal}
                onRecluster={(settings) => {
                    loadClusteredFaces({
                        threshold: settings.threshold,
                        min_samples: settings.min_samples,
                        excludeBackground: settings.excludeBackground,
                        groupBySuggestion: settings.groupBySuggestion
                    })
                }}
            />

            <FaceDebugModal
                isOpen={!!selectedFaceForDebug}
                onClose={() => setSelectedFaceForDebug(null)}
                faceIds={selectedFaceForDebug ? [selectedFaceForDebug] : []}
            />

        </div>
    )
}
