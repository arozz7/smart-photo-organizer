import { useState, useCallback, useRef, useEffect } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PromptMode = 'text' | 'box' | 'points' | 'exemplar'
export type Operation =
    | 'background-remove' | 'isolate' | 'blur' | 'enhance'
    | 'desaturate-bg' | 'fill-bg'
    | 'pixelate-bg' | 'spotlight' | 'color-tint'

// Load a mask PNG (base64) into an HTMLImageElement
function loadMaskImage(b64: string): Promise<HTMLImageElement> {
    return new Promise(resolve => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.src = `data:image/png;base64,${b64}`
    })
}

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

export interface LastOp {
    operation: Operation
    extra?: {
        radius?: number
        color?: string
        pixelSize?: number
        spotlightBrightness?: number
        tintOpacity?: number
    }
}

export interface SegmentState {
    capabilities: Capabilities | null
    sessionId: string | null
    imagePath: string | null
    promptMode: PromptMode
    text: string
    points: PointPrompt[]
    box: [number, number, number, number] | null  // [x1,y1,x2,y2] image-space
    exemplarBox: [number, number, number, number] | null
    exemplarNegBoxes: [number, number, number, number][]
    masks: MaskResult[]
    selectedMaskIdx: number
    resultB64: string | null
    isPredicting: boolean
    isApplying: boolean
    isLoadingImage: boolean
    error: string | null
    // Text-mode confidence thresholds
    textThreshold: number
    maskThreshold: number
    // Global mask modifiers (apply to every operation)
    featherRadius: number
    invertSelection: boolean
    lastOp: LastOp | null
}

