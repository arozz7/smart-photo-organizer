import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react'

interface Person {
    id: number
    name: string
    face_count: number
}

interface Face {
    id: number
    photo_id: number
    person_id: number | null
    box: { x: number, y: number, width: number, height: number }
    descriptor?: number[] // Optional now for performance
    file_path: string
    preview_cache_path?: string
    person_name?: string
    width?: number
    height?: number
    face_quality?: number
    match_distance?: number
}

interface PeopleContextType {
    people: Person[]
    faces: Face[]
    loading: boolean
    loadPeople: () => Promise<void>
    loadFaces: (filter?: any) => Promise<void>
    loadUnnamedFaces: (options?: { threshold?: number, min_samples?: number, excludeBackground?: boolean, groupBySuggestion?: boolean }) => Promise<{ clusters: number[][], singles: number[], totalUnassigned?: number, clusterSuggestions?: Map<number, number> }>
    fetchFacesByIds: (ids: number[]) => Promise<Face[]>
    assignPerson: (faceId: number, name: string) => Promise<any>
    ignoreFace: (faceId: number) => Promise<void>
    ignoreFaces: (faceIds: number[]) => Promise<void>
    autoNameFaces: (faceIds: number[], name: string, confirm?: boolean) => Promise<void>
    rebuildIndex: () => Promise<{ success: boolean; count?: number; error?: string }>
    matchFace: (descriptor: any, options?: any) => Promise<any>
    matchBatch: (descriptors: any[], options?: any) => Promise<any[]>
    smartIgnoreSettings: SmartIgnoreSettings | null
    updateSmartIgnoreSettings: (settings: Partial<SmartIgnoreSettings>) => Promise<void>
    // Stats & Indexing
    rebuildFaissIndex: () => Promise<{ success: boolean; count?: number; error?: string } | void>
    isRebuildingIndex: boolean
    faissStaleCount: number


    getUnassignedCount: () => Promise<number>
    unassignedCount: number
    refreshUnassignedCount: () => Promise<void>
}

export interface SmartIgnoreSettings {
    minPhotoAppearances: number;
    maxClusterSize: number;
    centroidDistanceThreshold: number;
    outlierThreshold: number;
    autoAssignThreshold: number;
    reviewThreshold: number;
    enableAutoTiering: boolean;
    enableAiSuggestions: boolean;
    aiSuggestionThreshold: number;
    ungroupableDistanceThreshold: number; // Faces farther than this from any named person go to Ungroupable
}

const PeopleContext = createContext<PeopleContextType | undefined>(undefined)

