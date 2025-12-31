import { useState } from 'react'
import { useAI } from '../context/AIContext'

export interface ScanErrorsHook {
    scanErrors: any[]
    loadScanErrors: () => Promise<void>
    retryErrors: () => Promise<void>
    clearErrors: () => Promise<void>
}

export function useScanErrors(): ScanErrorsHook {
    const [scanErrors, setScanErrors] = useState<any[]>([])
    const { addToQueue } = useAI()

    const loadScanErrors = async () => {
        try {
            // @ts-ignore
            const errors = await window.ipcRenderer.invoke('db:getScanErrors')
            setScanErrors(errors)
        } catch (e) {
            console.error('Failed to load scan errors', e)
        }
    }

    const retryErrors = async () => {
        try {
            // @ts-ignore
            const photosToRetry = await window.ipcRenderer.invoke('db:retryScanErrors')
            if (photosToRetry && photosToRetry.length > 0) {
                console.log(`Retrying ${photosToRetry.length} failed scans...`)
                addToQueue(photosToRetry)
            }
            loadScanErrors() // Refresh (should be empty)
        } catch (e) {
            console.error('Failed to retry errors', e)
        }
    }

    const clearErrors = async () => {
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('db:clearScanErrors')
            setScanErrors([])
        } catch (e) {
            console.error('Failed to clear errors', e)
        }
    }

    return {
        scanErrors,
        loadScanErrors,
        retryErrors,
        clearErrors
    }
}
