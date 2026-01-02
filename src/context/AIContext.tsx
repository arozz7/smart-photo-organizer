import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useAlert } from './AlertContext';
import { useToast } from './ToastContext';

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
    isProcessing: boolean; // Exposed status
    processingQueue: any[];
    addToQueue: (photos: any[], autoStart?: boolean) => void;
    clearQueue: () => void;
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
    scanMetrics: { load: number; scan: number; tag: number; total: number; lastUpdate: number } | null;
    performanceStats: {
        averageTime: number;
        bestTime: number;
        photosProcessed: number;
        averagePerFace: number;
    };
    // Smart Throttling
    isThrottled: boolean;
    setThrottled: (throttled: boolean) => void;
}

const AIContext = createContext<AIContextType>({
    isModelLoading: false,
    isModelReady: false, // Always true now as Python is managed by Main
    isProcessing: false,
    processingQueue: [],
    addToQueue: () => { },
    clearQueue: () => { },
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
    vlmEnabled: false,
    scanMetrics: null,
    performanceStats: { averageTime: 0, bestTime: 0, photosProcessed: 0, averagePerFace: 0 },
    isThrottled: false,
    setThrottled: () => { }
});

export const useAI = () => useContext(AIContext);

export const AIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Python backend starts with Main, so we assume it's ready. 
    // We could add a check later, but for now simplify.
    const { showAlert } = useAlert();
    const { addToast } = useToast();
    const [isModelLoading] = useState(false);
    const [isModelReady] = useState(true);

    const [processingQueue, setProcessingQueue] = useState<any[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    // Queue Control State
    const [isPaused, setIsPaused] = useState(true);

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

    // Load Persisted Queue
    useEffect(() => {
        const loadQueue = async () => {
            try {
                // @ts-ignore
                const savedQueue = await window.ipcRenderer.invoke('settings:getAIQueue');
                if (savedQueue && Array.isArray(savedQueue) && savedQueue.length > 0) {
                    console.log(`[AIContext] Loaded ${savedQueue.length} pending items from storage.`);
                    setProcessingQueue(savedQueue);
                }
            } catch (e) {
                console.error("Failed to load saved queue", e);
            }
        };
        loadQueue();
    }, []);

    // Save Queue Persistence (Debounced slightly by React batching, but we can just save on change)
    useEffect(() => {
        if (!isConfigLoaded) return; // Wait for initial config load to avoid overwriting with empty? 
        // Actually we need a separate flag for Queue Loaded? 
        // Simplification: Just save whatever is in processingQueue if it changed.
        // But on initial load processingQueue is [], if we save immediately we might wipe disk.
        // So we need isQueueLoaded flag.
    }, [processingQueue]);

    // Better approach: modifying addToQueue and completeProcessing to save? 
    // Or just use a ref to track if we loaded.
    const isQueueLoaded = useRef(false);

    useEffect(() => {
        const loadQueue = async () => {
            try {
                // @ts-ignore
                const savedQueue = await window.ipcRenderer.invoke('settings:getAIQueue');
                if (savedQueue && Array.isArray(savedQueue) && savedQueue.length > 0) {
                    console.log(`[AIContext] Loaded ${savedQueue.length} pending items from storage.`);
                    setProcessingQueue(savedQueue);
                }
            } catch (e) {
                console.error("Failed to load saved queue", e);
            } finally {
                isQueueLoaded.current = true;
            }
        };
        loadQueue();
    }, []);

    useEffect(() => {
        if (!isQueueLoaded.current) return;
        // @ts-ignore
        window.ipcRenderer.invoke('settings:setAIQueue', processingQueue).catch(e => console.error("Failed to save queue", e));
    }, [processingQueue]);

    const [currentBatchCount, setCurrentBatchCount] = useState(0);
    const [isCoolingDown, setIsCoolingDown] = useState(false);
    const [cooldownTimeLeft, setCooldownTimeLeft] = useState(0);
    const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);

    const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
    const [aiMode, setAiMode] = useState<'UNKNOWN' | 'GPU' | 'CPU' | 'SAFE_MODE'>('UNKNOWN');
    const [vlmEnabled, setVlmEnabled] = useState(false);
    const [scanMetrics, setScanMetrics] = useState<{ load: number; scan: number; tag: number; total: number; lastUpdate: number } | null>(null);
    const [performanceStats, setPerformanceStats] = useState({ averageTime: 0, bestTime: 0, photosProcessed: 0, averagePerFace: 0 });
    const [isThrottled, setThrottled] = useState(false);

    const fetchSystemStatus = useCallback(async () => {
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('ai:command', { type: 'get_system_status' });
            if (result && result.type === 'system_status_result') {
                setSystemStatus(result.status);
            }
            // Also check ping for live mode
            // @ts-ignore
            const ping = await window.ipcRenderer.invoke('ai:command', { type: 'ping' });
            if (ping && ping.aiMode) {
                setAiMode(ping.aiMode);
            }
        } catch (error) {
            console.error("Failed to fetch system status:", error);
        }
    }, []);

    // Status Polling Effect
    useEffect(() => {
        // Run once on mount
        fetchSystemStatus();

        // Determine interval: 
        // - 5s if we are processing OR if aiMode is unknown (initializing)
        // - 30s if idle
        const interval = (isProcessing || aiMode === 'UNKNOWN') ? 5000 : 30000;
        const intervalId = setInterval(fetchSystemStatus, interval);

        return () => clearInterval(intervalId);
    }, [fetchSystemStatus, isProcessing, aiMode]);

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
                    setBlurProgress({ current: i + 1, total });
                }
                addToast({ type: 'success', description: `Finished calculating blur scores for ${total} photos.` });
            } else if (res.success) {
                addToast({ type: 'info', description: 'No photos found missing blur scores.' });
            } else {
                addToast({ type: 'error', description: "Failed to find photos: " + res.error });
            }

            // Save FAISS Index after batch operation to ensure persistence
            // @ts-ignore
            await window.ipcRenderer.invoke('ai:saveVectorIndex');
            console.log("[AI] Blur Scores Calculated. Vector Index Saved.");

        } catch (e) {
            addToast({ type: 'error', description: "Error calculating blur" });
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

    // Cache for results to allow multi-step decision making
    const resultCache = useRef<Map<string, any>>(new Map());

    // Listen for AI results from Main Process
    useEffect(() => {
        // @ts-ignore
        const cleanup = window.ipcRenderer.on('ai:scan-result', (payload: any) => {
            handleScanResult(payload);
        });

        return () => {
            if (typeof cleanup === 'function') {
                (cleanup as unknown as () => void)();
            }
        };
    }, []);

    const handleScanResult = async (payload: any) => {
        const { photoId, faces, tags, error, type, previewPath, width, height, metrics } = payload;

        if (metrics) {
            setScanMetrics({ ...metrics, lastUpdate: Date.now() });

            // Fetch Aggregate DB Stats
            // We use the DB for the long-term averages to be more accurate across restarts
            try {
                // @ts-ignore
                const historyRes = await window.ipcRenderer.invoke('db:getMetricsHistory', 50); // Fetch recent for debugging? Not needed here.
                // Actually the stats property is what we want
                if (historyRes.success && historyRes.stats) {
                    const { total_scans, total_processing_time, total_faces } = historyRes.stats;

                    // Avg Total Time per Photo
                    const avgTime = total_scans > 0 ? (total_processing_time / total_scans) : 0;

                    // Avg Per Face (Total Time / Total Faces) - Just for reference
                    const avgPerFace = total_faces > 0 ? (total_processing_time / total_faces) : 0;

                    setPerformanceStats(prev => ({
                        averageTime: avgTime,
                        bestTime: Math.min(prev.bestTime || 999999, metrics.total), // Keep session best for "Record" feeling
                        photosProcessed: total_scans, // All time
                        averagePerFace: avgPerFace
                    }));
                }
            } catch (e) {
                console.error("Failed to update stats", e);
            }
        }

        if (error) {
            console.error(`[AIContext] Error for ${photoId}:`, error);

            if (error.includes('AI_CRITICAL_FAILURE') || error.includes('AI_MODELS_MISSING')) {
                // Determine severity
                const isCritical = error.includes('AI_CRITICAL_FAILURE');

                showAlert({
                    title: isCritical ? 'AI Engine Critical Failure' : 'AI Runtime Issue',
                    description: `Face Analysis failed. ${payload.details || error}`,
                    variant: 'danger',
                    confirmLabel: 'Settings',
                    onConfirm: () => { window.location.hash = '#/settings'; }
                });

                // Pause Queue to prevent spam if critical
                setIsPaused(true);
            }
        }

        try {
            // Handle Analysis Result (Unified)
            if (type === 'analysis_result') {
                // 1. Save Faces
                if (faces && faces.length > 0) {
                    // @ts-ignore
                    const dbFaces = await window.ipcRenderer.invoke('db:updateFaces', {
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

                    // 2. Add to Vector Index (Immediate)
                    if (dbFaces.success && dbFaces.ids && dbFaces.ids.length === faces.length) {
                        const newVectors = faces.map((f: any) => f.descriptor);
                        const newIds = dbFaces.ids;

                        // @ts-ignore
                        window.ipcRenderer.invoke('ai:addFacesToVectorIndex', {
                            vectors: newVectors,
                            ids: newIds
                        }).then(() => {
                            // Refresh status to show updated count immediately
                            fetchSystemStatus();
                        }).catch((err: any) => console.error("Failed to update in-memory index:", err));
                    }


                }

                // 3. Save Tags
                if (tags && tags.length > 0) {
                    // @ts-ignore
                    const curTags = await window.ipcRenderer.invoke('db:addTags', { photoId, tags });
                }

                completeProcessing(photoId, payload.scanMode || 'FAST');
                return;
            }

            // Legacy Handling (scan_image / generate_tags)
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
            completeProcessing(photoId, payload.scanMode || 'FAST'); // Release queue even on error context
        } finally {
            // Check if we are done with this photo
            const ops = pendingOperations.current.get(photoId);
            if (ops) {
                // Legacy tracking
                if (type === 'scan_result') {
                    ops.delete('scan');
                    resultCache.current.set(`${photoId}_scan_data`, { faces: faces || [], mode: payload.scanMode || 'FAST' });
                }
                if (type === 'tags_result') {
                    ops.delete('tags');
                    resultCache.current.set(`${photoId}_tags_data`, tags || []);
                }

                if (ops.size === 0) {
                    const scanData = resultCache.current.get(`${photoId}_scan_data`);
                    const tagsData = resultCache.current.get(`${photoId}_tags_data`) || [];

                    pendingOperations.current.delete(photoId);
                    resultCache.current.delete(`${photoId}_scan_data`);
                    resultCache.current.delete(`${photoId}_tags_data`);

                    if (scanData) {
                        handleRetryDecision(photoId, scanData, tagsData);
                    }
                    const removalMode = scanData?.mode || payload.scanMode || 'FAST';
                    completeProcessing(photoId, removalMode);
                }
            } else {
                // For types that are not tracked (like analysis_result which clears itself above, or untracked legacy)
                if (type !== 'analysis_result') { // analysis_result handled above
                    completeProcessing(photoId, payload.scanMode || 'FAST');
                }
            }
        }
    };

    const handleRetryDecision = (photoId: number, scanData: any, tags: string[]) => {
        const { faces, mode } = scanData;




        // Strategy: 
        // 1. FAST (Default) -> If 0 faces AND (Has Person Tags OR No Tags) -> Retry BALANCED
        // 2. BALANCED -> If 0 faces -> Retry MACRO
        // 3. MACRO -> Done

        if (faces.length > 0) return; // Found faces, we are good.

        const PERSON_KEYWORDS = ['man', 'woman', 'person', 'face', 'girl', 'boy', 'child', 'human', 'portrait', 'smile', 'selfie', 'people', 'couple', 'beard', 'hair'];

        // Heuristic: Does the image likely contain a person?
        // If tags are empty, we assume YES (safe fallback).
        // If tags exist, we check for keywords.
        const hasPersonTags = tags.length === 0 || tags.some(t => PERSON_KEYWORDS.some(k => t.toLowerCase().includes(k)));



        // --- SETTINGS AWARE DECISION ---
        const aiProfile = localStorage.getItem('ai_profile') || 'balanced';
        const isGPU = aiMode === 'GPU';

        // HIGH PERFORMANCE PATH (GPU or High Profile selected)
        const highPerformance = isGPU || aiProfile === 'high';



        // 1. FAST/STANDARD (1280x1280) - Initial Scan
        if (mode === 'FAST') {
            if (!hasPersonTags && !highPerformance) {
                // In Balanced/CPU mode, we trust the tags aggressivey to save time
                return;
            }

            // If High Performance OR Has Person Tags -> Retry
            addToQueue([{ id: photoId, scanMode: 'BALANCED' }]);
        }

        // 2. BALANCED/PORTRAIT (640x640)
        else if (mode === 'BALANCED') {
            // If we are significantly powerful, we continue.
            addToQueue([{ id: photoId, scanMode: 'MACRO' }]);
        }
        // 3. MACRO (320x320) -> End of line.
    };

    const clearQueue = useCallback(() => {
        setProcessingQueue([]);
        setIsProcessing(false);
        setCurrentBatchCount(0);
        console.log("[AI] Queue cleared by user.");
    }, []);



    const completeProcessing = (photoId: number, scanMode: string = 'FAST') => {
        // Notify listeners
        processedCallbacks.current.forEach(cb => cb(photoId));

        // Update state
        setProcessingQueue(prev => {
            if (prev.length === 0) return prev;

            // Strict Serial Processing Check
            // We only remove the item if it matches the HEAD of the queue.
            // If we receive a result for an ID that is not at the head, it implies an off-queue operation (like Blur Calc)
            // or a race condition. In either case, we generally shouldn't modify the queue order for non-head items 
            // to maintain FIFO and prevent accidental removal of pending items.
            const head = prev[0];
            if (head.id !== photoId) {
                // Result does not match current queue task. Ignore it.
                return prev;
            }

            // Mode Satisfaction Check
            // FAST = 1, BALANCED = 2, MACRO = 3
            const getScore = (m?: string) => {
                if (m === 'MACRO') return 3;
                if (m === 'BALANCED') return 2;
                return 1; // FAST or undefined
            };

            const queueScore = getScore(head.scanMode);
            const resultScore = getScore(scanMode);

            if (resultScore >= queueScore) {
                // The result satisfies the queue requirement (Equal or Better). Remove it.
                const next = prev.slice(1);

                // Check if queue empty (Auto-Save Index)
                if (next.length === 0 && prev.length > 0) {
                    console.log("[AI] Queue empty. Saving Vector Index...");
                    // @ts-ignore
                    window.ipcRenderer.invoke('ai:saveVectorIndex').then(res => {
                        if (res.success) console.log("[AI] Vector Index Saved.");
                        else console.error("[AI] Failed to save Vector Index:", res.error);
                    });
                }
                return next;
            } else {
                // The result was lower quality (e.g. Blur Calc running FAST while Queue wants BALANCED).
                // Keep the queue item so it processes with high quality.
                console.log(`[AI] Result for ${photoId} (Mode: ${scanMode}) insufficient for Queue (Mode: ${head.scanMode}). Keeping in queue.`);
                return prev;
            }
        });

        setIsProcessing(false);
        setCurrentBatchCount(prev => prev + 1);
    };

    const skipCooldown = () => {
        if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
        setIsCoolingDown(false);
        setCooldownTimeLeft(0);
        setCurrentBatchCount(0);
    };

    // Load AI Profile to determine default mode
    const aiProfileRef = useRef<'balanced' | 'high'>('balanced');

    useEffect(() => {
        // @ts-ignore
        window.ipcRenderer.invoke('ai:getSettings').then((settings: any) => {
            if (settings) {
                if (settings.aiProfile) {
                    aiProfileRef.current = settings.aiProfile;
                    console.log('[AIContext] Loaded AI Profile:', settings.aiProfile);
                }
                // Load VLM Enabled Preference
                if (settings.vlmEnabled !== undefined) {
                    setVlmEnabled(settings.vlmEnabled);
                    console.log('[AIContext] Loaded VLM Preference:', settings.vlmEnabled);
                }
            }
        });
    }, []);

    // Add items to queue (deduplicate based on ID + Mode)
    const addToQueue = useCallback((newPhotos: any[], autoStart: boolean = false) => {
        setProcessingQueue(prev => {
            // Determine default mode based on profile
            const defaultMode = aiProfileRef.current === 'high' ? 'MACRO' : 'FAST';

            // Create a set of composite keys "ID:MODE" for existing items
            const existingKeys = new Set(prev.map(p => `${p.id}:${p.scanMode || defaultMode}`));

            const unique = newPhotos.filter(p => {
                const mode = p.scanMode || defaultMode;
                const key = `${p.id}:${mode}`;
                return !existingKeys.has(key);
            }).map(p => ({ ...p, scanMode: p.scanMode || defaultMode }));

            if (unique.length > 0) {
                console.log(`[AI] Added ${unique.length} items to queue (Default Mode: ${defaultMode})`);
            }

            // Auto-Start Logic
            // FIX: If user requested auto-start, unpause even if items were already in queue (unique.length === 0)
            if (autoStart && newPhotos.length > 0) {
                setIsPaused(false);
                console.log("[AI] Auto-Starting Queue (Action Triggered)");
            }

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

            // Unified Analysis
            // Check if we want VLM based on user settings or mode?
            // For now, enable VLM if available AND not in FAST mode?
            // Actually, FAST mode skipping VLM is a good optimization. 
            // The prompt said "High Accuracy scanning is very slow". 
            // So sticking to user intent:
            // - FAST: Faces Only
            // - BALANCED: Faces + Tags (Maybe?)
            // - HIGH: Faces + Tags

            // Dynamic Mode Upgrade
            // If profile is High Accuracy but item is FAST (e.g. race condition on startup), upgrade it.
            let effectiveMode = photo.scanMode || 'FAST';
            if (aiProfileRef.current === 'high' && effectiveMode === 'FAST') {
                effectiveMode = 'MACRO';
                console.log(`[AI] Auto-upgraded ${photo.id} to MACRO mode based on profile.`);
            }

            const isHighAccuracy = effectiveMode === 'BALANCED' || effectiveMode === 'MACRO' || aiMode === 'GPU';
            const enableVLM = vlmEnabled && isHighAccuracy && effectiveMode !== 'FAST';

            try {
                // @ts-ignore
                await window.ipcRenderer.invoke('ai:analyzeImage', {
                    photoId: photo.id,
                    scanMode: effectiveMode,
                    enableVLM
                });

            } catch (err) {
                console.error(`Failed to request analysis for ${photo.id}:`, err);
                completeProcessing(photo.id, photo.scanMode || 'FAST');
            }
        };

        if (isThrottled) {
            // Add significant delay if throttled to free up UI thread
            console.log("[AI] Throttling active: Slowing down queue processing...");
            const timer = setTimeout(processNext, 1000); // 1s delay
            return () => clearTimeout(timer);
        } else {
            processNext();
        }

    }, [processingQueue, isProcessing, isPaused, isCoolingDown, currentBatchCount, queueConfig, isThrottled]);

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
            clearQueue,
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
            vlmEnabled,
            scanMetrics,
            performanceStats,
            isThrottled,
            setThrottled,
            isProcessing // Exposed for UI status
        }}>
            {children}
        </AIContext.Provider>
    );
};
