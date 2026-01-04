/**
 * usePoseBackfill Hook (Phase 5)
 * 
 * Provides state and controls for the background pose data backfill process.
 * Use in Settings or as an automated background task.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

interface BackfillStatus {
    needsBackfill: number;
    total: number;
    completed: number;
    percent: number;
}

interface BackfillResult {
    processed: number;
    failed: number;
    remaining: number;
    percent: number;
}

export function usePoseBackfill() {
    const [status, setStatus] = useState<BackfillStatus | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [lastBatchResult, setLastBatchResult] = useState<BackfillResult | null>(null);
    const abortRef = useRef(false);
    const pauseRef = useRef(false);

    // Fetch current status
    const fetchStatus = useCallback(async () => {
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:getPoseBackfillStatus');
            if (result.success) {
                setStatus({
                    needsBackfill: result.needsBackfill,
                    total: result.total,
                    completed: result.completed,
                    percent: result.percent
                });
            }
            return result;
        } catch (error) {
            console.error('[usePoseBackfill] Failed to fetch status:', error);
            return { success: false, error: String(error) };
        }
    }, []);

    // Process a single batch
    const processBatch = useCallback(async (batchSize = 10) => {
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('db:processPoseBackfillBatch', { batchSize });
            if (result.success) {
                setLastBatchResult({
                    processed: result.processed,
                    failed: result.failed,
                    remaining: result.remaining,
                    percent: result.percent
                });
                // Update status
                await fetchStatus();
            }
            return result;
        } catch (error) {
            console.error('[usePoseBackfill] Failed to process batch:', error);
            return { success: false, error: String(error) };
        }
    }, [fetchStatus]);

    // Start continuous backfill
    const startBackfill = useCallback(async (batchSize = 10, delayMs = 100) => {
        if (isRunning) return;

        setIsRunning(true);
        setIsPaused(false);
        abortRef.current = false;
        pauseRef.current = false;

        // Initial status check
        const initialStatus = await fetchStatus();
        if (!initialStatus.success || initialStatus.needsBackfill === 0) {
            setIsRunning(false);
            return;
        }

        // Process batches until complete or aborted
        while (!abortRef.current) {
            if (pauseRef.current) {
                await new Promise(resolve => setTimeout(resolve, 500));
                continue;
            }

            const result = await processBatch(batchSize);

            if (!result.success || result.remaining === 0 || result.processed === 0) {
                break;
            }

            // Small delay between batches to avoid overwhelming the system
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        setIsRunning(false);
    }, [isRunning, fetchStatus, processBatch]);

    // Pause/Resume
    const pauseBackfill = useCallback(() => {
        pauseRef.current = true;
        setIsPaused(true);
    }, []);

    const resumeBackfill = useCallback(() => {
        pauseRef.current = false;
        setIsPaused(false);
    }, []);

    // Stop backfill
    const stopBackfill = useCallback(() => {
        abortRef.current = true;
        pauseRef.current = false;
        setIsPaused(false);
    }, []);

    // Fetch initial status on mount
    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    return {
        status,
        isRunning,
        isPaused,
        lastBatchResult,
        fetchStatus,
        processBatch,
        startBackfill,
        pauseBackfill,
        resumeBackfill,
        stopBackfill
    };
}
