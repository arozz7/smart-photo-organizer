import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useAlert } from './AlertContext';

interface SystemStatus {
    insightface: {
        loaded: boolean
        providers?: string[]
        det_thresh?: number
        blur_thresh?: number
    }
    faiss: {
        loaded: boolean
        count?: number
        dim?: number
    }
    vlm: {
        loaded: boolean
        device?: string
        model?: string
        config?: any
    }
    system: {
        python: string
        torch: string
        cuda_available: boolean
        cuda_device: string
        onnxruntime: string
        opencv: string
        ai_mode?: string
    }
}

interface QueueConfig {
    batchSize: number;
    cooldownSeconds: number;
}

interface AIContextType {
    isModelLoading: boolean;
    isModelReady: boolean;
    processingQueue: any[];
    addToQueue: (photos: any[]) => void;
    // Event subscription for specific or all photo updates
    onPhotoProcessed: (callback: (photoId: number) => void) => () => void;
    // Queue Control
    isPaused: boolean;
    setIsPaused: (paused: boolean) => void;
    queueConfig: { batchSize: number; cooldownSeconds: number };
    setQueueConfig: (config: { batchSize: number; cooldownSeconds: number }) => void;
    isCoolingDown: boolean;
    cooldownTimeLeft: number;
    skipCooldown: () => void;
    // Blur Calculation
    calculatingBlur: boolean;
    blurProgress: { current: number; total: number };
    calculateBlurScores: () => Promise<void>;
    // Clustering
    clusterFaces: (faceIds?: number[]) => Promise<{ success: boolean; clusters?: number[][]; error?: any }>;
    // System Status
    systemStatus: SystemStatus | null;
    fetchSystemStatus: () => Promise<void>;
    aiMode: 'UNKNOWN' | 'GPU' | 'CPU' | 'SAFE_MODE';
    vlmEnabled: boolean;
}

const AIContext = createContext<AIContextType>({
    isModelLoading: false,
    isModelReady: false, // Always true now as Python is managed by Main
    processingQueue: [],
    addToQueue: () => { },
    onPhotoProcessed: () => () => { },
    isPaused: false,
    setIsPaused: () => { },
    queueConfig: { batchSize: 0, cooldownSeconds: 0 },
    setQueueConfig: () => { },
    isCoolingDown: false,
    cooldownTimeLeft: 0,
    skipCooldown: () => { },
    calculatingBlur: false,
    blurProgress: { current: 0, total: 0 },
    calculateBlurScores: async () => { },
    clusterFaces: async () => ({ success: false }),
    systemStatus: null,
    fetchSystemStatus: async () => { },
    aiMode: 'UNKNOWN',
    vlmEnabled: false
});

export const useAI = () => useContext(AIContext);

