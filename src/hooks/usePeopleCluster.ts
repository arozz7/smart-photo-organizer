import { useState, useCallback } from 'react'
import { usePeople } from '../context/PeopleContext'
// import { useAI } from '../context/AIContext' // Unused
import { useAlert } from '../context/AlertContext'
import { useToast } from '../context/ToastContext'
import { Face } from '../types'
import { useClusterController } from './useClusterController'

export function usePeopleCluster() {
    const { loadPeople, loadUnnamedFaces, autoNameFaces, fetchFacesByIds } = usePeople()
    // const { addToQueue } = useAI() // Unused
    const { showAlert, showConfirm } = useAlert()
    const { addToast } = useToast()

    // Clustering Data State
    const [clusters, setClusters] = useState<{ faces: number[], suggestion?: any }[]>([])
    const [singles, setSingles] = useState<number[]>([])
    const [ungroupableFaces, setUngroupableFaces] = useState<number[]>([])
    const [totalFaces, setTotalFaces] = useState(0)
    const [totalUnassigned, setTotalUnassigned] = useState(0)
    const [isClustering, setIsClustering] = useState(false)
    const [isAutoAssigning, setIsAutoAssigning] = useState(false);

    // Controller Hook
    // We map simple number[] clusters to match the controller's expectation if needed,
    // but the controller handles generic T, so { faces: number[], suggestion: any } fits ClusterType<any>
    const controller = useClusterController({
        clusters: clusters,
        pageSize: 100
    });

    // Group Naming Modal State
    const [namingGroup, setNamingGroup] = useState<{ faces: Face[], name: string } | null>(null)

    const loadClusteredFaces = useCallback(async (options?: { threshold?: number, min_samples?: number, excludeBackground?: boolean, groupBySuggestion?: boolean }) => {
        setIsClustering(true)
        try {
            // Contextual Merge: 
            // 1. passed options (highest priority)
            // 2. localStorage persistence
            // 3. undefined (falls back to backend defaults)

            let finalThreshold = options?.threshold;
            if (finalThreshold === undefined) {
                const saved = localStorage.getItem('regroupThreshold');
                if (saved) finalThreshold = parseFloat(saved);
            }

            // Load saved advanced settings if not passed
            let excludeBackground = options?.excludeBackground;
            if (excludeBackground === undefined) {
                excludeBackground = localStorage.getItem('excludeBackground') === 'true';
            }
            let groupBySuggestion = options?.groupBySuggestion;
            if (groupBySuggestion === undefined) {
                groupBySuggestion = localStorage.getItem('groupBySuggestion') === 'true';
            }

            const finalOptions = {
                ...options,
                threshold: finalThreshold,
                excludeBackground,
                groupBySuggestion
            };

            const res = await loadUnnamedFaces(finalOptions)
            if (res) {
                const rawClusters = res.clusters;
                let normalizedClusters: { faces: number[], suggestion?: any }[] = [];

                if (rawClusters.length > 0) {
                    // Check if clusters are simple arrays (old/legacy) or objects (new backend grouping)
                    const isSimpleArray = Array.isArray(rawClusters[0]);

                    if (isSimpleArray) {
                        // Standard DBSCAN result (number[][])
                        normalizedClusters = rawClusters.map((ids: number[]) => ({ faces: ids, suggestion: null }));
                        // Sort by size descending
                        normalizedClusters.sort((a, b) => b.faces.length - a.faces.length);
                    } else {
                        // Backend grouped result ({ faces: number[], suggestion: any }[])
                        // Already sorted by backend (Suggested first, then size)
                        normalizedClusters = rawClusters as any;
                    }
                }

                setClusters(normalizedClusters)
                setSingles(res.singles)

                const clusterCount = normalizedClusters.reduce((acc, c) => acc + c.faces.length, 0);
                setTotalFaces(clusterCount + res.singles.length);
                setTotalUnassigned(res.totalUnassigned || (clusterCount + res.singles.length));

                // Reset pagination when data reloads
                controller.resetPagination();
            }
        } catch (e) {
            console.error("Failed to load clusters", e)
        } finally {
            setIsClustering(false)
        }
    }, [loadUnnamedFaces, fetchFacesByIds, controller.resetPagination])

    // --- Actions ---

    const handleAutoAssign = async (targetFaceIds?: number[]) => {
        // If specific IDs provided, use them. Otherwise check total count.
        const countToCheck = targetFaceIds ? targetFaceIds.length : totalFaces;
        if (countToCheck === 0) return;

        const isTargeted = !!targetFaceIds && targetFaceIds.length > 0;
        const description = isTargeted
            ? `Cross-check ${targetFaceIds.length} selected faces against your identified people?`
            : `This will cross-check ALL unassigned faces in your library against your identified people. This may take a while depending on the number of faces.`;

        showConfirm({
            title: isTargeted ? 'Auto-Identify Faces' : 'Auto-Identify All Faces',
            description,
            confirmLabel: 'Run Auto-Identify',
            onConfirm: async () => {
                console.log("[People] User confirmed Auto-Identify. Starting...");
                setIsAutoAssigning(true);
                try {
                    console.log(`[People] Invoking db:autoAssignFaces... Target count: ${countToCheck}`);
                    // @ts-ignore
                    const res = await window.ipcRenderer.invoke('db:autoAssignFaces', { faceIds: targetFaceIds || [] });
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
                            loadClusteredFaces();
                            loadPeople();
                        } else {
                            setTimeout(() => {
                                showAlert({
                                    title: 'No Matches',
                                    description: 'No confident matches found.',
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

    const handleNameGroup = useCallback(async (ids: number[], name: string, confirm?: boolean) => {
        // Optimistic: Remove from clusters immediately
        const idsSet = new Set(ids)
        setClusters(prev => prev.map(c => ({
            ...c, // Preserve suggestion and other properties
            faces: c.faces.filter(id => !idsSet.has(id))
        })).filter(c => c.faces.length > 0))
        setSingles(prev => prev.filter(id => !idsSet.has(id)))
        setTotalFaces(prev => prev - ids.length)

        // Clear these from controller selection
        controller.removeFacesFromSelection(ids);

        // API Call - pass confirm flag if accepting a suggestion
        await autoNameFaces(ids, name, confirm)
        addToast({ type: 'success', description: `Named ${ids.length} faces.` })

        // Remove from ungroupable list if present
        setUngroupableFaces(prev => {
            if (prev.length === 0) return prev;
            const idsSet = new Set(ids);
            return prev.filter(id => !idsSet.has(id));
        });
    }, [autoNameFaces, addToast, setUngroupableFaces, controller.removeFacesFromSelection])

    const handleConfirmName = useCallback(async (selectedIds: number[], name: string) => {
        if (!name || selectedIds.length === 0) return
        setNamingGroup(null)
        // Manual naming is always confirmed
        await handleNameGroup(selectedIds, name, true)
    }, [handleNameGroup])

    const handleOpenNaming = useCallback(async (ids: number[]) => {
        try {
            const faces = await fetchFacesByIds(ids);
            setNamingGroup({ faces, name: '' });
        } catch (e) {
            console.error("Failed to load faces for naming", e);
            addToast({ type: 'error', description: 'Failed to load faces.' })
        }
    }, [fetchFacesByIds, addToast])

    const handleIgnoreGroup = useCallback((ids: number[]) => {
        showConfirm({
            title: 'Ignore Faces',
            description: `Ignore ${ids.length} faces? They will be hidden from unnamed faces.`,
            confirmLabel: 'Ignore',
            variant: 'danger',
            onConfirm: async () => {
                // Optimistic Update
                const idsSet = new Set(ids)
                setClusters(prev => prev.map(c => ({
                    ...c, // Preserve suggestion and other properties
                    faces: c.faces.filter(id => !idsSet.has(id))
                })).filter(c => c.faces.length > 0))
                setSingles(prev => prev.filter(id => !idsSet.has(id)))
                setTotalFaces(prev => prev - ids.length)

                controller.removeFacesFromSelection(ids);

                // Also remove from ungroupable list if present
                setUngroupableFaces(prev => {
                    if (prev.length === 0) return prev;
                    const idsSet = new Set(ids);
                    return prev.filter(id => !idsSet.has(id));
                });

                // @ts-ignore
                await window.ipcRenderer.invoke('db:ignoreFaces', ids)
                addToast({ type: 'success', description: `Ignored ${ids.length} faces.` })
            }
        })
    }, [showConfirm, addToast, controller.removeFacesFromSelection])

    const handleUngroup = useCallback((clusterIndex: number) => {
        // Warning: This index is likely from `filteredClusters`. 
        // We need to find the correct cluster in the main list or handle it via ID.
        // Legacy: ClusterList passed index from map.
        // New: `clusterIndex` passed from `ClusterList` is based on its display.
        // We should really handle this by cluster object reference or unique ID, but we don't strictly have IDs for DBSCAN clusters yet.
        // For now, let's assume specific cluster object matches.

        const cluster = controller.displayedClusters[clusterIndex];
        if (!cluster) return;

        const ids = cluster.faces;

        // Optimistic Update: Move from clusters to singles
        setClusters(prev => prev.filter(c => c !== cluster)); // Reference equality should work
        setSingles(prev => [...prev, ...ids]);

        controller.removeFacesFromSelection(ids);

        addToast({ type: 'info', description: `Ungrouped ${ids.length} faces` });

    }, [controller.displayedClusters, addToast, controller.removeFacesFromSelection]);

    const handleIgnoreAllGroups = useCallback(() => {
        // Ignore all VISIBLE (Filtered) or ALL?
        // Let's do ALL to be safe/consistent with old behavior, 
        // OR better: All Filtered.
        const targetClusters = controller.filteredClusters;

        if (targetClusters.length === 0) return;

        showConfirm({
            title: 'Ignore All Groups',
            description: `This will ignore ALL ${targetClusters.length} matching groups (${targetClusters.reduce((acc, c) => acc + c.faces.length, 0)} faces). They will be hidden.`,
            confirmLabel: 'Ignore All',
            variant: 'danger',
            onConfirm: async () => {
                const allIds: number[] = [];
                targetClusters.forEach(c => allIds.push(...c.faces));

                // Optimistic Clear
                // We must remove these specific clusters from the main list
                const targetSet = new Set(targetClusters);
                setClusters(prev => prev.filter(c => !targetSet.has(c)));

                setTotalFaces(prev => prev - allIds.length);
                controller.clearSelection();

                // API Call
                // @ts-ignore
                await window.ipcRenderer.invoke('db:ignoreFaces', allIds);
                addToast({ type: 'success', description: `Ignored all ${targetClusters.length} groups.` });
            }
        });
    }, [controller.filteredClusters, showConfirm, addToast, controller.clearSelection]);

    // Handle suggestion found by ClusterRow - update cluster so keyboard nav can access it
    const handleSuggestionFound = useCallback((index: number, suggestion: any) => {
        // This is tricky with filtering/virtualization. 
        // Ideal: Update the cluster data in place in the master list.
        // We need to find *which* cluster this is.
        // `index` here comes from `ClusterList` mapping `displayedClusters`.

        const targetCluster = controller.displayedClusters[index];
        if (!targetCluster) return;

        setClusters(prev => prev.map(c =>
            c === targetCluster ? { ...c, suggestion } : c
        ));
    }, [controller.displayedClusters]);

    return {
        // Expose Controller State
        ...controller,
        clusters: controller.displayedClusters, // Legacy name compat

        // Data & UI State
        singles,
        ungroupableFaces,
        totalFaces,
        totalUnassigned,
        isClustering,
        isAutoAssigning,
        namingGroup,
        setNamingGroup,

        // Actions
        loadClusteredFaces,
        handleAutoAssign,
        handleNameGroup,
        handleConfirmName,
        handleOpenNaming,
        handleIgnoreGroup,
        handleUngroup,
        handleIgnoreAllGroups,
        handleSuggestionFound,

        // Pagination Compat (Controller handles logic, we map props)
        displayedGroupCount: controller.displayedClusters.length,
        hasMoreGroups: controller.hasMore,
        remainingGroupCount: controller.remainingCount,
        loadMoreGroups: controller.loadMore,
        resetDisplayedCount: controller.resetPagination,
        totalGroupCount: controller.filteredClusters.length, // or allClusters.length based on view needs

        // Setters (Legacy compat, though mostly internal now)
        setClusters,
        setSingles,
        setUngroupableFaces,
        setTotalFaces,
        setSelectedFaceIds: controller.setSelectedFaceIds
    }
}
