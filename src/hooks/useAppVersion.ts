import { useEffect, useState } from 'react'

/**
 * The version of the running app, formatted for display (for example `v0.8.2`).
 * Returns an empty string until it is known, and if it cannot be read: no label is better than a wrong one.
 */
export function useAppVersion(): string {
    const [version, setVersion] = useState('')

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            try {
                // @ts-ignore
                const value: string = await window.ipcRenderer.invoke('app:getVersion')
                if (!cancelled) setVersion(`v${value}`)
            } catch {
                // leave the label empty
            }
        }
        void load()
        return () => { cancelled = true }
    }, [])

    return version
}