export const AIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Python backend starts with Main, so we assume it's ready. 
    // We could add a check later, but for now simplify.
    const { showAlert } = useAlert();
    const [isModelLoading] = useState(false);
    const [isModelReady] = useState(true);

    const [processingQueue, setProcessingQueue] = useState<any[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    // Queue Control State
    const [isPaused, setIsPaused] = useState(false);

    // Persistence for Queue Config
    const [queueConfig, setQueueConfig] = useState<QueueConfig>({ batchSize: 0, cooldownSeconds: 60 });
    const [isConfigLoaded, setIsConfigLoaded] = useState(false);

    useEffect(() => {
        const loadConfig = async () => {
            try {
                // @ts-ignore
                const cfg = await window.ipcRenderer.invoke('settings:getQueueConfig');
                if (cfg) {
                    console.log("[AIContext] Loaded Queue Config:", cfg);
                    setQueueConfig(cfg);
                }
            } catch (e) {
                console.error("Failed to load queue config", e);
            } finally {
                setIsConfigLoaded(true);
            }
        }
        loadConfig();
        // fetchSystemStatus called below after definition
    }, [])

    useEffect(() => {
        if (!isConfigLoaded) return; // Don't save default state before load finishes
        // @ts-ignore
        window.ipcRenderer.invoke('settings:setQueueConfig', queueConfig).catch(console.error);
    }, [queueConfig, isConfigLoaded])

    const [currentBatchCount, setCurrentBatchCount] = useState(0);
    const [isCoolingDown, setIsCoolingDown] = useState(false);
    const [cooldownTimeLeft, setCooldownTimeLeft] = useState(0);
    const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);

    const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
    const [aiMode, setAiMode] = useState<'UNKNOWN' | 'GPU' | 'CPU' | 'SAFE_MODE'>('UNKNOWN');
    const [vlmEnabled, setVlmEnabled] = useState(false);

    const fetchSystemStatus = async () => {
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('ai:command', { type: 'get_system_status' });
            if (result && result.type === 'system_status_result') {
                setSystemStatus(result.status);
            }
            // Also check ping for live mode
            // @ts-ignore
            const ping = await window.ipcRenderer.invoke('ai:command', { type: 'ping' });
            if (ping) {
                if (ping.aiMode) setAiMode(ping.aiMode);
                if (ping.vlmEnabled !== undefined) setVlmEnabled(ping.vlmEnabled);
            }
        } catch (error) {
            console.error("Failed to fetch system status:", error);
        }
    };

    // Status Polling Effect
    useEffect(() => {
        let intervalId: NodeJS.Timeout;

        const pollStatus = async () => {
            // If we already have a mode, stop polling (unless we want to detect crashes?)
            // For now, just poll until we get out of UNKNOWN
            await fetchSystemStatus();
        };

        // Initial fetch
        pollStatus();

        // Start polling if UNKNOWN
        if (aiMode === 'UNKNOWN') {
            intervalId = setInterval(pollStatus, 2000);
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [aiMode]);

    // Blur Calculation State
    const [calculatingBlur, setCalculatingBlur] = useState(false);
    const [blurProgress, setBlurProgress] = useState({ current: 0, total: 0 });

    const calculateBlurScores = async () => {
        if (calculatingBlur) return;
        setCalculatingBlur(true);
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('db:getPhotosMissingBlurScores');
            if (res.success && res.photoIds.length > 0) {
                const total = res.photoIds.length;
                setBlurProgress({ current: 0, total });

                for (let i = 0; i < total; i++) {
                    // @ts-ignore
                    await window.ipcRenderer.invoke('ai:scanImage', { photoId: res.photoIds[i] });
                    setBlurProgress({ current: i + 1, total });
                }
                showAlert({
                    title: 'Blur Calculation Complete',
                    description: `Finished calculating blur scores for ${total} photos.`
                });
            } else if (res.success) {
                showAlert({
                    title: 'No Action Required',
                    description: 'No photos found missing blur scores.'
                });
            } else {
                showAlert({
                    title: 'Error',
                    description: "Failed to find photos: " + res.error,
                    variant: 'danger'
                });
            }
        } catch (e) {
            showAlert({
                title: 'Error',
                description: "Error: " + e,
                variant: 'danger'
            });
        } finally {
            setCalculatingBlur(false);
            setBlurProgress({ current: 0, total: 0 });
        }
    };

    const clusterFaces = async (faceIds?: number[]) => {
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('ai:clusterFaces', { faceIds });
            return res;
        } catch (e) {
            console.error("Cluster Faces Error:", e);
            return { success: false, error: e };
        }
    };

    // Callbacks for photo processing events
    const processedCallbacks = useRef<Set<(photoId: number) => void>>(new Set());

    // Track pending operations for each photo (scan vs tags) to avoid premature completion
    const pendingOperations = useRef<Map<number, Set<string>>>(new Map());

    // Listen for AI results from Main Process
    useEffect(() => {
        // @ts-ignore
        const cleanup = window.ipcRenderer.on('ai:scan-result', (payload: any) => {
            handleScanResult(payload);
        });

        return () => {
            if (typeof cleanup === 'function') {
                (cleanup as unknown as Function)();
            }
        };
    }, []);

    const handleScanResult = async (payload: any) => {
        const { photoId, faces, tags, error, type, previewPath, width, height } = payload;

        if (error) {
            console.error(`[AIContext] Error for ${photoId}:`, error);

            // Check for Safe Mode fallback success implicitly via ping or update?
            // If error is CRITICAL, we alert.
            // If error is just one photo fail, we might not want to kill everything.

            if (error === 'AI_CRITICAL_FAILURE' || error === 'AI_MODELS_MISSING') {
                // Determine severity
                const isCritical = error === 'AI_CRITICAL_FAILURE';

                showAlert({
                    title: isCritical ? 'AI Engine Critical Failure' : 'AI Runtime Issue',
                    description: `Face Analysis failed. ${payload.details || ''}`,
                    variant: 'danger',
                    confirmLabel: 'Settings',
                    onConfirm: () => { window.location.hash = '#/settings'; }
                });

                // Pause Queue to prevent spam if critical
                setIsPaused(true);
            }
        }

        try {
            // Store faces (and preview if available)
            if (faces && faces.length > 0) {
                // @ts-ignore
                await window.ipcRenderer.invoke('db:updateFaces', {
                    photoId,
                    previewPath,
                    width,
                    height,
                    globalBlurScore: payload.globalBlurScore,
                    faces: faces.map((f: any) => ({
                        box: f.box,
                        descriptor: f.descriptor,
                        blur_score: f.blurScore
                    }))
                });
            }

            // Store tags (from VLM or otherwise)
            if (tags && tags.length > 0) {
                // @ts-ignore
                await window.ipcRenderer.invoke('db:addTags', { photoId, tags });
            }

            // Since mode might change during runtime (fallback), maybe refresh status occasionally?
            if (aiMode === 'UNKNOWN') {
                fetchSystemStatus();
            }

        } catch (err) {
            console.error('Failed to save AI results to DB:', err);
        } finally {
            // Check if we are done with this photo
            const ops = pendingOperations.current.get(photoId);
            if (ops) {
                if (type === 'scan_result') ops.delete('scan');
                if (type === 'tags_result') ops.delete('tags');

                if (ops.size === 0) {
                    pendingOperations.current.delete(photoId);
                    completeProcessing(photoId);
                }
            } else {
                completeProcessing(photoId);
            }
        }
    };

    const completeProcessing = (photoId: number) => {
        // Notify listeners
        processedCallbacks.current.forEach(cb => cb(photoId));

        // Update state
        setProcessingQueue(prev => prev.filter(p => p.id !== photoId));
        setIsProcessing(false);
        setCurrentBatchCount(prev => prev + 1);
    };

    const skipCooldown = () => {
        if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
        setIsCoolingDown(false);
        setCooldownTimeLeft(0);
        setCurrentBatchCount(0);
    };

    // Add items to queue (deduplicate)
    const addToQueue = useCallback((newPhotos: any[]) => {
        setProcessingQueue(prev => {
            const existingIds = new Set(prev.map(p => p.id));
            const unique = newPhotos.filter(p => !existingIds.has(p.id));
            return [...prev, ...unique];
        });
    }, []);

    // Subscription mechanism
    const onPhotoProcessed = useCallback((callback: (photoId: number) => void) => {
        processedCallbacks.current.add(callback);
        return () => {
            processedCallbacks.current.delete(callback);
        };
    }, []);

    // Process Queue
    useEffect(() => {
        // Conditions to stop processing:
        // 1. Queue empty
        // 2. Already processing
        // 3. Paused
        // 4. Cooling down
        if (processingQueue.length === 0 || isProcessing || isPaused || isCoolingDown) return;

        // Check Batch Limits
        if (queueConfig.batchSize > 0 && currentBatchCount >= queueConfig.batchSize) {
            console.log(`[AI] Batch limit reached (${currentBatchCount}). Starting cooldown for ${queueConfig.cooldownSeconds}s.`);
            setIsCoolingDown(true);
            setCooldownTimeLeft(queueConfig.cooldownSeconds);

            // Start Countdown
            let timeLeft = queueConfig.cooldownSeconds;
            const interval = setInterval(() => {
                timeLeft -= 1;
                setCooldownTimeLeft(timeLeft);
                if (timeLeft <= 0) {
                    clearInterval(interval);
                    setIsCoolingDown(false);
                    setCurrentBatchCount(0);
                }
            }, 1000);

            cooldownTimerRef.current = interval; // Hacky type cast valid for browser/node
            return;
        }

        const processNext = async () => {
            setIsProcessing(true);
            const photo = processingQueue[0];

            pendingOperations.current.set(photo.id, new Set(['scan', 'tags']));

            try {
                // @ts-ignore
                await window.ipcRenderer.invoke('ai:scanImage', { photoId: photo.id });

                // Trigger Smart Tag Generation (VLM)
                // @ts-ignore
                await window.ipcRenderer.invoke('ai:generateTags', { photoId: photo.id });

            } catch (err) {
                console.error(`Failed to request scan for ${photo.id}:`, err);
                pendingOperations.current.delete(photo.id);
                completeProcessing(photo.id);
            }
        };

        processNext();
    }, [processingQueue, isProcessing, isPaused, isCoolingDown, currentBatchCount, queueConfig]);

    // Clear interval on unmount
    useEffect(() => {
        return () => {
            if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
        }
    }, [])

    return (
        <AIContext.Provider value={{
            isModelLoading,
            isModelReady,
            processingQueue,
            addToQueue,
            onPhotoProcessed,
            isPaused,
            setIsPaused,
            queueConfig,
            setQueueConfig,
            isCoolingDown,
            cooldownTimeLeft,
            skipCooldown,
            calculatingBlur,
            blurProgress,
            calculateBlurScores,
            clusterFaces,
            systemStatus,
            fetchSystemStatus,
            aiMode,
            vlmEnabled
        }}>
            {children}
        </AIContext.Provider>
    );
};
