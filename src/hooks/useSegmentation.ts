import { useState, useCallback, useRef, useEffect } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PromptMode = 'text' | 'box' | 'points'
export type Operation = 'background-remove' | 'isolate' | 'blur' | 'enhance' | 'desaturate-bg' | 'fill-bg'

export interface MaskResult {
    mask_b64: string
    score: number
    area: number
}

export interface Capabilities {
    model_ready: boolean
    text_prompts: boolean
    provider: string
    checkpoint?: string
    model_file_present?: boolean
    transformers_compatible?: boolean
    install_hint?: string
    error?: string
}

export interface PointPrompt {
    x: number        // image-space coordinates
    y: number
    label: 1 | 0    // 1 = positive, 0 = negative
}

export interface SegmentState {
    capabilities: Capabilities | null
    sessionId: string | null
    imagePath: string | null
    promptMode: PromptMode
    text: string
    points: PointPrompt[]
    box: [number, number, number, number] | null  // [x1,y1,x2,y2] image-space
    masks: MaskResult[]
    selectedMaskIdx: number
    resultB64: string | null
    isPredicting: boolean
    isApplying: boolean
    isLoadingImage: boolean
    error: string | null
}

const INITIAL_STATE: SegmentState = {
    capabilities: null,
    sessionId: null,
    imagePath: null,
    promptMode: 'text',
    text: '',
    points: [],
    box: null,
    masks: [],
    selectedMaskIdx: 0,
    resultB64: null,
    isPredicting: false,
    isApplying: false,
    isLoadingImage: false,
    error: null,
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSegmentation() {
    const [state, setState] = useState<SegmentState>(INITIAL_STATE)

    // Stable ref for session ID so async callbacks never close over stale value
    const sessionRef = useRef<string | null>(null)

    // Refs for values read by async callbacks — updated after every render so
    // predict() and applyOperation() never close over stale state.
    const promptModeRef = useRef<PromptMode>(INITIAL_STATE.promptMode)
    const textRef = useRef<string>(INITIAL_STATE.text)
    const pointsRef = useRef<PointPrompt[]>(INITIAL_STATE.points)
    const boxRef = useRef<[number, number, number, number] | null>(INITIAL_STATE.box)
    const masksRef = useRef<MaskResult[]>(INITIAL_STATE.masks)
    const selectedMaskIdxRef = useRef<number>(INITIAL_STATE.selectedMaskIdx)

    // No dependency array — runs after every render to stay fully in sync
    useEffect(() => {
        promptModeRef.current = state.promptMode
        textRef.current = state.text
        pointsRef.current = state.points
        boxRef.current = state.box
        masksRef.current = state.masks
        selectedMaskIdxRef.current = state.selectedMaskIdx
    })

    // ------------------------------------------------------------------
    // Model capabilities
    // ------------------------------------------------------------------

    const checkCapabilities = useCallback(async () => {
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('ai:segment:capabilities')
            if (res?.success) {
                setState(s => ({ ...s, capabilities: res as Capabilities, error: null }))
            }
        } catch (e) {
            // Non-fatal — capabilities check runs on mount, failure just means model not ready
            console.warn('[Segment] capabilities check failed:', e)
        }
    }, [])

    // ------------------------------------------------------------------
    // Load image
    // ------------------------------------------------------------------

    const loadImage = useCallback(async (filePath: string) => {
        setState(s => ({ ...s, isLoadingImage: true, error: null }))
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('ai:segment:setImage', { imagePath: filePath })
            if (!res?.success) throw new Error(res?.error ?? 'Failed to load image')

            sessionRef.current = res.session_id
            setState(s => ({
                ...s,
                sessionId: res.session_id,
                imagePath: filePath,
                isLoadingImage: false,
                points: [],
                box: null,
                text: '',
                masks: [],
                selectedMaskIdx: 0,
                resultB64: null,
                error: null,
            }))
        } catch (e: any) {
            setState(s => ({ ...s, isLoadingImage: false, error: e.message }))
        }
    }, [])

    const openImageDialog = useCallback(async () => {
        try {
            // @ts-ignore
            const filePath: string | null = await window.ipcRenderer.invoke('dialog:openFile', {
                filters: [
                    { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif', 'webp'] },
                ],
            })
            if (!filePath) return
            await loadImage(filePath)
        } catch (e: any) {
            setState(s => ({ ...s, isLoadingImage: false, error: e.message }))
        }
    }, [loadImage])

    // ------------------------------------------------------------------
    // Prompt helpers
    // ------------------------------------------------------------------

    const setPromptMode = useCallback((mode: PromptMode) => {
        setState(s => {
            if (s.promptMode === mode) return s
            return {
                ...s,
                promptMode: mode,
                points: [],
                // Preserve box when switching Box→Points for combined-prompt mode
                box: mode === 'points' ? s.box : null,
                masks: [],
                selectedMaskIdx: 0,
                resultB64: null,
            }
        })
    }, [])

    const setText = useCallback((text: string) => {
        setState(s => ({ ...s, text }))
    }, [])

    const addPoint = useCallback((pt: PointPrompt) => {
        setState(s => ({ ...s, points: [...s.points, pt] }))
    }, [])

    const removePoint = useCallback((index: number) => {
        setState(s => ({ ...s, points: s.points.filter((_, i) => i !== index) }))
    }, [])

    const movePoint = useCallback((index: number, pt: PointPrompt) => {
        setState(s => {
            const updated = [...s.points]
            updated[index] = pt
            return { ...s, points: updated }
        })
    }, [])

    const setBox = useCallback((box: [number, number, number, number] | null) => {
        setState(s => ({ ...s, box }))
    }, [])

    const clearPrompts = useCallback(() => {
        setState(s => ({ ...s, points: [], box: null, text: '', masks: [], selectedMaskIdx: 0, resultB64: null, error: null }))
    }, [])

    const setSelectedMaskIdx = useCallback((idx: number) => {
        setState(s => ({ ...s, selectedMaskIdx: idx, resultB64: null }))
    }, [])

    // ------------------------------------------------------------------
    // Predict
    //
    // overridePoints / overrideBox allow callers to pass values that were
    // just set via addPoint/setBox in the same synchronous event handler,
    // before the refs have been updated by the next render cycle.
    // ------------------------------------------------------------------

    const predict = useCallback(async (override?: {
        points?: PointPrompt[]
        box?: [number, number, number, number] | null
        text?: string
    }) => {
        const currentSession = sessionRef.current
        if (!currentSession) return

        setState(s => ({ ...s, isPredicting: true, error: null }))

        try {
            const promptMode = promptModeRef.current
            const points = override?.points ?? pointsRef.current
            const box = override?.box ?? boxRef.current
            const text = override?.text ?? textRef.current

            let payload: Record<string, unknown> = { session_id: currentSession }

            if (promptMode === 'text' && text.trim()) {
                payload = { session_id: currentSession, text: text.trim() }
            } else if (box && points.length > 0) {
                // Combined box + points (works in both box and points mode)
                payload = {
                    session_id: currentSession,
                    box,
                    points: points.map(p => [p.x, p.y]),
                    point_labels: points.map(p => p.label),
                }
            } else if (box) {
                payload = { session_id: currentSession, box }
            } else if (points.length > 0) {
                payload = {
                    session_id: currentSession,
                    points: points.map(p => [p.x, p.y]),
                    point_labels: points.map(p => p.label),
                }
            }

            // @ts-ignore
            const res = await window.ipcRenderer.invoke('ai:segment:predict', payload)
            if (!res?.success) throw new Error(res?.error ?? 'Prediction failed')

            setState(s => ({
                ...s,
                masks: res.masks ?? [],
                selectedMaskIdx: 0,
                isPredicting: false,
                error: null,
            }))
        } catch (e: any) {
            setState(s => ({ ...s, isPredicting: false, error: e.message }))
        }
    }, [])

    // ------------------------------------------------------------------
    // Apply operation
    // ------------------------------------------------------------------

    const applyOperation = useCallback(async (operation: Operation, params?: {
        radius?: number
        featherRadius?: number
        color?: string
    }) => {
        // Read current values synchronously from refs — avoids the setState-as-read anti-pattern
        const sessionId = sessionRef.current
        const masks = masksRef.current
        const selectedMaskIdx = selectedMaskIdxRef.current
        const maskB64 = masks[selectedMaskIdx]?.mask_b64 ?? ''

        if (!sessionId || !maskB64) {
            setState(s => ({ ...s, error: 'No mask selected' }))
            return
        }

        setState(s => ({ ...s, isApplying: true, error: null }))

        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('ai:segment:apply', {
                session_id: sessionId,
                operation,
                mask_b64: maskB64,
                ...(params?.radius !== undefined ? { radius: params.radius } : {}),
                ...(params?.featherRadius !== undefined ? { feather_radius: params.featherRadius } : {}),
                ...(params?.color !== undefined ? { color: params.color } : {}),
            })

            if (!res?.success) throw new Error(res?.error ?? 'Apply failed')

            setState(s => ({ ...s, resultB64: res.result_b64, isApplying: false, error: null }))
        } catch (e: any) {
            setState(s => ({ ...s, isApplying: false, error: e.message }))
        }
    }, [])

    // ------------------------------------------------------------------
    // Reset
    // ------------------------------------------------------------------

    const reset = useCallback(() => {
        sessionRef.current = null
        setState(INITIAL_STATE)
    }, [])

    return {
        state,
        checkCapabilities,
        loadImage,
        openImageDialog,
        setPromptMode,
        setText,
        addPoint,
        removePoint,
        movePoint,
        setBox,
        clearPrompts,
        setSelectedMaskIdx,
        predict,
        applyOperation,
        reset,
    }
}
