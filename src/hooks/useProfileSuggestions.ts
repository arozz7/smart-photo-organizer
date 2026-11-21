import { useCallback, useEffect, useRef, useState } from 'react'
import { usePeople } from '../context/PeopleContext'
import { useToast } from '../context/ToastContext'

/** Faces loaded per page of the "Turned faces" list. */
export const PAGE_SIZE = 100
/** How often the overview is asked for again while the search runs. */
export const POLL_MS = 1500

export interface ProfileFaceTile {
    faceId: number
    photoId: number
    box: { x: number; y: number; width: number; height: number }
    yaw: number | null
    quality: number | null
    blur: number | null
    filePath: string | null
    previewPath: string | null
    photoWidth: number | null
    photoHeight: number | null
}

export interface ProfileName {
    personId: number
    name: string
    distance: number
}

export interface ProfileRow {
    faceId: number
    photoId: number
    tile: ProfileFaceTile
    /** The nearest person. */
    person: ProfileName
    /** The second name, when another person's turned faces are within the distance too. */
    also: ProfileName | null
    examples: ProfileFaceTile[]
    frontal: ProfileFaceTile | null
}

export interface ProfileOverview {
    state: 'computing' | 'ready' | 'error'
    error?: string
    checked: number
    candidates: number
    examples: number
    peopleWithExamples: number
    total: number
    twoNames: number
    byPerson: { personId: number; name: string; count: number }[]
    assignedFromList: number
    stale: boolean
    settings: {
        distance: number
        defaultDistance: number
        minDistance: number
        maxDistance: number
        distanceChoices: number[]
        minYaw: number
        defaultMinYaw: number
        minYawAllowed: number
        maxYawAllowed: number
    }
}

interface Pair {
    faceId: number
    personId: number
}

