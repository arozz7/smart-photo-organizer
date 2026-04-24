import { useState, useCallback, useRef, useEffect } from 'react'
import { INITIAL_STATE } from '../types/segmentation'
import type { PromptMode, Operation, MaskResult, Capabilities, PointPrompt, SegmentState, ActiveOp, OpExtra, LastAdjustment } from '../types/segmentation'
import { BG_OPS, runOpsIPC, runAdjustmentIPC, computeUnionMask } from './segmentationChain'

// Re-export types for backwards compat with existing consumers
export type { PromptMode, Operation, MaskResult, Capabilities, PointPrompt, SegmentState, ActiveOp, OpExtra, LastAdjustment } from '../types/segmentation'
export type { AdjustmentParams, AdjustmentScope } from '../types/adjustments'
export { toSnakeAdjustParams } from '../types/adjustments'

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSegmentation() {
    const [state, setState] = useState<SegmentState>(INITIAL_STATE)

    const sessionRef              = useRef<string | null>(null)
    const promptModeRef           = useRef<PromptMode>(INITIAL_STATE.promptMode)
    const textRef                 = useRef<string>(INITIAL_STATE.text)
    const pointsRef               = useRef<PointPrompt[]>(INITIAL_STATE.points)
    const boxRef                  = useRef<[number, number, number, number] | null>(INITIAL_STATE.box)
    const exemplarBoxRef          = useRef<[number, number, number, number] | null>(INITIAL_STATE.exemplarBox)
    const exemplarNegBoxesRef     = useRef<[number, number, number, number][]>(INITIAL_STATE.exemplarNegBoxes)
    const masksRef                = useRef<MaskResult[]>(INITIAL_STATE.masks)
    const selectedMaskIdxRef      = useRef<number>(INITIAL_STATE.selectedMaskIdx)
    const textThresholdRef        = useRef<number>(INITIAL_STATE.textThreshold)
    const maskThresholdRef        = useRef<number>(INITIAL_STATE.maskThreshold)
    const featherRadiusRef        = useRef<number>(INITIAL_STATE.featherRadius)
    const invertSelectionRef      = useRef<boolean>(INITIAL_STATE.invertSelection)
    const activeOpsRef            = useRef<ActiveOp[]>(INITIAL_STATE.activeOps)
    const lastAdjustmentRef       = useRef<LastAdjustment | null>(INITIAL_STATE.lastAdjustment)
    const opChainResultB64Ref     = useRef<string | null>(INITIAL_STATE.opChainResultB64)
    const thresholdTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null)
    const featherTimerRef         = useRef<ReturnType<typeof setTimeout> | null>(null)

    // No dependency array — keeps all refs in sync after every render.
    useEffect(() => {
        promptModeRef.current         = state.promptMode
        textRef.current               = state.text
        pointsRef.current             = state.points
        boxRef.current                = state.box
        exemplarBoxRef.current        = state.exemplarBox
        exemplarNegBoxesRef.current   = state.exemplarNegBoxes
        masksRef.current              = state.masks
        selectedMaskIdxRef.current    = state.selectedMaskIdx
        textThresholdRef.current      = state.textThreshold
        maskThresholdRef.current      = state.maskThreshold
        featherRadiusRef.current      = state.featherRadius
        invertSelectionRef.current    = state.invertSelection
        activeOpsRef.current          = state.activeOps
        lastAdjustmentRef.current     = state.lastAdjustment
        opChainResultB64Ref.current   = state.opChainResultB64
    })

    // ------------------------------------------------------------------
    // Core chain runner — ops in canonical order, then optional adjustment
    // ------------------------------------------------------------------

    // @ts-ignore
    const invoke = (ch: string, p: Record<string, unknown>) => window.ipcRenderer.invoke(ch, p)

    const runChain = useCallback(async (
        ops: ActiveOp[],
        adjustment: LastAdjustment | null,
    ) => {
        if (ops.length === 0 && !adjustment) {
            setState(s => ({ ...s, resultB64: null, opChainResultB64: null }))
            return
        }

        const sessionId = sessionRef.current
        const maskB64   = masksRef.current[selectedMaskIdxRef.current]?.mask_b64 ?? ''

        if (ops.length > 0 && (!sessionId || !maskB64)) {
            setState(s => ({ ...s, error: 'No mask selected' }))
            return
        }

        setState(s => ({ ...s, isApplying: true, error: null }))

        try {
            let opChainResult: string | null = null

            if (ops.length > 0 && sessionId && maskB64) {
                opChainResult = await runOpsIPC(
                    invoke, ops, sessionId, maskB64,
                    invertSelectionRef.current, featherRadiusRef.current,
                )
            }

            opChainResultB64Ref.current = opChainResult

            let finalResult: string | null = opChainResult

            if (adjustment) {
                const source   = opChainResult ?? adjustment.baseImageB64
                const adjMask  = adjustment.scope === 'segment' ? maskB64 : undefined
                finalResult = await runAdjustmentIPC(
                    invoke, source, adjustment.params, adjustment.scope,
                    adjMask, invertSelectionRef.current, featherRadiusRef.current,
                )
            }

            setState(s => ({
                ...s,
                resultB64: finalResult,
                opChainResultB64: opChainResult,
                isApplying: false,
                error: null,
            }))
        } catch (e: any) {
            setState(s => ({ ...s, isApplying: false, error: e.message }))
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Auto re-predict (debounced) when confidence/mask thresholds change in text mode.
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

    // Auto re-run chain when invert selection toggles (instant).
    useEffect(() => {
        if (!masksRef.current.length || !sessionRef.current) return
        if (!activeOpsRef.current.length && !lastAdjustmentRef.current) return
        runChain(activeOpsRef.current, lastAdjustmentRef.current)
    }, [state.invertSelection]) // eslint-disable-line react-hooks/exhaustive-deps

    // Auto re-run chain when feather radius changes (debounced).
    useEffect(() => {
        if (!masksRef.current.length || !sessionRef.current) return
        if (!activeOpsRef.current.length && !lastAdjustmentRef.current) return

        if (featherTimerRef.current) clearTimeout(featherTimerRef.current)
        featherTimerRef.current = setTimeout(() => {
            runChain(activeOpsRef.current, lastAdjustmentRef.current)
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
                opChainResultB64: null,
                activeOps: [],
                lastAdjustment: null,
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
                box: mode === 'points' ? s.box : null,
                exemplarBox: mode === 'exemplar' ? s.exemplarBox : null,
                exemplarNegBoxes: mode === 'exemplar' ? s.exemplarNegBoxes : [],
                masks: [],
                selectedMaskIdx: 0,
                resultB64: null,
                opChainResultB64: null,
                activeOps: [],
                lastAdjustment: null,
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
        setState(s => ({
            ...s,
            points: [], box: null, text: '', exemplarBox: null, exemplarNegBoxes: [],
            masks: [], selectedMaskIdx: 0,
            resultB64: null, opChainResultB64: null, activeOps: [], lastAdjustment: null,
            error: null,
        }))
    }, [])

    const setSelectedMaskIdx = useCallback((idx: number) => {
        setState(s => ({ ...s, selectedMaskIdx: idx, resultB64: null }))
        // Re-run chain with the new mask (refs will be updated by next effect, but
        // we pass the new idx directly to avoid a stale-closure read)
        setTimeout(() => {
            if (!activeOpsRef.current.length && !lastAdjustmentRef.current) return
            runChain(activeOpsRef.current, lastAdjustmentRef.current)
        }, 0)
    }, [runChain])

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
        const result = await computeUnionMask(masksRef.current)
        if (!result) return
        setState(s => ({
            ...s,
            masks: [{ mask_b64: result.mask_b64, score: 1.0, area: result.area }],
            selectedMaskIdx: 0,
            resultB64: null,
        }))
    }, [])

    // ------------------------------------------------------------------
    // Predict
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
            const points     = override?.points ?? pointsRef.current
            const box        = override?.box    ?? boxRef.current
            const text       = override?.text   ?? textRef.current

            let payload: Record<string, unknown> = { session_id: currentSession }

            const exemplarBox      = override?.exemplarBox !== undefined ? override.exemplarBox : exemplarBoxRef.current
            const exemplarNegBoxes = override?.exemplarNegBoxes ?? exemplarNegBoxesRef.current

            if (promptMode === 'exemplar' && exemplarBox) {
                payload = { session_id: currentSession, exemplar_box: exemplarBox, exemplar_neg_boxes: exemplarNegBoxes }
            } else if (promptMode === 'text' && text.trim()) {
                payload = { session_id: currentSession, text: text.trim(), text_threshold: textThresholdRef.current, mask_threshold: maskThresholdRef.current }
            } else if (box && points.length > 0) {
                payload = { session_id: currentSession, box, points: points.map(p => [p.x, p.y]), point_labels: points.map(p => p.label) }
            } else if (box) {
                payload = { session_id: currentSession, box }
            } else if (points.length > 0) {
                payload = { session_id: currentSession, points: points.map(p => [p.x, p.y]), point_labels: points.map(p => p.label) }
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
                maskHistory: [],
                maskFuture: [],
            }))

            masksRef.current          = res.masks ?? []
            selectedMaskIdxRef.current = 0

            // Auto-reapply the full chain whenever the mask changes.
            if ((res.masks ?? []).length > 0 && (activeOpsRef.current.length > 0 || lastAdjustmentRef.current)) {
                runChain(activeOpsRef.current, lastAdjustmentRef.current)
            }
        } catch (e: any) {
            setState(s => ({ ...s, isPredicting: false, error: e.message }))
        }
    }, [runChain])

    // ------------------------------------------------------------------
    // Operation stack — applyOp / deactivateOp
    // ------------------------------------------------------------------

    const applyOp = useCallback(async (operation: Operation, extra?: OpExtra) => {
        const current = activeOpsRef.current
        const existingIdx = current.findIndex(a => a.operation === operation)

        let newOps: ActiveOp[]
        if (existingIdx >= 0) {
            // Update params on an already-active op (e.g. slider changed).
            newOps = current.map((a, i) => i === existingIdx ? { ...a, extra } : a)
        } else if (BG_OPS.has(operation)) {
            // Replace any existing bg op — only one bg op at a time.
            newOps = [...current.filter(a => !BG_OPS.has(a.operation)), { operation, extra }]
        } else {
            newOps = [...current, { operation, extra }]
        }

        setState(s => ({ ...s, activeOps: newOps }))
        activeOpsRef.current = newOps
        await runChain(newOps, lastAdjustmentRef.current)
    }, [runChain])

    const deactivateOp = useCallback(async (operation: Operation) => {
        const newOps = activeOpsRef.current.filter(a => a.operation !== operation)
        setState(s => ({ ...s, activeOps: newOps }))
        activeOpsRef.current = newOps
        await runChain(newOps, lastAdjustmentRef.current)
    }, [runChain])

    // ------------------------------------------------------------------
    // Photo Adjustments — stack on top of op chain
    // ------------------------------------------------------------------

    const applyAdjustments = useCallback(async (
        imageB64: string,
        params: import('../types/adjustments').AdjustmentParams,
        scope: import('../types/adjustments').AdjustmentScope,
    ): Promise<void> => {
        const maskB64 = masksRef.current[selectedMaskIdxRef.current]?.mask_b64 ?? ''
        if (scope === 'segment' && !maskB64) {
            setState(s => ({ ...s, error: 'Segment scope requires an active mask' }))
            return
        }

        const adj: LastAdjustment = { params, scope, baseImageB64: imageB64 }
        setState(s => ({ ...s, lastAdjustment: adj }))
        lastAdjustmentRef.current = adj

        await runChain(activeOpsRef.current, adj)
    }, [runChain])

    // ------------------------------------------------------------------
    // Phase 119 — Mask editing (undo/redo, brush mode)
    // ------------------------------------------------------------------

    const enterEditMask = useCallback(() => {
        setState(s => ({ ...s, editingMask: true }))
    }, [])

    const exitEditMask = useCallback(() => {
        setState(s => ({ ...s, editingMask: false }))
    }, [])

    const applyMaskEdit = useCallback((newMaskB64: string) => {
        setState(s => {
            const prevMaskB64 = s.masks[s.selectedMaskIdx]?.mask_b64 ?? ''
            const masks = s.masks.map((m, i) =>
                i === s.selectedMaskIdx ? { ...m, mask_b64: newMaskB64 } : m
            )
            return {
                ...s,
                masks,
                resultB64: null,
                maskHistory: [...s.maskHistory.slice(-19), prevMaskB64],
                maskFuture: [],
            }
        })
        // Re-run chain with the edited mask (state updates async, but refs stay in sync)
        setTimeout(() => {
            if (!activeOpsRef.current.length && !lastAdjustmentRef.current) return
            masksRef.current = masksRef.current.map((m, i) =>
                i === selectedMaskIdxRef.current ? { ...m, mask_b64: newMaskB64 } : m
            )
            runChain(activeOpsRef.current, lastAdjustmentRef.current)
        }, 0)
    }, [runChain])

    const undoMask = useCallback(() => {
        setState(s => {
            if (s.maskHistory.length === 0) return s
            const prev    = s.maskHistory[s.maskHistory.length - 1]
            const current = s.masks[s.selectedMaskIdx]?.mask_b64 ?? ''
            const masks   = s.masks.map((m, i) =>
                i === s.selectedMaskIdx ? { ...m, mask_b64: prev } : m
            )
            return {
                ...s,
                masks,
                resultB64: null,
                maskHistory: s.maskHistory.slice(0, -1),
                maskFuture: [current, ...s.maskFuture],
            }
        })
    }, [])

    const redoMask = useCallback(() => {
        setState(s => {
            if (s.maskFuture.length === 0) return s
            const next    = s.maskFuture[0]
            const current = s.masks[s.selectedMaskIdx]?.mask_b64 ?? ''
            const masks   = s.masks.map((m, i) =>
                i === s.selectedMaskIdx ? { ...m, mask_b64: next } : m
            )
            return {
                ...s,
                masks,
                resultB64: null,
                maskHistory: [...s.maskHistory, current],
                maskFuture: s.maskFuture.slice(1),
            }
        })
    }, [])

    // ------------------------------------------------------------------
    // Save result to library
    // ------------------------------------------------------------------

    const saveResult = useCallback(async (): Promise<{ savedPath: string } | { error: string }> => {
        const resultB64  = state.resultB64
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
    // Clear result / Reset
    // ------------------------------------------------------------------

    const clearResult = useCallback(() => {
        setState(s => ({
            ...s,
            resultB64: null,
            opChainResultB64: null,
            activeOps: [],
            lastAdjustment: null,
        }))
    }, [])

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
        applyOp,
        deactivateOp,
        applyAdjustments,
        clearResult,
        saveResult,
        enterEditMask,
        exitEditMask,
        applyMaskEdit,
        undoMask,
        redoMask,
        canUndo: state.maskHistory.length > 0,
        canRedo: state.maskFuture.length > 0,
        reset,
    }
}
