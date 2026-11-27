import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePeople } from '../context/PeopleContext'
import { useToast } from '../context/ToastContext'
import { useListSelection } from './useListSelection'

/** Faces loaded per page of the Doubtful faces list. */
export const PAGE_SIZE = 100
/** How often the counts are reloaded while the list is open (the background check keeps scoring faces). */
export const OVERVIEW_REFRESH_MS = 30_000

export interface DoubtfulTile {
    faceId: number
    /** The model's answer (higher means "no clear face visible"); the list is sorted by it, highest first. */
    score: number
    quality: number | null
    blur: number | null
    yaw: number | null
    box: { x: number; y: number; width: number; height: number }
    photoId: number
    filePath: string | null
    previewPath: string | null
    photoWidth: number | null
    photoHeight: number | null
    personId: number
    personName: string | null
    /** How the face was given to the person. */
    source: string | null
    confirmed: boolean
}

export interface DoubtfulPerson {
    personId: number
    name: string | null
    count: number
}

export interface DoubtfulOverview {
    minScore: number
    defaultMinScore: number
    minAllowed: number
    maxAllowed: number
    choices: { score: number; total: number }[]
    /** The list at the chosen cut-off. */
    current: { total: number }
    people: DoubtfulPerson[]
    checked: number
    candidates: number
    /** Faces this list changed that could still be undone. */
    changed: number
}

/** What the last change did, so Undo returns exactly those faces. */
export interface UndoBatch {
    kind: 'ignore' | 'unassign'
    faceIds: number[]
}