interface Response {
    success: boolean
    error?: string
    overview?: ProfileOverview
    rows?: ProfileRow[]
    assigned?: Pair[]
    dismissed?: number
    skipped?: number
    restored?: Pair[]
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
 * The "Turned faces" list: unassigned turned faces and the person whose turned faces they resemble. The search runs in the main
 * process and takes several seconds, so while it runs the overview is asked for again until it is ready. Nothing is assigned
 * except what the user selects; the last assignment can be undone.
 */
export function useProfileSuggestions({ enabled, personId }: { enabled: boolean; personId?: number | null }) {
    const { loadFaces, loadPeople } = usePeople()
    const { addToast } = useToast()

    const [overview, setOverview] = useState<ProfileOverview | null>(null)
    const [rows, setRows] = useState<ProfileRow[]>([])
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    /** The faces the last "Assign selected" gave away, so Undo returns exactly those. */
    const [undoBatch, setUndoBatch] = useState<number[] | null>(null)
    const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const onlyPerson = personId ?? undefined

    const fail = useCallback((what: string, error?: string) => {
        addToast({ type: 'error', description: `Could not ${what}: ${error ?? 'unknown error'}` })
    }, [addToast])

    const listPayload = useCallback((offset: number) => ({ offset, limit: PAGE_SIZE, ...(onlyPerson !== undefined ? { personId: onlyPerson } : {}) }), [onlyPerson])

    const reloadList = useCallback(async () => {
        setLoading(true)
        setSelectedIds(new Set())
        const response = await call('profile:list', listPayload(0))
        if (response.success && response.rows) setRows(response.rows)
        else fail('load the list', response.error)
        setLoading(false)
    }, [listPayload, fail])

    const refreshQueue = useCallback(() => {
        loadFaces({ unnamed: true })
        loadPeople()
    }, [loadFaces, loadPeople])

    /** Takes an overview: while the search runs, asks again later; when it is ready, loads the list. */
    const applyOverview = useCallback(async (next: ProfileOverview) => {
        setOverview(next)
        if (pollTimer.current) clearTimeout(pollTimer.current)
        pollTimer.current = null
        if (next.state === 'computing') {
            pollTimer.current = setTimeout(async () => {
                const response = await call('profile:getOverview')
                if (response.success && response.overview) await applyOverview(response.overview)
            }, POLL_MS)
        } else if (next.state === 'ready') {
            await reloadList()
        }
    }, [reloadList])

    const refreshOverview = useCallback(async () => {
        const response = await call('profile:getOverview')
        if (response.success && response.overview) setOverview(response.overview)
    }, [])

    useEffect(() => {
        if (!enabled) return
        let cancelled = false
        void (async () => {
            const response = await call('profile:getOverview')
            if (cancelled) return
            if (response.success && response.overview) await applyOverview(response.overview)
            else fail('load the turned faces', response.error)
        })()
        return () => {
            cancelled = true
            if (pollTimer.current) clearTimeout(pollTimer.current)
            pollTimer.current = null
        }
    }, [enabled, onlyPerson, applyOverview, fail])

    const loadMore = useCallback(async () => {
        if (loading) return
        setLoading(true)
        const response = await call('profile:list', listPayload(rows.length))
        if (response.success && response.rows) {
            const more = response.rows
            setRows(prev => [...prev, ...more.filter(face => !prev.some(shown => shown.faceId === face.faceId))])
        } else {
            fail('load more faces', response.error)
        }
        setLoading(false)
    }, [loading, rows.length, listPayload, fail])

    const toggle = useCallback((faceId: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev)
            if (!next.delete(faceId)) next.add(faceId)
            return next
        })
    }, [])
    /** Faces with two names are not selected here: the user chooses those one by one. */
    const selectAllLoaded = useCallback(() => setSelectedIds(new Set(rows.filter(row => row.also === null).map(row => row.faceId))), [rows])
    const selectNone = useCallback(() => setSelectedIds(new Set()), [])

    const assignPairs = useCallback(async (pairs: Pair[]) => {
        if (pairs.length === 0 || busy) return
        setBusy(true)
        const response = await call('profile:assign', { pairs })
        if (response.success && response.assigned) {
            const gone = new Set(response.assigned.map(pair => pair.faceId))
            setRows(prev => prev.filter(row => !gone.has(row.faceId)))
            setSelectedIds(new Set())
            setUndoBatch(gone.size > 0 ? [...gone] : null)
            const skipped = response.skipped ?? 0
            addToast({ type: 'success', description: `Assigned ${plural(gone.size)}${skipped > 0 ? `; ${plural(skipped)} could not be assigned (already changed)` : ''}` })
            void refreshOverview()
            refreshQueue()
        } else {
            fail('assign the selected faces', response.error)
        }
        setBusy(false)
    }, [busy, addToast, fail, refreshOverview, refreshQueue])

    const assignSelected = useCallback(
        () => assignPairs(rows.filter(row => selectedIds.has(row.faceId)).map(row => ({ faceId: row.faceId, personId: row.person.personId }))),
        [assignPairs, rows, selectedIds],
    )
    const assignTo = useCallback((faceId: number, person: number) => assignPairs([{ faceId, personId: person }]), [assignPairs])

    const dismissSelected = useCallback(async () => {
        const pairs = rows.filter(row => selectedIds.has(row.faceId)).map(row => ({ faceId: row.faceId, personId: row.person.personId }))
        if (pairs.length === 0 || busy) return
        setBusy(true)
        const response = await call('profile:dismiss', { pairs })
        if (response.success) {
            addToast({ type: 'success', description: `Noted: ${plural(response.dismissed ?? pairs.length)} will not be suggested for that person again` })
            await Promise.all([reloadList(), refreshOverview()])
        } else {
            fail('save "not this person"', response.error)
        }
        setBusy(false)
    }, [rows, selectedIds, busy, addToast, fail, reloadList, refreshOverview])

    const undoLast = useCallback(async () => {
        if (!undoBatch || busy) return
        setBusy(true)
        const response = await call('profile:undo', { faceIds: undoBatch })
        if (response.success) {
            setUndoBatch(null)
            addToast({ type: 'success', description: `Returned ${plural(response.restored?.length ?? 0)} to the review queue` })
            const next = await call('profile:getOverview')
            if (next.success && next.overview) await applyOverview(next.overview)
            refreshQueue()
        } else {
            fail('undo', response.error)
        }
        setBusy(false)
    }, [undoBatch, busy, addToast, fail, applyOverview, refreshQueue])

    /** Saves a setting, then shows the list from the start under it (or waits for the new search). */
    const change = useCallback(async (what: string, channel: string, payload: unknown) => {
        if (busy) return
        setBusy(true)
        const response = await call(channel, payload)
        if (response.success && response.overview) {
            setUndoBatch(null)
            await applyOverview(response.overview)
        } else {
            fail(what, response.error)
        }
        setBusy(false)
    }, [busy, fail, applyOverview])

    const setDistance = useCallback((distance: number) => change('change the distance', 'profile:setDistance', { distance }), [change])
    const setMinYaw = useCallback((degrees: number) => change('change the angle', 'profile:setMinYaw', { degrees }), [change])
    const refresh = useCallback(() => change('search again', 'profile:refresh', undefined), [change])

    return {
        overview,
        rows,
        total: overview?.total ?? 0,
        // a page for one person is part of the whole list, so it can only be recognised as "maybe more" by being full
        hasMore: onlyPerson === undefined ? rows.length < (overview?.total ?? 0) : rows.length >= PAGE_SIZE && rows.length % PAGE_SIZE === 0,
        loading,
        busy,
        selectedIds,
        undoBatch,
        loadMore,
        toggle,
        selectAllLoaded,
        selectNone,
        assignSelected,
        assignTo,
        dismissSelected,
        undoLast,
        setDistance,
        setMinYaw,
        refresh,
    }
}

export type ProfileSuggestionsController = ReturnType<typeof useProfileSuggestions>