export function PeopleProvider({ children }: { children: ReactNode }) {
    const [people, setPeople] = useState<Person[]>([])
    const [faces, setFaces] = useState<Face[]>([])
    const [loading, setLoading] = useState(false)
    const [smartIgnoreSettings, setSmartIgnoreSettings] = useState<SmartIgnoreSettings | null>(null)

    const [isRebuildingIndex, setIsRebuildingIndex] = useState(false)
    const [faissStaleCount, setFaissStaleCount] = useState(0) // TODO: Sync with backend stats
    const [unassignedCount, setUnassignedCount] = useState(0)

    const loadSmartIgnoreSettings = useCallback(async () => {
        try {
            // @ts-ignore
            const s = await window.ipcRenderer.invoke('settings:getSmartIgnoreSettings');
            setSmartIgnoreSettings(s);
        } catch (e) {
            console.error("Failed to load smart ignore settings", e);
        }
    }, []);

    const updateSmartIgnoreSettings = useCallback(async (settings: Partial<SmartIgnoreSettings>) => {
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('settings:updateSmartIgnoreSettings', settings);
            setSmartIgnoreSettings(prev => prev ? { ...prev, ...settings } : null);
        } catch (e) {
            console.error("Failed to update smart ignore settings", e);
        }
    }, []);

    // Load settings on mount
    React.useEffect(() => {
        loadSmartIgnoreSettings();
    }, [loadSmartIgnoreSettings]);

    const syncFaissStatus = useCallback(async () => {
        try {
            // @ts-ignore
            const count = await window.ipcRenderer.invoke('ai:getFaissStaleCount');
            setFaissStaleCount(count);
        } catch (e) {
            console.error('[PeopleContext] Failed to sync FAISS status:', e);
        }
    }, []);

    const rebuildIndex = useCallback(async () => {
        setIsRebuildingIndex(true)
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('ai:rebuildIndex');
            // Check result format
            if (res.success) {
                console.log(`[PeopleContext] Index rebuilt with ${res.count} vectors.`);
            }
            await syncFaissStatus(); // Refresh status after rebuild (should be 0)
            return res;
        } catch (e) {
            console.error("Failed to rebuild index", e)
            return { success: false, error: String(e) }
        } finally {
            setIsRebuildingIndex(false)
        }
    }, [syncFaissStatus]);

    const rebuildFaissIndex = useCallback(async () => {
        return await rebuildIndex();
    }, [rebuildIndex]);

    const loadPeople = useCallback(async () => {
        setLoading(true)
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:getPeople')
            setPeople(result)
            syncFaissStatus(); // Sync FAISS status whenever we reload people (common refresh point)
        } catch (e) {
            console.error("Failed to load people", e)
        } finally {
            setLoading(false)
        }
    }, [syncFaissStatus])

    const refreshUnassignedCount = useCallback(async () => {
        try {
            // @ts-ignore
            const count = await window.ipcRenderer.invoke('ai:getUnassignedCount');
            setUnassignedCount(count);
        } catch (e) {
            console.error('[PeopleContext] Failed to refresh unassigned count:', e);
        }
    }, []);

    // Initial Sync
    React.useEffect(() => {
        syncFaissStatus();
        refreshUnassignedCount();
    }, [syncFaissStatus, refreshUnassignedCount]);

    const loadFaces = useCallback(async (filter: any = {}) => {
        setLoading(true)
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:getAllFaces', { limit: 2000, filter }) // Keep this for "All Faces"
            setFaces(result)
        } catch (e) {
            console.error("Failed to load faces", e)
        } finally {
            setLoading(false)
        }
    }, [])

    const loadUnnamedFaces = useCallback(async (options?: { threshold?: number, min_samples?: number, excludeBackground?: boolean, groupBySuggestion?: boolean }) => {
        try {
            // New Architecture: fetch CLUSTERS (IDs only)
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('ai:getClusteredFaces', options)
            // result = { clusters: [[id...], ...], singles: [id...] }
            return result;
        } catch (e) {
            console.error(e);
            return { clusters: [], singles: [] };
        }
    }, [])

    const getUnassignedCount = useCallback(async () => {
        try {
            // @ts-ignore
            return await window.ipcRenderer.invoke('ai:getUnassignedCount');
        } catch (e) {
            console.error(e);
            return 0;
        }
    }, []);

    const fetchFacesByIds = useCallback(async (ids: number[]) => {
        try {
            // Batching to prevent SQLite variable limit (999)
            const BATCH_SIZE = 900;
            const results: Face[] = [];

            for (let i = 0; i < ids.length; i += BATCH_SIZE) {
                const batch = ids.slice(i, i + BATCH_SIZE);
                // @ts-ignore
                const batchResult = await window.ipcRenderer.invoke('db:getFacesByIds', batch);
                if (Array.isArray(batchResult)) {
                    results.push(...batchResult);
                } else if (batchResult && batchResult.success && Array.isArray(batchResult.faces)) {
                    results.push(...batchResult.faces);
                }
            }
            return results;
        } catch (e) {
            console.error("Failed to fetch faces by IDs", e);
            return [];
        }
    }, [])



    const ignoreFace = useCallback(async (faceId: number) => {
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:ignoreFace', faceId)
            // Remove from local state immediately
            setFaces(prev => prev.filter(f => f.id !== faceId))
            refreshUnassignedCount()
        } catch (e) {
            console.error("Failed to ignore face", e)
        }
    }, [refreshUnassignedCount])



    const ignoreFaces = useCallback(async (faceIds: number[]) => {
        try {
            console.log(`[PeopleContext] Ignoring ${faceIds.length} faces:`, faceIds);
            // @ts-ignore
            await window.ipcRenderer.invoke('db:ignoreFaces', faceIds)
            setFaces(prev => {
                const next = prev.filter(f => !faceIds.includes(f.id));
                console.log(`[PeopleContext] Local faces update: Prev=${prev.length}, Next=${next.length}`);
                if (next.length === prev.length) return prev; // No change, keep reference
                return next;
            })
            refreshUnassignedCount()
        } catch (e) {
            console.error("Failed to ignore faces", e)
        }
    }, [refreshUnassignedCount])



    const autoNameFaces = useCallback(async (faceIds: number[], name: string, confirm?: boolean) => {
        try {
            // Use batch handler for efficiency
            // Pass confirm flag to set is_confirmed when accepting suggestions
            // @ts-ignore
            await window.ipcRenderer.invoke('db:reassignFaces', { faceIds, personName: name, confirm })

            await loadPeople()
            setFaces(prev => prev.filter(f => !faceIds.includes(f.id)))
            refreshUnassignedCount()
        } catch (e) {
            console.error("Failed to auto name faces", e)
        }
    }, [loadPeople, refreshUnassignedCount])




    const matchFace = useCallback(async (descriptor: any, options?: any) => {
        // @ts-ignore
        return await window.ipcRenderer.invoke('ai:matchFace', { descriptor, options });
    }, []);

    const matchBatch = useCallback(async (descriptors: any[], options?: any) => {
        // @ts-ignore
        return await window.ipcRenderer.invoke('ai:matchBatch', { descriptors, options });
    }, []);



    const assignPerson = useCallback(async (faceId: number, name: string) => {
        try {
            console.log('[PeopleContext] Assigning person:', { faceId, name });
            const namedFace = faces.find(f => f.id === faceId); // Capture before removal

            // 1. Assign the target face
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:assignPerson', { faceId, personName: name })

            if (result.success) {
                // Remove assigned face from local list
                setFaces(prev => prev.filter(f => f.id !== faceId))
                await loadPeople() // Refresh people count
                refreshUnassignedCount()

                // 2. Smart Naming: Find similar faces
                if (namedFace && namedFace.descriptor) {
                    try {
                        // Use highly performance FAISS search via Python
                        // @ts-ignore
                        const searchResult = await window.ipcRenderer.invoke('ai:command', {
                            type: 'search_index',
                            payload: {
                                descriptor: namedFace.descriptor,
                                k: 50,
                                threshold: 0.5 // L2 distance threshold (normalized). 0.5 is fairly inclusive.
                            }
                        });


                        if (searchResult && searchResult.matches && searchResult.matches.length > 0) {
                            const matchIds = searchResult.matches
                                .filter((m: any) => m.id !== faceId) // Don't match self
                                .map((m: any) => m.id);

                            if (matchIds.length > 0) {
                                console.log(`[PeopleContext] FAISS found ${matchIds.length} similar faces.`);
                                return {
                                    similarFound: true,
                                    count: matchIds.length,
                                    matchIds: matchIds,
                                    name
                                };
                            }
                        }
                    } catch (err) {
                        console.error("[PeopleContext] FAISS Search Failed:", err);
                        // Fallback logic could go here, but better to fix search.
                    }
                }
            }
        } catch (e) {
            console.error("Failed to assign person", e)
        }
    }, [faces, loadPeople])


    const findUngroupableFaces = useCallback(async (distanceThreshold: number = 1.0) => {
        try {
            // @ts-ignore
            return await window.ipcRenderer.invoke('ai:findUngroupableFaces', { distanceThreshold });
        } catch (e) {
            console.error("Failed to find ungroupable faces", e);
            return { success: false, ungroupable_ids: [] };
        }
    }, [])

    const value = React.useMemo(() => ({
        people, faces, loading,
        loadPeople, loadFaces, loadUnnamedFaces,
        getUnassignedCount, fetchFacesByIds, assignPerson,
        ignoreFace, ignoreFaces, autoNameFaces,
        rebuildIndex,
        matchFace, matchBatch,
        findUngroupableFaces,
        smartIgnoreSettings, updateSmartIgnoreSettings,
        // Stats & Indexing
        rebuildFaissIndex,
        isRebuildingIndex,
        faissStaleCount,
        unassignedCount, refreshUnassignedCount
    }), [
        people, faces, loading, matchFace, matchBatch, smartIgnoreSettings, updateSmartIgnoreSettings,
        rebuildFaissIndex, isRebuildingIndex, faissStaleCount, unassignedCount,
        loadPeople, loadFaces, loadUnnamedFaces, fetchFacesByIds, assignPerson,
        ignoreFace, ignoreFaces, autoNameFaces, rebuildIndex, findUngroupableFaces,
        refreshUnassignedCount
    ])

    return (
        <PeopleContext.Provider value={value}>
            {children}
        </PeopleContext.Provider>
    )
}

export function usePeople() {
    const context = useContext(PeopleContext)
    if (context === undefined) {
        throw new Error('usePeople must be used within a PeopleProvider')
    }
    return context
}
