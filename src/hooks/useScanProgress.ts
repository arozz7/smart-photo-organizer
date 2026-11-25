import { useEffect, useRef, useState } from 'react'
import type { ScanProgress } from '../utils/scanProgress'

/**
 * Progress of the running scan. Kept out of ScanContext on purpose: updates arrive several times a second, and only the
 * components that show them should re-render. `startedAt` is when the first update of this scan arrived.
 */
export function useScanProgress(scanning: boolean): { progress: ScanProgress | null; elapsedMs: number } {
    const [progress, setProgress] = useState<ScanProgress | null>(null)
    const startedAt = useRef<number | null>(null)

    useEffect(() => {
        // @ts-ignore
        const remove = (window as any).ipcRenderer.on('scan-progress', (_event: unknown, next: ScanProgress) => {
            if (startedAt.current === null || next.phase === 'collecting') startedAt.current = Date.now()
            setProgress(next)
        })
        return () => {
            if (typeof remove === 'function') remove()
        }
    }, [])

    useEffect(() => {
        // A new scan starts from zero; after one ends the last figures stay readable (the dashboard shows them for a while).
        if (scanning) {
            startedAt.current = null
            setProgress(null)
        }
    }, [scanning])

    return { progress, elapsedMs: startedAt.current === null ? 0 : Date.now() - startedAt.current }
}
