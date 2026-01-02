import { useState, useCallback } from 'react'
import { usePeople } from '../context/PeopleContext'
// import { useAI } from '../context/AIContext' // Unused
import { useAlert } from '../context/AlertContext'
import { useToast } from '../context/ToastContext'
import { Face } from '../types'

export function usePeopleCluster() {
    const { loadPeople, loadUnnamedFaces, autoNameFaces, fetchFacesByIds } = usePeople()
    // const { addToQueue } = useAI() // Unused
    const { showAlert, showConfirm } = useAlert()
    const { addToast } = useToast()

    // Clustering State
    const [clusters, setClusters] = useState<{ faces: number[] }[]>([])
    const [singles, setSingles] = useState<number[]>([])
    const [totalFaces, setTotalFaces] = useState(0)
    const [isClustering, setIsClustering] = useState(false)
    const [isAutoAssigning, setIsAutoAssigning] = useState(false);

    // Selection State
    const [selectedFaceIds, setSelectedFaceIds] = useState<Set<number>>(new Set())

    // Group Naming Modal State
    const [namingGroup, setNamingGroup] = useState<{ faces: Face[], name: string } | null>(null)

    const loadClusteredFaces = useCallback(async (options?: { threshold?: number, min_samples?: number }) => {
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

            const finalOptions = {
                ...options,
                threshold: finalThreshold
            };

            const res = await loadUnnamedFaces(finalOptions)
            if (res) {
                // Sort clusters by size (descending)
                const sortedClusters = res.clusters.sort((a: any, b: any) => b.length - a.length).map((ids: number[]) => ({ faces: ids }));
                setClusters(sortedClusters)
                setSingles(res.singles)

                const clusterCount = res.clusters.reduce((acc: number, c: any) => acc + c.length, 0);
                setTotalFaces(clusterCount + res.singles.length);
            }
        } catch (e) {
            console.error("Failed to load clusters", e)
        } finally {
            setIsClustering(false)
        }
    }, [loadUnnamedFaces])

    const toggleFace = useCallback((id: number) => {
        const newSet = new Set(selectedFaceIds)
        if (newSet.has(id)) newSet.delete(id)
        else newSet.add(id)
        setSelectedFaceIds(newSet)
    }, [selectedFaceIds])

    const toggleGroup = useCallback((ids: number[]) => {
        const newSet = new Set(selectedFaceIds)
        const allSelected = ids.every(id => newSet.has(id))

        if (allSelected) {
            ids.forEach(id => newSet.delete(id))
        } else {
            ids.forEach(id => newSet.add(id))
        }
        setSelectedFaceIds(newSet)
    }, [selectedFaceIds])

    const clearSelection = useCallback(() => setSelectedFaceIds(new Set()), [])

    const handleAutoAssign = async () => {
        if (totalFaces === 0) return;

        showConfirm({
            title: 'Auto-Identify All Faces',
            description: `This will cross-check ALL unassigned faces in your library against your identified people. This may take a while depending on the number of faces.`,
            confirmLabel: 'Run Auto-Identify All',
            onConfirm: async () => {
                console.log("[People] User confirmed Auto-Identify All. Starting...");
                setIsAutoAssigning(true);
                try {
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
                            loadClusteredFaces();
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

    const handleNameGroup = useCallback(async (ids: number[], name: string) => {
        // Optimistic: Remove from clusters immediately
        const idsSet = new Set(ids)
        setClusters(prev => prev.map(c => ({
            faces: c.faces.filter(id => !idsSet.has(id))
        })).filter(c => c.faces.length > 0))
        setSingles(prev => prev.filter(id => !idsSet.has(id)))
        setTotalFaces(prev => prev - ids.length)
        setSelectedFaceIds(prev => {
            const next = new Set(prev)
            ids.forEach(id => next.delete(id))
            return next
        })

        // API Call
        await autoNameFaces(ids, name)
        addToast({ type: 'success', description: `Named ${ids.length} faces.` })
    }, [autoNameFaces, addToast])

    const handleConfirmName = useCallback(async (selectedIds: number[], name: string) => {
        if (!name || selectedIds.length === 0) return
        setNamingGroup(null)
        await handleNameGroup(selectedIds, name)
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
                    faces: c.faces.filter(id => !idsSet.has(id))
                })).filter(c => c.faces.length > 0))
                setSingles(prev => prev.filter(id => !idsSet.has(id)))
                setTotalFaces(prev => prev - ids.length)
                setSelectedFaceIds(prev => {
                    const next = new Set(prev)
                    ids.forEach(id => next.delete(id))
                    return next
                })

                // @ts-ignore
                await window.ipcRenderer.invoke('db:ignoreFaces', ids)
                addToast({ type: 'success', description: `Ignored ${ids.length} faces.` })
            }
        })
    }, [showConfirm, addToast])

    const handleUngroup = useCallback((clusterIndex: number) => {
        const cluster = clusters[clusterIndex];
        if (!cluster) return;

        const ids = cluster.faces;

        // Optimistic Update: Move from clusters to singles
        setClusters(prev => prev.filter((_, idx) => idx !== clusterIndex));
        setSingles(prev => [...prev, ...ids]);

        // Clean up selection if any of these were selected
        setSelectedFaceIds(prev => {
            const next = new Set(prev);
            let changed = false;
            ids.forEach(id => {
                if (next.has(id)) {
                    next.delete(id);
                    changed = true;
                }
            });
            return changed ? next : prev;
        });

        addToast({ type: 'info', description: `Ungrouped ${ids.length} faces` });

    }, [clusters, addToast]);

    const handleIgnoreAllGroups = useCallback(() => {
        if (clusters.length === 0) return;

        showConfirm({
            title: 'Ignore All Groups',
            description: `This will ignore ALL ${clusters.length} currently visible groups (${clusters.reduce((acc, c) => acc + c.faces.length, 0)} faces). They will be hidden.`,
            confirmLabel: 'Ignore All',
            variant: 'danger',
            onConfirm: async () => {
                const allIds: number[] = [];
                clusters.forEach(c => allIds.push(...c.faces));

                // Optimistic Clear
                setClusters([]);
                setTotalFaces(prev => prev - allIds.length);
                setSelectedFaceIds(new Set()); // Clear all selection

                // API Call
                // @ts-ignore
                await window.ipcRenderer.invoke('db:ignoreFaces', allIds);
                addToast({ type: 'success', description: `Ignored all ${clusters.length} groups.` });
            }
        });
    }, [clusters, showConfirm, addToast]);

    return {
        clusters,
        singles,
        totalFaces,
        isClustering,
        isAutoAssigning,
        selectedFaceIds,
        namingGroup,
        setNamingGroup,
        loadClusteredFaces,
        toggleFace,
        toggleGroup,
        clearSelection,
        handleAutoAssign,
        handleNameGroup,
        handleConfirmName,
        handleOpenNaming,
        handleIgnoreGroup,
        handleUngroup,
        handleIgnoreAllGroups,
        setClusters, // Exposed in case view needs manual manipulation, though ideally avoided
        setSingles,
        setTotalFaces,
        setSelectedFaceIds
    }
}
