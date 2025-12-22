import { createContext, useContext, useState, ReactNode } from 'react'

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
    descriptor: number[]
    file_path: string
    preview_cache_path?: string
    person_name?: string
    width?: number
    height?: number
}

interface PeopleContextType {
    people: Person[]
    faces: Face[]
    loading: boolean
    loadPeople: () => Promise<void>
    loadFaces: (filter?: any) => Promise<void>
    assignPerson: (faceId: number, name: string) => Promise<any>
    ignoreFace: (faceId: number) => Promise<void>
    ignoreFaces: (faceIds: number[]) => Promise<void>
    autoNameFaces: (faceIds: number[], name: string) => Promise<void>
    rebuildIndex: () => Promise<{ success: boolean; count?: number; error?: string }>
}

const PeopleContext = createContext<PeopleContextType | undefined>(undefined)

export function PeopleProvider({ children }: { children: ReactNode }) {
    const [people, setPeople] = useState<Person[]>([])
    const [faces, setFaces] = useState<Face[]>([])
    const [loading, setLoading] = useState(false)

    const loadPeople = async () => {
        setLoading(true)
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:getPeople')
            setPeople(result)
        } catch (e) {
            console.error("Failed to load people", e)
        } finally {
            setLoading(false)
        }
    }

    const loadFaces = async (filter: any = {}) => {
        setLoading(true)
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:getAllFaces', { limit: 2000, filter })
            setFaces(result)
        } catch (e) {
            console.error("Failed to load faces", e)
        } finally {
            setLoading(false)
        }
    }

    const ignoreFace = async (faceId: number) => {
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:ignoreFace', faceId)
            // Remove from local state immediately
            setFaces(prev => prev.filter(f => f.id !== faceId))
        } catch (e) {
            console.error("Failed to ignore face", e)
        }
    }

    const ignoreFaces = async (faceIds: number[]) => {
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
        } catch (e) {
            console.error("Failed to ignore faces", e)
        }
    }

    const autoNameFaces = async (faceIds: number[], name: string) => {
        try {
            for (const id of faceIds) {
                // @ts-ignore
                await window.ipcRenderer.invoke('db:assignPerson', { faceId: id, personName: name })
            }
            await loadPeople()
            setFaces(prev => prev.filter(f => !faceIds.includes(f.id)))
        } catch (e) {
            console.error("Failed to auto name faces", e)
        }
    }


    const rebuildIndex = async () => {
        // @ts-ignore
        const res = await window.ipcRenderer.invoke('ai:rebuildIndex');
        if (res.success) {
            console.log(`[PeopleContext] Index rebuilt with ${res.count} vectors.`);
        }
        return res;
    };

    const assignPerson = async (faceId: number, name: string) => {
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
    }

    return (
        <PeopleContext.Provider value={{
            people, faces, loading,
            loadPeople, loadFaces, assignPerson,
            ignoreFace, ignoreFaces, autoNameFaces,
            rebuildIndex
        }}>
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
