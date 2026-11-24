import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePeople } from '../context/PeopleContext'
import { useToast } from '../context/ToastContext'
import { useListSelection } from './useListSelection'

/** Faces loaded per page of the Pictures? list. */
export const PAGE_SIZE = 100
/** How often the counts are reloaded while the list is open (the background check keeps scoring faces). */
export const OVERVIEW_REFRESH_MS = 30_000

export type PictureList = 'unassigned' | 'assigned'

export interface PictureTile {
    faceId: number
    /** The model's answer (higher means more picture-like); the list is sorted by it, highest first. */
    score: number
    /** Percent: how likely it is that the face is only a picture. */
    likelihood: number
    quality: number | null
    blur: number | null
    yaw: number | null
    box: { x: number; y: number; width: number; height: number }
    photoId: number
    filePath: string | null
    previewPath: string | null
    photoWidth: number | null
    photoHeight: number | null
    /** Assigned faces only: the person and how the face was given to them. */
    personId: number | null
    personName: string | null
    source: string | null
    confirmed: boolean | null
}

export interface PictureChoice {
    likelihood: number
    unassigned: number
    assigned: number
}

export interface PictureOverview {
    list: PictureList
    minLikelihood: number
    defaultLikelihood: number
    minAllowed: number
    maxAllowed: number
    choices: PictureChoice[]
    /** The list now shown at the chosen likelihood. */
    current: { total: number }
    /** Both lists together at the chosen likelihood (the count on the tab). */
    suggestedTotal: number
    checked: number
    candidates: number
    assignedChecked: number
    assignedCandidates: number
    ignoredFromList: number
    hideFromReview: boolean
    hideable: number
    hiddenFromReview: number
}

interface Response {
    success: boolean
    error?: string
    overview?: PictureOverview
    faces?: PictureTile[]
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
 * The Pictures? lists: faces the vision model finds picture-like, in Review Needed and among the faces assigned to people. The overview (for the
 * count on the tab) loads with the page; the faces load when the list is opened. Nothing is ignored except what the user selects. What Review Needed
 * shows depends on these lists (faces it hides, faces ignored or kept), so `onReviewChanged` is called when that may have changed.
 */
export function usePictureSuggestions({ enabled, onReviewChanged }: { enabled: boolean; onReviewChanged?: () => void }) {
    const { loadFaces, loadPeople, refreshUnassignedCount } = usePeople()
    const { addToast } = useToast()

    const [overview, setOverview] = useState<PictureOverview | null>(null)
    const [tiles, setTiles] = useState<PictureTile[]>([])
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState(false)
    const tileIds = useMemo(() => tiles.map(tile => tile.faceId), [tiles])
    const { selectedIds, setSelectedIds, toggle, selectAllLoaded, selectNone, addToSelection } = useListSelection(tileIds)
    /** The faces the last "Ignore" ignored, so Undo returns exactly those. */
    const [undoBatch, setUndoBatch] = useState<number[] | null>(null)

    const fail = useCallback((what: string, error?: string) => {
        addToast({ type: 'error', description: `Could not ${what}: ${error ?? 'unknown error'}` })
    }, [addToast])

    const refreshOverview = useCallback(async () => {
        const response = await call('picture:getOverview')
        if (response.success && response.overview) setOverview(response.overview)
    }, [])

    const reloadList = useCallback(async () => {
        setLoading(true)
        setSelectedIds(new Set())
        const response = await call('picture:list', { offset: 0, limit: PAGE_SIZE })
        if (response.success && response.faces) setTiles(response.faces)
        else fail('load the list', response.error)
        setLoading(false)
    }, [fail, setSelectedIds])

    const refreshReview = useCallback(() => {
        void refreshUnassignedCount()
        onReviewChanged?.()
    }, [refreshUnassignedCount, onReviewChanged])

    const refreshQueue = useCallback(() => {
        loadFaces({ unnamed: true })
        loadPeople()
        refreshReview()
    }, [loadFaces, loadPeople, refreshReview])

    useEffect(() => { void refreshOverview() }, [refreshOverview, enabled])
    useEffect(() => {
        if (!enabled) return
        const timer = setInterval(() => { void refreshOverview() }, OVERVIEW_REFRESH_MS)
        return () => clearInterval(timer)
    }, [enabled, refreshOverview])
    useEffect(() => { if (enabled) void reloadList() }, [enabled, reloadList])

    /** Loads the next page and returns the ids of the faces it added. */
    const loadMore = useCallback(async (): Promise<number[]> => {
        if (loading) return []
        setLoading(true)
        const response = await call('picture:list', { offset: tiles.length, limit: PAGE_SIZE })
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
        const response = await call('picture:ignore', { faceIds: [...selectedIds] })
        if (response.success && response.ignoredIds) {
            removeFromList(response.ignoredIds)
            setSelectedIds(new Set())
            setUndoBatch(response.ignoredIds.length > 0 ? response.ignoredIds : null)
            addToast({ type: 'success', description: `Ignored ${plural(response.ignoredIds.length)} as pictures` })
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
        const response = await call('picture:keep', { faceIds })
        if (response.success) {
            removeFromList(faceIds)
            setSelectedIds(new Set())
            addToast({ type: 'success', description: `Kept ${plural(response.kept ?? faceIds.length)} as real faces; they will not be suggested again` })
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
        const response = await call('picture:undo', { faceIds: undoBatch })
        if (response.success) {
            setUndoBatch(null)
            addToast({ type: 'success', description: `Gave back ${plural(response.restoredIds?.length ?? 0)} as they were` })
            await Promise.all([reloadList(), refreshOverview()])
            refreshQueue()
        } else {
            fail('undo', response.error)
        }
        setBusy(false)
    }, [undoBatch, busy, addToast, fail, reloadList, refreshOverview, refreshQueue])

    /** Saves a list setting, then shows the list from the start under it. */
    const change = useCallback(async (what: string, channel: string, payload: unknown, affectsReview: boolean) => {
        if (busy) return
        setBusy(true)
        const response = await call(channel, payload)
        if (response.success && response.overview) {
            setOverview(response.overview)
            setUndoBatch(null)
            await reloadList()
            if (affectsReview) refreshReview()
        } else {
            fail(what, response.error)
        }
        setBusy(false)
    }, [busy, fail, reloadList, refreshReview])

    const setList = useCallback((list: PictureList) => change('change the list', 'picture:setList', { list }, false), [change])
    const setLikelihood = useCallback((percent: number) => change('change the likelihood', 'picture:setLikelihood', { percent }, true), [change])

    /** Whether Review Needed hides the unassigned faces of this list. The list itself does not change; Review Needed does. */
    const setHideFromReview = useCallback(async (hide: boolean) => {
        if (busy) return
        setBusy(true)
        const response = await call('picture:setHide', { hide })
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
        total: overview?.suggestedTotal ?? 0,
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
        setList,
        setLikelihood,
        setHideFromReview,
    }
}

export type PictureSuggestionsController = ReturnType<typeof usePictureSuggestions>
