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
}

const PeopleContext = createContext<PeopleContextType | undefined>(undefined)

export function PeopleProvider({ children }: { children: ReactNode }) {
    const [people, setPeople] = useState<Person[]>([])
    const [faces, setFaces] = useState<Face[]>([])
    const [loading, setLoading] = useState(false)

    const loadPeople = async () => {
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:getPeople')
            setPeople(result)
        } catch (e) {
            console.error("Failed to load people", e)
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
            // @ts-ignore
            await window.ipcRenderer.invoke('db:ignoreFaces', faceIds)
            setFaces(prev => prev.filter(f => !faceIds.includes(f.id)))
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

    const cosineDistance = (desc1: number[], desc2: number[]) => {
        if (desc1.length !== desc2.length) return 1.0;
        let dot = 0;
        let mag1 = 0;
        let mag2 = 0;
        for (let i = 0; i < desc1.length; i++) {
            dot += desc1[i] * desc2[i];
            mag1 += desc1[i] * desc1[i];
            mag2 += desc2[i] * desc2[i];
        }
        const magnitude = Math.sqrt(mag1) * Math.sqrt(mag2);
        if (magnitude === 0) return 1.0;
        return 1.0 - (dot / magnitude);
    }

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
                    // Fetch ALL unassigned descriptors from backend
                    // @ts-ignore
                    const candidates = await window.ipcRenderer.invoke('db:getAllUnassignedFaceDescriptors')

                    const matches = candidates.filter((c: any) => {
                        const dist = cosineDistance(namedFace.descriptor, c.descriptor);
                        // console.log('Distance:', dist);
                        return dist < 0.4 // Cosine Distance Threshold (0.4 means > 60% similarity)
                    }).map((c: any) => c.id)

                    console.log(`[PeopleContext] Found ${matches.length} similar faces.`);

                    if (matches.length > 0) {
                        return { similarFound: true, count: matches.length, matchIds: matches, name }
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
            ignoreFace, ignoreFaces, autoNameFaces
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
