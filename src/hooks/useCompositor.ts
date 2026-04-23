import { useState, useCallback, useRef, useEffect } from 'react'
import { LayerSpec, LayerTransform, CompositorState, SendToComposePayload } from '../types/compositor'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPOSE_DEBOUNCE_MS = 200

const INITIAL_STATE: CompositorState = {
    layers: [],
    canvasWidth: 1920,
    canvasHeight: 1080,
    resultB64: null,
    isCompositing: false,
    error: null,
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCompositor() {
    const [state, setState] = useState<CompositorState>(INITIAL_STATE)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const stateRef = useRef(state)
    useEffect(() => { stateRef.current = state })

    // ------------------------------------------------------------------
    // Internal: call Python to flatten the layer stack
    // ------------------------------------------------------------------

    const flattenLayers = useCallback(async (layers: LayerSpec[], width: number, height: number) => {
        if (layers.filter(l => l.visible).length === 0) {
            setState(s => ({ ...s, resultB64: null, isCompositing: false, error: null }))
            return
        }

        setState(s => ({ ...s, isCompositing: true, error: null }))
        try {
            // @ts-ignore
            const res = await window.ipcRenderer.invoke('ai:compose:layers', { layers, width, height })
            if (!res?.success) throw new Error(res?.error ?? 'Composition failed')
            setState(s => ({ ...s, resultB64: res.result_b64, isCompositing: false, error: null }))
        } catch (e: any) {
            setState(s => ({ ...s, isCompositing: false, error: e.message ?? 'Composition failed' }))
        }
    }, [])

    // Debounce helper — cancels any pending re-composite and schedules a new one
    const scheduleFlatten = useCallback((layers: LayerSpec[], width: number, height: number) => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => flattenLayers(layers, width, height), COMPOSE_DEBOUNCE_MS)
    }, [flattenLayers])

    useEffect(() => () => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
    }, [])

    // ------------------------------------------------------------------
    // Canvas dimensions
    // ------------------------------------------------------------------

    const setCanvasDimensions = useCallback((width: number, height: number) => {
        setState(s => {
            const next = { ...s, canvasWidth: width, canvasHeight: height }
            scheduleFlatten(s.layers, width, height)
            return next
        })
    }, [scheduleFlatten])

    // ------------------------------------------------------------------
    // Layer CRUD
    // ------------------------------------------------------------------

    const addLayer = useCallback((spec: Omit<LayerSpec, 'id' | 'zIndex'>) => {
        setState(s => {
            const maxZ = s.layers.reduce((m, l) => Math.max(m, l.zIndex), -1)
            const newLayer: LayerSpec = {
                ...spec,
                id: crypto.randomUUID(),
                zIndex: maxZ + 1,
            }

            // If this is the first layer, size the canvas to match it
            let nextWidth = s.canvasWidth
            let nextHeight = s.canvasHeight
            if (s.layers.length === 0 && spec.sourceImageB64) {
                // Canvas dimensions are set by the caller via setCanvasDimensions before addLayer,
                // so we just use whatever is current here.
            }

            const nextLayers = [...s.layers, newLayer]
            scheduleFlatten(nextLayers, nextWidth, nextHeight)
            return { ...s, layers: nextLayers, canvasWidth: nextWidth, canvasHeight: nextHeight }
        })
    }, [scheduleFlatten])

    const removeLayer = useCallback((id: string) => {
        setState(s => {
            const target = s.layers.find(l => l.id === id)
            // Prevent deleting the background (z=0) layer
            if (target?.zIndex === 0) return s

            const nextLayers = s.layers.filter(l => l.id !== id)
            scheduleFlatten(nextLayers, s.canvasWidth, s.canvasHeight)
            return { ...s, layers: nextLayers }
        })
    }, [scheduleFlatten])

    const updateLayer = useCallback((id: string, patch: Partial<LayerSpec>) => {
        setState(s => {
            const nextLayers = s.layers.map(l => l.id === id ? { ...l, ...patch } : l)
            scheduleFlatten(nextLayers, s.canvasWidth, s.canvasHeight)
            return { ...s, layers: nextLayers }
        })
    }, [scheduleFlatten])

    const updateLayerTransform = useCallback((id: string, transform: LayerTransform) => {
        updateLayer(id, transform)
    }, [updateLayer])

    // ------------------------------------------------------------------
    // Layer ordering
    // ------------------------------------------------------------------

    /**
     * Swap the zIndex values of two layers (used by dnd-kit drag-end handler).
     */
    const moveLayer = useCallback((activeId: string, overId: string) => {
        setState(s => {
            const active = s.layers.find(l => l.id === activeId)
            const over = s.layers.find(l => l.id === overId)
            if (!active || !over || activeId === overId) return s

            // Swap zIndex values
            const newActiveZ = over.zIndex
            const newOverZ = active.zIndex

            const nextLayers = s.layers.map(l => {
                if (l.id === activeId) return { ...l, zIndex: newActiveZ }
                if (l.id === overId) return { ...l, zIndex: newOverZ }
                return l
            })
            scheduleFlatten(nextLayers, s.canvasWidth, s.canvasHeight)
            return { ...s, layers: nextLayers }
        })
    }, [scheduleFlatten])

    const bringToFront = useCallback((id: string) => {
        setState(s => {
            const maxZ = s.layers.reduce((m, l) => Math.max(m, l.zIndex), 0)
            const nextLayers = s.layers.map(l => l.id === id ? { ...l, zIndex: maxZ + 1 } : l)
            scheduleFlatten(nextLayers, s.canvasWidth, s.canvasHeight)
            return { ...s, layers: nextLayers }
        })
    }, [scheduleFlatten])

    const sendToBack = useCallback((id: string) => {
        setState(s => {
            const target = s.layers.find(l => l.id === id)
            // Cannot send the existing background lower than z=0
            if (!target || target.zIndex === 0) return s

            // Shift all layers with z=0 up by 1, place this layer at z=0
            const nextLayers = s.layers.map(l => {
                if (l.id === id) return { ...l, zIndex: 0 }
                if (l.zIndex === 0) return { ...l, zIndex: 1 }
                return l
            })
            scheduleFlatten(nextLayers, s.canvasWidth, s.canvasHeight)
            return { ...s, layers: nextLayers }
        })
    }, [scheduleFlatten])

    // ------------------------------------------------------------------
    // "Send to Compose" integration
    // ------------------------------------------------------------------

    const addFromCreativeTools = useCallback((payload: SendToComposePayload) => {
        const newSpec: Omit<LayerSpec, 'id' | 'zIndex'> = {
            name: payload.suggestedName ?? 'Segment',
            sourceImageB64: payload.sourceImageB64,
            maskB64: payload.maskB64,
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            sourceWidth: payload.sourceWidth ?? 0,
            sourceHeight: payload.sourceHeight ?? 0,
            opacity: 1,
            visible: true,
        }
        addLayer(newSpec)
    }, [addLayer])

    // ------------------------------------------------------------------
    // Reset
    // ------------------------------------------------------------------

    const reset = useCallback(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        setState(INITIAL_STATE)
    }, [])

    return {
        state,
        setCanvasDimensions,
        addLayer,
        removeLayer,
        updateLayer,
        updateLayerTransform,
        moveLayer,
        bringToFront,
        sendToBack,
        addFromCreativeTools,
        flattenLayers: () => {
            const { layers, canvasWidth, canvasHeight } = stateRef.current
            flattenLayers(layers, canvasWidth, canvasHeight)
        },
        reset,
    }
}
