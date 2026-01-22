import { useState, useEffect, useCallback } from 'react';

interface UpgradeStatus {
    processed: number;
    total: number;
    percentage: number;
    isRunning: boolean;
    isPaused: boolean;
}

export function useFaceDataUpgrade() {
    const [status, setStatus] = useState<UpgradeStatus | null>(null);
    const [isComplete, setIsComplete] = useState(false);

    // Initial status fetch
    const fetchStatus = useCallback(async () => {
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('service:face-upgrade:status');
            if (result.success) {
                setStatus(result.status);
            }
        } catch (error) {
            console.error('Failed to fetch upgrade status:', error);
        }
    }, []);

    useEffect(() => {
        // Fetch initial status on mount only (not polling)
        fetchStatus();

        // Listen for real-time updates via IPC events (event-driven like other services)
        // Listen for real-time updates via IPC events (event-driven like other services)
        // NOTE: preload.ts wrapper strips the 'event' argument!
        // So the signature is (progress) not (event, progress).

        const removeProgressListener = (window.ipcRenderer as any).on('face-upgrade-progress', (progress: UpgradeStatus) => {
            setStatus(progress);
            setIsComplete(false);
        });

        const removeCompleteListener = (window.ipcRenderer as any).on('face-upgrade-complete', () => {
            setIsComplete(true);
            fetchStatus();
        });

        return () => {
            removeProgressListener();
            removeCompleteListener();
        };
    }, [fetchStatus]);

    const start = async () => {
        // @ts-ignore
        await window.ipcRenderer.invoke('service:face-upgrade:start');
        await fetchStatus();
    };

    const stop = async () => {
        // @ts-ignore
        await window.ipcRenderer.invoke('service:face-upgrade:stop');
        await fetchStatus();
    };

    const pause = async () => {
        // @ts-ignore
        await window.ipcRenderer.invoke('service:face-upgrade:pause');
        await fetchStatus();
    };

    const resume = async () => {
        // @ts-ignore
        await window.ipcRenderer.invoke('service:face-upgrade:resume');
        await fetchStatus();
    };

    return {
        status,
        isComplete,
        isRunning: status?.isRunning || false,
        isPaused: status?.isPaused || false,
        start,
        stop,
        pause,
        resume,
        refresh: fetchStatus
    };
}
