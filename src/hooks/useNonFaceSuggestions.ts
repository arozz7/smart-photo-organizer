import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePeople } from '../context/PeopleContext'
import { useToast } from '../context/ToastContext'
import { useListSelection } from './useListSelection'

/** Faces loaded per page of the "Not a face (suggested)" list. */
export const PAGE_SIZE = 150

export interface NonFaceTile {
    faceId: number
    /** The detector's confidence that the box holds a face; the list is sorted by it, lowest first. */
    score: number
    quality: number | null
    blur: number | null
    /** Degrees; null when the pose is unknown. */
    yaw: number | null
    pitch: number | null
    box: { x: number; y: number; width: number; height: number }
    photoId: number
    filePath: string | null
    previewPath: string | null
    photoWidth: number | null
    photoHeight: number | null
    /** Model list only: the model's answer (higher means "no clear face visible"). */
    modelScore?: number
    /** Model list only: how likely (percent) it is that the box is not a face, which the list is sorted by. */
    likelihood?: number
}

export interface NonFaceCount {
    cutoff: number
    total: number
    /** How many of `total` are turned 45 degrees or more (real faces seen from the side). */
    turned: number
}

export type ListMode = 'detector' | 'model'

export interface ListCount {
    total: number
    /** How many of `total` are turned 45 degrees or more. */
    turned: number
}

export interface DetectorOverview {
    cutoff: number
    defaultCutoff: number
    minCutoff: number
    maxCutoff: number
    choices: NonFaceCount[]
}

export interface ModelChoice extends ListCount {
    likelihood: number
}

export interface ModelOverview {
    minLikelihood: number
    defaultLikelihood: number
    minAllowed: number
    maxAllowed: number
    choices: ModelChoice[]
    /** Uncertain faces the model has looked at, out of all that need it. */
    checked: number
    candidates: number
}

/** Details of the list now shown only: the other mode's are null. */
export interface NonFaceOverview {
    mode: ListMode
    current: ListCount
    detector: DetectorOverview | null
    model: ModelOverview | null
    ignoredFromList: number
    /** Whether Review Needed leaves out the faces of the list shown (on unless the user turned it off). */
    hideFromReview: boolean
    /** How many faces the list shown would hide: its faces except the turned ones, which stay in Review Needed. */
    hideable: number
    /** How many are hidden right now (`hideable`, or 0 when hiding is off). */
    hiddenFromReview: number
}

