import { useState } from 'react'

export interface LibraryMetadataHook {
    availableTags: any[]
    availableFolders: any[]
    availablePeople: any[]
    loadTags: () => Promise<void>
    loadFolders: () => Promise<void>
    loadPeople: () => Promise<void>
}

export function useLibraryMetadata(): LibraryMetadataHook {
    const [availableTags, setAvailableTags] = useState<any[]>([])
    const [availableFolders, setAvailableFolders] = useState<any[]>([])
    const [availablePeople, setAvailablePeople] = useState<any[]>([])

    const loadTags = async () => {
        try {
            // @ts-ignore
            const tags = await window.ipcRenderer.invoke('db:getAllTags')
            setAvailableTags(tags)
        } catch (e) {
            console.error('Failed to load tags', e)
        }
    }

    const loadFolders = async () => {
        try {
            // @ts-ignore
            const folders = await window.ipcRenderer.invoke('db:getFolders')
            setAvailableFolders(folders)
        } catch (e) {
            console.error('Failed to load folders', e)
        }
    }

    const loadPeople = async () => {
        try {
            // @ts-ignore
            const people = await window.ipcRenderer.invoke('db:getPeople')
            setAvailablePeople(people)
        } catch (e) {
            console.error('Failed to load people', e)
        }
    }

    return {
        availableTags,
        availableFolders,
        availablePeople,
        loadTags,
        loadFolders,
        loadPeople
    }
}
