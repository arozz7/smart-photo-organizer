import { useCallback, useEffect, useState } from 'react'

/** How the unassigned faces split into worth reviewing and parked (see docs/plans/review-queue-parking-plan.md). */
export interface ParkedSummary {
    unassigned: number
    lowQuality: number
    singleton: number
    nearNamed: number
    parked: number
    worthReviewing: number
    sameShotOnly: number
    nearNamedByDistance: { distance: number; count: number }[]
    singletonAtAlternativeDistance: number
    settings: {
        minFaceArea: number
        minBlurScore: number
        twinDistance: number
        alternativeTwinDistance: number
        suggestionDistance: number
        duplicateDistance: number
    }
}

interface ParkedSummaryResponse {
    success: boolean
    status?: 'ready' | 'busy' | 'stale' | 'failed'
    summary?: ParkedSummary | null
    computedAt?: string
    error?: string
}

export interface ParkedSummaryState {
    summary: ParkedSummary | null
    /** When the shown numbers were measured (ISO). */
    computedAt: string | null
    /** The shown numbers match the faces and people as they are now. */
    isCurrent: boolean
    isMeasuring: boolean
    /** The last request was not run because a scan or AI work is running. */
    isBusy: boolean
    error: string | null
    /** Measures now (takes up to a minute on a large library). */
    measure: () => Promise<void>
}

/**
 * The parked-faces summary. Opening only reads the saved result; measuring starts when the user asks.
 */
export function useParkedSummary(): ParkedSummaryState {
    const [summary, setSummary] = useState<ParkedSummary | null>(null)
    const [computedAt, setComputedAt] = useState<string | null>(null)
    const [isCurrent, setIsCurrent] = useState(false)
    const [isMeasuring, setIsMeasuring] = useState(false)
    const [isBusy, setIsBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const apply = useCallback((response: ParkedSummaryResponse) => {
        if (response.summary) {
            setSummary(response.summary)
            setComputedAt(response.computedAt ?? null)
        }
        setIsCurrent(response.status === 'ready')
        setIsBusy(response.status === 'busy')
    }, [])

    useEffect(() => {
        let cancelled = false
        const loadSaved = async () => {
            try {
                // @ts-ignore
                const response: ParkedSummaryResponse = await window.ipcRenderer.invoke('db:getParkedSummary', { cachedOnly: true })
                if (!cancelled) apply(response)
            } catch {
                // nothing saved to show; the Calculate button still works
            }
        }
        void loadSaved()
        return () => { cancelled = true }
    }, [apply])

    const measure = useCallback(async () => {
        setIsMeasuring(true)
        setError(null)
        try {
            // @ts-ignore
            const response: ParkedSummaryResponse = await window.ipcRenderer.invoke('db:getParkedSummary', { refresh: true })
            if (response.status === 'failed' || response.success === false) {
                setError(response.error ?? 'Could not measure the faces')
            } else {
                apply(response)
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setIsMeasuring(false)
        }
    }, [apply])

    return { summary, computedAt, isCurrent, isMeasuring, isBusy, error, measure }
}
