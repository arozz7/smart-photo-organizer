import { useState, useEffect, useRef } from 'react';
import type { PrsJobResult } from '../types/prs';

const POLL_INTERVAL_MS = 2_000;

/**
 * Poll PRS job status every 2 s until the job reaches a terminal state.
 * Automatically clears the interval on unmount or when jobId becomes null.
 */
export function useRepairJob(
    jobId: string | null,
    onDone: (result: PrsJobResult) => void,
    onError: (msg: string) => void,
): { percent: number; stage: string; status: string } {
    const [percent, setPercent] = useState(0);
    const [stage, setStage] = useState('');
    const [status, setStatus] = useState('idle');
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (!jobId) {
            clearInterval(intervalRef.current ?? undefined);
            intervalRef.current = null;
            return;
        }

        const poll = async () => {
            try {
                // @ts-ignore — ipcRenderer exposed via preload passthrough
                const result = await window.ipcRenderer.invoke('prs:pollStatus', { jobId });

                if (result?.error) {
                    clearInterval(intervalRef.current ?? undefined);
                    onError(result.error);
                    return;
                }

                setPercent(result?.percent ?? 0);
                setStage(result?.stage ?? '');
                setStatus(result?.status ?? 'unknown');

                if (result?.status === 'done') {
                    clearInterval(intervalRef.current ?? undefined);
                    onDone(result as PrsJobResult);
                } else if (result?.status === 'failed') {
                    clearInterval(intervalRef.current ?? undefined);
                    onError(result.error ?? 'Repair job failed');
                }
            } catch (e) {
                clearInterval(intervalRef.current ?? undefined);
                onError(String(e));
            }
        };

        // Poll immediately, then on interval
        poll();
        intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

        return () => {
            clearInterval(intervalRef.current ?? undefined);
            intervalRef.current = null;
        };
    }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

    return { percent, stage, status };
}