const INITIAL_STATE: SegmentState = {
    capabilities: null,
    sessionId: null,
    imagePath: null,
    promptMode: 'text',
    text: '',
    points: [],
    box: null,
    exemplarBox: null,
    exemplarNegBoxes: [],
    masks: [],
    selectedMaskIdx: 0,
    resultB64: null,
    isPredicting: false,
    isApplying: false,
    isLoadingImage: false,
    error: null,
    textThreshold: 0.5,
    maskThreshold: 0.5,
    featherRadius: 0,
    invertSelection: false,
    lastOp: null,
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
    const exemplarBoxRef = useRef<[number, number, number, number] | null>(INITIAL_STATE.exemplarBox)
    const exemplarNegBoxesRef = useRef<[number, number, number, number][]>(INITIAL_STATE.exemplarNegBoxes)
    const masksRef = useRef<MaskResult[]>(INITIAL_STATE.masks)
    const selectedMaskIdxRef = useRef<number>(INITIAL_STATE.selectedMaskIdx)
    const textThresholdRef = useRef<number>(INITIAL_STATE.textThreshold)
    const maskThresholdRef = useRef<number>(INITIAL_STATE.maskThreshold)
    const featherRadiusRef = useRef<number>(INITIAL_STATE.featherRadius)
    const invertSelectionRef = useRef<boolean>(INITIAL_STATE.invertSelection)
    const lastOpRef = useRef<LastOp | null>(INITIAL_STATE.lastOp)
    const thresholdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const featherTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // No dependency array — runs after every render to stay fully in sync
    useEffect(() => {
        promptModeRef.current = state.promptMode
        textRef.current = state.text
        pointsRef.current = state.points
        boxRef.current = state.box
        exemplarBoxRef.current = state.exemplarBox
        exemplarNegBoxesRef.current = state.exemplarNegBoxes
        masksRef.current = state.masks
        selectedMaskIdxRef.current = state.selectedMaskIdx
        textThresholdRef.current = state.textThreshold
        maskThresholdRef.current = state.maskThreshold
        featherRadiusRef.current = state.featherRadius
        invertSelectionRef.current = state.invertSelection
        lastOpRef.current = state.lastOp
    })

    // Auto re-predict when confidence/mask thresholds change in text mode.
    // Debounced 600 ms so rapid slider drags don't fire on every tick.
    useEffect(() => {
        if (
            state.promptMode !== 'text' ||
            !state.text.trim() ||
            !sessionRef.current ||
            state.isPredicting
        ) return

        if (thresholdTimerRef.current) clearTimeout(thresholdTimerRef.current)
        thresholdTimerRef.current = setTimeout(() => { predict() }, 600)

        return () => {
            if (thresholdTimerRef.current) clearTimeout(thresholdTimerRef.current)
        }
    }, [state.textThreshold, state.maskThreshold]) // eslint-disable-line react-hooks/exhaustive-deps

    // Auto re-apply when invert selection is toggled (instant — no debounce needed).
    useEffect(() => {
        if (!lastOpRef.current || !masksRef.current.length || !sessionRef.current) return
        const op = lastOpRef.current
        applyOperation(op.operation, { featherRadius: featherRadiusRef.current, ...op.extra })
    }, [state.invertSelection]) // eslint-disable-line react-hooks/exhaustive-deps

    // Auto re-apply the last operation when feather radius changes.
    // Debounced 600 ms so rapid slider drags coalesce into one IPC call.
    useEffect(() => {
        if (!lastOpRef.current || !masksRef.current.length || !sessionRef.current) return

        if (featherTimerRef.current) clearTimeout(featherTimerRef.current)
        featherTimerRef.current = setTimeout(() => {
            const op = lastOpRef.current!
            applyOperation(op.operation, { featherRadius: featherRadiusRef.current, ...op.extra })
        }, 600)

        return () => {
            if (featherTimerRef.current) clearTimeout(featherTimerRef.current)
        }
    }, [state.featherRadius]) // eslint-disable-line react-hooks/exhaustive-deps

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
                // Clear exemplar state when leaving exemplar mode
                exemplarBox: mode === 'exemplar' ? s.exemplarBox : null,
                exemplarNegBoxes: mode === 'exemplar' ? s.exemplarNegBoxes : [],
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

    const setExemplarBox = useCallback((box: [number, number, number, number] | null) => {
        setState(s => ({ ...s, exemplarBox: box }))
    }, [])

    const addExemplarNegBox = useCallback((box: [number, number, number, number]) => {
        setState(s => ({ ...s, exemplarNegBoxes: [...s.exemplarNegBoxes, box] }))
    }, [])

    const removeExemplarNegBox = useCallback((idx: number) => {
        setState(s => ({ ...s, exemplarNegBoxes: s.exemplarNegBoxes.filter((_, i) => i !== idx) }))
    }, [])

    const clearExemplarBoxes = useCallback(() => {
        setState(s => ({ ...s, exemplarBox: null, exemplarNegBoxes: [], masks: [], selectedMaskIdx: 0, resultB64: null, error: null }))
    }, [])

    const clearPrompts = useCallback(() => {
        setState(s => ({ ...s, points: [], box: null, text: '', exemplarBox: null, exemplarNegBoxes: [], masks: [], selectedMaskIdx: 0, resultB64: null, error: null }))
    }, [])

    const setSelectedMaskIdx = useCallback((idx: number) => {
        setState(s => ({ ...s, selectedMaskIdx: idx, resultB64: null }))
    }, [])

    const setTextThreshold = useCallback((v: number) => {
        setState(s => ({ ...s, textThreshold: v }))
    }, [])

    const setMaskThreshold = useCallback((v: number) => {
        setState(s => ({ ...s, maskThreshold: v }))
    }, [])

    const setFeatherRadius = useCallback((v: number) => {
        setState(s => ({ ...s, featherRadius: v }))
    }, [])

    const setInvertSelection = useCallback((v: boolean) => {
        setState(s => ({ ...s, invertSelection: v }))
    }, [])

    const unionAllMasks = useCallback(async () => {
        const masks = masksRef.current
        if (masks.length <= 1) return

        const imgs = await Promise.all(masks.map(m => loadMaskImage(m.mask_b64)))
        const canvas = document.createElement('canvas')
        canvas.width = imgs[0].naturalWidth
        canvas.height = imgs[0].naturalHeight
        const ctx = canvas.getContext('2d')!

        ctx.drawImage(imgs[0], 0, 0)
        ctx.globalCompositeOperation = 'lighten'
        for (let i = 1; i < imgs.length; i++) {
            ctx.drawImage(imgs[i], 0, 0)
        }

        const unioned = canvas.toDataURL('image/png').split(',')[1]
        const totalArea = masks.reduce((sum, m) => sum + m.area, 0)

        setState(s => ({
            ...s,
            masks: [{ mask_b64: unioned, score: 1.0, area: totalArea }],
            selectedMaskIdx: 0,
            resultB64: null,
        }))
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
        exemplarBox?: [number, number, number, number] | null
        exemplarNegBoxes?: [number, number, number, number][]
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

            const exemplarBox = override?.exemplarBox !== undefined ? override.exemplarBox : exemplarBoxRef.current
            const exemplarNegBoxes = override?.exemplarNegBoxes ?? exemplarNegBoxesRef.current

            if (promptMode === 'exemplar' && exemplarBox) {
                payload = {
                    session_id: currentSession,
                    exemplar_box: exemplarBox,
                    exemplar_neg_boxes: exemplarNegBoxes,
                }
            } else if (promptMode === 'text' && text.trim()) {
                payload = {
                    session_id: currentSession,
                    text: text.trim(),
                    text_threshold: textThresholdRef.current,
                    mask_threshold: maskThresholdRef.current,
                }
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
        pixelSize?: number
        spotlightBrightness?: number
        tintOpacity?: number
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
                invert_mask: invertSelectionRef.current,
                ...(params?.featherRadius !== undefined ? { feather_radius: params.featherRadius } : {}),
                ...(params?.radius !== undefined ? { radius: params.radius } : {}),
                ...(params?.color !== undefined ? { color: params.color } : {}),
                ...(params?.pixelSize !== undefined ? { pixel_size: params.pixelSize } : {}),
                ...(params?.spotlightBrightness !== undefined ? { brightness: params.spotlightBrightness } : {}),
                ...(params?.tintOpacity !== undefined ? { tint_opacity: params.tintOpacity } : {}),
            })

            if (!res?.success) throw new Error(res?.error ?? 'Apply failed')

            // Record which operation ran so the feather/invert debounce can re-apply it
            const extra: LastOp['extra'] = {}
            if (params?.radius !== undefined) extra.radius = params.radius
            if (params?.color !== undefined) extra.color = params.color
            if (params?.pixelSize !== undefined) extra.pixelSize = params.pixelSize
            if (params?.spotlightBrightness !== undefined) extra.spotlightBrightness = params.spotlightBrightness
            if (params?.tintOpacity !== undefined) extra.tintOpacity = params.tintOpacity

            setState(s => ({
                ...s,
                resultB64: res.result_b64,
                isApplying: false,
                error: null,
                lastOp: { operation, extra: Object.keys(extra).length ? extra : undefined },
            }))
        } catch (e: any) {
            setState(s => ({ ...s, isApplying: false, error: e.message }))
        }
    }, [])

    // ------------------------------------------------------------------
    // Save result to library
    // ------------------------------------------------------------------

    const saveResult = useCallback(async (): Promise<{ savedPath: string } | { error: string }> => {
        const resultB64 = state.resultB64
        const sourcePath = state.imagePath
        if (!resultB64 || !sourcePath) return { error: 'No result to save' }

        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('creative:saveResult', { resultB64, sourcePath })
            if (!res?.success) return { error: res?.error ?? 'Save failed' }
            return { savedPath: res.savedPath }
        } catch (e: any) {
            return { error: e.message ?? 'Save failed' }
        }
    }, [state.resultB64, state.imagePath])

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
        setExemplarBox,
        addExemplarNegBox,
        removeExemplarNegBox,
        clearExemplarBoxes,
        clearPrompts,
        setSelectedMaskIdx,
        setTextThreshold,
        setMaskThreshold,
        setFeatherRadius,
        setInvertSelection,
        unionAllMasks,
        predict,
        applyOperation,
        saveResult,
        reset,
    }
}