interface Response {
    success: boolean
    error?: string
    overview?: NonFaceOverview
    faces?: NonFaceTile[]
    ignoredIds?: number[]
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
 * The "Not a face (suggested)" list: faces the detector was unsure about. The overview (for the count on the tab) loads
 * with the page; the faces load when the list is opened. Nothing is ignored except what the user selects.
 */
export function useNonFaceSuggestions({ enabled, onReviewChanged }: { enabled: boolean; onReviewChanged?: () => void }) {
    const { loadFaces, loadPeople, refreshUnassignedCount } = usePeople()
    const { addToast } = useToast()

    const [overview, setOverview] = useState<NonFaceOverview | null>(null)
    const [tiles, setTiles] = useState<NonFaceTile[]>([])
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState(false)
    const tileIds = useMemo(() => tiles.map(tile => tile.faceId), [tiles])
    const { selectedIds, setSelectedIds, toggle, selectAllLoaded, selectNone, addToSelection } = useListSelection(tileIds)
    /** The faces the last "Ignore selected" ignored, so Undo restores exactly those. */
    const [undoBatch, setUndoBatch] = useState<number[] | null>(null)

    const fail = useCallback((what: string, error?: string) => {
        addToast({ type: 'error', description: `Could not ${what}: ${error ?? 'unknown error'}` })
    }, [addToast])

    const refreshOverview = useCallback(async () => {
        const response = await call('nonface:getOverview')
        if (response.success && response.overview) setOverview(response.overview)
    }, [])

    const reloadList = useCallback(async () => {
        setLoading(true)
        setSelectedIds(new Set())
        const response = await call('nonface:list', { offset: 0, limit: PAGE_SIZE })
        if (response.success && response.faces) setTiles(response.faces)
        else fail('load the list', response.error)
        setLoading(false)
    }, [fail, setSelectedIds])

    /** What Review Needed shows depends on this list (faces it hides), so its count and clusters are refreshed when the list changes. */
    const refreshReview = useCallback(() => {
        void refreshUnassignedCount()
        onReviewChanged?.()
    }, [refreshUnassignedCount, onReviewChanged])

    const refreshQueue = useCallback(() => {
        loadFaces({ unnamed: true })
        loadPeople()
        refreshReview()
    }, [loadFaces, loadPeople, refreshReview])

    useEffect(() => { void refreshOverview() }, [refreshOverview])
    useEffect(() => { if (enabled) void reloadList() }, [enabled, reloadList])

    /** Loads the next page and returns the ids of the faces it added. */
    const loadMore = useCallback(async (): Promise<number[]> => {
        if (loading) return []
        setLoading(true)
        const response = await call('nonface:list', { offset: tiles.length, limit: PAGE_SIZE })
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
    }, [loading, tiles, fail])

    /** Loads the next page and selects exactly the faces it added (the review flow: look through a page, then take the next one with it). */
    const loadMoreAndSelect = useCallback(async () => {
        addToSelection(await loadMore())
    }, [loadMore, addToSelection])


    const removeFromList = useCallback((faceIds: number[]) => {
        const gone = new Set(faceIds)
        setTiles(prev => prev.filter(tile => !gone.has(tile.faceId)))
    }, [])

    const ignoreSelected = useCallback(async () => {
        if (selectedIds.size === 0 || busy) return
        setBusy(true)
        const response = await call('nonface:ignore', { faceIds: [...selectedIds] })
        if (response.success && response.ignoredIds) {
            removeFromList(response.ignoredIds)
            setSelectedIds(new Set())
            setUndoBatch(response.ignoredIds.length > 0 ? response.ignoredIds : null)
            addToast({ type: 'success', description: `Ignored ${plural(response.ignoredIds.length)}` })
            void refreshOverview()
            refreshQueue()
        } else {
            fail('ignore the selected faces', response.error)
        }
        setBusy(false)
    }, [selectedIds, busy, removeFromList, addToast, fail, refreshOverview, refreshQueue, setSelectedIds])

    const keepSelected = useCallback(async () => {
        if (selectedIds.size === 0 || busy) return
        setBusy(true)
        const faceIds = [...selectedIds]
        const response = await call('nonface:keep', { faceIds })
        if (response.success) {
            removeFromList(faceIds)
            setSelectedIds(new Set())
            addToast({ type: 'success', description: `Kept ${plural(response.kept ?? faceIds.length)} in the review queue; they will not be suggested again` })
            void refreshOverview()
            refreshReview()
        } else {
            fail('keep the selected faces', response.error)
        }
        setBusy(false)
    }, [selectedIds, busy, removeFromList, addToast, fail, refreshOverview, refreshReview, setSelectedIds])

    const undoLast = useCallback(async () => {
        if (!undoBatch || busy) return
        setBusy(true)
        const response = await call('nonface:undo', { faceIds: undoBatch })
        if (response.success) {
            setUndoBatch(null)
            addToast({ type: 'success', description: `Returned ${plural(response.restoredIds?.length ?? 0)} to the review queue` })
            await Promise.all([reloadList(), refreshOverview()])
            refreshQueue()
        } else {
            fail('undo', response.error)
        }
        setBusy(false)
    }, [undoBatch, busy, addToast, fail, reloadList, refreshOverview, refreshQueue])

    /** Saves a list setting (cut-off, mode or likelihood), then shows the list from the start under the new setting. */
    const change = useCallback(async (what: string, channel: string, payload: unknown) => {
        if (busy) return
        setBusy(true)
        const response = await call(channel, payload)
        if (response.success && response.overview) {
            setOverview(response.overview)
            setUndoBatch(null)
            await reloadList()
        } else {
            fail(what, response.error)
        }
        setBusy(false)
    }, [busy, fail, reloadList])

    const setCutoff = useCallback((cutoff: number) => change('change the cut-off', 'nonface:setCutoff', { cutoff }), [change])
    const setMode = useCallback((mode: ListMode) => change('change the list', 'nonface:setMode', { mode }), [change])
    const setLikelihood = useCallback((percent: number) => change('change the likelihood', 'nonface:setLikelihood', { percent }), [change])

    /** Whether Review Needed hides the faces of this list. The list itself does not change; Review Needed does. */
    const setHideFromReview = useCallback(async (hide: boolean) => {
        if (busy) return
        setBusy(true)
        const response = await call('nonface:setHide', { hide })
        if (response.success && response.overview) {
            setOverview(response.overview)
            refreshReview()
        } else {
            fail('change what Review Needed shows', response.error)
        }
        setBusy(false)
    }, [busy, fail, refreshReview])

    return {
        overview,
        tiles,
        total: overview?.current.total ?? 0,
        hasMore: tiles.length < (overview?.current.total ?? 0),
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
        keepSelected,
        undoLast,
        setCutoff,
        setMode,
        setLikelihood,
        setHideFromReview,
    }
}

export type NonFaceSuggestionsController = ReturnType<typeof useNonFaceSuggestions>