interface Response {
    success: boolean
    error?: string
    overview?: DoubtfulOverview
    faces?: DoubtfulTile[]
    changedIds?: number[]
    kept?: number
    restoredIds?: number[]
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

async function call(channel: string, payload?: unknown): Promise<Response> {
    try {
        return (await window.ipcRenderer.invoke(channel, payload)) as Response
    } catch (error) {
        return { success: false, error: errorText(error) }
    }
}

const plural = (count: number) => `${count} ${count === 1 ? 'face' : 'faces'}`

/**
 * The Doubtful faces list: faces already assigned to a person that the vision model finds show no clear face. The overview (for the count on the
 * tab) loads with the page; the faces load when the list is opened. Nothing changes except what the user selects. A face that leaves its person
 * or comes back changes Review Needed and the people, so those are refreshed (`onReviewChanged` marks Review Needed out of date).
 */
export function useDoubtfulFaces({ enabled, onReviewChanged }: { enabled: boolean; onReviewChanged?: () => void }) {
    const { loadFaces, loadPeople, refreshUnassignedCount } = usePeople()
    const { addToast } = useToast()

    const [overview, setOverview] = useState<DoubtfulOverview | null>(null)
    const [tiles, setTiles] = useState<DoubtfulTile[]>([])
    const [personId, setPersonId] = useState<number | null>(null)
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState(false)
    const tileIds = useMemo(() => tiles.map(tile => tile.faceId), [tiles])
    const { selectedIds, setSelectedIds, toggle, selectAllLoaded, selectNone, addToSelection } = useListSelection(tileIds)
    const [undoBatch, setUndoBatch] = useState<UndoBatch | null>(null)

    const fail = useCallback((what: string, error?: string) => {
        addToast({ type: 'error', description: `Could not ${what}: ${error ?? 'unknown error'}` })
    }, [addToast])

    const refreshOverview = useCallback(async () => {
        const response = await call('doubtful:getOverview')
        if (response.success && response.overview) setOverview(response.overview)
    }, [])

    const reloadList = useCallback(async (person: number | null) => {
        setLoading(true)
        setSelectedIds(new Set())
        const response = await call('doubtful:list', { offset: 0, limit: PAGE_SIZE, personId: person })
        if (response.success && response.faces) setTiles(response.faces)
        else fail('load the list', response.error)
        setLoading(false)
    }, [fail, setSelectedIds])

    const refreshQueue = useCallback(() => {
        loadFaces({ unnamed: true })
        loadPeople()
        void refreshUnassignedCount()
        onReviewChanged?.()
    }, [loadFaces, loadPeople, refreshUnassignedCount, onReviewChanged])

    useEffect(() => { void refreshOverview() }, [refreshOverview, enabled])
    useEffect(() => {
        if (!enabled) return
        const timer = setInterval(() => { void refreshOverview() }, OVERVIEW_REFRESH_MS)
        return () => clearInterval(timer)
    }, [enabled, refreshOverview])
    useEffect(() => { if (enabled) void reloadList(personId) }, [enabled, reloadList, personId])

    /** Loads the next page and returns the ids of the faces it added. */
    const loadMore = useCallback(async (): Promise<number[]> => {
        if (loading) return []
        setLoading(true)
        const response = await call('doubtful:list', { offset: tiles.length, limit: PAGE_SIZE, personId })
        let added: number[] = []
        if (response.success && response.faces) {
            const shown = new Set(tiles.map(tile => tile.faceId))
            const fresh = response.faces.filter(face => !shown.has(face.faceId))
            added = fresh.map(face => face.faceId)
            setTiles(prev => [...prev, ...fresh])
        } else {
            fail('load more faces', response.error)
        }
        setLoading(false)
        return added
    }, [loading, tiles, personId, fail])

    /** Loads the next page and selects exactly the faces it added. */
    const loadMoreAndSelect = useCallback(async () => {
        addToSelection(await loadMore())
    }, [loadMore, addToSelection])

    const removeFromList = useCallback((faceIds: number[]) => {
        const gone = new Set(faceIds)
        setTiles(prev => prev.filter(tile => !gone.has(tile.faceId)))
    }, [])

    /** Takes the selected faces out of their person (ignored, or back to suggestions); both can be undone. */
    const changeSelected = useCallback(async (kind: UndoBatch['kind']) => {
        if (selectedIds.size === 0 || busy) return
        setBusy(true)
        const response = await call(`doubtful:${kind}`, { faceIds: [...selectedIds] })
        if (response.success && response.changedIds) {
            removeFromList(response.changedIds)
            setSelectedIds(new Set())
            setUndoBatch(response.changedIds.length > 0 ? { kind, faceIds: response.changedIds } : null)
            addToast({
                type: 'success',
                description: kind === 'ignore' ? `Ignored ${plural(response.changedIds.length)} as not faces` : `Moved ${plural(response.changedIds.length)} back to suggestions`,
            })
            void refreshOverview()
            refreshQueue()
        } else {
            fail(kind === 'ignore' ? 'ignore the selected faces' : 'move the selected faces back to suggestions', response.error)
        }
        setBusy(false)
    }, [selectedIds, busy, removeFromList, addToast, fail, refreshOverview, refreshQueue, setSelectedIds])

    const ignoreSelected = useCallback(() => changeSelected('ignore'), [changeSelected])
    const unassignSelected = useCallback(() => changeSelected('unassign'), [changeSelected])

    const keepSelected = useCallback(async () => {
        if (selectedIds.size === 0 || busy) return
        setBusy(true)
        const faceIds = [...selectedIds]
        const response = await call('doubtful:keep', { faceIds })
        if (response.success) {
            removeFromList(faceIds)
            setSelectedIds(new Set())
            addToast({ type: 'success', description: `Kept ${plural(response.kept ?? faceIds.length)} with their person; they will not be suggested again` })
            void refreshOverview()
        } else {
            fail('keep the selected faces', response.error)
        }
        setBusy(false)
    }, [selectedIds, busy, removeFromList, addToast, fail, refreshOverview, setSelectedIds])

    const undoLast = useCallback(async () => {
        if (!undoBatch || busy) return
        setBusy(true)
        const response = await call('doubtful:undo', { faceIds: undoBatch.faceIds })
        if (response.success) {
            setUndoBatch(null)
            addToast({ type: 'success', description: `Gave back ${plural(response.restoredIds?.length ?? 0)} as they were` })
            await Promise.all([reloadList(personId), refreshOverview()])
            refreshQueue()
        } else {
            fail('undo', response.error)
        }
        setBusy(false)
    }, [undoBatch, busy, personId, addToast, fail, reloadList, refreshOverview, refreshQueue])

    /** Shows the faces of one person (null: everyone). The list reloads under the new choice. */
    const setPerson = useCallback(async (person: number | null) => {
        setUndoBatch(null)
        setPersonId(person)
    }, [])

    /** Saves the cut-off, then shows the list from the start under it. */
    const setMinScore = useCallback(async (score: number) => {
        if (busy) return
        setBusy(true)
        const response = await call('doubtful:setMinScore', { score })
        if (response.success && response.overview) {
            setOverview(response.overview)
            setUndoBatch(null)
            await reloadList(personId)
        } else {
            fail('change the cut-off', response.error)
        }
        setBusy(false)
    }, [busy, personId, fail, reloadList])

    return {
        overview,
        tiles,
        personId,
        total: overview?.current.total ?? 0,
        hasMore: tiles.length < (overview?.current.total ?? 0) && personId === null,
        loading,
        busy,
        selectedIds,
        undoBatch,
        loadMore,
        loadMoreAndSelect,
        toggle,
        selectAllLoaded,
        selectNone,
        ignoreSelected,
        unassignSelected,
        keepSelected,
        undoLast,
        setPerson,
        setMinScore,
    }
}

export type DoubtfulFacesController = ReturnType<typeof useDoubtfulFaces>
