import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';

interface AIContextType {
    isModelLoading: boolean;
    isModelReady: boolean;
    processingQueue: any[];
    addToQueue: (photos: any[]) => void;
    // Event subscription for specific or all photo updates
    onPhotoProcessed: (callback: (photoId: number) => void) => () => void;
}

const AIContext = createContext<AIContextType>({
    isModelLoading: false,
    isModelReady: false,
    processingQueue: [],
    addToQueue: () => { },
    onPhotoProcessed: () => () => { }
});

export const useAI = () => useContext(AIContext);

export const AIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isModelLoading, setIsModelLoading] = useState(true);
    const [isModelReady, setIsModelReady] = useState(false);
    const [processingQueue, setProcessingQueue] = useState<any[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    // Callbacks for photo processing events
    const processedCallbacks = useRef<Set<(photoId: number) => void>>(new Set());

    const workerRef = useRef<Worker | null>(null);

    // Initialize Worker
    useEffect(() => {
        const initWorker = async () => {
            // Create worker
            // @ts-ignore
            const worker = new Worker(new URL('../workers/scanner.worker.ts', import.meta.url), { type: 'module' });
            workerRef.current = worker;

            worker.onmessage = async (e) => {
                const { type, payload, error, photoId } = e.data;

                if (type === 'ready') {
                    console.log('[AIContext] AI Worker is ready');
                    setIsModelLoading(false);
                    setIsModelReady(true);
                } else if (type === 'result') {
                    await handleWorkerResult(payload);
                } else if (type === 'error') {
                    console.error('[AIContext] Worker Error:', error);
                    if (photoId) {
                        completeProcessing(photoId);
                    }
                }
            };

            // Start model loading in worker
            const profile = localStorage.getItem('ai_profile') || 'balanced';
            worker.postMessage({ type: 'init', payload: { profile } });
        };

        if (!workerRef.current) {
            initWorker();
        }

        return () => {
            if (workerRef.current) {
                workerRef.current.terminate();
                workerRef.current = null;
            }
        };
    }, []);

    const handleWorkerResult = async (payload: any) => {
        const { photoId, faces, tags } = payload;
        // console.log(`[AIContext] Received results for ${photoId}: ${faces.length} faces, ${tags.length} tags`);

        try {
            // Store faces (Smart Update)
            if (faces.length > 0 || tags.length > 0) {
                // @ts-ignore
                if (faces.length > 0) {
                    // @ts-ignore
                    await window.ipcRenderer.invoke('db:updateFaces', {
                        photoId,
                        faces: faces.map((f: any) => ({
                            box: f.box,
                            descriptor: f.descriptor
                        }))
                    });
                }
            }

            // Store tags
            if (tags.length > 0) {
                // @ts-ignore
                await window.ipcRenderer.invoke('db:addTags', { photoId, tags });
            }

        } catch (err) {
            console.error('Failed to save AI results to DB:', err);
        } finally {
            completeProcessing(photoId);
        }
    };

    const completeProcessing = (photoId: number) => {
        // Notify listeners
        processedCallbacks.current.forEach(cb => cb(photoId));

        // Update state
        setProcessingQueue(prev => prev.slice(1));
        setIsProcessing(false);
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
        if (!isModelReady || processingQueue.length === 0 || isProcessing || !workerRef.current) return;

        const processNext = async () => {
            setIsProcessing(true);
            const photo = processingQueue[0];
            // console.log(`[AI] Processing photo in worker: ${photo.id}`);

            try {
                // Fetch image buffer via IPC (avoiding fetch protocol issues)
                const path = photo.preview_cache_path || photo.file_path;
                // @ts-ignore
                const buffer = await window.ipcRenderer.invoke('read-file-buffer', path);
                const blob = new Blob([buffer]);

                // Create ImageBitmap (transferable)
                // @ts-ignore
                const imageBitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });

                const profile = localStorage.getItem('ai_profile') || 'balanced';

                // Send to worker
                workerRef.current?.postMessage(
                    { type: 'process', payload: { photoId: photo.id, imageBitmap, profile } },
                    [imageBitmap]
                );

            } catch (err) {
                console.error(`Failed to prepare photo ${photo.id} for worker:`, err);
                completeProcessing(photo.id);
            }
        };

        processNext();
    }, [isModelReady, processingQueue, isProcessing]);

    return (
        <AIContext.Provider value={{
            isModelLoading,
            isModelReady,
            processingQueue,
            addToQueue,
            onPhotoProcessed
        }}>
            {children}
        </AIContext.Provider>
    );
};

