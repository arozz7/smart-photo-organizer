import { useCallback, useEffect, useState } from 'react'

export type RunMode = 'off' | 'away' | 'always'
export type VisibilityState = 'off' | 'done' | 'error' | 'waiting-busy' | 'waiting-away' | 'scoring' | 'ready'

/** Progress of the background "is a clear face visible?" check (see docs/plans/non-face-and-picture-faces-plan.md, Phase B part 2). */
export interface VisibilityStatus {
    mode: RunMode
    awayMinutes: number
    state: VisibilityState
    candidates: number
    scored: number
    failed: number
    remaining: number
    lastError: string | null
}

interface VisibilityResponse {
    success: boolean
    status?: VisibilityStatus
    started?: boolean
    reason?: 'busy' | 'nothing-to-do'
    error?: string
}

export interface FaceVisibilityState {
    status: VisibilityStatus | null
    /** A short note about the last action (why "Run now" did not start, an error). */
    message: string | null
    runNow: () => Promise<void>
    setMode: (mode: RunMode) => Promise<void>
    setAwayMinutes: (minutes: number) => Promise<void>
}

/** How often the card refreshes while the check is, or is about to be, working (the counts take a moment to read). */
export const REFRESH_MS = 10_000

const NOT_STARTED: Record<NonNullable<VisibilityResponse['reason']>, string> = {
    busy: 'A scan or AI work is running. Try again when it has finished.',
    'nothing-to-do': 'Nothing left to check.',
}

const SETTLED: VisibilityState[] = ['off', 'done']

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** Status and actions of the face visibility card. */
export function useFaceVisibility(): FaceVisibilityState {
    const [status, setStatus] = useState<VisibilityStatus | null>(null)
    const [message, setMessage] = useState<string | null>(null)

    const call = useCallback(async (channel: string, payload?: unknown): Promise<VisibilityResponse | null> => {
        try {
            const args = payload === undefined ? [channel] : [channel, payload]
            // @ts-ignore
            const response: VisibilityResponse = await window.ipcRenderer.invoke(...args)
            if (response.status) setStatus(response.status)
            return response
        } catch (error) {
            setMessage(errorText(error))
            return null
        }
    }, [])

    const refresh = useCallback(async () => {
        const response = await call('visibility:getStatus')
        if (response && !response.success && response.error) setMessage(response.error)
    }, [call])

    useEffect(() => { void refresh() }, [refresh])

    const active = status !== null && !SETTLED.includes(status.state)
    useEffect(() => {
        if (!active) return
        const timer = setInterval(() => { void refresh() }, REFRESH_MS)
        return () => clearInterval(timer)
    }, [active, refresh])

    const runNow = useCallback(async () => {
        setMessage(null)
        const response = await call('visibility:runNow')
        if (response && response.started === false && response.reason) setMessage(NOT_STARTED[response.reason])
        else if (response && response.error) setMessage(response.error)
    }, [call])

    const setMode = useCallback(async (mode: RunMode) => {
        setMessage(null)
        await call('visibility:setMode', { mode })
    }, [call])

    const setAwayMinutes = useCallback(async (minutes: number) => {
        setMessage(null)
        await call('visibility:setAwayMinutes', { minutes })
    }, [call])

    return { status, message, runNow, setMode, setAwayMinutes }
}
