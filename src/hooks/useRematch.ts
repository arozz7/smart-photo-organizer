import { useCallback, useEffect, useState } from 'react'

/** Progress of the background re-match of unassigned faces against named people (see docs/plans/review-queue-parking-plan.md). */
export interface RematchStatus {
    running: boolean
    autoEnabled: boolean
    /** The distance in use (the Face Similarity Threshold setting). */
    threshold: number
    checked: number
    total: number
    matched: number
    /** Re-matched faces still unconfirmed, which Undo would return to unassigned. */
    undoable: number
    lastRun: { completedAt: string; matched: number; checked: number; error?: string } | null
}

interface RematchResponse {
    success: boolean
    status?: RematchStatus
    started?: boolean
    reason?: 'busy' | 'already-running' | 'nobody-named'
    undone?: number
    error?: string
}

export interface RematchState {
    status: RematchStatus | null
    /** A short note about the last action (why a run did not start, how many faces an undo returned, an error). */
    message: string | null
    run: () => Promise<void>
    undo: () => Promise<void>
    setAuto: (enabled: boolean) => Promise<void>
    /** Chooses how close a face must be to a named person to be matched (applies to the next run). */
    setDistance: (distance: number) => Promise<void>
}

const REFRESH_WHILE_RUNNING_MS = 3000

const NOT_STARTED: Record<NonNullable<RematchResponse['reason']>, string> = {
    busy: 'A scan or AI work is running. Try again when it has finished.',
    'nobody-named': 'Name at least one person first.',
    'already-running': 'The re-match is already running.',
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** Status and actions of the re-match card. The status is refreshed every few seconds while a run is under way. */
export function useRematch(): RematchState {
    const [status, setStatus] = useState<RematchStatus | null>(null)
    const [message, setMessage] = useState<string | null>(null)

    const refresh = useCallback(async () => {
        try {
            // @ts-ignore
            const response: RematchResponse = await window.ipcRenderer.invoke('rematch:getStatus')
            if (response.status) setStatus(response.status)
            else if (!response.success) setMessage(response.error ?? 'Could not read the re-match status')
        } catch (e) {
            setMessage(errorText(e))
        }
    }, [])

    useEffect(() => {
        void refresh()
    }, [refresh])

    const running = status?.running === true
    useEffect(() => {
        if (!running) return
        const timer = setInterval(() => { void refresh() }, REFRESH_WHILE_RUNNING_MS)
        return () => clearInterval(timer)
    }, [running, refresh])

    const act = useCallback(async (channel: string, payload?: unknown): Promise<RematchResponse | null> => {
        setMessage(null)
        try {
            const args = payload === undefined ? [channel] : [channel, payload]
            // @ts-ignore
            const response: RematchResponse = await window.ipcRenderer.invoke(...args)
            if (response.status) setStatus(response.status)
            if (response.error) setMessage(response.error)
            return response
        } catch (e) {
            setMessage(errorText(e))
            return null
        }
    }, [])

    const run = useCallback(async () => {
        const response = await act('rematch:run')
        if (response && response.started === false && response.reason) setMessage(NOT_STARTED[response.reason])
    }, [act])

    const undo = useCallback(async () => {
        const response = await act('rematch:undo')
        if (response && response.success) {
            setMessage(
                response.undone
                    ? `${response.undone.toLocaleString()} faces returned to unassigned. Automatic runs are switched off; turn them on again whenever you like.`
                    : 'Nothing to undo.'
            )
        }
    }, [act])

    const setAuto = useCallback(async (enabled: boolean) => {
        await act('rematch:setAuto', { enabled })
    }, [act])

    const setDistance = useCallback(async (distance: number) => {
        await act('rematch:setDistance', { distance })
    }, [act])

    return { status, message, run, undo, setAuto, setDistance }
}
