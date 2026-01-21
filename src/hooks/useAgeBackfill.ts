/**
 * useAgeBackfill Hook (Phase 42)
 * 
 * Provides state and controls for the background age data backfill process.
 * Age extraction runs in BackgroundAgeRescanService in the main process.
 * 
 * Use in Settings to trigger age backfill for existing photos.
 */

import { useState, useCallback, useEffect } from 'react';

interface AgeBackfillStatus {
    active: boolean;
    processed: number;
    total: number;
    remaining: number;
    percentage: number;
}

export function useAgeBackfill() {
    const [status, setStatus] = useState<AgeBackfillStatus | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Fetch current status
    const fetchStatus = useCallback(async () => {
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:getAgeBackfillStatus');
            if (result.success) {
                setStatus({
                    active: result.active,
                    processed: result.processed,
                    total: result.total,
                    remaining: result.remaining,
                    percentage: result.percentage
                });
            }
            return result;
        } catch (error) {
            console.error('[useAgeBackfill] Failed to fetch status:', error);
            return { success: false, error: String(error) };
        }
    }, []);

    // Start backfill
    const startBackfill = useCallback(async () => {
        setIsLoading(true);
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:startAgeBackfill');
            if (result.success) {
                // Immediately fetch status to show active
                await fetchStatus();
            }
            return result;
        } catch (error) {
            console.error('[useAgeBackfill] Failed to start:', error);
            return { success: false, error: String(error) };
        } finally {
            setIsLoading(false);
        }
    }, [fetchStatus]);

    // Cancel backfill
    const cancelBackfill = useCallback(async () => {
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:cancelAgeBackfill');
            if (result.success) {
                setStatus(null);
                await fetchStatus();
            }
            return result;
        } catch (error) {
            console.error('[useAgeBackfill] Failed to cancel:', error);
            return { success: false, error: String(error) };
        }
    }, [fetchStatus]);

    // Pause backfill
    const pauseBackfill = useCallback(async () => {
        try {
            // @ts-ignore
            return await window.ipcRenderer.invoke('db:pauseAgeBackfill');
        } catch (error) {
            console.error('[useAgeBackfill] Failed to pause:', error);
            return { success: false, error: String(error) };
        }
    }, []);

    // Resume backfill
    const resumeBackfill = useCallback(async () => {
        try {
            // @ts-ignore
            return await window.ipcRenderer.invoke('db:resumeAgeBackfill');
        } catch (error) {
            console.error('[useAgeBackfill] Failed to resume:', error);
            return { success: false, error: String(error) };
        }
    }, []);

    // Fetch initial status on mount
    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    // Poll for updates when active
    useEffect(() => {
        if (status?.active) {
            const interval = setInterval(fetchStatus, 3000);
            return () => clearInterval(interval);
        }
    }, [status?.active, fetchStatus]);

    // Listen for IPC progress events
    useEffect(() => {
        const handleProgress = (_event: any, data: any) => {
            // Guard against undefined data
            if (!data || typeof data.processed === 'undefined') {
                return;
            }
            setStatus(prev => prev ? {
                ...prev,
                processed: data.processed ?? 0,
                total: data.total ?? 0,
                percentage: data.percentage ?? 0,
                remaining: (data.total ?? 0) - (data.processed ?? 0)
            } : null);
        };

        const handleComplete = () => {
            fetchStatus();
        };

        // @ts-ignore
        window.ipcRenderer?.on?.('age-rescan-progress', handleProgress);
        // @ts-ignore
        window.ipcRenderer?.on?.('age-rescan-complete', handleComplete);

        return () => {
            // @ts-ignore
            window.ipcRenderer?.removeListener?.('age-rescan-progress', handleProgress);
            // @ts-ignore 
            window.ipcRenderer?.removeListener?.('age-rescan-complete', handleComplete);
        };
    }, [fetchStatus]);

    return {
        status,
        isLoading,
        isActive: status?.active ?? false,
        needsBackfill: (status?.remaining ?? 0) > 0,
        fetchStatus,
        startBackfill,
        cancelBackfill,
        pauseBackfill,
        resumeBackfill
    };
}
